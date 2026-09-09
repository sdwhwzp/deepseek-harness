import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm/message'
import { deriveReplayScript, parseSessionLog } from '../src/index.ts'

const repoRoot = resolve(import.meta.dirname, '../../../..')
const excludedDirectories = new Set(['dist', 'lib', 'node_modules'])

function committedSessionFixtures(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) files.push(...committedSessionFixtures(path))
    } else if (entry.name.startsWith('session') && entry.name.endsWith('.jsonl')) {
      if (!/^session(?:\.[1-9]\d*)?(?:\.v[1-9]\d*)?\.jsonl$/.test(entry.name)) {
        throw new Error(`invalid committed Session filename: ${path}`)
      }
      files.push(path)
    }
  }
  return files
}

function declaresFormat(text: string): boolean {
  const firstLine = text.split(/\r?\n/).find(line => line.trim().length > 0)
  if (firstLine === undefined) return false
  const header = JSON.parse(firstLine) as unknown
  return header !== null && typeof header === 'object' && !Array.isArray(header)
    && Object.hasOwn(header, 'version')
}

function filenameFormatVersion(path: string): number {
  const match = /^session(?:\.[1-9]\d*)?(?:\.v([1-9]\d*))?\.jsonl$/.exec(path.split(/[/\\]/u).at(-1) ?? '')
  if (match === null) throw new Error(`invalid committed Session filename: ${path}`)
  return match[1] === undefined ? 0 : Number(match[1])
}

describe('committed Session format corpus', () => {
  it('replays a recorded v0 transcript with retained message and turn principals', () => {
    const source = readFileSync(join(repoRoot, 'snapshots/session/text-turn/session.jsonl'), 'utf8')
    const principal = { source: 'fixture-auth', id: 'account-2', username: 'reader', role: 'user' }
    const rows = source.trimEnd().split('\n').map(line => JSON.parse(line) as { type: string; data?: Record<string, unknown> })
    for (const row of rows) {
      if (row.data === undefined) continue
      if (['turn/start', 'step/start', 'user/message'].includes(row.type)) row.data['principal'] = principal
      if (row.type === 'agent/inbox/spliced') {
        for (const message of row.data['inserted'] as Record<string, unknown>[]) message['principal'] = principal
      }
    }
    const restored = parseSessionLog(rows.map(row => JSON.stringify(row)).join('\n') + '\n')
    expect(deriveReplayScript(restored)).toEqual(deriveReplayScript(parseSessionLog(source)))
    const identities = restored.flatMap<{ event: string; principal: AuthenticatedPrincipal | undefined }>((event) => {
      switch (event.type) {
        case 'turn/start':
        case 'step/start':
        case 'user/message':
          return [{ event: event.type, principal: event.data.principal }]
        case 'agent/inbox/spliced':
          return event.data.inserted.map(message => ({ event: event.type, principal: message.principal }))
        default:
          return []
      }
    })
    expect(identities).toMatchSnapshot()
    expect(readFileSync(join(repoRoot, 'snapshots/session/text-turn/session.jsonl'), 'utf8')).toBe(source)
  })

  it('restores every versioned fixture through the current format catalog', () => {
    const files = ['snapshots', 'packages', 'scripts/snapshots/python-sdk-single-exe']
      .flatMap(root => committedSessionFixtures(join(repoRoot, root)))
      .sort()

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      if (!declaresFormat(source)) continue
      const key = relative(repoRoot, file).split('\\').join('/')
      const header = JSON.parse(source.split(/\r?\n/u).find(line => line.trim().length > 0) ?? '{}') as {
        version?: unknown
      }
      expect(header.version, `${key}: filename/header Session generation`).toBe(filenameFormatVersion(file))
      expect(() => parseSessionLog(source), `${key}: current-format restoration`).not.toThrow()
    }
  })
})
