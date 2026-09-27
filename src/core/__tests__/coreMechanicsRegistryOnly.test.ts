/**
 * R6 C1（2026-09-27）：core 只经 `@/mechanics/registry` 查询角色能力，不按值 import `@/mechanics` 目录入口。
 *
 * 为什么：`src/mechanics/index.ts` 一次性 import 全部角色模块并注册；角色模块又按值 import core
 * ⇒ core → mechanics/index → agents/* → core 的 ESM 模块环（初始化顺序敏感）。registry 只依赖 specs，
 * 不含任何角色模块，所以 core → registry 不成环。注册副作用由 `src/main.ts` 与 vite.config 的
 * `test.setupFiles` 负责。回退点：把 import 改回 `@/mechanics` 并删掉 setupFiles 一行。
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../../', import.meta.url).pathname
const coreFiles = execSync("git ls-files 'src/core/*.ts' 'src/core/**/*.ts'", { cwd: root }).toString()
  .split('\n').filter(f => f && !f.includes('__tests__'))

describe('R6 C1 core → mechanics 只走 registry', () => {
  it('core 非测试文件里没有按值 import `@/mechanics`（目录入口）或角色模块', () => {
    const bad: string[] = []
    for (const f of [...new Set(coreFiles)]) {
      const src = readFileSync(root + f, 'utf8')
      for (const m of src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'(@\/mechanics(?:\/agents\/[^']*)?)'/gm)) bad.push(`${f}: ${m[1]}`)
    }
    expect(bad).toEqual([])
  })

  it('registry 本身不 import 任何角色模块（否则环又回来了）', () => {
    const src = readFileSync(root + 'src/mechanics/registry.ts', 'utf8')
    expect(src).not.toMatch(/from\s+'(\.\/agents\/|@\/mechanics\/agents\/|\.\/index'|@\/mechanics')/)
  })

  it('注册入口仍被应用入口与测试 setup 加载', () => {
    expect(readFileSync(root + 'src/main.ts', 'utf8')).toMatch(/import '@\/mechanics'/)
    expect(readFileSync(root + 'vite.config.ts', 'utf8')).toMatch(/setupFiles:\s*\['\.\/src\/mechanics\/index\.ts'\]/)
  })
})
