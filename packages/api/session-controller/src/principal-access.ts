/** Principal-scoped authorization shared by Session-addressed Remote services. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/types'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm'
import { resolvePrincipalAccess } from '@deepseek-ai/dsh-principal-access'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

/**
 * Read the transport-verified principal active for one Remote invocation.
 * @param ctx - Host context carrying the optional Gateway.
 * @returns the authenticated principal, or undefined for local-anonymous calls.
 */
export function currentRequestPrincipal(ctx: Context): AuthenticatedPrincipal | undefined {
  return ctx.get('typertGateway')?.currentPrincipal()
}

/**
 * Require one Session to remain readable before a Session-addressed operation.
 * @param ctx - Host context carrying deployment authorization.
 * @param sessionId - exact Session being observed or mutated.
 * @param principal - transport-verified caller captured for the operation.
 * @param signal - optional caller cancellation.
 * @throws PrincipalAccessDeniedError for incomplete authenticated composition.
 * @throws RemoteError with `session/not-found` when the provider omits the Session.
 */
export async function requireReadableSession(
  ctx: Context,
  sessionId: SessionId,
  principal: AuthenticatedPrincipal | undefined,
  signal?: AbortSignal,
): Promise<void> {
  const readable = await resolvePrincipalAccess(ctx, principal, { sessionIds: [sessionId] }, signal)
  if (readable.readableSessionIds.has(sessionId)) return
  throw new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId })
}
