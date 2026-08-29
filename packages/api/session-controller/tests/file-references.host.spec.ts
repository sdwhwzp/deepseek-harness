import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { SessionFileReferences } from '../src/file-references.ts'

describe('SessionFileReferences', () => {
  it('delegates the resolved Agent, query, and cancellation signal unchanged', async () => {
    const ctx = new Context()
    const candidates: FileReferenceCandidate[] = [{ path: 'src', kind: 'directory' }]
    const list = vi.fn(() => Promise.resolve(candidates))
    ctx.provide('fileReferences', { list } as never)
    const adapter = new SessionFileReferences(ctx)
    const sessionId = SessionId('target')
    const agent = { id: sessionId } as unknown as Agent
    ctx.provide('sessionController', {
      resolveAgent: () => Promise.resolve({ agent }),
    } as never)
    const signal = new AbortController().signal

    await expect(adapter.list(sessionId, 'sr', signal)).resolves.toBe(candidates)
    expect(list).toHaveBeenCalledWith(agent, 'sr', signal)
  })

  it('rejects an unreadable Agent Session before invoking the file provider', async () => {
    const ctx = new Context()
    const list = vi.fn(() => Promise.resolve([]))
    ctx.provide('fileReferences', { list } as never)
    ctx.provide('typertGateway', {
      currentPrincipal: () => ({ source: 'fixture-auth', id: 'alice' }),
    } as never)
    ctx.provide('principalAccess', {
      resolve: () => Promise.resolve({
        readableSessionIds: new Set(),
        readableWorkspaceIds: new Set(),
      }),
    } as never)
    const adapter = new SessionFileReferences(ctx)
    const resolveAgent = vi.fn()
    ctx.provide('sessionController', { resolveAgent } as never)

    await expect(adapter.list(
      SessionId('hidden'),
      '',
      new AbortController().signal,
    )).rejects.toMatchObject({
      failure: { code: 'session-not-found' },
    })
    expect(resolveAgent).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })
})
