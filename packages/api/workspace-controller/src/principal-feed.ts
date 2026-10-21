/** Principal-scoped filtering for the Host-wide Workspace projection. */

import type { Context } from '@deepseek-ai/cordis'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm/message'
import { resolvePrincipalAccess } from '@deepseek-ai/dsh-principal-access'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { WorkspaceBaseline, WorkspaceFollowFrame, WorkspaceView } from './types.ts'

/**
 * Filter one Workspace row's Session membership against one access result.
 * @param workspace - authoritative Workspace projection.
 * @param readableSessionIds - Session ids the caller may read.
 * @returns a detached Workspace projection containing only readable Session ids.
 */
export function principalWorkspaceView(
  workspace: WorkspaceView,
  readableSessionIds: ReadonlySet<SessionId>,
): WorkspaceView {
  return {
    ...workspace,
    sessionIds: workspace.sessionIds.filter(sessionId => readableSessionIds.has(sessionId)),
  }
}

/**
 * Filter a Workspace follow generation for one authenticated caller.
 * @param ctx - Host context carrying the optional deployment access provider.
 * @param principal - transport-verified caller, when authenticated.
 * @param frames - authoritative unfiltered Workspace generation.
 * @param signal - generation cancellation.
 * @returns a complete principal-scoped baseline followed by safe increments.
 */
export async function* principalWorkspaceFollow(
  ctx: Context,
  principal: AuthenticatedPrincipal | undefined,
  frames: AsyncIterable<WorkspaceFollowFrame>,
  signal: AbortSignal,
): AsyncIterable<WorkspaceFollowFrame> {
  const visibleWorkspaceIds = new Set<WorkspaceId>()
  const workspaces = new Map<WorkspaceId, WorkspaceView>()
  let archivedSessionIds: readonly SessionId[] = []
  let pinnedSessionIds: readonly SessionId[] = []
  const filteredBaseline = async (): Promise<WorkspaceBaseline> => {
    const all = [...workspaces.values()]
    const access = await resolvePrincipalAccess(ctx, principal, {
      workspaceIds: all.map(workspace => workspace.workspaceId),
      sessionIds: [...all.flatMap(workspace => workspace.sessionIds), ...archivedSessionIds, ...pinnedSessionIds],
    }, signal)
    visibleWorkspaceIds.clear()
    const items = all.filter(workspace => access.readableWorkspaceIds.has(workspace.workspaceId))
      .map((workspace) => {
        visibleWorkspaceIds.add(workspace.workspaceId)
        return principalWorkspaceView(workspace, access.readableSessionIds)
      })
    return {
      items,
      archivedSessionIds: archivedSessionIds.filter(id => access.readableSessionIds.has(id)),
      pinnedSessionIds: pinnedSessionIds.filter(id => access.readableSessionIds.has(id)),
    }
  }
  for await (const frame of frames) {
    signal.throwIfAborted()
    switch (frame.type) {
      case 'baseline':
      case 'replace': {
        workspaces.clear()
        for (const workspace of frame.value.items) workspaces.set(workspace.workspaceId, workspace)
        archivedSessionIds = frame.value.archivedSessionIds
        pinnedSessionIds = frame.value.pinnedSessionIds
        yield { type: frame.type, value: await filteredBaseline() }
        break
      }
      case 'upsert': {
        workspaces.set(frame.workspace.workspaceId, frame.workspace)
        const access = await resolvePrincipalAccess(ctx, principal, {
          workspaceIds: [frame.workspace.workspaceId],
          sessionIds: frame.workspace.sessionIds,
        }, signal)
        if (access.readableWorkspaceIds.has(frame.workspace.workspaceId)) {
          visibleWorkspaceIds.add(frame.workspace.workspaceId)
          yield {
            type: 'upsert',
            workspace: principalWorkspaceView(frame.workspace, access.readableSessionIds),
          }
        } else if (visibleWorkspaceIds.has(frame.workspace.workspaceId)) {
          yield { type: 'replace', value: await filteredBaseline() }
        }
        break
      }
      case 'remove':
        workspaces.delete(frame.workspaceId)
        if (visibleWorkspaceIds.delete(frame.workspaceId)) yield frame
        break
      case 'order': {
        const ordered = frame.workspaceIds.flatMap((id) => {
          const workspace = workspaces.get(id)
          return workspace === undefined ? [] : [workspace]
        })
        workspaces.clear()
        for (const workspace of ordered) workspaces.set(workspace.workspaceId, workspace)
        const access = await resolvePrincipalAccess(ctx, principal, { workspaceIds: frame.workspaceIds }, signal)
        if (frame.workspaceIds.some(id => visibleWorkspaceIds.has(id) && !access.readableWorkspaceIds.has(id))) {
          yield { type: 'replace', value: await filteredBaseline() }
        } else {
          yield { type: 'order', workspaceIds: frame.workspaceIds.filter(id => visibleWorkspaceIds.has(id)) }
        }
        break
      }
      case 'archived': {
        archivedSessionIds = frame.archivedSessionIds
        const access = await resolvePrincipalAccess(ctx, principal, {
          sessionIds: frame.archivedSessionIds,
        }, signal)
        yield {
          type: 'archived',
          archivedSessionIds: frame.archivedSessionIds
            .filter(sessionId => access.readableSessionIds.has(sessionId)),
        }
        break
      }
      case 'pinned': {
        pinnedSessionIds = frame.pinnedSessionIds
        const access = await resolvePrincipalAccess(ctx, principal, { sessionIds: frame.pinnedSessionIds }, signal)
        yield { type: 'pinned', pinnedSessionIds: frame.pinnedSessionIds.filter(id => access.readableSessionIds.has(id)) }
        break
      }
      default: assertNever(frame)
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`unreachable Workspace follow frame: ${JSON.stringify(value)}`)
}
