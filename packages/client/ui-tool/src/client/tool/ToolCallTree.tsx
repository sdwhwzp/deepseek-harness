/** Root/subcall Tool composition with one keyed atomic dispatch path. */
import { memo, useMemo, type ReactNode } from 'react'
import type { ToolCallBlock, ToolCallTarget } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallOwnerProps, ToolTreeProps } from '../contract/slots.ts'
import { GenericToolCard } from './toolviews/GenericToolCard.tsx'
import css from './ToolCallTree.module.css'

/** Resolve a Tool call's wire name from either lifecycle form. */
function callName(node: ToolCallBlock): string {
  return 'kind' in node ? node.call?.name ?? '' : node.name
}

/** Extract durable image blocks from one settled Tool result. */
function resultImages(block: ToolCallBlock) {
  if (!('kind' in block)) return []
  return block.content.flatMap(content => content.type === 'image'
    ? [{ attachment: content.attachment }]
    : [])
}

/** Build one collision-free DOM anchor for an atomic call lifecycle. */
function toolCallAnchorKey(nodeKey: string, callId: string): string {
  return `call:${JSON.stringify([nodeKey, callId])}`
}

/** One atomic call dispatched through the Tool-owned keyed slot. */
const ToolCall = memo(function ToolCall({
  renderSlot, nodeKey, rootCallSeq, callId, toolName, block, openFile, selected, cwd, home, inspectCall,
  renderMessageImages, t, children,
}: Pick<ToolTreeProps, 'renderSlot' | 'openFile' | 'cwd' | 'inspectCall' | 'renderMessageImages' | 't'> & {
  nodeKey: string
  rootCallSeq: number
  callId: string
  toolName: string
  block: ToolCallBlock
  selected: boolean
  home?: string | undefined
  children?: ReactNode
}) {
  const target = useMemo<ToolCallTarget>(
    () => ({ nodeKey, rootCallSeq, callId }),
    [callId, nodeKey, rootCallSeq],
  )
  const owner: ToolCallOwnerProps = useMemo(() => ({
    callId,
    toolName,
    block,
    openFile,
    cwd,
    home,
    inspect: () => { inspectCall(target) },
  }), [callId, toolName, block, openFile, cwd, home, inspectCall, target])
  const images = useMemo(() => resultImages(block), [block])
  return (
    <div
      className={css.callRow}
      data-chat-anchor-key={toolCallAnchorKey(nodeKey, callId)}
      data-chat-call-id={callId}
      data-chat-root-call-seq={rootCallSeq}
      data-selected={selected || undefined}
    >
      {renderSlot('tool.call.toolview', owner, {
        entryKey: toolName,
        fallback: <GenericToolCard {...owner} t={t} />,
      })}
      {images.length > 0 && (
        <div className={css.resultImages}>
          {renderMessageImages({ images, align: 'start' })}
        </div>
      )}
      {children}
    </div>
  )
})

const ToolCallBranch = memo(function ToolCallBranch({
  renderSlot, nodeKey, rootCallSeq, block, selectedToolCall, cwd, home, openFile, inspectCall, renderMessageImages, t,
}: Pick<ToolTreeProps, 'renderSlot' | 'selectedToolCall' | 'cwd' | 'openFile' | 'inspectCall' | 'renderMessageImages' | 't'> & {
  nodeKey: string
  rootCallSeq: number
  block: ToolCallBlock
  home?: string | undefined
}) {
  return (
    <ToolCall
      renderSlot={renderSlot}
      nodeKey={nodeKey}
      rootCallSeq={rootCallSeq}
      callId={block.callId}
      toolName={callName(block)}
      block={block}
      openFile={openFile}
      selected={selectedToolCall?.nodeKey === nodeKey
        && selectedToolCall.rootCallSeq === rootCallSeq
        && selectedToolCall.callId === block.callId}
      cwd={cwd}
      home={home}
      inspectCall={inspectCall}
      renderMessageImages={renderMessageImages}
      t={t}
    >
      {block.subCalls.length > 0 ? (
        <div className={css.subCalls} data-subcalls>
          {block.subCalls.map(child => (
            <ToolCallBranch
              key={child.callId}
              renderSlot={renderSlot}
              nodeKey={nodeKey}
              rootCallSeq={rootCallSeq}
              block={child}
              selectedToolCall={selectedToolCall}
              cwd={cwd}
              home={home}
              openFile={openFile}
              inspectCall={inspectCall}
              renderMessageImages={renderMessageImages}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </ToolCall>
  )
})

/**
 * Render one root Tool call and its recursive children through the same
 * atomic keyed dispatch.
 * @param props - whole-Tool owner data and the Tool-owned child-slot share.
 * @returns the Tool call tree.
 */
export function ToolCallTree({
  renderSlot, node, selectedToolCall, cwd, openFile, inspectCall, renderMessageImages,
  useHostInfo, t,
}: ToolTreeProps) {
  const home = useHostInfo(info => info.home)
  const block = node.data.root
  return (
    <ToolCallBranch
      renderSlot={renderSlot}
      nodeKey={node.key}
      rootCallSeq={node.anchorSeq}
      block={block}
      selectedToolCall={selectedToolCall}
      cwd={cwd}
      home={home}
      openFile={openFile}
      inspectCall={inspectCall}
      renderMessageImages={renderMessageImages}
      t={t}
    />
  )
}
