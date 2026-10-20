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

  /**
   * **D 项（2026-10-20）：喧响「行级 Σ / 非行级通道」拆分必须闭合到总数**。
   *
   * 用户长期反馈「喧响只算了一部分」——实测行级只占 12%~53%（其余走开局/伴随/特殊动作/异常/专属）。
   * 卡片新增的拆分条若两段之和不等于 total，就是在教用户做错算术（同 `ledgerInflation` 那类病）。
   * 本用例按**卡片自己的分类口径**逐角色断言闭合，且钉住「行级 Σ 就是 skillRegen」这一来源
   * （`decibelRowParity.test.ts` 已锁 skillRegen == Σ 行级收入）。
   */
  it('D：卡片两段（行级 Σ + 非行级通道）逐角色闭合到 decibelSource.total', async () => {
    const teams = [...TEAMS, ['1371', '1481', '1451']]
    let checked = 0
    for (const team of teams) {
      await setupHarness(team.map(agentId => ({ agentId })), { recommendedBuild: true })
      for (const c of useResourceCalc().resourceResult.value!.characters) {
        const d = c.decibelSource
        const rowLevel = d.skillRegen
        const nonRow = d.initialGift + d.bonusRegen + d.teammateShare + d.specialActionBonus + d.anomalyBonus + d.unshareableBonus
        expect(rowLevel + nonRow, `${c.agentId} 拆分两段之和 ≠ total`).toBeCloseTo(d.total, 6)
        // 反空洞：确实存在非行级通道（否则拆分条没有信息量）
        if (nonRow > 1) checked++
      }
    }
    expect(checked, '非行级通道全为 0 ⇒ 拆分条退化成恒等式（判据失去意义）').toBeGreaterThan(0)
  }, 300_000)
})
