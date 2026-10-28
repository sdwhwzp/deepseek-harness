import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm'
import {
  PrincipalAccessService,
  type PrincipalAccessResult,
  type PrincipalAccessSubjects,
} from '@deepseek-ai/dsh-principal-access'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createSessionTestController } from './test-remote.ts'

const defaults = {
  defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
  cwd: '/tmp',
}

const principal: AuthenticatedPrincipal = {
  source: 'fixture-auth', id: 'subject-1', username: 'display-only', role: 'admin',
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

  override resolve(
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
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  return ctx
}

function installPrincipal(ctx: Context, value: AuthenticatedPrincipal | undefined): void {
  ctx.provide('typertGateway', { currentPrincipal: () => value, getPendingRemoteEvents: () => [] } as never)
}

describe('Session Controller principal access', () => {
  it.each([
    { name: 'authenticated request without provider', withProvider: false, reason: 'provider-required' },
    { name: 'provider without authenticated request', withProvider: true, reason: 'principal-required' },
  ] as const)('fails closed for $name', async ({ withProvider, reason }) => {
    const ctx = await baseContext()
    if (withProvider) new AllowListPrincipalAccess(ctx, new Set())
    else installPrincipal(ctx, principal)
    const controller = await createSessionTestController(ctx, defaults)

    await expect(controller.list({}, new AbortController().signal)).rejects.toMatchObject({
      code: 'PRINCIPAL_ACCESS_DENIED', reason,
    })
  })

  it('filters list and exact history reads and rechecks a live follow after revocation', async () => {
    const ctx = await baseContext()
    const allowed = ctx.sessions.create(SessionId('allowed'), { meta: { cwd: '/workspace' } })
    const hidden = ctx.sessions.create(SessionId('hidden'), { meta: { cwd: '/workspace' } })
    installPrincipal(ctx, principal)
    const allowedIds = new Set([allowed.id])
    const access = new AllowListPrincipalAccess(ctx, allowedIds)
    const controller = await createSessionTestController(ctx, defaults)

    await expect(controller.list({}, new AbortController().signal)).resolves.toMatchObject({
      items: [{ sessionId: allowed.id }],
    })
    // oxlint-disable-next-line typescript/no-deprecated -- The legacy page entry must retain its account authorization.
    await expect(controller.page({
      address: { kind: 'session', sessionId: hidden.id }, throughSeq: 0,
    }, new AbortController().signal)).rejects.toMatchObject({
      code: 'session/not-found', details: { sessionId: hidden.id },
    })

    const followAbort = new AbortController()
    const follow = controller.follow({
      address: { kind: 'session', sessionId: allowed.id },
    }, followAbort.signal)[Symbol.asyncIterator]()
    await expect(follow.next()).resolves.toMatchObject({
      value: { type: 'snapshot', header: { id: allowed.id } },
    })
    const revoked = follow.next()
    allowedIds.delete(allowed.id)
    allowed.append('turn/start', { turn: 1 })
    await expect(revoked).rejects.toMatchObject({
      code: 'session/not-found', details: { sessionId: allowed.id },
    })
    followAbort.abort()
    await follow.return?.()
    expect(access.resolveCall.mock.calls.every(([candidate]) => candidate === principal)).toBe(true)
  })

  it('rejects every passive read and observation of another account’s Session', async () => {
    const ctx = await baseContext()
    onTestFinished(() => ctx.fiber.dispose())
    const hidden = ctx.sessions.create(SessionId('hidden-passive'), { meta: { cwd: '/workspace' } })
    installPrincipal(ctx, { ...principal, role: 'user' })
    new AllowListPrincipalAccess(ctx, new Set())
    const controller = await createSessionTestController(ctx, defaults)
    const signal = new AbortController().signal
    const address = { kind: 'session', sessionId: hidden.id } as const
    const denied = [
      () => controller.events({ address }, signal),
      () => controller.state({ sessionId: hidden.id }, signal),
      () => controller.wait({ sessionId: hidden.id }, signal),
      () => controller.observeEvent({ address }, signal)[Symbol.asyncIterator]().next(),
      () => controller.observeProjections({ sessionId: hidden.id }, signal)[Symbol.asyncIterator]().next(),
      () => controller.observeState({ sessionId: hidden.id }, signal)[Symbol.asyncIterator]().next(),
    ]
    for (const operation of denied) {
      await expect(operation()).rejects.toMatchObject({
        code: 'session/not-found', details: { sessionId: hidden.id },
      })
    }
    expect(hidden.snapshotEvents()).toEqual([])
    expect(ctx.agents.get(hidden.id)).toBeUndefined()
  })

  it('checks read access again before delivering a passive event after revocation', async () => {
    const ctx = await baseContext()
    onTestFinished(() => ctx.fiber.dispose())
    const session = ctx.sessions.create(SessionId('revoked-passive'), { meta: { cwd: '/workspace' } })
    installPrincipal(ctx, { ...principal, role: 'user' })
    const allowedIds = new Set([session.id])
    new AllowListPrincipalAccess(ctx, allowedIds)
    const controller = await createSessionTestController(ctx, defaults)
    const abort = new AbortController()
    onTestFinished(() => { abort.abort() })
    const events = controller.observeEvent({ address: { kind: 'session', sessionId: session.id } }, abort.signal)[Symbol.asyncIterator]()
    await expect(events.next()).resolves.toMatchObject({ value: { type: 'ready' } })
    const next = events.next()
    allowedIds.delete(session.id)
    session.append('turn/start', { turn: 1 })
    await expect(next).rejects.toMatchObject({ code: 'session/not-found' })
    await events.return?.()
  })

  it('refuses a wait result when access expires while the state is being read', async () => {
    const ctx = await baseContext()
    onTestFinished(() => ctx.fiber.dispose())
    const session = ctx.sessions.create(SessionId('revoked-wait'), { meta: { cwd: '/workspace' } })
    installPrincipal(ctx, { ...principal, role: 'user' })
    const access = new AllowListPrincipalAccess(ctx, new Set([session.id]))
    const resolve = access.resolveCall.getMockImplementation()
    if (resolve === undefined) throw new Error('Missing access fixture')
    access.resolveCall.mockImplementationOnce(resolve).mockResolvedValue({
      readableSessionIds: new Set(), readableWorkspaceIds: new Set(),
    })
    const controller = await createSessionTestController(ctx, defaults)
    await expect(controller.wait({ sessionId: session.id }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'session/not-found' })
    expect(access.resolveCall).toHaveBeenCalledTimes(2)
  })

  it('authorizes every existing-Session mutation before observing the target', async () => {
    const ctx = await baseContext()
    const hidden = ctx.sessions.create(SessionId('hidden-commands'), { meta: { cwd: '/workspace' } })
    installPrincipal(ctx, principal)
    new AllowListPrincipalAccess(ctx, new Set())
    const openPath = vi.fn(() => Promise.resolve())
    const controller = await createSessionTestController(ctx, { ...defaults, openPath })
    const signal = new AbortController().signal
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
      }, signal),
      () => controller.cancel({ sessionId: hidden.id }),
      () => controller.projections({ sessionId: hidden.id }, signal),
      () => controller.workspacePathApplications({ sessionId: hidden.id, path: '/hidden/file.txt' }, signal),
      () => controller.openWorkspacePath({
        sessionId: hidden.id, path: '/hidden/file.txt',
      }, signal),
    ]

    for (const operation of denied) {
      await expect(operation()).rejects.toMatchObject({
        code: 'session/not-found', details: { sessionId: hidden.id },
      })
    }
    expect(openPath).not.toHaveBeenCalled()
    expect(hidden.snapshotEvents()).toEqual([])
  })

  it('authorizes Remote lookups before resolving or resuming their Agent', async () => {
    const ctx = await baseContext()
    await ctx.plugin(TypertRegistry)
    const hidden = ctx.sessions.create(SessionId('hidden-lookup'), { meta: { cwd: '/workspace' } })
    installPrincipal(ctx, principal)
    new AllowListPrincipalAccess(ctx, new Set())
    const resume = vi.spyOn(ctx.agents, 'resume')
    await createSessionTestController(ctx, defaults)
    const agentLookup = ctx.typert.lookups.get('agent')
    const sessionLookup = ctx.typert.lookups.get('session')
    const agentContext = ctx.typert.contexts.getHost('agent')
    if (agentLookup === undefined || sessionLookup === undefined || agentContext === undefined) {
      throw new Error('Session Controller Remote lookup providers were not mounted')
    }

    for (const resolve of [
      () => agentLookup.resolve(hidden.id),
      () => sessionLookup.resolve(hidden.id),
      () => agentContext.resolve(hidden.id),
    ]) {
      await expect(resolve()).rejects.toMatchObject({
        code: 'session/not-found', details: { sessionId: hidden.id },
      })
    }
    expect(resume).not.toHaveBeenCalled()
  })

  it('keeps local-anonymous list behavior when no deployment services are mounted', async () => {
    const ctx = await baseContext()
    const session = ctx.sessions.create(SessionId('local'), { meta: { cwd: '/workspace' } })
    const controller = await createSessionTestController(ctx, defaults)

    await expect(controller.list({}, new AbortController().signal)).resolves.toMatchObject({
      items: [{ sessionId: session.id }],
    })
  })

  it.each(['user', 'missing', 'provider-missing', 'revoked'] as const)(
    'refuses shared default model initialization for %s before reading credentials', async (state) => {
      const ctx = await baseContext()
      const save = vi.fn()
      const controller = await createSessionTestController(ctx, { ...defaults, saveDefaultModelSelection: save })
      if (state !== 'missing') installPrincipal(ctx, { ...principal, role: state === 'user' ? 'user' : 'admin' })
      if (state !== 'provider-missing') {
        const access = new AllowListPrincipalAccess(ctx, new Set())
        if (state === 'revoked') access.resolveCall.mockRejectedValue(new Error('account revoked'))
      }
      try {
        await expect(controller.initializeDefaultModel()).rejects.toMatchObject(state === 'user'
          ? { code: 'session/admin-required' }
          : state === 'revoked' ? { message: 'account revoked' }
            : { code: 'PRINCIPAL_ACCESS_DENIED', reason: state === 'missing' ? 'principal-required' : 'provider-required' })
        expect(save).not.toHaveBeenCalled()
      } finally { await ctx.fiber.dispose() }
    },
  )
})
