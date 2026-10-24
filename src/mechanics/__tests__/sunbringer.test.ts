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
  INITIAL_CRIT_DMG_TO_CRIT_RATE,
  POLAR_DAY_CRIT_RATE,
  POLAR_DAY_DEF_IGNORE,
} from '@/mechanics/agents/sunbringer'
import type { AgentPanelInput } from '@/mechanics/types'

const catalog = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as {
  agents: { id: string, level60: Record<string, number> }[]
}

function runPanel(outOfCombatCritDmg: number) {
  const panel = emptyPanel()
  panel.critRate = 33.8
  panel.critDmg = outOfCombatCritDmg
  const outOfCombatPanel = { ...panel }
  applySunbringerPanel({ panel, outOfCombatPanel } as unknown as AgentPanelInput)
  return { panel, converted: Math.floor(outOfCombatCritDmg + 1e-9) * INITIAL_CRIT_DMG_TO_CRIT_RATE }
}

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
    expect(panel.enemyDefReduction).toBeCloseTo(POLAR_DAY_DEF_IGNORE, 6)
  })

  it('catalog 锋御两列在库：锐暴 150 / 锐能 1.5（缺了会静默掉乘区）', () => {
    const agent = catalog.agents.find(a => a.id === '1601')!
    expect(agent.level60.sharpCritDmg).toBe(150)
    expect(agent.level60.sharpnessRegen).toBe(1.5)
  })
})
