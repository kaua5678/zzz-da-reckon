/**
 * CC-245：管线后半段（composables/resourceCalc/）运行时依赖闭包不得进入 pinia store 模块。
 *
 * store 实例一律由调用方（useResourceCalc 入口）以参数注入，resourceCalc 内只在类型位置引用
 * （`import type` + `ReturnType<typeof useXStore>`）；唯一允许的运行时 stores 依赖是纯函数口径
 * `stores/selectionReads.ts`（无 pinia，见其头注释）。这是 ARCHITECTURE.md §0「管线后半段并入 core」的前提。
 * 修前唯一越界边：helpers.ts 值导入 useConfigStore / useCatalogStore（只用于类型）。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const SRC = resolve(__dirname, '../..')
const ALLOWED = new Set(['stores/selectionReads.ts'])

function resolveSpec(from: string, spec: string): string | null {
  let p: string
  if (spec.startsWith('@/')) p = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) p = resolve(dirname(from), spec)
  else return null
  for (const c of [`${p}.ts`, join(p, 'index.ts'), p]) if (existsSync(c) && statSync(c).isFile()) return c
  return null
}

describe('CC-245 resourceCalc 运行时不依赖 pinia store', () => {
  it('依赖闭包（排除 import type）进入 stores/ 的只允许 selectionReads', () => {
    const seen = new Set<string>()
    const offenders = new Map<string, string>()
    const walk = (file: string, chain: string[]) => {
      if (seen.has(file)) return
      seen.add(file)
      const src = readFileSync(file, 'utf-8')
      for (const m of src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gms)) {
        const target = resolveSpec(file, m[1])
        if (!target) continue
        const rel = relative(SRC, target).replace(/\\/g, '/')
        if (rel.startsWith('stores/') && !ALLOWED.has(rel) && !offenders.has(rel)) {
          offenders.set(rel, [...chain, file].map(f => relative(SRC, f)).join(' > '))
        }
        walk(target, [...chain, file])
      }
    }
    const dir = join(SRC, 'composables/resourceCalc')
    for (const name of readdirSync(dir)) if (name.endsWith('.ts')) walk(join(dir, name), [])
    expect(Object.fromEntries(offenders)).toEqual({})
  })
})
