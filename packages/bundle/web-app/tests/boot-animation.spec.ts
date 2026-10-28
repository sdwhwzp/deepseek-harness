/** Startup-video injection and byte ranges through the real Loader and HTTP server. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import WebServer from '@deepseek-ai/dsh-host-webserver'

it.each([true, false])('serves bundled startup videos with animation enabled: %s', async (enabled) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-boot-animation-'))
  const ctx = new Context()
  onTestFinished(async () => {
    try { await ctx.fiber.dispose() }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
  const config = join(directory, 'cordis.yml')
  await writeFile(config, [
    '- id: webserver',
    '  name: cordis:test-webserver',
    '  config:',
    '    host: 127.0.0.1',
    '    port: 0',
    '- id: boot-animation',
    `  name: ${JSON.stringify(import.meta.resolve('dsh-boot-animation'))}`,
    '  config:',
    `    enabled: ${String(enabled)}`,
    '',
  ].join('\n'))
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins['test-webserver'] = WebServer
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()

  const peer = { principal: { kind: 'owner' } } as Parameters<WebServer['renderIndex']>[1]
  const html = ctx.webServer.renderIndex('<head><script type="module" src="/shell.js"></script></head><body></body>', peer)
  expect(html.includes('__DSH_BOOT_ANIM_CFG__')).toBe(enabled)
  if (enabled) expect(html.indexOf('__DSH_BOOT_ANIM_CFG__')).toBeLessThan(html.indexOf('src="/shell.js"'))

  const origin = ctx.webServer.getOrigin()
  const manifest = await fetch(new URL('/plugins/dsh-boot-animation/clips.json', origin))
  expect(manifest.status).toBe(200)
  const { clips } = await manifest.json() as { clips: { src: string; bytes: number; enabled: boolean }[] }
  expect(clips.length).toBeGreaterThan(0)
  const clip = clips[0]!
  const response = await fetch(new URL(clip.src, origin), { headers: { range: 'bytes=0-31' } })
  expect(response.status).toBe(206)
  expect(response.headers.get('content-range')).toBe(`bytes 0-31/${String(clip.bytes)}`)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect((await response.arrayBuffer()).byteLength).toBe(32)
})
