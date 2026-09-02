/**
 * Deployment-provided authorization for principal-scoped Session and Workspace reads.
 * @module @deepseek-ai/dsh-principal-access
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm/message'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Resource ids whose readability a Consumer needs to resolve in one batch. */
export interface PrincipalAccessSubjects {
  /** Session ids under consideration. */
  readonly sessionIds?: readonly SessionId[]
  /** Workspace ids under consideration. */
  readonly workspaceIds?: readonly WorkspaceId[]
}

/** Readable subset of one {@link PrincipalAccessSubjects} request. */
export interface PrincipalAccessResult {
  /** Requested Session ids the principal may read. */
  readonly readableSessionIds: ReadonlySet<SessionId>
  /** Requested Workspace ids the principal may read. */
  readonly readableWorkspaceIds: ReadonlySet<WorkspaceId>
}

/** One exact resource checked against a resolved access result. */
export type PrincipalAccessSubject =
  | { readonly kind: 'session'; readonly id: SessionId }
  | { readonly kind: 'workspace'; readonly id: WorkspaceId }

/** Stable reason for a fail-closed principal-access refusal. */
export type PrincipalAccessDeniedReason =
  | 'principal-required'
  | 'provider-required'
  | 'subject-denied'

/** A principal-scoped read that deployment authorization refused. */
export class PrincipalAccessDeniedError extends Error {
  /** Stable machine code for transport-specific error mapping. */
  readonly code = 'PRINCIPAL_ACCESS_DENIED'

  /**
   * @param reason - why access failed closed.
   * @param subject - exact denied resource, when one was checked.
   */
  constructor(
    readonly reason: PrincipalAccessDeniedReason,
    readonly subject?: PrincipalAccessSubject,
  ) {
    super(reason === 'principal-required'
      ? 'principal access requires an authenticated principal'
      : reason === 'provider-required'
        ? 'authenticated principal access requires a deployment provider'
        : 'principal may not read the requested resource')
    this.name = 'PrincipalAccessDeniedError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Deployment authorization for principal-scoped Session and Workspace reads. */
    principalAccess: PrincipalAccessService
  }
}

/** Deployment authorization Service Definition for principal-scoped resource reads. */
export class PrincipalAccessService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'principalAccess')
  }

  /**
   * Resolve the readable subset of one batched request.
   * @param _principal - Host-verified message-scoped identity.
   * @param _subjects - candidate Session and Workspace ids.
   * @param _signal - optional caller cancellation.
   * @returns requested ids the deployment authorizes for this principal.
   */
  resolve(
    _principal: AuthenticatedPrincipal,
    _subjects: PrincipalAccessSubjects,
    _signal?: AbortSignal,
  ): Promise<PrincipalAccessResult> {
    throw new Error('principal-access provider must implement resolve()')
  }
}

/**
 * Resolve principal-scoped readability with strict deployment defaults.
 * @param ctx - Host context that may carry a deployment provider.
 * @param principal - Host-verified message-scoped identity, when authenticated.
 * @param subjects - candidate Session and Workspace ids.
 * @param signal - optional caller cancellation.
 * @returns readable subsets for filtering or exact-resource checks.
 */
export async function resolvePrincipalAccess(
  ctx: Context,
  principal: AuthenticatedPrincipal | undefined,
  subjects: PrincipalAccessSubjects,
  signal?: AbortSignal,
): Promise<PrincipalAccessResult> {
  signal?.throwIfAborted()
  const provider = ctx.get('principalAccess')
  if (provider === undefined) {
    if (principal !== undefined || ctx.get('requestPrincipal') !== undefined) {
      throw new PrincipalAccessDeniedError('provider-required')
    }
    return {
      readableSessionIds: new Set(subjects.sessionIds ?? []),
      readableWorkspaceIds: new Set(subjects.workspaceIds ?? []),
    }
  }
  if (principal === undefined) throw new PrincipalAccessDeniedError('principal-required')
  const result = await provider.resolve(principal, subjects, signal)
  signal?.throwIfAborted()
  return result
}

/**
 * Require one exact resource to be present in a resolved readable subset.
 * @param result - result returned by {@link resolvePrincipalAccess}.
 * @param subject - exact Session or Workspace being read.
 */
export function requirePrincipalAccess(
  result: PrincipalAccessResult,
  subject: PrincipalAccessSubject,
): void {
  const readable = subject.kind === 'session'
    ? result.readableSessionIds.has(subject.id)
    : result.readableWorkspaceIds.has(subject.id)
  if (!readable) throw new PrincipalAccessDeniedError('subject-denied', subject)
}

export default PrincipalAccessService
