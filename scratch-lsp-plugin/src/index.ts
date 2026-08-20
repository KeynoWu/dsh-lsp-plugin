/**
 * DSH LSP 插件入口（M3）。
 * 平面归属（lsp-plugin-design.md v2 §1.1）：
 * - settings section（`lsp` namespace）→ host 平面（跨会话共享，用户勾选是全局偏好）
 * - LSP 引擎 + 四工具 → agent preset（每会话实例）；M1–M3 开发期先以 host 平面挂载验证
 * - client 设置页 → 随包 `./client` 入口（M3，见 package.json `dsh.client`）
 * 生命周期：池内全部进程随插件卸载经 ctx.effect 终止；subprocess 服务销毁兜底。
 */
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-subprocess' // 触发 Context.subprocess 类型增强
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { LspPool } from './client.ts'
import { LspStatusGateway } from '../lib/status.js' // 构建产物（装饰器需转译，见 scripts/build:status）
import { createDefinitionTool, createHoverTool, createReferencesTool, createDiagnosticsTool, createRenameTool, type LspPluginConfig as LspConfig } from './tools.ts'

export const name = 'dsh-lsp-plugin'

export const inject = ['tools', 'subprocess', 'fs'] as const

/** 插件配置类型（与 tools.ts 的 LspPluginConfig 对齐；schemastery 不用 z.infer，类型独立声明） */
export interface Config extends LspConfig {}

export const Config: z<Config> = z.object({
  /** 语言白名单：语言 id → 是否启用（默认全不启用，用户勾选写入 settings section） */
  enabled: z.dict(z.boolean()).default({}),
  /** 全局空闲回收阈值（ms），v2 定稿：回收前检查 in-flight，有则跳过 */
  idleTimeoutMs: z.number().min(0).default(300000),
  /** 并发服务器上限（M4：多会话/多语言资源防护，超限拒绝新服务器） */
  maxConcurrentServers: z.number().min(1).default(4),
})

const NS = settingsNamespace('lsp')

export function apply(ctx: Context, config: Config) {
  console.log(`[dsh-lsp-plugin] apply OK, enabled=${JSON.stringify(config.enabled)} idleTimeoutMs=${config.idleTimeoutMs} max=${config.maxConcurrentServers}`)
  const pool = new LspPool(ctx, config.idleTimeoutMs, config.maxConcurrentServers)

  // settings section 接线：settings 服务存在时 current 指向解析后的用户配置，
  // 否则退回组合 entry config（installSettingsSection 的 optional 语义）。
  // 注意：setSource 收到的是 thunk（() => scope.get()），必须保存 thunk 而非立即取值。
  let current: () => Config = () => config
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {
      pool.idleTimeout = current().idleTimeoutMs
      pool.concurrentLimit = current().maxConcurrentServers ?? 4
    },
  })
  const getConfig = () => current()

  // host remote：设置页状态查询（语言目录 + 检测状态 + 当前配置）
  new LspStatusGateway(ctx, getConfig)

  // 卸载时释放全部语言服务器进程（双保险：subprocess 服务销毁也会兜底）
  ctx.effect(() => {
    return () => pool.disposeAll()
  })

  ctx.tools.register(createDefinitionTool(ctx, pool, getConfig))
  ctx.tools.register(createHoverTool(ctx, pool, getConfig))
  ctx.tools.register(createReferencesTool(ctx, pool, getConfig))
  ctx.tools.register(createDiagnosticsTool(ctx, pool, getConfig))
  ctx.tools.register(createRenameTool(ctx, pool, getConfig))
}
