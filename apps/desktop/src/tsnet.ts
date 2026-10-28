/** Bundled tsnet process, private-network settings, and bounded parent-owned shutdown. */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** Domain-to-tailnet-IP mapping; HTTPS retains the original hostname and certificate validation. */
export interface DesktopTsnetRoute { readonly host: string; readonly address: string }

/** Persisted network choices; authentication keys remain in the named environment variable. */
export interface DesktopTsnetConfig {
  readonly enabled: boolean
  readonly hostname: string
  readonly controlURL: string
  readonly routes: readonly DesktopTsnetRoute[]
  readonly authKeyEnvironment?: string
}

/** User-visible state of the independently owned private-network process. */
export type DesktopTsnetState =
  | { readonly phase: 'disabled' | 'connecting' | 'needs-approval' }
  | { readonly phase: 'needs-login'; readonly loginURL: string }
  | { readonly phase: 'online'; readonly url: string }
  | { readonly phase: 'error'; readonly code: string }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tailnetAddress(value: string): boolean {
  if (isIP(value) === 4) {
    const [first, second] = value.split('.').map(Number)
    return first === 100 && second !== undefined && second >= 64 && second <= 127
  }
  return isIP(value) === 6 && /^fd7a:115c:a1e0:/iu.test(value)
}

/**
 * Read optional network configuration; absent configuration disables networking without creating files.
 * @param userData Electron user-data directory.
 * @returns Validated choices. Malformed existing settings reject without replacing them.
 */
export async function readDesktopTsnetConfig(userData: string): Promise<DesktopTsnetConfig> {
  const defaults: DesktopTsnetConfig = {
    enabled: false,
    hostname: `dsh-${hostname().toLowerCase().replace(/[^a-z0-9-]/gu, '-').slice(0, 58)}`.replace(/-+$/u, ''),
    controlURL: 'https://controlplane.tailscale.com', routes: [],
  }
  let raw: string
  try { raw = await readFile(join(userData, 'desktop', 'tailscale.json'), 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults; throw error }
  const value: unknown = JSON.parse(raw)
  if (!record(value)) throw new Error('tailscale.json must contain an object')
  const enabled = value.enabled ?? defaults.enabled
  const name = value.hostname ?? defaults.hostname
  const control = value.controlURL ?? defaults.controlURL
  if (typeof enabled !== 'boolean' || typeof name !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(name)
    || typeof control !== 'string') throw new Error('Invalid Tailscale enabled, hostname or controlURL setting')
  const url = new URL(control)
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Tailscale controlURL must use HTTPS')
  }
  const rawRoutes = value.routes ?? defaults.routes
  if (!Array.isArray(rawRoutes)) throw new Error('Tailscale routes must be an array')
  const routes: DesktopTsnetRoute[] = []
  const hosts = new Set<string>()
  for (const item of rawRoutes) {
    if (!record(item) || typeof item.host !== 'string' || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/iu.test(item.host)
      || typeof item.address !== 'string' || !tailnetAddress(item.address)) throw new Error('Invalid private-network route')
    const host = item.host.toLowerCase()
    if (hosts.has(host)) throw new Error('Duplicate private-network route')
    hosts.add(host)
    routes.push({ host, address: item.address })
  }
  const authKeyEnvironment = value.authKeyEnvironment
  if (authKeyEnvironment !== undefined && (typeof authKeyEnvironment !== 'string' || !/^[A-Z_][A-Z0-9_]*$/u.test(authKeyEnvironment))) {
    throw new Error('Invalid authentication-key environment-variable name')
  }
  return { enabled, hostname: name, controlURL: url.href, routes,
    ...(authKeyEnvironment === undefined ? {} : { authKeyEnvironment }) }
}

/**
 * Change only the activation flag, preserving user-owned network options and unrelated fields.
 * @param userData Electron user-data directory.
 * @param enabled Activation selected by the user; takes effect after restart.
 */
export async function writeDesktopTsnetEnabled(userData: string, enabled: boolean): Promise<void> {
  const current = await readDesktopTsnetConfig(userData)
  const directory = join(userData, 'desktop')
  const path = join(directory, 'tailscale.json')
  let existing: unknown = {}
  try { existing = JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  if (!record(existing)) throw new Error('Invalid Tailscale settings')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await writeFileAtomic(path, `${JSON.stringify({ ...current, ...existing, enabled }, null, 2)}\n`, { mode: 0o600 })
}

function helperEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const system = /^(?:PATH|SystemRoot|WINDIR|COMSPEC|PATHEXT|USERPROFILE|LOCALAPPDATA|APPDATA|TEMP|TMP|HOME|LANG)$/iu
  const network = /^(?:https?_proxy|all_proxy|no_proxy|SSL_CERT_FILE|SSL_CERT_DIR)$/iu
  return Object.fromEntries(Object.entries(environment).filter(([key]) => system.test(key) || network.test(key)
    || /^(?:LC_|XDG_)/iu.test(key)))
}

/** One tsnet node supplies an outbound loopback proxy and an explicitly published DSH listener. */
export class DesktopTsnet {
  private current: DesktopTsnetState = { phase: 'disabled' }
  private child: ChildProcessWithoutNullStreams | undefined
  private startup: Promise<string> | undefined
  private closed: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private target: URL | undefined
  private disposed = false
  private revision = 0
  private readonly publications = new Map<number, { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()

  /**
   * @param executable Bundled platform binary, or an explicit fixture executable for process tests.
   * @param config Validated configuration; disabled configuration starts no process.
   * @param stateDir Private, user-owned directory containing this node's Tailscale identity.
   * @param publish Receives status changes without authentication keys or DSH access tokens.
   * @param environment Original environment; only OS, trust-store and existing proxy settings reach the helper.
   * @param arguments_ Optional executable arguments used by process fixtures; production supplies none.
   */
  constructor(private readonly executable: string, private readonly config: DesktopTsnetConfig, private readonly stateDir: string,
    private readonly publish: (state: DesktopTsnetState) => void, private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly arguments_: readonly string[] = []) {}

  /** Latest helper state, independent of whether the desktop workspace is published. */
  get state(): DesktopTsnetState { return this.current }

  /** Authenticated DSH entry, available only after both Tailscale and the desktop workspace are ready. */
  get accessURL(): string | undefined {
    if (this.disposed || this.current.phase !== 'online' || this.target === undefined) return undefined
    const url = new URL(this.current.url)
    url.search = this.target.search
    return url.href
  }

  private update(state: DesktopTsnetState): void {
    this.current = state
    this.publish(state)
  }

  /**
   * Start the helper and wait only for its local proxy; interactive network login can finish later.
   * @returns Loopback HTTP proxy URL; rejects on absence, invalid protocol or bounded startup failure.
   */
  start(): Promise<string> {
    if (this.disposed) return Promise.reject(new Error('Tailscale process is closed'))
    if (!this.config.enabled) return Promise.reject(new Error('Tailscale is disabled'))
    this.startup ??= this.launch()
    return this.startup
  }

  private launch(): Promise<string> {
    this.update({ phase: 'connecting' })
    const authKey = this.config.authKeyEnvironment === undefined ? '' : this.environment[this.config.authKeyEnvironment]
    if (authKey === undefined) {
      this.update({ phase: 'error', code: 'authentication-key-unavailable' })
      return Promise.reject(new Error('Configured Tailscale authentication key is unavailable'))
    }
    const child = spawn(this.executable, [...this.arguments_], { windowsHide: true, stdio: 'pipe', env: helperEnvironment(this.environment) })
    this.child = child
    this.closed = new Promise((resolve) => { child.once('close', () => { resolve() }) })
    child.stderr.resume()
    return new Promise((resolve, reject) => {
      let ready = false
      let buffer = ''
      const timeout = setTimeout(() => { fail('startup-timeout') }, 15_000)
      const fail = (code: string): void => {
        clearTimeout(timeout)
        if (!this.disposed) this.update({ phase: 'error', code })
        if (!ready) reject(new Error(`Tailscale: ${code}`))
        child.kill()
      }
      child.once('error', () => { fail('helper-unavailable') })
      child.stdin.on('error', () => { if (!this.disposed) fail('helper-pipe-failed') })
      child.once('close', () => {
        clearTimeout(timeout)
        for (const operation of this.publications.values()) {
          clearTimeout(operation.timer)
          operation.reject(new Error('Tailscale process stopped'))
        }
        this.publications.clear()
        if (!ready) reject(new Error('Tailscale helper stopped before its proxy was ready'))
        if (!this.disposed && this.current.phase !== 'error') this.update({ phase: 'error', code: 'helper-stopped' })
      })
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        if (this.disposed) return
        buffer += chunk
        if (Buffer.byteLength(buffer) > 64 * 1024) { fail('invalid-helper-protocol'); return }
        let end: number
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end)
          buffer = buffer.slice(end + 1)
          try {
            const message: unknown = JSON.parse(line)
            if (!record(message) || message.version !== 1 || typeof message.state !== 'string') throw new Error('Invalid helper event')
            if (message.state === 'published') {
              if (typeof message.revision !== 'number') throw new Error('Invalid publication acknowledgement')
              const operation = this.publications.get(message.revision)
              if (operation === undefined) throw new Error('Unknown publication acknowledgement')
              clearTimeout(operation.timer)
              this.publications.delete(message.revision)
              operation.resolve()
            } else if (message.state === 'proxy-ready') {
              const url = new URL(String(message.proxyURL))
              if (ready || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
                || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid helper proxy')
              ready = true
              clearTimeout(timeout)
              resolve(url.origin)
            } else if (message.state === 'needs-login') {
              const url = new URL(String(message.loginURL))
              const control = new URL(this.config.controlURL)
              if (url.protocol !== 'https:' || url.username || url.password
                || !(url.origin === control.origin || (control.hostname === 'controlplane.tailscale.com' && url.hostname === 'login.tailscale.com'))) {
                throw new Error('Invalid authentication URL')
              }
              this.update({ phase: 'needs-login', loginURL: url.href })
            } else if (message.state === 'online') {
              const url = new URL(String(message.url))
              if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
                throw new Error('Invalid private URL')
              }
              this.update({ phase: 'online', url: url.href })
            } else if (message.state === 'connecting' || message.state === 'needs-approval') {
              this.update({ phase: message.state })
            } else if (message.state === 'error') fail('connection-failed')
            else throw new Error('Unknown helper state')
          } catch (_error) { fail('invalid-helper-protocol'); return }
        }
      })
      child.stdin.write(`${JSON.stringify({ stateDir: this.stateDir, hostname: this.config.hostname,
        controlURL: this.config.controlURL, routes: this.config.routes, authKey })}\n`)
      if (this.target !== undefined) void this.sendTarget().catch(() => { fail('publication-failed') })
    })
  }

  /**
   * Publish the current workspace, or withdraw it before sign-out, restart or teardown.
   * @param launchURL Host-owned authenticated URL; absence withdraws inbound access while retaining outbound networking.
   */
  publishWorkspace(launchURL?: string): Promise<void> {
    if (this.disposed) return launchURL === undefined ? Promise.resolve() : Promise.reject(new Error('Tailscale process is closed'))
    if (launchURL === undefined) this.target = undefined
    else {
      const url = new URL(launchURL)
      if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !url.port) {
        throw new Error('Tailscale can publish only the owned loopback Host')
      }
      this.target = url
    }
    return this.sendTarget()
  }

  private sendTarget(): Promise<void> {
    const target = this.target === undefined ? '' : this.target.origin
    const child = this.child
    if (child === undefined || !child.stdin.writable) return Promise.resolve()
    const revision = ++this.revision
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.publications.delete(revision)
        child.kill()
        reject(new Error('Tailscale publication timed out'))
      }, 5_000)
      this.publications.set(revision, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ target, revision })}\n`)
    })
  }

  /** Stop on stdin EOF, then force termination if the helper exceeds the bounded shutdown period. */
  close(): Promise<void> {
    this.closing ??= this.stop()
    return this.closing
  }

  private async stop(): Promise<void> {
    this.disposed = true
    this.target = undefined
    if (this.current.phase !== 'error') this.update({ phase: 'disabled' })
    const child = this.child
    if (child === undefined || this.closed === undefined) return
    child.stdin.end()
    const kill = setTimeout(() => { child.kill('SIGKILL') }, 8_000)
    let deadline: NodeJS.Timeout | undefined
    const failed = new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(() => { reject(new Error('Tailscale helper did not stop after forced termination')) }, 12_000)
    })
    try { await Promise.race([this.closed, failed]) }
    finally { clearTimeout(kill); clearTimeout(deadline) }
  }
}

/**
 * Add the private proxy to a fresh Host environment; original settings remain owned by the desktop process.
 * @param environment Original login-shell environment.
 * @param proxyURL Validated loopback proxy supplied by the bundled helper.
 * @returns Environment for Node networking and the Host's child tools.
 */
export function desktopTsnetEnvironment(environment: NodeJS.ProcessEnv, proxyURL: string): NodeJS.ProcessEnv {
  const bypass = [environment.NO_PROXY ?? environment.no_proxy ?? '', 'localhost', '127.0.0.1', '::1'].filter(Boolean).join(',')
  return { ...environment, HTTP_PROXY: proxyURL, HTTPS_PROXY: proxyURL, http_proxy: proxyURL, https_proxy: proxyURL,
    NO_PROXY: bypass, no_proxy: bypass, NODE_USE_ENV_PROXY: '1' }
}
