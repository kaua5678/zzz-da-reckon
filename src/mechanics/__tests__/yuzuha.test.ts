import { describe, expect, it } from 'vitest'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import { YUZUHA_CHARGED_CANNON_MOVE_ID, computeYuzuhaMechanic, yuzuhaMechanic } from '@/mechanics/agents/yuzuha'

async function setup(chainEntryCount?: number) {
  const result = await setupHarness([
    { agentId: '1411', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: '1171', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    '',
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  if (chainEntryCount != null) {
    result.config.setMechanicSetting('yuzuha.chainEntryCount', chainEntryCount)
  }
  return result
}

describe('柚叶（1411）甜度点与狸之愿', () => {
  it('甜度点：进场3、连携入场+1、上限6', () => {
    const base = computeYuzuhaMechanic({ initialAtk: 1000, chainEntryCount: 0, chargedCannonCount: 0 })
    expect(base.sweetnessTotal).toBe(3)

    const some = computeYuzuhaMechanic({ initialAtk: 1000, chainEntryCount: 2, chargedCannonCount: 0 })
    expect(some.sweetnessTotal).toBe(5)

    const capped = computeYuzuhaMechanic({ initialAtk: 1000, chainEntryCount: 10, chargedCannonCount: 0 })
    expect(capped.sweetnessTotal).toBe(6)
    expect(capped.sweetnessCap).toBe(6)
  })

  it('狸之愿：40% 初始攻击力（上限600）+15% 全队伤害', () => {
    const s = computeYuzuhaMechanic({ initialAtk: 1000, chainEntryCount: 0, chargedCannonCount: 0 })
    expect(s.teamAtkBonus).toBeCloseTo(400, 5)
    expect(s.teamDmgBonus).toBe(15)

    const capped = computeYuzuhaMechanic({ initialAtk: 2000, chainEntryCount: 0, chargedCannonCount: 0 })
    expect(capped.teamAtkBonus).toBe(600)
  })

  it('连携入场次数滑块经 buildCharConfig 接线生效（此前硬编码0静默失效）', () => {
    const cfg: any = { 'setting:yuzuha.chainEntryCount': 4 }
    yuzuhaMechanic.buildCharConfig!({ cfg } as any)
    expect(cfg.yuzuhaChainEntryCount).toBe(4)
  })

  it('影画6：招架成功+1甜度、蓄能炮弹逐发结算（0.4s/枚耗1甜度，存量钳制）', () => {
    // C6 + 招架3次：甜度收入 3+3=6（顶上限）；满蓄能 2枚/次 × 3次 = 6 发，恰好吃满存量
    const c6 = computeYuzuhaMechanic({ initialAtk: 1000, chainEntryCount: 0, chargedCannonCount: 0, cinemaLevel: 6, parryCount: 3, chargeSeconds: 0.8 })
    expect(c6.sweetnessFromParry).toBe(3)
    expect(c6.chargedCannonsPerAssist).toBe(2)
    expect(c6.chargedCannonCount).toBe(6)

    // 半蓄能：1枚/次 → 3发
    const half = computeYuzuhaMechanic({ initialAtk: 1000, chainEntryCount: 0, chargedCannonCount: 0, cinemaLevel: 6, parryCount: 3, chargeSeconds: 0.4 })
    expect(half.chargedCannonCount).toBe(3)

    // 非C6：招架不给甜度；无招架则无炮弹
    const c0 = computeYuzuhaMechanic({ initialAtk: 1000, chainEntryCount: 0, chargedCannonCount: 0, cinemaLevel: 0, parryCount: 3, chargeSeconds: 0.8 })
    expect(c0.sweetnessFromParry).toBe(0)
    expect(c0.chargedCannonCount).toBe(0)

    // 存量钳制：甜度只有3时炮弹最多3发
    const starved = computeYuzuhaMechanic({ initialAtk: 1000, chainEntryCount: 0, chargedCannonCount: 0, cinemaLevel: 6, parryCount: 10, chargeSeconds: 0.8 })
    expect(starved.sweetnessTotal).toBe(6)
    expect(starved.chargedCannonCount).toBe(6)
  })

  it('buildExecutions 推蓄能炮弹合成行（300% override 后台行）', async () => {
    await setupHarness([
      { agentId: '1411', cinemaLevel: 6, parryCount: 3, dodgeCounterCount: 0, quickAssistCount: 0 },
      '', '',
    ])
    const executions: any[] = []
    yuzuhaMechanic.buildExecutions!({
      cfg: {
        yuzuhaChainEntryCount: 0,
        yuzuhaChargeSeconds: 0.8,
        yuzuhaCinemaLevel: 6,
        parryCount: 3,
        panel: { atk: 1000 },
      },
      state: {},
      executions,
    } as any)
    const cannon = executions.find(e => e.moveId === YUZUHA_CHARGED_CANNON_MOVE_ID)
    expect(cannon).toBeTruthy()
    expect(cannon.count).toBe(6)
    expect(cannon.damageMultiplier).toBe(300)
    expect(cannon.damageMultiplierOverride).toBe(true)
    expect(cannon.timeBucket).toBe('backstage')
    expect(cannon.totalTime).toBe(0)
  })

  it('完整计算链：滑块值传导到资源账本', async () => {
    await setup(0)
    const calcOff = useResourceCalc()
    const rowOff = calcOff.resourceResult.value!.characters.find(ch => ch.agentId === '1411')!
    expect(rowOff.yuzuhaMechanicSource).toBeTruthy()
    const before = rowOff.yuzuhaMechanicSource!.sweetnessFromChain
    const atkBonus = rowOff.yuzuhaMechanicSource!.teamAtkBonus

    await setup(3)
    const calcOn = useResourceCalc()
    const rowOn = calcOn.resourceResult.value!.characters.find(ch => ch.agentId === '1411')!
    expect(rowOn.yuzuhaMechanicSource!.sweetnessFromChain).toBe(3)
    expect(rowOn.yuzuhaMechanicSource!.sweetnessFromChain).toBeGreaterThan(before as number)
    // 狸之愿攻击拐来自 teammate-buffs derived 条目，不受甜度滑块影响
    expect(rowOn.yuzuhaMechanicSource!.teamAtkBonus).toBeCloseTo(atkBonus as number, 5)
  })
})
