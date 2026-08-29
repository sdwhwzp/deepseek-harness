/** Session Controller adapter for Agent-scoped file-reference discovery. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-file-reference'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { currentRequestPrincipal, requireReadableSession } from './principal-access.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `fileReferences` Remote namespace. */
    sessionFileReferences: SessionFileReferences
  }
}

/** Host Remote adapter over the composed file-reference provider. */
export class SessionFileReferences extends TypertRemoteService {
  static inject = ['fileReferences', 'sessionController', 'typert']

  /** @param ctx - Host context carrying the selected file-reference provider. */
  constructor(ctx: Context) {
    super(ctx, 'sessionFileReferences', { namespace: 'fileReferences' })
  }

  /**
   * List file and directory candidates for one authorized Agent's working directory.
   * @param sessionId - target Session authorized before its Agent is resolved or resumed.
   * @param query - path text following `@` or `@"`.
   * @param signal - caller cancellation.
   * @returns deterministic path-only candidates from the composed provider.
   */
  @Remote
  async list(
    sessionId: SessionId,
    query: string,
    signal: AbortSignal,
  ): Promise<FileReferenceCandidate[]> {
    await requireReadableSession(this.ctx, sessionId, currentRequestPrincipal(this.ctx), signal)
    const resolved = await this.ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) throw new TypertRemoteFailure(resolved.error)
    return this.ctx.fileReferences.list(resolved.agent, query, signal)
  }
}

export default SessionFileReferences
