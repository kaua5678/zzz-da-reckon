/**
 * 时光切片（音擎 13002「说茄子」）连携触发回能进迭代循环：
 * - 历史缺口：iterate 内 calcEnergySource 以 chainCountTotal=0 调用，连携触发的回能只在
 *   最终装配的展示明细出现、不参与强特次数推导——「回了能量却不用来推次数」的口径分裂；
 * - 修复后：①iterate 的 totalEnergy 精确包含连携臂能量（手工最小配置，连携次数是唯一变量，
 *   差值 = 连携次数 × 每次回能，精确到无级联）；②真实队伍把回能放大到跨过耗能阈值时，
 *   强特次数必须抬升（能量→次数反馈环接通，端到端）。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { calcTeamResources, clearWarmStartCache } from '@/core/resource'
import { iterate } from '@/core/resource/helpers'
import type { CharacterOperationConfig, IterationState, ResourceCalcConfig } from '@/types/resource'

function deepCopy(cfg: ResourceCalcConfig): ResourceCalcConfig {
  return JSON.parse(JSON.stringify(cfg))
}

/** 手工最小配置：除时光切片触发回能外全零——连携次数是唯一能量变量，无级联污染 */
function minimalTimeSliceConfig(): { configs: CharacterOperationConfig[]; states: IterationState[]; global: ResourceCalcConfig } {
  const configs: CharacterOperationConfig[] = [{
    slot: 0,
    agentId: '0000',
    isFlashUser: false,
    timeWeight: 1,
    panel: { timeSliceEnergyPerTrigger: 10 } as unknown as CharacterOperationConfig['panel'],
    exSpecialEnergyConsume: 60,
    exSpecialActionTime: 0,
    exSpecialComboAlignRatio: 0,
    ultimateCost: 3000,
    ultimateActionTime: 0,
    ultimateComboAlignRatio: 0,
    chainCountPerStun: 1,
    chainActionTime: 0,
    chainComboAlignRatio: 0,
    chainDecibelRecovery: 0,
    dodgeCounterCount: 0,
    dodgeCounterActionTime: 0,
    dodgeCounterComboAlignRatio: 0,
    dodgeCounterDecibelRecovery: 0,
    parryCount: 0,
    parryNoFollowUpCount: 0,
    quickAssistCount: 0,
    assistFollowUpActionTime: 0,
    assistFollowUpComboAlignRatio: 0,
    assistFollowUpDecibelRecovery: 0,
    defensiveAssistActionTime: 0,
    defensiveAssistComboAlignRatio: 0,
    defensiveAssistDecibelRecovery: 0,
    exSpecialDecibelRecovery: 0,
    ultimateDecibelRecovery: 0,
    remielleRainbowEndActionTime: 0,
    remielleRainbowEndComboAlignRatio: 0,
    remielleRainbowEndDecibelRecovery: 0,
    basicAttackRegenPerSec: 0,
    basicAttackDecibelPerSec: 0,
    supportUltimateEnergyRegen: 0,
    decibelShareRatio: 0,
    initialEnergyGift: 0,
    initialDecibelGift: 0,
    exSpecialCountFloor: true,
  } as unknown as CharacterOperationConfig]
  const states: IterationState[] = [{
    basicAttackTime: 180,
    exSpecialCount: 5,
    ultimateCount: 0,
    chainCountTotal: 0,
    totalEnergy: 0,
    totalDecibel: 0,
    necessaryTime: 0,
    frontlineTime: 180,
    backstageTime: 0,
    comboAlignTime: 0,
  }]
  return { configs, states, global: { totalTime: 180, stunCount: 0, shieldCount: 0, energyShieldCount: 0, characters: configs } as ResourceCalcConfig }
}

describe('时光切片连携触发回能进循环', () => {
  beforeEach(() => {
    clearWarmStartCache()
  })

  it('iterate：连携臂能量精确计入 totalEnergy（stunCount 0→4 差值 = 4 × 每次回能）', () => {
    // exSpecialCount=5 → 强特臂 5 次触发是常量；stunCount 只改连携臂（4 次失衡 × 1 连携/次）
    const withStun = minimalTimeSliceConfig()
    withStun.global.stunCount = 4
    const noStun = minimalTimeSliceConfig()

    const a = iterate(withStun.configs, withStun.states, withStun.global)[0]
    const b = iterate(noStun.configs, noStun.states, noStun.global)[0]

    expect(a.totalEnergy - b.totalEnergy).toBeCloseTo(4 * 10, 10)
    // 能量确实驱动次数：连携臂 400 能量跨过 60 耗能阈值 → 次数抬升。次数差还含
    // 「次数→时光切片强特臂触发→能量」的自反馈（每多 1 次强特回 100），非线性放大，
    // 因此锁实测值（8→15）而非 floor(400/60)：差值 = 7 = floor(400/60) + 反馈增量 1。
    const big = minimalTimeSliceConfig()
    big.configs[0].panel = { timeSliceEnergyPerTrigger: 100 } as unknown as CharacterOperationConfig['panel']
    big.global.stunCount = 4
    const bigNo = minimalTimeSliceConfig()
    bigNo.configs[0].panel = { timeSliceEnergyPerTrigger: 100 } as unknown as CharacterOperationConfig['panel']
    const c = iterate(big.configs, big.states, big.global)[0]
    const d = iterate(bigNo.configs, bigNo.states, bigNo.global)[0]
    expect(c.totalEnergy - d.totalEnergy).toBeCloseTo(4 * 100, 10)
    expect(c.exSpecialCount).toBe(15)
    expect(d.exSpecialCount).toBe(8)
    expect(c.exSpecialCount - d.exSpecialCount).toBe(7)
  })

  it('因果性（端到端）：苍角装时光切片，连携回能放大到 100/次时强特次数必须抬升', async () => {
    await setupHarness([
      { agentId: '1131', wEngineId: '13002' },
      { agentId: '1141' },
      { agentId: '1451' },
    ])
    const calc = useResourceCalc()
    const base = deepCopy(calc.resourceConfig.value!)
    // 音擎效果已进面板（支援角色满足装备需求；精修 1 级 → 0.7 能量/触发）
    expect(base.characters[0].panel.timeSliceEnergyPerTrigger).toBeGreaterThan(0)

    const baseline = calcTeamResources({ ...deepCopy(base), stunCount: 4 })
    const boosted = deepCopy(base)
    boosted.characters[0].panel.timeSliceEnergyPerTrigger = 100
    const amplified = calcTeamResources({ ...boosted, stunCount: 4 })

    const baseCount = baseline.characters[0].exSpecialCount
    const boostCount = amplified.characters[0].exSpecialCount
    expect(boostCount, `强特次数未随回能抬升（${baseCount} → ${boostCount}），能量→次数反馈环断链`).toBeGreaterThan(baseCount)
  })
})
