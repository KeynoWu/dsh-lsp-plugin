# DSH LSP 插件设计文档

> 状态：设计讨论定稿（v1）→ 审查修订（v2）：按 2026 架构审查补齐平面归属、超时策略、projectRoot 语义与 M0 清单
> 目标：为 DeepSeek Harness（DSH）提供本地 LSP 能力——设置页勾选启用语言，运行时通过工具 seam 暴露诊断/定义/引用/hover 等语义能力，提升 coding 场景准确度。
> 设计参考：oh-my-pi（omp）的 LSP 封装（检测已有二进制、client 池、生命周期、诊断等待），按 DSH 的插件体系与 Node 技术栈重新实现。

---

## 1. 总体形态

**单包双面插件**：一个 npm 包同时承载 host 端（LSP 引擎 + 工具注册 + settings section）与 `./client` 端（Web 设置页），模式参考 `dsh-client-ui-settings-plugins`（host 端空 `apply` + package.json `dsh.client` 声明浏览器端）。

```
用户 Web 设置页（./client 端）
   │  勾选语言 / 查看状态 / 配置 idle 超时
   ▼
settings section（host 端，schemastery schema）
   │
   ▼
LSP 引擎（host 端）
   ├─ catalog：内置语言→服务器映射表（defaults）
   ├─ detect：二进制检测（本地 bin → $PATH → 版本读取）
   ├─ pool：client 池（按 command:projectRoot 缓存，懒启动）
   ├─ lifecycle：握手 / 项目就绪等待 / idle 回收 / 崩溃重试
   └─ tools：defineTool 注册四个只读工具
   │
   ▼
ctx.tools  →  agent（模型）
```

**触发逻辑（已定稿）**：勾选（用户白名单） AND rootMarkers（当前项目匹配） AND 二进制可用 → 才 spawn 服务器。

---

### 1.1 组合与平面归属（v2 修订，审查结论）

**术语澄清**：本文"host 端"指 Node 进程侧（相对浏览器 `./client` 端），与 harness 的"host 组合平面"（跨会话共享）**不是一回事**。同一个包的三个面按职责挂到不同平面：

| 面 | 内容 | 挂载平面 | 理由 |
|---|---|---|---|
| settings section | `lsp` namespace（勾选、idleTimeoutMs） | **host 组合** | 用户勾选是全局偏好、跨会话共享；`installSettingsSection` 注册，同 `dsh-llm-pi-ai` |
| LSP 引擎 + 四工具 | catalog / detect / pool / lifecycle + `defineTool` 注册 | **agent preset（每会话一个实例）** | 工具由会话向注册表贡献（同 `dsh-tool-fs-search`）；引擎直接用**会话工作区**当工作根，client 池天然按会话隔离，多会话互不干扰 |
| client 设置页 | `./client` 入口（`dsh.client.inject` 声明） | 随包浏览器端 | 由 host 组合行触发注入，同 `dsh-client-ui-settings-plugins` |

- **每会话实例**：一个 DSH 进程开 N 个会话 = N 份引擎，进程互不共享；资源成本由 idle 回收兜底。
- **卸载清理**：引擎随会话卸载，`ctx.effect` disposer terminate 全部托管进程；subprocess 服务销毁时也会终止仍运行的托管进程（双保险）。
- **挂载方式**：同一 npm 包在两个组合文件各挂一行——host 组合挂 settings 行，preset 的 agent 组合挂引擎+工具行。

---

## 2. 语言目录（内置全部，默认不启用）

| 岗位 | 语言 | 服务器 | 获取方式 | rootMarkers | 优先级 |
|---|---|---|---|---|---|
| 前端 | TypeScript/JS | `typescript-language-server` | npm 全局 | `package.json`, `tsconfig.json` | P0（最成熟） |
| 前端 | Vue | `@vue/language-server` | npm 全局 | `package.json`（含 vue 依赖） | P1 |
| 前端 | HTML | `vscode-html-language-server` | npm 全局 | `*.html` 存在 | P2 |
| 前端 | CSS/SCSS | `vscode-css-language-server` | npm 全局 | `*.css`/`*.scss` 存在 | P2 |
| 后端 | Python | `pyright` | npm 全局 或 pip | `pyproject.toml`, `requirements.txt`, `setup.py` | P0 |
| 后端 | Go | `gopls` | `go install` | `go.mod`, `go.work` | P1 |
| 后端 | Rust | `rust-analyzer` | `rustup component` | `Cargo.toml` | P1（重） |
| 后端 | Java | `jdtls` | 独立安装 | `pom.xml`, `build.gradle`, `settings.gradle` | P2（重，需 JVM） |
| 后端 | C# | `csharp-ls`（OmniSharp） | 独立安装 | `*.csproj`, `*.sln` | P2（需 .NET） |
| 后端 | PHP | `intelephense` | npm 全局 | `composer.json` | P2 |
| 后端 | Ruby | `ruby-lsp` / `solargraph` | gem | `Gemfile` | P2（生态一般） |
| 后端 | C/C++ | `clangd` | 随 LLVM | `CMakeLists.txt`, `compile_commands.json` | P2 |
| Android | Kotlin | `kotlin-language-server` | npm 全局 | `build.gradle.kts`, `settings.gradle.kts` | P2（生态一般） |
| Android | Java | `jdtls` | 独立安装 | 同 Java | P2（复用） |
| iOS | Swift | `sourcekit-lsp` | 随 Xcode/CLT | `*.xcodeproj`, `Package.swift`, `Podfile` | P1（仅 macOS） |
| 数据 | Python | `pyright` | 同上 | 同 Python | P0（复用） |
| 数据 | SQL | `sqls` | 独立安装 | `*.sql` 存在 | P3（实验性，语义浅） |
| 数据 | R | `languageserver` | R 包 | `DESCRIPTION`, `*.R` 存在 | P3 |

**目录设计要点**：
- 每语言条目：`{ id, displayName, group, server: { command, args?, versionArgs?, fileTypes, languageId?, rootMarkers, isLinter? }, priority }`
- 检测适配：`command` 在本地 bin（`node_modules/.bin`、venv、binstubs、Go bin）→ `$PATH` 查找；`versionArgs` 读取版本用于 UI 展示；查找失败 = 缺失
- 重服务器（jdtls / rust-analyzer / csharp-ls / sourcekit-lsp）在 UI 标注"重"，idle 回收默认更激进
- SQL/R 标注"实验性"，避免拉低整体观感
- 同一服务器可被多个岗位引用（如 pyright 同时在后端/数据）：池按 `command:projectRoot` 键复用，同项目内天然共用一个实例；UI 是否合并显示由 M3 决定

---

## 3. 状态机（每语言）

```
┌──────────┐  用户勾选  ┌──────────────┐
│  未勾选   │ ────────→ │  已勾选       │
│（默认）   │ ←──────── │              │
└──────────┘  取消勾选  └──────┬───────┘
                              │ 二进制检测
                     ┌────────┴────────┐
              ┌──────┴──────┐   ┌──────┴───────┐
              │  可用        │   │  缺失 ⚠      │
              │  项目匹配→启用│   │（二期：安装  │
              │  不匹配→待命  │   │  引导按钮）  │
              └─────────────┘   └──────────────┘
```

- **启用**：spawn 服务器，请求可路由到它
- **待命**：已勾选 + 二进制在，但当前工作区无匹配 rootMarkers 的项目 → 不 spawn；项目切到匹配目录后自动转启用（projectRoot 级缓存）
- **缺失**：已勾选但二进制找不到 → 工具请求返回明确错误提示；UI 显示"缺失"
- 状态按 projectRoot 计算（见 §4.1 `file` 语义），缓存于会话级；一个项目内多个文件共享一个服务器实例

---

## 4. 工具 Schema（MVP 只读四件套）

全部走 `defineTool`，参数 JSON Schema，输出文本块 + 结构化数据。

### 4.1 `lsp_diagnostics`
- 参数：`{ file: string, timeout?: number }`（`file` 支持 glob，二期）
- **`file` 语义（v2 修订）**：绝对路径，或相对会话工作区的路径（引擎解析为绝对路径）；projectRoot = 从 file 所在目录**向上**逐级查找第一个含 rootMarkers 的目录，找不到 → 该语言"待命"（复用 §3 状态机）
- 行为：按文件找服务器（池键 `command:projectRoot`）→ 等待项目就绪（`readyTimeoutMs` 预算，见共同约定）→ 发送 `textDocument/diagnostic` 或读取缓存的 `publishDiagnostics`（缓存键含 source，区分多服务器）→ 按 severity 排序去重
- 输出：`OK` 或 `<file>:<line>:<col> <severity>: <message>` 列表；干净结果保留作为验证证据

### 4.2 `lsp_definition`
- 参数：`{ file: string, line: number, symbol?: string, timeout?: number }`
- 行为：`textDocument/definition`，接受 `Location | Location[] | LocationLink | LocationLink[]`
- 输出：`file:line:col` + 上下文行；无结果返回 `No definition found`

### 4.3 `lsp_references`
- 参数：`{ file: string, line: number, symbol?: string, timeout?: number }`
- 行为：`textDocument/references`（includeDeclaration: true）；仅命中自身声明时**重试 = 就绪等待的特例**（在 `readyTimeoutMs` 预算内等项目加载后重查，无需工具内自研重试上限，v2 修订）
- 输出：命中列表（首个若干带上下文，其余仅位置）

### 4.4 `lsp_hover`
- 参数：`{ file: string, line: number, symbol?: string, timeout?: number }`
- 行为：`textDocument/hover`，扁平化 MarkupContent/MarkedString
- 输出：悬停文本或 `No hover information`

**共同约定**：
- `symbol` 用于从行内解析列（精确/大小写不敏感匹配，支持 `name#N` 出现次数选择器），省略时取首个非空白列
- 所有工具只读，MVP 不触碰写审批
- **工具超时**：单次语义请求默认 20s，钳制 5..300，受全局 tools 超时上限约束（`exec.signal` 中断的是请求侧）
- **就绪等待独立预算（v2 修订）**：等待 "initialized + 项目加载" 不计入工具超时，走独立的 `readyTimeoutMs`（每语言可配，默认 60s；rust-analyzer / jdtls / csharp-ls 等重语言默认 120s），经 AbortSignal 单独钳制——避免重语言首启 >20s 时第一次请求必然超时
- 服务器不可用/缺失 → 明确错误文本（`LSP server for <ext> not enabled or missing`），不抛裸异常

---

## 5. 生命周期管理（参考 omp，按 DSH seam 简化）

- **懒启动**：第一个请求到达时才 spawn，绝不预启动全部勾选语言
- **client 池**：按 `command:projectRoot` 缓存一个 client（v2 修订，替代原 `command:cwd`——同一项目内多文件共享一个实例，换项目才新建）；同一服务器多项目共享进程的 lspmux 方案 **不做**（DSH 单进程 Web 服务无此诉求）
- **握手**：spawn → `initialize` → 缓存 capabilities → `initialized` → 注册消息处理器（`publishDiagnostics` 缓存、`$/progress` 项目加载跟踪、`workspace/applyEdit` 二期）
- **项目就绪等待**：发送语义请求前等待 initialized + 项目加载完成（`$/progress` 或 `readyTimeoutMs` 固定超时，v2 修订：独立预算、不计入工具超时），避免早期"假阴性/假阳性"
- **idle 回收**：默认 5 分钟无请求 → kill 进程；重服务器可配更短；**回收前检查池内是否有 in-flight 请求，有则跳过本轮**（v2 修订，避免高频场景反复冷启）
- **崩溃重试**：请求失败时自动重启一次（有上限），重启后丢弃旧请求并重试一次；连续崩溃 → 该语言标记为故障，返回明确错误，避免打转
- **进程执行**：走 DSH 的 `ctx.subprocess` seam（环境清理、终止、输出捕获），与 `dsh-tool-fs-search` 同模式；LSP 为**双向长驻进程**：`stdin: 'pipe'`（写请求）+ `stdout: 'pipe'`（流式读响应 + 服务器主动推送）+ `graceMs` 终止升级
- **环境注意（v2 修订，M0 实测）**：subprocess seam 的 `scrubbedParentEnv` **保留 PATH 等常规变量**，只滤除敏感键（`SENSITIVE_ENV_PATTERN`，如 `*API_KEY`）与 `DSH_*` 前缀——默认 env 下 PATH 已继承，**无需显式传**；`env` 参数用于追加服务器所需额外变量（如 `JAVA_HOME`）或 tombstone 删除某条目。副作用：`JYLD_API_KEY` 等凭据不会泄漏给语言服务器（正确行为）
- **进程清理双保险（v2 修订）**：引擎 `ctx.effect` disposer terminate 全部托管进程；subprocess 服务销毁时也会终止仍运行的托管进程

---

## 6. 配置存储（settings section）

schemastery schema，host 端注册 `lsp` namespace（参考 `llm-pi-ai` 的 `installSettingsSection` 模式）：

```yaml
lsp:
  enabled:
    typescript: true
    python: false
    go: true
  idleTimeoutMs: 300000
```

- `enabled`：语言 id → 布尔，默认全 false（用户勾选写入）
- `idleTimeoutMs`：全局空闲回收阈值
- 用户层叠加在插件组合 base 之上，设置页写入即生效（下次请求）
- 二期扩展：每语言覆盖 `command/args/rootMarkers`、安装相关字段

---

## 7. 设置页设计（./client 端）

**位置**：设置 → 新增 "LSP 语言" section（`dsh-client-ui-settings` 注册模式）

**布局**：
- 顶部：全局 idle 超时配置 + 总状态摘要（"已启用 N 个语言 / M 个缺失"）
- 按岗位分组（移动端 / 前端 / 后端 / 数据端），组内每语言一行：
  - 语言名 + 服务器名
  - 勾选开关（默认关）
  - 状态徽标：启用 ✓（绿）/ 缺失 ⚠（黄）/ 待命（灰）/ 故障（红）
  - 版本号（检测到时显示）
  - 重/实验性标注
- 缺失项在二期显示"安装"按钮（引导到用户级目录安装）

**数据流**：client 端通过 remote（`ctx.remote`）调 host 的检测/状态查询（每次进页面或手动刷新时检测，带缓存），勾选写入 settings section。

---

## 8. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M0（风险验证）** | 确认 `ctx.subprocess` 允许 spawn 任意外部二进制（沙箱策略）；确认 settings section + client UI 插件的挂载方式 | 一个最小插件能启动 typescript-language-server 并完成一次 definition 请求 |
| **M1（端到端最小）✅ 已验收** | 包骨架 + catalog（仅 TS）+ detect + client + `lsp_definition` 单工具 | 在 TS 项目里 agent 能调用 lsp_definition 得到正确位置——**2026 实测：调用点 `index.ts:6:13` → 定义 `index.ts:1:10`** |
| **M2（全量工具）✅ 已验收** | 四工具 + 生命周期（握手/就绪等待/idle/崩溃重试）+ 全量目录 | 四工具对 TS/Python 均可用——**2026 agent 实测四项全过**（definition→1:10、hover→签名、references→2 处、diagnostics→TS 2322 + Python 缺参）；无 GUI 验证 9/9 + 崩溃重试 PASS；挂载 serve 200 |
| **M3（设置页）✅ 已验收** | client 端设置页 + settings section 接线 | host 端 `installSettingsSection` 全链路 PASS（`m3-settings-check.mjs`）；client 端 `src/client/index.tsx` tsc 全绿 + esbuild 构建 `lib/client.js` + 挂载 serve 200——**2026 用户浏览器验收通过**（设置页 16 语言分组显示、勾选/取消同会话即时生效） |
| **M4（二期）🔄 host remote ✅ 安装引导 ✅ lsp_rename ✅** | 安装引导、`lsp_rename`/`rename_file`、workspace 诊断、写权限接入、host remote 下发语言目录、pyright 噪音排查、慢启动实测、多会话资源上限 | **host remote**（describe/install 双方法 + $mount + 状态徽标）✅；**安装引导**（16 语言模板 + note 引导 + 用户级安装 + 按钮）✅；**lsp_rename**（textDocument/rename → WorkspaceEdit 经 `ctx.fs` seam 落盘——沙箱感知 + fs/write-intent 审批钩子天然接入；单元 + 端到端 PASS）✅；其余按序推进 |

---

## 9. 风险与开放问题

1. **【M0 关键】DSH 沙箱对 subprocess 的限制**：当前会话的文件沙箱是 workspace-write，LSP 服务器是用户机器上任意二进制——`ctx.subprocess` seam 是否允许插件 spawn 它们、是否需要白名单/审批，是 MVP 前必须验证的第一件事。若被限制，需要设计"服务器进程豁免"机制或用户侧授权流程。
2. **依赖选择（v2 定稿）**：用 `vscode-languageserver-protocol` 做消息类型与编解码 + 自写 Content-Length 帧解析（约百行，omp client.ts 同路）；**不用** `vscode-languageclient`（依赖重、面向编辑器生命周期，与 DSH 的池管理冲突）。
3. **重服务器资源**：jdtls/rust-analyzer 的启动与内存；MVP 阶段接受"慢"，但 idle 回收和故障标记必须可靠。
4. **检测跨平台**：sourcekit-lsp 仅 macOS、clangd 路径差异、Windows 下 npm 全局 bin 解析——检测适配按平台分支。
5. **与现有工具的边界**：grep 仍在（文本搜索），LSP 是语义层补充；工具描述里明确"语义"定位，避免模型误用。
6. **诊断的"新旧"问题**：等待最新 publishDiagnostics 的版本号逻辑（参考 omp waitForDiagnostics），防过期结果。
7. **（v2 新增，M0 已澄清）环境 scrub**：`scrubbedParentEnv` 保留 PATH（默认即可启动）、滤除敏感键（`*API_KEY` 类）与 `DSH_*`——PATH 不会丢，凭据也不会泄漏（正确行为）；`env` 参数用于追加（如 `JAVA_HOME`）或删除条目（见 §5、§11.3）。
8. **（v2 新增）多服务器诊断冲突**：不同服务器（如 tsserver 与 eslint 类）可能同时报同一文件，`publishDiagnostics` 缓存键带 `source`，UI 标注来源。
9. **（v2 新增）多会话资源**：每会话一个引擎实例，N 个会话 = N 份服务器进程；idle 回收兜底，但极端场景（多会话 + 全勾选重语言）内存可观——UI 展示进程数/内存，或提供全局"最多并行服务器"上限（二期）。

---

## 10. 参考来源

- oh-my-pi LSP 层：`packages/coding-agent/src/lsp/`（client.ts / config.ts / defaults.json / lspmux.ts / tool.ts），[docs/lsp-config.md](https://github.com/can1357/oh-my-pi/blob/main/docs/lsp-config.md)、[docs/tools/lsp.md](https://github.com/can1357/oh-my-pi/blob/main/docs/tools/lsp.md)（MIT）
- DSH 插件范式：`dsh-client-ui-settings-plugins`（双面结构）、`dsh-tool-fs-search`（defineTool + ctx.subprocess）、`dsh-llm-pi-ai`（settings section 模式）

---

## 11. 开发环境速查（给新对话的事实信息）

### 11.1 本机环境

| 项 | 值 |
|---|---|
| DSH CLI/bin 包 | `$HOME/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/`（`@deepseek-ai/dsh` 0.1.0-rc.7，`dsh` 命令） |
| DSH 子包（194 个，rc.8） | 同目录下 `node_modules/@deepseek-ai/`（如 `dsh-llm-pi-ai`、`dsh-tool-fs-search`、`dsh-client-ui-settings-plugins`…） |
| 用户 DSH home | `~/.dsh`（`DSH_HOME=~/.dsh`） |
| 用户配置 | `~/.dsh/settings.yaml`（settings seam 用户层；`dsh-settings-file` 用 chokidar **watch 外部编辑**，改完即生效，无需重启） |
| 当前 profile | `~/.dsh/profiles/web`（Web GUI：bundles = `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`；`package.json` 的 `dsh.profile.bundles`；`cordis.yml` 为空 entry 列表；`cordis.patch.yml` 为用户的 patch 层——开发插件从这里挂载） |
| Web GUI | http://127.0.0.1:3080（node 进程监听） |
| 文件沙箱 | 当前会话为 workspace-write（仅工作区 `<workspace>/dsh-plugin` 可写）；写 `~/.dsh` 等外部路径需升级权限（danger-full-access + 用户批准） |
| 插件安装命令 | `dsh plugin --profile <name> <pnpm args>`（在 profile 目录转发 pnpm，把插件装进 profile 的 `node_modules`） |

### 11.2 参考代码定位

- **omp（GitHub `can1357/oh-my-pi`，MIT）**，LSP 目录 `packages/coding-agent/src/lsp/`：
  - `client.ts`（进程生命周期 + JSON-RPC 帧解析 + 消息处理）
  - `config.ts`（配置加载、rootMarkers 自动检测、服务器选择）
  - `defaults.json`（内置服务器定义：command/args/fileTypes/rootMarkers…）
  - `tool.ts`（14 个 action 派发：diagnostics/definition/references/hover/rename…）
  - `edits.ts`（WorkspaceEdit 应用）、`utils.ts`（URI 转换/符号列解析/格式化）、`types.ts`（schema 与协议类型）
  - `lspmux.ts` + `mux/`（多路复用守护进程——**DSH 版不做**，仅参考）
  - 文档：`docs/lsp-config.md`、`docs/tools/lsp.md`
- **DSH 范式包**（本地路径 `$HOME/.nvm/versions/node/v22.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`）：
  - `dsh-client-ui-settings-plugins`：**双面插件范本**——`lib/index.js` 为 host 端（空 `apply`，让插件出现在 loader）、`lib/client.js` 为浏览器端、`package.json` 用 `dsh.client.inject` 声明注入（`dsh-client-connection`、`dsh-client-locale`、`dsh-client-runtime`、`dsh-client-ui-settings`、`dsh-api-remotes`）
  - `dsh-tool-fs-search`：**host 工具范本**——`defineTool` + `ctx.subprocess` spawn 外部二进制（ripgrep）+ schemastery `Config`；`lib/index.js` 是唯一入口
  - `dsh-llm-pi-ai`：**settings section 范本**——`installSettingsSection(ctx, NS, Config, config, { validate, setSource, onChange })`、schemastery schema、`assertServiceable` 校验、credentials seam
  - `dsh-tools`：`defineTool` API（`{ name, description, parameters, output: { schema, render, presentationMeta }, timeoutMs, execute(args, exec) }`）
  - `dsh-subprocess-local`：subprocess seam 实现（**M0 验证目标**）
  - `dsh-client-ui-settings`：client 端设置页注册机制（`./client` 入口如何挂 section）

### 11.3 开发备忘与 M0 验证清单

- 插件包结构：ESM（`"type": "module"`）、`main: lib/index.js`、exports 含 `./client` 与 `./src/*`、`dsh.client` 声明、peerDependencies 引用所需 `@deepseek-ai/*` seam 包
- 工具注册：`defineTool(...)` 后经 `ctx.tools.register()`（见 `dsh-tool-fs-search` 的 apply）
- 进程执行：一律走 `ctx.subprocess`（环境清理/终止/输出捕获），不用 `ctx.shell`
- **M0 验证进度**（2026 实测，见工作区 `m0-spawn-check.mjs`）：
  1. ✅ **沙箱**：`ctx.subprocess` 允许 spawn 任意外部二进制——`typescript-language-server` 实跑成功，**未拦截**（风险 1 排除，无需豁免/授权机制）
  2. ⏳ client 端插件挂载是否走通（`dsh.client` 声明 + profile patch 挂载 + HMR/刷新生效）——待 M1 插件骨架实测
  3. ⏳ settings section 写入与外部编辑生效路径（参考 `llm-pi-ai`：设置页写入 vs 直接编辑 `~/.dsh/settings.yaml`）——机制已确认（chokidar watch），待 M3 实测
  4. ✅ **长驻双向进程**：`stdin: 'pipe'` 写请求 + `stdout: 'pipe'` 流式读响应 + 服务器主动推送（`window/logMessage`、`$/typescriptVersion`）全链路通过——initialize → initialized → didOpen → `textDocument/definition`（精确返回 `index.ts 0:9`）→ hover → shutdown → exit（exitCode 0）
  5. ✅ **环境 scrub**：`scrubbedParentEnv` 保留 PATH（默认 env 直接 spawn 成功）、滤除敏感键（`JYLD_API_KEY` 等不泄漏）；`terminate()` 语义正常（SIGTERM 退出）
  6. ⏳ 慢启动与超时：`readyTimeoutMs` 独立预算逻辑已定稿（§4 共同约定），M2 接重语言时实测
  - **M0 环境发现**：全局 `typescript@7.0.2` 为 Go 原生版，**无 `lib/tsserver.js`**，tls 需 workspace 内 TS 5.x（fixture 装 5.9.3 后即通）——catalog 检测与文档提示需考虑"服务器配套依赖"（tsserver 场景即 TS 5.x）

- **M1/M2 实现记录**（`scratch-lsp-plugin/`，2026 实测）：
  - 结构：`src/index.ts`（apply/Config/inject）+ `catalog.ts`（17 语言全量）+ `detect.ts`（本地 bin→PATH+版本）+ `jsonrpc.ts`（Content-Length 帧）+ `client.ts`（LspClient/LspPool）+ `tools.ts`（四工具）；纯 ESM TS，node `--experimental-strip-types` 直接跑，无构建步骤
  - **M1 验收（用户会话实测）**：agent 调用 `lsp_definition`，`index.ts:6:13`（调用点）→ `index.ts:1:10`（定义）+ 上下文行，与无 GUI 验证一致
  - **M2 无 GUI 验证 9/9 + 崩溃重试 PASS**（`m2-check.mjs` / `m2b-crash-check.mjs`）：TS 四工具（definition/hover/references/diagnostics 含 broken.ts 类型错误 code 2322）、Python 三工具（pyright-langserver）、idle 回收（in-flight 跳过）、崩溃重试（一次自动重启 + 二次拒绝标记故障）
  - **M2 关键实现细节（踩坑记录）**：
    1. Python 服务器是 `pyright-langserver --stdio`，不是 `pyright`（后者是 CLI type checker）——catalog 必须配 `pyright-langserver`
    2. **tls 必须声明客户端支持 `publishDiagnostics`**（initialize capabilities 的 `textDocument.publishDiagnostics`），否则 tsserver 完全不推诊断——这是 M2 排障最久的一项
    3. 诊断"新旧"问题实测：tsserver 先推语法诊断（空）再推语义诊断，`waitForDiagnostics` 需"稳定窗口"（首个 push 后等 2s 再读最终缓存），否则 broken.ts 误报 OK
    4. 已知噪音：pyright 后台进程可能向管道输出 "Connection input stream is not set" 错误文本，不影响功能（M3 若再现再排查）
  - 生命周期现状：懒启动、`command:projectRoot` 池键、`readyTimeoutMs` 独立预算、idle 回收（30s 轮询 + in-flight 跳过 + `reapNow()` 手动入口）、崩溃重试上限 1
  - **M3 host 端 settings section（已完成 + 验证）**：
    - `installSettingsSection(ctx, settingsNamespace('lsp'), Config, config, { setSource, onChange })` 接入，`current` 动态读取（settings 存在时指向解析值，否则退回组合 entry）
    - **关键坑（llm-pi-ai 同模式）**：`setSource` 收到的是 **thunk**（`() => scope.get()`），必须保存 thunk 而非立即取值——否则 settings 写入后 current 不更新
    - `m3-settings-check.mjs` 全链路 PASS：base 拒绝 → `settings.update` 勾选 python → 语义查找即时生效（`greet.py:5:7`）→ 取消勾选再次拒绝
    - client 端设置页源码完成（`src/client/index.tsx`，tsc 全绿）：
      - 结构：`ctx.slots.inject('settings.section', ...)` 注册（id `lsp`、order 20、label 走 locale）+ `ctx.locale.register` + `ctx.settingsScope.bind({namespace:'lsp'})`
      - 组件 props 契约（官方模式）：inject 返回 `{ hooks: { scope }, setEnabled, setIdle }`——hooks 键变成 `useXxx` selector hook（`SnapshotSelectorHook<SettingsScopeSnapshot<unknown>>`），额外键直接作为 props；`t` 由 slots 系统按 `locale: NS` 注入（类型 `TranslateNS<'lsp'>`）
      - 类型要点：`LocaleNamespaceMap` 增强声明**键 union**（`(LocaleNamespaceMap[N] & string)` 取键，不能是字典对象）；`z.infer` 在 schemastery 不可用，类型独立声明（llm-pi-ai 的 `z<Config>` 模式）
      - **构建链已解决（esbuild 手动构建）**：`scripts/build-client.mjs` 用 esbuild 打包（external react/react-jsx-runtime/@deepseek-ai/*，format cjs）→ 手工 wrap 成 `window.__ModuleLoader__.load({id, factory})`——产物 `lib/client.js`（8KB）**模拟加载通过**（exports apply/inject，与官方格式逐点对齐）
      - **挂载改造（关键）**：client-modules 按 `require.resolve('${pkgName}/package.json')` 解析 client bundle——**绝对路径 entry 不行，必须包名挂载**。已把插件 symlink 进 `~/.dsh/profiles/web/node_modules/dsh-lsp-plugin`，patch entry 改 `name: dsh-lsp-plugin`（main 仍指向 src/index.ts，strip-types 下加载验证通过）；`dsh --dump-config` 组合树合成 ✅、clientPath 解析 ✅（lib/client.js 存在）、dsh.client.inject 6 包 ✅
      - 语言列表当前为 client 端双份维护（与 host catalog 对齐）；M4 改 host remote 下发消除重复
