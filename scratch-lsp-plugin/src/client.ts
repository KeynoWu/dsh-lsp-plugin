/**
 * LSP 客户端与进程池（M2）：
 * - LspClient：一个语言服务器进程的双向 JSON-RPC 客户端（spawn → initialize → initialized → 就绪）
 *   + 文档状态（didOpen 版本）、诊断缓存（publishDiagnostics 监听 + pull fallback）
 *   + 崩溃重试（请求时发现进程退出 → 自动重启一次，上限 1）
 * - LspPool：按 `command:projectRoot` 缓存 client（v2 定稿池键），懒启动，idle 回收（in-flight 跳过）
 * 生命周期：池内全部进程随插件卸载经 ctx.effect 终止；subprocess 服务销毁兜底。
 */
import { pathToFileURL } from 'node:url'
import type { LanguageEntry } from './catalog.ts'
import { encodeFrame, createFrameParser, type RpcMessage } from './jsonrpc.ts'

/** 最小 subprocess 句柄类型（来自 ctx.subprocess.spawn） */
export interface SubprocessLike {
  pid: number
  stdin?: { write(data: Buffer | string): boolean; end(): void }
  stdout?: { on(event: 'data', cb: (chunk: Buffer) => void): void }
  terminate(): void
  done: Promise<unknown>
}

export interface LspCtx {
  subprocess: {
    spawn(spec: {
      argv: readonly string[]
      cwd: string
      stdio: {
        stdin: 'pipe' | 'ignore' | { data: string }
        stdout: 'pipe' | 'inherit' | { maxBytes: number }
        stderr: 'pipe' | 'inherit' | { maxBytes: number }
      }
      graceMs: number
      signal?: AbortSignal
    }): SubprocessLike
  }
}

export interface Diagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  severity?: number
  source?: string
  message: string
}

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000
const DEFAULT_READY_TIMEOUT_MS = 60_000

export class LspClient {
  readonly key: string
  private readonly entry: LanguageEntry
  private readonly projectRoot: string
  private readonly ctx: LspCtx
  private handle: SubprocessLike | undefined
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  private notificationHandlers = new Map<string, (params: unknown) => void>()
  private readyPromise: Promise<void> | undefined
  private restarted = false
  /** 文档状态：uri → { version, languageId }（didOpen 跟踪） */
  private documents = new Map<string, { version: number; languageId: string }>()
  /** 诊断缓存：uri → { version, diagnostics }（publishDiagnostics 推送更新） */
  private diagnostics = new Map<string, { version: number; diagnostics: Diagnostic[] }>()
  private diagWaiters = new Set<{ uri: string; version: number; resolve: () => void; timer: NodeJS.Timeout }>()
  ready = false
  capabilities: Record<string, unknown> = {}
  /** 最近活动时间戳（request/notify 更新），idle 回收依据 */
  lastActivity = Date.now()
  /** in-flight 请求计数（idle 回收跳过） */
  inflight = 0
  /** done 是否已 settle（进程结束），崩溃检测依据 */
  handleDoneSettled = false

  constructor(entry: LanguageEntry, projectRoot: string, ctx: LspCtx) {
    this.entry = entry
    this.projectRoot = projectRoot
    this.ctx = ctx
    this.key = `${entry.server.command}:${projectRoot}`
  }

  /** 懒启动 + 握手；重复调用返回同一 ready Promise。 */
  getReady(signal?: AbortSignal): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.handshake(signal)
    }
    return this.readyPromise
  }

  private async handshake(signal?: AbortSignal): Promise<void> {
    const spec = this.entry.server
    const args = spec.args ?? []
    const handle = this.ctx.subprocess.spawn({
      argv: [spec.command, ...args],
      cwd: this.projectRoot,
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: 3000,
      signal,
    })
    this.handle = handle
    this.handleDoneSettled = false
    void handle.done.finally(() => {
      this.handleDoneSettled = true
    })
    if (!handle.stdin || !handle.stdout) throw new Error(`LSP server ${spec.command} did not expose stdio pipes`)

    const feed = createFrameParser((msg: RpcMessage) => this.dispatch(msg))
    handle.stdout.on('data', feed)

    const readyMs = this.entry.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
    const result = await this.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(this.projectRoot).href,
      capabilities: {
        textDocument: {
          definition: { linkSupport: true },
          references: {},
          hover: {},
          synchronization: { didSave: true },
          // 关键：声明客户端支持 publishDiagnostics 推送，tls 据此决定是否推诊断
          publishDiagnostics: { relatedInformation: true },
        },
      },
      workspaceFolders: [{ uri: pathToFileURL(this.projectRoot).href, name: 'workspace' }],
    }, readyMs)
    this.capabilities = (result as { capabilities?: Record<string, unknown> })?.capabilities ?? {}
    this.notify('initialized', {})
    this.ready = true
  }

  private dispatch(msg: RpcMessage) {
    if (msg.id !== undefined && this.pending.has(msg.id as number)) {
      const p = this.pending.get(msg.id as number)!
      this.pending.delete(msg.id as number)
      clearTimeout(p.timer)
      if (msg.error) p.reject(new Error(`LSP error ${msg.error.code}: ${msg.error.message}`))
      else p.resolve(msg.result)
      return
    }
    if (msg.method === 'textDocument/publishDiagnostics') {
      this.handlePublishDiagnostics(msg.params)
      return
    }
    if (msg.method) {
      const handler = this.notificationHandlers.get(msg.method)
      if (handler) handler(msg.params)
    }
  }

  private handlePublishDiagnostics(params: unknown) {
    const p = params as { uri?: string; diagnostics?: Diagnostic[] }
    if (!p.uri) return
    const doc = this.documents.get(p.uri)
    const version = doc?.version ?? 0
    this.diagnostics.set(p.uri, { version, diagnostics: p.diagnostics ?? [] })
    // 唤醒匹配的等待者：进入稳定窗口（窗口结束读最终缓存，见 waitForDiagnostics）
    for (const waiter of [...this.diagWaiters]) {
      if (waiter.uri === p.uri && waiter.version === version) {
        waiter.resolve()
      }
    }
  }

  request(method: string, params: unknown, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<unknown> {
    this.lastActivity = Date.now()
    this.inflight++
    let settled = false
    const settle = () => {
      if (!settled) {
        settled = true
        this.inflight--
      }
    }
    if (!this.handle?.stdin) {
      settle()
      return Promise.reject(new Error('LSP client not started'))
    }
    const id = this.nextId++
    const body = encodeFrame({ jsonrpc: '2.0', id, method, params })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        settle()
        reject(new Error(`LSP request ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => { settle(); resolve(v) },
        reject: (e) => { settle(); reject(e) },
        timer,
      })
      this.handle!.stdin!.write(body)
    })
  }

  notify(method: string, params: unknown): void {
    this.lastActivity = Date.now()
    if (!this.handle?.stdin) throw new Error('LSP client not started')
    this.handle.stdin.write(encodeFrame({ jsonrpc: '2.0', method, params }))
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    this.notificationHandlers.set(method, handler)
  }

  /** didOpen 一个文档，返回版本号；旧诊断缓存清除，等待新推送。 */
  openDocument(uri: string, languageId: string, text: string): number {
    const prev = this.documents.get(uri)
    const version = (prev?.version ?? 0) + 1
    this.documents.set(uri, { version, languageId })
    this.diagnostics.delete(uri)
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId, version, text },
    })
    return version
  }

  /**
   * 等待某文档的最新诊断（v2 §9 风险 6：防"旧"结果）：
   * - 服务器支持 pull（diagnosticProvider）→ 发 textDocument/diagnostic
   * - 否则等 push（publishDiagnostics）：
   *   收到首个 push 后进入 800ms 稳定窗口（语法诊断先到、语义诊断随后），
   *   窗口内新 push 覆盖缓存，窗口结束返回最终缓存；总超时兜底。
   */
  waitForDiagnostics(uri: string, version: number, timeoutMs: number): Promise<Diagnostic[]> {
    const pull = this.capabilities.diagnosticProvider
    if (pull) {
      return this.request('textDocument/diagnostic', {
        textDocument: { uri },
      }, timeoutMs).then((res) => {
        const items = (res as { items?: Diagnostic[] })?.items ?? []
        this.diagnostics.set(uri, { version, diagnostics: items })
        return items
      }) as Promise<Diagnostic[]>
    }
    return new Promise((resolve) => {
      const cached = this.diagnostics.get(uri)
      if (cached && cached.version === version) {
        resolve(cached.diagnostics)
        return
      }
      const STABLE_MS = 2000
      let settled = false
      let windowTimer: NodeJS.Timeout | undefined
      let guardTimer: NodeJS.Timeout | undefined

      const finish = () => {
        if (settled) return
        settled = true
        if (windowTimer) clearTimeout(windowTimer)
        if (guardTimer) clearTimeout(guardTimer)
        const cur = this.diagnostics.get(uri)
        resolve(cur && cur.version === version ? cur.diagnostics : [])
      }

      const waiter = {
        uri, version,
        resolve: () => {
          // 首个匹配 push：启动稳定窗口（等语义诊断追上来）
          if (!settled) {
            if (windowTimer) clearTimeout(windowTimer)
            windowTimer = setTimeout(finish, STABLE_MS)
          }
        },
        timer: undefined as unknown as NodeJS.Timeout,
      }
      // 守卫超时：无任何 push 时兜底
      guardTimer = setTimeout(() => {
        this.diagWaiters.delete(waiter)
        finish()
      }, timeoutMs)
      waiter.timer = guardTimer
      this.diagWaiters.add(waiter)
    })
  }

  getCachedDiagnostics(uri: string): Diagnostic[] {
    return this.diagnostics.get(uri)?.diagnostics ?? []
  }

  /** 崩溃恢复：进程已退出（非主动终止）时自动重启一次（上限 1）。 */
  async recover(): Promise<void> {
    if (this.restarted) throw new Error(`LSP server ${this.entry.server.command} crashed repeatedly; marked as failed`)
    this.restarted = true
    this.ready = false
    this.handle?.terminate()
    this.handle = undefined
    this.readyPromise = undefined
    await this.getReady()
  }

  /** 优雅退出；超时后强杀。 */
  async shutdownAndExit(): Promise<void> {
    if (!this.handle) return
    try {
      await this.request('shutdown', null, 5000)
      this.notify('exit', null)
      await Promise.race([this.handle.done, new Promise((r) => setTimeout(r, 5000))])
    } catch {
      // ignore：服务器可能已退出
    }
    this.handle.terminate()
    this.handle = undefined
  }

  terminate(): void {
    this.handle?.terminate()
    this.handle = undefined
  }
}

/** 按 command:projectRoot 缓存 client 的池（v2 定稿）。 */
export class LspPool {
  private clients = new Map<string, LspClient>()
  private readonly ctx: LspCtx
  private readonly idleTimer: NodeJS.Timeout
  private idleTimeoutMs: number
  /** 并发服务器上限（M4：多会话/多语言资源防护，超限拒绝新服务器） */
  private maxClients: number

  constructor(ctx: LspCtx, idleTimeoutMs = 300_000, maxClients = 4) {
    this.ctx = ctx
    this.idleTimeoutMs = idleTimeoutMs
    this.maxClients = maxClients
    this.idleTimer = setInterval(() => this.reapIdle(), 30_000)
    this.idleTimer.unref?.()
  }

  set idleTimeout(value: number) {
    this.idleTimeoutMs = value
  }

  set concurrentLimit(value: number) {
    this.maxClients = value
  }

  /** 取 client（懒启动）；无则新建；达到并发上限时拒绝（明确错误，避免无限 spawn）。 */
  get(entry: LanguageEntry, projectRoot: string): LspClient {
    const key = `${entry.server.command}:${projectRoot}`
    let client = this.clients.get(key)
    if (!client) {
      if (this.clients.size >= this.maxClients) {
        throw new Error(
          `LSP server pool is at its concurrent limit (${this.maxClients}); ` +
          `dispose unused languages or raise maxConcurrentServers`,
        )
      }
      client = new LspClient(entry, projectRoot, this.ctx)
      this.clients.set(key, client)
    }
    return client
  }

  /**
   * idle 回收：超过 idleTimeoutMs 无活动且无 in-flight 请求的 client 被终止并移出池。
   * v2 定稿：回收前检查 in-flight，有则跳过本轮，避免高频场景反复冷启。
   */
  private reapIdle(): void {
    const now = Date.now()
    for (const [key, client] of this.clients) {
      if (client.inflight > 0) continue
      if (now - client.lastActivity < this.idleTimeoutMs) continue
      client.terminate()
      this.clients.delete(key)
    }
  }

  /** 池内 client 数（状态查询/测试用）。 */
  get size(): number {
    return this.clients.size
  }

  /** 立即执行一轮 idle 回收（定时器之外的测试/手动触发入口）。 */
  reapNow(): void {
    this.reapIdle()
  }

  /** 释放全部进程（插件卸载时经 ctx.effect 调用）。 */
  async disposeAll(): Promise<void> {
    clearInterval(this.idleTimer)
    const tasks = [...this.clients.values()].map((c) => c.shutdownAndExit())
    await Promise.allSettled(tasks)
    this.clients.clear()
  }
}
