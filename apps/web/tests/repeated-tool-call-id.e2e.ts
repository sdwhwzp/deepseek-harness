import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  createMessage, createToolResultMessage, createUserMessage, ToolCallId,
} from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/repeated-tool-call-id', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./expected/repeated-tool-call-id/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'repeated-tool-call-id-web-e2e'
const REUSED_CALL_ID = ToolCallId('provider-reused-call-id')
const LATER_REPLY = 'REOPENED_REPLY_REMAINS_VISIBLE'

/** Build a closed session containing two independent uses of one provider call id. */
function repeatedCallIdFixture(): string {
  const session = Session.create(SessionId('repeated-tool-call-id-source'))
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Run both diagnostic commands, then identify the model.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Repeated provider call id',
    messageSeqs: [user.seq],
    source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  const calls = [
    {
      args: JSON.stringify({ command: "printf 'first lifecycle\\n'", description: 'First diagnostic command' }),
      result: 'first lifecycle complete',
    },
    {
      args: JSON.stringify({ command: "printf 'second lifecycle\\n'", description: 'Second diagnostic command' }),
      result: 'second lifecycle complete',
    },
  ]
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: calls.map(call => ({
        type: 'tool-call' as const,
        id: REUSED_CALL_ID,
        name: 'bash',
        arguments: call.args,
      })),
      source: { kind: 'model', provider: 'xai', model: 'grok-4.6' },
    }),
  }, { surfaceOp: 'append' })
  for (const call of calls) {
    const source = session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: REUSED_CALL_ID,
      name: 'bash',
      arguments: call.args,
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: REUSED_CALL_ID,
        content: [{ type: 'text', text: call.result }],
        isError: false,
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [source.seq] })
  }
  session.append('step/end', { turn: 1, step: 1 })
  session.append('step/start', { turn: 1, step: 2 })
  session.append('assistant/message', {
    turn: 1,
    step: 2,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: `I am grok-4.6. ${LATER_REPLY}` }],
      source: { kind: 'model', provider: 'xai', model: 'grok-4.6' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 2 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  return [
    JSON.stringify({
      type: 'session',
      version: SESSION_FORMAT_VERSION,
      id: '{{sessionId}}',
      createdAt: 0,
      cwd: '{{cwd}}',
    }),
    ...session.snapshotEvents().map(event => JSON.stringify({
      ...event,
      time: eventTimeOrigin + event.seq * 1_000,
    })),
    '',
  ].join('\n')
}

describe('web e2e: repeated provider tool-call ids survive reopen', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, repeatedCallIdFixture(), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('keeps both tool lifecycles and the later reply on a cold reopen', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-repeated-tool-call-id'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await expect.poll(() => page.getByText(LATER_REPLY, { exact: false }).count(), {
      timeout: 15_000,
    }).toBe(1)
    await expect.poll(() => page.locator(`[data-chat-call-id="${REUSED_CALL_ID}"]`).count(), {
      timeout: 10_000,
    }).toBe(2)

    const snapshot = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  }, 60_000)
})
