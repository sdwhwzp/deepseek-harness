/** `command` namespace dictionaries (the popupSelect shell's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'catalog.compact.description': '压缩较早的对话历史',
  'catalog.export.description': '下载本会话日志的 ZIP 压缩包',
  'catalog.feedback.description': '记录对本会话的反馈',
  'catalog.goal.description': '设置或查看长期任务目标',
  'catalog.image.description': '根据文字描述生成图片',
  'catalog.permission.description': '切换权限预设（沙箱模式和审批策略）',
  'catalog.plan.description': '进入或退出计划模式',
  'catalog.readImage.description': '读取并分析工作区图片',
  'search.placeholder': '搜索…',
  'search.aria': '筛选选项',
  'status.loading': '正在加载选项…',
  'status.applying': '正在应用…',
  'status.empty': '无选项',
  'overlay.aria': '/{command} 选项',
  'listbox.aria': '/{command} 匹配项',
  'notice.imagesUnsupported': '/{command} 不接受图片附件，请先移除图片',
} satisfies Record<string, string>

/** The command namespace key union. */
export type CommandKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'catalog.compact.description': 'Compact older conversation history',
  'catalog.export.description': 'Download this Session log as a ZIP archive',
  'catalog.feedback.description': 'record feedback about this session',
  'catalog.goal.description': 'set or view the goal for a long-running task',
  'catalog.image.description': 'Generate an image from a text prompt',
  'catalog.permission.description': 'Switch the permission preset (sandbox mode + approval policy)',
  'catalog.plan.description': 'Enter or leave plan mode',
  'catalog.readImage.description': 'Read and analyze a workspace image',
  'search.placeholder': 'Search…',
  'search.aria': 'Filter options',
  'status.loading': 'Loading options…',
  'status.applying': 'Applying…',
  'status.empty': 'No options',
  'overlay.aria': '/{command} options',
  'listbox.aria': '/{command} matches',
  'notice.imagesUnsupported': '/{command} does not accept image attachments; remove them first',
} satisfies Record<CommandKey, string>
