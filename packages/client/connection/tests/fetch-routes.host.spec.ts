import { Context } from '@deepseek-ai/cordis'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
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

describe('Connection exact Fetch routes', () => {
  it('dispatches owned methods and returns 404 for unclaimed requests', async () => {
    const { connection, dispose: disposeFiber } = await mounted()
    const route = vi.fn(async (request: Request) =>
      Response.json({ query: new URL(request.url).searchParams.get('sessionId') }))
    const dispose = connection.fetch.register({
      path: '/api/session.export',
      methods: ['GET', 'HEAD'],
      fetch: route,
    })
    const shared = connection.createSharedFetchHandler('/api')

    const response = await shared.fetch(new Request(
      'http://host/api/session.export?sessionId=session-1',
    ))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ query: 'session-1' })
    expect(route).toHaveBeenCalledOnce()
    const post = await shared.fetch(new Request('http://host/api/session.export', { method: 'POST' }))
    expect(post.status).toBe(404)

    await dispose()
    const withdrawn = await shared.fetch(new Request('http://host/api/session.export'))
    expect(withdrawn.status).toBe(404)
    await disposeFiber()
  })

  it('rejects invalid and duplicate registrations', async () => {
    const { connection, dispose: disposeFiber } = await mounted()
    const fetch = async (): Promise<Response> => new Response()

    expect(() => connection.fetch.register({ path: '/outside', methods: ['GET'], fetch }))
      .toThrow('invalid exact Fetch route')
    expect(() => connection.fetch.register({ path: '/api/session.export', methods: [], fetch }))
      .toThrow('declares no methods')
    expect(() => connection.fetch.register({
      path: '/api/session.export', methods: ['GET', 'GET'], fetch,
    })).toThrow('repeats a method')
    const dispose = connection.fetch.register({
      path: '/api/session.export', methods: ['GET'], fetch,
    })
    expect(() => connection.fetch.register({
      path: '/api/session.export', methods: ['HEAD'], fetch,
    })).toThrow('already registered')
    await dispose()
    expect(() => connection.fetch.register({
      path: '/api/session.export', methods: ['HEAD'], fetch,
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
      path: '/api/session.export', methods: ['GET'], fetch: route,
    })

    const response = await connection.createSharedFetchHandler('/api').fetch(
      new Request('http://host/api/session.export', { headers: { 'x-principal': 'alice' } }),
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
    connection.fetch.register({ path: '/api/session.export', methods: ['GET'], fetch: route })

    const response = await connection.createSharedFetchHandler('/api').fetch(
      new Request('http://host/api/session.export'),
    )
    expect(response.status).toBe(401)
    expect(route).not.toHaveBeenCalled()

    await dispose()
  })
})
