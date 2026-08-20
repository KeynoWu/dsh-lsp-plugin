# dsh-lsp-plugin

DeepSeek Harness（DSH）的 LSP 插件：内置语言服务器检测与进程池，通过语义工具暴露诊断/定义/引用/hover，提升 coding 场景准确度。

> 状态：M1–M3 已实现并通过验证（设计文档：[lsp-plugin-design.md](./lsp-plugin-design.md) v2）

## 能力

**四只读工具**（全部基于 LSP 语义分析，非文本搜索）：

| 工具 | 作用 |
|---|---|
| `lsp_definition` | 符号定义位置（穿透别名/重导出/动态分发） |
| `lsp_hover` | 类型签名/文档（Markdown 扁平化） |
| `lsp_references` | 全部引用（含声明，语义精确） |
| `lsp_diagnostics` | 文件级语言诊断（增量分析，按 severity 排序） |

**内置 16 种语言目录**（前端/后端/Android/iOS/数据）：TypeScript、Vue、HTML、CSS、Python(pyright)、Go、Rust、Java、C#、PHP、Ruby、C/C++、Kotlin、Swift、SQL、R——默认全部不启用，用户在设置页勾选。

**生命周期**：懒启动、`command:projectRoot` 进程池、就绪等待独立预算（`readyTimeoutMs`）、idle 回收（in-flight 跳过）、崩溃重试（上限 1）。

## 安装

```bash
# 1. 克隆/下载本仓库，进入 scratch-lsp-plugin 目录
# 2. 把插件链接进目标 profile（以 web profile 为例）
mkdir -p ~/.dsh/profiles/web/node_modules
ln -s "$(pwd)/scratch-lsp-plugin" ~/.dsh/profiles/web/node_modules/dsh-lsp-plugin
# 3. 在 ~/.dsh/profiles/web/cordis.patch.yml 挂载
# - insert:
#     - id: dsh-lsp-plugin
#       name: dsh-lsp-plugin
#       config:
#         enabled:
#           typescript: true
# 4. 重启 dsh web
```

语言服务器**不随插件安装**——插件检测本机已有的二进制（`node_modules/.bin` → `$PATH`），缺失时在设置页显示状态。建议先装好你常用语言的服务器（`npm i -g typescript-language-server pyright` 等）。

## 设置

设置 → **LSP 语言**：按岗位分组的语言勾选 + 空闲回收超时。勾选后**当前会话即时生效**（工具每次调用动态读取配置）。也可直接编辑 `~/.dsh/settings.yaml`：

```yaml
lsp:
  enabled:
    typescript: true
    python: true
  idleTimeoutMs: 300000
```

## 开发与验证

```bash
# 类型检查
cd scratch-lsp-plugin && npx tsc --noEmit
# client bundle 构建（lib/client.js，DSH ModuleLoader 格式）
node scripts/build-client.mjs
# 无 GUI 验证脚本（仓库根目录，node --experimental-strip-types）
node m2-check.mjs        # 四工具 TS/Python 9/9
node m2b-crash-check.mjs # 崩溃重试
node m3-settings-check.mjs # settings 接线全链路
```

## 里程碑

- **M0** ✅ 风险验证（沙箱可 spawn 外部二进制、双向 JSON-RPC、环境 scrub）
- **M1** ✅ 端到端最小（包骨架 + `lsp_definition`，agent 实测返回正确定义位置）
- **M2** ✅ 四工具 + 生命周期 + 全量目录（无 GUI 9/9 + 崩溃重试 PASS）
- **M3** ✅ host settings section 接线 + client 设置页（esbuild ModuleLoader bundle）
- **M4** 二期：安装引导、`lsp_rename`、workspace 诊断、写权限接入（规划中）

## License

MIT
