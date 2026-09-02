/** Session Remote owner: cold reads, explicit Agent commands, and live control state. */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { errorChain } from '@deepseek-ai/dsh-llm'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm'
import { resolvePrincipalAccess } from '@deepseek-ai/dsh-principal-access'
import { canOpenNativePath, openNativePath } from '@deepseek-ai/dsh-native-command'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionInspection } from '@deepseek-ai/dsh-session-persistence'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  ApiSessionAgentController,
  inspectApiSession,
  type ApiSessionAgentResult,
} from './agent.ts'
import { SessionCommandController } from './commands.ts'
import { SessionControlController } from './control.ts'
import { SessionHistoryController } from './history.ts'
import { SessionFileReferences } from './file-references.ts'
import {
  ApiSessionList,
  DEFAULT_COLD_BLANK_PROBE_MAX_BYTES,
  DEFAULT_COLD_BLANK_PROBE_MAX_EVENTS,
} from './list.ts'
import { buildModelCatalog } from './catalog.ts'
import { installModelSelectionProjection } from './model-selection-projection.ts'
import { SessionSkillCatalog } from './skill-catalog.ts'
import { currentRequestPrincipal, requireReadableSession } from './principal-access.ts'
import type {
  ModelCatalog,
  SessionAttachmentRequest,
  SessionAttachmentValue,
  SessionCancelRequest,
  SessionCancelValue,
  SessionControlFrame,
  SessionCreateRequest,
  SessionCreateValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionForkRequest,
  SessionForkValue,
  SessionListRequest,
  SessionListValue,
  SessionOpenWorkspacePathRequest,
  SessionOpenWorkspacePathValue,
  SessionPage,
  SessionPageRequest,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSearchRequest,
  SessionSearchValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
} from './types.ts'

export type * from './types.ts'
export { ApiSessionNotFound } from './agent.ts'
export { SessionFileReferences } from './file-references.ts'
export { SessionSkillCatalog } from './skill-catalog.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Session business API and Remote namespace owner. */
    sessionController: SessionController
  }
}

/** Session Controller deployment policy. */
export interface Config {
  /** Maximum stat-reported event count eligible for one full cold projection observation; `0` disables the event-count gate. */
  readonly coldBlankProbeMaxEvents?: number
  /** Maximum stat-reported artifact byte size eligible for one full cold projection observation; `0` disables the byte-size gate. */
  readonly coldBlankProbeMaxBytes?: number
  /** Override platform desktop-opener detection. */
  readonly nativeOpen?: boolean
}

/** Host integrations replaceable by direct unit tests. */
export interface SessionControllerInternals {
  /** Native default-application handoff. */
  readonly openPath?: (path: string, signal: AbortSignal) => Promise<void>
  /** Native handoff availability probe. */
  readonly canOpenPath?: () => boolean
}

/** Host service backing the generated `ctx.remote.session` namespace. */
export class SessionController extends TypertRemoteService {
  static inject = [
    'agentDefaultModel',
    'agents',
    'attachments',
    'llm',
    'sessions',
    'sessionProjections',
    'sessionQuery',
    'typert',
    'workspaceRegistry',
  ]

  static Config: z<Config> = z.object({
    coldBlankProbeMaxEvents: z.natural().default(DEFAULT_COLD_BLANK_PROBE_MAX_EVENTS),
    coldBlankProbeMaxBytes: z.natural().default(DEFAULT_COLD_BLANK_PROBE_MAX_BYTES),
    nativeOpen: z.boolean(),
  })

  private readonly agents: ApiSessionAgentController
  private readonly commands: SessionCommandController
  private readonly controlState: SessionControlController
  private readonly history: SessionHistoryController
  private readonly listState: ApiSessionList
  private readonly openPath: (path: string, signal: AbortSignal) => Promise<void>
  private readonly canOpenPath: () => boolean
  private readonly promotions = new Set<Promise<void>>()

  /**
   * @param ctx - Host context containing the Session capability assembly.
   * @param config - cold-list observation and native-opener deployment policy.
   * @param internals - host integrations replaceable by direct unit tests.
   */
  constructor(ctx: Context, config: Config, internals: SessionControllerInternals = {}) {
    super(ctx, 'sessionController', { namespace: 'session' })
    installModelSelectionProjection(ctx)
    this.agents = new ApiSessionAgentController(ctx)
    this.commands = new SessionCommandController(ctx, this.agents, process.cwd())
    this.controlState = new SessionControlController(ctx)
    // Registered before history so reverse-order teardown closes every
    // follower before waiting for already-admitted promotions.
    ctx.effect(() => async () => {
      await Promise.allSettled([...this.promotions])
    }, 'session-controller.promotions')
    this.history = new SessionHistoryController(ctx, (observation) => { this.promote(observation) })
    this.listState = new ApiSessionList(ctx, {
      coldBlankProbeMaxEvents: config.coldBlankProbeMaxEvents ?? DEFAULT_COLD_BLANK_PROBE_MAX_EVENTS,
      coldBlankProbeMaxBytes: config.coldBlankProbeMaxBytes ?? DEFAULT_COLD_BLANK_PROBE_MAX_BYTES,
    })
    this.openPath = internals.openPath ?? openNativePath
    this.canOpenPath = internals.canOpenPath
      ?? (() => config.nativeOpen ?? (internals.openPath !== undefined || canOpenNativePath()))
    ctx.plugin(SessionFileReferences)
    ctx.plugin(SessionSkillCatalog)

    ctx.on('session/created', (session) => {
      ctx.emit('api-session/added', this.listState.summaryFor(session))
    })
    ctx.on('session/disposed', (session) => {
      ctx.emit('api-session/removed', session.id)
    })
    ctx.on('agent/status', ({ agent, status }) => {
      ctx.emit('api-session/status', agent.id, status === 'running')
    })
    ctx.on('agent/error', ({ agent, error }) => {
      ctx.emit('api-session/error', agent.id, errorChain(error))
    })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'request/header') {
        const agent = ctx.agents.get(session.id)
        if (agent?.session === session) this.agents.consumeSelection(
          agent,
          event.data.header.config.provider,
          event.data.header.config.model,
          event.data.header.config.reasoningEffort,
        )
      }
      if (event.type !== 'user/message' || event.data.source.kind !== 'user') return
      ctx.emit('api-session/activity', session.id, event.time)
    })
  }

  private promote(observation: SessionObservation): void {
    const sessionId = observation.header.id
    const task = (async () => {
      using ownedObservation = observation
      const result = await this.agents.resolveObservedAgent(ownedObservation)
      if ('error' in result) this.ctx.emit('api-session/error', sessionId, result.error.message)
    })().catch((error: unknown) => {
      this.ctx.logger.error(`session-controller: background activation for "${sessionId}" failed: ${errorChain(error)}`)
    })
    this.promotions.add(task)
    void task.finally(() => { this.promotions.delete(task) })
  }

  /**
   * Resolve or resume one ordinary Session for another Host API domain.
   * @param sessionId - Session identity whose Agent owns the operation.
   * @returns the live Agent or the stable Session-domain failure.
   */
  resolveAgent(sessionId: SessionId): Promise<ApiSessionAgentResult> {
    return this.agents.resolveAgent(sessionId)
  }

  /**
   * Inspect one attached or persisted Session without activating its Agent.
   * @param sessionId - durable Session identity.
   * @param signal - optional caller cancellation for persistence reads.
   * @returns the current attached state or persisted header and event prefix.
   */
  inspect(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<SessionInspection> {
    const attached = this.ctx.sessions.get(sessionId)
    if (attached !== undefined) {
      return Promise.resolve({
        meta: attached.header,
        inheritedEventCount: attached.inheritedEventCount,
        events: attached.snapshotEvents(),
      })
    }
    return inspectApiSession(this.ctx, sessionId, signal)
  }

  /**
   * Read all visible Session rows without resuming an Agent.
   * @param _request - reserved empty list request.
   * @param signal - cancellation for persistence reads.
   * @returns visible Session summaries ordered by activity.
   */
  @Remote('list')
  async list(_request: SessionListRequest, signal: AbortSignal): Promise<SessionListValue> {
    const principal = this.currentPrincipal()
    return {
      items: await this.listState.list(
        signal,
        sessionIds => this.resolveReadableSessionIds(principal, sessionIds, signal),
      ),
    }
  }

  /**
   * Search visible Session content without resuming an Agent.
   * @param request - literal message-content query.
   * @param signal - cancellation for list and search reads.
   * @returns authorized bounded Session search results.
   */
  @Remote('search')
  search(request: SessionSearchRequest, signal: AbortSignal): Promise<SessionSearchValue> {
    const principal = this.currentPrincipal()
    return this.listState.search(
      request.query,
      signal,
      sessionIds => this.resolveReadableSessionIds(principal, sessionIds, signal),
    )
  }

  /**
   * Create or idempotently adopt one ordinary Session.
   * @param request - requested identity, location, and Agent preset.
   * @returns the Session identity and resolved preset when configured.
   */
  @Remote('create')
  create(request: SessionCreateRequest): Promise<SessionCreateValue> {
    return this.commands.create(request)
  }

  /**
   * Select one Session-local model after explicitly resuming the Session.
   * @param request - Session identity and requested model selection.
   * @returns the normalized selection installed for the Session.
   */
  @Remote('selectModel')
  async selectModel(request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    await requireReadableSession(this.ctx, request.sessionId, this.currentPrincipal())
    return this.commands.selectModel(request)
  }

  /**
   * Describe every currently routable model for Host-generation selectors.
   * @returns provider-grouped models, the deployment default, and isolated provider failures.
   */
  @Remote('modelCatalog')
  modelCatalog(): Promise<ModelCatalog> {
    return buildModelCatalog(this.ctx)
  }

  /**
   * Report whether this deployment can hand a Session workspace path to a native desktop.
   * @returns true when the matching open operation is available.
   */
  @Remote
  canOpenWorkspacePath(): boolean {
    return this.canOpenPath()
  }

  /**
   * Open one path prepared by a Session-aware caller on the Host desktop.
   * @param request - path after best-effort Session workspace resolution.
   * @param signal - caller lifetime; abort terminates the native command.
   * @returns confirmation after the native opener accepts the path.
   * @throws RemoteError when the request is invalid, cancelled, or the opener fails.
   */
  @Remote('openWorkspacePath')
  async openWorkspacePath(
    request: SessionOpenWorkspacePathRequest,
    signal: AbortSignal,
  ): Promise<SessionOpenWorkspacePathValue> {
    if (request.path.length === 0) {
      throw new RemoteError(
        'gateway/bad-request',
        'session.openWorkspacePath requires a non-empty path',
        {},
      )
    }
    signal.throwIfAborted()
    await requireReadableSession(this.ctx, request.sessionId, this.currentPrincipal(), signal)
    try {
      await this.openPath(request.path, signal)
      return { opened: true }
    } catch (error: unknown) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'path open was aborted', {})
      throw new RemoteError(
        'gateway/internal',
        `path open failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
      )
    }
  }

  /**
   * Rename one Session after explicitly resuming it.
   * @param request - Session identity and proposed title.
   * @returns the accepted title and durable event sequence.
   */
  @Remote('rename')
  async rename(request: SessionRenameRequest): Promise<SessionRenameValue> {
    await requireReadableSession(this.ctx, request.sessionId, this.currentPrincipal())
    return this.commands.rename(request)
  }

  /**
   * Fork one cold-readable completed-turn prefix into a new Session.
   * @param request - source Session and optional event anchor.
   * @returns the new Session identity.
   */
  @Remote('fork')
  async fork(request: SessionForkRequest): Promise<SessionForkValue> {
    await requireReadableSession(this.ctx, request.sessionId, this.currentPrincipal())
    return this.commands.fork(request)
  }

  /**
   * Admit one prompt after explicitly resuming its Session.
   * @param request - Session identity, prompt content, source metadata, and delivery mode.
   * @param signal - caller cancellation before prompt admission begins.
   * @returns acknowledgement that the Agent accepted the prompt.
   */
  @Remote('prompt')
  async prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<SessionPromptValue> {
    signal.throwIfAborted()
    const principal = this.currentPrincipal()
    await requireReadableSession(this.ctx, request.sessionId, principal, signal)
    return this.commands.prompt(request, principal)
  }

  /**
   * Read one image proven reachable from the addressed Session log.
   * @param request - Session and attachment identities used for authorization.
   * @returns the durable attachment reference and base64-encoded bytes.
   */
  @Remote('attachment')
  async attachment(request: SessionAttachmentRequest): Promise<SessionAttachmentValue> {
    await requireReadableSession(this.ctx, request.sessionId, this.currentPrincipal())
    return this.commands.attachment(request)
  }

  /**
   * Mutate one still-pending queue occurrence on a live Agent.
   * @param request - Session, queue item, and requested mutation.
   * @returns acknowledgement that the queue mutation was applied.
   */
  @Remote('updateQueue')
  async updateQueue(request: SessionUpdateQueueRequest): Promise<SessionUpdateQueueValue> {
    await requireReadableSession(this.ctx, request.sessionId, this.currentPrincipal())
    return this.commands.updateQueue(request)
  }

  /**
   * Cancel one active Agent turn without dropping its pending inbox.
   * @param request - Session whose active Agent turn is cancelled.
   * @returns acknowledgement that cancellation was requested.
   */
  @Remote('cancel')
  async cancel(request: SessionCancelRequest): Promise<SessionCancelValue> {
    await requireReadableSession(this.ctx, request.sessionId, this.currentPrincipal())
    return this.commands.cancel(request)
  }

  /**
   * Read one cold-safe, message-aligned Session history page.
   * @param request - durable address, backward cursor, and page budget.
   * @param signal - cancellation for persistence reads.
   * @returns one chronological page.
   */
  @Remote('page')
  async page(request: SessionPageRequest, signal: AbortSignal): Promise<SessionPage> {
    await this.requireReadableAddress(request.address, this.currentPrincipal(), signal)
    return this.history.page(request, signal)
  }

  /**
   * Follow one Session log from its opening or resume cursor.
   * @param request - durable address and last committed sequence already held by the caller.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns a complete opening snapshot followed by gap-free event frames.
   */
  @Remote({ mode: 'stream' })
  follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    return this.authorizedFollow(request, this.currentPrincipal(), signal)
  }

  /**
   * Stream a complete live-control baseline followed by replacement frames.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns one complete baseline followed by live replacement frames.
   */
  @Remote({ mode: 'stream' })
  control(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    return this.authorizedControl(this.currentPrincipal(), signal)
  }

  private currentPrincipal(): AuthenticatedPrincipal | undefined {
    return currentRequestPrincipal(this.ctx)
  }

  private async resolveReadableSessionIds(
    principal: AuthenticatedPrincipal | undefined,
    sessionIds: readonly SessionId[],
    signal: AbortSignal,
  ): Promise<ReadonlySet<SessionId>> {
    return (await resolvePrincipalAccess(this.ctx, principal, { sessionIds }, signal)).readableSessionIds
  }

  private async requireReadableAddress(
    address: SessionFollowRequest['address'],
    principal: AuthenticatedPrincipal | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const sessionId = address.kind === 'session' ? address.sessionId : address.parentSessionId
    const readable = await this.resolveReadableSessionIds(principal, [sessionId], signal)
    if (readable.has(sessionId)) return
    if (address.kind === 'session') {
      throw new RemoteError('session/not-found', `session "${address.sessionId}" not found`, {
        sessionId: address.sessionId,
      })
    }
    throw new RemoteError('subagent/not-found', 'subagent is unavailable', {
      parentSessionId: address.parentSessionId,
      childSessionId: address.childSessionId,
    })
  }

  private async *authorizedFollow(
    request: SessionFollowRequest,
    principal: AuthenticatedPrincipal | undefined,
    signal: AbortSignal,
  ): AsyncIterable<SessionFollowFrame> {
    await this.requireReadableAddress(request.address, principal, signal)
    for await (const frame of this.history.follow(request, signal)) {
      await this.requireReadableAddress(request.address, principal, signal)
      yield frame
    }
  }

  private async *authorizedControl(
    principal: AuthenticatedPrincipal | undefined,
    signal: AbortSignal,
  ): AsyncIterable<SessionControlFrame> {
    for await (const frame of this.controlState.control(signal)) {
      if (frame.type === 'baseline') {
        const sessionIds = controlBaselineSessionIds(frame.value)
        const readable = await this.resolveReadableSessionIds(principal, sessionIds, signal)
        yield { type: 'baseline', value: filterControlBaseline(frame.value, readable) }
        continue
      }
      const readable = await this.resolveReadableSessionIds(principal, [frame.sessionId], signal)
      if (readable.has(frame.sessionId)) yield frame
    }
  }

}

function controlBaselineSessionIds(
  baseline: Extract<SessionControlFrame, { readonly type: 'baseline' }>['value'],
): SessionId[] {
  return [...new Set([
    ...Object.keys(baseline.queues),
    ...Object.keys(baseline.jobs),
    ...Object.keys(baseline.projections),
  ] as SessionId[])]
}

function filterRecord<T>(
  source: Readonly<Record<SessionId, T>>,
  readable: ReadonlySet<SessionId>,
): Readonly<Record<SessionId, T>> {
  const filtered = Object.create(null) as Record<SessionId, T>
  for (const sessionId of Object.keys(source) as SessionId[]) {
    if (readable.has(sessionId)) filtered[sessionId] = source[sessionId] as T
  }
  return filtered
}

function filterControlBaseline(
  baseline: Extract<SessionControlFrame, { readonly type: 'baseline' }>['value'],
  readable: ReadonlySet<SessionId>,
): Extract<SessionControlFrame, { readonly type: 'baseline' }>['value'] {
  return {
    queues: filterRecord(baseline.queues, readable),
    jobs: filterRecord(baseline.jobs, readable),
    projections: filterRecord(baseline.projections, readable),
  }
}

export { buildModelCatalog }
export default SessionController
