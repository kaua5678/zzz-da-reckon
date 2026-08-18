import { describe, expect, it } from 'vitest'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import { calcDecibelSource } from '@/core/resource/helpers'
import { emptyPanel } from '@/core/panel'
import { computeYidhariHpSource } from '@/mechanics/agents/yidhari'
import { nekomataMechanic } from '@/mechanics/agents/nekomata'
import type { CharacterOperationConfig, IterationState } from '@/types/resource'

describe('spec resource interpreter', () => {
  it('computes Velina Floria gain and broad cyclone spend from spec', () => {
    const spec = getAgentSpec('1561')!
    const cfg = { exSpecialEnergyConsume: 45 } as unknown as CharacterOperationConfig
    const state = { exSpecialCount: 1 } as unknown as IterationState

    const floria = computeSpecResources(spec, cfg, state).get('velina_floria')!

    expect(floria.initialValue).toBe(45)
    expect(floria.totalGain).toBe(45)
    expect(floria.total).toBe(90)
    expect(floria.spendCounts['floria_broad_cyclone']).toBe(1)
    expect(floria.remaining).toBe(0)
  })

  it('keeps remaining Floria after one broad cyclone', () => {
    const spec = getAgentSpec('1561')!
    const cfg = { exSpecialEnergyConsume: 45 } as unknown as CharacterOperationConfig
    const state = { exSpecialCount: 2 } as unknown as IterationState

    const floria = computeSpecResources(spec, cfg, state).get('velina_floria')!

    expect(floria.total).toBe(135)
    expect(floria.spendCounts['floria_broad_cyclone']).toBe(1)
    expect(floria.remaining).toBe(45)
  })

  it('computes Alice sword will with feedback and cinema 2 bonus sparks', () => {
    const spec = getAgentSpec('1401')!
    const cfg = {
      aliceInitialSwordWill: 300,
      aliceSwordWillPerSec: 10,
      aliceExSpecialSwordWill: 50,
      alicePolarityAssaultSwordWill: 10,
      aliceTeamAssaultSwordWill: 10,
      aliceDisorderSwordWill: 30,
      aliceCinema2UltSpark: true,
    } as unknown as CharacterOperationConfig
    const state = {
      basicAttackTime: 30,
      exSpecialCount: 1,
      ultimateCount: 1,
    } as unknown as IterationState

    const swordWill = computeSpecResources(spec, cfg, state, {
      teamAssaultCount: 2,
      disorderCount: 1,
    }).get('alice_sword_will')!

    expect(swordWill.total).toBe(730)
    expect(swordWill.gains['alice_basic_gain']).toBe(300)
    expect(swordWill.gains['alice_polarity_feedback']).toBe(30)
    expect(swordWill.bonusCount).toBe(1)
    expect(swordWill.spendCounts['final_spark']).toBe(3)
    expect(swordWill.remaining).toBe(0)
  })

  it('computes Nekomata purr gain without global cap', () => {
    const spec = getAgentSpec('1021')!
    const cfg = {} as unknown as CharacterOperationConfig
    const state = {
      frontlineTime: 30,
      exSpecialCount: 2,
      ultimateCount: 1,
      chainCountTotal: 5,
    } as unknown as IterationState

    const purr = computeSpecResources(spec, cfg, state).get('nekomata_purr')!

    expect(purr.initialValue).toBe(40)
    expect(purr.gains['nekomata_frontline_gain']).toBe(30)
    expect(purr.gains['nekomata_ultimate_gain']).toBe(20)
    expect(purr.gains['nekomata_chain_gain']).toBe(50)
    expect(purr.gains['nekomata_ex_gain']).toBe(10)
    expect(purr.total).toBe(150)
    expect(purr.spendCounts['nekomata_tail_loss']).toBe(5)
    expect(purr.spendCounts['nekomata_nail_pierce']).toBe(3)
    expect(purr.remaining).toBe(150)
  })

  it('applies adjustable conversion rate to approximate spec gains', () => {
    const spec = getAgentSpec('1021')!
    const cfg = {
      'setting:1021.nekomata_purr.nekomata_frontline_gain.rate': 2,
    } as unknown as CharacterOperationConfig
    const state = {
      frontlineTime: 10,
      exSpecialCount: 0,
      ultimateCount: 0,
      chainCountTotal: 0,
    } as unknown as IterationState

    const purr = computeSpecResources(spec, cfg, state).get('nekomata_purr')!
    expect(purr.gains['nekomata_frontline_gain']).toBe(20)
  })

  it('splits Nekomata purr energy between tail loss and nail pierce by default share', () => {
    const cfg = {} as unknown as CharacterOperationConfig
    const state = {
      frontlineTime: 30,
      exSpecialCount: 2,
      ultimateCount: 1,
      chainCountTotal: 5,
    } as unknown as IterationState
    const result = nekomataMechanic.buildResourceResult?.({ cfg, state } as any) as { specResources: Record<string, any> }
    const purr = result?.specResources?.['nekomata_purr']
    expect(purr.total).toBe(150)
    expect(purr.spendCounts['nekomata_tail_loss']).toBe(2)
    expect(purr.spendCounts['nekomata_nail_pierce']).toBe(1)
  })

  it('adds extra decibel per ultimate from Jufufu extra ability', () => {
    const cfg = {
      initialDecibelGift: 0,
      extraSelfDecibelReward: 0,
      extraSelfDecibelPerUltimate: 300,
      panel: emptyPanel(),
      basicAttackDecibelPerSec: 0,
      exSpecialDecibelRecovery: 0,
      ultimateDecibelRecovery: 0,
      chainDecibelRecovery: 0,
      dodgeCounterDecibelRecovery: 0,
      defensiveAssistDecibelRecovery: 0,
      assistFollowUpDecibelRecovery: 0,
      remielleRainbowEndDecibelRecovery: 0,
      quickAssistCount: 0,
      dodgeCounterCount: 0,
      parryCount: 0,
    } as unknown as CharacterOperationConfig
    const state = { ultimateCount: 2, basicAttackTime: 0, exSpecialCount: 0 } as unknown as IterationState

    const source = calcDecibelSource(cfg, state, 0)
    expect(source.unshareableBonus).toBe(600)
    expect(source.total).toBe(600)
  })

  it('computes Yidhari HP burn decibel (75% 开局 + 回血) and wires it into decibel source', () => {
    const srcCfg = {
      yidhariChargeSlam: { id: '1051007', damage: 692.4, daze: 427.2, anomaly: 258.33, actionTime: 1.2917, decibel: 34.815, flash: 6.317 },
      yidhariBasicFollow: { id: '1051003', damage: 415.7, daze: 256.3, anomaly: 155, actionTime: 1.55, decibel: 20.9, flash: 6.2 },
      yidhariStunCount: 1,
      yidhariExPerStun: 2,
      yidhariExternalHealPct: 0,
    } as unknown as Record<string, unknown>
    const state = { basicAttackTime: 4, exSpecialCount: 4, ultimateCount: 0 } as unknown as IterationState
    const source = computeYidhariHpSource(srcCfg, state, false)
    expect(source.exSpecialEnergyCost).toBe(60)
    expect(source.chargeCycles).toBe(1)
    // 新模型：总烧血 = 75(开局场外) + 回血(4×33×0.75 + 1×10) = 75 + 109 = 184
    expect(source.hpBurnPct).toBeCloseTo(184, 1)
    expect(source.inStunExCount).toBe(2)
    expect(source.outStunExCount).toBe(2)
    expect(source.hpHealPct).toBeCloseTo(109, 1)
    expect(source.exHealMissingHpPct).toBe(0.75)
    expect(source.burnDecibel).toBeCloseTo(1840, 0) // 184% × 10

    // 喧响池接线：calcDecibelSource 直接算烧血喧响（不再走 extraSelfDecibelPerBasicSecond）
    const decibelState = { basicAttackTime: 4, exSpecialCount: 4, ultimateCount: 0 } as unknown as IterationState
    const cfg = {
      agentId: '1051',
      initialDecibelGift: 0,
      extraSelfDecibelReward: 0,
      extraSelfDecibelPerUltimate: 0,
      yidhariExHealMissingHpPct: 0.75,
      yidhariDecibelPerHpPct: 10,
      yidhariExternalHealPct: 0,
      yidhariChargeSlam: { actionTime: 1.2917 },
      yidhariBasicFollow: { actionTime: 1.55 },
      panel: emptyPanel(),
      basicAttackDecibelPerSec: 0,
      exSpecialDecibelRecovery: 0,
      ultimateDecibelRecovery: 0,
      chainDecibelRecovery: 0,
      dodgeCounterDecibelRecovery: 0,
      defensiveAssistDecibelRecovery: 0,
      assistFollowUpDecibelRecovery: 0,
      remielleRainbowEndDecibelRecovery: 0,
      quickAssistCount: 0,
      dodgeCounterCount: 0,
      parryCount: 0,
    } as unknown as CharacterOperationConfig
    const decibel = calcDecibelSource(cfg, decibelState, 0)
    expect(decibel.yidhariBurnDecibel).toBeCloseTo(1840, 0)
    expect(decibel.unshareableBonus).toBeCloseTo(1840, 0)
  })

  it('wires Lucia healing per ult + C4 curtain decibel into decibel source', () => {
    // 伊德海莉：卢西娅星光汇聚之地按终结技次数结算（每次大 12.8% × 覆盖率 50% × 生命比 1.0 = 6.4%/大）
    const cfg = {
      agentId: '1051',
      initialDecibelGift: 0,
      extraSelfDecibelReward: 0,
      extraSelfDecibelPerUltimate: 0,
      yidhariExHealMissingHpPct: 0.75,
      yidhariDecibelPerHpPct: 10,
      yidhariExternalHealPct: 0,
      yidhariExternalHealPerUltPct: 6.4,
      yidhariChargeSlam: { actionTime: 1.2917 },
      yidhariBasicFollow: { actionTime: 1.55 },
      panel: emptyPanel(),
      basicAttackDecibelPerSec: 0,
      exSpecialDecibelRecovery: 0,
      ultimateDecibelRecovery: 0,
      chainDecibelRecovery: 0,
      dodgeCounterDecibelRecovery: 0,
      defensiveAssistDecibelRecovery: 0,
      assistFollowUpDecibelRecovery: 0,
      remielleRainbowEndDecibelRecovery: 0,
      quickAssistCount: 0,
      dodgeCounterCount: 0,
      parryCount: 0,
    } as unknown as CharacterOperationConfig
    const decibelState = { basicAttackTime: 0, exSpecialCount: 0, ultimateCount: 0 } as unknown as IterationState
    // 收敛后 cfg.yidhariExternalHealPct 已按卢西娅最终大招次数（2）折算：2 × 6.4 = 12.8%
    cfg.yidhariExternalHealPct = 12.8
    const decibel = calcDecibelSource(cfg, decibelState, 0)
    expect(decibel.yidhariBurnDecibel).toBeCloseTo((75 + 12.8) * 10, 1)
    // 卢西娅4命：8 次帷幕触发 × 100 → 全队每人 +800 喧响（不可分享）
    const c4Decibel = calcDecibelSource(cfg, decibelState, 0, 0, 180, 800)
    expect(c4Decibel.unshareableBonus).toBeCloseTo((75 + 12.8) * 10 + 800, 1)
  })
})
