/**
 * 挽昼（1601）v1 占位包 —— 面板层生效判据（2026-10-25 第一刀）。
 *
 * 覆盖：① 初始暴伤 → 初始暴击率 0.35%/1%（整 1% floor、只读局外面板）；
 * ② 极昼 暴击率 +40 / 无视 20% 防御（满覆盖近似）；③ catalog 的锋御两列（锐暴 150 / 锐能 1.5）在库。
 * 资源循环（锐能/残痕/愿力/链齿·旗令/愿核/烬痕）口径见 `sunbringer.ts` 头注释，接线后补判据。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emptyPanel } from '@/core/panel'
import {
  applySunbringerPanel,
  buildSunbringerCharConfig,
  patchSunbringerExecutions,
  INITIAL_CRIT_DMG_TO_CRIT_RATE,
  PARRY_ASSIST_DAZE_BONUS,
  POLAR_DAY_CRIT_RATE,
  POLAR_DAY_DEF_IGNORE,
} from '@/mechanics/agents/sunbringer'
import type { AgentCharConfigInput, AgentPanelInput, AgentResourceInput } from '@/mechanics/types'

const catalog = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as {
  agents: { id: string, level60: Record<string, number> }[]
  agentSkills: { agentId: string, categories: { moves: { id: string, name: { zhCN: string }, rows: { id: string, values: number[] }[] }[] }[] }[]
}

function runPanel(outOfCombatCritDmg: number) {
  const panel = emptyPanel()
  panel.critRate = 33.8
  panel.critDmg = outOfCombatCritDmg
  const outOfCombatPanel = { ...panel }
  applySunbringerPanel({ panel, outOfCombatPanel } as unknown as AgentPanelInput)
  return { panel, converted: Math.floor(outOfCombatCritDmg + 1e-9) * INITIAL_CRIT_DMG_TO_CRIT_RATE }
}

describe('1601 挽昼 · 招架支援失衡 +50%（nanoka 3.4.1+19997538 新增）', () => {
  it('自身三段招架行都按表值 ×1.5 预缩（引擎取哪一段都不漏）', () => {
    const skills = catalog.agentSkills.find(s => s.agentId === '1601')!
    const parry = skills.categories.flatMap(c => c.moves).filter(m => /招架支援/.test(m.name.zhCN))
    expect(parry.length, 'catalog 里应有招架支援段（轻/重/连续）').toBeGreaterThanOrEqual(1)
    const cfg: Record<string, unknown> = {}
    buildSunbringerCharConfig({
      cfg,
      skills,
      agent: catalog.agents.find(a => a.id === '1601')!,
      cinemaLevel: 0,
    } as unknown as AgentCharConfigInput)
    const scaled = cfg.sunbringerParryDazeById as Record<string, number>
    for (const m of parry) {
      const base = m.rows.find(r => r.id === 'daze')!.values[0]
      expect(scaled[m.id]).toBeCloseTo(Math.round(base * (1 + PARRY_ASSIST_DAZE_BONUS / 100) * 1000) / 1000, 6)
      expect(scaled[m.id]).toBeGreaterThan(base) // 反空洞：确实变大了，「忘了乘」不会被漏过
    }
  })

  it('命中招架行才打 override，其它行不动（负控）', () => {
    const skills = catalog.agentSkills.find(s => s.agentId === '1601')!
    const parryId = skills.categories.flatMap(c => c.moves).find(m => /招架支援/.test(m.name.zhCN))!.id
    const cfg: Record<string, unknown> = {}
    buildSunbringerCharConfig({
      cfg,
      skills,
      agent: catalog.agents.find(a => a.id === '1601')!,
      cinemaLevel: 0,
    } as unknown as AgentCharConfigInput)
    const rows = [
      { moveId: parryId, dazeMultiplier: 1, count: 1 },
      { moveId: '1601106', dazeMultiplier: 7, count: 1 },
    ] as unknown as AgentResourceInput['executions']
    patchSunbringerExecutions({ cfg, state: {}, executions: rows } as unknown as AgentResourceInput)
    expect(rows[0]!.dazeMultiplierOverride).toBe(true)
    expect(rows[0]!.dazeMultiplier).toBe((cfg.sunbringerParryDazeById as Record<string, number>)[parryId])
    expect(rows[1]!.dazeMultiplierOverride).toBeUndefined()
    expect(rows[1]!.dazeMultiplier).toBe(7)
  })
})

describe('1601 挽昼 · 面板层', () => {
  it('初始暴伤 → 初始暴击率：整 1% floor，且只吃局外面板', () => {
    const { panel, converted } = runPanel(50)
    expect(converted).toBe(17.5)
    expect(panel.critRate).toBeCloseTo(33.8 + 17.5 + POLAR_DAY_CRIT_RATE, 6)
    const { converted: c2 } = runPanel(78.8)
    expect(c2).toBeCloseTo(27.3, 6)
  })

  it('极昼：暴击率 +40、无视 20% 防御', () => {
    const { panel } = runPanel(0)
    expect(panel.critRate).toBeCloseTo(33.8 + POLAR_DAY_CRIT_RATE, 6)
    expect(panel.enemyDefIgnoreDirect).toBeCloseTo(POLAR_DAY_DEF_IGNORE, 6)
  })

  it('catalog 锋御两列在库：锐暴 150 / 锐能 1.5（缺了会静默掉乘区）', () => {
    const agent = catalog.agents.find(a => a.id === '1601')!
    expect(agent.level60.sharpCritDmg).toBe(150)
    expect(agent.level60.sharpnessRegen).toBe(1.5)
  })
})