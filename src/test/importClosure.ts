/**
 * 测试工具：求源码文件的**运行时** import 闭包（跳过 `import type`），供分层锁使用（CC-245/247）。
 * 只解析 `@/` 与相对路径；第三方包忽略。返回「越界目标 → 首条引入链」。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

export const SRC_ROOT = resolve(__dirname, '..')

function resolveSpec(from: string, spec: string): string | null {
  let p: string
  if (spec.startsWith('@/')) p = join(SRC_ROOT, spec.slice(2))
  else if (spec.startsWith('.')) p = resolve(dirname(from), spec)
  else return null
  for (const c of [`${p}.ts`, join(p, 'index.ts'), p]) if (existsSync(c) && statSync(c).isFile()) return c
  return null
}

/** 目录下全部非测试 .ts（递归，跳过 __tests__） */
export function sourceFilesUnder(relDir: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); continue }
      if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(p)
    }
  }
  walk(join(SRC_ROOT, relDir))
  return out
}

/** 从 entries 出发沿运行时 import 递归；`isOffender(rel)` 为真的目标记录首条链（rel 为相对 src 的 posix 路径） */
export function runtimeImportOffenders(entries: string[], isOffender: (rel: string) => boolean): Record<string, string> {
  const seen = new Set<string>()
  const offenders: Record<string, string> = {}
  const rel = (f: string) => relative(SRC_ROOT, f).replace(/\\/g, '/')
  const walk = (file: string, chain: string[]) => {
    if (seen.has(file)) return
    seen.add(file)
    const src = readFileSync(file, 'utf-8')
    for (const m of src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gms)) {
      const target = resolveSpec(file, m[1])
      if (!target) continue
      const r = rel(target)
      if (isOffender(r) && !(r in offenders)) offenders[r] = [...chain, file].map(rel).join(' > ')
      walk(target, [...chain, file])
    }
  }
  for (const e of entries) walk(e, [])
  return offenders
}
