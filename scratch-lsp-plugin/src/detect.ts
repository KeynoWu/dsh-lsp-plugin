/**
 * 二进制检测：本地 bin（node_modules/.bin、venv、Go bin）→ $PATH → 版本读取。
 * 对齐 lsp-plugin-design.md v2 §2：检测适配按平台分支；查找失败 = 缺失。
 */
import { accessSync, existsSync, readFileSync } from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import { dirname, join, resolve, delimiter } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { ServerDefinition } from './catalog.ts'
import { CATALOG } from './catalog.ts'

export interface DetectedServer {
  found: boolean
  /** 二进制绝对路径（找到时） */
  path?: string
  /** 版本字符串（versionArgs 成功时） */
  version?: string
  /** 缺失原因（未找到时） */
  reason?: string
}

/** 常见本地 bin 目录（相对项目根） */
const LOCAL_BIN_DIRS = ['node_modules/.bin', '.venv/bin', 'venv/bin', 'bin', '.gopath/bin']

function isExecutable(file: string): boolean {
  try {
    accessSync(file, fsConstants.X_OK)
    return existsSync(file)
  } catch {
    return false
  }
}

/**
 * 解析 command：
 * 1. 绝对路径 → 直接检查
 * 2. 相对路径/裸命令 → 本地 bin 候选（相对 cwd 探测）→ $PATH 查找
 */
export function resolveCommand(command: string, cwd: string): string | undefined {
  if (command.includes('/') || command.includes('\\')) {
    const abs = resolve(cwd, command)
    return isExecutable(abs) ? abs : undefined
  }
  // 本地 bin 探测
  for (const dir of LOCAL_BIN_DIRS) {
    const candidate = join(cwd, dir, command)
    if (isExecutable(candidate)) return candidate
  }
  // $PATH 查找
  const pathEnv = process.env.PATH ?? ''
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, command)
    if (isExecutable(candidate)) return candidate
  }
  return undefined
}

/** 读版本：优先 versionArgs（如 --version），失败时静默。
 *  stderr 必须 ignore：部分服务器（如 pyright-langserver）不认 --version，
 *  会因 createConnection 缺参把错误打到 stderr——inherit 会把噪音喷到主进程。 */
function readVersion(binary: string, versionArgs?: string[]): string | undefined {
  if (!versionArgs) return undefined
  try {
    const out = execFileSync(binary, versionArgs, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
    return out.trim().split('\n')[0] || undefined
  } catch {
    return undefined
  }
}

/**
 * 检测一个语言服务器是否可用。
 * @param server 服务器定义
 * @param cwd 当前项目目录（本地 bin 探测基准）
 */
export function detectServer(server: ServerDefinition, cwd: string): DetectedServer {
  const binary = resolveCommand(server.command, cwd)
  if (!binary) {
    return { found: false, reason: `${server.command} 未在 PATH 或本地 bin 中找到` }
  }
  return {
    found: true,
    path: binary,
    version: readVersion(binary, server.versionArgs),
  }
}

/** 一次性检测多个服务器（设置页/状态查询用，M3 接线）。 */
export function detectAll(cwd: string): Record<string, DetectedServer> {
  const out: Record<string, DetectedServer> = {}
  for (const entry of CATALOG) out[entry.id] = detectServer(entry.server, cwd)
  return out
}
