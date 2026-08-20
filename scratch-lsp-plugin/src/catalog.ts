/**
 * 语言目录（catalog）：内置语言 → 语言服务器映射表（M2：全量）。
 * 对齐 lsp-plugin-design.md v2 §2：每语言条目含 server 定义、rootMarkers、优先级；
 * heavy（重服务器）/experimental（实验性）标注用于 UI 与 idle 回收策略。
 * v2 新增：readyTimeoutMs（就绪等待独立预算，不计入工具超时）。
 */
import { dirname } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'

export interface ServerDefinition {
  command: string
  args?: string[]
  versionArgs?: string[]
  fileTypes: string[]
  languageId?: string
  /** 按扩展名覆盖 languageId（如 .js → javascript） */
  fileLanguageIds?: Record<string, string>
  rootMarkers: string[]
  isLinter?: boolean
}

export interface LanguageEntry {
  id: string
  displayName: string
  group: string
  server: ServerDefinition
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  heavy?: boolean
  experimental?: boolean
  /** 就绪等待预算（ms），默认 60000；重语言默认 120000（v2 定稿） */
  readyTimeoutMs?: number
  /** 安装引导（M4）：命令模板（用户级目录安装，非系统级）+ 可选说明；command 与 note 至少其一 */
  install?: {
    command?: string
    args?: string[]
    /** 无自动安装命令时的引导说明（如"需 Xcode/手动安装"） */
    note?: string
  }
}

export const CATALOG: LanguageEntry[] = [
  // ---- 前端 ----
  {
    id: 'typescript',
    displayName: 'TypeScript/JavaScript',
    group: '前端',
    server: {
      command: 'typescript-language-server',
      args: ['--stdio'],
      versionArgs: ['--version'],
      fileTypes: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
      languageId: 'typescript',
      fileLanguageIds: { '.js': 'javascript', '.jsx': 'javascriptreact', '.tsx': 'typescriptreact', '.mjs': 'javascript', '.cjs': 'javascript' },
      rootMarkers: ['package.json', 'tsconfig.json'],
    },
    priority: 'P0',
    install: {
      command: 'npm',
      args: ['install', '-g', 'typescript-language-server'],
    },
  },
  {
    id: 'vue',
    displayName: 'Vue',
    group: '前端',
    server: {
      command: '@vue/language-server',
      args: ['--stdio'],
      versionArgs: ['--version'],
      fileTypes: ['.vue'],
      languageId: 'vue',
      rootMarkers: ['package.json', 'vue.config.js', 'vite.config.ts', 'vite.config.js'],
    },
    priority: 'P1',
    install: {
      command: 'npm',
      args: ['install', '-g', '@vue/language-server'],
    },
  },
  {
    id: 'html',
    displayName: 'HTML',
    group: '前端',
    server: {
      command: 'vscode-html-language-server',
      args: ['--stdio'],
      versionArgs: ['--version'],
      fileTypes: ['.html', '.htm', '.xhtml'],
      languageId: 'html',
      rootMarkers: ['package.json', 'index.html'],
    },
    priority: 'P2',
    install: {
      command: 'npm',
      args: ['install', '-g', 'vscode-html-language-server'],
    },
  },
  {
    id: 'css',
    displayName: 'CSS/SCSS',
    group: '前端',
    server: {
      command: 'vscode-css-language-server',
      args: ['--stdio'],
      versionArgs: ['--version'],
      fileTypes: ['.css', '.scss', '.sass', '.less'],
      languageId: 'css',
      rootMarkers: ['package.json', '.vscode', 'vite.config.ts', 'vite.config.js'],
    },
    priority: 'P2',
    install: {
      command: 'npm',
      args: ['install', '-g', 'vscode-css-language-server'],
    },
  },
  // ---- 后端 ----
  {
    id: 'python',
    displayName: 'Python',
    group: '后端',
    server: {
      command: 'pyright-langserver',
      args: ['--stdio'],
      versionArgs: ['--version'],
      fileTypes: ['.py', '.pyi'],
      languageId: 'python',
      rootMarkers: ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile'],
    },
    priority: 'P0',
    install: {
      command: 'npm',
      args: ['install', '-g', 'pyright'],
    },
  },
  {
    id: 'go',
    displayName: 'Go',
    group: '后端',
    server: {
      command: 'gopls',
      args: ['serve'],
      versionArgs: ['version'],
      fileTypes: ['.go'],
      languageId: 'go',
      rootMarkers: ['go.mod', 'go.work'],
    },
    priority: 'P1',
    install: {
      command: 'go',
      args: ['install', 'golang.org/x/tools/gopls@latest'],
    },
  },
  {
    id: 'rust',
    displayName: 'Rust',
    group: '后端',
    server: {
      command: 'rust-analyzer',
      args: [],
      versionArgs: ['--version'],
      fileTypes: ['.rs'],
      languageId: 'rust',
      rootMarkers: ['Cargo.toml'],
    },
    priority: 'P1',
    install: {
      command: 'rustup',
      args: ['component', 'add', 'rust-analyzer'],
    },
    heavy: true,
    readyTimeoutMs: 120000,
  },
  {
    id: 'java',
    displayName: 'Java',
    group: '后端',
    server: {
      command: 'jdtls',
      args: [],
      fileTypes: ['.java'],
      languageId: 'java',
      rootMarkers: ['pom.xml', 'build.gradle', 'settings.gradle', 'gradlew'],
    },
    priority: 'P2',
    install: {
      note: '需 Eclipse JDTLS：brew install jdtls 或从 IDE 下载（重，需 JVM）',
    },
    heavy: true,
    readyTimeoutMs: 120000,
  },
  {
    id: 'csharp',
    displayName: 'C#',
    group: '后端',
    server: {
      command: 'csharp-ls',
      args: [],
      fileTypes: ['.cs', '.csx'],
      languageId: 'csharp',
      rootMarkers: ['*.csproj', '*.sln'],
    },
    priority: 'P2',
    install: {
      note: '需 .NET SDK；csharp-ls 按官方指引手动安装（重）',
    },
    heavy: true,
    readyTimeoutMs: 120000,
  },
  {
    id: 'php',
    displayName: 'PHP',
    group: '后端',
    server: {
      command: 'intelephense',
      args: ['--stdio'],
      versionArgs: ['--version'],
      fileTypes: ['.php'],
      languageId: 'php',
      rootMarkers: ['composer.json'],
    },
    priority: 'P2',
    install: {
      command: 'npm',
      args: ['install', '-g', 'intelephense'],
    },
  },
  {
    id: 'ruby',
    displayName: 'Ruby',
    group: '后端',
    server: {
      command: 'ruby-lsp',
      args: ['--stdio'],
      versionArgs: ['--version'],
      fileTypes: ['.rb'],
      languageId: 'ruby',
      rootMarkers: ['Gemfile', '.ruby-version'],
    },
    priority: 'P2',
    install: {
      command: 'gem',
      args: ['install', 'ruby-lsp'],
    },
  },
  {
    id: 'cpp',
    displayName: 'C/C++',
    group: '后端',
    server: {
      command: 'clangd',
      args: ['--background-index'],
      versionArgs: ['--version'],
      fileTypes: ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hxx'],
      languageId: 'cpp',
      fileLanguageIds: { '.c': 'c' },
      rootMarkers: ['CMakeLists.txt', 'compile_commands.json', '.clangd'],
    },
    priority: 'P2',
    install: {
      note: 'clangd 随 LLVM：brew install llvm（或安装 Xcode CommandLineTools）',
    },
  },
  // ---- Android ----
  {
    id: 'kotlin',
    displayName: 'Kotlin',
    group: 'Android',
    server: {
      command: 'kotlin-language-server',
      args: [],
      fileTypes: ['.kt', '.kts'],
      languageId: 'kotlin',
      rootMarkers: ['build.gradle.kts', 'settings.gradle.kts'],
    },
    priority: 'P2',
    install: {
      command: 'npm',
      args: ['install', '-g', 'kotlin-language-server'],
    },
  },
  // ---- iOS ----
  {
    id: 'swift',
    displayName: 'Swift',
    group: 'iOS',
    server: {
      command: 'sourcekit-lsp',
      args: [],
      versionArgs: ['--version'],
      fileTypes: ['.swift'],
      languageId: 'swift',
      rootMarkers: ['Package.swift', 'Podfile', '.xcodeproj'],
    },
    priority: 'P1',
    install: {
      note: '随 Xcode / CommandLineTools 提供（仅 macOS）',
    },
    heavy: true,
    readyTimeoutMs: 120000,
  },
  // ---- 数据 ----
  {
    id: 'sql',
    displayName: 'SQL',
    group: '数据',
    server: {
      command: 'sqls',
      args: [],
      fileTypes: ['.sql'],
      languageId: 'sql',
      rootMarkers: ['sqls.yml', '.sqls', '*.sql'],
    },
    priority: 'P3',
    install: {
      command: 'go',
      args: ['install', 'github.com/sqls-server/sqls@latest'],
      note: '实验性，语义较浅',
    },
    experimental: true,
  },
  {
    id: 'r',
    displayName: 'R',
    group: '数据',
    server: {
      command: 'languageserver',
      args: [],
      fileTypes: ['.r', '.R'],
      languageId: 'r',
      rootMarkers: ['DESCRIPTION', '*.Rproj'],
    },
    priority: 'P3',
    install: {
      note: '在 R 中执行 install.packages("languageserver")',
    },
    experimental: true,
  },
]

/** 按文件扩展名找语言条目；找不到返回 undefined。 */
export function entryForFile(file: string): LanguageEntry | undefined {
  const lower = file.toLowerCase()
  return CATALOG.find((entry) =>
    entry.server.fileTypes.some((ext) => lower.endsWith(ext.toLowerCase())),
  )
}

/** 取某文件在条目下的 LSP languageId（按扩展名覆盖，否则条目默认）。 */
export function languageIdForFile(file: string, entry: LanguageEntry): string {
  const lower = file.toLowerCase()
  for (const [ext, lang] of Object.entries(entry.server.fileLanguageIds ?? {})) {
    if (lower.endsWith(ext.toLowerCase())) return lang
  }
  return entry.server.languageId ?? 'plaintext'
}

function dirHasGlobMatch(dir: string, marker: string): boolean {
  const suffix = marker.slice(1).toLowerCase()
  try {
    return readdirSync(dir).some((name) => name.toLowerCase().endsWith(suffix))
  } catch {
    return false
  }
}

/** 从 file 所在目录向上逐级查找第一个含 rootMarkers 的目录（projectRoot，v2 语义）。 */
export function findProjectRoot(file: string, entry: LanguageEntry): string | undefined {
  let dir = dirname(file)
  for (;;) {
    const hit = entry.server.rootMarkers.some((marker) => {
      // 支持通配符根标记（如 *.csproj / *.sql / *.Rproj）：目录内存在匹配文件即命中
      if (marker.includes('*')) return dirHasGlobMatch(dir, marker)
      return existsSync(`${dir}/${marker}`)
    })
    if (hit) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}
