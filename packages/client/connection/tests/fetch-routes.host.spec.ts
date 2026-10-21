import { Context } from '@deepseek-ai/cordis'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm'
import type { PeerScope, Principal } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { BrowserAuth } from '../src/browser-auth.ts'
import { HostConnectionService } from '../src/rpc-host.ts'
import type { RequestPrincipalProvider } from '../src/rpc.ts'

async function mounted(provider?: RequestPrincipalProvider): Promise<{
  readonly connection: HostConnectionService
  readonly dispose: () => Promise<void>
}> {
  const ctx = new Context()
  if (provider !== undefined) ctx.provide('requestPrincipal', provider)
  const fiber = ctx.plugin((pluginCtx) => {
    new HostConnectionService(pluginCtx, [], {} as BrowserAuth)
  })
  await fiber.await()
  return {
    connection: ctx.get('connection') as HostConnectionService,
    dispose: () => fiber.dispose(),
  }
}

const GUEST: Principal = { kind: 'test-guest', guest: 'connection' }

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    /** Test-only non-owner caller shared by the access specs. */
    'test-guest': { readonly kind: 'test-guest'; readonly guest: string }
  }
}

describe('Connection exact Fetch routes', () => {
  it('refuses a principal whose authentication completes after Connection disposal', async () => {
    const identity = Promise.withResolvers<AuthenticatedPrincipal>()
    const entered = Promise.withResolvers<undefined>()
    const { connection, dispose } = await mounted({ authenticate: () => { entered.resolve(undefined); return identity.promise } })
    onTestFinished(dispose)
    const pending = connection.admitRequest({ method: 'GET', url: '/api', headers: { host: 'localhost' } })
    await entered.promise
    await dispose()
    identity.resolve({ source: 'gateway', id: 'alice', username: 'Alice', role: 'user' })
    await expect(pending).resolves.toEqual({ rejection: 401 })
  })

  it('isolates account scopes and replaces the scope when verified privileges change', async () => {
    let identity: AuthenticatedPrincipal = { source: 'gateway', id: 'alice', username: 'Alice', role: 'user' }
    const { connection, dispose } = await mounted({ authenticate: () => identity })
    onTestFinished(dispose)
    const request = { method: 'GET', url: '/api', headers: { host: 'localhost' } }
    const alice = await connection.admitRequest(request)
    const repeated = await connection.admitRequest(request)
    identity = { ...identity, id: 'bob', username: 'Bob' }
    const bob = await connection.admitRequest(request)
    identity = { source: 'gateway', id: 'alice', username: 'Alice', role: 'admin' }
    const elevated = await connection.admitRequest(request)
    if ('rejection' in alice || 'rejection' in repeated || 'rejection' in bob || 'rejection' in elevated) {
      throw new Error('fixture authentication did not admit the accounts')
    }
    expect(repeated.peer).toBe(alice.peer)
    expect(alice.peer).not.toBe(connection.browserPeer)
    expect(bob.peer).not.toBe(alice.peer)
    expect(elevated.peer).not.toBe(alice.peer)
    expect(connection.principalOfPeer(alice.peer)).toMatchObject({ id: 'alice', role: 'user' })
    expect(connection.principalOfPeer(bob.peer)).toMatchObject({ id: 'bob', role: 'user' })
    expect(connection.principalOfPeer(elevated.peer)).toEqual(identity)
  })

  it('dispatches owned methods and returns 404 for unclaimed requests', async () => {
    const { connection, dispose: disposeFiber } = await mounted()
    const route = vi.fn(async (request: Request) =>
      Response.json({ query: new URL(request.url).searchParams.get('sessionId') }))
    const dispose = connection.fetch.register({
      path: '/api/session.export',
      methods: ['GET', 'HEAD', 'POST'],
      requestBody: 'streaming',
      fetch: route,
    })
    const shared = connection.createSharedFetchHandler('/api')

    const response = await shared.fetch(new Request(
      'http://host/api/session.export?sessionId=session-1',
    ), connection.browserPeer)
    expect(shared.requestBodyMode({
      method: 'POST', url: new URL('http://host/api/session.export'),
    })).toBe('streaming')
    expect(shared.requestBodyMode({
      method: 'DELETE', url: new URL('http://host/api/session.export'),
    })).toBe('buffered')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ query: 'session-1' })
    expect(route).toHaveBeenCalledOnce()
    const post = await shared.fetch(new Request('http://host/api/session.export', { method: 'POST' }), connection.browserPeer)
    expect(post.status).toBe(200)
    expect(route).toHaveBeenCalledTimes(2)

    await dispose()
    const withdrawn = await shared.fetch(new Request('http://host/api/session.export'), connection.browserPeer)
    expect(withdrawn.status).toBe(404)
    await disposeFiber()
  })

  it('rejects invalid and duplicate registrations', async () => {
    const { connection, dispose: disposeFiber } = await mounted()
    const fetch = async (): Promise<Response> => new Response()

    expect(() => connection.fetch.register({ path: '/outside', methods: ['GET'], requestBody: 'buffered', fetch }))
      .toThrow('invalid exact Fetch route')
    expect(() => connection.fetch.register({ path: '/api/session.export', methods: [], requestBody: 'buffered', fetch }))
      .toThrow('declares no methods')
    expect(() => connection.fetch.register({
      path: '/api/session.export', methods: ['GET', 'GET'], fetch,
      requestBody: 'buffered',
    })).toThrow('repeats a method')
    const dispose = connection.fetch.register({
      path: '/api/session.export', methods: ['GET'], fetch,
      requestBody: 'buffered',
    })
    expect(() => connection.fetch.register({
      path: '/api/session.export', methods: ['HEAD'], fetch,
      requestBody: 'buffered',
    })).toThrow('already registered')
    await dispose()
    expect(() => connection.fetch.register({
      path: '/api/session.export', methods: ['HEAD'], fetch,
      requestBody: 'buffered',
    })).not.toThrow()
    await disposeFiber()
  })

  it('authenticates exact Fetch routes and passes a detached frozen principal', async () => {
    const supplied = {
      source: 'gateway', id: 'alice', username: 'Alice', role: 'user', extra: 'ignored',
    }
    const provider = vi.fn(() => supplied as AuthenticatedPrincipal)
    const { connection, dispose } = await mounted({ authenticate: provider })
    let received: AuthenticatedPrincipal | undefined
    const route = vi.fn(async (_request: Request, principal: AuthenticatedPrincipal | undefined) => {
      received = principal
      return new Response('ok')
    })
    connection.fetch.register({
      path: '/api/session.export', methods: ['GET'], requestBody: 'buffered', fetch: route,
    })

    const admission = await connection.admitRequest({ method: 'GET', url: '/api/session.export', headers: { host: 'localhost', 'x-principal': 'alice' } })
    if ('rejection' in admission) throw new Error('fixture account was refused')
    const response = await connection.createSharedFetchHandler('/api').fetch(
      new Request('http://localhost/api/session.export', { headers: { 'x-principal': 'alice' } }), admission.peer,
    )
    expect(response.status).toBe(200)
    expect(provider).toHaveBeenCalledOnce()
    expect(received).toEqual({
      source: 'gateway', id: 'alice', username: 'Alice', role: 'user',
    })
    expect(received).not.toBe(supplied)
    expect(Object.isFrozen(received)).toBe(true)

    await dispose()
  })

  it('returns 401 before selecting an exact route when principal authentication fails', async () => {
    const { connection, dispose } = await mounted({
      authenticate: () => { throw new Error('signature rejected') },
    })
    const route = vi.fn(async () => new Response('leaked'))
    connection.fetch.register({
      path: '/api/session.export', methods: ['GET'], requestBody: 'buffered', fetch: route,
    })

    const admission = await connection.admitRequest({ method: 'GET', url: '/api/session.export', headers: { host: 'localhost' } })
    expect(admission).toEqual({ rejection: 401 })
    expect(route).not.toHaveBeenCalled()

    await dispose()
  })
  it('refuses exact routes to non-owner Peers while the RPC interceptor still receives them', async () => {
    const { connection, dispose: disposeFiber } = await mounted()
    const route = vi.fn(async () => new Response('route'))
    const disposeRoute = connection.fetch.register({
      path: '/api/session.export', methods: ['GET'], requestBody: 'buffered', fetch: route,
    })
    const peers: PeerScope[] = []
    const disposeInterceptor = connection.rpc.intercept('/api', () => true, async (_endpoint, _payload, _signal, peer) => {
      peers.push(peer)
      return { ok: true, value: null }
    })
    const guest = connection.createPeer({ principal: GUEST })
    const shared = connection.createSharedFetchHandler('/api')

    const refused = await shared.fetch(new Request('http://host/api/session.export'), guest)
    expect(refused.status).toBe(403)
    expect(route).not.toHaveBeenCalled()
    expect((await shared.fetch(new Request('http://host/api/session.export'), connection.browserPeer)).status).toBe(200)

    const rpc = await shared.fetch(new Request('http://host/api/goals/get', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-1', method: 'goals/get', payload: { args: {} } }),
    }), guest)
    expect(rpc.status).toBe(200)
    expect(peers).toEqual([guest])
    await disposeInterceptor()
    await disposeRoute()
    await disposeFiber()
  })
})

describe('Connection in-process Peers', () => {
  it('creates independent Peers that keep their principal and leave with the reading Context', async () => {
    const { connection, dispose } = await mounted()
    const first = connection.createPeer({ principal: GUEST })
    const second = connection.createPeer({ principal: GUEST })
    const owner = connection.createPeer({ principal: { kind: 'owner' } })
    expect(new Set([first.id, second.id, owner.id, connection.browserPeer.id]).size).toBe(4)
    expect(first.principal).toBe(GUEST)
    expect(owner.principal).toEqual({ kind: 'owner' })
    expect(first.ctx).not.toBe(second.ctx)

    const released = vi.fn()
    first.ctx.effect(() => released, 'first Peer registration')
    await first.dispose()
    expect(released).toHaveBeenCalledOnce()
    expect(() => first.ctx.effect(() => () => {})).toThrow()
    // Disposing one Peer leaves the others usable.
    expect(() => second.ctx.effect(() => () => {})()).not.toThrow()

    await dispose()
  })

  it('disposes a created Peer with the plugin that read the Connection', async () => {
    const ctx = new Context()
    const provider = ctx.plugin((pluginCtx) => { new HostConnectionService(pluginCtx, [], {} as BrowserAuth) })
    await provider.await()
    let created: PeerScope | undefined
    const consumer = ctx.plugin({
      inject: ['connection'],
      apply: (consumerCtx: Context) => { created = consumerCtx.connection.createPeer({ principal: GUEST }) },
    })
    await consumer.await()
    const lingering = vi.fn()
    created!.ctx.effect(() => lingering, 'consumer Peer registration')
    await consumer.dispose()
    expect(lingering).toHaveBeenCalledOnce()
    expect(() => created!.ctx.effect(() => () => {})).toThrow()
    await provider.dispose()
  })
})
