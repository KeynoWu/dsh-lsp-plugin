/**
 * 工具注册（M2：只读四件套 lsp_definition / lsp_hover / lsp_references / lsp_diagnostics）。
 * 对齐 lsp-plugin-design.md v2 §4：
 * - 参数 { file, line?, symbol?, timeout? }；file 绝对或相对会话工作区路径
 * - projectRoot 向上查 rootMarkers（v2 语义）；symbol 行内解析列（支持 name#N）
 * - 输出为明确文本；服务器不可用/缺失/待命 → 明确错误文本，不抛裸异常
 * - 就绪等待走 client 的 readyTimeoutMs 独立预算（不计入工具超时，v2 定稿）
 */
import { isAbsolute, resolve, basename } from 'node:path'
import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { entryForFile, findProjectRoot, languageIdForFile, type LanguageEntry } from './catalog.ts'
import { detectServer } from './detect.ts'
import type { LspPool, LspClient } from './client.ts'

export interface LspPluginConfig {
  enabled: Record<string, boolean>
  idleTimeoutMs: number
  maxConcurrentServers?: number
}

export interface ExecLike {
  signal: AbortSignal
  agent?: { session?: { header?: { cwd?: string } } }
}

interface SessionContext {
  client: LspClient
  uri: string
  file: string
  source: string
  line0: number
  column0: number
  timeoutMs: number
  entry: LanguageEntry
  symbol?: string
}

/** 在行文本中解析 symbol 的列（0-based）。支持 name#N 出现次数选择器。 */
function resolveColumn(lineText: string, symbol: string | undefined): number {
  if (!symbol) {
    const m = /\S/.exec(lineText)
    return m ? m.index : 0
  }
  const clean = symbol.replace(/#\d+$/, '')
  const pick = /#(\d+)$/.exec(symbol)
  const occurrence = pick ? Number(pick[1]) : 1
  let index = -1
  let count = 0
  const lower = lineText.toLowerCase()
  const needle = clean.toLowerCase()
  for (;;) {
    index = lower.indexOf(needle, index + 1)
    if (index === -1) break
    count++
    if (count === occurrence) return index
  }
  const m = /\S/.exec(lineText)
  return m ? m.index : 0
}

function fmtLocation(uri: string, line: number, character: number): string {
  const file = decodeURIComponent(uri.replace(/^file:\/\//, ''))
  return `${file}:${line + 1}:${character + 1}`
}

function contextLine(file: string, line: number): string {
  try {
    return (readFileSync(file, 'utf8').split('\n')[line] ?? '').trim()
  } catch {
    return ''
  }
}

/**
 * 共用准备管线：file → 语言匹配 → 白名单 → 二进制 → projectRoot → 池取 client → 就绪 → didOpen。
 * 任一失败抛 Error（消息即面向模型的明确错误文本）。
 */
async function prepare(
  args: { file: string; line?: number; symbol?: string; timeout?: number },
  exec: ExecLike,
  pool: LspPool,
  getConfig: () => LspPluginConfig,
): Promise<SessionContext> {
  const config = getConfig()
  const cwd = exec.agent?.session?.header?.cwd ?? process.cwd()
  const file = isAbsolute(args.file) ? args.file : resolve(cwd, args.file)
  const line0 = Math.max(0, (args.line ?? 1) - 1)

  const entry = entryForFile(file)
  if (!entry) throw new Error(`No LSP server configured for ${basename(file)}`)
  if (!config.enabled[entry.id]) {
    throw new Error(`LSP server for ${entry.id} is not enabled (enable it in settings / cordis config)`)
  }
  const detected = detectServer(entry.server, cwd)
  if (!detected.found) {
    throw new Error(`LSP server for ${entry.id} not found: ${detected.reason ?? 'binary missing'}`)
  }
  const projectRoot = findProjectRoot(file, entry)
  if (!projectRoot) {
    throw new Error(`LSP server for ${entry.id} is on standby: no project root with ${entry.server.rootMarkers.join(' or ')} found above ${file}`)
  }

  const client = pool.get(entry, projectRoot)
  await client.getReady(exec.signal)

  let source: string
  try {
    source = readFileSync(file, 'utf8')
  } catch (e) {
    throw new Error(`Cannot read file ${file}: ${e instanceof Error ? e.message : String(e)}`)
  }
  const uri = 'file://' + file
  client.notify('textDocument/didOpen', {
    textDocument: { uri, languageId: languageIdForFile(file, entry), version: 1, text: source },
  })
  const lineText = source.split('\n')[line0] ?? ''
  const column0 = resolveColumn(lineText, args.symbol)
  const timeoutMs = Math.min(300, Math.max(5, args.timeout ?? 20)) * 1000
  return { client, uri, file, source, line0, column0, timeoutMs, entry, symbol: args.symbol }
}

type LocationLike = {
  targetUri?: string; uri?: string
  targetSelectionRange?: { start?: { line: number; character: number } }
  selectionRange?: { start?: { line: number; character: number } }
  targetRange?: { start?: { line: number; character: number } }
  range?: { start?: { line: number; character: number } }
}

function firstLocation(def: unknown): LocationLike | undefined {
  const items = (Array.isArray(def) ? def : def ? [def] : []) as LocationLike[]
  return items[0]
}

// ==================== lsp_definition ====================

export function createDefinitionTool(ctx: Context, pool: LspPool, getConfig: () => LspPluginConfig) {
  return defineTool({
    name: 'lsp_definition',
    description:
      '查找符号（函数/类/变量）的语义定义位置，基于 LSP 语言服务器而非文本搜索——能穿透别名、重导出与动态分发。' +
      '参数 file 为目标文件（绝对路径或相对工作区），line 为 1-based 行号，symbol 可选（行内符号名，支持 name#N 指定第 N 次出现）。' +
      '返回定义的文件:行:列及上下文行；无定义时返回 No definition found。',
    parameters: {
      file: { type: 'string', required: true, description: '目标文件路径（绝对，或相对会话工作区）' },
      line: { type: 'number', required: true, description: '符号所在行号（1-based）' },
      symbol: { type: 'string', description: '行内符号名；省略时取首个非空白列（支持 name#N 出现次数选择器）' },
      timeout: { type: 'number', description: '单次请求超时（秒，默认 20，钳制 5..300）' },
    },
    timeoutMs: 20_000,
    output: { schema: { type: 'string' }, render: (_a, v: string) => [{ type: 'text', text: v }] },
    async execute(args, exec: ExecLike) {
      try {
        const s = await prepare(args, exec, pool, getConfig)
        const def = await s.client.request('textDocument/definition', {
          textDocument: { uri: s.uri },
          position: { line: s.line0, character: s.column0 },
        }, s.timeoutMs)
        const loc = firstLocation(def)
        if (!loc) return `No definition found for ${s.symbol ?? 'symbol'} at ${s.file}:${args.line ?? s.line0 + 1}`
        const target = loc.targetUri ?? loc.uri ?? ''
        const range = loc.targetSelectionRange ?? loc.selectionRange ?? loc.targetRange ?? loc.range
        const line = range?.start?.line ?? 0
        const character = range?.start?.character ?? 0
        const head = `Definition of ${s.symbol ?? 'symbol'} at ${s.file}:${args.line ?? s.line0 + 1}:${s.column0 + 1}:`
        const body = contextLine(target.replace(/^file:\/\//, ''), line)
        return [head, `  ${fmtLocation(target, line, character)}`, body ? `    ${body}` : ''].filter(Boolean).join('\n')
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
    },
  })
}

// ==================== lsp_hover ====================

/** 扁平化 MarkupContent / MarkedString / MarkedString[]。 */
function flattenHover(contents: unknown): string {
  if (contents === null || contents === undefined) return ''
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) return contents.map((c) => flattenHover(c)).filter(Boolean).join('\n')
  const obj = contents as { kind?: string; value?: string; language?: string }
  if (obj.kind && typeof obj.value === 'string') return obj.value
  if (obj.language && typeof obj.value === 'string') return `\`\`\`${obj.language}\n${obj.value}\n\`\`\``
  if (typeof obj.value === 'string') return obj.value
  return JSON.stringify(contents)
}

export function createHoverTool(ctx: Context, pool: LspPool, getConfig: () => LspPluginConfig) {
  return defineTool({
    name: 'lsp_hover',
    description:
      '获取符号处的悬停信息（类型签名/文档注释），基于 LSP 语言服务器。' +
      '参数 file 为目标文件，line 为 1-based 行号，symbol 可选。返回悬停文本或 No hover information。',
    parameters: {
      file: { type: 'string', required: true, description: '目标文件路径（绝对，或相对会话工作区）' },
      line: { type: 'number', required: true, description: '符号所在行号（1-based）' },
      symbol: { type: 'string', description: '行内符号名；省略时取首个非空白列' },
      timeout: { type: 'number', description: '单次请求超时（秒，默认 20，钳制 5..300）' },
    },
    timeoutMs: 20_000,
    output: { schema: { type: 'string' }, render: (_a, v: string) => [{ type: 'text', text: v }] },
    async execute(args, exec: ExecLike) {
      try {
        const s = await prepare(args, exec, pool, getConfig)
        const hover = await s.client.request('textDocument/hover', {
          textDocument: { uri: s.uri },
          position: { line: s.line0, character: s.column0 },
        }, s.timeoutMs)
        const text = flattenHover((hover as { contents?: unknown })?.contents)
        if (!text) return `No hover information for ${s.symbol ?? 'symbol'} at ${s.file}:${args.line ?? s.line0 + 1}`
        return `Hover for ${s.symbol ?? 'symbol'} at ${s.file}:${args.line ?? s.line0 + 1}:\n${text}`
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
    },
  })
}

// ==================== lsp_references ====================

export function createReferencesTool(ctx: Context, pool: LspPool, getConfig: () => LspPluginConfig) {
  return defineTool({
    name: 'lsp_references',
    description:
      '查找符号的所有引用位置（含声明，includeDeclaration），基于 LSP 语言服务器——语义精确，不含注释/字符串噪音。' +
      '参数 file 为目标文件，line 为 1-based 行号，symbol 可选。返回命中列表（前若干带上下文行，其余仅位置）。',
    parameters: {
      file: { type: 'string', required: true, description: '目标文件路径（绝对，或相对会话工作区）' },
      line: { type: 'number', required: true, description: '符号所在行号（1-based）' },
      symbol: { type: 'string', description: '行内符号名；省略时取首个非空白列' },
      timeout: { type: 'number', description: '单次请求超时（秒，默认 20，钳制 5..300）' },
    },
    timeoutMs: 20_000,
    output: { schema: { type: 'string' }, render: (_a, v: string) => [{ type: 'text', text: v }] },
    async execute(args, exec: ExecLike) {
      try {
        const s = await prepare(args, exec, pool, getConfig)
        const refs = await s.client.request('textDocument/references', {
          textDocument: { uri: s.uri },
          position: { line: s.line0, character: s.column0 },
          context: { includeDeclaration: true },
        }, s.timeoutMs)
        const items = (Array.isArray(refs) ? refs : []) as Array<{ uri?: string; range?: { start?: { line: number; character: number } } }>
        if (items.length === 0) return `No references found for ${s.symbol ?? 'symbol'} at ${s.file}:${args.line ?? s.line0 + 1}`
        const lines = [`References of ${s.symbol ?? 'symbol'} (${items.length}):`]
        items.slice(0, 8).forEach((r, i) => {
          const pos = fmtLocation(r.uri ?? '', r.range?.start?.line ?? 0, r.range?.start?.character ?? 0)
          const body = contextLine((r.uri ?? '').replace(/^file:\/\//, ''), r.range?.start?.line ?? 0)
          lines.push(`  ${i + 1}. ${pos}${body ? `  ${body}` : ''}`)
        })
        if (items.length > 8) lines.push(`  … ${items.length - 8} more`)
        return lines.join('\n')
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
    },
  })
}

// ==================== lsp_diagnostics ====================

const SEVERITY: Record<number, string> = { 1: 'Error', 2: 'Warning', 3: 'Information', 4: 'Hint' }

export function createDiagnosticsTool(ctx: Context, pool: LspPool, getConfig: () => LspPluginConfig) {
  return defineTool({
    name: 'lsp_diagnostics',
    description:
      '获取文件的语言级诊断（类型错误/语法错误/警告），基于 LSP 语言服务器增量分析——比跑编译器快且精确到行。' +
      '参数 file 为目标文件。返回按 severity 排序的错误列表（<file>:<line>:<col> <severity>: <message>）；无问题返回 OK。',
    parameters: {
      file: { type: 'string', required: true, description: '目标文件路径（绝对，或相对会话工作区）' },
      timeout: { type: 'number', description: '诊断等待超时（秒，默认 20，钳制 5..300）' },
    },
    timeoutMs: 20_000,
    output: { schema: { type: 'string' }, render: (_a, v: string) => [{ type: 'text', text: v }] },
    async execute(args, exec: ExecLike) {
      try {
        const config = getConfig()
        const cwd = exec.agent?.session?.header?.cwd ?? process.cwd()
        const file = isAbsolute(args.file) ? args.file : resolve(cwd, args.file)
        const entry = entryForFile(file)
        if (!entry) throw new Error(`No LSP server configured for ${basename(file)}`)
        if (!config.enabled[entry.id]) throw new Error(`LSP server for ${entry.id} is not enabled (enable it in settings / cordis config)`)
        const detected = detectServer(entry.server, cwd)
        if (!detected.found) throw new Error(`LSP server for ${entry.id} not found: ${detected.reason ?? 'binary missing'}`)
        const projectRoot = findProjectRoot(file, entry)
        if (!projectRoot) throw new Error(`LSP server for ${entry.id} is on standby: no project root with ${entry.server.rootMarkers.join(' or ')} found above ${file}`)

        const client = pool.get(entry, projectRoot)
        await client.getReady(exec.signal)
        const source = readFileSync(file, 'utf8')
        const uri = 'file://' + file
        const timeoutMs = Math.min(300, Math.max(5, args.timeout ?? 20)) * 1000

        // didOpen 触发推送诊断；等待缓存更新（客户端监听 publishDiagnostics）
        const version = client.openDocument(uri, languageIdForFile(file, entry), source)
        const diags = await client.waitForDiagnostics(uri, version, timeoutMs)
        if (diags.length === 0) return `OK: no diagnostics for ${file}`
        const rows = diags
          .slice()
          .sort((a, b) => (a.severity ?? 5) - (b.severity ?? 5))
          .map((d) => {
            const sev = SEVERITY[d.severity ?? 0] ?? 'Diagnostic'
            const pos = fmtLocation(uri, d.range.start.line, d.range.start.character)
            return `${pos} ${sev}: ${d.message}`
          })
        return rows.join('\n')
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
    },
  })
}

// ==================== lsp_rename（M4 写操作） ====================

interface TextEditLike {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  newText: string
}

/** 按行/列把 edits 应用到文本（从后往前，避免偏移错乱）。 */
export function applyTextEdits(text: string, edits: TextEditLike[]): string {
  if (edits.length === 0) return text
  const lines = text.split('\n')
  const lineStarts: number[] = [0]
  for (let i = 0; i < lines.length; i++) lineStarts.push(lineStarts[i]! + lines[i]!.length + 1)
  const toOffset = (p: { line: number; character: number }) => lineStarts[p.line]! + p.character
  const sorted = [...edits].sort((a, b) => toOffset(b.range.start) - toOffset(a.range.start))
  let out = text
  for (const e of sorted) {
    const start = toOffset(e.range.start)
    const end = toOffset(e.range.end)
    out = out.slice(0, start) + e.newText + out.slice(end)
  }
  return out
}

/** 应用 WorkspaceEdit（changes 与 documentChanges 的文本 edit 部分）。返回每个被改文件的 uri → 新内容。 */
export function collectWorkspaceEdits(
  edit: unknown,
): { uri: string; edits: TextEditLike[] }[] {
  const out: { uri: string; edits: TextEditLike[] }[] = []
  const ws = edit as { changes?: Record<string, TextEditLike[]>; documentChanges?: Array<{ textDocument?: { uri: string }; edits?: TextEditLike[] }> }
  if (ws.changes) {
    for (const [uri, edits] of Object.entries(ws.changes)) out.push({ uri, edits })
  }
  if (ws.documentChanges) {
    for (const dc of ws.documentChanges) {
      if (dc.textDocument?.uri && dc.edits) out.push({ uri: dc.textDocument.uri, edits: dc.edits })
    }
  }
  return out
}

export function createRenameTool(ctx: Context, pool: LspPool, getConfig: () => LspPluginConfig) {
  return defineTool({
    name: 'lsp_rename',
    description:
      '重命名符号并应用跨文件 WorkspaceEdit（LSP 语义重命名，含引用同步）。写操作：修改文件，需用户确认。' +
      '参数 file 为目标文件，line 为 1-based 行号，newName 为新名称。返回修改的文件与编辑数。',
    parameters: {
      file: { type: 'string', required: true, description: '目标文件路径（绝对，或相对会话工作区）' },
      line: { type: 'number', required: true, description: '符号所在行号（1-based）' },
      symbol: { type: 'string', description: '行内符号名；省略时取首个非空白列' },
      newName: { type: 'string', required: true, description: '新名称' },
      timeout: { type: 'number', description: '单次请求超时（秒，默认 20，钳制 5..300）' },
    },
    timeoutMs: 30_000,
    output: { schema: { type: 'string' }, render: (_a, v: string) => [{ type: 'text', text: v }] },
    async execute(args, exec: ExecLike) {
      try {
        const s = await prepare(args, exec, pool, getConfig)
        const result = await s.client.request('textDocument/rename', {
          textDocument: { uri: s.uri },
          position: { line: s.line0, character: s.column0 },
          newName: args.newName,
        }, s.timeoutMs)
        if (result === null || result === undefined) {
          return `Rename returned no edits for ${args.symbol ?? 'symbol'} at ${s.file}:${args.line ?? s.line0 + 1}`
        }
        const changes = collectWorkspaceEdits(result)
        if (changes.length === 0) return 'Rename produced no file changes'

        // 通过 ctx.fs seam 写文件（沙箱感知 + fs/write-intent 审批钩子）
        const fs = (ctx as Context & { fs?: {
          resolve(path: string, opts?: { signal?: AbortSignal }): Promise<{ displayPath: string }>
          readText(target: { displayPath: string }, signal?: AbortSignal): Promise<string>
          writeText(target: { displayPath: string }, content: string, intent?: unknown, signal?: AbortSignal, sandboxPolicy?: unknown): Promise<unknown>
          sandboxMode?: string
        } }).fs
        if (!fs) return 'Rename requires the filesystem seam (ctx.fs), unavailable'
        const sandboxPolicy = ctx.get?.('sandboxPolicy') as unknown | undefined

        const summary: string[] = []
        for (const { uri, edits } of changes) {
          const path = decodeURIComponent(uri.replace(/^file:\/\//, ''))
          const target = await fs.resolve(path, { signal: exec.signal })
          const before = await fs.readText(target, exec.signal)
          const after = applyTextEdits(before, edits)
          if (after === before) continue
          await fs.writeText(target, after, undefined, exec.signal, sandboxPolicy)
          const editCount = edits.length
          summary.push(`  ${target.displayPath} (${editCount} edit${editCount > 1 ? 's' : ''})`)
        }
        if (summary.length === 0) return 'Rename produced no text changes (name unchanged?)'
        return `Renamed ${args.symbol ?? 'symbol'} → ${args.newName}:\n${summary.join('\n')}`
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
    },
  })
}
