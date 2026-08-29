/** Chat-owned selection state shared by the transcript and details panel. */

import type { TurnProcessGeneration } from './turn-process.ts'

/** Tool call identity as carried by Chat nodes. */
export type ToolCallId = string

/** Exact atomic Tool call inside one root Conversation lifecycle. */
export interface ToolCallTarget {
  /** Stable root `tool-call` Conversation Node key. */
  readonly nodeKey: string
  /** Root Tool call start seq, also used by trajectory projection. */
  readonly rootCallSeq: number
  /** Root or nested Tool call identity within that lifecycle. */
  readonly callId: ToolCallId
}

/** Selection target for the Chat details linkage channel. */
export interface SelectionTarget {
  turnSeq: number
  stepSeq?: number
  /** Exact Tool lifecycle selected by current callers. */
  toolCall?: ToolCallTarget
  /** Legacy fallback when the caller cannot identify the root lifecycle. */
  callId?: ToolCallId
  toolName?: string
}

/** One manually expanded Turn answer generation. */
export interface TurnProcessViewEntry {
  readonly turn: number
  readonly generation: TurnProcessGeneration
}

/** Per-Session state shared only by the Chat view and details surface. */
export interface ChatStoreState {
  selection: SelectionTarget | null
  turnProcesses: TurnProcessViewEntry[]
}
