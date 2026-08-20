/**
 * Host remote：语言目录 + 检测状态查询（M4）。
 * 通过 Typert Remote 暴露给 client 设置页（`ctx.remote.lspStatus.describe()`），
 * 消除 client 端双份维护的语言列表，并让设置页展示可用/缺失/版本状态。
 * 模式参考 dsh-host-plugin-inventory 的 PluginInventoryGateway（@Remote + TypertRemoteService）。
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import { CATALOG, type LanguageEntry } from './catalog.ts'
import { detectServer } from './detect.ts'

export interface LspLanguageMeta {
  id: string
  displayName: string
  group: string
  priority: string
  heavy?: boolean
  experimental?: boolean
}

export interface LspStatusDescribe {
  languages: LspLanguageMeta[]
  /** 语言 id → 二进制检测结果（found/version/reason） */
  statuses: Record<string, { found: boolean; version?: string; reason?: string }>
  /** 当前启用的语言（settings 解析值） */
  enabled: Record<string, boolean>
  idleTimeoutMs: number
}

export interface LspInstallResult {
  ok: boolean
  /** 安装完成后的检测结果（成功时） */
  status?: { found: boolean; version?: string; reason?: string }
  /** 失败原因 / 无自动安装命令时的引导说明 */
  message?: string
  /** 实际执行的安装命令（执行时） */
  command?: string
}

type ConfigReader = () => { enabled: Record<string, boolean>; idleTimeoutMs: number }

export class LspStatusGateway extends TypertRemoteService {
  private readonly getConfig: ConfigReader

  constructor(ctx: Context, getConfig: ConfigReader) {
    super(ctx, 'lspStatus')
    this.getConfig = getConfig
  }

  /** 一次性返回设置页所需的全部状态（语言目录 + 检测 + 当前配置）。 */
  @Remote('describe')
  describe(): LspStatusDescribe {
    // 检测基于进程 cwd 探测本地 bin（node_modules/.bin 等），PATH 查找不依赖 cwd
    const cwd = process.cwd()
    const statuses: LspStatusDescribe['statuses'] = {}
    for (const entry of CATALOG) {
      statuses[entry.id] = detectServer(entry.server, cwd)
    }
    const config = this.getConfig()
    return {
      languages: CATALOG.map(({ id, displayName, group, priority, heavy, experimental }) => ({
        id,
        displayName,
        group,
        priority,
        heavy,
        experimental,
      })),
      statuses,
      enabled: config.enabled,
      idleTimeoutMs: config.idleTimeoutMs,
    }
  }

  /**
   * 安装引导（M4）：为缺失的语言执行用户级安装命令（非系统级）。
   * 无自动安装命令（仅 note）时返回引导说明。安装是用户显式操作（设置页按钮触发）。
   */
  @Remote('installLanguage')
  async installLanguage(languageId: string): Promise<LspInstallResult> {
    const entry: LanguageEntry | undefined = CATALOG.find((e) => e.id === languageId)
    if (!entry) return { ok: false, message: `Unknown language ${languageId}` }
    const inst = entry.install
    if (!inst?.command) {
      return { ok: false, message: inst?.note ?? `No automated install for ${entry.displayName}` }
    }
    const argv = [inst.command, ...(inst.args ?? [])]
    const cwd = process.cwd()
    try {
      const subprocess = (this.ctx as Context & { subprocess?: { spawn(spec: {
        argv: readonly string[]; cwd: string
        stdio: { stdin: 'ignore' | 'pipe'; stdout: { maxBytes: number }; stderr: { maxBytes: number } }
        graceMs: number
      }): { done: Promise<{ exitCode: number | null }>; terminate(): void } } }).subprocess
      if (!subprocess) return { ok: false, message: 'subprocess seam unavailable' }
      const handle = subprocess.spawn({
        argv,
        cwd,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 128 * 1024 }, stderr: { maxBytes: 128 * 1024 } },
        graceMs: 5000,
      })
      const outcome = await handle.done
      if (outcome.exitCode !== 0) {
        return { ok: false, message: `Install failed (exit ${outcome.exitCode})`, command: argv.join(' ') }
      }
      // 安装后重新检测
      const status = detectServer(entry.server, cwd)
      return {
        ok: status.found,
        status,
        message: status.found ? undefined : 'Install ran but server still not detected; check PATH',
        command: argv.join(' '),
      }
    } catch (error) {
      return { ok: false, message: `Install error: ${error instanceof Error ? error.message : String(error)}`, command: argv.join(' ') }
    }
  }
}
