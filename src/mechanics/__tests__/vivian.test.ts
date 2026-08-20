import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  VIVIAN_C4_ATK_PCT,
  VIVIAN_C6_ETHER_DMG,
  VIVIAN_LUOYU_MOVE_ID,
  VIVIAN_XUANLUO_MOVE_ID,
  computeVivianCycle,
  vivianMechanic,
} from '@/mechanics/agents/vivian'
import { setupHarness } from '@/test/harness'

async function setup(mateId = '1181', cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1331', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

function cycle(overrides: Partial<Parameters<typeof computeVivianCycle>[0]> = {}) {
  return computeVivianCycle({
    cinemaLevel: 6,
    followUpCount: 8,
    additionalActive: true,
    c4AtkCoverage: 1,
    ...overrides,
  })
}

describe('薇薇安（1331）总量与折算', () => {
  it('护羽消耗=追击次数，影画1每4点护羽返1点飞羽', () => {
    const c = cycle({ cinemaLevel: 1, followUpCount: 8 })
    expect(c.guardFeatherSpent).toBe(8)
    expect(c.c1FeatherRefund).toBe(2)
    expect(cycle({ cinemaLevel: 0, followUpCount: 8 }).c1FeatherRefund).toBe(0)
  })

  it('影画4攻击力与影画6以太增伤按命座/覆盖率门控', () => {
    expect(cycle({ cinemaLevel: 4 }).c4AtkBonus).toBe(VIVIAN_C4_ATK_PCT)
    expect(cycle({ cinemaLevel: 4, c4AtkCoverage: 0.5 }).c4AtkBonus).toBe(6)
    expect(cycle({ cinemaLevel: 3 }).c4AtkBonus).toBe(0)
    expect(cycle({ cinemaLevel: 5 }).c6EtherDmg).toBe(0)
    expect(cycle({ cinemaLevel: 6 }).c6EtherDmg).toBe(VIVIAN_C6_ETHER_DMG)
  })
})

describe('薇薇安执行行与定向结算', () => {
  const cfgWith = (cinema: number, extra: Record<string, unknown> = {}) => ({
    panel: { additionalAbilityActive: 1 },
    vivianCinemaLevel: cinema,
    vivianFollowUpCount: 6,
    vivianC4AtkCoverage: 1,
    vivianAdditionalActive: true,
    ...extra,
  })

  it('额外能力激活时生成真实moveId落羽生花追击行，不占前台时间', () => {
    const executions: any[] = []
    vivianMechanic.buildExecutions!({
      cfg: cfgWith(0),
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 },
      executions,
    } as any)
    const follow = executions.find(r => r.moveId === VIVIAN_LUOYU_MOVE_ID)
    expect(follow.count).toBe(6)
    expect(follow.actionTime).toBe(0)
    expect(follow.element).toBe('ether')
  })

  it('额外能力未激活时不生成追击行', () => {
    const executions: any[] = []
    vivianMechanic.buildExecutions!({
      cfg: cfgWith(0, { vivianAdditionalActive: false }),
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 },
      executions,
    } as any)
    expect(executions.find(r => r.moveId === VIVIAN_LUOYU_MOVE_ID)).toBeUndefined()
  })

  it('影画4使悬落/落羽生花必定暴击，其他招式不受影响', () => {
    const xuanluo: any = { moveId: VIVIAN_XUANLUO_MOVE_ID }
    const luoyu: any = { moveId: VIVIAN_LUOYU_MOVE_ID }
    const other: any = { moveId: '1331010' }
    vivianMechanic.patchExecutions!({
      cfg: cfgWith(4),
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 },
      executions: [xuanluo, luoyu, other],
    } as any)
    expect(xuanluo.critRateBonus).toBe(100)
    expect(luoyu.critRateBonus).toBe(100)
    expect(other.critRateBonus).toBeUndefined()
    // 未解锁影画4不加暴击
    const x2: any = { moveId: VIVIAN_XUANLUO_MOVE_ID }
    vivianMechanic.patchExecutions!({
      cfg: cfgWith(3),
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 },
      executions: [x2],
    } as any)
    expect(x2.critRateBonus).toBeUndefined()
  })
})

describe('薇薇安完整计算链', () => {
  it('额外能力由异常/同属性队友激活，击破异属性队友不激活', async () => {
    for (const mateId of ['1181', '1031']) {
      const { catalog, config } = await setup(mateId)
      expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    }
    const neg = await setup('1141')
    expect((computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('资源池生成落羽生花追击行并保留通用失衡提取', async () => {
    await setup('1181', 6)
    const calc = useResourceCalc()
    const vivian = calc.resourceResult.value!.characters.find(row => row.agentId === '1331')!
    expect(vivian.executions.some(row => row.moveId === VIVIAN_LUOYU_MOVE_ID)).toBe(true)
    expect(vivian.specResources?.vivian_cycle).toBeTruthy()
  })

  it('面板增益进入最终面板（影画6以太增伤/影画4攻击力）', async () => {
    await setup('1181', 6)
    const calc = useResourceCalc()
    // 先触发完整资源/失衡计算（transformSkillExecutions 在失衡/异常池提取时施加面板增益）
    expect(calc.resourceResult.value!.characters.find(row => row.agentId === '1331')!.specResources?.vivian_cycle).toBeTruthy()
    const panel = calc.panels.value[0] as any
    expect(panel.__vivianPanelApplied).toBe(true)
    expect(panel.etherDmg).toBeGreaterThanOrEqual(VIVIAN_C6_ETHER_DMG)
  })
})
