/** Web workspace-file reference discovery, projection, codec, and lifecycle coverage. */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  CandidateRequest, ClientSessionContext, InputTriggerCandidate, InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const sid = (value: string): SessionId => value as SessionId
const session: ClientSessionContext = { sessionId: sid('target') }

type RemoteEnvelope<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: object } }

type RemoteLookup<T> = (
  agentId: SessionId,
  query: string,
  signal?: AbortSignal,
) => Promise<RemoteEnvelope<T[]>>

function request(
  query: string,
  options: { quoted?: boolean; signal?: AbortSignal } = {},
): CandidateRequest {
  return {
    query,
    quoted: options.quoted ?? false,
    position: 'inline',
    drilled: false,
    signal: options.signal ?? new AbortController().signal,
  }
}

async function bench(
  files: RemoteLookup<FileReferenceCandidate> = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: [
      { path: 'src', kind: 'directory' as const },
      { path: 'docs/a b.md', kind: 'file' as const },
    ],
  })),
): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']>; source: InputTriggerSource }> {
  const ctx = new Context()
  let source: InputTriggerSource | undefined
  ctx.provide('inputTriggers', {
    registerSource(candidate: InputTriggerSource) {
      source = candidate
      return () => { source = undefined }
    },
  })
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.fileReferences', { list: files })
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  if (source === undefined) throw new Error('reference source was not registered')
  return { ctx, fiber, source }
}

describe('apply', () => {
  it('declares its services and releases the @ reference registration on disposal', async () => {
    expect(inject).toEqual([
      'inputTriggers', 'locale', 'remote', 'remote.fileReferences',
    ])
    const { fiber } = await bench()
    let registered: InputTriggerSource | undefined
    const ctx = new Context()
    ctx.provide('inputTriggers', {
      registerSource(source: InputTriggerSource) {
        registered = source
        return () => { registered = undefined }
      },
    })
    class RemoteService extends Service {
      constructor(serviceCtx: Context) {
        super(serviceCtx, 'remote')
      }
    }
    new RemoteService(ctx)
    ctx.provide('remote.fileReferences', { list: () => Promise.resolve({ ok: true, value: [] }) })
    ctx.provide('locale', new LocaleRuntime(ctx))
    const ownFiber = ctx.plugin({ inject: [...inject], apply })
    await ownFiber.await()
    expect(registered).toMatchObject({ trigger: '@', name: 'reference', showGroupTitle: false })
    await ownFiber.dispose()
    expect(registered).toBeUndefined()
    await fiber.dispose()
  })

  it('the node half applies without host-side behavior', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})

describe('candidates', () => {
  it('queries the current session workspace and renders stable file and folder labels', async () => {
    const files = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: [
        { path: 'src', kind: 'directory' as const },
        { path: 'docs/a b.md', kind: 'file' as const },
      ],
    }))
    const { source } = await bench(files)
    const signal = new AbortController().signal
    await expect(source.candidates(session, request('re', { signal }))).resolves.toEqual([
      {
        name: 'src/',
        icon: 'folder',
        section: 'Files & folders',
        value: JSON.stringify({ kind: 'file', fileKind: 'directory', label: 'src', mention: '@src/' }),
        drill: true,
      },
      expect.objectContaining({
        name: 'a b.md',
        description: 'docs',
        icon: 'file',
        section: 'Files & folders',
      }),
    ])
    expect(files).toHaveBeenCalledWith(sid('target'), 're', signal)
  })

  it('preserves an open quoted path and degrades a failed lookup to no candidates', async () => {
    const files = vi.fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: [{ path: 'README.md', kind: 'file' as const }],
      })
      .mockResolvedValueOnce({
        ok: false as const,
        error: new RemoteError('gateway/internal', 'file scan failed', {}),
      })
    const { source } = await bench(files)
    const quoted = await source.candidates(session, request('READ', { quoted: true }))
    expect(quoted).toEqual([expect.objectContaining({ name: 'README.md', icon: 'file' })])
    expect(source.onPick({
      candidate: quoted[0]!,
      session,
      position: 'inline',
      via: 'menu',
      action: 'pick',
      span: { start: 0, end: 6, draftRev: 1 },
    })).toEqual({
      insert: {
        source: 'reference',
        ref: '@"README.md"',
        label: 'README.md',
        appearance: 'file',
        clipboardText: '@"README.md"',
      },
    })
    await expect(source.candidates(session, request('research'))).resolves.toEqual([])
  })

  it('drops a completed result when the query signal was superseded', async () => {
    const controller = new AbortController()
    const { source } = await bench()
    const pending = source.candidates(session, request('', { signal: controller.signal }))
    controller.abort()
    await expect(pending).resolves.toEqual([])
  })

  it('treats Remote failures as empty results and filters paths that cannot be mentioned', async () => {
    const files = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: [{ path: 'bad\nname', kind: 'file' as const }],
    }))
    const { source } = await bench(files)
    await expect(source.candidates(session, request('bad'))).resolves.toEqual([])

    files.mockResolvedValueOnce({
      ok: false as const,
      error: new RemoteError('gateway/internal', 'file lookup failed', {}),
    } as never)
    await expect(source.candidates(session, request('bad'))).resolves.toEqual([])
  })
})

describe('directory header', () => {
  const drilledRequest = (query: string, quoted = false): CandidateRequest => ({
    query,
    quoted,
    position: 'inline',
    drilled: true,
    signal: new AbortController().signal,
  })

  it('publishes no header for a query the user typed', async () => {
    const { source } = await bench()
    expect(source.header?.(session, { query: 'src/module1/', drilled: false })).toBeUndefined()
  })

  it('publishes no header until a drilled query names a directory', async () => {
    const { source } = await bench()
    expect(source.header?.(session, { query: 'src', drilled: true })).toBeUndefined()
  })

  it('trails the workspace root down to the directory being listed', async () => {
    const { source } = await bench()
    expect(source.header?.(session, { query: 'src/module1/ind', drilled: true })).toEqual([
      { label: 'Workspace', value: JSON.stringify({ kind: 'file', fileKind: 'directory', label: 'Workspace', mention: '@' }) },
      { label: 'src', value: JSON.stringify({ kind: 'file', fileKind: 'directory', label: 'src', mention: '@src/' }) },
      {
        label: 'module1',
        value: JSON.stringify({ kind: 'file', fileKind: 'directory', label: 'module1', mention: '@src/module1/' }),
        current: true,
      },
    ])
  })

  it('keeps an open quote across every crumb of a quoted descent', async () => {
    const { source } = await bench()
    const crumbs = source.header?.(session, { query: 'my dir/sub/', quoted: true, drilled: true })
    expect(crumbs?.map(crumb => JSON.parse(crumb.value) as { mention: string }).map(value => value.mention))
      .toEqual(['@"', '@"my dir/', '@"my dir/sub/'])
  })

  it('publishes no header when a segment cannot be written back as mention text', async () => {
    const { source } = await bench()
    expect(source.header?.(session, { query: 'ok/we\u0001ird/', drilled: true })).toBeUndefined()
  })

  it('returns to a crumb through the same drill outcome a folder row uses', async () => {
    const { source } = await bench()
    const crumbs = source.header?.(session, { query: 'src/module1/', drilled: true })
    expect(source.onPick({
      candidate: { name: 'src', value: crumbs?.[1]?.value ?? '' },
      session,
      position: 'inline',
      via: 'menu',
      action: 'drill',
      span: { start: 0, end: 13, draftRev: 1 },
    })).toEqual({ text: '@src/', continue: true })
  })

  it('drops the row location a drilled listing already shows in its header', async () => {
    const files = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: [{ path: 'src/module1/index.html', kind: 'file' as const }],
    }))
    const { source } = await bench(files)
    await expect(source.candidates(session, drilledRequest('src/module1/'))).resolves.toEqual([
      expect.objectContaining({ name: 'index.html', icon: 'file' }),
    ])
    const [row] = await source.candidates(session, drilledRequest('src/module1/'))
    expect(row).not.toHaveProperty('description')
  })
})

describe('pick and codec', () => {
  const pickAs = (action: 'pick' | 'drill') =>
    (source: InputTriggerSource, candidate: InputTriggerCandidate) => source.onPick({
      candidate,
      session,
      position: 'inline',
      via: 'menu',
      action,
      span: { start: 0, end: 1, draftRev: 1 },
    })
  const pick = pickAs('pick')
  const drill = pickAs('drill')

  it('settles files and directories as atomic icon labels; drill keeps directory completion open', async () => {
    const { source } = await bench()
    const [directory, file] = await source.candidates(session, request(''))
    expect(directory?.drill).toBe(true)
    expect(file?.drill).toBeUndefined()
    expect(pick(source, directory!)).toEqual({
      insert: {
        source: 'reference',
        ref: '@src/',
        label: 'src/',
        appearance: 'folder',
        clipboardText: '@src/',
      },
    })
    expect(drill(source, directory!)).toEqual({ text: '@src/', continue: true })
    expect(pick(source, file!)).toEqual({
      insert: {
        source: 'reference',
        ref: '@"docs/a b.md"',
        label: 'a b.md',
        appearance: 'file',
        clipboardText: '@"docs/a b.md"',
      },
    })
    const [quotedDirectory] = await source.candidates(session, request('', { quoted: true }))
    expect(drill(source, quotedDirectory!)).toEqual({ text: '@"src/', continue: true })
  })

  it('ignores candidates that do not carry a source-owned value', async () => {
    const { source } = await bench()
    expect(pick(source, { name: 'foreign candidate' })).toBeUndefined()
  })
})
