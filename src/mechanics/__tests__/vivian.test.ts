import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  VIVIAN_C2_BUILDUP_EFF,
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
    teamExSpecialCount: 6,
    selfExSpecialCount: 6,
    teammateAnomalyCount: 6,
    battleTime: 180,
    danceHitCount: 0,
    chainCount: 2,
    ultimateCount: 1,
    assistCount: 1,
    additionalActive: true,
    c4AtkCoverage: 1,
    ...overrides,
  })
}

describe('薇薇安（1331）总量与折算', () => {
  it('飞羽→护羽→落羽生花资源循环，影画1每4护羽返1飞羽', () => {
    // 默认 cinemaLevel=6：飞羽 = 进场2 + 强特6×4(C6) + 连携2×2 + 终结1×5 + 支援突击1×2 = 37
    // 护羽 = C4进场5 + 飞羽37 = 42；落羽需求 = 源1(6) + 源2(min(6, 180/0.5)=6) = 12
    // 落羽实际 = min(12, 42) = 12；C1返还 = floor(12/4) = 3
    const c = cycle({ cinemaLevel: 1 })
    // cinemaLevel=1 无 C6：飞羽 = 2 + 6×3 + 2×2 + 1×5 + 1×2 = 31；无 C4 进场护羽 → 护羽=31
    expect(c.flyFeatherTotal).toBe(31)
    expect(c.guardFeatherAvailable).toBe(31)
    expect(c.followUpCount).toBe(12)
    expect(c.c1FeatherRefund).toBe(3)
    expect(cycle({ cinemaLevel: 0 }).c1FeatherRefund).toBe(0)
  })

  it('源2 队友施加异常受 0.5s CD 封顶', () => {
    // 战斗60s：源2 CD封顶 = 60/0.5 = 120；异常触发50次 → 源2=50
    // 落羽需求 6+50=56；护羽(默认C6) = 5 + 37 = 42 → 落羽=42（受护羽约束）
    const c = cycle({ teammateAnomalyCount: 50, battleTime: 60 })
    expect(c.followUpCount).toBe(42)
    // 护羽充足时（源1少）→ 落羽=源1+源2
    const low = cycle({ teammateAnomalyCount: 3, battleTime: 60 })
    expect(low.followUpCount).toBe(6 + 3)
  })

  it('落羽生花次数受护羽总量约束', () => {
    // 高需求低护羽：源1=30（全队强特），飞羽=2+30×3=92（自身强特30，C0）→ 护羽92，不截断
    const c = cycle({ cinemaLevel: 0, selfExSpecialCount: 30, teamExSpecialCount: 30, teammateAnomalyCount: 0, chainCount: 0, ultimateCount: 0, assistCount: 0 })
    expect(c.flyFeatherTotal).toBe(92)
    expect(c.followUpCount).toBe(30)
  })

  it('影画4攻击力与影画6以太增伤按命座/覆盖率门控', () => {
    expect(cycle({ cinemaLevel: 4 }).c4AtkBonus).toBe(VIVIAN_C4_ATK_PCT)
    expect(cycle({ cinemaLevel: 4, c4AtkCoverage: 0.5 }).c4AtkBonus).toBe(6)
    expect(cycle({ cinemaLevel: 3 }).c4AtkBonus).toBe(0)
    expect(cycle({ cinemaLevel: 5 }).c6EtherDmg).toBe(0)
    expect(cycle({ cinemaLevel: 6 }).c6EtherDmg).toBe(VIVIAN_C6_ETHER_DMG)
  })

  it('影画6 悬落特殊异放倍率 = ×5（消耗护羽封顶）', () => {
    expect(cycle({ cinemaLevel: 6 }).c6ReleaseMult).toBe(5)
    expect(cycle({ cinemaLevel: 5 }).c6ReleaseMult).toBe(1)
  })
})

describe('薇薇安执行行与定向结算', () => {
  const cfgWith = (cinema: number, extra: Record<string, unknown> = {}) => ({
    panel: { additionalAbilityActive: 1 },
    vivianCinemaLevel: cinema,
    vivianTeamExTotal: 6, vivianAnomalyTriggerTotal: 6,
    vivianC4AtkCoverage: 1,
    vivianAdditionalActive: true,
    battleTime: 180,
    chainCountTotal: 2,
    ultimateCount: 1,
    ...extra,
  })

  it('额外能力激活时生成真实moveId落羽生花追击行，不占前台时间', () => {
    const executions: any[] = []
    vivianMechanic.buildExecutions!({
      cfg: cfgWith(0),
      state: { exSpecialCount: 6, ultimateCount: 1, chainCountTotal: 2 },
      executions,
    } as any)
    const follow = executions.find(r => r.moveId === VIVIAN_LUOYU_MOVE_ID)
    // 源1=6（全队强特）+ 源2=6（异常触发，180s/0.5s 不封顶）= 12，受护羽总量约束
    expect(follow.count).toBe(12)
    expect(follow.actionTime).toBe(0)
    expect(follow.element).toBe('ether')
  })

  it('源1（全队强特命中）不依赖额外能力激活——无条件生成追击行', () => {
    // 源1 = 全队强化特殊技命中触发（技能自带，同一招式至多一次），无额外能力也生效
    const executions: any[] = []
    vivianMechanic.buildExecutions!({
      cfg: cfgWith(0, { vivianAdditionalActive: false }),
      state: { exSpecialCount: 6, ultimateCount: 1, chainCountTotal: 2 },
      executions,
    } as any)
    const follow = executions.find(r => r.moveId === VIVIAN_LUOYU_MOVE_ID)
    expect(follow).toBeTruthy()
    expect(follow.count).toBeGreaterThan(0)
  })

  it('悬落后台自动衔接 E/Q/支援/连携：次数=四者之和，0s 后台不占前台', () => {
    const executions: any[] = []
    vivianMechanic.buildExecutions!({
      cfg: cfgWith(0),
      state: { exSpecialCount: 8, ultimateCount: 3, chainCountTotal: 1.7 },
      executions,
    } as any)
    const xuanluo = executions.find(r => r.moveId === VIVIAN_XUANLUO_MOVE_ID)
    expect(xuanluo).toBeTruthy()
    // 悬落 = E 8 + Q 3 + 连携 floor(1.7)=1 + 支援 0 = 12
    expect(xuanluo.count).toBe(12)
    expect(xuanluo.actionTime).toBe(0)
    expect(xuanluo.timeBucket).toBe('backstage')
    expect(xuanluo.element).toBe('ether')
  })

  it('强化特殊技全部合轴：堇花悼亡 timeBucket=backstage，不占前台时间', () => {
    const ex: any = { moveId: '1331010', timeBucket: 'necessary' }
    vivianMechanic.patchExecutions!({
      cfg: cfgWith(0),
      state: { exSpecialCount: 8, ultimateCount: 3, chainCountTotal: 1.7 },
      executions: [ex],
    } as any)
    expect(ex.timeBucket).toBe('backstage')
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

  it('面板增益进入最终面板（影画6以太增伤/影画4攻击力/影画2以太积蓄效率）', async () => {
    await setup('1181', 6)
    const calc = useResourceCalc()
    // 先触发完整资源/失衡计算（transformSkillExecutions 在失衡/异常池提取时施加面板增益）
    expect(calc.resourceResult.value!.characters.find(row => row.agentId === '1331')!.specResources?.vivian_cycle).toBeTruthy()
    const panel = calc.panels.value[0] as any
    expect(panel.etherDmg).toBeGreaterThanOrEqual(VIVIAN_C6_ETHER_DMG)
    expect(panel.etherAnomalyBuildUpEfficiency).toBeGreaterThanOrEqual(VIVIAN_C2_BUILDUP_EFF)
  })

  it('覆盖率滑块→面板重算（防守卫冻结，SOP §3.5）', async () => {
    const { catalog, config } = await setup('1181', 6)
    const atkOf = () => (computePanelPhases(0, config, catalog)!.inCombat as any).atkPct ?? 0
    config.setMechanicSetting('vivian.c4AtkCoverage', 1)
    const on = atkOf()
    config.setMechanicSetting('vivian.c4AtkCoverage', 0)
    const off = atkOf()
    expect(on - off).toBeCloseTo(VIVIAN_C4_ATK_PCT, 1)
  })
})

describe('薇薇安核心被动异放（releaseRatio 框架）', () => {
  it('落羽生花异放事件：dominant 元素 + 精通比例 + 次数=追击次数', () => {
    const cfg: any = { vivianCinemaLevel: 0, vivianTeamExTotal: 8, vivianAnomalyTriggerTotal: 0 }
    const events: any[] = []
    vivianMechanic.buildAnomalyEvents!({ cfg, state: { exSpecialCount: 8 } as any, events, totalTime: 180 })
    const release = events.find(e => e.eventId === 'vivian_luoyu_release')
    expect(release).toBeTruthy()
    expect(release.eventType).toBe('release')
    expect(release.element).toBe('dominant')
    expect(release.count).toBe(8)
    expect(release.releaseRatio).toMatchObject({ basis: 'anomalyProficiency' })
    expect(release.releaseRatio.perTenByElement.ether).toBeCloseTo(6.15, 5)
    expect(release.releaseRatio.perTenByElement.wind).toBeCloseTo(0.32, 5)
  })

  it('异放触发条件：命中异常目标占比（vivian.releaseCoverage）折算次数', () => {
    // 原文：落羽生花命中「处于异常状态」的目标才触发异放
    const cfg: any = { vivianCinemaLevel: 0, vivianTeamExTotal: 10, vivianAnomalyTriggerTotal: 0, 'setting:vivian.releaseCoverage': 0.6 }
    const events: any[] = []
    vivianMechanic.buildAnomalyEvents!({ cfg, state: { exSpecialCount: 10 } as any, events, totalTime: 180 })
    const release = events.find(e => e.eventId === 'vivian_luoyu_release')!
    expect(release.count).toBe(6) // 10 次 × 60% 命中异常目标

    // 预言 DoT 同样受命中异常占比约束
    const dot = events.find(e => e.eventId === 'vivian_prediction_dot')!
    expect(dot.count).toBe(Math.floor(180 * 1 * 0.6 / 0.55))
  })

  it('影画2：异放精通收益 ×130%（perTen 放大）', () => {
    const cfg: any = { vivianCinemaLevel: 2, vivianTeamExTotal: 4, vivianAnomalyTriggerTotal: 0 }
    const events: any[] = []
    vivianMechanic.buildAnomalyEvents!({ cfg, state: { exSpecialCount: 4 } as any, events, totalTime: 180 })
    const release = events.find(e => e.eventId === 'vivian_luoyu_release')!
    expect(release.releaseRatio.perTenByElement.ether).toBeCloseTo(6.15 * 1.3, 5)
    expect(release.releaseRatio.perTenByElement.fire).toBeCloseTo(8 * 1.3, 5)
  })

  it('影画6：悬落特殊异放比例 ×5', () => {
    const cfg: any = { vivianCinemaLevel: 6, vivianTeamExTotal: 4, vivianAnomalyTriggerTotal: 0 }
    const events: any[] = []
    vivianMechanic.buildAnomalyEvents!({ cfg, state: { exSpecialCount: 4 } as any, events, totalTime: 180 })
    const c6 = events.find(e => e.eventId === 'vivian_xuanluo_c6_release')
    expect(c6).toBeTruthy()
    expect(c6.releaseRatio.perTenByElement.ether).toBeCloseTo(6.15 * 1.3 * 5, 5)
  })

  it('预言 DoT：次数 = floor(战斗时长 × 覆盖率 / 0.55)，覆盖率可调', () => {
    const cfg: any = { vivianCinemaLevel: 0, vivianTeamExTotal: 4, vivianAnomalyTriggerTotal: 0 }
    const events: any[] = []
    vivianMechanic.buildAnomalyEvents!({ cfg, state: { exSpecialCount: 4 } as any, events, totalTime: 180 })
    const dot = events.find(e => e.eventId === 'vivian_prediction_dot')
    expect(dot).toBeTruthy()
    expect(dot.eventType).toBe('direct_damage')
    expect(dot.element).toBe('ether')
    expect(dot.count).toBe(Math.floor(180 / 0.55))

    // 覆盖率 50% → 次数减半
    const cfgHalf: any = { vivianCinemaLevel: 0, vivianTeamExTotal: 4, vivianAnomalyTriggerTotal: 0, 'setting:vivian.dotCoverage': 0.5 }
    const eventsHalf: any[] = []
    vivianMechanic.buildAnomalyEvents!({ cfg: cfgHalf, state: {} as any, events: eventsHalf, totalTime: 180 })
    expect(eventsHalf.find(e => e.eventId === 'vivian_prediction_dot')!.count).toBe(Math.floor(180 * 0.5 / 0.55))
  })

  it('异放进入伤害池（type=异放，次数=追击次数）', async () => {
    await setup('1181', 6)
    const calc = useResourceCalc()
    const rows = calc.damagePoolRows.value
    const releases = rows.filter(r => r.type === '异放' && r.agentId === '1331')
    expect(releases.length).toBeGreaterThan(0)
  })
})
