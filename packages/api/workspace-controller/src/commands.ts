/** Workspace command implementation and stable Remote failure mapping. */

import type { Context } from '@deepseek-ai/cordis'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm/message'
import {
  PrincipalAccessDeniedError,
  requirePrincipalAccess,
  resolvePrincipalAccess,
  type PrincipalAccessResult,
  type PrincipalAccessSubject,
  type PrincipalAccessSubjects,
} from '@deepseek-ai/dsh-principal-access'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import {
  WorkspaceId,
  WorkspaceMoveInvalidError,
  WorkspaceOrderInvalidError,
  WorkspaceUnknownSessionError,
} from '@deepseek-ai/dsh-workspace'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { workspaceView } from './feed.ts'
import { principalWorkspaceView } from './principal-feed.ts'
import type {
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceDeleteValue,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspaceRenameRequest,
  WorkspaceValue,
} from './types.ts'

/** Implements Workspace mutations against the authoritative registry. */
export class WorkspaceCommands {
  private operationTail = Promise.resolve()

  /** @param ctx - Host context containing the Workspace registry. */
  constructor(private readonly ctx: Context) {}

  /**
   * Create or resolve one Workspace over an existing directory.
   * @param request - directory path to register.
   * @param principal - transport-verified caller, when authenticated.
   * @returns the authorized Workspace and whether this call created it.
   */
  create(
    request: WorkspaceCreateRequest,
    principal: AuthenticatedPrincipal | undefined,
  ): Promise<WorkspaceCreateValue> {
    return this.enqueue(async () => {
      let existing: Workspace | undefined
      try {
        existing = await this.ctx.workspaceRegistry.resolveByPath(request.path)
      } catch (error) {
        if (error instanceof TypertRemoteFailure) throw error
        throw failure(
          'workspace-invalid-path',
          `cannot create a Workspace at "${request.path}": ${errorMessage(error)}`,
          { path: request.path },
        )
      }
      if (existing !== undefined) {
        const access = await this.authorizeWorkspace(
          existing,
          principal,
          () => invalidWorkspacePath(request.path),
        )
        return {
          workspace: principalWorkspaceView(
            workspaceView(existing),
            access.readableSessionIds,
          ),
          created: false,
        }
      }
      await resolvePrincipalAccess(this.ctx, principal, {})
      try {
        const workspace = await this.ctx.workspaceRegistry.create(request.path)
        return { workspace: workspaceView(workspace), created: true }
      } catch (error) {
        if (error instanceof TypertRemoteFailure) throw error
        throw invalidWorkspacePath(request.path, error)
      }
    })
  }

  /**
   * Rename one Workspace after serializing title ownership checks.
   * @param request - Workspace identity and proposed title.
   * @param principal - transport-verified caller, when authenticated.
   * @returns the updated authorized Workspace projection.
   */
  rename(
    request: WorkspaceRenameRequest,
    principal: AuthenticatedPrincipal | undefined,
  ): Promise<WorkspaceValue> {
    const title = request.title.trim()
    if (title === '') {
      return Promise.reject(failure(
        'bad-request',
        'Workspace rename requires a non-blank title',
        {},
      ))
    }
    return this.enqueue(async () => {
      const workspace = this.requireWorkspace(request.workspaceId)
      const access = await this.authorizeWorkspace(workspace, principal)
      if (title !== workspace.title) {
        if (this.ctx.workspaceRegistry.list().some(candidate =>
          candidate.id !== workspace.id && candidate.title === title)) {
          throw failure(
            'workspace-name-conflict',
            `Workspace name '${title}' is already in use`,
            { name: title },
          )
        }
        await workspace.setTitle(title)
      }
      return {
        workspace: principalWorkspaceView(workspaceView(workspace), access.readableSessionIds),
      }
    })
  }

  /**
   * Delete one Workspace registration without deleting its directory or Sessions.
   * @param request - Workspace identity to remove.
   * @param principal - transport-verified caller, when authenticated.
   * @returns deletion confirmation.
   */
  delete(
    request: WorkspaceDeleteRequest,
    principal: AuthenticatedPrincipal | undefined,
  ): Promise<WorkspaceDeleteValue> {
    return this.enqueue(async () => {
      const workspace = this.requireWorkspace(request.workspaceId)
      await this.authorizeWorkspace(workspace, principal)
      if (!await this.ctx.workspaceRegistry.delete(WorkspaceId(request.workspaceId))) {
        throw workspaceNotFound(request.workspaceId)
      }
      return { deleted: true }
    })
  }

  /**
   * Move one Workspace within the durable registry order.
   * @param request - moved Workspace and optional anchor.
   * @param principal - transport-verified caller, when authenticated.
   * @returns the readable subset of the resulting Workspace order.
   */
  async insertBefore(
    request: WorkspaceInsertBeforeRequest,
    principal: AuthenticatedPrincipal | undefined,
  ): Promise<WorkspaceOrderValue> {
    const exactWorkspaceIds = [
      request.workspaceId,
      ...request.beforeWorkspaceId === undefined ? [] : [request.beforeWorkspaceId],
    ]
    const access = await this.authorize(
      principal,
      {
        workspaceIds: unique([
          ...this.ctx.workspaceRegistry.list().map(workspace => workspace.id),
          ...exactWorkspaceIds,
        ]),
      },
      exactWorkspaceIds.map(id => ({ kind: 'workspace' as const, id })),
      hiddenResource,
    )
    try {
      const workspaceIds = await this.ctx.workspaceRegistry.insertBefore(
        WorkspaceId(request.workspaceId),
        request.beforeWorkspaceId === undefined
          ? undefined
          : WorkspaceId(request.beforeWorkspaceId),
      )
      return {
        workspaceIds: workspaceIds.filter(workspaceId =>
          access.readableWorkspaceIds.has(workspaceId)),
      }
    } catch (error) {
      if (!(error instanceof WorkspaceOrderInvalidError)) throw error
      throw workspaceNotFound(error.workspaceId)
    }
  }

  /**
   * Move one accounted Session within a Workspace's manual order.
   * @param request - Workspace, Session, and optional anchor identities.
   * @param principal - transport-verified caller, when authenticated.
   * @returns the updated authorized Workspace projection.
   */
  async insertSessionBefore(
    request: WorkspaceInsertSessionBeforeRequest,
    principal: AuthenticatedPrincipal | undefined,
  ): Promise<WorkspaceValue> {
    const workspace = this.requireWorkspace(request.workspaceId)
    const exactSessionIds = [
      request.sessionId,
      ...request.beforeSessionId === undefined ? [] : [request.beforeSessionId],
    ]
    const access = await this.authorize(
      principal,
      {
        workspaceIds: [workspace.id],
        sessionIds: unique([...workspace.sessionIds, ...exactSessionIds]),
      },
      [
        { kind: 'workspace', id: workspace.id },
        ...exactSessionIds.map(id => ({ kind: 'session' as const, id })),
      ],
      hiddenResource,
    )
    try {
      await workspace.insertSessionBefore(request.sessionId, request.beforeSessionId)
    } catch (error) {
      if (!(error instanceof WorkspaceMoveInvalidError)) throw error
      throw failure(
        'workspace-move-invalid',
        error.message,
        {
          workspaceId: request.workspaceId,
          sessionId: request.sessionId,
          ...request.beforeSessionId === undefined
            ? {}
            : { beforeSessionId: request.beforeSessionId },
        },
      )
    }
    return {
      workspace: principalWorkspaceView(workspaceView(workspace), access.readableSessionIds),
    }
  }

  /**
   * Add one known Session to the registry-global archive set.
   * @param request - Session identity to archive.
   * @param principal - transport-verified caller, when authenticated.
   * @returns the readable subset of the resulting archive set.
   */
  async archiveSession(
    request: WorkspaceArchiveSessionRequest,
    principal: AuthenticatedPrincipal | undefined,
  ): Promise<WorkspaceArchiveValue> {
    const access = await this.authorize(
      principal,
      {
        sessionIds: unique([
          ...this.ctx.workspaceRegistry.archivedSessionIds,
          request.sessionId,
        ]),
      },
      [{ kind: 'session', id: request.sessionId }],
      hiddenResource,
    )
    try {
      await this.ctx.workspaceRegistry.archiveSession(request.sessionId)
    } catch (error) {
      if (!(error instanceof WorkspaceUnknownSessionError)) throw error
      throw sessionNotFound(request.sessionId, error.message)
    }
    return {
      archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds]
        .filter(sessionId => access.readableSessionIds.has(sessionId)),
    }
  }

  private authorizeWorkspace(
    workspace: Workspace,
    principal: AuthenticatedPrincipal | undefined,
    denied: (subject: PrincipalAccessSubject) => TypertRemoteFailure = hiddenResource,
  ): Promise<PrincipalAccessResult> {
    return this.authorize(
      principal,
      { workspaceIds: [workspace.id], sessionIds: workspace.sessionIds },
      [{ kind: 'workspace', id: workspace.id }],
      denied,
    )
  }

  private async authorize(
    principal: AuthenticatedPrincipal | undefined,
    subjects: PrincipalAccessSubjects,
    exactSubjects: readonly PrincipalAccessSubject[],
    denied: (subject: PrincipalAccessSubject) => TypertRemoteFailure,
  ): Promise<PrincipalAccessResult> {
    try {
      const access = await resolvePrincipalAccess(this.ctx, principal, subjects)
      for (const subject of exactSubjects) requirePrincipalAccess(access, subject)
      return access
    } catch (error) {
      if (!isSubjectDenied(error)) throw error
      const deniedSubject = error.subject
      const subject = deniedSubject === undefined
        ? exactSubjects[0]
        : exactSubjects.find(candidate => sameSubject(candidate, deniedSubject))
          ?? exactSubjects[0]
      if (subject === undefined) throw error
      throw denied(subject)
    }
  }

  private requireWorkspace(workspaceId: WorkspaceId): Workspace {
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
    if (workspace === undefined) throw workspaceNotFound(workspaceId)
    return workspace
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

function isSubjectDenied(error: unknown): error is PrincipalAccessDeniedError {
  return error instanceof PrincipalAccessDeniedError && error.reason === 'subject-denied'
}

function hiddenResource(subject: PrincipalAccessSubject): TypertRemoteFailure {
  return subject.kind === 'workspace'
    ? workspaceNotFound(subject.id)
    : sessionNotFound(subject.id)
}

function sameSubject(
  left: PrincipalAccessSubject,
  right: PrincipalAccessSubject,
): boolean {
  return left.kind === right.kind && left.id === right.id
}

function invalidWorkspacePath(path: string, error?: unknown): TypertRemoteFailure {
  return failure(
    'workspace-invalid-path',
    `cannot create a Workspace at "${path}"${
      error === undefined ? '' : `: ${errorMessage(error)}`
    }`,
    { path },
  )
}

function workspaceNotFound(workspaceId: WorkspaceId): TypertRemoteFailure {
  return failure(
    'workspace-not-found',
    `Workspace "${workspaceId}" not found`,
    { workspaceId },
  )
}

function sessionNotFound(
  sessionId: WorkspaceArchiveSessionRequest['sessionId'],
  message = `Session "${sessionId}" not found`,
): TypertRemoteFailure {
  return failure('session-not-found', message, { sessionId })
}

function failure(
  code: string,
  message: string,
  details: object,
): TypertRemoteFailure {
  return new TypertRemoteFailure({ code, message, details })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
