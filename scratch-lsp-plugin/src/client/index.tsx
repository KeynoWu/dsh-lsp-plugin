/**
 * DSH LSP 插件 client 端：设置页（M3）。
 * 注册 `settings.section` slot（设置 → "LSP 语言"），语言勾选写入 `lsp` namespace，
 * host 端 installSettingsSection 订阅后即时生效（见 src/index.ts）。
 * 对齐 lsp-plugin-design.md v2 §7：按岗位分组、勾选开关、状态徽标（启用/未启用，可用性 M4 接 host remote）。
 */
import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
// 触发 client 端包的 cordis Context 类型增强（slots/locale/settingsScope）
import '@deepseek-ai/dsh-client-runtime/client'
import '@deepseek-ai/dsh-client-locale/client'
import '@deepseek-ai/dsh-client-ui-settings/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

// 增强 LocaleNamespaceMap：注册本插件自己的 locale namespace（值取字典键集合）
type LspLocaleKey = 'nav' | 'summary' | 'idleLabel' | 'enabled' | 'heavy' | 'experimental' | 'statusOn' | 'statusOff'

const zh = {
  nav: 'LSP 语言',
  summary: '勾选启用的语言；未安装的服务器保持关闭，避免模型误调。',
  idleLabel: '空闲回收超时（ms）',
  enabled: '启用',
  heavy: '重',
  experimental: '实验性',
  statusOn: '已启用',
  statusOff: '未启用',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    lsp: LspLocaleKey
  }
}

const NS = 'lsp'

/** 语言元数据（与 host 端 src/catalog.ts 对齐；M4 改由 host remote 下发，消除双份维护） */
interface LangMeta {
  id: string
  displayName: string
  group: string
  priority: string
  heavy?: boolean
  experimental?: boolean
}

const LANGUAGES: LangMeta[] = [
  { id: 'typescript', displayName: 'TypeScript/JavaScript', group: '前端', priority: 'P0' },
  { id: 'vue', displayName: 'Vue', group: '前端', priority: 'P1' },
  { id: 'html', displayName: 'HTML', group: '前端', priority: 'P2' },
  { id: 'css', displayName: 'CSS/SCSS', group: '前端', priority: 'P2' },
  { id: 'python', displayName: 'Python', group: '后端', priority: 'P0' },
  { id: 'go', displayName: 'Go', group: '后端', priority: 'P1' },
  { id: 'rust', displayName: 'Rust', group: '后端', priority: 'P1', heavy: true },
  { id: 'java', displayName: 'Java', group: '后端', priority: 'P2', heavy: true },
  { id: 'csharp', displayName: 'C#', group: '后端', priority: 'P2', heavy: true },
  { id: 'php', displayName: 'PHP', group: '后端', priority: 'P2' },
  { id: 'ruby', displayName: 'Ruby', group: '后端', priority: 'P2' },
  { id: 'cpp', displayName: 'C/C++', group: '后端', priority: 'P2' },
  { id: 'kotlin', displayName: 'Kotlin', group: 'Android', priority: 'P2' },
  { id: 'swift', displayName: 'Swift', group: 'iOS', priority: 'P1', heavy: true },
  { id: 'sql', displayName: 'SQL', group: '数据', priority: 'P3', experimental: true },
  { id: 'r', displayName: 'R', group: '数据', priority: 'P3', experimental: true },
]

interface LspSettingsValue {
  enabled?: Record<string, boolean>
  idleTimeoutMs?: number
}


const en = {
  nav: 'LSP Languages',
  summary: 'Enable languages; servers that are not installed stay off to avoid wasted calls.',
  idleLabel: 'Idle timeout (ms)',
  enabled: 'Enabled',
  heavy: 'heavy',
  experimental: 'experimental',
  statusOn: 'on',
  statusOff: 'off',
}

const dictionaries = { zh, en } as const

interface SectionProps {
  close: () => void
  /** slots 系统注入的 translate（按注册时 locale: NS） */
  t: TranslateNS<'lsp'>
  /** slots 系统把 hooks 包装成的 selector hook（对应 hooks.scope） */
  useScope: <S>(sel: (s: SettingsScopeSnapshot<unknown>) => S, eq?: (a: S, b: S) => boolean) => S
  /** 直接 props（来自 inject 返回的额外键） */
  setEnabled: (next: Record<string, boolean>) => void
  setIdle: (ms: number) => void
}

function LspSettingsSection({ t, useScope, setEnabled, setIdle }: SectionProps) {
  const snap = useScope((s) => s)
  const value = (snap.value as LspSettingsValue | undefined) ?? {}
  const enabled = value.enabled ?? {}
  const idleMs = value.idleTimeoutMs ?? 300000

  const toggle = (id: string, next: boolean) => {
    setEnabled({ ...enabled, [id]: next })
  }
  const changeIdle = (ms: number) => {
    setIdle(ms)
  }

  const groups = [...new Set(LANGUAGES.map((l) => l.group))]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 13 }}>
        {t('summary')}
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <span>{t('idleLabel')}</span>
        <input
          type="number"
          value={idleMs}
          min={0}
          step={30000}
          onChange={(e) => changeIdle(Number(e.target.value) || 0)}
          style={{ width: 120, padding: '4px 8px' }}
        />
      </label>
      {groups.map((group) => (
        <div key={group} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h3 style={{ margin: '8px 0 0', fontSize: 14, fontWeight: 600 }}>{group}</h3>
          {LANGUAGES.filter((l) => l.group === group).map((lang) => {
            const isOn = !!enabled[lang.id]
            return (
              <label
                key={lang.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  padding: '6px 0',
                  borderBottom: '1px solid var(--dsw-alias-border-l2, #eee)',
                }}
              >
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={(e) => toggle(lang.id, e.target.checked)}
                />
                <span style={{ flex: 1 }}>{lang.displayName}</span>
                {lang.heavy && (
                  <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>{t('heavy')}</span>
                )}
                {lang.experimental && (
                  <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>{t('experimental')}</span>
                )}
                <span
                  style={{
                    fontSize: 11,
                    color: isOn ? 'var(--dsw-alias-bg-success, #16a34a)' : 'var(--dsw-alias-label-tertiary)',
                  }}
                >
                  {isOn ? t('statusOn') : t('statusOff')}
                </span>
              </label>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export function apply(ctx: Context) {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-lsp-plugin: section dictionaries')
  const scope = ctx.settingsScope.bind({ namespace: NS })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'lsp',
    order: 20,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({
      hooks: {
        scope,
      },
      setEnabled: (next: Record<string, boolean>) => void scope.set('enabled', next),
      setIdle: (ms: number) => void scope.set('idleTimeoutMs', ms),
    }),
  }, LspSettingsSection))
}

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope'] as const
