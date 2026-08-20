/**
 * typert host manifest：注册 lspStatus remote 命名空间（describe/install）。
 * typert-loader 按 loader entry 包名扫描 package.json exports 的 "./typert"，
 * import 本文件取 `TYPERT` 注册——host 端 gateway（LspStatusGateway，service "lspStatus"）
 * 的 remote 方法由此暴露给 client（ctx.remote.lspStatus.describe/install）。
 * 手写（strict codec + zod v4 schema），与 src/status.ts 的 @Remote 装饰器标记一一对应。
 * 结构对齐 @deepseek-ai/dsh-host-plugin-inventory/lib/typert.host.js（rc.8 校验要求：
 * TYPERT.model 为对象，invocation codec 必须 mode: "strict" 且 schema 为 zod v4 实例）。
 */
import { z } from 'zod'

const languageMetaSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  group: z.string(),
  priority: z.string(),
  heavy: z.boolean().optional(),
  experimental: z.boolean().optional(),
})

const lspStatusDescribeSchema = z.object({
  languages: z.array(languageMetaSchema),
  statuses: z.record(z.string(), z.object({
    found: z.boolean(),
    version: z.string().optional(),
    reason: z.string().optional(),
  })),
  enabled: z.record(z.string(), z.boolean()),
  idleTimeoutMs: z.number(),
})

const lspInstallResultSchema = z.object({
  ok: z.boolean(),
  status: z.object({
    found: z.boolean(),
    version: z.string().optional(),
    reason: z.string().optional(),
  }).optional(),
  message: z.string().optional(),
  command: z.string().optional(),
})

export const TYPERT = {
  package: 'dsh-lsp-plugin',
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: 'dsh-lsp-plugin#lspStatus/describe',
      service: 'lspStatus',
      namespace: 'lspStatus',
      method: 'describe',
      invocation: { kind: 'direct' },
      parameters: [],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-lsp-plugin/types#LspStatusDescribe',
        schema: lspStatusDescribeSchema,
      },
    },
    {
      id: 'dsh-lsp-plugin#lspStatus/install',
      service: 'lspStatus',
      namespace: 'lspStatus',
      method: 'install',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'languageId',
          wire: 'languageId',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'string',
            schema: z.string(),
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-lsp-plugin/types#LspInstallResult',
        schema: lspInstallResultSchema,
      },
    },
  ],
  model: {
    services: [],
    events: [],
    objects: [],
  },
}
