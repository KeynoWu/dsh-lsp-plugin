const cordisCtx = (await import('/Users/wuminxuan/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js')).Context
const { LocalSubprocessRuntime } = await import('/Users/wuminxuan/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js')
const { LspPool } = await import('./scratch-lsp-plugin/src/client.ts')
const { CATALOG } = await import('./scratch-lsp-plugin/src/catalog.ts')

const FIXTURE = '/Users/wuminxuan/Desktop/test/dsh-plugin/m0-fixture'
const ctx = new cordisCtx()
new LocalSubprocessRuntime(ctx)
const pool = new LspPool(ctx, 300000)
const entry = CATALOG.find((e) => e.id === 'typescript')

// 1) 首次启动
const client = pool.get(entry, FIXTURE)
await client.getReady()
console.log('[crash] 首次 ready =', client.ready, 'pid state OK')

// 2) 模拟崩溃：直接终止底层 handle（进程消失）
client.terminate()
client.handleDoneSettled = true
console.log('[crash] 已模拟崩溃（terminate + 标记 done settled）')

// 3) recover：自动重启一次
await client.recover()
console.log('[crash] recover 后 ready =', client.ready, 'restarted = 1 次')

// 4) 重启后仍可用：openDocument + hover 请求
const uri = 'file://' + FIXTURE + '/index.ts'
const { readFileSync } = await import('node:fs')
client.openDocument(uri, 'typescript', readFileSync(FIXTURE + '/index.ts', 'utf8'))
const hover = await client.request('textDocument/hover', { textDocument: { uri }, position: { line: 5, character: 12 } })
console.log('[crash] 重启后 hover 响应 =', JSON.stringify(hover).slice(0, 80))

// 5) 第二次崩溃 → recover 应拒绝（上限 1，标记故障）
client.terminate()
client.handleDoneSettled = true
let refused = false
try { await client.recover() } catch (e) { refused = /crashed repeatedly/.test(e.message) }
console.log('[crash] 二次崩溃 recover 被拒 =', refused)

await pool.disposeAll()
const ok = refused
console.log('[crash]', ok ? '✅ PASS（崩溃重试一次 + 二次拒绝 + 重启后可用）' : '❌ FAIL')
process.exit(ok ? 0 : 1)
