import { existsSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm/message'
import type {
  PrincipalAccessSubjects,
} from '@deepseek-ai/dsh-principal-access'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import WorkspaceController from '../src/index.ts'
import { WorkspaceFeed } from '../src/feed.ts'
import type { WorkspaceFollowFrame } from '../src/types.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'fixture/failure': {}
  }
}

const roots: Context[] = []

const principal: AuthenticatedPrincipal = {
  source: 'fixture-auth',
  id: 'user-1',
  username: 'alice',
  role: 'user',
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

async function harness() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-workspace-controller-')))
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  await ctx.plugin(WorkspaceRegistry)
  const dispose = (): void => {}
  ctx.provide('typert', {
    lookups: { configure: () => dispose },
    contexts: { configureHost: () => dispose },
  } as never)
  const controller = new WorkspaceController(ctx)
  return { controller, ctx, root, storageDomain }
}

function stageDir(root: string, name: string): string {
  const path = join(root, name)
  mkdirSync(path, { recursive: true })
  return path
}

function installPrincipalAccess(
  ctx: Context,
  allowedWorkspaceIds: ReadonlySet<WorkspaceId>,
  allowedSessionIds: ReadonlySet<SessionId>,
) {
  ctx.provide('typertGateway', { currentPrincipal: () => principal } as never)
  const resolve = vi.fn(async (
    _candidate: AuthenticatedPrincipal,
    subjects: PrincipalAccessSubjects,
  ) => ({
    readableWorkspaceIds: new Set(
      (subjects.workspaceIds ?? []).filter(id => allowedWorkspaceIds.has(id)),
    ),
    readableSessionIds: new Set(
      (subjects.sessionIds ?? []).filter(id => allowedSessionIds.has(id)),
    ),
  }))
  ctx.provide('principalAccess', { resolve } as never)
  return resolve
}

async function nextFrame(
  iterator: AsyncIterator<WorkspaceFollowFrame>,
): Promise<WorkspaceFollowFrame> {
  const next = await iterator.next()
  if (next.done === true) throw new Error('Workspace stream ended before the expected frame')
  return next.value
}

describe('WorkspaceController commands', () => {
  it('validates authenticated composition before creating a new Workspace', async () => {
    const { controller, ctx, root } = await harness()
    const allowedWorkspaceIds = new Set<WorkspaceId>()
    const allowedSessionIds = new Set<SessionId>()
    const resolve = installPrincipalAccess(ctx, allowedWorkspaceIds, allowedSessionIds)
    const path = stageDir(root, 'created-by-caller')

    await expect(controller.create({ path })).resolves.toMatchObject({
      created: true,
      workspace: { path, sessionIds: [] },
    })
    expect(resolve).toHaveBeenCalledWith(principal, {}, undefined)

    const incomplete = await harness()
    incomplete.ctx.provide('typertGateway', { currentPrincipal: () => principal } as never)
    const deniedPath = stageDir(incomplete.root, 'provider-missing')
    await expect(incomplete.controller.create({ path: deniedPath })).rejects.toMatchObject({
      code: 'PRINCIPAL_ACCESS_DENIED',
      reason: 'provider-required',
    })
    expect(incomplete.ctx.workspaceRegistry.list()).toEqual([])

    const anonymous = await harness()
    anonymous.ctx.provide('principalAccess', { resolve: vi.fn() } as never)
    const anonymousPath = stageDir(anonymous.root, 'principal-missing')
    await expect(anonymous.controller.create({ path: anonymousPath })).rejects.toMatchObject({
      code: 'PRINCIPAL_ACCESS_DENIED',
      reason: 'principal-required',
    })
    expect(anonymous.ctx.workspaceRegistry.list()).toEqual([])
  })

  it('authorizes every addressed resource before mutating it', async () => {
    const { controller, ctx, root } = await harness()
    const first = await ctx.workspaceRegistry.create(stageDir(root, 'first'))
    const second = await ctx.workspaceRegistry.create(stageDir(root, 'second'))
    const session = ctx.sessions.create(SessionId('session'), { meta: { cwd: first.path } })
    const anchor = ctx.sessions.create(SessionId('anchor'), { meta: { cwd: first.path } })
    await first.attachSession(session.id)
    await first.attachSession(anchor.id)
    const originalWorkspaceOrder = ctx.workspaceRegistry.list().map(workspace => workspace.id)
    const originalSessionOrder = [...first.sessionIds]
    const allowedWorkspaceIds = new Set<WorkspaceId>()
    const allowedSessionIds = new Set<SessionId>()
    installPrincipalAccess(ctx, allowedWorkspaceIds, allowedSessionIds)

    const deniedCreate = controller.create({ path: first.path })
    await expect(deniedCreate).rejects.toMatchObject({
      code: 'workspace/invalid-path',
      details: { path: first.path },
    })
    await expect(deniedCreate).rejects.not.toThrow(first.id)
    await expect(controller.rename({ workspaceId: first.id, title: 'denied' }))
      .rejects.toMatchObject({ code: 'workspace/not-found' })
    expect(first.title).toBe('first')
    await expect(controller.delete({ workspaceId: first.id }))
      .rejects.toMatchObject({ code: 'workspace/not-found' })
    expect(ctx.workspaceRegistry.get(first.id)).toBe(first)

    allowedWorkspaceIds.add(first.id)
    await expect(controller.insertBefore({
      workspaceId: first.id,
      beforeWorkspaceId: second.id,
    })).rejects.toMatchObject({
      code: 'workspace/not-found',
      details: { workspaceId: second.id },
    })
    expect(ctx.workspaceRegistry.list().map(workspace => workspace.id)).toEqual(originalWorkspaceOrder)

    allowedSessionIds.add(session.id)
    await expect(controller.insertSessionBefore({
      workspaceId: first.id,
      sessionId: session.id,
      beforeSessionId: anchor.id,
    })).rejects.toMatchObject({
      code: 'session/not-found',
      details: { sessionId: anchor.id },
    })
    expect(first.sessionIds).toEqual(originalSessionOrder)

    allowedSessionIds.delete(session.id)
    await expect(controller.archiveSession({ sessionId: session.id })).rejects.toMatchObject({
      code: 'session/not-found',
      details: { sessionId: session.id },
    })
    expect(ctx.workspaceRegistry.archivedSessionIds).not.toContain(session.id)
  })

  it('filters read-bearing mutation results to the caller\'s readable ids', async () => {
    const { controller, ctx, root } = await harness()
    const target = await ctx.workspaceRegistry.create(stageDir(root, 'target'))
    const anchorWorkspace = await ctx.workspaceRegistry.create(stageDir(root, 'anchor-workspace'))
    const hiddenWorkspace = await ctx.workspaceRegistry.create(stageDir(root, 'hidden-workspace'))
    const moved = ctx.sessions.create(SessionId('moved'), { meta: { cwd: target.path } })
    const anchor = ctx.sessions.create(SessionId('anchor'), { meta: { cwd: target.path } })
    const hidden = ctx.sessions.create(SessionId('hidden'), { meta: { cwd: target.path } })
    await target.attachSession(moved.id)
    await target.attachSession(anchor.id)
    await target.attachSession(hidden.id)
    await ctx.workspaceRegistry.archiveSession(hidden.id)

    const allowedWorkspaceIds = new Set([target.id, anchorWorkspace.id])
    const allowedSessionIds = new Set([moved.id, anchor.id])
    installPrincipalAccess(ctx, allowedWorkspaceIds, allowedSessionIds)

    const resolved = await controller.create({ path: target.path })
    expect(resolved).toMatchObject({
      created: false,
      workspace: { workspaceId: target.id },
    })
    expect(resolved.workspace.sessionIds).toEqual(expect.arrayContaining([moved.id, anchor.id]))
    expect(resolved.workspace.sessionIds).not.toContain(hidden.id)
    const renamed = await controller.rename({ workspaceId: target.id, title: 'renamed' })
    expect(renamed.workspace.sessionIds).toEqual(expect.arrayContaining([moved.id, anchor.id]))
    expect(renamed.workspace.sessionIds).not.toContain(hidden.id)

    const order = await controller.insertBefore({
      workspaceId: target.id,
      beforeWorkspaceId: anchorWorkspace.id,
    })
    expect(order).toEqual({ workspaceIds: [target.id, anchorWorkspace.id] })
    expect(order.workspaceIds).not.toContain(hiddenWorkspace.id)

    const reordered = await controller.insertSessionBefore({
      workspaceId: target.id,
      sessionId: moved.id,
      beforeSessionId: anchor.id,
    })
    expect(reordered.workspace.sessionIds).toEqual([moved.id, anchor.id])

    await expect(controller.archiveSession({ sessionId: moved.id }))
      .resolves.toEqual({ archivedSessionIds: [moved.id] })
  })

  it('serializes concurrent path adoption and preserves an existing title', async () => {
    const { controller, root } = await harness()
    const path = stageDir(root, 'alpha')
    const results = await Promise.all([
      controller.create({ path }),
      controller.create({ path }),
    ])
    const created = results.find(result => result.created)
    const resolved = results.find(result => !result.created)
    expect(created).toMatchObject({ workspace: { path, title: 'alpha' } })
    expect(resolved?.workspace.workspaceId).toBe(created?.workspace.workspaceId)

    const workspaceId = created?.workspace.workspaceId
    if (workspaceId === undefined) throw new Error('fixture did not create a Workspace')
    await controller.rename({ workspaceId, title: 'renamed' })
    await expect(controller.create({ path })).resolves.toMatchObject({
      created: false,
      workspace: { workspaceId, title: 'renamed' },
    })
  })

  it('maps invalid paths, blank names, conflicts, and unknown ids to stable failures', async () => {
    const { controller, root } = await harness()
    const first = await controller.create({ path: stageDir(root, 'first') })
    const second = await controller.create({ path: stageDir(root, 'second') })

    await expect(controller.create({ path: join(root, 'missing') })).rejects.toMatchObject({
      code: 'workspace/invalid-path',
      details: { path: join(root, 'missing') },
    })
    expect(existsSync(join(root, 'missing'))).toBe(false)
    await expect(controller.rename({ workspaceId: first.workspace.workspaceId, title: '  ' }))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
    await controller.rename({ workspaceId: first.workspace.workspaceId, title: 'occupied' })
    await expect(controller.rename({ workspaceId: second.workspace.workspaceId, title: ' occupied ' }))
      .rejects.toMatchObject({ code: 'workspace/name-conflict' })
    await expect(controller.delete({ workspaceId: 'missing' as WorkspaceId }))
      .rejects.toMatchObject({ code: 'workspace/not-found' })
  })

  it('preserves Remote failures and propagates unexpected registry failures', async () => {
    const { controller, ctx, root } = await harness()
    const remoteFailure = new RemoteError('fixture/failure', 'already mapped', {})
    const resolveByPath = vi.spyOn(ctx.workspaceRegistry, 'resolveByPath')
      .mockRejectedValueOnce(remoteFailure)
      .mockRejectedValueOnce('plain failure')
    await expect(controller.create({ path: stageDir(root, 'remote-failure') }))
      .rejects.toBe(remoteFailure)
    const plainFailure = controller.create({ path: stageDir(root, 'plain-failure') })
    await expect(plainFailure).rejects.toMatchObject({ code: 'workspace/invalid-path' })
    await expect(plainFailure).rejects.toThrow('plain failure')
    resolveByPath.mockRestore()

    const created = await controller.create({ path: stageDir(root, 'created') })
    const workspace = ctx.workspaceRegistry.get(created.workspace.workspaceId)
    if (workspace === undefined) throw new Error('fixture Workspace disappeared')

    const orderFailure = new Error('order storage failed')
    vi.spyOn(ctx.workspaceRegistry, 'insertBefore').mockRejectedValueOnce(orderFailure)
    await expect(controller.insertBefore({ workspaceId: created.workspace.workspaceId }))
      .rejects.toBe(orderFailure)

    const moveFailure = new Error('membership storage failed')
    vi.spyOn(workspace, 'insertSessionBefore').mockRejectedValueOnce(moveFailure)
    await expect(controller.insertSessionBefore({
      workspaceId: created.workspace.workspaceId,
      sessionId: SessionId('session'),
    })).rejects.toBe(moveFailure)

    const archiveFailure = new Error('archive storage failed')
    vi.spyOn(ctx.workspaceRegistry, 'archiveSession').mockRejectedValueOnce(archiveFailure)
    await expect(controller.archiveSession({ sessionId: SessionId('session') }))
      .rejects.toBe(archiveFailure)
  })

  it('resolves queued Workspace identities when their operation starts', async () => {
    const { controller, ctx, root } = await harness()
    const target = await controller.create({ path: stageDir(root, 'target') })
    const blockerPath = stageDir(root, 'blocker')
    const gate = deferred<undefined>()
    const originalResolveByPath = ctx.workspaceRegistry.resolveByPath.bind(ctx.workspaceRegistry)
    const resolveByPath = vi.spyOn(ctx.workspaceRegistry, 'resolveByPath')
    resolveByPath.mockImplementationOnce(async (path) => {
      await gate.promise
      return originalResolveByPath(path)
    })

    const blocker = controller.create({ path: blockerPath })
    const deletion = controller.delete({ workspaceId: target.workspace.workspaceId })
    const staleRename = controller.rename({
      workspaceId: target.workspace.workspaceId,
      title: 'must-not-land',
    })
    gate.resolve(undefined)
    await blocker
    await expect(deletion).resolves.toEqual({ deleted: true })
    await expect(staleRename).rejects.toMatchObject({ code: 'workspace/not-found' })
  })

  it('reorders Workspaces and Sessions and archives only known Sessions', async () => {
    const { controller, ctx, root } = await harness()
    const first = await controller.create({ path: stageDir(root, 'first') })
    const second = await controller.create({ path: stageDir(root, 'second') })
    await expect(controller.insertBefore({
      workspaceId: first.workspace.workspaceId,
      beforeWorkspaceId: second.workspace.workspaceId,
    })).resolves.toEqual({
      workspaceIds: [first.workspace.workspaceId, second.workspace.workspaceId],
    })
    await expect(controller.insertBefore({ workspaceId: 'missing' as WorkspaceId }))
      .rejects.toMatchObject({ code: 'workspace/not-found' })

    const session = ctx.sessions.create(SessionId('session-one'), {
      meta: { cwd: first.workspace.path },
    })
    const workspace = ctx.workspaceRegistry.get(first.workspace.workspaceId)
    if (workspace === undefined) throw new Error('fixture Workspace disappeared')
    await workspace.attachSession(session.id)
    await expect(controller.insertSessionBefore({
      workspaceId: first.workspace.workspaceId,
      sessionId: session.id,
    })).resolves.toMatchObject({ workspace: { sessionIds: [session.id] } })
    await expect(controller.insertSessionBefore({
      workspaceId: first.workspace.workspaceId,
      sessionId: SessionId('missing-session'),
    })).rejects.toMatchObject({ code: 'workspace/move-invalid' })
    await expect(controller.insertSessionBefore({
      workspaceId: first.workspace.workspaceId,
      sessionId: session.id,
      beforeSessionId: SessionId('missing-anchor'),
    })).rejects.toMatchObject({
      code: 'workspace/move-invalid',
      details: { beforeSessionId: 'missing-anchor' },
    })
    await expect(controller.insertSessionBefore({
      workspaceId: 'missing' as WorkspaceId,
      sessionId: session.id,
    })).rejects.toMatchObject({ code: 'workspace/not-found' })

    await expect(controller.archiveSession({ sessionId: session.id }))
      .resolves.toEqual({ archivedSessionIds: [session.id] })
    await expect(controller.archiveSession({ sessionId: SessionId('unknown') }))
      .rejects.toMatchObject({ code: 'session/not-found' })
  })
})

describe('WorkspaceController follow', () => {
  it('seeds a new feed from existing rows and rejects an inconsistent registry commit', async () => {
    const { ctx, root } = await harness()
    const existing = await ctx.workspaceRegistry.create(stageDir(root, 'existing'))
    const feed = new WorkspaceFeed(ctx)
    expect(feed.baseline()).toMatchObject({
      items: [{ workspaceId: existing.id }],
    })

    expect(() => {
      ctx.emit('domain/changed', {
        domain: 'workspace',
        table: '',
        key: '',
        operation: 'put',
        value: {
          initialized: true,
          workspaceIds: ['missing'],
          archivedSessionIds: [],
        },
      })
    }).toThrow('references missing Workspace "missing"')
  })

  it('starts with a complete baseline and emits committed increments in domain order', async () => {
    const { controller, ctx, root } = await harness()
    const abort = new AbortController()
    const iterator = controller.follow(abort.signal)[Symbol.asyncIterator]()
    await expect(nextFrame(iterator)).resolves.toEqual({
      type: 'baseline',
      value: { items: [], archivedSessionIds: [] },
    })

    const first = await controller.create({ path: stageDir(root, 'first') })
    await expect(nextFrame(iterator)).resolves.toMatchObject({
      type: 'upsert', workspace: { workspaceId: first.workspace.workspaceId },
    })
    await expect(nextFrame(iterator)).resolves.toEqual({
      type: 'order', workspaceIds: [first.workspace.workspaceId],
    })
    await controller.rename({ workspaceId: first.workspace.workspaceId, title: 'renamed' })
    await expect(nextFrame(iterator)).resolves.toMatchObject({
      type: 'upsert', workspace: { title: 'renamed' },
    })

    const second = await controller.create({ path: stageDir(root, 'second') })
    await expect(nextFrame(iterator)).resolves.toMatchObject({
      type: 'upsert', workspace: { workspaceId: second.workspace.workspaceId },
    })
    await expect(nextFrame(iterator)).resolves.toEqual({
      type: 'order', workspaceIds: [second.workspace.workspaceId, first.workspace.workspaceId],
    })
    await controller.insertBefore({
      workspaceId: first.workspace.workspaceId,
      beforeWorkspaceId: second.workspace.workspaceId,
    })
    await expect(nextFrame(iterator)).resolves.toEqual({
      type: 'order',
      workspaceIds: [first.workspace.workspaceId, second.workspace.workspaceId],
    })

    const session = ctx.sessions.create(SessionId('archived'), {
      meta: { cwd: first.workspace.path },
    })
    await controller.archiveSession({ sessionId: session.id })
    await expect(nextFrame(iterator)).resolves.toEqual({
      type: 'archived', archivedSessionIds: [session.id],
    })
    await controller.delete({ workspaceId: second.workspace.workspaceId })
    await expect(nextFrame(iterator)).resolves.toEqual({
      type: 'order', workspaceIds: [first.workspace.workspaceId],
    })
    await expect(nextFrame(iterator)).resolves.toEqual({
      type: 'remove', workspaceId: second.workspace.workspaceId,
    })

    abort.abort()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it('ignores unrelated domain writes and closes active followers on disposal', async () => {
    const { controller, ctx, root } = await harness()
    const abort = new AbortController()
    const iterator = controller.follow(abort.signal)[Symbol.asyncIterator]()
    await nextFrame(iterator)
    ctx.emit('domain/changed', {
      domain: 'other', table: 'records', key: 'x', operation: 'put', value: {},
    })
    ctx.emit('domain/changed', {
      domain: 'workspace', table: '', key: '', operation: 'deleted',
    })
    ctx.emit('domain/changed', {
      domain: 'workspace', table: 'other', key: 'x', operation: 'put', value: {},
    })
    ctx.emit('domain/changed', {
      domain: 'workspace', table: 'workspaces', key: 'unknown', operation: 'deleted',
    })
    const pending = iterator.next()
    const created = await controller.create({ path: stageDir(root, 'visible') })
    await expect(pending).resolves.toMatchObject({ value: { type: 'upsert' } })
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: 'order', workspaceIds: [created.workspace.workspaceId] },
    })

    const closing = iterator.next()
    await ctx.fiber.dispose()
    roots.splice(roots.indexOf(ctx), 1)
    await expect(closing).resolves.toEqual({ done: true, value: undefined })
  })
})
