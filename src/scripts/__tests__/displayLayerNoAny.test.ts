/**
 * CC-395（第 421 轮 · lane arena-C）：展示层（views / components）不许用 `as any` 强转读数据。
 *
 * **为什么**：展示层是「数据字段没声明」的最后泄漏点。`(x as any).field` 让字段名失去编译期检查，
 * 拼错只在运行时静默变 undefined。CC-380 / 381 / 382 已在 mechanics / core / specs / composables
 * 清过同一类问题，展示层一直没锁。本轮把 views + components 的 24 处清到 0（19 处字段本就已声明
 * = 冗余强转；5 处是本轮补声明的真实数据字段），并加这把锁。
 *
 * **红了怎么办**（按顺序，别直接加豁免）：
 *   ① catalog / 引擎结果里真有这个字段 ⇒ 在 `src/types/` 对应接口补声明，注释里写数据出处；
 *   ② 是第三方组件库的 prop 联合（如 naive-ui 的 tag `type`）⇒ 把常量表按库导出类型标注
 *      （`Record<string, NonNullable<TagProps['type']>>`），让推断给出联合，而不是在模板里强转；
 *   ③ 确实需要一处强转（极少）⇒ 在 ALLOW 加一行 `文件:行号: 理由`，写清为什么前两条都不适用。
 *
 * **范围**：只锁 `as any`（强转）。`: any` 参数标注（表格列 render 的 `row: any` 一类，现 23 处 /
 * 6 个文件）是另一类债，清单与做法见 `docs/mcp-worker-task-queue.md` §2b 第 421 轮交接。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const SRC = resolve(__dirname, '../..')
const DIRS = ['views', 'components']

/** 注释里提到 `as any` 不算违规 */
function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:'"\w])\/\/[^\n]*/g, '')
}

function walk(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) { if (n !== '__tests__' && n !== 'test') walk(p, out) }
    else if (/\.(ts|vue)$/.test(n) && !n.endsWith('.d.ts')) out.push(p)
  }
  return out
}

const FILES = DIRS.flatMap(d => walk(join(SRC, d)))
  .map(p => ({ rel: relative(SRC, p).replace(/\\/g, '/'), raw: readFileSync(p, 'utf-8') }))

/** 已登记例外：`文件:行号: 理由`。空 = 一处都不许有。 */
const ALLOW: readonly string[] = []

describe('CC-395：展示层没有 as any 强转', () => {
  it('views / components 里没有 as any', () => {
    const bad: string[] = []
    for (const f of FILES) {
      stripComments(f.raw).split('\n').forEach((line, i) => {
        if (/\bas any\b/.test(line)) bad.push(`${f.rel}:${i + 1}: ${line.trim().slice(0, 120)}`)
      })
    }
    expect(bad.filter(b => !ALLOW.some(a => b.startsWith(a)))).toEqual([])
  })

  it('扫描面真的覆盖 views 与 components（防目录被挪走导致锁静默失效）', () => {
    expect(FILES.length).toBeGreaterThan(30)
    expect(FILES.map(f => f.rel)).toContain('views/TeamConfigPage.vue')
    expect(FILES.map(f => f.rel)).toContain('components/ResourceResultCard.vue')
  })
})
