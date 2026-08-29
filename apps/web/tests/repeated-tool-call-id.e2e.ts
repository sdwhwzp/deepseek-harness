// Web e2e scenario: provider tool-call ids are not durable lifecycle ids.
// An authored cold session reuses one provider id for two settled calls before
// a later assistant reply. Reopening that session must render both calls and
// the reply.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  fixtureUserPrompts, launchWebScaffold, seedSession, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/repeated-tool-call-id', import.meta.url))
const SEED = join(SNAPSHOT_DIR, 'session.jsonl')
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const MODE = webSnapshotMode()
const SEED_ID = 'repeated-tool-call-id-web-e2e'
const REUSED_CALL_ID = 'provider-reused-call-id'
const LATER_REPLY = 'REOPENED_REPLY_REMAINS_VISIBLE'
const PROMPT = 'Run both diagnostic commands, then identify the model.'

describe('web e2e: repeated provider tool-call ids survive reopen', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    if (MODE === 'record') throw new Error('repeated-tool-call-id is a keyless assembled snapshot')
    const fixture = await readFile(SEED, 'utf8')
    expect(fixtureUserPrompts(fixture)).toEqual([PROMPT])
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, fixture, SEED_ID)
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

  it('keeps both tool lifecycles and the later reply on a cold reopen', async () => {
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
  }, 60_000)

  it('inspects the first repeated-id lifecycle instead of the latest one', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-repeated-tool-call-id-inspect'))
    const process = page.getByRole('button', { name: '2 tool calls', exact: true })
    await process.click()
    const firstCall = page.locator(`[data-chat-call-id="${REUSED_CALL_ID}"]`).first()
    await firstCall.getByRole('button').first().click()
    await firstCall.getByRole('button', { name: 'Inspect', exact: true }).click()
    await page.getByLabel('Trajectory timeline').waitFor({ timeout: 15_000 })

    const selected = page.locator('tr[data-kind="tool"][aria-selected="true"]')
    await expect.poll(() => selected.count(), { timeout: 10_000 }).toBe(1)
    await expect.poll(() => selected.getAttribute('aria-label'), { timeout: 10_000 })
      .toContain('first lifecycle')
    expect(await selected.getAttribute('aria-label')).not.toContain('second lifecycle')

    const details = page.getByRole('complementary', { name: 'Event details' })
    await details.getByRole('tab', { name: 'Result', exact: true }).click()
    await expect.poll(() => details.getByText('first lifecycle complete', { exact: true }).count(), {
      timeout: 10_000,
    }).toBe(1)
    expect(await details.getByText('second lifecycle complete', { exact: true }).count()).toBe(0)

    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await process.click()
  }, 60_000)

  it('matches the reopened conversation aria golden', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-repeated-tool-call-id-aria'))
    const snapshot = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
  })

  it('issued zero model calls and stayed clean', async () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl', 'ui.expected.md'])
  })
})
