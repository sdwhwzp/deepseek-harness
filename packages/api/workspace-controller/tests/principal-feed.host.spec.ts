import { Context } from '@deepseek-ai/cordis'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm/message'
import type { PrincipalAccessSubjects } from '@deepseek-ai/dsh-principal-access'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { describe, expect, it, vi } from 'vitest'
import { principalWorkspaceFollow } from '../src/principal-feed.ts'
import type { WorkspaceFollowFrame, WorkspaceView } from '../src/types.ts'

const PRINCIPAL: AuthenticatedPrincipal = {
  source: 'fixture', id: 'user-1', username: 'alice', role: 'user',
}

function workspace(id: string, sessionIds: readonly string[] = []): WorkspaceView {
  return {
    workspaceId: WorkspaceId(id),
    path: `/workspaces/${id}`,
    title: id,
    sessionIds: sessionIds.map(SessionId),
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
  }
}

async function* source(...frames: readonly WorkspaceFollowFrame[]): AsyncIterable<WorkspaceFollowFrame> {
  yield* frames
}

async function collect(
  ctx: Context,
  principal: AuthenticatedPrincipal | undefined,
  ...frames: readonly WorkspaceFollowFrame[]
): Promise<WorkspaceFollowFrame[]> {
  const result: WorkspaceFollowFrame[] = []
  const signal = new AbortController().signal
  for await (const frame of principalWorkspaceFollow(ctx, principal, source(...frames), signal)) {
    result.push(frame)
  }
  return result
}

describe('principalWorkspaceFollow', () => {
  it('preserves the complete local projection without an authenticated deployment', async () => {
    const ctx = new Context()
    const one = workspace('one', ['session-one'])
    await expect(collect(ctx, undefined,
      { type: 'baseline', value: { items: [one], archivedSessionIds: [SessionId('archived')] } },
      { type: 'order', workspaceIds: [one.workspaceId] },
    )).resolves.toEqual([
      { type: 'baseline', value: { items: [one], archivedSessionIds: [SessionId('archived')] } },
      { type: 'order', workspaceIds: [one.workspaceId] },
    ])
  })

  it('fails closed for either half of an authenticated deployment', async () => {
    await expect(collect(new Context(), PRINCIPAL, {
      type: 'baseline', value: { items: [], archivedSessionIds: [] },
    })).rejects.toMatchObject({
      code: 'PRINCIPAL_ACCESS_DENIED', reason: 'provider-required',
    })

    const withoutPrincipal = new Context()
    withoutPrincipal.provide('principalAccess', { resolve: vi.fn() } as never)
    await expect(collect(withoutPrincipal, undefined, {
      type: 'baseline', value: { items: [], archivedSessionIds: [] },
    })).rejects.toMatchObject({
      code: 'PRINCIPAL_ACCESS_DENIED', reason: 'principal-required',
    })
  })

  it('filters the baseline and every increment without revealing hidden removals', async () => {
    const ctx = new Context()
    const visible = workspace('visible', ['session-visible', 'session-hidden'])
    const hidden = workspace('hidden', ['session-visible'])
    const revoked = workspace('visible', ['session-visible'])
    const resolve = vi.fn(async (
      _principal: AuthenticatedPrincipal,
      subjects: PrincipalAccessSubjects,
    ) => ({
      readableSessionIds: new Set((subjects.sessionIds ?? [])
        .filter(id => String(id).includes('visible'))),
      readableWorkspaceIds: new Set((subjects.workspaceIds ?? [])
        .filter(id => String(id) === 'visible' && resolve.mock.calls.length < 3)),
    }))
    ctx.provide('principalAccess', { resolve } as never)

    await expect(collect(ctx, PRINCIPAL,
      {
        type: 'baseline',
        value: {
          items: [visible, hidden],
          archivedSessionIds: [SessionId('session-visible'), SessionId('session-hidden')],
        },
      },
      { type: 'remove', workspaceId: hidden.workspaceId },
      { type: 'order', workspaceIds: [hidden.workspaceId, visible.workspaceId] },
      {
        type: 'archived',
        archivedSessionIds: [SessionId('session-hidden'), SessionId('session-visible')],
      },
      { type: 'upsert', workspace: revoked },
      { type: 'remove', workspaceId: visible.workspaceId },
    )).resolves.toEqual([
      {
        type: 'baseline',
        value: {
          items: [workspace('visible', ['session-visible'])],
          archivedSessionIds: [SessionId('session-visible')],
        },
      },
      { type: 'order', workspaceIds: [visible.workspaceId] },
      { type: 'archived', archivedSessionIds: [SessionId('session-visible')] },
      { type: 'remove', workspaceId: visible.workspaceId },
    ])
    expect(resolve).toHaveBeenCalledTimes(3)
  })
})
