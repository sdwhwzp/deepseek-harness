/**
 * Deployment authorization for principal-scoped reads and trusted attachment ownership.
 * @module @deepseek-ai/dsh-principal-access
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm/message'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Resource ids whose readability a Consumer needs to resolve in one batch. */
export interface PrincipalAccessSubjects {
  /** Session ids under consideration. */
  readonly sessionIds?: readonly SessionId[]
  /** Workspace ids under consideration. */
  readonly workspaceIds?: readonly WorkspaceId[]
  /** Stored attachment ids requiring an independent account grant. */
  readonly attachmentIds?: readonly AttachmentId[]
}

/** Readable subset of one {@link PrincipalAccessSubjects} request. */
export interface PrincipalAccessResult {
  /** Requested Session ids the principal may read. */
  readonly readableSessionIds: ReadonlySet<SessionId>
  /** Requested Workspace ids the principal may read. */
  readonly readableWorkspaceIds: ReadonlySet<WorkspaceId>
  /** Requested attachments with authoritative account grants; omission denies all. */
  readonly readableAttachmentIds?: ReadonlySet<AttachmentId>
}

/** Trusted uploads being admitted to one account-owned Session. */
export interface PrincipalAttachmentGrant {
  /** Session whose current account ownership the provider must verify. */
  readonly sessionId: SessionId
  /** Ids produced from validated bytes or exact-Session upload receipts, never wire references. */
  readonly attachmentIds: readonly AttachmentId[]
}

/** One exact resource checked against a resolved access result. */
export type PrincipalAccessSubject =
  | { readonly kind: 'session'; readonly id: SessionId }
  | { readonly kind: 'workspace'; readonly id: WorkspaceId }
  | { readonly kind: 'attachment'; readonly id: AttachmentId }

/** Stable reason for a fail-closed principal-access refusal. */
export type PrincipalAccessDeniedReason =
  | 'principal-required'
  | 'provider-required'
  | 'subject-denied'
  | 'attachment-provider-required'

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
        : reason === 'attachment-provider-required'
          ? 'authenticated attachment admission requires an ownership provider'
          : 'principal may not read the requested resource')
    this.name = 'PrincipalAccessDeniedError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Deployment authorization for resource reads and trusted attachment ownership. */
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
   * @param _subjects - candidate Session, Workspace, and attachment ids.
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

  /**
   * Durably and idempotently grant trusted uploads to the current account.
   * Providers revalidate the principal and Session ownership before recording;
   * a shared content id may independently belong to multiple uploading accounts.
   * @param _principal - captured, transport-verified account identity.
   * @param _grant - validated uploads and the Session receiving them.
   * @param _signal - optional caller cancellation.
   * @returns completion after every grant is durable; failure prevents prompt delivery.
   */
  recordAttachments(
    _principal: AuthenticatedPrincipal,
    _grant: PrincipalAttachmentGrant,
    _signal?: AbortSignal,
  ): Promise<void> {
    return Promise.reject(new PrincipalAccessDeniedError('attachment-provider-required'))
  }
}

/**
 * Resolve principal-scoped readability with strict deployment defaults.
 * @param ctx - Host context that may carry a deployment provider.
 * @param principal - Host-verified message-scoped identity, when authenticated.
 * @param subjects - candidate Session, Workspace, and attachment ids.
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
      ...(subjects.attachmentIds === undefined ? {} : {
        readableAttachmentIds: new Set(subjects.attachmentIds),
      }),
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
 * @param subject - exact Session, Workspace, or attachment being read.
 */
export function requirePrincipalAccess(
  result: PrincipalAccessResult,
  subject: PrincipalAccessSubject,
): void {
  const readable = subject.kind === 'session'
    ? result.readableSessionIds.has(subject.id)
    : subject.kind === 'workspace'
      ? result.readableWorkspaceIds.has(subject.id)
      : result.readableAttachmentIds?.has(subject.id) === true
  if (!readable) throw new PrincipalAccessDeniedError('subject-denied', subject)
}

/**
 * Record ownership only for Host-validated uploads before accepting their prompt.
 * @param ctx - Host context carrying deployment authorization.
 * @param principal - captured, transport-verified account identity.
 * @param grant - trusted uploads bound to their receiving Session.
 * @param signal - optional cancellation.
 * @returns completion after durable ownership, or a fail-closed refusal.
 */
export async function recordPrincipalAttachments(
  ctx: Context,
  principal: AuthenticatedPrincipal | undefined,
  grant: PrincipalAttachmentGrant,
  signal?: AbortSignal,
): Promise<void> {
  if (grant.attachmentIds.length === 0) return
  const provider = ctx.get('principalAccess')
  const access = await resolvePrincipalAccess(ctx, principal, { sessionIds: [grant.sessionId] }, signal)
  requirePrincipalAccess(access, { kind: 'session', id: grant.sessionId })
  if (provider === undefined) return
  // resolvePrincipalAccess already rejects a missing principal with a mounted provider.
  if (principal === undefined) throw new PrincipalAccessDeniedError('principal-required')
  await provider.recordAttachments(principal, grant, signal)
  signal?.throwIfAborted()
}

export default PrincipalAccessService
