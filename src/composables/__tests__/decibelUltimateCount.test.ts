import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { ULTIMATE_COST_DEFAULT } from '@/core/resource'

beforeEach(() => {
  newPinia()
  mockStaticFetch()
})

function teamChar(slot: number, agentId: string, cinemaLevel = 0, overrides: Record<string, unknown> = {}) {
  return {
    slot,
    agentId,
    cinemaLevel,
    wEngineId: '',
    wEngineModLevel: 1,
    driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {} as any, subStatAllocation: {} },
    parryCount: 6,
    blockCount: 0,
    dodgeCounterCount: 10,
    quickAssistCount: 3,
    chainCountPerStun: 1,
    basicAttackTimeWeight: 1,
    ...overrides,
  }
}

describe('终结技次数口径：异常/特殊动作奖励计入喧响推导', () => {
  it('用户场景回归：星徽·比利1 + 琉音0 + 卢西娅[合唱]1，界面总点数与次数推导同口径', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    config.team[0] = teamChar(0, '1531', 1)
    config.team[1] = teamChar(1, '1481', 0)
    config.team[2] = teamChar(2, '1451', 1)

    const calc = useResourceCalc()
    const out = calc.resourceResult.value!
    expect(out).not.toBeNull()
    for (const c of out.characters) {
      const ds = c.decibelSource
      // 特殊动作/异常奖励并入 total（界面喧响总览 = decibelSource.total，不再外拼）
      expect(ds.specialActionBonus).toBeGreaterThan(0)
      expect(ds.total).toBeGreaterThanOrEqual(ds.initialGift + ds.skillRegen + ds.teammateShare + ds.specialActionBonus + (ds.anomalyBonus ?? 0))
      // 次数与总点数同口径：floor(total / 3000)；秽盾送能量可能导致总喧响略高于实际能容纳次数（上限 1 档偏差）
      expect(Math.abs(c.ultimateCount - Math.floor(ds.total / ULTIMATE_COST_DEFAULT))).toBeLessThanOrEqual(1)
    }
    // 旧口径下该队伍比利 total≈8132 → 2 次；奖励并入后（终结技增多会挤压平A回复，总数略降）→ 至少 3 次
    const billy = out.characters.find(c => c.agentId === '1531')!
    expect(billy.decibelSource.total).toBeGreaterThan(10000)
    expect(billy.ultimateCount).toBeGreaterThanOrEqual(3)
  })

  it('快支 20/次 奖励只在 specialActionBonus 计一次（bonusRegen 不再重复）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    config.team[0] = teamChar(0, '1531', 0, { quickAssistCount: 3 })
    config.team[1] = teamChar(1, '1251', 0, { quickAssistCount: 0 })
    config.team[2] = teamChar(2, '1271', 0, { quickAssistCount: 0 })

    const calc = useResourceCalc()
    const out = calc.resourceResult.value!
    const main = out.characters.find(c => c.slot === 0)!
    // 无时光切片音擎 → bonusRegen 为 0（快支 20 不再在池内重复）；奖励全部在 specialActionBonus
    expect(main.decibelSource.bonusRegen).toBe(0)
    // specialActionBonus 含自己 3 次快支（3×20=60 下界；另含弹刀/闪反/连携与队友伴随）
    expect(main.decibelSource.specialActionBonus).toBeGreaterThanOrEqual(3 * 20)
    // 次数推导包含该奖励：total ≥ 基础部分 + 快支奖励
    expect(main.decibelSource.total).toBeGreaterThanOrEqual(
      main.decibelSource.initialGift + main.decibelSource.skillRegen + main.decibelSource.teammateShare + 3 * 20 - 1e-6,
    )
  })

  it('异常/紊乱/乱流奖励通过外层不动点回填（异常池产出 > 0 时 anomalyBonus > 0 且参与次数）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    // 火+以太异常队（露西+柏妮思路线用简配：异常角色打出异常 → 每触发 170，含队友伴随 85）
    config.team[0] = teamChar(0, '1561', 0)
    config.team[1] = teamChar(1, '1261', 0)
    config.team[2] = teamChar(2, '1411', 0)

    const calc = useResourceCalc()
    const out = calc.resourceResult.value!
    const anomalyPool = calc.anomalyPoolResult.value
    expect(anomalyPool).not.toBeNull()
    const totalTriggers = (anomalyPool!.perSlotAnomalyTriggers ?? []).reduce((a, b) => a + b, 0)
    if (totalTriggers > 0) {
      for (const c of out.characters) {
        expect(c.decibelSource.anomalyBonus ?? 0).toBeGreaterThan(0)
        expect(c.ultimateCount).toBe(Math.floor(c.decibelSource.total / ULTIMATE_COST_DEFAULT))
      }
    }
  })
})
