/** Localized native controls for network enrollment, private access links and restart-owned activation. */

import type { MessageBoxReturnValue } from 'electron'
import type { DesktopLocale } from './locale.ts'
import type { UpdateDialogOptions } from './update-dialog.ts'
import type { DesktopTsnet, DesktopTsnetConfig } from './tsnet.ts'

/** Native capabilities provided by the shell; network details stay in the tsnet owner. */
export interface DesktopTsnetMenuOptions {
  readonly locale: () => DesktopLocale
  readonly config: DesktopTsnetConfig | undefined
  readonly client: Pick<DesktopTsnet, 'state' | 'accessURL'> | undefined
  readonly show: (options: UpdateDialogOptions) => Promise<MessageBoxReturnValue>
  readonly open: (url: string) => Promise<void>
  readonly copy: (text: string) => void | Promise<void>
  readonly settings: () => Promise<void>
  readonly restart: (enabled: boolean) => Promise<void>
}

/** One native network dialog at a time; closing a dialog never changes network configuration. */
export class DesktopTsnetMenu {
  private operation: Promise<void> | undefined

  /** @param options Main-process capabilities bound to the current application. */
  constructor(private readonly options: DesktopTsnetMenuOptions) {}

  /** Open the network status and available actions, joining an already open dialog. */
  show(): Promise<void> {
    this.operation ??= this.present().finally(() => { this.operation = undefined })
    return this.operation
  }

  private async present(): Promise<void> {
    const { messages } = this.options.locale()
    const config = this.options.config
    const client = this.options.client
    const state = client?.state
    const actions: Array<{ label: string; run: () => void | Promise<void> }> = []
    let message = messages.remoteAccessOff
    let detail = ''
    if (config === undefined) message = messages.remoteAccessFailed
    else if (!config.enabled) actions.push({ label: messages.remoteAccessEnable, run: () => this.options.restart(true) })
    else {
      if (state?.phase === 'needs-login') {
        message = messages.remoteAccessLogin
        actions.push({ label: messages.welcomeSignIn, run: () => this.options.open(state.loginURL) },
          { label: messages.welcomeAuthCopyLink, run: () => this.options.copy(state.loginURL) })
      } else if (state?.phase === 'online') {
        message = messages.remoteAccessReady
        detail = state.url
        const url = client?.accessURL
        if (url !== undefined) actions.push({ label: messages.remoteAccessCopy, run: () => this.options.copy(url) })
        else detail += `\n\n${messages.remoteAccessOpenWorkspace}`
      } else if (state?.phase === 'needs-approval') message = messages.remoteAccessApproval
      else if (state?.phase === 'error' || state?.phase === 'disabled') message = messages.remoteAccessFailed
      else message = messages.remoteAccessConnecting
      actions.push({ label: messages.remoteAccessDisable, run: () => this.options.restart(false) })
    }
    actions.push({ label: messages.remoteAccessSettings, run: this.options.settings })
    const result = await this.options.show({ title: messages.remoteAccessTitle, message, detail,
      buttons: [...actions.map(action => action.label), messages.updateClose], defaultId: actions.length, cancelId: actions.length })
    try { await actions[result.response]?.run() }
    catch (_error) {
      await this.options.show({ type: 'error', title: messages.remoteAccessTitle, message: messages.remoteAccessFailed,
        buttons: [messages.updateClose], cancelId: 0 })
    }
  }
}
