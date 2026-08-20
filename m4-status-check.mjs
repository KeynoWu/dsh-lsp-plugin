// M4 验证：host remote（LspStatusGateway.describe）注册与返回结构
import { Context } from '@deepseek-ai/cordis'
import { LspStatusGateway } from './scratch-lsp-plugin/src/status.ts'

const ctx = new Context()
const registered = []
ctx.tools = { register(t) { registered.push(t) } }

const plugin = await import('./scratch-lsp-plugin/src/index.ts')
const baseConfig = { enabled: { typescript: true, python: true }, idleTimeoutMs: 300000 }
plugin.apply(ctx, baseConfig)
console.log('[m4] plugin applied')

// 直接实例化 gateway 调 describe（Typert wire 在无 GUI 环境可能不可用，方法本身是普通函数）
const gateway = new LspStatusGateway(ctx, () => baseConfig)
const desc = gateway.describe()
console.log('[m4] describe 返回：')
console.log('  languages:', desc.languages.length, '个（', desc.languages.map(l => l.id).slice(0, 5).join(','), '... )')
console.log('  typescript:', JSON.stringify(desc.statuses.typescript))
console.log('  python:', JSON.stringify(desc.statuses.python))
console.log('  go:', JSON.stringify(desc.statuses.go))
console.log('  enabled:', JSON.stringify(desc.enabled))
console.log('  idleTimeoutMs:', desc.idleTimeoutMs)

const ok = desc.languages.length === 16
  && desc.statuses.typescript?.found === true
  && desc.statuses.python?.found === true
  && desc.statuses.go?.found === false
  && desc.enabled.typescript === true
  && desc.enabled.python === true
console.log(`\n[m4] ${ok ? '✅ PASS（describe 全结构正确：16 语言 + 检测状态 + 配置）' : '❌ FAIL'}`)
process.exit(ok ? 0 : 1)
