/**
 * 判据 28（死兜底）与判据 29（类型只声明一次）共用的 TS program：tsconfig.app.json 里的 `.ts` 文件。
 * `.vue` 不在内（要 vue-tsc 的类型信息）。建一次约 3 s，同一进程按仓库根缓存，两条判据只建一次。
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const cache = new Map()

/** `root/tsconfig.app.json` 的 program；配置文件不存在时返回 null */
export function appTsProgram(root) {
  if (cache.has(root)) return cache.get(root)
  const cfgPath = join(root, 'tsconfig.app.json')
  let program = null
  if (existsSync(cfgPath)) {
    const parsed = ts.getParsedCommandLineOfConfigFile(cfgPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(String(d.messageText)) } })
    program = ts.createProgram({ rootNames: parsed.fileNames.filter((f) => f.endsWith('.ts')), options: { ...parsed.options, noEmit: true } })
  }
  cache.set(root, program)
  return program
}

/** 两条判据的扫描面：src 非测试 `.ts`（不含 .d.ts、*.test.ts、*.perf.ts、任何 `__tests__/`、测试基建 `src/test/`） */
export function isAppTsScanned(rel) {
  if (!rel.startsWith('src/') || rel.startsWith('src/test/')) return false
  if (!rel.endsWith('.ts') || rel.endsWith('.d.ts') || rel.endsWith('.test.ts') || rel.endsWith('.perf.ts')) return false
  return !rel.split('/').includes('__tests__')
}
