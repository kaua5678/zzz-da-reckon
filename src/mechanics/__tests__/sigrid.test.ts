import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { sigridMechanic, SIGRID_CHUQIANG_MOVE_IDS, SIGRID_LANCE_MOVE_ID } from '@/mechanics/agents/sigrid'

const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')
const buffsText = readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const recsText = readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8')

const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'iceDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

describe('希格莉德（1591）面板：核心被动 / 额外能力 / 影画', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
      if (u.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(buffsText) }
      if (u.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(recsText) }
      return { ok: false, json: async () => ({}) }
    }))
  })

  async function setup(teamAgentIds: [string, string, string], cinemaLevel = 0) {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    teamAgentIds.forEach((agentId, slot) => {
      config.team[slot] = { slot, agentId, cinemaLevel: slot === 0 ? cinemaLevel : 0, ...baseConfig } as any
    })
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    return { catalog, config, computePanelPhases }
  }

  it('核心被动（0命，带[支援]队友）：暴击率 +66、失衡易伤 +20（默认满覆盖）', async () => {
    // 1211 丽娜 = 支援 → 额外能力激活
    const { config, computePanelPhases } = await setup(['1591', '1211', ''])
    config.setMechanicSetting('sigrid.corePassiveCoverage', 0)
    const p0 = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    config.setMechanicSetting('sigrid.corePassiveCoverage', 1)
    const p1 = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    expect(p1.critRate - p0.critRate).toBeCloseTo(66, 5)
    expect(p1.stunDmgMultiplierBonus - p0.stunDmgMultiplierBonus).toBeCloseTo(20, 5)
  })

  it('额外能力·天际联军：[支援]队友在队 → 攻击 +840、浸染增伤 +15；无关队友 → 不生效', async () => {
    // 正例：1211 丽娜（支援）
    const pos = await setup(['1591', '1211', ''])
    const pPos = pos.computePanelPhases(0, pos.config, useCatalogStore())!.inCombat as any
    // 负例：1081 比利（物理·狡兔屋，与希格莉德不同属性不同阵营，非支援/击破）
    const neg = await setup(['1591', '1081', ''])
    const pNeg = neg.computePanelPhases(0, neg.config, useCatalogStore())!.inCombat as any
    expect(pPos.additionalAbilityActive).toBe(1)
    expect(pNeg.additionalAbilityActive ?? 0).toBe(0)
    // 面板差分：正例比负例多 840 攻击与 15 增伤（其余条件一致）
    expect(pPos.atk - pNeg.atk).toBeCloseTo(840, 0)
    expect(pPos.dmgBonus - pNeg.dmgBonus).toBeCloseTo(15, 5)
  })

  it('命座差分：1命攻击 ×1.25、2命喧响获取 +10、4命增伤 +18', async () => {
    const { config, computePanelPhases } = await setup(['1591', '1211', ''], 0)
    const p0 = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    config.team[0].cinemaLevel = 1
    const p1 = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    // 影画1 攻击+25%：先乘百分比再叠 +840 固定值，差分 = round(base×1.25) - base
    expect(p1.atk - p0.atk).toBeGreaterThanOrEqual(Math.round((p0.atk - 840) * 0.25) - 1)
    expect(p1.atk - p0.atk).toBeLessThanOrEqual(Math.round((p0.atk - 840) * 0.25) + 1)

    config.team[0].cinemaLevel = 2
    const p2 = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    expect(p2.decibelGainEfficiency - p0.decibelGainEfficiency).toBeCloseTo(10, 5)

    config.team[0].cinemaLevel = 4
    const p4 = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    expect(p4.dmgBonus - p2.dmgBonus).toBeCloseTo(18, 5)
  })

  it('覆盖率滑块 50%：暴击增量减半（33）', async () => {
    const { config, computePanelPhases } = await setup(['1591', '1211', ''])
    config.setMechanicSetting('sigrid.corePassiveCoverage', 0)
    const pOff = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    config.setMechanicSetting('sigrid.corePassiveCoverage', 0.5)
    const pHalf = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    expect(pHalf.critRate - pOff.critRate).toBeCloseTo(33, 5)
  })
})

describe('希格莉德 patchExecutions：影画2 穿透率 / 影画1·6 敛枪式附加', () => {
  function exec(moveId: string): any {
    return { moveId, moveName: moveId, category: 'basic', count: 1, actionTime: 1, comboAlignRatio: 0, totalTime: 1, totalComboAlignTime: 0, decibelRecovery: 0, totalDecibelRecovery: 0 }
  }

  it('影画2：出枪式+敛枪式行挂穿透率 +24，其他招式不受影响', () => {
    const cfg: any = { sigridCinemaLevel: 2, sigridAtk: 1000 }
    const lance = exec(SIGRID_LANCE_MOVE_ID)
    const chuqiang = exec('1591009') // 终结技：霜天 ∈ 出枪式
    const basic = exec('1591001') // 凛冽枪尖 ∈ 出枪式（整行近似）
    const other = exec('1591003') // 特殊技：冰花 ∉ 出枪式
    expect(SIGRID_CHUQIANG_MOVE_IDS.has('1591009')).toBe(true)
    expect(SIGRID_CHUQIANG_MOVE_IDS.has('1591003')).toBe(false)
    sigridMechanic.patchExecutions!({ cfg, executions: [lance, chuqiang, basic, other] } as any)
    expect(lance.penRatioBonus).toBe(24)
    expect(chuqiang.penRatioBonus).toBe(24)
    expect(basic.penRatioBonus).toBe(24)
    expect(other.penRatioBonus ?? 0).toBe(0)
  })

  it('0命：无任何执行级修正', () => {
    const cfg: any = { sigridCinemaLevel: 0, sigridAtk: 1000 }
    const lance = exec(SIGRID_LANCE_MOVE_ID)
    const chuqiang = exec('1591009')
    sigridMechanic.patchExecutions!({ cfg, executions: [lance, chuqiang] } as any)
    expect(lance.penRatioBonus ?? 0).toBe(0)
    expect(lance.flatDamageBonus ?? 0).toBe(0)
    expect(chuqiang.penRatioBonus ?? 0).toBe(0)
  })

  it('影画6：敛枪式行附加 90% 攻击力（80/90/100 中值近似）', () => {
    const cfg: any = { sigridCinemaLevel: 6, sigridAtk: 2000 }
    const lance = exec(SIGRID_LANCE_MOVE_ID)
    sigridMechanic.patchExecutions!({ cfg, executions: [lance] } as any)
    expect(lance.penRatioBonus).toBe(24) // 6命含2命
    // 影画6 90% + 影画1 溢出 100%×默认覆盖 1 = 190% × 2000 = 3800
    expect(lance.flatDamageBonus).toBeCloseTo(2000 * 1.9, 5)
  })

  it('影画1 溢出覆盖率滑块生效（0% 时只剩影画6 部分）', () => {
    const cfg: any = { sigridCinemaLevel: 6, sigridAtk: 2000, 'setting:sigrid.c1OverflowCoverage': 0 }
    const lance = exec(SIGRID_LANCE_MOVE_ID)
    sigridMechanic.patchExecutions!({ cfg, executions: [lance] } as any)
    expect(lance.flatDamageBonus).toBeCloseTo(2000 * 0.9, 5)
  })
})

describe('希格莉德 buildCharConfig', () => {
  it('记录命座等级与局内攻击力（敛枪式附加伤害基数）', () => {
    const cfg: any = {}
    sigridMechanic.buildCharConfig!({ cfg, cinemaLevel: 3, panel: { atk: 3210 } } as any)
    expect(cfg.sigridCinemaLevel).toBe(3)
    expect(cfg.sigridAtk).toBe(3210)
  })
})
