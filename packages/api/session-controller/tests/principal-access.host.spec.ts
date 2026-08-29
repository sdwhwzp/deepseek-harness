import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { createUserMessage, type AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm'
import {
  PrincipalAccessDeniedError,
  PrincipalAccessService,
  type PrincipalAccessResult,
  type PrincipalAccessSubjects,
} from '@deepseek-ai/dsh-principal-access'
import SessionStore, { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import {
  SessionQueryEngine,
  type SessionSearchRequest,
} from '@deepseek-ai/dsh-session-query'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import { createSessionTestController } from './test-remote.ts'

const defaults = {
  defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
  cwd: '/tmp',
}

const principal: AuthenticatedPrincipal = {
  source: 'fixture-auth',
  id: 'subject-1',
  username: 'display-only',
  role: 'admin',
}

function header(id: string): SessionHeader {
  return { version: 0, id: SessionId(id), createdAt: 1, cwd: '/workspace' }
}

class SearchQuery extends SessionQueryEngine {
  override searchSessions(
    request: SessionSearchRequest,
  ): ReturnType<SessionQueryEngine['searchSessions']> {
    const query = request.query
    return Promise.resolve({
      items: this.ctx.sessions.list().map((session, index) => ({
        header: session.header,
        live: true,
        persisted: false,
        bestMatch: {
          sessionId: session.id,
          seq: index,
          type: 'user/message' as const,
          time: index,
          surface: 'current' as const,
          snippet: `${query}:${session.id}`,
        },
      })),
    })
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('event search is not configured in this test'))
  }
}

class AllowListPrincipalAccess extends PrincipalAccessService {
  readonly resolveCall = vi.fn((
    _principal: AuthenticatedPrincipal,
    subjects: PrincipalAccessSubjects,
    _signal?: AbortSignal,
  ): Promise<PrincipalAccessResult> => Promise.resolve({
    readableSessionIds: new Set(
      (subjects.sessionIds ?? []).filter(sessionId => this.allowed.has(sessionId)),
    ),
    readableWorkspaceIds: new Set(),
  }))

  constructor(ctx: Context, private readonly allowed: ReadonlySet<SessionId>) {
    super(ctx)
  }

  resolve(
    candidate: AuthenticatedPrincipal,
    subjects: PrincipalAccessSubjects,
    signal?: AbortSignal,
  ): Promise<PrincipalAccessResult> {
    return this.resolveCall(candidate, subjects, signal)
  }
}

async function baseContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  return ctx
}

function installPrincipal(ctx: Context, value: AuthenticatedPrincipal | undefined): void {
  ctx.provide('typertGateway', { currentPrincipal: () => value } as never)
}

describe('Session Controller principal access', () => {
  it.each([
    { name: 'authenticated request without provider', withProvider: false, reason: 'provider-required' },
    { name: 'provider without authenticated request', withProvider: true, reason: 'principal-required' },
  ] as const)('fails closed for $name', async ({ withProvider, reason }) => {
    const ctx = await baseContext()
    if (withProvider) new AllowListPrincipalAccess(ctx, new Set())
    else installPrincipal(ctx, principal)
    const controller = createSessionTestController(ctx, defaults)

    await expect(controller.list({}, new AbortController().signal)).rejects.toMatchObject({
      code: 'PRINCIPAL_ACCESS_DENIED',
      reason,
    } satisfies Partial<PrincipalAccessDeniedError>)
  })

  it('filters list, search, page, follow, and control baseline and live frames', async () => {
    const ctx = await baseContext()
    new SearchQuery(ctx)
    const allowed = ctx.sessions.create(SessionId('allowed'), { meta: header('allowed') })
    const hidden = ctx.sessions.create(SessionId('hidden'), { meta: header('hidden') })
    installPrincipal(ctx, principal)
    const allowedIds = new Set([allowed.id])
    const access = new AllowListPrincipalAccess(ctx, allowedIds)
    const controller = createSessionTestController(ctx, defaults)

    const controlAbort = new AbortController()
    const control = controller.control(controlAbort.signal)[Symbol.asyncIterator]()
    const baseline = await control.next()
    if (baseline.done || baseline.value.type !== 'baseline') throw new Error('missing baseline')
    expect(Object.keys(baseline.value.value.queues)).toEqual([allowed.id])
    expect(Object.keys(baseline.value.value.jobs)).toEqual([allowed.id])
    expect(Object.keys(baseline.value.value.projections)).toEqual([allowed.id])
    const live = control.next()
    hidden.append('turn/start', { turn: 1 })
    allowed.append('turn/start', { turn: 1 })
    await expect(live).resolves.toMatchObject({
      value: { type: 'projection', sessionId: allowed.id },
    })
    controlAbort.abort()
    await control.return?.()

    for (const session of [allowed, hidden]) {
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: session.id }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
    }

    await expect(controller.list({}, new AbortController().signal)).resolves.toMatchObject({
      items: [{ sessionId: allowed.id }],
    })
    await expect(controller.search({ query: 'match' }, new AbortController().signal)).resolves.toEqual({
      items: [{ sessionId: allowed.id, snippet: 'match:allowed' }],
      hasMore: false,
    })

    const throughSeq = allowed.events.at(-1)?.seq ?? -1
    await expect(controller.page({
      address: { kind: 'session', sessionId: allowed.id },
      throughSeq,
    }, new AbortController().signal)).resolves.toMatchObject({ hasMore: false })
    await expect(controller.page({
      address: { kind: 'session', sessionId: hidden.id },
      throughSeq: hidden.events.at(-1)?.seq ?? -1,
    }, new AbortController().signal)).rejects.toMatchObject({
      failure: {
        code: 'session-not-found',
        message: `session "${hidden.id}" not found`,
        details: { sessionId: hidden.id },
      },
    } satisfies Partial<TypertRemoteFailure>)

    const hiddenFollow = controller.follow({
      address: { kind: 'session', sessionId: hidden.id },
    }, new AbortController().signal)[Symbol.asyncIterator]()
    await expect(hiddenFollow.next()).rejects.toMatchObject({
      failure: {
        code: 'session-not-found',
        message: `session "${hidden.id}" not found`,
        details: { sessionId: hidden.id },
      },
    } satisfies Partial<TypertRemoteFailure>)

    const followAbort = new AbortController()
    const allowedFollow = controller.follow({
      address: { kind: 'session', sessionId: allowed.id },
    }, followAbort.signal)[Symbol.asyncIterator]()
    await expect(allowedFollow.next()).resolves.toMatchObject({
      value: { type: 'snapshot', header: { id: allowed.id } },
    })
    const revokedFrame = allowedFollow.next()
    allowedIds.delete(allowed.id)
    allowed.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'after revocation' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await expect(revokedFrame).rejects.toMatchObject({
      failure: {
        code: 'session-not-found',
        message: `session "${allowed.id}" not found`,
        details: { sessionId: allowed.id },
      },
    } satisfies Partial<TypertRemoteFailure>)
    followAbort.abort()
    await allowedFollow.return?.()

    expect(access.resolveCall).toHaveBeenCalled()
    expect(access.resolveCall.mock.calls.every(([candidate]) => candidate === principal)).toBe(true)
  })

  it('authorizes every existing-Session command before observing or mutating the target', async () => {
    const ctx = await baseContext()
    const hidden = ctx.sessions.create(SessionId('hidden-commands'), {
      meta: header('hidden-commands'),
    })
    installPrincipal(ctx, principal)
    new AllowListPrincipalAccess(ctx, new Set())
    const openPath = vi.fn(() => Promise.resolve())
    const controller = createSessionTestController(ctx, { ...defaults, openPath })

    const denied = [
      () => controller.selectModel({
        sessionId: hidden.id, provider: 'fixture', model: 'fixture-model',
      }),
      () => controller.rename({ sessionId: hidden.id, title: 'hidden title' }),
      () => controller.fork({ sessionId: hidden.id }),
      () => controller.prompt({
        requestId: 'hidden-request' as never,
        sessionId: hidden.id,
        mode: 'queue',
        content: [{ type: 'text', text: 'hidden prompt' }],
      }, new AbortController().signal),
      () => controller.attachment({
        sessionId: hidden.id,
        attachmentId: 'hidden-attachment' as never,
      }),
      () => controller.updateQueue({
        sessionId: hidden.id,
        itemId: 'hidden-item' as never,
        action: { kind: 'remove' },
      }),
      () => controller.cancel({ sessionId: hidden.id }),
      () => controller.openWorkspacePath({
        sessionId: hidden.id,
        path: '/hidden/file.txt',
      }, new AbortController().signal),
    ]

    for (const operation of denied) {
      await expect(operation()).rejects.toMatchObject({
        failure: {
          code: 'session-not-found',
          message: `session "${hidden.id}" not found`,
          details: { sessionId: hidden.id },
        },
      } satisfies Partial<TypertRemoteFailure>)
    }
    expect(openPath).not.toHaveBeenCalled()
    expect(hidden.events).toEqual([])
  })

  it('authorizes cold list candidates before reading projections or artifacts', async () => {
    const ctx = await baseContext()
    const query = new SearchQuery(ctx)
    const hidden = header('hidden-cold')
    vi.spyOn(query, 'listSessions').mockResolvedValue([{
      header: hidden,
      live: false,
      persisted: true,
    }])
    const cachedSnapshot = vi.fn(() => {
      throw new Error('hidden projection must not be read')
    })
    const locate = vi.fn(() => {
      throw new Error('hidden artifact must not be located')
    })
    ctx.provide('sessionProjectionCache', { cachedSnapshot } as never)
    ctx.provide('sessionPersistence', { locate } as never)
    installPrincipal(ctx, principal)
    new AllowListPrincipalAccess(ctx, new Set())
    const controller = createSessionTestController(ctx, defaults)

    await expect(controller.list({}, new AbortController().signal)).resolves.toEqual({ items: [] })
    expect(cachedSnapshot).not.toHaveBeenCalled()
    expect(locate).not.toHaveBeenCalled()
  })

  it('keeps all existing local-anonymous reads when no provider is mounted', async () => {
    const ctx = await baseContext()
    const session = ctx.sessions.create(SessionId('local'), { meta: header('local') })
    const controller = createSessionTestController(ctx, defaults)

    await expect(controller.list({}, new AbortController().signal)).resolves.toMatchObject({
      items: [{ sessionId: session.id }],
    })
  })
})
