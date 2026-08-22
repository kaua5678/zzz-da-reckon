/**
 * 青衣（1251）闪络电压计划回归锁。
 *
 * 背景（2026-08 用户报告）：醉花轮数只挂失衡次数、电压缺口由一煞#4 无限补打，
 * 补打的失衡值又推高失衡次数——自激回路曾收敛到 13-15 次失衡 / 26 轮醉花 / 445 次一煞#4 /
 * 必要时间 518s（战斗 180s），把共享前台时间吃光（橘福福行被挤没的观感来源）。
 *
 * 修复口径：轮数 = min(2×失衡, 通用电压覆盖轮 + 时间可行的补电压轮)，
 * 预算 = 战斗时间 − 通用招式必要时间；用户锚点「4 失衡 = 8 轮醉花」在锁 4 失衡时精确成立。
 */
import { describe, expect, it } from 'vitest'
import { computeQingyiSource } from '@/mechanics/agents/qingyi'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

const UNIT_CFG = {
  qingyiStunCount: 13,
  qingyiCinemaLevel: 0,
  battleTime: 180,
  // 一煞#4（1251004）：3.3334 电压/击 × 0.133s ≈ 25 电压/秒，30 击 ≈ 4s 积满一轮
  // —— 电压大头是大招 80/连携 25/闪反 16/强特 22.5（通用电压）
  qingyiLoopRates: {
    yisha4Voltage: 3.3334,
    yisha4ActionTime: 0.133,
    hitsPerRound: 30.0006,
    yisha4TimePerRound: 3.99,
    zuiHuaTimePerRound: 3.42,
  },
  qingyiExSpecialVoltage: 0,
  qingyiUltimateVoltage: 0,
  qingyiChainVoltage: 0,
  qingyiDodgeCounterVoltage: 0,
  qingyiQuickAssistVoltage: 0,
  qingyiAssistFollowUpVoltage: 78,
  parryCount: 10, // 通用电压 10×78 = 780
  dodgeCounterCount: 0,
  quickAssistCount: 0,
  exSpecialActionTime: 2.15,
  ultimateActionTime: 2,
  chainActionTime: 2,
  dodgeCounterActionTime: 1,
  assistFollowUpActionTime: 1,
}

describe('computeQingyiSource · 时间预算截断自激', () => {
  it('失衡 13：轮数被时间预算截断，必要时间 ≤ 战斗时间 − 通用必要时间', () => {
    const src = computeQingyiSource(UNIT_CFG as never, { exSpecialCount: 5, ultimateCount: 4, chainCountTotal: 13 })
    // 通用电压覆盖 7 轮；估算预算 = 180 − (5×2.15 + 4×2 + 13×2 + 10×1) = 125.25s
    // → 补电压整轮（#4 连打 3.99s + 醉花 3.42s ≈ 7.41s/轮）→ extra 13 轮 → 共 20 轮（< 2×13=26 无界目标）
    expect(src.genericVoltage).toBe(780)
    expect(src.rounds).toBe(20)
    expect(src.rounds).toBeLessThan(2 * 13)
    const genericNecessary = 5 * 2.15 + 4 * 2 + 13 * 2 + 10 * 1
    expect(src.necessaryTime).toBeLessThanOrEqual(180 - genericNecessary + 1e-6)
    // 缺口 1220 电压 → 366 击（≈49s，非失控的 445 击 ≈ 430s）
    expect(src.yisha4Hits).toBe(366)
    expect(src.yisha4NecessaryTime).toBeLessThan(60)
  })

  it('电压充足（锁 4 失衡）：8 轮照打，一煞只补几秒', () => {
    const cfg = { ...UNIT_CFG, qingyiStunCount: 4 }
    const src = computeQingyiSource(cfg as never, { exSpecialCount: 5, ultimateCount: 3, chainCountTotal: 4 })
    // 通用 780 ≈ 需求 800 → 6 击 #4（0.8s）补 20 电压，8 轮完整（用户口径：一轮几秒积满）
    expect(src.rounds).toBe(8)
    expect(src.yisha4Hits).toBe(6)
    expect(src.yisha4NecessaryTime).toBeLessThan(2)
    expect(src.necessaryTime).toBeLessThan(45)
  })
})

describe('青衣全管线（时间不溢出 + 橘福福不被挤没）', () => {
  it('默认不锁失衡：一煞弦有界、轮数受预算约束；橘福福招式正常进池', async () => {
    await setupHarness([
      { agentId: '1251', parryCount: 10, defAssistCount: 20 },
      { agentId: '1391' },
      { agentId: '1241', wEngineId: '14124' },
    ])
    const calc = useResourceCalc()
    const qingyi = calc.resourceResult.value!.characters.find(c => c.agentId === '1251')!
    const src = qingyi.qingyiMechanicSource!
    expect(src.rounds).toBeLessThan(2 * (calc.stunPoolResult.value?.stunCount ?? 0) + 1)
    expect(src.yisha4Hits).toBeLessThan(200) // 回归点：曾 445 次 / 430s；时间桶口径调整后稳定在 ~111
    expect(src.necessaryTime).toBeLessThan(150) // 曾 518s；精确值随引擎回能口径浮动
    // 前台 ≤ 180 + 钩子后生成行的已知残差（交互支援行在模块计划之后注入，模块不可见；
    // 精确折叠归引擎时间账本管）——曾 597s
    expect(qingyi.timeAllocation.frontlineTime).toBeLessThanOrEqual(180 + 6)
    // 橘福福招式行与伤害都存在（曾疑似被时间挤压挤没）
    const jufufu = calc.resourceResult.value!.characters.find(c => c.agentId === '1391')!
    expect(jufufu.executions.length).toBeGreaterThan(5)
    expect(calc.damagePoolRows.value.some(r => r.agentId === '1391' && r.totalDamage > 0)).toBe(true)
  })

  it('锁 4 失衡：精确 8 轮醉花 + 一煞只补几秒（用户口径：一轮几秒积满、两轮上 buff 下场）', async () => {
    const { config } = await setupHarness([
      { agentId: '1251', parryCount: 10, defAssistCount: 20 },
      { agentId: '1391' },
      { agentId: '1241', wEngineId: '14124' },
    ])
    config.enemy.stunCountLock = 4
    const calc = useResourceCalc()
    const qingyi = calc.resourceResult.value!.characters.find(c => c.agentId === '1251')!
    const src = qingyi.qingyiMechanicSource!
    expect(src.rounds).toBe(8)
    expect(src.stunCount).toBe(4)
    // 通用电压（大招 80/连携 25/强特 22.5/闪反 16…）覆盖 97.5%，一煞弦只补 2 套 ≈ 6s
    expect(src.yisha4Hits).toBeLessThanOrEqual(10) // 回归点：需 ≤10 才不至于失控（曾 445）；时间桶口径后 ~6
    expect(src.yisha4NecessaryTime).toBeLessThan(10)
    expect(qingyi.timeAllocation.frontlineTime).toBeLessThanOrEqual(180 + 1e-6)
  })
})
