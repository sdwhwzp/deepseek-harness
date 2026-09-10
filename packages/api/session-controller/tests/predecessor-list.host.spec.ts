/** Listing-only V2 metadata remains usable after the V3 format upgrade. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore, { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionProjectionCache, { projectionCacheDomainSpec } from '@deepseek-ai/dsh-session-projection-cache'
import { titleProjectionDefinition } from '@deepseek-ai/dsh-session-title'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { ApiSessionList } from '../src/list.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

it('loads predecessor cache documents through Cordis and preserves blankness without opening Sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-predecessor-list-'))
  roots.push(root)
  const directory = join(root, projectionCacheDomainSpec.name, 'sessions')
  await mkdir(directory, { recursive: true })
  const cases = [
    { id: 'blank', blank: true },
    { id: 'conversation', blank: false, lastPromptAt: 200 },
    { id: 'wrong-lifecycle', blank: true, createdAt: 99 },
    { id: 'wrong-row-version', blank: true, rowVersion: 2 },
    { id: 'invalid-row', blank: 'invalid' },
    { id: 'v1', blank: true, formatVersion: 1 },
    { id: 'unbound', blank: true, formatVersion: null },
    { id: 'future', blank: true, formatVersion: 4 },
    { id: 'seeded', blank: true, seeded: true },
    { id: 'denied', blank: true },
  ]
  const headers: SessionHeader[] = cases.map(value => ({
    id: SessionId(value.id), version: 3, createdAt: 100,
    cwd: '/work/WebDAV', isSeeded: value.seeded ?? false,
  }))
  for (const value of cases) {
    await writeFile(join(directory, `${value.id}.json`), JSON.stringify({
      version: projectionCacheDomainSpec.version,
      record: {
        identity: {
          ...(value.formatVersion === null ? {} : { formatVersion: value.formatVersion ?? 2 }),
          createdAt: value.createdAt ?? 100, cwd: '/work/WebDAV',
          isSeeded: value.seeded ?? false, inheritedEventCount: 0,
        },
        rows: {
          title: { ver: 1, seq: 3, val: null },
          sessionListMetadata: {
            ver: value.rowVersion ?? 1, seq: 3,
            val: { blank: value.blank, lastPromptAt: value.lastPromptAt ?? null },
          },
          tokenUsage: { ver: 1, seq: 3, val: { untrusted: true } },
        },
      },
    }) + '\n')
  }
  const original = await readFile(join(directory, 'blank.json'), 'utf8')
  const configPath = join(root, 'cordis.yml')
  const template = await readFile(new URL('./fixtures/predecessor-list.cordis.yml', import.meta.url), 'utf8')
  await writeFile(configPath, template.replace('__STORAGE_ROOT__', JSON.stringify(root)))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-session-projection-cache', SessionProjectionCache],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  ctx.sessionProjections.register(titleProjectionDefinition)
  const list = new ApiSessionList(ctx)
  ctx.provide('sessionQuery', {
    listSessions: async () => headers.map(header => ({ header, live: false, persisted: true })),
  } as never)
  const open = vi.fn(() => { throw new Error('listing must not open a Session') })
  ctx.provide('sessionPersistence', { open, stat: open } as never)
  const hints = vi.spyOn(ctx.sessionProjectionCache, 'cachedPredecessorListHints')
  const rows = await list.list(undefined, async ids => new Set(ids.filter(id => id !== 'denied')))
  await expect(JSON.stringify(rows.map(row => ({
    id: row.sessionId, blank: row.blank, updatedAt: row.updatedAt,
  })), null, 2) + '\n').toMatchFileSnapshot(
    fileURLToPath(new URL('./expected/predecessor-list.json', import.meta.url)),
  )
  expect(rows.find(row => row.sessionId === 'blank')?.projections).toEqual({
    asOfSeq: -1, values: { title: null, sessionListMetadata: { blank: true, lastPromptAt: null } },
  })
  expect(hints.mock.calls.some(([header]) => header.id === 'denied')).toBe(false)
  expect(ctx.sessionProjectionCache.cachedSnapshot(headers[0]!, SessionLogOffset(0))).toBeUndefined()
  expect(ctx.sessions.get(SessionId('blank'))).toBeUndefined()
  expect(open).not.toHaveBeenCalled()
  expect(await readFile(join(directory, 'blank.json'), 'utf8')).toBe(original)
})
