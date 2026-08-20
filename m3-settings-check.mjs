// 本脚本为开发期本机验证工具：依赖本地 DSH 安装（@deepseek-ai/* 包）。
// 若你的 DSH 安装路径不同，请替换下方绝对路径。
// M3 host 端验证：settings section 接线（installSettingsSection + settings.update 动态生效）
import { Context } from '/Users/wuminxuan/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js'
import { LocalSubprocessRuntime } from '/Users/wuminxuan/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js'
import { SettingsProvider, settingsNamespace } from '/Users/wuminxuan/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-settings/lib/index.js'

const FIXTURE = '/Users/wuminxuan/Desktop/test/dsh-plugin/m0-fixture'

// 内存版 SettingsProvider（实现 load/persist）
class MemorySettingsProvider extends SettingsProvider {
  writable = true
  doc = {}
  async load() { return this.doc }
  async persist(ns, section) { this.doc[ns] = section }
  get documentPath() { return undefined }
  async prepareDocument() { return undefined }
}

const ctx = new Context()
new MemorySettingsProvider(ctx)
new LocalSubprocessRuntime(ctx)
console.log('[m3] MemorySettingsProvider mounted:', !!ctx.settings)

const registered = []
ctx.tools = { register(t) { registered.push(t) } }
const plugin = await import('./scratch-lsp-plugin/src/index.ts')
const baseConfig = { enabled: { typescript: true }, idleTimeoutMs: 300000 }
plugin.apply(ctx, baseConfig)

const tools = Object.fromEntries(registered.map((t) => [t.name, t]))
const exec = { signal: new AbortController().signal, agent: { session: { header: { cwd: FIXTURE } } } }

// 1) base 只有 typescript：python 调用应报 not enabled
const before = await tools.lsp_definition.execute({ file: 'py/greet.py', line: 5, symbol: 'greet' }, exec)
console.log('[m3] base 配置下 python 调用 →', before.slice(0, 90))
const ok1 = /not enabled/.test(before)

// 2) 模拟设置页写入：settings.update 勾选 python
const NS = settingsNamespace('lsp')
await ctx.settings.update(NS, { enabled: { python: true } })
console.log('[m3] settings.update(lsp, {enabled:{python:true}}) 完成')
const resolved = ctx.settings.get(NS)
console.log('[m3] settings.get(lsp) →', JSON.stringify(resolved))

// 3) 动态生效：python 调用应进入语义查找（不再报 not enabled）
const after = await tools.lsp_definition.execute({ file: 'py/greet.py', line: 5, symbol: 'greet' }, exec)
console.log('[m3] 勾选后 python 调用 →', after.slice(0, 90))
const ok2 = /not enabled/.test(after) === false && /greet\.py/.test(after)

// 4) 取消勾选（reset 路径）
await ctx.settings.update(NS, { enabled: { python: false } })
const afterOff = await tools.lsp_definition.execute({ file: 'py/greet.py', line: 5, symbol: 'greet' }, exec)
const ok3 = /not enabled/.test(afterOff)

console.log(`\n[m3] 结果: base 拒绝=${ok1} 勾选生效=${ok2} 取消生效=${ok3}`)
console.log(`[m3] ${ok1 && ok2 && ok3 ? '✅ PASS（settings 接线全链路：注册→读取→写入→动态生效→取消）' : '❌ FAIL'}`)
await ctx.settings.update(NS, { enabled: { typescript: true, python: false } })
process.exit(ok1 && ok2 && ok3 ? 0 : 1)
