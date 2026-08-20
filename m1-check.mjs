// M1 无 GUI 验证：加载插件 → 注册工具 → 执行 lsp_definition → 验证返回正确定义位置
// 用真实 cordis Context + 真实 LocalSubprocessRuntime（provide 为 ctx.subprocess），
// ctx.tools 用 mock 捕获注册的工具定义，然后直接调 execute。
import { Context } from '/Users/wuminxuan/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js'
import { LocalSubprocessRuntime } from '/Users/wuminxuan/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js'

const FIXTURE = '/Users/wuminxuan/Desktop/test/dsh-plugin/m0-fixture'

const ctx = new Context()
new LocalSubprocessRuntime(ctx) // 注册为 ctx.subprocess

// mock tools 注册表
const registered = []
ctx.tools = {
  register(tool) { registered.push(tool) },
}

// 加载插件（node --experimental-strip-types 运行本脚本）
const plugin = await import('./scratch-lsp-plugin/src/index.ts')
console.log('[check] plugin name =', plugin.name)
console.log('[check] inject =', plugin.inject.join(', '))

const config = { enabled: { typescript: true }, idleTimeoutMs: 300000 }
plugin.apply(ctx, config)

const tool = registered.find((t) => t.name === 'lsp_definition')
if (!tool) { console.error('[check] ❌ lsp_definition not registered'); process.exit(1) }
console.log('[check] ✅ lsp_definition registered, timeoutMs =', tool.timeoutMs)

const exec = {
  signal: new AbortController().signal,
  agent: { session: { header: { cwd: FIXTURE } } },
}

// 验证 1：正常定义查找（greet 调用点，index.ts 第 6 行）
const r1 = await tool.execute({ file: 'index.ts', line: 6, symbol: 'greet' }, exec)
console.log('\n--- 验证 1: definition of greet ---')
console.log(r1)
const ok1 = r1.includes('index.ts:1:10') && r1.includes('function greet')
console.log('[check] 验证 1', ok1 ? '✅ PASS' : '❌ FAIL')

// 验证 2：未启用语言（config 未勾选 python）
const configOff = { enabled: {}, idleTimeoutMs: 300000 }
plugin.apply(ctx, configOff)
const tool2 = registered[registered.length - 1]
const r2 = await tool2.execute({ file: 'index.ts', line: 6, symbol: 'greet' }, exec)
console.log('\n--- 验证 2: not enabled ---')
console.log(r2)
const ok2 = /not enabled/.test(r2)
console.log('[check] 验证 2', ok2 ? '✅ PASS' : '❌ FAIL')

// 验证 3：无 rootMarkers 的文件（工作区根目录外的一个 .ts 文件，找不到 projectRoot）
const tmpFile = '/tmp/m0-outside.ts'
const { writeFileSync } = await import('node:fs')
writeFileSync(tmpFile, 'export const x = 1\n')
const r3 = await tool.execute({ file: tmpFile, line: 1, symbol: 'x' }, exec)
console.log('\n--- 验证 3: no project root (standby) ---')
console.log(r3)
const ok3 = /standby|not enabled|not found/.test(r3)
console.log('[check] 验证 3', ok3 ? '✅ PASS' : '❌ FAIL')

// 验证 4：未知扩展名
const r4 = await tool.execute({ file: 'foo.xyz', line: 1 }, exec)
console.log('\n--- 验证 4: unknown extension ---')
console.log(r4)
const ok4 = /No LSP server configured/.test(r4)
console.log('[check] 验证 4', ok4 ? '✅ PASS' : '❌ FAIL')

// 清理：卸载池（模拟插件卸载）
await poolDispose()
async function poolDispose() {
  // 通过第二个 ctx 不可行；直接终止：插件 apply 里 ctx.effect 注册了清理，
  // 这里手动触发 ctx 的 dispose 会终止 subprocess 托管进程
  ctx.dispose?.()
}

console.log('\n===== M1 无 GUI 验证结果 =====')
console.log(`PASS: ${[ok1, ok2, ok3, ok4].filter(Boolean).length}/4`)
process.exit([ok1, ok2, ok3, ok4].every(Boolean) ? 0 : 1)
