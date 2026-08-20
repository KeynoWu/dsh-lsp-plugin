/**
 * lib/status.js 的类型声明（手写，与 src/status.ts 的 gateway 对齐）。
 * 运行时实现由 esbuild 转译 src/status.ts 生成（装饰器需转译，源码不能直接加载）。
 */
import type { Context } from '@deepseek-ai/cordis'

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
  statuses: Record<string, { found: boolean; version?: string; reason?: string }>
  enabled: Record<string, boolean>
  idleTimeoutMs: number
}

export interface LspInstallResult {
  ok: boolean
  status?: { found: boolean; version?: string; reason?: string }
  message?: string
  command?: string
}

export class LspStatusGateway {
  constructor(ctx: Context, getConfig: () => { enabled: Record<string, boolean>; idleTimeoutMs: number })
  describe(): LspStatusDescribe
  install(languageId: string): Promise<LspInstallResult>
}
