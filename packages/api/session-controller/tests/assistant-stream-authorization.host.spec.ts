/** Principal revalidation and ordered delivery while assistant frames await authorization. */

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import { LlmAttemptId, type AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm'
import {
  PrincipalAccessService,
  type PrincipalAccessResult,
  type PrincipalAccessSubjects,
} from '@deepseek-ai/dsh-principal-access'
import SessionStore from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import type { SessionAssistantStreamFrame, SessionFollowFrame } from '../src/types.ts'
import { createSessionTestController } from './test-remote.ts'

const principal: AuthenticatedPrincipal = {
  source: 'fixture-auth', id: 'stream-reader', username: 'reader', role: 'user',
}

class DelayedPrincipalAccess extends PrincipalAccessService {
  active = true
  owner = principal.id
  calls = 0
  private gate: ReturnType<DelayedPrincipalAccess['holdNext']> | undefined

  holdNext() {
    const gate = {
      entered: Promise.withResolvers<undefined>(),
      release: Promise.withResolvers<undefined>(),
    }
    this.gate = gate
    return gate
  }

  override async resolve(
    candidate: AuthenticatedPrincipal,
    subjects: PrincipalAccessSubjects,
    signal?: AbortSignal,
  ): Promise<PrincipalAccessResult> {
    this.calls += 1
    const gate = this.gate
    this.gate = undefined
    if (gate !== undefined) {
      gate.entered.resolve(undefined)
      await gate.release.promise
    }
    signal?.throwIfAborted()
    return {
      readableSessionIds: new Set(
        this.active && candidate.id === this.owner ? subjects.sessionIds : [],
      ),
      readableWorkspaceIds: new Set(),
    }
  }
}

async function harness(batch: boolean) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  const session = ctx.sessions.create(undefined, { meta: { cwd: '/workspace' } })
  const agent = { id: session.id, session, status: 'running', ctx } as Agent
  ctx.provide('typertGateway', { currentPrincipal: () => principal } as never)
  const access = new DelayedPrincipalAccess(ctx)
  const controller = createSessionTestController(ctx, {
    defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
    cwd: '/workspace',
  })
  const abort = new AbortController()
  const iterator = controller.follow({
    address: { kind: 'session', sessionId: session.id },
    assistantStream: true,
    ...(batch ? { assistantStreamBatch: true as const } : {}),
  }, abort.signal)[Symbol.asyncIterator]()
  await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'snapshot' } })
  const emit = (frame: AssistantStreamFrame): void => {
    ctx.emit('agent/assistant-stream', { agent, frame })
  }
  const close = async (): Promise<void> => {
    abort.abort()
    await iterator.return?.()
    await ctx.fiber.dispose()
  }
  return { ctx, session, access, iterator, abort, emit, close }
}

function presentationFrames(value: SessionFollowFrame): readonly SessionAssistantStreamFrame[] {
  if (value.type === 'assistant-stream') return [value.frame]
  if (value.type === 'assistant-stream-batch') return value.frames
  return []
}

describe('assistant follow authorization', () => {
  it('drains a queued assistant attempt with fewer fresh checks and identical durable ordering', async () => {
    const counts: number[] = []
    const outputs: unknown[][] = []
    for (const batch of [false, true]) {
      const test = await harness(batch)
      const gate = test.access.holdNext()
      const attemptId = LlmAttemptId('queued-auth-attempt')
      const start: AssistantStreamFrame = { type: 'start', attemptId, revision: 1, turn: 1, step: 1 }
      test.emit(start)
      const pending = test.iterator.next()
      try {
        await gate.entered.promise
        const count = 1610
        const expected: unknown[] = [{ ...start, startedAfterSeq: -1 }]
        for (let index = 0; index < count; index += 1) {
          const chunk: AssistantStreamFrame = {
            type: 'chunk', attemptId, revision: index + 2, index, time: index,
            chunk: { type: 'text-delta', index: 0, text: `${String(index)}|` },
          }
          test.emit(chunk)
          expected.push(chunk)
        }
        const durable = test.session.append('turn/start', { turn: 1 })
        expected.push({ durableSeq: durable.seq })
        const end: AssistantStreamFrame = {
          type: 'end', attemptId, revision: count + 2, index: count,
          outcome: { kind: 'abandoned' },
        }
        test.emit(end)
        expected.push(end)
        gate.release.resolve(undefined)

        const actual: unknown[] = []
        let next = await pending
        let wireFrames = 0
        while (!next.done) {
          wireFrames += 1
          if (next.value.type === 'event') actual.push({ durableSeq: next.value.event.seq })
          const frames = presentationFrames(next.value)
          actual.push(...frames)
          if (frames.some(frame => frame.type === 'end')) break
          next = await test.iterator.next()
        }
        expect(actual).toEqual(expected)
        // Opening authorization and its snapshot are separate from every later wire publication.
        expect(test.access.calls).toBe(wireFrames + 2)
        counts.push(test.access.calls)
        outputs.push(actual)
      } finally {
        gate.release.resolve(undefined)
        await test.close()
      }
    }
    expect(outputs[1]).toEqual(outputs[0])
    expect(counts[0]).toBe(1615)
    expect(counts[1]).toBe(18)
  })

  it.each(['account disabled', 'ownership changed'] as const)(
    'rejects every queued frame when %s during the next publication check',
    async (change) => {
      const test = await harness(true)
      const gate = test.access.holdNext()
      const attemptId = LlmAttemptId('revoked-auth-attempt')
      test.emit({ type: 'start', attemptId, revision: 1, turn: 1, step: 1 })
      for (let index = 0; index < 10; index += 1) {
        test.emit({
          type: 'chunk', attemptId, revision: index + 2, index, time: index,
          chunk: { type: 'text-delta', index: 0, text: 'private' },
        })
      }
      const pending = test.iterator.next()
      try {
        await gate.entered.promise
        if (change === 'account disabled') test.access.active = false
        else test.access.owner = 'other-account'
        const rejected = expect(pending).rejects.toMatchObject({
          code: 'session/not-found', details: { sessionId: test.session.id },
        })
        gate.release.resolve(undefined)
        await rejected
        await expect(test.iterator.next()).resolves.toEqual({ done: true, value: undefined })
      } finally {
        gate.release.resolve(undefined)
        await test.close()
      }
    },
  )

  it('publishes an isolated frame immediately and bounds a queued batch by frame count', async () => {
    const test = await harness(true)
    const attemptId = LlmAttemptId('bounded-auth-attempt')
    const start: AssistantStreamFrame = { type: 'start', attemptId, revision: 1, turn: 1, step: 1 }
    try {
      test.emit(start)
      await expect(test.iterator.next()).resolves.toEqual({
        done: false,
        value: { type: 'assistant-stream', frame: { ...start, startedAfterSeq: -1 } },
      })
      const chunks: AssistantStreamFrame[] = []
      for (let index = 0; index < 129; index += 1) {
        const chunk: AssistantStreamFrame = {
          type: 'chunk', attemptId, revision: index + 2, index, time: index,
          chunk: { type: 'text-delta', index: 0, text: 'bounded' },
        }
        chunks.push(chunk)
        test.emit(chunk)
      }
      await expect(test.iterator.next()).resolves.toEqual({
        done: false, value: { type: 'assistant-stream-batch', frames: chunks.slice(0, 128) },
      })
      await expect(test.iterator.next()).resolves.toEqual({
        done: false, value: { type: 'assistant-stream', frame: chunks[128] },
      })
    } finally {
      await test.close()
    }
  })

  it.each([0, 1])('counts the complete UTF-8 batch envelope at its byte limit plus %i', async (extra) => {
    const test = await harness(true)
    const attemptId = LlmAttemptId('byte-bounded-attempt')
    try {
      test.emit({ type: 'start', attemptId, revision: 1, turn: 1, step: 1 })
      await test.iterator.next()
      const chunks = [0, 1].map(index => ({
        type: 'chunk' as const, attemptId, revision: index + 2, index, time: index,
        chunk: { type: 'text-delta' as const, index: 0, text: '' },
      }))
      const emptyBytes = Buffer.byteLength(JSON.stringify({ type: 'assistant-stream-batch', frames: chunks }))
      const textBytes = 64 * 1024 - emptyBytes + extra
      chunks[0]!.chunk.text = '你'.repeat(Math.floor(textBytes / 3)) + 'x'.repeat(textBytes % 3)
      for (const chunk of chunks) test.emit(chunk)
      const expected = { type: 'assistant-stream-batch', frames: chunks }
      expect(Buffer.byteLength(JSON.stringify(expected))).toBe(64 * 1024 + extra)
      if (extra === 0) {
        await expect(test.iterator.next()).resolves.toEqual({ done: false, value: expected })
      } else {
        for (const chunk of chunks) {
          await expect(test.iterator.next()).resolves.toEqual({
            done: false, value: { type: 'assistant-stream', frame: chunk },
          })
        }
      }
    } finally {
      await test.close()
    }
  })

  it('preserves an oversized individual frame without absorbing its successor', async () => {
    const test = await harness(true)
    const attemptId = LlmAttemptId('large-individual-attempt')
    try {
      test.emit({ type: 'start', attemptId, revision: 1, turn: 1, step: 1 })
      await test.iterator.next()
      const chunks = [
        { type: 'text-delta' as const, index: 0, text: '你'.repeat(64 * 1024) },
        { type: 'text-delta' as const, index: 0, text: 'next' },
      ].map((chunk, index): AssistantStreamFrame => ({
        type: 'chunk', attemptId, revision: index + 2, index, time: index, chunk,
      }))
      for (const chunk of chunks) test.emit(chunk)
      for (const chunk of chunks) {
        await expect(test.iterator.next()).resolves.toEqual({
          done: false, value: { type: 'assistant-stream', frame: chunk },
        })
      }
    } finally {
      await test.close()
    }
  })
})
