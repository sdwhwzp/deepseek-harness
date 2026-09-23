/** Disambiguate repeated V3 advertisements using their ordered calls and recorded result references. */
import { SessionFormatUnsupportedMigrationError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatJsonValue } from '@deepseek-ai/dsh-session-format'

interface Occurrence {
  readonly original: string
  readonly id: string
  readonly name: SessionFormatJsonValue | undefined
  readonly arguments: SessionFormatJsonValue | undefined
  started: boolean
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
        if (id !== block['id'] && Object.hasOwn(block, 'plugin:v3:toolCallId')) throw new SessionFormatUnsupportedMigrationError('duplicate V3 tool metadata collides with the preserved id')
        occurrences.push({ original: block['id'], id, name: block['name'], arguments: block['arguments'], started: false })
        return id === block['id'] ? block : { ...block, id, 'plugin:v3:toolCallId': block['id'] }
      })
      return { ...event, data: { ...data, message: { ...message, content: rewritten } } }
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
