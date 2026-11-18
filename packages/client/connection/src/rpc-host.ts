/** Host registry and HTTP adapter for generic Connection RPC channels. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm'
import type { PeerScope, Principal } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionInteractions } from './connect-protocol.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ClientRequest, RpcId as RpcIdType } from './rpc.ts'
import { clientRequestSchema } from './rpc-schema.ts'
import { bridge } from './http-bridge.ts'
import { isRemoteAuthority, isTrustedApiRequest } from './api-request-trust.ts'
import { API_PATH } from './api-path.ts'
import { Peer } from './peer.ts'
import type { ConnectionAuthentication } from './authentication.ts'
import type {
  PeerAdmission,
  ConnectionPrincipalRequest,
  ConnectionRequestAuthorization,
  ConnectionRequestRejection,
  ConnectionFetchRoute,
  ConnectionFetchHandler,
  HostConnectionFetch,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcFailure,
  ConnectionRpcHandler,
  ConnectionRpcResult,
  ConnectionTrustRequest,
  HostConnectionHandle,
  HostConnectionRpc,
} from './rpc.ts'

const INVALID_REQUEST_RPC_ID = brandString<RpcIdType>('invalid-request')
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

interface ConnectionRpcInterceptor {
  readonly matches: ConnectionRpcEndpointMatcher
  readonly fetchHandler: ConnectionFetchHandler
}

interface RegisteredFetchRoute {
  readonly methods: ReadonlySet<string>
  readonly requestBody: ConnectionFetchRoute['requestBody']
  readonly fetch: ConnectionFetchRoute['fetch']
}

interface ConnectionServerResponse {
  readonly type: 'server-response'
  readonly rpcId: RpcIdType
  readonly result: ConnectionRpcResult<unknown>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Connection transport and RPC registrations. */
    connection: HostConnectionHandle
  }
}

/** Host Connection service whose channel registrations belong to the caller fiber. */
export class HostConnectionService extends Service implements HostConnectionHandle {
  /** Connection-owned Peer for trusted in-process callers, not network authentication. */
  readonly browserPeer: PeerScope
  readonly authentication: ConnectionAuthentication
  private readonly owner: Context
  private disposed = false
  private readonly accountPeers = new Map<string, { peer: PeerScope; principal: AuthenticatedPrincipal }>()
  private readonly peerPrincipals = new WeakMap<PeerScope, AuthenticatedPrincipal>()
  private readonly interceptors = new Map<string, Set<ConnectionRpcInterceptor>>()

  private readonly fetchRoutes = new Map<string, RegisteredFetchRoute>()

  readonly allowsRemoteAuthorities: boolean

  /**
   * Provide the Host half over the active HTTP server.
   * @param ctx - owning Connection plugin context.
   * @param trustedHosts - deployment authorities accepted by the Host/Origin fence.
   */
  constructor(
    ctx: Context,
    private readonly trustedHosts: readonly string[],
  ) {
    super(ctx, 'connection')
    this.owner = ctx
    this.authentication = ctx['connection.authentication']
    this.browserPeer = new Peer(ctx, { principal: { kind: 'owner' } })
    ctx.effect(() => async () => {
      this.disposed = true
      const peers = [
        this.browserPeer,
        ...Array.from(this.accountPeers.values(), record => record.peer),
      ]
      this.accountPeers.clear()
      await Promise.all(peers.map(peer => peer.dispose()))
    }, 'client-connection: Peer scopes')
    this.allowsRemoteAuthorities = trustedHosts.some(isRemoteAuthority)
    ctx.on('webserver/authorize', (request, policy) => {
      const facts = { ...request, url: request.url.href }
      if (!this.isTrustedRequest(facts)) return { kind: 'deny', status: 403 }
      if (policy === 'anonymous') return { kind: 'allow' }
      const admission = this.authentication.authenticate(facts)
      return 'rejection' in admission
        ? { kind: 'deny', status: admission.rejection }
        : { kind: 'allow', peer: admission.peer }
    })
  }

  /** Generic channel registry scoped to the Context reading this service. */
  get rpc(): HostConnectionRpc {
    const owner = this.ctx
    return {
      handle: (channel, handler) => this.register(owner, channel, handler),
      intercept: (channel, matches, handler) =>
        this.registerInterceptor(owner, channel, matches, handler),
    }
  }

  /** Exact Fetch-route registry scoped to the Context reading this service. */
  get fetch(): HostConnectionFetch {
    const owner = this.ctx
    return {
      register: route => this.registerFetchRoute(owner, route),
    }
  }

  /** Apply the Host/Origin fence and require an authenticated live Peer. */
  requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection {
    const admission = this.admit(request)
    return 'rejection' in admission ? admission.rejection : undefined
  }

  /** Apply request trust and accept deployment or browser authentication. */
  async authorizeRequest(request: ConnectionPrincipalRequest): Promise<ConnectionRequestAuthorization> {
    const admission = await this.admitRequest(request)
    if ('rejection' in admission) return { accepted: false, status: admission.rejection }
    return admission.principal === undefined ? { accepted: true } : { accepted: true, principal: admission.principal }
  }

  /** Validate and detach the optional deployment-owned identity for one carrier request. */
  async authenticateRequest(
    request: ConnectionPrincipalRequest,
  ): Promise<AuthenticatedPrincipal | undefined> {
    const provider = this.ctx.get('requestPrincipal')
    if (provider === undefined) return undefined
    const principal = await provider.authenticate(request)
    return principal === undefined ? undefined : authenticatedPrincipal(principal)
  }

  /**
   * Authenticate a carrier request and isolate its deployment account scope.
   * @param request - HTTP or WebSocket upgrade request.
   * @param carrier - WebServer-authenticated Peer for the physical transport.
   * @returns the admitted Peer and principal, or a rejection status.
   */
  async admitRequest(request: ConnectionPrincipalRequest, carrier?: PeerScope): Promise<PeerAdmission> {
    if (!this.isTrustedRequest(request)) return { rejection: 403 }
    const live = (): boolean =>
      !this.disposed && !carrier?.signal.aborted && !request.signal?.aborted && !request.socket?.destroyed
    if (!live()) return { rejection: 401 }
    const provider = this.ctx.get('requestPrincipal')
    const fallback = (): PeerAdmission => carrier === undefined ? this.admit(request) : { peer: carrier }
    if (provider === undefined) return fallback()
    let principal: AuthenticatedPrincipal | undefined
    try {
      principal = await this.authenticateRequest(request)
    } catch (_authenticationFailure) {
      return { rejection: 401 }
    }
    if (!live() || this.ctx.get('requestPrincipal') !== provider) return { rejection: 401 }
    if (principal === undefined) return fallback()
    return { peer: this.peerForPrincipal(principal, carrier ?? this.browserPeer), principal }
  }

  /**
   * Read the identity verified for a deployment account's Peer.
   * @param peer - Peer owned by this Connection.
   * @returns its immutable principal, or undefined for a local operator.
   */
  principalOfPeer(peer: PeerScope): AuthenticatedPrincipal | undefined {
    return this.peerPrincipals.get(peer)
  }

  private peerForPrincipal(principal: AuthenticatedPrincipal, carrier: PeerScope): PeerScope {
    const key = JSON.stringify([carrier.id, principal.source, principal.id, principal.username, principal.role])
    const known = this.accountPeers.get(key)
    if (known !== undefined) return known.peer
    const peer = new Peer(carrier.ctx, { principal: carrier.principal, interactions: carrier.interactions })
    this.accountPeers.set(key, { peer, principal })
    this.peerPrincipals.set(peer, principal)
    peer.ctx.effect(() => () => { this.accountPeers.delete(key) }, 'client-connection: account Peer')
    return peer
  }

  /** Apply the carrier source policy and accept the first successful provider. */
  admit(request: ConnectionTrustRequest): PeerAdmission {
    if (!this.isTrustedRequest(request)) return { rejection: 403 }
    if (this.disposed) return { rejection: 401 }
    return this.owner['connection.authentication'].authenticate(request)
  }

  /** Create one in-process Peer owned by the Context that read this service. */
  createPeer(options: {
    readonly principal: Principal
    readonly interactions?: ConnectionInteractions
  }): PeerScope {
    if (this.disposed) throw new Error('connection: cannot create a Peer after disposal')
    return new Peer(this.ctx, options)
  }

  /** Check the deployment's request-source policy without credential verification. */
  private isTrustedRequest(request: ConnectionTrustRequest): boolean {
    const carrier = this.owner.get('webServer')
    return isTrustedApiRequest(request, this.trustedHosts, carrier?.host, carrier?.protocol ?? 'http:')
  }

  /**
   * Compose one shared-channel Fetch handler from exact routes and its interceptor.
   * @param channel - shared channel mounted by Connection.
   * @returns Fetch handler that selects one owner or returns 404.
   */
  createSharedFetchHandler(
    channel: '/api',
  ): ConnectionFetchHandler {
    return {
      requestBodyMode: ({ method, url }) => {
        const route = this.fetchRoutes.get(url.pathname)
        return route?.methods.has(method) === true ? route.requestBody : 'buffered'
      },
      fetch: async (request, peer) => {
        const pathname = new URL(request.url).pathname
        const route = this.fetchRoutes.get(pathname)
        if (route?.methods.has(request.method) === true) {
          // Exact routes bypass Gateway access checks, so only the owner reaches them.
          // oxlint-disable-next-line typescript/no-unnecessary-condition -- other packages merge non-owner kinds into PrincipalMap.
          if (peer.principal.kind !== 'owner') return Promise.resolve(new Response('forbidden', { status: 403 }))
          return route.fetch(request, this.principalOfPeer(peer), peer)
        }
        const endpoint = endpointFromPath(channel, pathname)
        const registered = this.interceptors.get(channel)
        if (endpoint === undefined || registered === undefined) {
          return new Response('not found', { status: 404 })
        }
        let interceptor: ConnectionRpcInterceptor | undefined
        for (const candidate of registered) {
          if (!candidate.matches(endpoint)) continue
          if (interceptor !== undefined) {
            return new Response(
              `connection: shared RPC endpoint ${JSON.stringify(endpoint)} has multiple interceptors`,
              { status: 500 },
            )
          }
          interceptor = candidate
        }
        if (interceptor === undefined) return new Response('not found', { status: 404 })
        return interceptor.fetchHandler.fetch(request, peer)
      },
    }
  }

  private registerFetchRoute(
    owner: Context,
    route: ConnectionFetchRoute,
  ): () => Promise<void> {
    assertFetchRoute(route)
    const registered: RegisteredFetchRoute = {
      methods: new Set(route.methods),
      requestBody: route.requestBody,
      fetch: route.fetch,
    }
    return owner.effect(() => {
      if (this.fetchRoutes.has(route.path)) {
        throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} is already registered`)
      }
      this.fetchRoutes.set(route.path, registered)
      return () => { this.fetchRoutes.delete(route.path) }
    }, `client-connection: ${route.path} Fetch route`)
  }

  private register(
    owner: Context,
    channel: string,
    handler: ConnectionRpcHandler,
  ): () => Promise<void> {
    assertChannel(channel)
    const fetchHandler = rpcFetchHandler(channel, handler)
    const route: WebRoute = {
      kind: 'prefix',
      path: channel,
      auth: 'required',
      handler: async (req, res, peer) => {
        const admission = peer === undefined || res.destroyed ? undefined : await this.admitRequest(req, peer)
        if (admission === undefined || res.destroyed) return
        if ('rejection' in admission) {
          res.writeHead(admission.rejection, { 'Cache-Control': 'no-store' })
          res.end()
          return
        }
        await bridge(req, res, fetchHandler, admission.peer)
      },
    }
    return owner.effect(() => {
      const webServer = owner.get('webServer')
      if (webServer === undefined) throw new Error('connection: RPC channels require a Web server')
      return webServer.register(route)
    }, `client-connection: ${channel} rpc channel`)
  }

  private registerInterceptor(
    owner: Context,
    channel: string,
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
  ): () => Promise<void> {
    if (channel !== API_PATH) {
      throw new Error(`connection: invalid shared RPC channel ${JSON.stringify(channel)}`)
    }
    const interceptor: ConnectionRpcInterceptor = {
      matches,
      fetchHandler: rpcFetchHandler(channel, handler),
    }
    return owner.effect(() => {
      const registered = this.interceptors.get(channel) ?? new Set<ConnectionRpcInterceptor>()
      registered.add(interceptor)
      this.interceptors.set(channel, registered)
      return () => {
        registered.delete(interceptor)
        if (registered.size === 0) this.interceptors.delete(channel)
      }
    }, `client-connection: ${channel} rpc interceptor`)
  }
}

function rpcFetchHandler(
  channel: string,
  handler: ConnectionRpcHandler,
): ConnectionFetchHandler {
  return {
    requestBodyMode: () => 'buffered',
    async fetch(request: Request, peer: PeerScope): Promise<Response> {
      const endpoint = endpointFromPath(channel, new URL(request.url).pathname)
      if (request.method !== 'POST' || endpoint === undefined) {
        return new Response('not found', { status: 404 })
      }

      const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }

      const envelope = clientRequestSchema.safeParse(body)
      if (!envelope.success) {
        return invalidEnvelopeResponse(body, envelope.error.issues)
      }
      const message: ClientRequest = envelope.data
      if (message.method !== endpoint) {
        return errorResponse(message.rpcId, {
          code: 'gateway/bad-request',
          message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
          details: { issues: [] },
        })
      }

      try {
        const result = await handler(endpoint, message.payload, request.signal, peer)
        return fullResponse(message.rpcId, result)
      } catch (error) {
        return new Response(`handler failure: ${String(error)}`, { status: 500 })
      }
    },
  }
}

/** Validate, detach, and freeze one authentication-provider result. */
function authenticatedPrincipal(value: unknown): AuthenticatedPrincipal {
  if (value === null || typeof value !== 'object') throw new Error('authenticated principal must be an object')
  const candidate = value as Record<string, unknown>
  if (!nonEmpty(candidate.source, 64)) throw new Error('authenticated principal source is invalid')
  if (!nonEmpty(candidate.id, 256)) throw new Error('authenticated principal id is invalid')
  if (!nonEmpty(candidate.username, 256)) throw new Error('authenticated principal username is invalid')
  if (candidate.role !== 'admin' && candidate.role !== 'user') throw new Error('authenticated principal role is invalid')
  return Object.freeze({
    source: candidate.source,
    id: candidate.id,
    username: candidate.username,
    role: candidate.role,
  })
}

function nonEmpty(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function invalidEnvelopeResponse(body: unknown, issues: readonly object[]): Response {
  const rawId = (body as { rpcId?: unknown } | null)?.rpcId
  const rpcId = typeof rawId === 'string' ? brandString<RpcIdType>(rawId) : INVALID_REQUEST_RPC_ID
  return errorResponse(rpcId, {
    code: 'gateway/bad-request',
    message: 'invalid client-request message',
    details: { issues },
  })
}

function endpointFromPath(channel: string, pathname: string): string | undefined {
  if (!pathname.startsWith(`${channel}/`)) return undefined
  const endpoint = pathname.slice(channel.length + 1)
  const segments = endpoint.split('/')
  if (segments.some(segment =>
    segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    return undefined
  }
  return endpoint
}

function errorResponse(rpcId: RpcIdType, error: ConnectionRpcFailure): Response {
  return fullResponse(rpcId, { ok: false, error })
}

function fullResponse(rpcId: RpcIdType, result: Awaited<ReturnType<ConnectionRpcHandler>>): Response {
  if (!result.ok) {
    const body: ConnectionServerResponse = { type: 'server-response', rpcId, result }
    return Response.json(body)
  }
  const { attachments, ...success } = result
  const body: ConnectionServerResponse = { type: 'server-response', rpcId, result: success }
  if (attachments === undefined || attachments.length === 0) return Response.json(body)
  const parts = new FormData()
  const attachmentMetadata = attachments.map((attachment, index) => {
    const part = `bytes-${index}`
    // FileSystem bytes may have SharedArrayBuffer backing, which BlobPart excludes.
    parts.set(part, new Blob([new Uint8Array(attachment.bytes)]))
    return { path: [...attachment.path], codec: 'bytes' as const, part }
  })
  parts.set('metadata', JSON.stringify({ ...body, attachments: attachmentMetadata }))
  return new Response(parts)
}

function assertChannel(channel: string): void {
  if (!CHANNEL_PATTERN.test(channel) || channel === '/api') {
    throw new Error(`connection: invalid or reserved RPC channel ${JSON.stringify(channel)}`)
  }
}

function assertFetchRoute(route: ConnectionFetchRoute): void {
  if (endpointFromPath(API_PATH, route.path) === undefined) {
    throw new Error(`connection: invalid exact Fetch route ${JSON.stringify(route.path)}`)
  }
  if (route.methods.length === 0) {
    throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} declares no methods`)
  }
  const methods = new Set(route.methods)
  if (methods.size !== route.methods.length) {
    throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} repeats a method`)
  }
}
