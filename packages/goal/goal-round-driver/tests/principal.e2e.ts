import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke, LOADER_SMOKE_TEST_TIMEOUT_MS } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

describe('authenticated goal through the production profile', () => {
  it('persists the caller on automatic input and executes an attributed model request', { timeout: LOADER_SMOKE_TEST_TIMEOUT_MS, retry: 0 }, async () => {
    const driver = fileURLToPath(new URL('./fixtures/principal-driver.ts', import.meta.url))
    const result = await runLoaderSmoke({
      label: 'goal-principal', tempDirPrefix: 'goal-principal-',
      binScript: driver, libBinScript: driver,
      configPath: fileURLToPath(new URL('./fixtures/principal.patch.yml', import.meta.url)),
      tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
      inspect: async (cwd) => {
        const root = join(cwd, '.sessions')
        const files = await readdir(root, { recursive: true })
        const logs = files.filter(file => file.endsWith('.jsonl'))
        expect(logs).toHaveLength(1)
        const lines = (await readFile(join(root, logs[0]!), 'utf8')).trim().split('\n')
        const events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
        const turns = events.flatMap(event => event.type === 'turn/start' ? [event.data] : [])
        expect(turns).toEqual([{ turn: 1, principal: { source: 'fixture', id: 'owner', username: 'Owner', role: 'user' } }])
        const inputs = events.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'goal'
          && event.data.source.round > 0 ? [event.data] : [])
        expect(inputs).toHaveLength(1)
        expect(inputs[0]?.principal).toEqual(turns[0]?.principal)
        expect(events.some(event => event.type === 'assistant/message')).toBe(true)
      },
    })
    expect(result.stdout).toContain('GOAL_PRINCIPAL_OK')
    expect(result.stderr).toBe('')
  })
})
