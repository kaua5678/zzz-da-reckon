/**
 * CC-237 源码锁 + 行为锁：招式行值只有 `data/moveTableQueries.ts#getRowValue` 一份实现（含逻辑编辑器行融合乘数）。
 *
 * 此前 15 个角色模块有 16 份私有取行值函数（rowValue / rowVal / getRowValue / rawRowValue），全部是 `values[0]`
 * 不乘 `getRowFusionMultiplier`（其中 lucy / rina / yaojiayin / yeshuguang 写成 `values[11] ?? 末项`，在「每行单值」的
 * catalog 上等价于 `values[0]`）。这与 claret R37-J1（claretSmoke.test.ts）已裁定的缺陷同型：用户在逻辑编辑器给招式行
 * 配融合规则时，引擎通用路径吃、这些模块不吃。无规则时乘数恒为 1 ⇒ 默认零差。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { setActiveRowFusionRules } from '@/logicEditor/fusion'
import type { RowFusionRule } from '@/logicEditor/types'
import { LUCY_ID, lucyMechanic } from '@/mechanics/agents/lucy'

const SRC = resolve(__dirname, '../..')
const OWNER = 'data/moveTableQueries.ts'
const DEF = /^\s*(?:export\s+)?(?:function\s+(?:rowValue|rowVal|getRowValue|rawRowValue)\s*[<(]|const\s+(?:rowValue|rowVal|getRowValue|rawRowValue)\s*=\s*\()/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') walk(p, out)
    } else if (/\.(ts|vue)$/.test(name) && !/\.(test|d)\.ts$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

afterEach(() => setActiveRowFusionRules([]))

describe('CC-237 招式行值单一来源', () => {
  it('除 data/moveTableQueries.ts 外，非测试源码不定义 rowValue / rowVal / getRowValue / rawRowValue', () => {
    const hits: string[] = []
    for (const p of walk(SRC)) {
      const rel = relative(SRC, p).split('\\').join('/')
      if (rel === OWNER) continue
      readFileSync(p, 'utf-8').split('\n').forEach((line, i) => {
        if (DEF.test(line)) hits.push(`${rel}:${i + 1}`)
      })
    }
    expect(hits).toEqual([])
  })

  it('行为：逻辑编辑器行规则 ×2 ⇒ 露西回旋挥击倍率恰为 2 倍；规则禁用 ⇒ 逐位不变（修前：一律不变）', () => {
    const catalog = JSON.parse(readFileSync(join(process.cwd(), 'public/static/catalog.json'), 'utf-8'))
    const skills = (catalog.agentSkills as Array<{ agentId: string }>).find(s => s.agentId === LUCY_ID)
    expect(skills).toBeTruthy()
    const spinOf = (rules: RowFusionRule[]): number => {
      setActiveRowFusionRules(rules)
      const cfg: Record<string, unknown> = {}
      lucyMechanic.buildCharConfig!({ skills, cinemaLevel: 0, team: [], cfg } as never)
      return Number(cfg.lucySpinDmg)
    }
    const rule = (enabled: boolean): RowFusionRule => ({
      id: 't-spin', name: 't', agentId: LUCY_ID, moveId: '1151026', rowId: 'damage', multiplier: 2, enabled, note: '',
    })
    const base = spinOf([])
    expect(base).toBeGreaterThan(0)
    expect(spinOf([rule(true)])).toBeCloseTo(base * 2, 9)
    expect(spinOf([rule(false)])).toBe(base)
  })
})
