// @vitest-environment jsdom
/** ToolCallTree-owned root/subcall markers and selection projection. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ToolCallTarget, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ToolCallOwnerProps, ToolTreeProps } from '../src/client/contract/slots.ts'
import { ToolCallTree } from '../src/client/tool/ToolCallTree.tsx'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

afterEach(cleanup)

const t: ToolTreeProps['t'] = makeTranslate(zh, commonZh)

const root = (callId: string, call: ToolResultNode['call']): ToolResultNode => ({
  kind: 'tool-result', seq: 3, time: 3_000, callId, call, callTime: 2_000,
  content: [], isError: false, subCalls: [],
})

function props(
  block: ToolResultNode,
  selectedToolCall?: ToolCallTarget,
  home?: string,
  owners?: ToolCallOwnerProps[],
  renderMessageImages: ToolTreeProps['renderMessageImages'] = () => null,
  options: {
    nodeKey?: string
    rootCallSeq?: number
    inspectCall?: ToolTreeProps['inspectCall']
  } = {},
): ToolTreeProps {
  const snapshot = {} as SessionSnapshot
  const useSession = ((selector: (value: SessionSnapshot) => unknown) => selector(snapshot)) as ToolTreeProps['useSession']
  const renderSlot = ((_key: string, owner: ToolCallOwnerProps, options?: { fallback?: React.ReactNode }) => {
    owners?.push(owner)
    return options?.fallback ?? null
  }) as unknown as ToolTreeProps['renderSlot']
  return {
    useSession,
    renderSlot,
    node: {
      key: options.nodeKey ?? `tool:${block.callId}`,
      kind: 'tool-call',
      id: block.callId,
      target: 'chat',
      anchorSeq: options.rootCallSeq ?? block.seq,
      location: { kind: 'session' },
      visibility: 'visible',
      data: { root: block },
    },
    selectedToolCall,
    openFile: vi.fn(),
    inspectCall: options.inspectCall ?? vi.fn(),
    renderMessageImages,
    forkAt: vi.fn(),
    fileMentions: vi.fn(),
    useHostInfo: ((selector: (info: { home: string | undefined }) => unknown) => selector({ home })) as ToolTreeProps['useHostInfo'],
    t,
  } as unknown as ToolTreeProps
}

describe('ToolCallTree', () => {
  it('owns the root marker, generic fallback, and selected state for a window-truncated call', () => {
    const block = root('w1', null)
    const view = render(<ToolCallTree {...props(block, {
      nodeKey: 'tool:w1', rootCallSeq: 3, callId: 'w1',
    })} />)
    const row = view.container.querySelector('[data-chat-call-id="w1"]')
    expect(row?.getAttribute('data-chat-anchor-key')).toBe('call:["tool:w1","w1"]')
    expect(row?.getAttribute('data-chat-root-call-seq')).toBe('3')
    expect(row?.getAttribute('data-selected')).toBe('true')
    expect(view.container.querySelector('[data-variant="others"]')).not.toBeNull()
    expect(view.getByText('w1')).toBeTruthy()
  })

  it('recursively renders a selected leaf without selecting its ancestors', () => {
    const owners: ToolCallOwnerProps[] = []
    const leaf = {
      ...root('parent:code:1:code:1', { name: 'read', argsRaw: '{"path":"a.ts"}' }),
      parentCallId: 'parent:code:1',
    }
    const child = {
      ...root('parent:code:1', { name: 'run_code', argsRaw: '{"code":"return 1"}' }),
      parentCallId: 'parent',
      subCalls: [leaf],
    }
    const block = {
      ...root('parent', { name: 'run_code', argsRaw: '{"code":"return 1"}' }),
      subCalls: [child],
    }
    const view = render(<ToolCallTree {...props(block, {
      nodeKey: 'tool:parent', rootCallSeq: 3, callId: leaf.callId,
    }, undefined, owners)} />)
    const nests = view.container.querySelectorAll('[data-subcalls]')
    expect(nests[0]?.parentElement).toBe(view.container.querySelector('[data-chat-call-id="parent"]'))
    expect(nests[1]?.parentElement).toBe(view.container.querySelector('[data-chat-call-id="parent:code:1"]'))
    expect(view.container.querySelector('[data-chat-call-id="parent"]')?.hasAttribute('data-selected')).toBe(false)
    expect(view.container.querySelector('[data-chat-call-id="parent:code:1"]')?.hasAttribute('data-selected')).toBe(false)
    expect(view.container.querySelector('[data-chat-call-id="parent:code:1:code:1"]')?.getAttribute('data-selected')).toBe('true')
    expect(nests).toHaveLength(2)
    expect(owners.map(owner => [owner.callId, owner.block.parentCallId ?? null])).toEqual([
      ['parent', null],
      ['parent:code:1', 'parent'],
      ['parent:code:1:code:1', 'parent:code:1'],
    ])
  })

  it('abbreviates a POSIX home path in the generic tool summary', () => {
    const block = root('w1', { name: 'read', argsRaw: '{"path":"/h/docs/a.ts"}' })
    const view = render(<ToolCallTree {...props(block, {
      nodeKey: 'tool:w1', rootCallSeq: 3, callId: 'w1',
    }, '/h')} />)
    expect(view.getByText('~/docs/a.ts')).toBeTruthy()
  })

  it('distinguishes repeated call ids by root lifecycle for selection and inspection', () => {
    const inspectCall = vi.fn<ToolTreeProps['inspectCall']>()
    const owners: ToolCallOwnerProps[] = []
    const first = root('same', { name: 'bash', argsRaw: '{"command":"first"}' })
    const second = { ...root('same', { name: 'bash', argsRaw: '{"command":"second"}' }), seq: 6 }
    const selected = { nodeKey: 'tool:first', rootCallSeq: 3, callId: 'same' }
    const view = render(
      <>
        <ToolCallTree {...props(first, selected, undefined, owners, () => null, {
          nodeKey: 'tool:first', rootCallSeq: 3, inspectCall,
        })} />
        <ToolCallTree {...props(second, selected, undefined, owners, () => null, {
          nodeKey: 'tool:second', rootCallSeq: 5, inspectCall,
        })} />
      </>,
    )

    const rows = view.container.querySelectorAll('[data-chat-call-id="same"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.getAttribute('data-selected')).toBe('true')
    expect(rows[1]?.hasAttribute('data-selected')).toBe(false)
    expect(rows[0]?.getAttribute('data-chat-anchor-key'))
      .not.toBe(rows[1]?.getAttribute('data-chat-anchor-key'))

    owners[0]?.inspect?.()
    owners[1]?.inspect?.()
    expect(inspectCall.mock.calls).toEqual([
      [{ nodeKey: 'tool:first', rootCallSeq: 3, callId: 'same' }],
      [{ nodeKey: 'tool:second', rootCallSeq: 5, callId: 'same' }],
    ])
  })

  it('renders every settled root and nested Tool image through the shared history gallery', () => {
    const attachment = {
      attachmentId: 'sha256:image' as never,
      mediaType: 'image/png' as const,
      bytes: 1,
      width: 1,
      height: 1,
      name: 'result.png',
    }
    const child = {
      ...root('parent:code:1', { name: 'read_image', argsRaw: '{"file_path":"result.png"}' }),
      content: [{ type: 'image' as const, attachment }],
    }
    const block = {
      ...root('parent', { name: 'run_code', argsRaw: '{"code":"return image"}' }),
      content: [{ type: 'image' as const, attachment }],
      subCalls: [child],
    }
    const imageOwners: Parameters<ToolTreeProps['renderMessageImages']>[0][] = []
    const renderMessageImages: ToolTreeProps['renderMessageImages'] = (owner) => {
      imageOwners.push(owner)
      return <div data-testid="tool-result-image" />
    }
    const view = render(
      <ToolCallTree {...props(block, undefined, undefined, undefined, renderMessageImages)} />,
    )

    expect(view.getAllByTestId('tool-result-image')).toHaveLength(2)
    expect(imageOwners).toEqual([
      { images: [{ attachment }], align: 'start' },
      { images: [{ attachment }], align: 'start' },
    ])
    expect(view.container.querySelector('[data-tool="read_image"][data-variant="read"]')).not.toBeNull()
  })
})
