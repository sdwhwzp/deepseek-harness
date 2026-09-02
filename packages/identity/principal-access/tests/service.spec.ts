import { Context } from '@deepseek-ai/cordis'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm/message'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { describe, expect, it, vi } from 'vitest'
import {
  PrincipalAccessDeniedError,
  PrincipalAccessService,
  requirePrincipalAccess,
  resolvePrincipalAccess,
  type PrincipalAccessResult,
  type PrincipalAccessSubjects,
} from '../src/index.ts'

const principal: AuthenticatedPrincipal = {
  source: 'fixture',
  id: 'account-1',
  username: 'display-only',
  role: 'user',
}

class StubPrincipalAccess extends PrincipalAccessService {
  readonly implementation = vi.fn((
    _principal: AuthenticatedPrincipal,
    _subjects: PrincipalAccessSubjects,
    _signal?: AbortSignal,
  ): Promise<PrincipalAccessResult> => Promise.resolve({
    readableSessionIds: new Set(),
    readableWorkspaceIds: new Set(),
  }))

  override resolve(
    candidate: AuthenticatedPrincipal,
    subjects: PrincipalAccessSubjects,
    signal?: AbortSignal,
  ): Promise<PrincipalAccessResult> {
    return this.implementation(candidate, subjects, signal)
  }
}

describe('principal access seam', () => {
  it('preserves local anonymous legacy access when no provider is mounted', async () => {
    const ctx = new Context()
    const sessionId = SessionId('session-1')
    const workspaceId = WorkspaceId('workspace-1')

    await expect(resolvePrincipalAccess(ctx, undefined, {
      sessionIds: [sessionId],
      workspaceIds: [workspaceId],
    })).resolves.toEqual({
      readableSessionIds: new Set([sessionId]),
      readableWorkspaceIds: new Set([workspaceId]),
    })
  })

  it('fails closed for each half-configured authenticated deployment', async () => {
    const withoutProvider = new Context()
    await expect(resolvePrincipalAccess(withoutProvider, principal, {})).rejects.toMatchObject({
      code: 'PRINCIPAL_ACCESS_DENIED',
      reason: 'provider-required',
    })

    const withoutPrincipal = new Context()
    const provider = new StubPrincipalAccess(withoutPrincipal)
    await expect(resolvePrincipalAccess(withoutPrincipal, undefined, {})).rejects.toMatchObject({
      code: 'PRINCIPAL_ACCESS_DENIED',
      reason: 'principal-required',
    })
    expect(provider.implementation).not.toHaveBeenCalled()
  })

  it('fails closed when transport authentication is mounted without an access provider', async () => {
    const ctx = new Context()
    ctx.provide('requestPrincipal', { authenticate: () => undefined })

    await expect(resolvePrincipalAccess(ctx, undefined, {})).rejects.toMatchObject({
      code: 'PRINCIPAL_ACCESS_DENIED',
      reason: 'provider-required',
    })
  })

  it('delegates authenticated decisions and checks exact grants', async () => {
    const ctx = new Context()
    const provider = new StubPrincipalAccess(ctx)
    const sessionId = SessionId('session-1')
    const workspaceId = WorkspaceId('workspace-1')
    const result: PrincipalAccessResult = {
      readableSessionIds: new Set([sessionId]),
      readableWorkspaceIds: new Set([workspaceId]),
    }
    provider.implementation.mockResolvedValueOnce(result)
    const signal = new AbortController().signal

    await expect(resolvePrincipalAccess(ctx, principal, {
      sessionIds: [sessionId],
      workspaceIds: [workspaceId],
    }, signal)).resolves.toBe(result)
    expect(provider.implementation).toHaveBeenCalledWith(
      principal,
      { sessionIds: [sessionId], workspaceIds: [workspaceId] },
      signal,
    )
    expect(() => { requirePrincipalAccess(result, { kind: 'session', id: sessionId }) }).not.toThrow()
    expect(() => { requirePrincipalAccess(result, { kind: 'workspace', id: workspaceId }) }).not.toThrow()
  })

  it('reports an exact omitted subject without consulting display roles or names', () => {
    const result: PrincipalAccessResult = {
      readableSessionIds: new Set(),
      readableWorkspaceIds: new Set(),
    }
    const session = { kind: 'session', id: SessionId('hidden') } as const
    const workspace = { kind: 'workspace', id: WorkspaceId('hidden') } as const

    expect(() => { requirePrincipalAccess(result, session) }).toThrowError(
      new PrincipalAccessDeniedError('subject-denied', session),
    )
    expect(() => { requirePrincipalAccess(result, workspace) }).toThrowError(
      new PrincipalAccessDeniedError('subject-denied', workspace),
    )
  })

  it('honors cancellation before and after provider resolution', async () => {
    const before = new AbortController()
    before.abort()
    await expect(resolvePrincipalAccess(new Context(), undefined, {}, before.signal))
      .rejects.toMatchObject({ name: 'AbortError' })

    const ctx = new Context()
    const provider = new StubPrincipalAccess(ctx)
    const after = new AbortController()
    provider.implementation.mockImplementationOnce(async () => {
      after.abort()
      return { readableSessionIds: new Set(), readableWorkspaceIds: new Set() }
    })
    await expect(resolvePrincipalAccess(ctx, principal, {}, after.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
  })

  it('keeps Cordis single-provider registration semantics', () => {
    const ctx = new Context()
    new StubPrincipalAccess(ctx)
    expect(() => new StubPrincipalAccess(ctx)).toThrow(/service "principalAccess" has been registered/)
  })
})
