/**
 * 倍率贡献账判据（2026-10-20）。
 *
 * 用户口径：「倍率求和其实也都是这样算的，最好把能通用的全通用起来…矩阵的延展性也很好，
 * 有新数据了直接加一列就行。」
 *
 * 本文件把「不重不漏」在**倍率**这一维上钉死：
 *   ① 账本合计 == 引擎取值（同一函数 `getRowValue` / 同一份融合数据）；
 *   ② 融合招式的段之和 == `fusedRowValue`（两处算法同源，防止一边改了另一边没改）；
 *   ③ 反空洞（必须真的拆出多段，否则 ①② 在单段上平凡成立）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildMultiplierLedger, splitMoveMultiplier } from '@/composables/resourceCalc/multiplierLedger'
import { flattenLedger } from '@/core/contributionLedger'
import { fusedRowValue, getRowValue } from '@/data/moveTableQueries'
import { MOVE_FUSION_GROUPS } from '@/data/moveFusions'
import type { AgentSkills } from '@/types/catalog'

const cat = JSON.parse(readFileSync(new URL('../../../../public/static/catalog.json', import.meta.url), 'utf8')) as {
  agentSkills: AgentSkills[]
}

function skillsOf(agentId: string): AgentSkills | undefined {
  return cat.agentSkills.find(s => String(s.agentId) === agentId)
}

describe('倍率账：账本合计 == 引擎取值（同一来源）', () => {
  it('单段招式：账本 total == getRowValue', () => {
    const skills = skillsOf('1581')
    expect(skills).toBeTruthy()
    // 取一个确定存在的招式
    const move = skills!.categories.flatMap(c => c.moves)[0]!
    const split = splitMoveMultiplier(skills, move.id, 'damage')
    if (!split) return // 该招没有 damage 行 ⇒ 跳过（不构造假数据）
    expect(split.total).toBeCloseTo(getRowValue(move, 'damage'), 9)
  })

  it('融合招式：账本段之和 == fusedRowValue（两处算法同源）', () => {
    const groups = MOVE_FUSION_GROUPS
    expect(groups.length, '必须存在融合组，否则本条只在单段上平凡成立').toBeGreaterThan(0)
    let checked = 0
    for (const group of groups) {
      // 融合组属于哪个角色？逐个 catalog 试（组头 id 以 agentId 开头）
      const agentId = String(group.moveId).slice(0, 4)
      const skills = skillsOf(agentId)
      if (!skills) continue
      for (const kind of ['damage', 'daze'] as const) {
        const split = splitMoveMultiplier(skills, group.moveId, kind)
        if (!split) continue
        const engineValue = fusedRowValue(skills, group.moveId, kind)
        if (engineValue === null) continue
        expect(split.total, `${group.moveId} / ${kind}`).toBeCloseTo(engineValue, 9)
        checked++
      }
    }
    expect(checked, '至少要校验到一个融合组（反空洞）').toBeGreaterThan(0)
  })

  it('多段融合：段数 > 1（证明真的拆开了，不是单段冒充）', () => {
    let multi: { moveId: string; segments: number } | null = null
    for (const group of MOVE_FUSION_GROUPS) {
      const skills = skillsOf(String(group.moveId).slice(0, 4))
      if (!skills) continue
      const split = splitMoveMultiplier(skills, group.moveId, 'damage')
      if (split && split.segments.length > 1) { multi = { moveId: group.moveId, segments: split.segments.length }; break }
    }
    expect(multi, '至少要有一个融合组能拆出多段').toBeTruthy()
  })
})

describe('倍率账：三维结构与属性账同形', () => {
  it('行=招式、列=行类型、第三维=段，且摊平后条数 = 段数之和', () => {
    const skills = skillsOf('1581')
    const moveIds = skills!.categories.flatMap(c => c.moves).slice(0, 8).map(m => m.id)
    const table = buildMultiplierLedger(skills, moveIds)
    expect(table.columns.length).toBeGreaterThan(0)
    expect(table.rows.length).toBeGreaterThan(0)
    // 摊平后每条都带第三维（段）
    const flat = flattenLedger(table)
    expect(flat.length).toBeGreaterThan(0)
    expect(flat.every(r => !!r.slotKey)).toBe(true)
    // 列合计 == 该列所有行单元格之和
    for (const col of table.columns) {
      const rowSum = table.rows.reduce((a, r) => a + (r.cells.get(col)?.amount ?? 0), 0)
      expect(table.totals.get(col) ?? 0).toBeCloseTo(rowSum, 9)
    }
  })
})
