import { describe, expect, it } from 'vitest'
import { createSessionFormatCatalogWithChildren, sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import type { SessionFormatEvent, SessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import { V3ToolIdentities } from '../src/tool-identities.ts'
import { BlockAssembler, expandAssistantStream } from '@deepseek-ai/dsh-llm'
import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm'

const header = { type: 'session', version: 3, id: 'duplicates', createdAt: 1, isSeeded: false, delegationDepth: 0 }
const coords = { turn: 1, step: 1 }
function fixture(): SessionFormatEvent[] {
  const row = (type: string, data: SessionFormatJsonObject) => ({ type, data })
  const block = { type: 'tool-call', id: 'same', name: 'web_fetch', arguments: '{}' }
  const result = (call: number) => ({ ...row('tool/result', { ...coords, message: { id: `result-${call}`, role: 'user', source: { kind: 'tool', callId: 'same' }, content: [{ type: 'tool-result', toolCallId: 'same', content: [{ type: 'text', text: `response-${call}` }] }] } }), surfaceOp: 'append', sourceEventSeqs: [call] })
  return [row('turn/start', { turn: 1 }), row('step/start', coords),
    { ...row('assistant/message', { ...coords, stream: [], message: { id: 'assistant', role: 'assistant', source: { kind: 'model', provider: 'mock', model: 'mock' }, content: [block, { ...block }] } }), surfaceOp: 'append' },
    row('tool/call', { ...coords, callId: 'same', name: 'web_fetch', arguments: '{}' }),
    row('tool/call', { ...coords, callId: 'same', name: 'web_fetch', arguments: '{}' }),
    result(4), result(3), row('step/end', coords), row('turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ].map((event, seq) => ({ ...event, seq, time: seq + 1 }))
}
function restore(events: readonly SessionFormatEvent[], version = 3) {
  const reader = (version === 3 ? createSessionFormatCatalogWithChildren([]) : sessionFormatCatalog).createRestore({ ...header, version }, { recovery: 'strict', validation: 'current' })
  for (const event of events) reader.decodeRow(event)
  return reader.finish()
}

describe('V3 repeated tool identities', () => {
  it('retains every call and out-of-order result with distinct ids in the V4 successor', () => {
    const source = fixture()
    const before = structuredClone(source)
    const artifact = restore(source)
    expect(artifact.events[2]).toMatchObject({ data: { message: { content: [{ id: 'same' }, { id: 'v3-tool-2-1-same' }] }, 'plugin:v3:toolCallIds': [{ index: 1, id: 'same' }] } })
    expect(artifact.events[4]).toMatchObject({ data: { callId: 'v3-tool-2-1-same' } })
    expect(artifact.events[5]).toMatchObject({ sourceEventSeqs: [4], data: { message: { toolCallId: 'v3-tool-2-1-same', content: [{ text: 'response-4' }] } } })
    expect(artifact.events[6]).toMatchObject({ sourceEventSeqs: [3], data: { message: { toolCallId: 'same', content: [{ text: 'response-3' }] } } })
    expect(restore(artifact.events, 4)).toEqual(artifact)
    expect(source).toEqual(before)
    expect(() => restore(source, 4)).toThrow()
  })

  it.each([{ references: undefined }, { references: [] }, { references: [3, 4] }])('refuses an ambiguous result reference $references', ({ references }) => {
    const rows = fixture()
    const { sourceEventSeqs: _omitted, ...result } = rows[5]!
    rows[5] = references === undefined ? result : { ...result, sourceEventSeqs: references }
    expect(() => restore(rows)).toThrow(references?.length === 0 ? 'sourceEventSeqs must be a non-empty array' : 'requires one recorded call reference')
  })

  it('refuses a changed call, missing result, or unsupported PTC dependency', () => {
    const rows = fixture()
    rows[4] = { ...rows[4]!, data: { ...(rows[4]!.data as SessionFormatJsonObject), arguments: '[]' } }
    expect(() => restore(rows)).toThrow('do not follow their advertisements')
    expect(() => restore(fixture().filter(event => event.seq !== 5).map((event, seq) => ({ ...event, seq })))).toThrow()
    const ids = new V3ToolIdentities()
    for (const event of fixture().slice(0, 5)) ids.transform(event)
    expect(() => ids.transform({ type: 'tool/ptc-dispatch-start', seq: 5, time: 6, data: { rootCallId: 'same' } })).toThrow('unsupported dependent events')
  })

  it('leaves unique advertisements unchanged and avoids existing generated ids', () => {
    const ids = new V3ToolIdentities()
    const event = fixture()[2]!
    const data = event.data as SessionFormatJsonObject
    const message = data['message'] as SessionFormatJsonObject
    const content = message['content'] as SessionFormatJsonObject[]
    const unique = { ...event, data: { ...data, message: { ...message, content: [content[0]!] } } }
    expect(ids.transform(unique)).toBe(unique)
    const collision = { ...event, data: { ...data, message: { ...message, content: [...content, { ...content[0]!, id: 'v3-tool-2-1-same' }] } } }
    expect(ids.transform(collision)).toMatchObject({ data: { message: { content: [{ id: 'same' }, { id: 'v3-v3-tool-2-1-same' }, { id: 'v3-tool-2-1-same' }] } } })
    expect(() => ids.transform(event)).toThrow('overlapping duplicate')
  })

  it('does not change unrelated events, content blocks, calls, or results', () => {
    const ids = new V3ToolIdentities()
    const unchanged: SessionFormatEvent[] = [
      { type: 'plugin/custom', seq: 0, time: 0, data: null },
      { type: 'tool/call', seq: 1, time: 1, data: { callId: 'unique' } },
      { type: 'tool/result', seq: 2, time: 2, data: { message: { source: null } } },
      { type: 'tool/result', seq: 3, time: 3, sourceEventSeqs: [1], data: { message: { source: { callId: 'unique' } } } },
    ]
    for (const event of unchanged) expect(ids.transform(event)).toBe(event)
    const message = { content: [{ type: 'text', text: 'Keep this text' },
      { type: 'tool-call', id: 'same', name: 'read', arguments: '{}' },
      { type: 'tool-call', id: 'same', name: 'read', arguments: '{}' }] }
    expect(ids.transform({ type: 'assistant/message', seq: 4, time: 4, data: { message } }))
      .toMatchObject({ data: { message: { content: [message.content[0], message.content[1], { id: 'v3-tool-4-2-same' }] } } })
  })

  it('refuses to overwrite metadata while preserving a duplicate identity', () => {
    const cases: Array<{ seq: number; data: SessionFormatJsonObject }> = [
      { seq: 2, data: { 'plugin:v3:toolCallIds': [], message: { content: [
        { type: 'tool-call', id: 'same', name: 'web_fetch', arguments: '{}' },
        { type: 'tool-call', id: 'same', name: 'web_fetch', arguments: '{}', 'plugin:v3:toolCallId': 'older' },
      ] } } },
      { seq: 4, data: { callId: 'same', name: 'web_fetch', arguments: '{}', 'plugin:v3:toolCallId': 'older' } },
      { seq: 5, data: { message: { source: { callId: 'same' }, 'v3:toolCallId': 'older' } } },
    ]
    for (const { seq, data } of cases) {
      const ids = new V3ToolIdentities()
      const rows = fixture()
      for (const event of rows.slice(0, seq)) ids.transform(event)
      expect(() => ids.transform({ ...rows[seq]!, data })).toThrow('metadata collides')
    }
  })

  it.each(['packed', 'raw', 'closed'])('keeps %s streamed calls consistent with the migrated message', (mode) => {
    const rows = fixture()
    const data = rows[2]!.data as SessionFormatJsonObject
    const message = data['message'] as SessionFormatJsonObject
    const blocks = message['content'] as SessionFormatJsonObject[]
    const text = { type: 'text', text: 'Calling both tools' }
    const stream = [
      { type: 'text-chunks', time0: 1, index: 20, dt: [], texts: [text.text] },
      ...[9, 2].flatMap((index, position) => [
        { type: 'chunk', time: 2, chunk: { type: 'block-start', index, blockType: 'tool-call' } },
        mode === 'raw'
          ? { type: 'chunk', time: 3, chunk: { type: 'tool-call-delta', index, id: 'same', name: 'web_fetch', argumentsDelta: '{}' } }
          : { type: 'tool-call-chunks', time0: 3, index, id: 'same', name: 'web_fetch', dt: [1], args: ['{', '}'] },
        ...(mode === 'closed' ? [{ type: 'chunk', time: 5, chunk: { type: 'block-end', index, block: blocks[position]! } }] : []),
      ]),
      { type: 'chunk', time: 6, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } },
    ]
    rows[2] = { ...rows[2]!, data: { ...data, stream, message: { ...message, content: [text, ...blocks] } } }
    const before = structuredClone(rows)
    const artifact = restore(rows)
    const migrated = artifact.events[2]!.data as SessionFormatJsonObject
    const assembler = new BlockAssembler()
    for (const { chunk } of expandAssistantStream(migrated['stream'] as readonly AssistantStreamRecord[])) assembler.push(chunk)
    expect(assembler.blocks()).toEqual((migrated['message'] as SessionFormatJsonObject)['content'])
    expect(migrated['plugin:v3:toolCallIds']).toEqual([{ index: 2, id: 'same' }])
    expect((migrated['stream'] as SessionFormatJsonObject[]).map(record => record['time0'] ?? record['time'])).toEqual(stream.map(record => 'time0' in record ? record.time0 : record.time))
    expect(rows).toEqual(before)
    expect(restore(artifact.events, 4)).toEqual(artifact)
  })

  it('refuses a nonempty stream with missing advertised blocks', () => {
    const rows = fixture()
    rows[2] = { ...rows[2]!, data: { ...(rows[2]!.data as SessionFormatJsonObject), stream: [{ type: 'chunk', time: 1, chunk: { type: 'finish', reason: { kind: 'stop' } } }] } }
    expect(() => restore(rows)).toThrow('stream does not match')
    rows[2] = { ...rows[2], data: { ...(rows[2].data as SessionFormatJsonObject), stream: [null] } }
    expect(() => restore(rows)).toThrow('stream does not match')
  })

  it('refuses a duplicate result whose original wrapper or recorded reference is inconsistent', () => {
    const ids = new V3ToolIdentities()
    const rows = fixture()
    for (const event of rows.slice(0, 5)) ids.transform(event)
    const result = rows[5]!
    for (const content of [null, [], [null], [{ type: 'text', text: 'result' }], [{ type: 'tool-result', toolCallId: 'other' }]]) {
      expect(() => ids.transform({ ...result, data: { message: { source: { callId: 'same' }, content } } })).toThrow('original wrapper')
    }
    expect(() => ids.transform({ ...result, sourceEventSeqs: ['invalid'] })).toThrow('recorded call reference')
    expect(() => ids.transform({ ...rows[4]!, seq: 9 })).toThrow('do not follow their advertisements')
  })
})
