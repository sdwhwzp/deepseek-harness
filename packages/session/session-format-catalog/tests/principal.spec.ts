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

function migrate(rows: unknown[], version = 0) {
  return sessionFormatCatalog.migrate(sessionFormatCatalog.decodeArtifact({ ...header, version }, rows))
}

describe('released authenticated history', () => {
  it.each([0, 1])('preserves message and turn identities through the complete v%s to v2 chain', (version) => {
    const rows = history()
    const original = structuredClone(rows)
    const migrated = migrate(rows, version)
    expect(migrated.header.version).toBe(2)
    expect(migrated.events).toEqual(rows)
    expect(rows).toEqual(original)
    const encoded = sessionFormatCatalog.encodeCurrent(migrated)
    expect(sessionFormatCatalog.migrate(sessionFormatCatalog.decodeArtifact(encoded.header, encoded.rows))).toEqual(migrated)
  })

  it.each(['admin', 'user'])('retains the %s role while removing a legacy turn trigger', (role) => {
    const rows = history({ ...principal, role })
    Object.assign(rows[1]!.data, { trigger: { kind: 'prompt' } })
    const migrated = migrate(rows)
    expect(migrated.events[1]!.data).toEqual({ turn: 1, principal: { ...principal, role } })
  })

  it.each([
    null,
    { ...principal, id: 2 },
    { ...principal, role: 'owner' },
    { ...principal, token: 'unexpected' },
    { source: 'gateway', id: 'account-2', role: 'user' },
  ])('refuses malformed stored identity %#', (identity) => {
    expect(() => migrate(history(identity))).toThrow(/principal/)
  })

  it.each([1, 2, 3])('validates identity at event %s independently of inbox validation', (index) => {
    const rows = history()
    Object.assign(rows[index]!.data, { principal: { ...principal, role: 'owner' } })
    expect(() => migrate(rows)).toThrow(/principal/)
  })
})
