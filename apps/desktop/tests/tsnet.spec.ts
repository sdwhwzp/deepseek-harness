/** Configuration preservation and real child-process protocol without enrolling a network node. */

import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { DesktopTsnet, desktopTsnetEnvironment, readDesktopTsnetConfig, writeDesktopTsnetEnabled } from '../src/tsnet.ts'
import type { DesktopTsnetConfig, DesktopTsnetState } from '../src/tsnet.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tsnet-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  await mkdir(join(root, 'desktop'))
  return { root, path: join(root, 'desktop/tailscale.json') }
}

const config: DesktopTsnetConfig = {
  enabled: true, hostname: 'dsh-test', controlURL: 'https://controlplane.tailscale.com', routes: [],
}

it('keeps an absent configuration disabled and preserves custom Headscale routes when toggled', async () => {
  const { root, path } = await fixture()
  expect((await readDesktopTsnetConfig(root)).enabled).toBe(false)
  await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  await writeFile(path, JSON.stringify({ enabled: false, controlURL: 'https://headscale.example.com', custom: 'retained',
    routes: [{ host: 'gr.gr-iot.cn', address: '100.64.0.6' }] }))
  await writeDesktopTsnetEnabled(root, true)
  expect(await readDesktopTsnetConfig(root)).toMatchObject({ enabled: true, controlURL: 'https://headscale.example.com/',
    routes: [{ host: 'gr.gr-iot.cn', address: '100.64.0.6' }] })
  expect(JSON.parse(await readFile(path, 'utf8'))).toHaveProperty('custom', 'retained')
})

it.each([
  { controlURL: 'http://headscale.example.com' },
  { controlURL: 'https://user:password@example.com' },
  { routes: [{ host: 'gr.gr-iot.cn', address: '127.0.0.1' }] },
  { routes: [{ host: 'same.example.com', address: '100.64.0.1' }, { host: 'same.example.com', address: '100.64.0.2' }] },
  { authKeyEnvironment: 'not a variable' },
])('rejects invalid settings without replacing them: %j', async (value) => {
  const { root, path } = await fixture()
  const raw = JSON.stringify(value)
  await writeFile(path, raw)
  await expect(writeDesktopTsnetEnabled(root, true)).rejects.toThrow()
  expect(await readFile(path, 'utf8')).toBe(raw)
})

it('carries secrets only in stdin, acknowledges withdrawal, and stops its real child on EOF', async () => {
  const { root } = await fixture()
  const capture = join(root, 'capture.json')
  const states: DesktopTsnetState[] = []
  const client = new DesktopTsnet(process.execPath, { ...config, authKeyEnvironment: 'TEST_AUTH_KEY' }, join(root, 'state'),
    (state) => { states.push(state) }, { ...process.env, TEST_AUTH_KEY: 'fixture-key', TS_AUTHKEY: 'ambient-key',
      DEEPSEEK_API_KEY: 'model-key' }, [join(import.meta.dirname, 'fixtures/tsnet-helper.mjs'), 'online', capture])
  onTestFinished(async () => { await client.close() })
  expect(await client.start()).toBe('http://127.0.0.1:54321')
  await vi.waitFor(() => { expect(client.state.phase).toBe('online') })
  await client.publishWorkspace('http://127.0.0.1:3080/?token=owner-token')
  expect(client.accessURL).toBe('http://100.64.0.2/?token=owner-token')
  await client.publishWorkspace()
  expect(client.accessURL).toBeUndefined()
  const input = JSON.parse(await readFile(capture, 'utf8')) as {
    config: { authKey: string }
    pid: number
    inheritedAuthKey?: string
    inheritedModelKey?: string
  }
  expect(input.config.authKey).toBe('fixture-key')
  expect(input.inheritedAuthKey).toBeUndefined()
  expect(input.inheritedModelKey).toBeUndefined()
  expect(JSON.stringify(states)).not.toContain('owner-token')
  expect(JSON.stringify(states)).not.toContain('fixture-key')
  await client.close()
  expect(() => process.kill(input.pid, 0)).toThrow()
})

it.each(['malformed', 'bad-login'])('contains an invalid helper event: %s', async (mode) => {
  const { root } = await fixture()
  const client = new DesktopTsnet(process.execPath, config, join(root, 'state'), () => {}, process.env,
    [join(import.meta.dirname, 'fixtures/tsnet-helper.mjs'), mode, join(root, 'capture.json')])
  onTestFinished(async () => { await client.close() })
  await client.start().catch(() => undefined)
  await vi.waitFor(() => { expect(client.state).toEqual({ phase: 'error', code: 'invalid-helper-protocol' }) })
})

it('keeps local backend requests outside the proxy and opts fresh Node processes into HTTP proxy support', () => {
  const original = { HTTPS_PROXY: 'http://existing-proxy:8080', NO_PROXY: 'example.org' }
  expect(desktopTsnetEnvironment(original, 'http://127.0.0.1:54321')).toMatchObject({
    HTTP_PROXY: 'http://127.0.0.1:54321', HTTPS_PROXY: 'http://127.0.0.1:54321',
    NO_PROXY: 'example.org,localhost,127.0.0.1,::1', NODE_USE_ENV_PROXY: '1',
  })
  expect(original.HTTPS_PROXY).toBe('http://existing-proxy:8080')
})
