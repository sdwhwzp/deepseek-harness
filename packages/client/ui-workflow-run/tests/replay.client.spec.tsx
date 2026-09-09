// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationNodeDefinition, ConversationViewDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionListState, SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import { chatSnapshot, conversationSnapshot, makeTranslate, sessionSnapshot, workspaceSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import { WorkflowRunPanel, type WorkflowRunPanelProps } from '../src/client/WorkflowRunPanel.tsx'
import { zh } from '../src/client/locales.ts'
import { workflowRunDefinition, type WorkflowRunChatData } from '../src/client/workflow-definition.ts'
// A real released run, redacted to its structure and timings: six members
// started together, five settled inside 90 seconds while one stayed running
// for another two and a half minutes before the operator aborted.
import window from './replay-window.json'

afterEach(cleanup)
const PARENT_ID = 'a89b013b-dd83-4b23-8158-b99c7d677dce' as SessionId
const useResource = (() => ({
  status: 'none' as const, value: undefined, failure: undefined, reload: () => {},
})) as GlobalStandardProps['useResource']

interface ChatSnapshot { readonly nodes: ReadonlyMap<string, ChatConversationViewNode> }
class Defs {
  entries(): readonly ConversationNodeDefinition[] { return [workflowRunDefinition] }
  fallbackEntry(): undefined { return undefined }
}
const chatView: ConversationViewDefinition<ChatConversationViewNode, ChatSnapshot> = {
  target: 'chat',
  create: () => {
    let nodes = new Map<string, ChatConversationViewNode>()
    return {
      empty: { nodes },
      replace: ({ nodes: values }) => { nodes = new Map(values.map(n => [n.key, n])); return { nodes } },
      apply: ({ upserts }) => { nodes = new Map(nodes); for (const n of upserts) nodes.set(n.key, n); return { nodes } },
    }
  },
}
class Views { entries(): readonly ConversationViewDefinition[] { return [chatView] } }

const entries: SessionLiveEventEntry[] = (window as SessionEvent[])
  .map(event => ({ type: 'event', event }))
const childIds = (window as { type: string; data: { childId?: string } }[])
  .filter(e => e.type === 'tool-workflow/agent-start')
  .map(e => e.data.childId as SessionId)

/** The session list as the browser held it while the run was live: six running subagent children of the current Session. */
function liveList(): SessionListState {
  const byId: SessionListState['byId'] = {
    [PARENT_ID]: { id: PARENT_ID, displayTitle: 'parent', running: true, blank: false, updatedAt: 0 },
  }
  for (const id of childIds) {
    byId[id] = {
      id, displayTitle: id, parentId: PARENT_ID, origin: 'subagent',
      running: true, blank: false, updatedAt: 0,
    }
  }
  return {
    ids: [PARENT_ID, ...childIds], byId, current: PARENT_ID, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }
}

function props(node: ChatConversationViewNode, sessions: SessionListState): WorkflowRunPanelProps {
  const attention = new Map<SessionId, never>()
  return {
    node: node as WorkflowRunPanelProps['node'], sessionId: PARENT_ID,
    useSessions: s => s(sessions), useResource,
    useSessionPendingInteraction: s => s(attention),
    useSession: s => s(sessionSnapshot(PARENT_ID)),
    useProjection: () => undefined,
    useConversation: s => s(conversationSnapshot()),
    useChat: s => s(chatSnapshot()),
    useTrajectory: s => s({
      eventNodes: [], eventLocations: new Map(), requests: [],
      callSchemas: new Map(), partial: null, runningCalls: [],
    }),
    useInput: () => { throw new Error('unused') },
    inputActions: {
      setDraft: () => {}, addAttachments: () => false, removeAttachment: () => {},
      pruneAttachments: () => {}, submit: () => {},
    },
    useWorkspaces: s => s(workspaceSnapshot()),
    useTurnData: () => undefined,
    openFile: () => {}, inspectCall: () => {}, forkAt: () => {},
    loadImage: () => Promise.reject(new Error('not used')), renderMessageImages: () => null, fileMentions: () => undefined,
    openSession: vi.fn(), t: makeTranslate(zh),
  }
}

describe('replay of the 2026-09-09 18:53 production run (6 members, 5 rate-limited, user abort)', () => {
  it('folds live, event by event, and renders after every step with the children still running', () => {
    const assembler = new ConversationNodeAssembler(new Defs(), new Views())
    // The browser opened the Session with the history before the run, then
    // received every later event live.
    const opened = entries.findIndex(e => e.event.type === 'tool-workflow/run-start')
    assembler.replaceWindow(entries.slice(0, opened), false)
    assembler.activateTarget('chat')
    assembler.flush()
    const sessions = liveList()
    let rendered = 0
    for (let i = opened; i < entries.length; i++) {
      assembler.append(entries[i]!)
      assembler.flush()
      const snapshot = assembler.snapshot('chat') as ChatSnapshot
      const node = [...snapshot.nodes.values()][0]
      if (node === undefined) continue
      const view = render(<WorkflowRunPanel {...props(node, sessions)} />)
      rendered++
      view.unmount()
    }
    expect(rendered).toBeGreaterThan(10)
    const final = [...(assembler.snapshot('chat') as ChatSnapshot).nodes.values()][0]?.data as WorkflowRunChatData
    expect(final.name).toBe('ocr-fanout')
    expect(final.status).toBe('cancelled')
    expect(final.phases[0]?.members.map(m => m.status)).toEqual(['failed', 'failed', 'failed', 'failed', 'failed', 'cancelled'])
  })

  it('renders the six-member run with the children running and the rows interactive', () => {
    const assembler = new ConversationNodeAssembler(new Defs(), new Views())
    // Up to the last agent-start: what the browser had at 18:53:39.
    const upToStarts = entries.findIndex(e => e.event.type === 'tool-workflow/agent-end')
    assembler.replaceWindow(entries.slice(0, upToStarts), false)
    assembler.activateTarget('chat')
    const node = [...(assembler.snapshot('chat') as ChatSnapshot).nodes.values()][0]!
    render(<WorkflowRunPanel {...props(node, liveList())} />)
    expect(screen.getByRole('button', { name: /ocr-fanout/ })).toBeTruthy()
    for (const label of ['p1_recv', 'p2_recv', 'p1_proj', 'p2_proj', 'p1_full', 'p2_full']) expect(screen.getByText(label)).toBeTruthy()
  })

  it('shows a running member\'s elapsed time advancing while nothing else changes', () => {
    vi.useFakeTimers()
    try {
      const assembler = new ConversationNodeAssembler(new Defs(), new Views())
      const upToStarts = entries.findIndex(e => e.event.type === 'tool-workflow/agent-end')
      const started = entries[upToStarts - 1]!.event.time
      // The gap the operator saw: members started, and for the next minutes the
      // log carries nothing at all.
      vi.setSystemTime(started + 1_000)
      assembler.replaceWindow(entries.slice(0, upToStarts), false)
      assembler.activateTarget('chat')
      const node = [...(assembler.snapshot('chat') as ChatSnapshot).nodes.values()][0]!
      render(<WorkflowRunPanel {...props(node, liveList())} />)

      const elapsed = () => [...document.querySelectorAll('[data-member-elapsed]')].map(e => e.textContent)
      expect(elapsed()).toEqual(Array.from({ length: 6 }, () => '1 秒'))
      act(() => { vi.advanceTimersByTime(44_000) })
      expect(elapsed()).toEqual(Array.from({ length: 6 }, () => '45 秒'))
      act(() => { vi.advanceTimersByTime(45_000) })
      expect(elapsed()).toEqual(Array.from({ length: 6 }, () => '1 分 30 秒'))
      // A running member the browser can open advertises that it is openable.
      expect(document.querySelectorAll('[data-member-open-hint]').length).toBe(6)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops ticking once every member has settled', () => {
    vi.useFakeTimers()
    try {
      const assembler = new ConversationNodeAssembler(new Defs(), new Views())
      assembler.replaceWindow(entries, false)
      assembler.activateTarget('chat')
      const node = [...(assembler.snapshot('chat') as ChatSnapshot).nodes.values()][0]!
      render(<WorkflowRunPanel {...props(node, liveList())} />)
      expect(document.querySelectorAll('[data-member-elapsed]').length).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
