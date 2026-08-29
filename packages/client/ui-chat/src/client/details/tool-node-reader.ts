import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatNodeStore, ChatSnapshot, ToolCallBlock } from '../contract/snapshot.ts'
import type { ToolCallTarget } from '../contract/store.ts'

function toolNode(node: ReturnType<ChatNodeStore['get']>): ChatNode<'tool-call'> | undefined {
  return node?.kind === 'tool-call' ? node as ChatNode<'tool-call'> : undefined
}

function visit(block: ToolCallBlock, callId: string): ToolCallBlock | undefined {
  if (block.callId === callId) return block
  for (const child of block.subCalls) {
    const found = visit(child, callId)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Find one exact root or nested Tool lifecycle through its Conversation Node.
 * @param snapshot - current Conversation snapshot.
 * @param target - root lifecycle and atomic call identity.
 * @returns selected Tool lifecycle when materialized in the loaded window.
 */
export function findToolCall(snapshot: ChatSnapshot, target: ToolCallTarget): ToolCallBlock | undefined {
  const tool = toolNode(snapshot.nodes.get(target.nodeKey))
  if (tool === undefined || tool.anchorSeq !== target.rootCallSeq) return undefined
  return visit(tool.data.root, target.callId)
}

/**
 * Find the newest loaded lifecycle for a legacy call-id-only selection.
 * @param snapshot - current Conversation snapshot.
 * @param callId - root or nested call identity.
 * @returns newest matching Tool lifecycle when materialized in the loaded window.
 */
export function findLatestToolCall(snapshot: ChatSnapshot, callId: string): ToolCallBlock | undefined {
  let found: { anchorSeq: number; block: ToolCallBlock } | undefined
  for (const node of snapshot.nodes.values()) {
    const tool = toolNode(node)
    if (tool === undefined) continue
    const root = tool.data.root
    const candidate = visit(root, callId)
    if (candidate !== undefined && (found === undefined || tool.anchorSeq > found.anchorSeq)) {
      found = { anchorSeq: tool.anchorSeq, block: candidate }
    }
  }
  return found?.block
}
