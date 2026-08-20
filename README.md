# dsh-lsp-plugin

**给 DeepSeek Harness 装上真正的语言智能**：内置语言服务器检测与进程池，让 agent 在 coding 时拥有语义级的「查错 / 找定义 / 找引用 / 看类型」能力——不再靠猜。

> 状态：M1–M3 已实现并通过验证（设计文档：[lsp-plugin-design.md](./lsp-plugin-design.md) v2）

---

## 为什么需要它：DSH 原本只有「文本级近似」

没有 LSP 时，agent 在代码库里是这样工作的：

| 想做的事 | 没有 LSP（现状） | 有了 LSP（本插件） |
|---|---|---|
| **写完代码查错** | 手动跑编译器/测试——慢、要搭命令、输出噪音大 | `lsp_diagnostics`：**毫秒级增量诊断，精确到行**，改完 A 立刻知道有没有破坏 B |
| **找定义 / 引用** | `grep` 字符串匹配——漏别名/重导出/动态分发，混进注释和字符串噪音 | `lsp_definition` / `lsp_references`：**语义精确匹配**，穿透 `import` 别名、重导出、动态分发，不含噪音 |
| **理解类型签名** | read 文件自己推断 | `lsp_hover`：**直接给出类型签名与文档** |
| **大代码库导航** | 凭文件名和 grep 猜位置 | 按语言服务器解析的**真实符号表**定位，跨文件引用一次到位 |

核心区别一句话：**没有 LSP 的 agent 在「猜」代码，有 LSP 的 agent 在「读」代码。** 语义分析是每种语言的重活，不该由 LLM 猜测，也不该让 grep 硬凑——交给专业语言服务器（tsserver / pyright / gopls / rust-analyzer…），agent 只负责「问」和「用答案」。

**它最值钱的使用场景**：agent 在长会话、大代码库里「行动前先验证、行动后先查错」——这正是当前 coding agent 最常出错、最需要精确信息的地方。

---

## 能力

**四只读工具**（全部基于 LSP 语义分析，非文本搜索）：

| 工具 | 作用 |
|---|---|
| `lsp_diagnostics` | 文件级语言诊断（增量分析，按 severity 排序）——**收益最大**，写完先查错 |
| `lsp_definition` | 符号定义位置（穿透别名/重导出/动态分发） |
| `lsp_references` | 全部引用（含声明，语义精确，不含注释/字符串噪音） |
| `lsp_hover` | 类型签名/文档（Markdown 扁平化） |

**内置 16 种语言目录**（前端/后端/Android/iOS/数据岗位全覆盖）：TypeScript、Vue、HTML、CSS、Python(pyright)、Go、Rust、Java、C#、PHP、Ruby、C/C++、Kotlin、Swift、SQL、R。

- **默认全部不启用**——在设置页勾选你要用的岗位语言即可，零资源浪费
- 勾选后**当前会话即时生效**，无需重启
- 语言服务器**不随插件安装**：检测本机已有二进制（`node_modules/.bin` → `$PATH`），缺失时设置页明确显示状态

**工程化生命周期**：懒启动（不勾选不 spawn）、`command:projectRoot` 进程池（同一项目共享一个服务器实例）、就绪等待独立预算（重语言如 rust-analyzer 首启不卡工具超时）、idle 回收（空闲自动释放，in-flight 不打断）、崩溃自动重启（上限 1，避免打转）。

---

## 快速开始

```bash
# 1. 克隆本仓库，链接插件到目标 profile（以 web profile 为例）
mkdir -p ~/.dsh/profiles/web/node_modules
ln -s "$(pwd)/scratch-lsp-plugin" ~/.dsh/profiles/web/node_modules/dsh-lsp-plugin

# 2. 在 ~/.dsh/profiles/web/cordis.patch.yml 挂载：
# - insert:
#     - id: dsh-lsp-plugin
#       name: dsh-lsp-plugin
#       config:
#         enabled:
#           typescript: true

# 3. 重启 dsh web，开始享受语义级 coding
```

**建议先装好常用语言的服务器**（插件负责检测与启动，安装交给包管理器）：

```bash
npm i -g typescript-language-server pyright   # TS/JS + Python（P0，最成熟）
# 其他语言：gopls / rust-analyzer / clangd / sourcekit-lsp 等按需安装
```

## 设置

设置 → **LSP 语言**：按岗位分组的 16 语言勾选 + 空闲回收超时。也可直接编辑 `~/.dsh/settings.yaml`（外部编辑自动生效）：

```yaml
lsp:
  enabled:
    typescript: true
    python: true
  idleTimeoutMs: 300000
```

## 开发与验证

```bash
cd scratch-lsp-plugin && npx tsc --noEmit      # 类型检查
node scripts/build-client.mjs                  # client bundle 构建（DSH ModuleLoader 格式）
```

各里程碑的验证结论（沙箱 spawn、双向 JSON-RPC、四工具 9/9、崩溃重试、settings 接线全链路）记录在设计文档 [lsp-plugin-design.md](./lsp-plugin-design.md) §11.3；开发期验证脚本依赖本机 DSH 安装，保存在仓库历史中，需要时从 git 历史找回。

## 里程碑

- **M0** ✅ 风险验证（沙箱可 spawn 外部二进制、双向 JSON-RPC、环境 scrub）
- **M1** ✅ 端到端最小（`lsp_definition`，agent 实测返回正确定义位置）
- **M2** ✅ 四工具 + 生命周期 + 全量目录（9/9 + 崩溃重试 PASS）
- **M3** ✅ host settings 接线 + client 设置页（esbuild ModuleLoader bundle）
- **M4** 二期：安装引导、`lsp_rename`、workspace 诊断、写权限接入（规划中）

## License

MIT
