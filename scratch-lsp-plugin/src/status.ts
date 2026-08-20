/**
 * Host remote：语言目录 + 检测状态查询（M4）。
 * 通过 Typert Remote 暴露给 client 设置页（`ctx.remote.lspStatus.describe()`），
 * 消除 client 端双份维护的语言列表，并让设置页展示可用/缺失/版本状态。
 * 模式参考 dsh-host-plugin-inventory 的 PluginInventoryGateway（@Remote + TypertRemoteService）。
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import { CATALOG } from './catalog.ts'
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
}
