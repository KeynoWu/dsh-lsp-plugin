// client bundle 构建：esbuild 打包 src/client/index.tsx → lib/client.js（DSH ModuleLoader 格式）
// 对齐官方 client.js 结构：window.__ModuleLoader__.load({ id, factory: (require) => {...} })
// external：react / react/jsx-runtime / @deepseek-ai/*（由 web 前端的模块系统提供）
import { build } from 'esbuild'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outBundle = join(root, 'lib', 'client.bundle.js')
const outFinal = join(root, 'lib', 'client.js')

await build({
  entryPoints: [join(root, 'src', 'client', 'index.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/*'],
  outfile: outBundle,
  logLevel: 'warning',
})

const code = readFileSync(outBundle, 'utf8')
  .split('\n')
  .map((line) => (line.length > 0 ? '    ' + line : line))
  .join('\n')
const wrapped = `window.__ModuleLoader__.load({
	id: "dsh-lsp-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
${code}
		return module.exports;
	}
});
`
writeFileSync(outFinal, wrapped)
rmSync(outBundle, { force: true })
console.log(`[build-client] wrote ${outFinal} (${wrapped.length} bytes)`)
