import { describe, expect, it } from 'vitest'
import {
  computeLuciaDreamPlan,
  computeLuciaCurtainTriggers,
  computeLuciaHealPctPerUlt,
  luciaElowenMechanic,
} from '@/mechanics/agents/luciaElowen'
import { emptyPanel } from '@/core/panel'
import { applySpecAttributeConversions } from '@/specs/runtime'
import { getAgentSpec } from '@/specs/registry'
import { calcTeamResources } from '@/core/resource'
import type { CharacterOperationConfig, ResourceCalcConfig } from '@/types/resource'

function teamCfg(agentId: string, extra: Record<string, unknown> = {}): CharacterOperationConfig {
  return {
    slot: 0,
    agentId,
    isFlashUser: false,
    panel: emptyPanel(),
    basicAttackRegenPerSec: 0,
    basicAttackDecibelPerSec: 0,
    remielleRainbowEndMoveId: '',
    remielleRainbowEndActionTime: 0,
    remielleRainbowEndDecibelRecovery: 0,
    remielleRainbowEndComboAlignRatio: 0,
    exSpecialMoveId: 'ex1',
    exSpecialEnergyConsume: 60,
    exSpecialActionTime: 2,
    exSpecialDecibelRecovery: 0,
    ultimateMoveId: 'ult1',
    ultimateCost: 3000,
    ultimateActionTime: 2,
    ultimateDecibelRecovery: 0,
    chainMoveId: 'chain1',
    chainActionTime: 2,
    chainDecibelRecovery: 0,
    chainComboAlignRatio: 0,
    chainCountPerStun: 0,
    exSpecialComboAlignRatio: 0,
    ultimateComboAlignRatio: 0,
    parryCount: 0,
    dodgeCounterCount: 0,
    quickAssistCount: 0,
    dodgeCounterMoveId: 'dodge1',
    dodgeCounterActionTime: 1,
    dodgeCounterDecibelRecovery: 0,
    dodgeCounterComboAlignRatio: 0,
    defensiveAssistMoveId: 'def1',
    defensiveAssistActionTime: 1,
    defensiveAssistDecibelRecovery: 0,
    defensiveAssistComboAlignRatio: 0,
    assistFollowUpMoveId: 'asst1',
    assistFollowUpActionTime: 1,
    assistFollowUpDecibelRecovery: 0,
    assistFollowUpComboAlignRatio: 0,
    backstageRegenBonus: 0,
    comboAlignRegenBonus: 0,
    initialEnergyGift: 40,
    initialDecibelGift: 1000,
    extraSelfDecibelReward: 0,
    decibelShareRatio: 0.5,
    supportUltimateEnergyRegen: 0,
    isSupport: false,
    timeWeight: 1,
    skipGenericExSpecial: false,
    exSpecialCountFloor: false,
    ...extra,
  } as unknown as CharacterOperationConfig
}

describe('computeLuciaDreamPlan', () => {
  it('Q=2 时按用户口径 A5×3、E×2 达到 500 梦境值', () => {
    const plan = computeLuciaDreamPlan(5, 2, 20)
    expect(plan.dreamExSpecialCount).toBe(2)
    expect(plan.excessExSpecialCount).toBe(3)
    expect(plan.a5Count).toBe(3)
    expect(plan.dreamTotal).toBe(500)
    expect(plan.additionalAttackCount).toBe(20)
  })

  it('Q 不足（1大）时多打一组 E+A5', () => {
    const plan = computeLuciaDreamPlan(5, 1, 20)
    expect(plan.dreamExSpecialCount).toBe(3)
    expect(plan.a5Count).toBe(4)
    expect(plan.dreamTotal).toBe(500)
    expect(plan.additionalAttackCount).toBe(20)
  })

  it('Q 多了（3大）时少打一组 E+A5', () => {
    const plan = computeLuciaDreamPlan(5, 3, 20)
    expect(plan.dreamExSpecialCount).toBe(1)
    expect(plan.a5Count).toBe(2)
    expect(plan.dreamTotal).toBe(500)
    expect(plan.additionalAttackCount).toBe(20)
  })

  it('Q=4 时只打 1 个 A5 即可', () => {
    const plan = computeLuciaDreamPlan(5, 4, 20)
    expect(plan.dreamExSpecialCount).toBe(0)
    expect(plan.a5Count).toBe(1)
    expect(plan.dreamTotal).toBe(500)
  })

  it('能量不足时 A5 补足；梦境值不足 500 时追加攻击按 25/次 折算', () => {
    const plan = computeLuciaDreamPlan(1, 2, 20)
    // E=1 → base=60+60+200=320，需 A5 补 180 → ceil(4.5)=5
    expect(plan.dreamExSpecialCount).toBe(1)
    expect(plan.a5Count).toBe(5)
    expect(plan.dreamTotal).toBe(60 + 200 + 60 + 200) // 520
    expect(plan.additionalAttackCount).toBe(20)

    const low = computeLuciaDreamPlan(0, 0, 20)
    expect(low.additionalAttackCount).toBe(Math.floor(low.dreamTotal / 25))
  })

  it('追加攻击口径：CD 8s 全球性（队友命中触发），axisInSeconds 不再折算（用户口径 2026-08）', () => {
    // 轴模式 72s 窗口：旧口径 floor(72/8)=9 次已废除；E=7/Q=3 → 梦境 500 → 20 次
    const out = luciaElowenMechanic.buildResourceResult!({
      cfg: { axisInSeconds: 72 } as never,
      state: { exSpecialCount: 7, ultimateCount: 3 } as never,
    } as never)
    expect(out.luciaMechanicSource!.additionalAttackCount).toBe(20)
  })
})

describe('computeLuciaCurtainTriggers（4命帷幕开启/延长）', () => {
  it('默认轴 Q=2/E=2：开启4 + 延长4 = 8 次', () => {
    expect(computeLuciaCurtainTriggers(2, 2, 0)).toBe(8)
  })

  it('伊德海莉大招开帷幕每次 +1', () => {
    expect(computeLuciaCurtainTriggers(2, 2, 2)).toBe(10)
  })

  it('15s CD 封顶 ceil(180/15)=12，利用率滑块折算', () => {
    // Q=10/E=10 → 开启1+0+10 + 延长0+10 = 21 → 封顶 12
    expect(computeLuciaCurtainTriggers(10, 10, 0)).toBe(12)
    expect(computeLuciaCurtainTriggers(10, 10, 0, 0.5)).toBe(6)
  })

  it('Q=0 时只打 E+A5 组：开启2 + 延长4 = 6', () => {
    expect(computeLuciaCurtainTriggers(4, 0, 0)).toBe(6)
  })
})

describe('computeLuciaHealPctPerUlt（星光汇聚之地，终结技等级公式）', () => {
  it('12级 = 8s × 1.6%/s = 12.8%', () => {
    expect(computeLuciaHealPctPerUlt(0)).toBeCloseTo(12.8)
  })

  it('3/5命 skillLevelBonus=4 → 8s × 1.8%/s = 14.4%', () => {
    expect(computeLuciaHealPctPerUlt(4)).toBeCloseTo(14.4)
  })
})

describe('卢西娅6命属性转模', () => {
  it('初始最大生命值 2% → 攻击力（局内小攻击）', () => {
    const panel = emptyPanel()
    panel.hp = 24000
    applySpecAttributeConversions(panel, getAgentSpec('1451')?.attributeConversions ?? [])
    expect(panel.atk).toBeCloseTo(480)

    const panel2 = emptyPanel()
    panel2.hp = 12000
    applySpecAttributeConversions(panel2, getAgentSpec('1451')?.attributeConversions ?? [])
    expect(panel2.atk).toBeCloseTo(240)
  })
})

describe('patchExecutions（[合唱]行专属修正）', () => {
  const baseCfg = {
    agentId: '1451',
    panel: { hp: 20000, skillLevelBonus: 0 },
    exSpecialMoveId: 'ex1',
    ultimateMoveId: 'ult1',
    chainMoveId: 'chain1',
    assistFollowUpMoveId: 'assist1',
  } as any

  function execs(): any[] {
    return [
      { moveId: '1451007', moveName: '追加攻击（合唱）', count: 20, damageMultiplier: 1100 },
      { moveId: 'ex1', moveName: '强特（合唱）', count: 2, damageMultiplier: 2000 },
      { moveId: 'ult1', moveName: '终结技（合唱）', count: 2, damageMultiplier: 3000 },
      { moveId: 'chain1', moveName: '连携（合唱）', count: 0, damageMultiplier: 1000 },
      { moveId: 'assist1', moveName: '支援突击（合唱）', count: 3, damageMultiplier: 500 },
      { moveId: '1451005', moveName: 'A5（随想）', count: 3, damageMultiplier: 400 },
      { moveId: 'dodge1', moveName: '闪避反击（随想）', count: 1, damageMultiplier: 300 },
    ]
  }

  it('6命：全部[合唱]行获得最后一段固定伤害（20000×70%）、15%增伤、必暴+暴伤30%；随想行不补', () => {
    const cfg = { ...baseCfg, luciaCinemaLevel: 6 } as any
    const executions = execs()
    luciaElowenMechanic.patchExecutions?.({ cfg, state: {} as any, executions } as any)

    for (const moveId of ['1451007', 'ex1', 'ult1', 'chain1', 'assist1']) {
      const exec = executions.find(e => e.moveId === moveId)!
      expect(exec.flatDamageBonus).toBeCloseTo(14000)
      expect(exec.dmgBonus).toBe(15)
      expect(exec.critRateBonus).toBe(100)
      expect(exec.critDmgBonus).toBe(30)
    }
    for (const moveId of ['1451005', 'dodge1']) {
      const exec = executions.find(e => e.moveId === moveId)!
      expect(exec.flatDamageBonus ?? 0).toBe(0)
      expect(exec.dmgBonus ?? 0).toBe(0)
      expect(exec.critRateBonus ?? 0).toBe(0)
      expect(exec.critDmgBonus ?? 0).toBe(0)
    }
  })

  it('2命：只有 15% 合唱增伤，无暴击修正', () => {
    const cfg = { ...baseCfg, luciaCinemaLevel: 2 } as any
    const executions = execs()
    luciaElowenMechanic.patchExecutions?.({ cfg, state: {} as any, executions } as any)
    const add = executions.find(e => e.moveId === '1451007')!
    expect(add.dmgBonus).toBe(15)
    expect(add.critRateBonus ?? 0).toBe(0)
    expect(add.critDmgBonus ?? 0).toBe(0)
  })

  it('0命：只有最后一段固定伤害（技能本体），无命座加成', () => {
    const cfg = { ...baseCfg, luciaCinemaLevel: 0 } as any
    const executions = execs()
    luciaElowenMechanic.patchExecutions?.({ cfg, state: {} as any, executions } as any)
    const add = executions.find(e => e.moveId === '1451007')!
    expect(add.flatDamageBonus).toBeCloseTo(14000)
    expect(add.dmgBonus ?? 0).toBe(0)
    expect(add.critRateBonus ?? 0).toBe(0)
  })
})

describe('卢西娅↔伊德海莉 资源池跨角色联动（calcTeamResources 集成）', () => {
  it('4命帷幕喧响全队生效；回血按卢西娅最终终结技次数折算进伊德海莉烧血', () => {
    // 卢西娅：4命开启，7000 初始喧响 → 终结技约 2 次；梦境强特 0（能量不足）→ 触发 = 开局1 + Q退出再入2 + Q延长2 = 5 + 伊德海莉大招次数
    const luciaCfg = teamCfg('1451', {
      slot: 0,
      timeWeight: 0,
      skipGenericExSpecial: true,
      exSpecialCountFloor: true,
      initialDecibelGift: 7000,
      luciaA5ActionTime: 1.887,
      luciaC4DecibelPerTrigger: 100,
      luciaC4CurtainCoverage: 1,
    })
    // 伊德海莉：卢西娅每大回血 12.8% × 覆盖50% × 生命比1.0 = 6.4%/大（外部回血）
    const yidhariCfg = teamCfg('1051', {
      slot: 1,
      yidhariExternalHealPct: 0,
      yidhariExternalHealPerUltPct: 6.4,
      yidhariExHealMissingHpPct: 0.75,
      yidhariDecibelPerHpPct: 10,
      yidhariChargeSlam: { actionTime: 1.2917 },
      yidhariBasicFollow: { actionTime: 1.55 },
    })

    const config: ResourceCalcConfig = {
      totalTime: 180,
      invincibleTime: 0,
      bossStunValue: 100,
      shieldCount: 0,
      energyShieldCount: 0,
      maxIterations: 20,
      stunCount: 0,
      characters: [luciaCfg, yidhariCfg],
    }
    const result = calcTeamResources(config)
    const lucia = result.characters.find(c => c.agentId === '1451')!
    const yidhari = result.characters.find(c => c.agentId === '1051')!

    // 收敛后：外部回血按卢西娅终结技次数（2）折算 = 2 × 6.4 = 12.8%
    expect(yidhariCfg.yidhariExternalHealPct).toBeCloseTo(12.8, 4)
    // 4命触发次数：E=4/Q=2 基础 8 次 + 伊德海莉大招开帷幕（约2）≈ 10，15s CD 封顶 12
    expect(luciaCfg.luciaCurtainTriggerCount).toBeGreaterThanOrEqual(8)
    expect(luciaCfg.luciaCurtainTriggerCount).toBeLessThanOrEqual(12)
    // 卢西娅自己的不可分享喧响 = 4命全队喧响（触发次数 × 100）
    expect(lucia.decibelSource.unshareableBonus).toBeGreaterThanOrEqual(800)
    expect(lucia.decibelSource.unshareableBonus).toBeLessThanOrEqual(1200)
    // 伊德海莉烧血喧响 > 仅开局 75% 的基线（外部回血已计入）
    expect(yidhari.decibelSource.yidhariBurnDecibel).toBeGreaterThan(75 * 10)
    expect(yidhari.decibelSource.yidhariBurnDecibel).toBeGreaterThan((75 + 12.8) * 10)
  })
})
