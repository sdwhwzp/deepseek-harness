/** Native networking actions preserve enrollment, restart and copy ownership. */

import { expect, it, vi } from 'vitest'
import { DesktopTsnetMenu } from '../src/tsnet-menu.ts'
import type { DesktopTsnetMenuOptions } from '../src/tsnet-menu.ts'
import { resolveDesktopLocale } from '../src/locale.ts'

function fixture(overrides: Partial<DesktopTsnetMenuOptions> = {}) {
  const show = vi.fn(async () => ({ response: 99, checkboxChecked: false }))
  const restart = vi.fn(async () => {})
  const copy = vi.fn(async () => {})
  const open = vi.fn(async () => {})
  const settings = vi.fn(async () => {})
  const options: DesktopTsnetMenuOptions = { locale: () => resolveDesktopLocale('en'),
    config: { enabled: false, hostname: 'dsh-test', controlURL: 'https://controlplane.tailscale.com', routes: [] },
    client: undefined, show, restart, copy, open, settings, ...overrides }
  return { menu: new DesktopTsnetMenu(options), show, restart, copy, open, settings }
}

it('closing a network dialog does not activate or restart the application', async () => {
  const f = fixture()
  await f.menu.show()
  expect(f.restart).not.toHaveBeenCalled()
  expect(f.open).not.toHaveBeenCalled()
})

it('enables networking only through the shell-owned restart operation', async () => {
  const f = fixture()
  f.show.mockResolvedValue({ response: 0, checkboxChecked: false })
  await f.menu.show()
  expect(f.restart).toHaveBeenCalledWith(true)
})

it('copies only the authenticated workspace entry after the network becomes ready', async () => {
  const f = fixture({ config: { enabled: true, hostname: 'dsh-test', controlURL: 'https://controlplane.tailscale.com', routes: [] },
    client: { state: { phase: 'online', url: 'http://100.64.0.2/' }, accessURL: 'http://100.64.0.2/?token=fixture' } })
  f.show.mockResolvedValue({ response: 0, checkboxChecked: false })
  await f.menu.show()
  expect(f.copy).toHaveBeenCalledWith('http://100.64.0.2/?token=fixture')
  expect(f.restart).not.toHaveBeenCalled()
})

it('opens the helper-validated enrollment URL only after selecting sign in', async () => {
  const f = fixture({ config: { enabled: true, hostname: 'dsh-test', controlURL: 'https://headscale.example.com', routes: [] },
    client: { state: { phase: 'needs-login', loginURL: 'https://headscale.example.com/register/fixture' }, accessURL: undefined } })
  f.show.mockResolvedValue({ response: 0, checkboxChecked: false })
  await f.menu.show()
  expect(f.open).toHaveBeenCalledWith('https://headscale.example.com/register/fixture')
  expect(f.copy).not.toHaveBeenCalled()
})
