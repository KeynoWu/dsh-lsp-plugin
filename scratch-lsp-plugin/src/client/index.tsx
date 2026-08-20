/**
 * DSH LSP 插件 client 端：设置页（M3 host 接线 + M4 状态数据源）。
 * 注册 `settings.section` slot（设置 → "LSP 语言"），语言勾选写入 `lsp` namespace。
 * M4：语言目录与检测状态改由 host remote（`ctx.remote.lspStatus.describe()`）下发，
 * 消除双份维护，并展示 可用✓/缺失⚠/版本 状态徽标。
 */
import { useState, useEffect } from 'react'
import type { Context } from '@deepseek-ai/cordis'
// 触发 client 端包的 cordis Context 类型增强（slots/locale/settingsScope/remote）
import '@deepseek-ai/dsh-client-runtime/client'
import '@deepseek-ai/dsh-client-locale/client'
import '@deepseek-ai/dsh-client-ui-settings/client'
import '@deepseek-ai/dsh-api-remotes/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

// 增强 LocaleNamespaceMap：注册本插件自己的 locale namespace（值取字典键集合）
type LspLocaleKey =
  | 'nav' | 'summary' | 'idleLabel' | 'enabled' | 'heavy' | 'experimental'
  | 'statusOn' | 'statusOff' | 'statusAvailable' | 'statusMissing' | 'statusUnknown' | 'statusFailed'

const zh = {
  nav: 'LSP 语言',
  summary: '勾选启用的语言；未安装的服务器保持关闭，避免模型误调。',
  idleLabel: '空闲回收超时（ms）',
  enabled: '启用',
  heavy: '重',
  experimental: '实验性',
  statusOn: '已启用',
  statusOff: '未启用',
  statusAvailable: '可用',
  statusMissing: '缺失',
  statusUnknown: '…',
  statusFailed: '状态加载失败',
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
  statusAvailable: 'available',
  statusMissing: 'missing',
  statusUnknown: '…',
  statusFailed: 'status load failed',
}

const dictionaries = { zh, en } as const

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    lsp: LspLocaleKey
  }
}

const NS = 'lsp'

/** host remote 返回的状态结构（与 src/status.ts 的 LspStatusDescribe 对齐） */
export interface LspStatusDescribe {
  languages: Array<{
    id: string
    displayName: string
    group: string
    priority: string
    heavy?: boolean
    experimental?: boolean
  }>
  statuses: Record<string, { found: boolean; version?: string; reason?: string }>
  enabled: Record<string, boolean>
  idleTimeoutMs: number
}

// client 端 remote 类型增强：`ctx.remote.lspStatus.describe()`
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    lspStatus: { describe(): Promise<LspStatusDescribe> }
  }
}

interface LspSettingsValue {
  enabled?: Record<string, boolean>
  idleTimeoutMs?: number
}

interface SectionProps {
  close: () => void
  /** slots 系统注入的 translate（按注册时 locale: NS） */
  t: TranslateNS<'lsp'>
  /** slots 系统把 hooks 包装成的 selector hook（对应 hooks.scope） */
  useScope: <S>(sel: (s: SettingsScopeSnapshot<unknown>) => S, eq?: (a: S, b: S) => boolean) => S
  /** 直接 props（来自 inject 返回的额外键） */
  setEnabled: (next: Record<string, boolean>) => void
  setIdle: (ms: number) => void
  loadStatus: () => Promise<LspStatusDescribe>
}

function LspSettingsSection({ t, useScope, setEnabled, setIdle, loadStatus }: SectionProps) {
  const [status, setStatus] = useState<LspStatusDescribe | undefined>(undefined)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let alive = true
    loadStatus()
      .then((s) => { if (alive) { setStatus(s); setLoadFailed(false) } })
      .catch(() => { if (alive) setLoadFailed(true) })
    return () => { alive = false }
  }, [loadStatus])

  // settings 快照（slots 系统注入的 selector hook）
  const scopeSnap = useScope((s) => s)
  const value = (scopeSnap.value as LspSettingsValue | undefined) ?? {}
  const enabled = value.enabled ?? {}
  const idleMs = value.idleTimeoutMs ?? 300000

  const languages = status?.languages ?? []
  const statuses = status?.statuses ?? {}
  const groups = [...new Set(languages.map((l) => l.group))]

  const toggle = (id: string, next: boolean) => {
    setEnabled({ ...enabled, [id]: next })
  }
  const changeIdle = (ms: number) => {
    setIdle(ms)
  }

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
      {loadFailed && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-error, #dc2626)' }}>
          {t('statusFailed')}
        </p>
      )}
      {languages.length === 0 && !loadFailed && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>{t('statusUnknown')}</p>
      )}
      {groups.map((group) => (
        <div key={group} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h3 style={{ margin: '8px 0 0', fontSize: 14, fontWeight: 600 }}>{group}</h3>
          {languages.filter((l) => l.group === group).map((lang) => {
            const isOn = !!enabled[lang.id]
            const st = statuses[lang.id]
            const badge = st
              ? st.found
                ? { text: st.version ? `✓ ${st.version}` : t('statusAvailable'), color: 'var(--dsw-alias-bg-success, #16a34a)' }
                : { text: `${t('statusMissing')} ⚠`, color: 'var(--dsw-alias-bg-warning, #d97706)' }
              : { text: t('statusUnknown'), color: 'var(--dsw-alias-label-tertiary)' }
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
                <span style={{ fontSize: 11, color: badge.color, minWidth: 56, textAlign: 'right' }}>
                  {badge.text}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: isOn ? 'var(--dsw-alias-bg-success, #16a34a)' : 'var(--dsw-alias-label-tertiary)',
                    minWidth: 44,
                    textAlign: 'right',
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

  // 挂载 host remote 贡献（lspStatus.describe）——描述符与 host 端 gateway 对齐
  void ctx.remote.$mount({
    package: 'dsh-lsp-plugin',
    descriptors: [{
      id: 'lspStatus.describe',
      service: 'lspStatus',
      namespace: 'lspStatus',
      method: 'describe',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'src-json' },
    }],
  }).catch(() => { /* remote 未就绪时设置页降级为仅勾选 */ })

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
      loadStatus: () => ctx.remote.lspStatus.describe(),
    }),
  }, LspSettingsSection))
}

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope'] as const
