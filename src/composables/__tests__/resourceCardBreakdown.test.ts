/**
 * CC-233 锁：ResourceResultCard 能量 / 喧响明细各行之和 = 标题总数（energySource.total / decibelSource.total）。
 * 此前卡片漏列 exRefundEnergy（能量）与 unshareableBonus（喧响）：1051 喧响标题比各行之和多 3000~4000、1541 多 2700。
 * 新增 total 的组成项时：同时补进卡片模板与下面的清单，否则本测试会红。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

/** 卡片显示的能量顶层行（数值字段）；另有 bonusEntries[] 与 crossAgent（teamUltimateFlash + bySource）两组列表行 */
const ENERGY_ROWS = ['autoRegen', 'pctRegenBonus', 'flatRegenBonus', 'backstageBonus', 'comboAlignBonus', 'gainEfficiencyBonus',
  'skillRegen', 'timeSliceEnergy', 'zhenyuanEnergy', 'supportUltimateRegen', 'initialGift', 'shieldBreakGift', 'energyShieldBreakGift', 'exRefundEnergy'] as const
/** 卡片显示的喧响顶层行（timeSliceDecibel 已含在 bonusRegen、selfBurnDecibel 已含在 unshareableBonus，只作说明，不重复加） */
const DECIBEL_ROWS = ['initialGift', 'skillRegen', 'bonusRegen', 'teammateShare', 'anomalyBonus', 'specialActionBonus', 'unshareableBonus'] as const

const TEAMS = [['1051', '1311', '1221'], ['1541', '1331', '1411'], ['1451', '1371', '1311']]

describe('CC-233 结果卡明细 = 总数', () => {
  for (const team of TEAMS) it(team.join('-'), async () => {
    await setupHarness(team.map(agentId => ({ agentId })), { recommendedBuild: true })
    for (const c of useResourceCalc().resourceResult.value!.characters) {
      const e = c.energySource as any, d = c.decibelSource as any
      const cross = e.crossAgent ?? {}
      const crossRows = (cross.teamUltimateFlash ?? 0) + Object.values(cross.bySource ?? {}).reduce((a: number, b: any) => a + Number(b), 0)
      const eSum = ENERGY_ROWS.reduce((a, k) => a + (e[k] ?? 0), 0) + (e.bonusEntries ?? []).reduce((a: number, x: any) => a + x.value, 0) + crossRows
      const dSum = DECIBEL_ROWS.reduce((a, k) => a + (d[k] ?? 0), 0)
      expect(eSum, `${c.agentId} energy`).toBeCloseTo(e.total, 6)
      expect(dSum, `${c.agentId} decibel`).toBeCloseTo(d.total, 6)
    }
  })

  it('源码锁：卡片模板引用清单里每个字段', () => {
    const src = readFileSync(resolve(__dirname, '../../components/ResourceResultCard.vue'), 'utf-8')
    const tpl = src.slice(0, src.indexOf('<script'))
    for (const k of ENERGY_ROWS) expect(tpl, `energySource.${k}`).toMatch(new RegExp(`energySource\\.${k}\\b`))
    for (const k of DECIBEL_ROWS) expect(tpl, `decibelSource.${k}`).toMatch(new RegExp(`decibelSource\\.${k}\\b`))
  })
})
