/**
 * 影画单调性守护（第 341 轮，CC-325 的同类拦截）。
 *
 * 读 timeGolden 基线里的单人用例 `agent:<id>:c<N>`，要求相邻影画档位伤害**不下降**。
 * 影画升级让伤害下降，要么是机制账漏算（CC-325：蕾米埃尔 4 命特殊虚耀扣了垂虹时间、耀变伤害却被
 * 「队友虚耀 = 0」门控吞掉），要么是固定 180s 下的时间 / 资源重新分配（合理）。
 * 后者登记在 ALLOW 里并写明原因；新出现的下降必须先归因：是缺陷就修，是重分配就登记。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ALLOW: Record<string, string> = {
  // 终结技 3→5、强特 18→17（4 命改变喧响/能量收支后重新分配），−0.17%；时间账逐位可解释
  '1091:c3->c4': '星见雅 4 命资源重新分配（终结技 +2 / 强特 −1）',
}

describe('影画单调性（golden 单人用例）', () => {
  it('相邻影画档位伤害不下降（例外须登记原因）', () => {
    const path = fileURLToPath(new URL('./timeGolden.baseline.json', import.meta.url))
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const cases = ((raw as { cases?: Record<string, unknown> }).cases ?? raw) as Record<string, { dmg?: string | number }>
    const byAgent = new Map<string, Map<number, number>>()
    for (const [key, v] of Object.entries(cases)) {
      const m = /^agent:(\d+):c(\d)$/.exec(key)
      if (!m || v?.dmg === undefined) continue
      if (!byAgent.has(m[1])) byAgent.set(m[1], new Map())
      byAgent.get(m[1])!.set(Number(m[2]), Number(v.dmg))
    }
    expect(byAgent.size).toBeGreaterThan(50)
    const drops: string[] = []
    for (const [id, lv] of byAgent) {
      const levels = [...lv.keys()].sort((a, b) => a - b)
      for (let i = 1; i < levels.length; i++) {
        const prev = lv.get(levels[i - 1])!
        const cur = lv.get(levels[i])!
        if (cur < prev * (1 - 1e-6)) drops.push(`${id}:c${levels[i - 1]}->c${levels[i]}`)
      }
    }
    expect(drops.sort()).toEqual(Object.keys(ALLOW).sort())
  })
})
