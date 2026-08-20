/**
 * DSH LSP 插件 client 端：设置页（M3 host 接线 + M4 状态数据源）。
 * 注册 `settings.section` slot（设置 → "LSP 语言"），语言勾选写入 `lsp` namespace。
 * M4：语言目录与检测状态改由 host remote（`ctx.remote.lspStatus.describe()`）下发，
 * 消除双份维护，并展示 可用✓/缺失⚠/版本 状态徽标。
 */
import { useState, useEffect } from 'react'
import { z } from 'zod'
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

/**
 * fallback 语言列表：仅当 host remote（lspStatus.describe）不可用时使用，
 * 保证设置页永不空白（正常时以 host 下发的目录为准，本表不参与）。
 */
const FALLBACK_LANGUAGES: LspStatusDescribe['languages'] = [
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

// client 端 remote 类型增强：`ctx.remote.lspStatus.describe() / install(id)`
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    lspStatus: {
      describe(): Promise<LspStatusDescribe>
      installLanguage(languageId: string): Promise<{
        ok: boolean
        status?: { found: boolean; version?: string; reason?: string }
        message?: string
        command?: string
      }>
    }
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
  installLang: (id: string) => Promise<{ ok: boolean; message?: string }>
}

function LspSettingsSection({ t, useScope, setEnabled, setIdle, loadStatus, installLang }: SectionProps) {
  const [status, setStatus] = useState<LspStatusDescribe | undefined>(undefined)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  const [installingId, setInstallingId] = useState<string | undefined>(undefined)
  const [installError, setInstallError] = useState<string | undefined>(undefined)

  const refresh = () => {
    loadStatus()
      .then((s) => { setStatus(s); setLoadFailed(false); setLoadError(undefined) })
      .catch((e: unknown) => { setLoadFailed(true); setLoadError(e instanceof Error ? e.message : String(e)) })
  }

  useEffect(() => {
    let alive = true
    loadStatus()
      .then((s) => { if (alive) { setStatus(s); setLoadFailed(false); setLoadError(undefined) } })
      .catch((e: unknown) => { if (alive) { setLoadFailed(true); setLoadError(e instanceof Error ? e.message : String(e)) } })
    return () => { alive = false }
  }, [loadStatus])

  const onInstall = async (id: string) => {
    setInstallingId(id)
    setInstallError(undefined)
    try {
      const res = await installLang(id)
      if (!res.ok) setInstallError(`${id}: ${res.message ?? 'install failed'}`)
      refresh()
    } catch (e) {
      setInstallError(`${id}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setInstallingId(undefined)
    }
  }

  // settings 快照（slots 系统注入的 selector hook）
  const scopeSnap = useScope((s) => s)
  const value = (scopeSnap.value as LspSettingsValue | undefined) ?? {}
  const enabled = value.enabled ?? {}
  const idleMs = value.idleTimeoutMs ?? 300000

  // remote 失败/未就绪时退回内置列表（仅显示勾选，无状态徽标）——设置页永不空白
  const languages = status?.languages?.length ? status.languages : FALLBACK_LANGUAGES
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
        <p style={{ margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
          （状态暂不可用：{loadError ?? '未知错误'}——语言列表为内置默认）
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
                {st && !st.found && (
                  <button
                    type="button"
                    disabled={installingId !== undefined}
                    onClick={(e) => { e.preventDefault(); void onInstall(lang.id) }}
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      cursor: installingId === lang.id ? 'wait' : 'pointer',
                      background: 'var(--dsw-alias-bg-module-platform, #f0f0f0)',
                      border: '1px solid var(--dsw-alias-border-l2, #ddd)',
                      borderRadius: 4,
                    }}
                  >
                    {installingId === lang.id ? '…' : '安装'}
                  </button>
                )}
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
      {installError && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-error, #dc2626)' }}>
          {installError}
        </p>
      )}
    </div>
  )
}

export function apply(ctx: Context) {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-lsp-plugin: section dictionaries')
  const scope = ctx.settingsScope.bind({ namespace: NS })

  // 挂载 host remote 贡献（lspStatus.describe/install）——codec 必须 strict + zod schema（与 host manifest 对称）
  void ctx.remote.$mount({
    package: 'dsh-lsp-plugin',
    descriptors: [{
      id: 'lspStatus.describe',
      service: 'lspStatus',
      namespace: 'lspStatus',
      method: 'describe',
      invocation: { kind: 'direct' },
      parameters: [],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-lsp-plugin/types#LspStatusDescribe',
        schema: z.object({
          languages: z.array(z.object({
            id: z.string(), displayName: z.string(), group: z.string(), priority: z.string(),
            heavy: z.boolean().optional(), experimental: z.boolean().optional(),
          })),
          statuses: z.record(z.string(), z.object({
            found: z.boolean(), version: z.string().optional(), reason: z.string().optional(),
          })),
          enabled: z.record(z.string(), z.boolean()),
          idleTimeoutMs: z.number(),
        }),
      },
    }, {
      id: 'lspStatus.installLanguage',
      service: 'lspStatus',
      namespace: 'lspStatus',
      method: 'installLanguage',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'languageId',
        wire: 'languageId',
        source: 'json',
        codec: { mode: 'strict', typeSymbol: 'string', schema: z.string() },
      }],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-lsp-plugin/types#LspInstallResult',
        schema: z.object({
          ok: z.boolean(),
          status: z.object({
            found: z.boolean(), version: z.string().optional(), reason: z.string().optional(),
          }).optional(),
          message: z.string().optional(),
          command: z.string().optional(),
        }),
      },
    }],
  }).catch((e: unknown) => {
    // 暴露 $mount 失败原因（开发期排查用；remote 未就绪时设置页降级为内置列表）
    console.error('[dsh-lsp-plugin] $mount failed:', e)
  })

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
      // 防御：$mount 异步完成前 remote.lspStatus 可能未挂载——避免同步 TypeError（会让组件崩溃白屏）
      loadStatus: () => {
        const svc = ctx.remote.lspStatus
        return svc ? svc.describe() : Promise.reject(new Error('LSP status remote not ready yet'))
      },
      installLang: (id: string) => {
        const svc = ctx.remote.lspStatus
        return svc ? svc.installLanguage(id) : Promise.reject(new Error('LSP status remote not ready yet'))
      },
    }),
  }, LspSettingsSection))
}

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope'] as const
