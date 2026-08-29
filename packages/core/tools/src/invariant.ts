/** Package-owned tool-pipeline invariants. @module @deepseek-ai/dsh-tools/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { ToolExecution, ToolExecutionResult } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-tools'

/** Cordis companion plugin name. */
export const name = 'tools-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

type ToolStage = 'pre' | 'execute' | 'post'

type DispatchPhase = 'started' | 'settled'

/** One durable nested-dispatch edge within an exact root-call lifecycle. */
interface DispatchEdge {
  rootCallId: string
  rootCallSeq: number | undefined
  phase: DispatchPhase
}

/** Whether an edge belongs to the root lifecycle named by one dispatch event. */
function belongsToRoot(
  edge: DispatchEdge,
  rootCallId: string,
  rootCallSeq: number | undefined,
): boolean {
  return edge.rootCallId === rootCallId && edge.rootCallSeq === rootCallSeq
}

/** Validate the immutable final execution/result snapshot. */
function validateResult(
  exec: Readonly<ToolExecution>,
  result: Readonly<ToolExecutionResult>,
  fail: InvariantFailure,
): void {
  if (!Object.isFrozen(exec)) fail('tools/result execution must be frozen before publication')
  if (!Object.isFrozen(result) || !Object.isFrozen(result.content)) {
    fail('tools/result outcome and content must be frozen before publication')
  }
  if (exec.name.length === 0 || String(exec.callId).length === 0) {
    fail('tools/result execution must carry non-empty name and callId')
  }
}

/** Install monotonic pipeline, final-snapshot, and code-dispatch enclosure checks. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const stages = new WeakMap<object, ToolStage>()
  const openTurns = new WeakMap<Session, number | null>()
  const dispatchEdges = new WeakMap<Session, Map<string, DispatchEdge[]>>()
  const validateDispatch = (session: Session, event: SessionEvent): void => {
    if (event.type !== 'tool/code-dispatch-start' && event.type !== 'tool/code-dispatch') return
    const root = String(event.data.rootCallId)
    const rootCallSeq = event.data.rootCallSeq
    const parent = String(event.data.parentCallId)
    const child = String(event.data.subCallId)
    if (root.length === 0 || parent.length === 0 || child.length === 0) {
      fail(`${event.type} must carry non-empty rootCallId, parentCallId, and subCallId`)
      return
    }
    if (rootCallSeq !== undefined) {
      const rootCall = session.events.find(candidate => candidate.seq === rootCallSeq)
      if (!Number.isSafeInteger(rootCallSeq)
        || rootCall?.type !== 'tool/call'
        || rootCall.seq >= event.seq
        || String(rootCall.data.callId) !== root) {
        fail(`${event.type} rootCallSeq ${String(rootCallSeq)} does not identify rootCallId ${root}`)
      }
    }
    const edges = dispatchEdges.get(session)
    const childEdges = edges?.get(child) ?? []
    if (childEdges.some(edge => edge.rootCallId !== root)) {
      fail(`${event.type} changed rootCallId for subCallId ${child}`)
    }
    const exactEdge = childEdges.find(edge => belongsToRoot(edge, root, rootCallSeq))
    if (event.type === 'tool/code-dispatch-start') {
      if (exactEdge !== undefined) {
        fail(`${event.type} repeated subCallId ${child} in one root-call lifecycle`)
      }
      if (childEdges.length > 0
        && (rootCallSeq === undefined || childEdges.some(edge => edge.rootCallSeq === undefined))) {
        fail(`${event.type} cannot distinguish reused subCallId ${child} without rootCallSeq`)
      }
    } else if (exactEdge?.phase !== 'started') {
      fail(`${event.type} subCallId ${child} has no matching start in root-call lifecycle ${root}/${String(rootCallSeq)}`)
    }
    if (parent !== root) {
      const parentEdge = edges?.get(parent)?.find(edge => belongsToRoot(edge, root, rootCallSeq))
      if (parentEdge?.phase !== 'started') {
        fail(`${event.type} parentCallId ${parent} does not belong to rootCallId ${root} at active rootCallSeq ${String(rootCallSeq)}`)
      }
    }
  }
  const commitDispatch = (session: Session, event: SessionEvent): void => {
    if (event.type !== 'tool/code-dispatch-start' && event.type !== 'tool/code-dispatch') return
    const edges = dispatchEdges.get(session) as Map<string, DispatchEdge[]>
    const child = String(event.data.subCallId)
    const root = String(event.data.rootCallId)
    const rootCallSeq = event.data.rootCallSeq
    if (event.type === 'tool/code-dispatch-start') {
      const childEdges = edges.get(child) ?? []
      childEdges.push({ rootCallId: root, rootCallSeq, phase: 'started' })
      edges.set(child, childEdges)
      return
    }
    const edge = edges.get(child)?.find(candidate => belongsToRoot(candidate, root, rootCallSeq))
    /* v8 ignore next -- validateDispatch rejects a settle without its exact start. */
    if (edge !== undefined) edge.phase = 'settled'
  }
  const seed = (session: Session): number | null => {
    let openTurn: number | null = null
    dispatchEdges.set(session, new Map())
    for (const event of session.events) {
      validateDispatch(session, event)
      commitDispatch(session, event)
      if (event.type === 'turn/start') openTurn = event.data.turn
      else if (event.type === 'turn/end') openTurn = null
      else if ((event.type === 'tool/code-dispatch-start' || event.type === 'tool/code-dispatch')
        && openTurn === null) {
        fail(`${event.type} appended outside any open turn`)
      }
    }
    openTurns.set(session, openTurn)
    return openTurn
  }
  const openTurnFor = (session: Session): number | null => openTurns.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('session/event', (session, event) => {
    validateDispatch(session, event)
    commitDispatch(session, event)
    if (event.type === 'turn/start') openTurns.set(session, event.data.turn)
    else if (event.type === 'turn/end') openTurns.set(session, null)
  }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName === 'session/event') {
      const [session, event] = args as [Session, SessionEvent]
      validateDispatch(session, event)
      if ((event.type === 'tool/code-dispatch-start' || event.type === 'tool/code-dispatch')
        && openTurnFor(session) === null) {
        fail(`${event.type} appended outside any open turn`)
      }
      return
    }
    if (eventName === 'tools/pre-execute') {
      const exec = args[0] as ToolExecution
      if (stages.has(exec)) fail('tools/pre-execute repeated for one execution')
      stages.set(exec, 'pre')
      return
    }
    if (eventName === 'tools/execute') {
      const exec = args[0] as ToolExecution
      if (stages.get(exec) !== 'pre') fail('tools/execute must follow tools/pre-execute')
      stages.set(exec, 'execute')
      return
    }
    if (eventName === 'tools/post-execute') {
      const exec = args[0] as ToolExecution
      const previous = stages.get(exec)
      if (previous !== 'pre' && previous !== 'execute') {
        fail('tools/post-execute must follow tools/pre-execute or tools/execute')
      }
      stages.set(exec, 'post')
      return
    }
    if (eventName !== 'tools/result') return
    const [exec, result] = args as [Readonly<ToolExecution>, Readonly<ToolExecutionResult>]
    validateResult(exec, result, fail)
    stages.delete(exec)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the tools invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
