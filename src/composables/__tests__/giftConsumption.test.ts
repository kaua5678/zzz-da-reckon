/**
 * 赠送大招的**资源语义**（用户 2026-09-10 裁决 #1）：
 * 「应当打完整大招，享有同等倍率融合。计数+1 就行，根本不会影响消耗——消耗取决于有多少喧响
 * 而不是有多少大招。大招来源可以是喧响和赠送等多种来源。」
 *
 * 三条机器判据：
 *  ① **完整大招**：赠行的倍率/时长 == 目标自身同 moveId 终结技行（融合整段，坑 31）；
 *  ② **计入次数**：目标 `ultimateCount` = 喧响可支撑的自攒次数 + 赠大次数；
 *  ③ **不产生消耗**：赠行 `energyConsume/decibelRecovery` 为 0，且**自攒次数不因赠大减少**
 *     （消耗由喧响总量推导：`floor(decibel/3000)`，与大招个数无关）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { ULTIMATE_COST_DEFAULT } from '@/core/resource'

async function loadTeam(id: string) {
  const { catalog } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  const config = useConfigStore()
  const preset = teamPresets.find(p => p.id === id)!
  for (let i = 0; i < 3; i++) config.setAgent(i, preset.team[i])
  config.applyTeamPreset(preset.team as [string, string, string])
  return useResourceCalc().resourceResult.value!
}

describe('赠送大招的资源语义（完整大招 / 计入次数 / 零消耗）', () => {
  it('① 赠行 = 目标自身同 moveId 终结技行的倍率与单次时长（融合整段）', async () => {
    const rr = await loadTeam('auto-1021-1481-1311') // 猫又 / 琉音 / 耀嘉音
    let checked = 0
    for (const c of rr.characters) {
      for (const gift of (c.executions ?? []).filter(e => e.source === 'gift')) {
        const twin = (c.executions ?? []).find(e => e !== gift && e.moveId === gift.moveId && e.source !== 'gift')
        if (!twin) continue
        expect(gift.damageMultiplier, `${c.agentId} 赠行倍率应取融合整段`).toBeCloseTo(twin.damageMultiplier ?? 0, 6)
        expect(gift.actionTime, `${c.agentId} 赠行单次时长应取融合整段`).toBeCloseTo(twin.actionTime ?? 0, 6)
        expect(gift.anomalyBuildUp ?? 0).toBeCloseTo(twin.anomalyBuildUp ?? 0, 6)
        checked++
      }
    }
    expect(checked, '至少校验到一条赠行').toBeGreaterThan(0)
  })

  it('② 目标终结技次数 = 自攒(floor(喧响/3000)) + 赠大次数', async () => {
    const rr = await loadTeam('auto-1021-1481-1311')
    const target = rr.characters.find(c => (c.executions ?? []).some(e => e.source === 'gift'))!
    expect(target, '该预设应有赠大目标').toBeTruthy()
    const giftCount = (target.executions ?? []).filter(e => e.source === 'gift')
      .reduce((s, e) => s + (e.count ?? 0), 0)
    expect(giftCount).toBeGreaterThan(0)
    const ownUlt = Math.floor((target.decibelSource?.total ?? 0) / ULTIMATE_COST_DEFAULT)
    // 非轴队：显示次数 = 自攒 + 赠送（赠大不挤占自攒）
    expect(target.ultimateCount ?? 0, `ultimateCount=${target.ultimateCount} ownUlt=${ownUlt} gift=${giftCount}`)
      .toBeCloseTo(ownUlt + giftCount, 6)
  })

  it('③ 赠行零消耗：不耗闪能/不回能/不回喧响', async () => {
    const rr = await loadTeam('auto-1021-1481-1311')
    const giftRows = rr.characters.flatMap(c => (c.executions ?? []).filter(e => e.source === 'gift'))
    expect(giftRows.length).toBeGreaterThan(0)
    for (const g of giftRows) {
      expect(g.energyConsume ?? 0, '赠大不耗闪能').toBe(0)
      expect(g.totalEnergyConsume ?? 0).toBe(0)
      expect(g.energyRecovery ?? 0, '赠大不回闪能').toBe(0)
      expect(g.decibelRecovery ?? 0, '赠大不回喧响（来源是赠送，不是自己攒）').toBe(0)
    }
  })
})
