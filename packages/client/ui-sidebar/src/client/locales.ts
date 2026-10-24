/** `sidebar` namespace dictionaries for shell controls and global panels. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'session.new': '新会话',
  'session.new.label': '新建会话',
  'build.version': '构建版本',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
  'panels.label': '全局面板',
  'panels.more': '更多',
  'version.copied': '版本号复制成功',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'build.version': 'Build version',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
  'panels.label': 'Global panels',
  'panels.more': 'More',
  'version.copied': 'Version copied',
} satisfies Record<SidebarKey, string>

/** Japanese copy, checked against the English keys. */
export const ja = {
  'session.new': '新規セッション',
  'session.new.label': '新規セッション',
  'build.version': 'ビルドバージョン',
  'toggle.open': 'サイドバーを開く',
  'toggle.collapse': 'サイドバーを折りたたむ',
  'panels.label': 'グローバルパネル',
  'panels.more': 'その他',
  'version.copied': 'バージョンをコピーしました',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  'session.new': 'Nueva sesión',
  'session.new.label': 'Nueva sesión',
  'build.version': 'Versión de compilación',
  'toggle.open': 'Abrir barra lateral',
  'toggle.collapse': 'Contraer barra lateral',
  'panels.label': 'Paneles globales',
  'panels.more': 'Más',
  'version.copied': 'Versión copiada',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  'session.new': 'Nouvelle séance',
  'session.new.label': 'Nouvelle séance',
  'build.version': 'Version de compilation',
  'toggle.open': 'Ouvrir la barre latérale',
  'toggle.collapse': 'Réduire la barre latérale',
  'panels.label': 'Panneaux globaux',
  'panels.more': 'Plus',
  'version.copied': 'Version copiée',
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = {
  'session.new': 'Neue Sitzung',
  'session.new.label': 'Neue Sitzung',
  'build.version': 'Build-Version',
  'toggle.open': 'Seitenleiste öffnen',
  'toggle.collapse': 'Seitenleiste einklappen',
  'panels.label': 'Globale Bereiche',
  'panels.more': 'Mehr',
  'version.copied': 'Version kopiert',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  'session.new': 'Новая сессия',
  'session.new.label': 'Новая сессия',
  'build.version': 'Версия сборки',
  'toggle.open': 'Открыть боковую панель',
  'toggle.collapse': 'Свернуть боковую панель',
  'panels.label': 'Глобальные панели',
  'panels.more': 'Ещё',
  'version.copied': 'Версия скопирована',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  'session.new': 'Nova sessão',
  'session.new.label': 'Nova sessão',
  'build.version': 'Versão da compilação',
  'toggle.open': 'Abrir barra lateral',
  'toggle.collapse': 'Recolher barra lateral',
  'panels.label': 'Painéis globais',
  'panels.more': 'Mais',
  'version.copied': 'Versão copiada',
} satisfies Record<keyof typeof en, string>
