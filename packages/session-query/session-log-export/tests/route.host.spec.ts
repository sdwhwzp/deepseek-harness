import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import type { AuthenticatedPrincipal } from '@deepseek-ai/dsh-llm/message'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import {
  Config,
  SESSION_LOG_EXPORT_PATH,
  apply,
  inject,
} from '../src/index.ts'

const sid = (value: string): SessionId => value as SessionId

function readHandle(id: string): SessionHandle {
  const header: SessionHeader = {
    version: 0,
    id: sid(id),
    createdAt: 1,
    isSeeded: false,
    cwd: '/workspace',
    delegationDepth: 0,
  }
  return {
    id: header.id,
    header,
    access: 'read',
    read: async () => [],
    close: async () => {},
  } as unknown as SessionHandle
}

async function mounted(
  withServices: boolean,
  auth?: { readonly principal: AuthenticatedPrincipal; readonly allowed: ReadonlySet<SessionId> },
): Promise<{
  readonly connection: HostConnectionService
  readonly open: ReturnType<typeof vi.fn>
  readonly dispose: () => Promise<void>
}> {
  const ctx = new Context()
  ctx.provide('commands', { register: () => () => {} } as never)
  if (auth !== undefined) {
    ctx.provide('requestPrincipal', { authenticate: () => auth.principal })
    ctx.provide('principalAccess', {
      resolve: (_principal: AuthenticatedPrincipal, subjects: { sessionIds?: readonly SessionId[] }) =>
        Promise.resolve({
          readableSessionIds: new Set(
            (subjects.sessionIds ?? []).filter(id => auth.allowed.has(id)),
          ),
          readableWorkspaceIds: new Set(),
        }),
    } as never)
  }
  const open = vi.fn(async (id: SessionId) => readHandle(String(id)))
  if (withServices) {
    ctx.provide('sessionQuery', {
      traceSession: async () => ({ descendants: [] }),
    } as never)
    ctx.provide('sessionPersistence', {
      open,
    } as never)
    ctx.provide('attachments', {
      readImage: async () => { throw new Error('fixture has no images') },
    } as never)
  }
  const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber
  return { connection, open, dispose: () => fiber.dispose() }
}

describe('Session log export Fetch route', () => {
  it('registers one GET/HEAD route and removes it with the plugin fiber', async () => {
    const { connection, dispose } = await mounted(true)
    const shared = connection.createSharedFetchHandler('/api')

    const response = await shared.fetch(new Request(
      `http://host${SESSION_LOG_EXPORT_PATH}?sessionId=session-1`,
    ))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()))
    expect(strFromU8(files['session.jsonl'] as Uint8Array)).toContain('"id":"session-1"')

    const head = await shared.fetch(new Request(
      `http://host${SESSION_LOG_EXPORT_PATH}?sessionId=session-1`, { method: 'HEAD' },
    ))
    expect(head.status).toBe(200)
    expect(head.body).toBeNull()

    await dispose()
    expect((await shared.fetch(new Request(
      `http://host${SESSION_LOG_EXPORT_PATH}?sessionId=session-1`,
    ))).status).toBe(404)
  })

  it('validates the query before reporting missing export services', async () => {
    const { connection, dispose } = await mounted(false)
    const shared = connection.createSharedFetchHandler('/api')
    expect((await shared.fetch(new Request(`http://host${SESSION_LOG_EXPORT_PATH}`))).status).toBe(400)
    expect((await shared.fetch(new Request(
      `http://host${SESSION_LOG_EXPORT_PATH}?sessionId=session-1&includeDescendants=1`,
    ))).status).toBe(400)
    expect((await shared.fetch(new Request(
      `http://host${SESSION_LOG_EXPORT_PATH}?sessionId=session-1`,
    ))).status).toBe(500)
    await dispose()
  })

  it('returns 404 before reading a principal-hidden raw Session artifact', async () => {
    const principal: AuthenticatedPrincipal = {
      source: 'fixture', id: 'alice', username: 'Alice', role: 'user',
    }
    const { connection, open, dispose } = await mounted(true, {
      principal,
      allowed: new Set(),
    })

    const response = await connection.createSharedFetchHandler('/api').fetch(new Request(
      `http://host${SESSION_LOG_EXPORT_PATH}?sessionId=hidden`,
    ))
    expect(response.status).toBe(404)
    expect(open).not.toHaveBeenCalled()
    await dispose()
  })

  it('validates the compression level', () => {
    expect(Config({})).toEqual({ compressionLevel: 6 })
    expect(Config({ compressionLevel: 0 })).toEqual({ compressionLevel: 0 })
    expect(Config({ compressionLevel: 9 })).toEqual({ compressionLevel: 9 })
    for (const compressionLevel of [-1, 10, 1.5]) {
      expect(() => Config({ compressionLevel } as never)).toThrow()
    }
  })
})
