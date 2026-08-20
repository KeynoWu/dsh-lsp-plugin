/**
 * typert host manifest：注册 lspStatus remote 命名空间（describe/install）。
 * typert-loader 按 loader entry 包名扫描 package.json exports 的 "./typert"，
 * import 本文件取 `TYPERT` 注册——host 端 gateway（LspStatusGateway，service "lspStatus"）
 * 的 remote 方法由此暴露给 client（ctx.remote.lspStatus.describe/install）。
 * 手写（src-json codec），与 src/status.ts 的 @Remote 装饰器标记一一对应。
 */
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
      result: { mode: 'src-json' },
    },
    {
      id: 'dsh-lsp-plugin#lspStatus/install',
      service: 'lspStatus',
      namespace: 'lspStatus',
      method: 'install',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'languageId', wire: 'languageId', source: 'json', codec: { mode: 'src-json' } },
      ],
      result: { mode: 'src-json' },
    },
  ],
}
