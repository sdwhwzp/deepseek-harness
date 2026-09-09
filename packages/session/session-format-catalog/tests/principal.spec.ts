import { describe, expect, it } from 'vitest'
import { sessionFormatCatalog } from '../src/index.ts'

const header = { type: 'session', version: 0, id: 'principal-history', createdAt: 1, delegationDepth: 0 }
const principal = { source: 'gateway', id: 'account-2', username: 'reader', role: 'user' }

function history(identity: unknown = principal) {
  const message = { id: 'message-1', role: 'user', content: [{ type: 'text', text: 'Retain this history.' }], source: { kind: 'user' }, principal: identity }
  return [
    { type: 'agent/inbox/spliced', seq: 0, time: 2, data: { target: 'next-turn', start: 0, inserted: [message] } },
    { type: 'turn/start', seq: 1, time: 3, data: { turn: 1, principal: identity } },
    { type: 'step/start', seq: 2, time: 4, data: { turn: 1, step: 1, principal: identity } },
    { type: 'user/message', seq: 3, time: 5, data: message, sourceEventSeqs: [0], surfaceOp: 'append' },
    { type: 'step/end', seq: 4, time: 6, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 5, time: 7, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

function restore(rows: unknown[], version = 0) {
  // Released v2 headers carry isSeeded; earlier generations refuse the member.
  const physical = version === 2 ? { ...header, version, isSeeded: false } : { ...header, version }
  const run = sessionFormatCatalog.createRestore(
    physical,
    { recovery: 'strict', validation: 'current' },
  )
  for (const row of rows) run.decodeRow(row)
  return run.finish()
}

/** Collect every stored identity, keyed by the event type that carries it. */
function identitiesOf(events: readonly { type: string; data: unknown }[]) {
  const byType: Record<string, unknown[]> = {}
  for (const event of events) {
    const data = event.data as Record<string, unknown>
    if (event.type === 'agent/inbox/spliced') {
      for (const inserted of (data['inserted'] ?? []) as Record<string, unknown>[]) {
        if (inserted['principal'] !== undefined) (byType[event.type] ??= []).push(inserted['principal'])
      }
      continue
    }
    const message = data['message'] as Record<string, unknown> | undefined
    const identity = data['principal'] ?? message?.['principal']
    if (identity !== undefined) (byType[event.type] ??= []).push(identity)
  }
  return byType
}

describe('released authenticated history', () => {
  it.each([0, 1, 2])('preserves message and turn identities through the complete v%s chain', (version) => {
    const rows = history()
    const original = structuredClone(rows)
    const migrated = restore(rows, version)
    expect(migrated.header.version).toBe(sessionFormatCatalog.currentVersion)
    // Migration may insert events (v2-to-v3 adds a system node), so identity is
    // asserted by event type rather than by position.
    expect(identitiesOf(migrated.events)).toEqual({
      'turn/start': [principal],
      'step/start': [principal],
      'user/message': [principal],
      'agent/inbox/spliced': [principal],
    })
    expect(rows).toEqual(original)

    // Re-encoding the migrated artifact and restoring it again must be a no-op,
    // so a stored identity survives every later read of the same log.
    const encodedRows = migrated.events.map(event => sessionFormatCatalog.encodeCurrentEvent(event))
    const encodedHeader = sessionFormatCatalog.encodeCurrentHeader(migrated.header, migrated.inheritedEventCount)
    const again = sessionFormatCatalog.createRestore(encodedHeader, { recovery: 'strict', validation: 'current' })
    for (const row of encodedRows) again.decodeRow(row)
    expect(identitiesOf(again.finish().events)).toEqual(identitiesOf(migrated.events))
  })

  it.each(['admin', 'user'])('retains the %s role while removing a legacy turn trigger', (role) => {
    const rows = history({ ...principal, role })
    Object.assign(rows[1]!.data, { trigger: { kind: 'prompt' } })
    const migrated = restore(rows)
    expect(migrated.events[1]!.data).toEqual({ turn: 1, principal: { ...principal, role } })
  })

  it.each([
    null,
    { ...principal, id: 2 },
    { ...principal, role: 'owner' },
    { ...principal, token: 'unexpected' },
    { source: 'gateway', id: 'account-2', role: 'user' },
  ])('refuses malformed stored identity %#', (identity) => {
    expect(() => restore(history(identity))).toThrow(/principal/)
  })

  it.each([1, 2, 3])('validates identity at event %s independently of inbox validation', (index) => {
    const rows = history()
    Object.assign(rows[index]!.data, { principal: { ...principal, role: 'owner' } })
    expect(() => restore(rows)).toThrow(/principal/)
  })
})
