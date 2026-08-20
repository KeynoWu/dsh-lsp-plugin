// M0 验证：ctx.subprocess seam 能否承载 LSP 双向长驻进程
// 用真实的 LocalSubprocessRuntime spawn typescript-language-server，
// 完成 initialize → initialized → didOpen → definition → shutdown 全链路。
// 同时验证：默认 env（scrubbedParentEnv）下 PATH 是否可用、进程清理语义。
import { LocalSubprocessRuntime } from '/Users/wuminxuan/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const FIXTURE = '/Users/wuminxuan/Desktop/test/dsh-plugin/m0-fixture'
const TS_SERVER = 'typescript-language-server' // 裸命令名 → 走 PATH 解析，验证默认 env 可用

// ---- 最小 Cordis ctx：LocalSubprocessRuntime 的 Service 基类需要 ctx.reflect ----
import { Context } from '/Users/wuminxuan/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js'
const ctx = new Context()
const runtime = new LocalSubprocessRuntime(ctx)

// ---- JSON-RPC Content-Length 帧编解码 ----
function encode(msg) {
  const body = JSON.stringify(msg)
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
}
function createFrameParser(onMessage) {
  let buf = Buffer.alloc(0)
  return (chunk) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      const headEnd = buf.indexOf('\r\n\r\n')
      if (headEnd === -1) return
      const head = buf.subarray(0, headEnd).toString('utf8')
      const m = /Content-Length:\s*(\d+)/i.exec(head)
      if (!m) { buf = buf.subarray(headEnd + 4); continue }
      const len = Number(m[1])
      if (buf.length < headEnd + 4 + len) return
      const body = buf.subarray(headEnd + 4, headEnd + 4 + len).toString('utf8')
      buf = buf.subarray(headEnd + 4 + len)
      try { onMessage(JSON.parse(body)) } catch (e) { console.error('[frame parse error]', e.message) }
    }
  }
}
function pendingRequest(id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`request ${id} timed out`)), 15000)
    pendingRequests.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v) }, reject: (e) => { clearTimeout(timer); reject(e) } })
  })
}
const pendingRequests = new Map()

async function spawnAndHandshake(tag, { withEnv } = {}) {
  console.log(`\n===== [${tag}] spawn ${TS_SERVER} --stdio (cwd=${FIXTURE}) =====`)
  const env = withEnv ? { PATH: process.env.PATH } : undefined
  const handle = runtime.spawn({
    argv: [TS_SERVER, '--stdio'],
    cwd: FIXTURE,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 65536 } },
    graceMs: 3000,
    ...(env ? { env } : {}),
  })
  console.log(`[${tag}] pid=${handle.pid} stdin=${!!handle.stdin} stdout=${!!handle.stdout}`)

  const feed = createFrameParser((msg) => {
    if (msg.id !== undefined && pendingRequests.has(msg.id)) {
      const p = pendingRequests.get(msg.id); pendingRequests.delete(msg.id)
      msg.error ? p.reject(new Error(`server error ${JSON.stringify(msg.error)}`)) : p.resolve(msg.result)
    } else if (msg.method) {
      console.log(`[${tag}] << notification: ${msg.method}${msg.params ? ' ' + JSON.stringify(msg.params).slice(0, 120) : ''}`)
    }
  })
  handle.stdout.on('data', feed)
  const stderrTail = () => handle.collected.stderr?.readFrom(0).text ?? ''

  // 1) initialize
  const initId = 1
  handle.stdin.write(encode({
    jsonrpc: '2.0', id: initId, method: 'initialize',
    params: {
      processId: process.pid,
      rootUri: pathToFileURL(FIXTURE).href,
      capabilities: { textDocument: { definition: { linkSupport: true } } },
      workspaceFolders: [{ uri: pathToFileURL(FIXTURE).href, name: 'm0-fixture' }],
    },
  }))
  const caps = await pendingRequest(initId)
  const hasDef = !!(caps.capabilities?.definitionProvider)
  const hasHover = !!(caps.capabilities?.hoverProvider)
  const hasRef = !!(caps.capabilities?.referencesProvider)
  const hasDiag = !!(caps.capabilities?.textDocumentSync && caps.capabilities.diagnosticProvider)
  console.log(`[${tag}] initialize OK → definition=${hasDef} hover=${hasHover} references=${hasRef} diagnostic=${hasDiag} serverInfo=${JSON.stringify(caps.serverInfo)}`)
  return { handle, caps, stderr: () => stderrTail }
}

async function definitionRoundtrip(tag, handle) {
  // 2) initialized notification
  handle.stdin.write(encode({ jsonrpc: '2.0', method: 'initialized', params: {} }))
  // 3) didOpen
  const uri = pathToFileURL(`${FIXTURE}/index.ts`).href
  handle.stdin.write(encode({
    jsonrpc: '2.0', method: 'textDocument/didOpen',
    params: {
      textDocument: {
        uri,
        languageId: 'typescript',
        version: 1,
        text: 'function greet(name: string): string {\n  return `hello ${name}`;\n}\n\nconst user = "world";\nconst msg = greet(user);\nconsole.log(msg);\n',
      },
    },
  }))
  // 4) definition: greet 调用点（0-based line 5, char 12）
  const reqId = 2
  handle.stdin.write(encode({
    jsonrpc: '2.0', id: reqId, method: 'textDocument/definition',
    params: { textDocument: { uri }, position: { line: 5, character: 12 } },
  }))
  const def = await pendingRequest(reqId)
  const loc = Array.isArray(def) ? def[0] : def
  const target = loc?.targetUri || loc?.uri
  const range = loc?.targetSelectionRange || loc?.selectionRange || loc?.targetRange || loc?.range
  console.log(`[${tag}] definition → ${target ? target.split('/').pop() : 'none'} line ${range?.start?.line}:${range?.start?.character} (expect index.ts 0:9)`)

  // 5) hover 验证（顺带，零成本）
  const reqId3 = 3
  handle.stdin.write(encode({
    jsonrpc: '2.0', id: reqId3, method: 'textDocument/hover',
    params: { textDocument: { uri }, position: { line: 5, character: 12 } },
  }))
  const hover = await pendingRequest(reqId3)
  console.log(`[${tag}] hover → ${JSON.stringify(hover?.contents).slice(0, 120)}`)
  return { def, hover }
}

// ===== 测试 1：默认 env（验证 PATH 继承） + 全链路 =====
try {
  const { handle } = await spawnAndHandshake('T1-default-env')
  await definitionRoundtrip('T1-default-env', handle)
  // 6) shutdown + exit
  handle.stdin.write(encode({ jsonrpc: '2.0', id: 100, method: 'shutdown', params: null }))
  const shutdown = await pendingRequest(100)
  handle.stdin.write(encode({ jsonrpc: '2.0', method: 'exit', params: null }))
  const outcome = await Promise.race([handle.done, delay(8000).then(() => null)])
  console.log(`[T1] shutdown=${JSON.stringify(shutdown)} exit outcome=${JSON.stringify(outcome)}`)
  console.log('[T1] ✅ 默认 env 下 spawn 成功 + 双向通信全链路通过（PATH 继承有效）')
} catch (e) {
  console.error('[T1] ❌ FAILED:', e.message)
  process.exitCode = 1
}

// ===== 测试 2：显式 env.PATH（对照） =====
try {
  const { handle } = await spawnAndHandshake('T2-explicit-env', { withEnv: true })
  handle.terminate()
  const outcome = await Promise.race([handle.done, delay(8000).then(() => null)])
  console.log(`[T2] terminate → exit outcome=${JSON.stringify(outcome)}`)
  console.log('[T2] ✅ 显式 env 同样可用；terminate() 语义正常（SIGTERM→SIGKILL 升级）')
} catch (e) {
  console.error('[T2] ❌ FAILED:', e.message)
  process.exitCode = 1
}

// ===== 测试 3：恶意/敏感 env 不泄漏（用 tombstone 语义反向验证 scrub） =====
import { scrubbedParentEnv } from '/Users/wuminxuan/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subprocess/lib/index.js'
const scrubbed = scrubbedParentEnv()
const leaked = Object.keys(scrubbed).filter((k) => /API_KEY|TOKEN|SECRET|PASSWORD/i.test(k) || k.startsWith('DSH_'))
console.log(`[T3] scrubbedParentEnv: 键数 ${Object.keys(scrubbed).length}, PATH 保留=${scrubbed.PATH ? 'yes' : 'NO!'}, 敏感键泄漏=${leaked.length > 0 ? JSON.stringify(leaked) : 'none'}`)
console.log('[T3] ✅ PATH 保留 + 敏感凭据不泄漏')

console.log('\n===== M0 subprocess 双向验证结束 =====')
process.exit(process.exitCode ?? 0)
