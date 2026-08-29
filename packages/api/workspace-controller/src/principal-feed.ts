/** Principal-scoped filtering for the Host-wide Workspace projection. */

import type { Context } from '@deepseek-ai/cordis'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm/message'
import { resolvePrincipalAccess } from '@deepseek-ai/dsh-principal-access'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type {
  WorkspaceFollowFrame,
  WorkspaceView,
} from './types.ts'

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
 * Filter a Workspace follow generation for one authenticated caller. The
 * opening baseline and every replacement increment are authorized before
 * publication; removals name only Workspaces disclosed earlier in this
 * generation.
 * @param ctx - Host context carrying the optional deployment access provider.
 * @param principal - transport-verified caller, when the transport authenticated one.
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
  for await (const frame of frames) {
    signal.throwIfAborted()
    switch (frame.type) {
      case 'baseline': {
        const workspaceIds = frame.value.items.map(workspace => workspace.workspaceId)
        const sessionIds = [
          ...frame.value.items.flatMap(workspace => workspace.sessionIds),
          ...frame.value.archivedSessionIds,
        ]
        const access = await resolvePrincipalAccess(
          ctx,
          principal,
          { workspaceIds, sessionIds },
          signal,
        )
        visibleWorkspaceIds.clear()
        const items = frame.value.items
          .filter(workspace => access.readableWorkspaceIds.has(workspace.workspaceId))
          .map((workspace) => {
            visibleWorkspaceIds.add(workspace.workspaceId)
            return principalWorkspaceView(workspace, access.readableSessionIds)
          })
        yield {
          type: 'baseline',
          value: {
            items,
            archivedSessionIds: frame.value.archivedSessionIds
              .filter(sessionId => access.readableSessionIds.has(sessionId)),
          },
        }
        break
      }
      case 'upsert': {
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
        } else if (visibleWorkspaceIds.delete(frame.workspace.workspaceId)) {
          yield { type: 'remove', workspaceId: frame.workspace.workspaceId }
        }
        break
      }
      case 'remove':
        if (visibleWorkspaceIds.delete(frame.workspaceId)) yield frame
        break
      case 'order':
        yield {
          type: 'order',
          workspaceIds: frame.workspaceIds.filter(workspaceId => visibleWorkspaceIds.has(workspaceId)),
        }
        break
      case 'archived': {
        const access = await resolvePrincipalAccess(
          ctx,
          principal,
          { sessionIds: frame.archivedSessionIds },
          signal,
        )
        yield {
          type: 'archived',
          archivedSessionIds: frame.archivedSessionIds
            .filter(sessionId => access.readableSessionIds.has(sessionId)),
        }
        break
      }
      /* v8 ignore next -- the generated Remote codec validates this closed union. */
      default: assertNever(frame)
    }
  }
}

/* v8 ignore next 3 -- closed-union backstop after generated Remote validation. */
function assertNever(value: never): never {
  throw new Error(`unreachable Workspace follow frame: ${JSON.stringify(value)}`)
}
