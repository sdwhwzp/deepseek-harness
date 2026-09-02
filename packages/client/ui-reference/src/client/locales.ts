/** `reference` namespace dictionaries for the workspace-file `@` source. */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace owned by this plugin. */
export const NS = 'reference'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'section.files': '文件与文件夹',
  'crumb.root': '工作区',
} satisfies Record<string, string>

/** The reference namespace key union. */
export type ReferenceKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The workspace-file `@` reference menu's copy. */
    reference: ReferenceKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'section.files': 'Files & folders',
  'crumb.root': 'Workspace',
} satisfies Record<ReferenceKey, string>
