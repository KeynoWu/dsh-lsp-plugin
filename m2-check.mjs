// 本脚本为开发期本机验证工具：依赖本地 DSH 安装（@deepseek-ai/* 包）。
// 若你的 DSH 安装路径不同，请替换下方绝对路径。
// M2 无 GUI 验证：四工具（definition/hover/references/diagnostics）对 TS + Python 均可用，idle 回收生效
import { Context } from '/Users/wuminxuan/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js'
import { LocalSubprocessRuntime } from '/Users/wuminxuan/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js'

const FIXTURE = '/Users/wuminxuan/Desktop/test/dsh-plugin/m0-fixture'

const ctx = new Context()
new LocalSubprocessRuntime(ctx)

const registered = []
ctx.tools = { register(tool) { registered.push(tool) } }

const plugin = await import('./scratch-lsp-plugin/src/index.ts')
const config = { enabled: { typescript: true, python: true }, idleTimeoutMs: 300000 }
plugin.apply(ctx, config)

const tools = Object.fromEntries(registered.map((t) => [t.name, t]))
const expected = ['lsp_definition', 'lsp_hover', 'lsp_references', 'lsp_diagnostics']
for (const name of expected) {
  if (!tools[name]) { console.error(`[check] ❌ tool ${name} missing`); process.exit(1) }
}
console.log(`[check] ✅ 4 tools registered: ${expected.join(', ')}`)

const exec = { signal: new AbortController().signal, agent: { session: { header: { cwd: FIXTURE } } } }
const results = []

async function run(name, fn) {
  try {
    const out = await fn()
    results.push(out.ok)
    console.log(`\n--- ${name} ---`)
    console.log(out.text)
    console.log(`[check] ${name}: ${out.ok ? '✅ PASS' : '❌ FAIL'}`)
  } catch (e) {
    results.push(false)
    console.log(`\n--- ${name} ---\nERROR: ${e.message}`)
    console.log(`[check] ${name}: ❌ FAIL (threw)`)
  }
}

// ===== TS 四工具 =====
await run('TS definition (greet)', async () => {
  const r = await tools.lsp_definition.execute({ file: 'index.ts', line: 6, symbol: 'greet' }, exec)
  return { ok: r.includes('index.ts:1:10') && r.includes('function greet'), text: r }
})
await run('TS hover (greet)', async () => {
  const r = await tools.lsp_hover.execute({ file: 'index.ts', line: 6, symbol: 'greet' }, exec)
  return { ok: r.includes('greet') && (r.includes('=>') || r.includes('function')), text: r }
})
await run('TS references (greet)', async () => {
  const r = await tools.lsp_references.execute({ file: 'index.ts', line: 6, symbol: 'greet' }, exec)
  return { ok: /References of greet \(\d+\)/.test(r) && r.includes('index.ts'), text: r }
})
await run('TS diagnostics (clean index.ts)', async () => {
  const r = await tools.lsp_diagnostics.execute({ file: 'index.ts' }, exec)
  return { ok: r.startsWith('OK'), text: r }
})
await run('TS diagnostics (broken.ts)', async () => {
  const r = await tools.lsp_diagnostics.execute({ file: 'broken.ts' }, exec)
  const hasError = /Error|error/.test(r)
  return { ok: hasError, text: r }
})

// ===== Python 工具（pyright）=====
await run('PY definition (greet)', async () => {
  const r = await tools.lsp_definition.execute({ file: 'py/greet.py', line: 5, symbol: 'greet' }, exec)
  return { ok: r.includes('greet.py:1:5') || r.includes('greet.py:1:'), text: r }
})
await run('PY diagnostics (clean greet.py)', async () => {
  const r = await tools.lsp_diagnostics.execute({ file: 'py/greet.py' }, exec)
  return { ok: r.startsWith('OK'), text: r }
})
await run('PY diagnostics (broken.py)', async () => {
  const r = await tools.lsp_diagnostics.execute({ file: 'py/broken.py' }, exec)
  const hasError = /Error|error/.test(r)
  return { ok: hasError, text: r }
})

// ===== idle 回收 =====
await run('idle reap (inactive client terminated)', async () => {
  // 用一个新池验证：short idle timeout
  const plugin2 = plugin
  const ctx2 = new Context()
  new LocalSubprocessRuntime(ctx2)
  const reg2 = []
  ctx2.tools = { register(t) { reg2.push(t) } }
  plugin2.apply(ctx2, { enabled: { typescript: true }, idleTimeoutMs: 100 })
  const tool2 = reg2.find((t) => t.name === 'lsp_definition')
  await tool2.execute({ file: 'index.ts', line: 6, symbol: 'greet' }, exec)
  // 池实例不可直接访问；通过第二次调用验证懒启动后，把 lastActivity 改老再 reap
  // 通过 apply 内的 pool 不可达——改用公开 API 验证：重新实例化池不可行，这里验证
  // LspPool 行为用直接构造：
  const { LspPool } = await import('./scratch-lsp-plugin/src/client.ts')
  const pool = new LspPool(ctx2, 100)
  pool.idleTimeout = 100
  // 复用刚 spawn 的 client？不可达。改为直接验证 reapNow 语义：
  // 通过工具调用触发池内 client 后，无法从外部取 client；因此用受控构造：
  const entry = (await import('./scratch-lsp-plugin/src/catalog.ts')).CATALOG.find((e) => e.id === 'typescript')
  const c = pool.get(entry, FIXTURE)
  await c.getReady()
  c.lastActivity = Date.now() - 5000
  pool.reapNow()
  const ok = pool.size === 0
  await pool.disposeAll()
  return { ok, text: ok ? `idle reap: pool size ${pool.size === 0 ? '0 (reaped)' : pool.size}` : `pool size ${pool.size}` }
})

console.log(`\n===== M2 无 GUI 验证结果 =====`)
console.log(`PASS: ${results.filter(Boolean).length}/${results.length}`)
process.exit(results.every(Boolean) ? 0 : 1)
