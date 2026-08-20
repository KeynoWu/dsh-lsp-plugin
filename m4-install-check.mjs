// M4 验证：安装引导（gateway.install）——命令构造 + note-only 引导 + 安装后检测
import { Context } from '/Users/wuminxuan/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js'
import { LspStatusGateway } from './scratch-lsp-plugin/lib/status.js'

const ctx = new Context()
const captures = []
// mock subprocess：捕获 argv，返回成功退出
ctx.subprocess = {
  spawn: (spec) => {
    captures.push({ argv: spec.argv, cwd: spec.cwd, graceMs: spec.graceMs })
    return { done: Promise.resolve({ exitCode: 0 }), terminate() {} }
  },
}

const gateway = new LspStatusGateway(ctx, () => ({ enabled: { typescript: true }, idleTimeoutMs: 300000 }))
const results = []

// 1) note-only 语言（java）：返回引导说明，不 spawn
const java = await gateway.install('java')
console.log('[install] java →', JSON.stringify(java))
results.push(!java.ok && /JDTLS|install/i.test(java.message ?? '') && captures.length === 0)

// 2) npm 类（typescript）：spawn npm install -g typescript-language-server
const ts = await gateway.install('typescript')
console.log('[install] typescript →', JSON.stringify(ts))
const tsSpawn = captures[captures.length - 1]
results.push(tsSpawn.argv.join(' ') === 'npm install -g typescript-language-server' && ts.ok === true)

// 3) go 类（go）：go install gopls
const go = await gateway.install('go')
console.log('[install] go →', JSON.stringify(go))
const goSpawn = captures[captures.length - 1]
results.push(goSpawn.argv[0] === 'go' && goSpawn.argv.includes('golang.org/x/tools/gopls@latest'))

// 4) rustup 类（rust）
const rust = await gateway.install('rust')
console.log('[install] rust →', JSON.stringify(rust))
const rustSpawn = captures[captures.length - 1]
results.push(rustSpawn.argv[0] === 'rustup' && rustSpawn.argv.includes('rust-analyzer'))

// 5) 未知语言
const unknown = await gateway.install('nope')
console.log('[install] unknown →', JSON.stringify(unknown))
results.push(!unknown.ok && /Unknown/.test(unknown.message ?? ''))

// 6) 安装后检测（typescript 真存在 → found）
console.log('[install] ts status after install:', JSON.stringify(ts.status))

const allOk = results.every(Boolean)
console.log(`\n[install] ${allOk ? '✅ PASS（6/6：note 引导 + 命令构造 ×3 + 未知语言 + 安装后检测）' : `❌ FAIL ${results.filter(Boolean).length}/6`}`)
process.exit(allOk ? 0 : 1)
