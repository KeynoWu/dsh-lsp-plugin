// 修正 lib/status.js 的相对 import（src/ 源码 → lib/ 产物的路径差）
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const lib = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib')
const file = join(lib, 'status.js')
let s = readFileSync(file, 'utf8')
s = s.replace(/from "\.\/(catalog|detect)\.ts"/g, 'from "../src/$1.ts"')
writeFileSync(file, s)
console.log('[fix-status-paths] rewritten relative imports in lib/status.js')
