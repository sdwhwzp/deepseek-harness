/** Disambiguate repeated V3 advertisements using their ordered calls and recorded result references. */
import { SessionFormatUnsupportedMigrationError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatJsonObject, SessionFormatJsonValue } from '@deepseek-ai/dsh-session-format'

interface Occurrence {
  readonly original: string
  readonly id: string
  readonly name: SessionFormatJsonValue | undefined
  readonly arguments: SessionFormatJsonValue | undefined
  started: boolean
}

/** Stream indices name blocks in first-seen order, independently of their numeric value. */
function rewriteStream(
  stream: SessionFormatJsonValue | undefined,
  content: readonly SessionFormatJsonValue[],
  rewritten: readonly SessionFormatJsonValue[],
): SessionFormatJsonValue | undefined {
  if (!Array.isArray(stream) || stream.length === 0) return stream
  const positions = new Map<number, number>()
  const records = stream as readonly SessionFormatJsonValue[]
  const mapped = records.map((record) => {
    if (!isSessionFormatJsonObject(record)) return record
    const chunk = record['type'] === 'chunk' ? record['chunk'] : record
    if (!isSessionFormatJsonObject(chunk) || typeof chunk['index'] !== 'number') return record
    const index = chunk['index']
    const position = positions.get(index) ?? positions.size
    positions.set(index, position)
    const original = content[position]
    const replacement = rewritten[position]
    if (!isSessionFormatJsonObject(original) || !isSessionFormatJsonObject(replacement)
      || typeof replacement['id'] !== 'string' || original['id'] === replacement['id']) return record
    let changed: SessionFormatJsonObject = chunk
    if ((chunk['type'] === 'tool-call-chunks' || chunk['type'] === 'tool-call-delta') && chunk['id'] === original['id']) {
      changed = { ...chunk, id: replacement['id'] }
    } else if (chunk['type'] === 'block-end' && isSessionFormatJsonObject(chunk['block']) && chunk['block']['type'] === 'tool-call' && chunk['block']['id'] === original['id']) {
      changed = { ...chunk, block: { ...chunk['block'], id: replacement['id'] } }
    }
    return record['type'] === 'chunk' ? { ...record, chunk: changed } : changed
  })
  if (positions.size !== content.length) throw new SessionFormatUnsupportedMigrationError('duplicate V3 tool stream does not match its advertised blocks')
  return mapped
}

/** One migration's duplicate tool identities; source event coordinates remain unchanged. */
export class V3ToolIdentities {
  private readonly pending = new Map<string, Occurrence[]>()
  private readonly calls = new Map<number, Occurrence>()

  /**
   * Assign distinct ids only when a single historical message advertises duplicates.
   * @param event - released V3 event before reference remapping and tool-role lifting.
   * @returns a copy with consistent tool ids, or the unchanged source event.
   */
  transform(event: SessionFormatEvent): SessionFormatEvent {
    if (event.type === 'step/end') this.pending.clear()
    const data = event.data
    if (!isSessionFormatJsonObject(data)) return event
    const message = data['message']
    if (event.type === 'assistant/message' && isSessionFormatJsonObject(message) && Array.isArray(message['content'])) {
      const content = message['content'] as readonly SessionFormatJsonValue[]
      const ids = content.flatMap(block => isSessionFormatJsonObject(block) && block['type'] === 'tool-call' && typeof block['id'] === 'string' ? [block['id']] : [])
      const duplicates = new Set(ids.filter((id, index) => ids.indexOf(id) !== index))
      if (duplicates.size === 0) return event
      const reserved = new Set(ids)
      for (const id of duplicates) {
        if (this.pending.has(id)) throw new SessionFormatUnsupportedMigrationError('overlapping duplicate V3 tool advertisements')
        this.pending.set(id, [])
      }
      const preserved: SessionFormatJsonObject[] = []
      const rewritten = content.map((block, index) => {
        if (!isSessionFormatJsonObject(block) || block['type'] !== 'tool-call' || typeof block['id'] !== 'string') return block
        const occurrences = this.pending.get(block['id'])
        if (occurrences === undefined) return block
        let id = block['id']
        if (occurrences.length > 0) {
          id = `v3-tool-${event.seq}-${index}-${id}`
          while (reserved.has(id)) id = `v3-${id}`
          reserved.add(id)
        }
        occurrences.push({ original: block['id'], id, name: block['name'], arguments: block['arguments'], started: false })
        if (id !== block['id']) preserved.push({ index, id: block['id'] })
        return id === block['id'] ? block : { ...block, id }
      })
      if (Object.hasOwn(data, 'plugin:v3:toolCallIds')) throw new SessionFormatUnsupportedMigrationError('duplicate V3 tool metadata collides with the preserved ids')
      const stream = rewriteStream(data['stream'], content, rewritten)
      return { ...event, data: { ...data, ...(stream === undefined ? {} : { stream }),
        message: { ...message, content: rewritten }, 'plugin:v3:toolCallIds': preserved } }
    }
    if (event.type === 'tool/call' && typeof data['callId'] === 'string') {
      const occurrences = this.pending.get(data['callId'])
      if (occurrences === undefined) return event
      const occurrence = occurrences.find(item => !item.started)
      if (occurrence === undefined || occurrence.name !== data['name'] || occurrence.arguments !== data['arguments']) {
        throw new SessionFormatUnsupportedMigrationError('duplicate V3 tool calls do not follow their advertisements')
      }
      if (occurrence.id !== occurrence.original && Object.hasOwn(data, 'plugin:v3:toolCallId')) throw new SessionFormatUnsupportedMigrationError('duplicate V3 call metadata collides with the preserved id')
      occurrence.started = true
      this.calls.set(event.seq, occurrence)
      return occurrence.id === occurrence.original ? event : { ...event, data: { ...data, callId: occurrence.id, 'plugin:v3:toolCallId': occurrence.original } }
    }
    if (event.type === 'tool/result' && isSessionFormatJsonObject(message)) {
      const source = message['source']
      if (!isSessionFormatJsonObject(source) || typeof source['callId'] !== 'string') return event
      const references = event['sourceEventSeqs']
      const matches = Array.isArray(references) ? references.flatMap((seq) => {
        const call = typeof seq === 'number' ? this.calls.get(seq) : undefined
        return call === undefined ? [] : [call]
      }) : []
      if (matches.length === 0 && !this.pending.has(source['callId'])) return event
      const occurrence = matches[0]
      if (matches.length !== 1 || occurrence?.original !== source['callId']) {
        throw new SessionFormatUnsupportedMigrationError('duplicate V3 tool result requires one recorded call reference')
      }
      if (occurrence.id === occurrence.original) return event
      if (Object.hasOwn(message, 'v3:toolCallId')) throw new SessionFormatUnsupportedMigrationError('duplicate V3 result metadata collides with the preserved id')
      const content = message['content']
      if (!Array.isArray(content) || content.length !== 1 || !isSessionFormatJsonObject(content[0]) || content[0]['type'] !== 'tool-result' || content[0]['toolCallId'] !== occurrence.original) {
        throw new SessionFormatUnsupportedMigrationError('duplicate V3 tool result requires its original wrapper')
      }
      return { ...event, data: { ...data, message: { ...message, source: { ...source, callId: occurrence.id },
        content: [{ ...content[0], toolCallId: occurrence.id }], 'v3:toolCallId': occurrence.original } } }
    }
    if (['callId', 'rootCallId', 'parentCallId'].some(key => typeof data[key] === 'string' && this.pending.has(data[key]))) {
      throw new SessionFormatUnsupportedMigrationError('duplicate V3 tool identity has unsupported dependent events')
    }
    return event
  }
}
