import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm'

const principalKey = Symbol.for('@deepseek-ai/dsh-host-apiproxy/authenticated-principal')

/**
 * Bind a provider-validated principal to one in-process Request object. The
 * association cannot be serialized or supplied by a browser payload.
 * @param request - request entering the Host carrier.
 * @param principal - identity returned by the configured authentication provider.
 * @returns the unchanged request for fluent carrier composition.
 */
export function bindAuthenticatedPrincipal(
  request: Request,
  principal: AuthenticatedPrincipal,
): Request {
  const snapshot = authenticatedPrincipal(principal)
  Object.defineProperty(request, principalKey, {
    configurable: false,
    enumerable: false,
    value: snapshot,
    writable: false,
  })
  return request
}

/**
 * Read the trusted identity previously bound to a Request.
 * @param request - request that may carry a provider-validated principal.
 * @returns a detached authenticated principal, or `undefined` when none was bound.
 */
export function authenticatedPrincipalOf(request: Request): AuthenticatedPrincipal | undefined {
  return (request as Request & { [principalKey]?: AuthenticatedPrincipal })[principalKey]
}

/** Validate and detach one authentication-provider result. */
function authenticatedPrincipal(value: unknown): AuthenticatedPrincipal {
  if (value === null || typeof value !== 'object') throw new Error('authenticated principal must be an object')
  const candidate = value as Record<string, unknown>
  if (!nonEmpty(candidate.source, 64)) throw new Error('authenticated principal source is invalid')
  if (!nonEmpty(candidate.id, 256)) throw new Error('authenticated principal id is invalid')
  if (!nonEmpty(candidate.username, 256)) throw new Error('authenticated principal username is invalid')
  if (candidate.role !== 'admin' && candidate.role !== 'user') throw new Error('authenticated principal role is invalid')
  return Object.freeze({ source: candidate.source, id: candidate.id, username: candidate.username, role: candidate.role })
}

function nonEmpty(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}
