// @vitest-environment jsdom
/** ToolCallTree-owned root/subcall markers and selection projection. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ToolCallOwnerProps, ToolImagesOwnerProps, ToolTreeProps } from '../src/client/contract/slots.ts'
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
  selectedCallId?: string,
  home?: string,
  owners?: ToolCallOwnerProps[],
  imageOwners?: ToolImagesOwnerProps[],
): ToolTreeProps {
  const snapshot = {} as SessionSnapshot
  const useSession = ((selector: (value: SessionSnapshot) => unknown) => selector(snapshot)) as ToolTreeProps['useSession']
  const renderSlot = ((key: string, owner: ToolCallOwnerProps | ToolImagesOwnerProps, options?: { fallback?: React.ReactNode }) => {
    if (key === 'tool.call.result-images') {
      imageOwners?.push(owner as ToolImagesOwnerProps)
      return <div data-testid="tool-result-image" />
    }
    owners?.push(owner as ToolCallOwnerProps)
    return options?.fallback ?? null
  }) as unknown as ToolTreeProps['renderSlot']
  return {
    useSession,
    renderSlot,
    node: {
      key: `tool:${block.callId}`,
      kind: 'tool-call',
      id: block.callId,
      target: 'chat',
      anchorSeq: block.seq,
      location: { kind: 'session' },
      visibility: 'visible',
      data: { root: block },
    },
    selectedCallId,
    openFile: vi.fn(),
    inspectCall: vi.fn(),
    forkAt: vi.fn(),
    loadImage: vi.fn(() => Promise.reject(new Error('not used'))),
    fileMentions: vi.fn(),
    useHostInfo: ((selector: (info: { home: string | undefined }) => unknown) => selector({ home })) as ToolTreeProps['useHostInfo'],
    t,
  } as unknown as ToolTreeProps
}

describe('ToolCallTree', () => {
  it('owns the root marker and the generic fallback for a window-truncated call', () => {
    const block = root('w1', null)
    const view = render(<ToolCallTree {...props(block, 'w1')} />)
    const row = view.container.querySelector('[data-chat-call-id="w1"]')
    expect(row?.getAttribute('data-chat-anchor-key')).toBe('call:w1')
    expect(view.container.querySelector('[data-variant="others"]')).not.toBeNull()
    expect(view.getByText('w1')).toBeTruthy()
  })

  it('renders a current-ID leaf under its historical-ID parent', () => {
    const owners: ToolCallOwnerProps[] = []
    const leaf = {
      ...root('unrelated:ptc:7', { name: 'read', argsRaw: '{"path":"a.ts"}' }),
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
    const view = render(<ToolCallTree {...props(block, leaf.callId, undefined, owners)} />)
    const nests = view.container.querySelectorAll('[data-subcalls]')
    expect(nests[0]?.parentElement).toBe(view.container.querySelector('[data-chat-call-id="parent"]'))
    expect(nests[1]?.parentElement).toBe(view.container.querySelector('[data-chat-call-id="parent:code:1"]'))
    expect(view.container.querySelector('[data-chat-call-id="unrelated:ptc:7"]')).not.toBeNull()
    expect(nests).toHaveLength(2)
    expect(owners.map(owner => [owner.callId, owner.block.parentCallId ?? null])).toEqual([
      ['parent', null],
      ['parent:code:1', 'parent'],
      ['unrelated:ptc:7', 'parent:code:1'],
    ])
  })

  it('abbreviates a POSIX home path in the generic tool summary', () => {
    const block = root('w1', { name: 'read', argsRaw: '{"path":"/h/docs/a.ts"}' })
    const view = render(<ToolCallTree {...props(block, 'w1', '/h')} />)
    expect(view.getByText('~/docs/a.ts')).toBeTruthy()
  })

  it('renders generic root and nested result images through their authorized slot', () => {
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
      parentCallId: 'parent',
      content: [{ type: 'image' as const, attachment }],
    }
    const block = {
      ...root('parent', { name: 'run_code', argsRaw: '{"code":"return image"}' }),
      content: [{ type: 'image' as const, attachment }],
      subCalls: [child],
    }
    const imageOwners: ToolImagesOwnerProps[] = []
    const ownerProps = props(block, undefined, undefined, undefined, imageOwners)
    const view = render(<ToolCallTree {...ownerProps} />)

    expect(view.getAllByTestId('tool-result-image')).toHaveLength(2)
    expect(imageOwners).toEqual([
      { images: [{ attachment }], loadImage: ownerProps.loadImage, align: 'start' },
      { images: [{ attachment }], loadImage: ownerProps.loadImage, align: 'start' },
    ])
    expect(view.container.querySelector('[data-subcalls] [data-testid="tool-result-image"]')).not.toBeNull()
  })

  it('leaves a complete image read to its collapsed card without a second gallery', () => {
    const attachment = {
      attachmentId: 'sha256:image' as never,
      mediaType: 'image/png' as const,
      bytes: 1,
      width: 1,
      height: 1,
    }
    const block = {
      ...root('image', { name: 'read_image', argsRaw: '{"file_path":"result.png"}' }),
      content: [
        { type: 'text' as const, text: '<path>result.png</path>\n<type>image</type>\n<content>\nimage/png\n</content>' },
        { type: 'image' as const, attachment },
      ],
      meta: { path: 'result.png' },
    }
    const imageOwners: ToolImagesOwnerProps[] = []
    const view = render(<ToolCallTree {...props(block, undefined, undefined, undefined, imageOwners)} />)

    expect(view.queryByTestId('tool-result-image')).toBeNull()
    expect(imageOwners).toEqual([])
  })
})
