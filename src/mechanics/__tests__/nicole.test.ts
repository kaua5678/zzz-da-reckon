import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { NICOLE_BULLETS_PER_APPLY, NICOLE_C1_EX_BONUS, NICOLE_C2_ENERGY, NICOLE_POKE_MOVE_ID, nicoleBulletReserve, nicoleMechanic } from '@/mechanics/agents/nicole'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, defAssistCount: 0,
  quickAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1,
}

async function setup(cinemaLevel = 0, mateId = '1241') {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (const buff of config.globalBuffs) buff.enabled = false
  // 1241 朱鸢 以太·强攻 → 同属性触发额外能力
  config.team[0] = { slot: 0, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: '1031', cinemaLevel, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('妮可模块', () => {
  it('影画1：EX 段伤害+16% 与积蓄×1.16', () => {
    const cfg: any = { nicoleCinemaLevel: 1 }
    const executions: any[] = [
      { moveId: '1031103', dmgBonus: 0, anomalyBuildUp: 100, count: 2, totalAnomalyBuildUp: 200, skillTableNote: '' },
      { moveId: '1031001', dmgBonus: 0, anomalyBuildUp: 50, count: 1 },
    ]
    nicoleMechanic.patchExecutions!({ cfg, state: {} as any, executions } as any)
    expect(executions[0].dmgBonus).toBe(NICOLE_C1_EX_BONUS)
    expect(executions[0].anomalyBuildUp).toBeCloseTo(100 * 1.16)
    expect(executions[0].totalAnomalyBuildUp).toBeCloseTo(100 * 1.16 * 2)
    expect(executions[1].dmgBonus).toBe(0)
  })

  it('影画2：开局能量赠送 floor(t/15)×5', () => {
    const cfg: any = { battleTime: 180, initialEnergyGift: 40 }
    nicoleMechanic.buildCharConfig!({
      slot: 1, agent: {} as any, skills: { categories: [] } as any,
      cinemaLevel: 2, wEngineId: '', wEngineModLevel: 1, team: [], panel: {} as any, cfg, getRowValue: () => 0,
    } as any)
    expect(cfg.initialEnergyGift).toBe(40 + Math.floor(180 / 15) * NICOLE_C2_ENERGY)
    const cfg0: any = { battleTime: 180, initialEnergyGift: 40 }
    nicoleMechanic.buildCharConfig!({
      slot: 1, agent: {} as any, skills: { categories: [] } as any,
      cinemaLevel: 0, wEngineId: '', wEngineModLevel: 1, team: [], panel: {} as any, cfg: cfg0, getRowValue: () => 0,
    } as any)
    expect(cfg0.initialEnergyGift).toBe(40)
  })

  it('影画1：蓄力延长能量场——倍率行等比放大（1.5×蓄力秒/能量场基准秒）', () => {
    const skills = {
      categories: [{
        id: 'special',
        moves: [
          { id: '1031103', actionTime: 0.742, rows: [{ id: 'damage', values: [430.6] }] },
          { id: '1031106', actionTime: 1.484, rows: [{ id: 'damage', values: [774.2] }, { id: 'daze', values: [300] }, { id: 'anomaly_buildup', values: [120] }] },
        ],
      }],
    } as any
    const cfg: any = { battleTime: 180, initialEnergyGift: 40 }
    nicoleMechanic.buildCharConfig!({
      slot: 1, agent: {} as any, skills, cinemaLevel: 1,
      wEngineId: '', wEngineModLevel: 1, team: [], panel: {} as any, cfg, getRowValue: () => 0,
    } as any)
    const scale = 1 + 1.5 * 0.742 / 1.484 // ≈1.75
    expect(cfg.nicoleC1EnergyFieldScale).toBeCloseTo(scale, 6)
    expect(cfg.nicoleC1EnergyFieldDamage).toBeCloseTo(774.2 * scale, 4)

    const executions: any[] = [{ moveId: '1031106', dmgBonus: 0, anomalyBuildUp: 120, count: 2, totalAnomalyBuildUp: 240, skillTableNote: '' }]
    nicoleMechanic.patchExecutions!({ cfg, state: {} as any, executions } as any)
    expect(executions[0].damageMultiplier).toBeCloseTo(774.2 * scale, 4)
    expect(executions[0].damageMultiplierOverride).toBe(true)
    expect(executions[0].anomalyBuildUp).toBeCloseTo(120 * scale * 1.16, 3) // 时长延长 + 积蓄+16%
  })
})

describe('妮可面板', () => {
  beforeEach(() => { newPinia(); mockStaticFetch() })

  it('核心减防40；同属性触发以太伤25', async () => {
    const { catalog, config } = await setup(0, '1241')
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    expect(mate.enemyDefReduction).toBeCloseTo(40)
    expect(mate.etherDmg).toBeCloseTo(25)
  })

  it('无同属性/同阵营时额外以太伤不生效', async () => {
    // 11号 1041 火强攻 卡吕冬 — 非以太非狡兔屋
    const { catalog, config } = await setup(0, '1041')
    const mateOut = computePanelPhases(0, config, catalog)!.outOfCombat
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    expect(mate.enemyDefReduction).toBeCloseTo(40)
    expect(mate.etherDmg - (mateOut.etherDmg ?? 0)).toBe(0)
  })

  it('影画6 满层暴击+15', async () => {
    const { catalog, config } = await setup(5, '1241')
    const c5 = computePanelPhases(0, config, catalog)!.inCombat
    config.team[1].cinemaLevel = 6
    config.syncTeammateBuffsFromTeam()
    const c6 = computePanelPhases(0, config, catalog)!.inCombat
    expect(c6.critRate - c5.critRate).toBeCloseTo(15)
  })
})

/**
 * 减防接力（用户口径 2026-10-22）：「妮可技能会给强化子弹，这个平a也能上3.5秒的持续减防，a 一下就是这么多，
 * 填充剩余的不需要很多时间。剩下的时间就要用妮可的平a时间来填充了，这样可以自动计算出他应当填充的固定平a时间，
 * 放进必要时间里面」。
 *
 * 单次技能覆盖 = 发炮动作（exSpecialActionTime 1.484s）+ 能量场持续（1.484s，C1 等比延长）+ 减防尾 3.5s；
 * 剩余缺口 ÷ 3.5s = 需要几发强化子弹；每发 = 狡兔连打 #1（0.194s）。
 */
describe('妮可·减防接力（强化子弹平A 进必要时间）', () => {
  const mkState = (ex: number, ult: number, chain: number) => ({ exSpecialCount: ex, ultimateCount: ult, chainCountTotal: chain } as any)
  const mkCfg = (over: any = {}) => ({
    battleTime: 180,
    exSpecialActionTime: 1.484, ultimateActionTime: 2.4, chainActionTime: 1.0,
    nicolePokeActionTime: 0.194, nicoleEnergyFieldBaseSeconds: 1.484, nicoleC1EnergyFieldScale: 1,
    ...over,
  } as any)

  it('C0：9 次触发（约 59.3s 覆盖）⇒ 补 35 发 = 6.79s', () => {
    const out = nicoleBulletReserve(mkCfg(), mkState(8.167, 1, 0))!
    expect(out).toHaveLength(1)
    expect(out[0]!.moveId).toBe(NICOLE_POKE_MOVE_ID)
    expect(out[0]!.count).toBe(35)
    expect(out[0]!.actionTime).toBeCloseTo(0.194, 6)
    expect(out[0]!.comboAlignRatio, '站场时间，不借合轴抵扣').toBe(0)
  })

  it('C1：能量场 ×1.75（2.596s）⇒ 覆盖更多，补得更少', () => {
    const c0 = nicoleBulletReserve(mkCfg(), mkState(8.167, 1, 0))![0]!.count
    const c1 = nicoleBulletReserve(mkCfg({ nicoleC1EnergyFieldScale: 1 + 1.5 * 0.742 / 1.484 }), mkState(8.167, 1, 0))![0]!.count
    expect(c1, 'C1 能量场更长 ⇒ 需求更少').toBeLessThan(c0)
  })

  it('边界：触发次数 0 ⇒ 不预留（没有上弹就没有强化子弹）', () => {
    expect(nicoleBulletReserve(mkCfg(), mkState(0, 0, 0))).toBeNull()
  })

  it('边界：子弹上限 = 8×触发次数，需求不会超过它', () => {
    // 极端：战斗 10000s 但只触发 1 次 ⇒ 上限 8 发
    const out = nicoleBulletReserve(mkCfg({ battleTime: 10000 }), mkState(1, 0, 0))!
    expect(out[0]!.count).toBe(NICOLE_BULLETS_PER_APPLY)
  })

  it('边界：技能已经盖满 180s ⇒ 不预留', () => {
    // 40 次触发 × 6.47s = 258.8s > 180s
    expect(nicoleBulletReserve(mkCfg(), mkState(40, 0, 0))).toBeNull()
  })
})
