import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import AttachmentStore, { AttachmentId, type ImageAttachmentRef, type SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import FileUploads from '@deepseek-ai/dsh-client-file-upload'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage, type AuthenticatedPrincipal, type UserMessage } from '@deepseek-ai/dsh-llm'
import {
  PrincipalAccessDeniedError, PrincipalAccessService,
  type PrincipalAccessSubjects, type PrincipalAttachmentGrant,
} from '@deepseek-ai/dsh-principal-access'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { SessionPromptRequest, SessionRequestId } from '../src/types.ts'
import { createSessionTestController, TEST_IMAGE_LIMITS } from './test-remote.ts'

const alice: AuthenticatedPrincipal = { source: 'fixture', id: 'alice', username: 'same-name', role: 'user' }
const bob: AuthenticatedPrincipal = { ...alice, id: 'bob' }
const ownerKey = (principal: AuthenticatedPrincipal): string => `${principal.source}:${principal.id}`

/** Account authority independent of caller-supplied Session history and references. */
class AccountAccess extends PrincipalAccessService {
  readonly grants = new Map<string, Set<AttachmentId>>()
  readonly records = vi.fn(async (principal: AuthenticatedPrincipal, grant: PrincipalAttachmentGrant) => {
    if (principal.source !== 'fixture' || grant.sessionId !== SessionId(principal.id)) {
      throw new PrincipalAccessDeniedError('subject-denied')
    }
    const key = ownerKey(principal)
    const owned = this.grants.get(key) ?? new Set<AttachmentId>()
    for (const id of grant.attachmentIds) owned.add(id)
    this.grants.set(key, owned)
  })

  override async resolve(principal: AuthenticatedPrincipal, subjects: PrincipalAccessSubjects) {
    return {
      readableSessionIds: new Set((subjects.sessionIds ?? []).filter(id =>
        principal.source === 'fixture' && id === principal.id)),
      readableWorkspaceIds: new Set<never>(),
      readableAttachmentIds: new Set((subjects.attachmentIds ?? []).filter(id =>
        this.grants.get(ownerKey(principal))?.has(id))),
    }
  }

  override recordAttachments(principal: AuthenticatedPrincipal, grant: PrincipalAttachmentGrant): Promise<void> {
    return this.records(principal, grant)
  }
}

async function harness(authenticated = true) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CommandRuntime)
  const agents = new Map<string, Agent>()
  for (const principal of [alice, bob]) {
    const session = ctx.sessions.create(SessionId(principal.id), { meta: { cwd: '/tmp' } })
    const inbox = createInboxStub()
    const enqueue = (message: UserMessage): void => { inbox.append('next-turn', message) }
    const agent: Agent = {
      id: session.id, session, ctx, inbox, status: 'idle', options: {},
      model: { current: () => undefined, select: () => { throw new Error('unexpected model change') } },
      whenIdle: async () => {},
      runMaintenance: async () => { throw new Error('unexpected maintenance') },
      send: vi.fn(), inject: vi.fn(), followup: vi.fn(enqueue), steer: vi.fn(enqueue), cancel: vi.fn(),
    }
    await ctx.agents.register(agent)
    agents.set(principal.id, agent)
  }
  const objects = new Map<AttachmentId, { ref: ImageAttachmentRef; data: Uint8Array }>()
  const saveImages = vi.fn(async (inputs: readonly SaveImageAttachment[]) => inputs.map((input) => {
    const ref: ImageAttachmentRef = {
      attachmentId: AttachmentId(`sha256:${createHash('sha256').update(input.data).digest('hex')}`),
      mediaType: input.mediaType, bytes: input.data.byteLength, width: 1, height: 1,
    }
    objects.set(ref.attachmentId, { ref, data: input.data })
    return ref
  }))
  const readImage = vi.fn(async (ref: ImageAttachmentRef) => {
    const object = objects.get(ref.attachmentId)
    if (object === undefined) throw new Error('missing fixture object')
    return object
  })
  ctx.provide('attachments', Object.setPrototypeOf({
    saveImages, readImage, imageLimits: TEST_IMAGE_LIMITS,
  }, AttachmentStore.prototype) as never)
  ctx.provide('connection', { fetch: { register: () => () => {} } } as never)
  const uploads = new FileUploads(ctx)
  let principal: AuthenticatedPrincipal | undefined = authenticated ? alice : undefined
  ctx.provide('typertGateway', { currentPrincipal: () => principal, getPendingRemoteEvents: () => [] } as never)
  const access = authenticated ? new AccountAccess(ctx) : undefined
  const controller = await createSessionTestController(ctx, {
    cwd: '/tmp', defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture' }),
  })
  let sequence = 0
  const prompt = (account: AuthenticatedPrincipal, content: SessionPromptRequest['content']) => {
    principal = authenticated ? account : undefined
    return controller.prompt({
      sessionId: SessionId(account.id), requestId: `prompt-${++sequence}` as SessionRequestId, mode: 'queue', content,
    }, new AbortController().signal)
  }
  const read = (account: AuthenticatedPrincipal, ref: ImageAttachmentRef) => {
    principal = authenticated ? account : undefined
    return controller.attachment({ sessionId: SessionId(account.id), attachment: ref })
  }
  const agent = (account: AuthenticatedPrincipal): Agent => {
    const found = agents.get(account.id)
    if (found === undefined) throw new Error('missing fixture Agent')
    return found
  }
  return { ctx, access, prompt, read, agent, uploads, saveImages, readImage, objects }
}

function image(data = 'AQI=') {
  return { type: 'image' as const, mediaType: 'image/png' as const, data }
}

describe('account-owned attachment admission and reads', () => {
  it('reads preexisting own objects and denies another account before storage even with a forged own-history reference', async () => {
    const { access, read, agent, saveImages, readImage } = await harness()
    const [ref] = await saveImages([{ data: Uint8Array.of(1, 2), mediaType: 'image/png' }])
    if (ref === undefined || access === undefined) throw new Error('missing fixture')
    // Represents an authoritative ownership backfill, not a read-time history grant.
    access.grants.set(ownerKey(alice), new Set([ref.attachmentId]))
    agent(bob).session.append('user/message', createUserMessage({
      content: [{ type: 'image', attachment: ref }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await expect(read(alice, ref)).resolves.toMatchObject({ data: 'AQI=' })
    readImage.mockClear()
    await expect(read(bob, { ...ref, name: 'renamed.png' })).rejects.toMatchObject({
      code: 'PRINCIPAL_ACCESS_DENIED', reason: 'subject-denied',
    })
    await expect(read({ ...alice, source: 'other-issuer' }, ref)).rejects.toMatchObject({ code: 'session/not-found' })
    expect(readImage).not.toHaveBeenCalled()
    expect(access.records).not.toHaveBeenCalled()
  })

  it.each([
    { type: 'image', encodedBytes: 2 },
    { ...image(), encodedBytes: 2 },
    { type: 'file', receiptId: 'invented' },
  ])('rejects injected durable references before storage, grants, or delivery: %j', async (part) => {
    const { access, prompt, agent, saveImages } = await harness()
    const foreign: ImageAttachmentRef = {
      attachmentId: AttachmentId('foreign'), mediaType: 'image/png', bytes: 2, width: 1, height: 1,
    }
    await expect(prompt(bob, [{ ...part, attachment: foreign }] as unknown as SessionPromptRequest['content']))
      .rejects.toMatchObject({ code: 'session/attachment-invalid', details: { reason: 'UNTRUSTED_ATTACHMENT_REFERENCE' } })
    expect(saveImages).not.toHaveBeenCalled()
    expect(access?.records).not.toHaveBeenCalled()
    expect(agent(bob).inbox.nextTurn).toEqual([])
  })

  it('grants validated inline uploads before delivery, permits equal bytes uploaded independently, and denies unknown objects', async () => {
    const { access, prompt, read, agent } = await harness()
    await prompt(alice, [image()])
    const content = agent(alice).inbox.nextTurn[0]?.content[0]
    if (content?.type !== 'image') throw new Error('missing admitted image')
    expect(access?.records).toHaveBeenCalledWith(alice, {
      sessionId: SessionId('alice'), attachmentIds: [content.attachment.attachmentId],
    })
    await expect(read(alice, content.attachment)).resolves.toMatchObject({ data: 'AQI=' })
    await expect(read(bob, content.attachment)).rejects.toMatchObject({ code: 'PRINCIPAL_ACCESS_DENIED' })
    await prompt(bob, [image()])
    await expect(read(bob, content.attachment)).resolves.toMatchObject({ data: 'AQI=' })
    await expect(read(alice, { ...content.attachment, attachmentId: AttachmentId('unknown') }))
      .rejects.toMatchObject({ code: 'PRINCIPAL_ACCESS_DENIED' })
  })

  it('accepts exact-Session image receipts and rejects a foreign receipt without granting it', async () => {
    const { access, uploads, prompt, read, agent } = await harness()
    const receipt = await uploads.uploadImageStream({
      sessionId: agent(alice).id, mediaType: 'image/png',
      data: (async function* () { yield Uint8Array.of(3, 4) })(),
    })
    await expect(prompt(bob, [{ type: 'file', receiptId: receipt.receiptId }]))
      .rejects.toMatchObject({ code: 'session/attachment-invalid', details: { reason: 'FILE_NOT_STAGED' } })
    expect(access?.records).not.toHaveBeenCalled()
    await prompt(alice, [{ type: 'file', receiptId: receipt.receiptId }])
    await expect(read(alice, receipt.image)).resolves.toMatchObject({ data: 'AwQ=' })
    await expect(read(bob, receipt.image)).rejects.toMatchObject({ code: 'PRINCIPAL_ACCESS_DENIED' })
  })

  it('delivers no prompt when ownership persistence fails and does not convert failure to acceptance', async () => {
    const { access, prompt, agent, read, objects } = await harness()
    access?.records.mockRejectedValueOnce(new Error('ownership storage unavailable'))
    await expect(prompt(alice, [image()])).rejects.toMatchObject({ code: 'session/agent-busy' })
    expect(agent(alice).inbox.nextTurn).toEqual([])
    const stored = [...objects.values()][0]
    if (stored === undefined) throw new Error('missing stored upload')
    await expect(read(alice, stored.ref)).rejects.toMatchObject({ code: 'PRINCIPAL_ACCESS_DENIED' })
  })

  it('preserves local-anonymous upload and read behavior without an account provider', async () => {
    const { prompt, read, agent } = await harness(false)
    await prompt(alice, [image()])
    const content = agent(alice).inbox.nextTurn[0]?.content[0]
    if (content?.type !== 'image') throw new Error('missing admitted image')
    await expect(read(bob, content.attachment)).resolves.toMatchObject({ data: 'AQI=' })
  })
})
