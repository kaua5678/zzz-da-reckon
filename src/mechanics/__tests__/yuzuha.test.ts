import { describe, expect, it } from 'vitest'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import { calcCrossAgentEnergy } from '@/core/resource/helpers'
import {
  YUZUHA_FIREWORK_EXTREME_MOVE_ID,
  YUZUHA_FIREWORK_MOVE_ID,
  YUZUHA_HARD_CANDY_MOVE_ID,
  YUZUHA_C1_ENTER_ENERGY,
  computeYuzuhaMechanic,
  yuzuhaMechanic,
} from '@/mechanics/agents/yuzuha'

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
  it('甜度点：进场3、连携入场+1、上限6（存量口径）；终身预算不钳上限', () => {
    const base = computeYuzuhaMechanic({ initialAtk: 1000, chainEntryCount: 0 })
    expect(base.sweetnessTotal).toBe(3)
    expect(base.sweetnessBudget).toBe(3)

    const some = computeYuzuhaMechanic({ initialAtk: 1000, chainEntryCount: 2 })
    expect(some.sweetnessTotal).toBe(5)

    const capped = computeYuzuhaMechanic({ initialAtk: 1000, chainEntryCount: 10 })
    expect(capped.sweetnessTotal).toBe(6)
    expect(capped.sweetnessCap).toBe(6)
    // 存量钳 6，终身预算钳「花掉再进」不钳
    expect(capped.sweetnessBudget).toBe(13)
  })

  it('狸之愿：40% 初始攻击力（满级lv7口径上限1200）+15% 全队伤害', () => {
    const s = computeYuzuhaMechanic({ initialAtk: 1000, chainEntryCount: 0 })
    expect(s.teamAtkBonus).toBeCloseTo(400, 5)
    expect(s.teamAtkCap).toBe(1200)
    expect(s.teamDmgBonus).toBe(15)

    // 1500×40%=600 未触顶；3000×40%=1200 恰好打满
    expect(computeYuzuhaMechanic({ initialAtk: 1500, chainEntryCount: 0 }).teamAtkBonus).toBe(600)
    expect(computeYuzuhaMechanic({ initialAtk: 3000, chainEntryCount: 0 }).teamAtkBonus).toBe(1200)
    expect(computeYuzuhaMechanic({ initialAtk: 4000, chainEntryCount: 0 }).teamAtkBonus).toBe(1200)
  })

  it('连携入场次数滑块经 buildCharConfig 接线生效（此前硬编码0静默失效）', () => {
    const cfg: any = { 'setting:yuzuha.chainEntryCount': 4 }
    yuzuhaMechanic.buildCharConfig!({ cfg } as any)
    expect(cfg.yuzuhaChainEntryCount).toBe(4)
  })

  it('影画1 进场回30能量并入 initialEnergyGift（勘域180s一次→每局一次；低命座不注入）', () => {
    const cfg: any = { initialEnergyGift: 10 }
    yuzuhaMechanic.buildCharConfig!({ cinemaLevel: 1, cfg } as any)
    expect(cfg.initialEnergyGift).toBe(10 + YUZUHA_C1_ENTER_ENERGY)
    const cfg0: any = { initialEnergyGift: 10 }
    yuzuhaMechanic.buildCharConfig!({ cinemaLevel: 0, cfg: cfg0 } as any)
    expect(cfg0.initialEnergyGift).toBe(10)
  })

  it('终结技队友回能：buildCharConfig 置 supportUltimateEnergyRegen=25，经 calcCrossAgentEnergy 按大招次数给其他角色（不给自身）', () => {
    const cfg: any = {}
    yuzuhaMechanic.buildCharConfig!({ cfg } as any)
    expect(cfg.supportUltimateEnergyRegen).toBe(25)

    const yuzuhaCfg: any = { slot: 0, agentId: '1411', supportUltimateEnergyRegen: 25 }
    const teammateCfg: any = { slot: 1, agentId: '1171' }
    const states = [
      { ultimateCount: 2 }, { ultimateCount: 0 }, { ultimateCount: 0 },
    ] as any
    const teammateGain = calcCrossAgentEnergy(1, [yuzuhaCfg, teammateCfg] as any, states)
    expect(teammateGain.supportUltimateRegen).toBe(50)
    const selfGain = calcCrossAgentEnergy(0, [yuzuhaCfg, teammateCfg] as any, states)
    expect(selfGain.supportUltimateRegen).toBe(0)
  })

  it('硬糖射击：有效时间/CD 取次数，受甜度终身预算钳制；C2 后 CD 8→6秒', () => {
    // 有效 60s：8s CD → 7 次；甜度只有 3 → 钳到 3
    const starved = computeYuzuhaMechanic({ initialAtk: 1000, chainEntryCount: 0, effectiveSeconds: 60 })
    expect(starved.hardCandyCdSeconds).toBe(8)
    expect(starved.hardCandyCount).toBe(3)

    // 甜度充足（进场3+连携5=8）→ CD 主导：60/8=7
    const cdLimited = computeYuzuhaMechanic({ initialAtk: 1000, chainEntryCount: 5, effectiveSeconds: 60 })
    expect(cdLimited.hardCandyCount).toBe(7)

    // C2：CD 6s → 60/6=10，甜度 3+2=5 钳到 5
    const c2 = computeYuzuhaMechanic({ initialAtk: 1000, chainEntryCount: 2, cinemaLevel: 2, effectiveSeconds: 60 })
    expect(c2.hardCandyCdSeconds).toBe(6)
    expect(c2.hardCandyCount).toBe(5)

    // 影画6：招架+1甜度进终身预算
    const c6 = computeYuzuhaMechanic({ initialAtk: 1000, chainEntryCount: 0, cinemaLevel: 6, parryCount: 3, effectiveSeconds: 60 })
    expect(c6.sweetnessFromParry).toBe(3)
    expect(c6.sweetnessBudget).toBe(6)
    expect(c6.hardCandyCount).toBe(6)
  })

  it('彩糖花火：惊吓满覆盖每秒一次；·极 = 硬糖射击 + 夹心硬糖(≈招架) 重击', () => {
    const s = computeYuzuhaMechanic({ initialAtk: 1000, chainEntryCount: 5, cinemaLevel: 6, parryCount: 4, effectiveSeconds: 60 })
    expect(s.fireworkTickCount).toBe(60)
    // 影画6含影画2 → CD 6s：硬糖 = min(60/6=10, 预算 3+5+4=12) = 10；·极 = 10 + 4 = 14
    expect(s.hardCandyCount).toBe(10)
    expect(s.fireworkExtremeCount).toBe(14)
  })

  it('buildExecutions 推硬糖/彩糖/·极后台行；十人十色转积蓄走行级 element', async () => {
    await setupHarness([
      { agentId: '1411', cinemaLevel: 6, parryCount: 3, dodgeCounterCount: 0, quickAssistCount: 0 },
      '', '',
    ])
    const executions: any[] = []
    yuzuhaMechanic.buildExecutions!({
      cfg: {
        yuzuhaChainEntryCount: 0,
        yuzuhaCinemaLevel: 6,
        parryCount: 3,
        panel: { atk: 1000 },
        battleTime: 60,
        invincibleTime: 10,
        yuzuhaTransferElement: 'fire',
      },
      state: {},
      executions,
    } as any)
    // 有效时间 60-10=50：硬糖 min(floor(50/8)=6, 预算 3+3=6)=6；花火 50；·极 6+3=9
    const hardCandy = executions.find(e => e.moveId === YUZUHA_HARD_CANDY_MOVE_ID)
    expect(hardCandy).toBeTruthy()
    expect(hardCandy.count).toBe(6)
    expect(hardCandy.timeBucket).toBe('backstage')
    expect(hardCandy.totalTime).toBe(0)
    expect(hardCandy.element).toBeUndefined() // 硬糖射击积蓄为0，不参与转属

    const firework = executions.find(e => e.moveId === YUZUHA_FIREWORK_MOVE_ID)
    expect(firework!.count).toBe(50)
    expect(firework!.element).toBe('fire') // 十人十色：积蓄转火池

    const extreme = executions.find(e => e.moveId === YUZUHA_FIREWORK_EXTREME_MOVE_ID)
    expect(extreme!.count).toBe(9)
    expect(extreme!.element).toBe('fire')
  })

  it('applyTeamConfig：异常专精队友的属性写入 yuzuhaTransferElement', () => {
    const cfg: any = { slot: 0 }
    const fireAgent = { damageElement: 'fire', specialty: 'anomaly' }
    const stunAgent = { damageElement: 'ice', specialty: 'stun' }
    yuzuhaMechanic.applyTeamConfig!({
      slot: 0,
      characters: [cfg],
      team: [
        { slot: 0, agent: null },
        { slot: 1, agent: fireAgent },
        { slot: 2, agent: stunAgent },
      ],
    } as any)
    expect(cfg.yuzuhaTransferElement).toBe('fire')

    // 无异常队友 → 清空（物理不转）
    yuzuhaMechanic.applyTeamConfig!({
      slot: 0,
      characters: [cfg],
      team: [
        { slot: 0, agent: null },
        { slot: 1, agent: stunAgent },
      ],
    } as any)
    expect(cfg.yuzuhaTransferElement).toBeUndefined()
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

  it('完整计算链：与异常队友（柏妮思1171）同队时转积蓄目标=fire', async () => {
    await setup(0)
    const calc = useResourceCalc()
    const row = calc.resourceResult.value!.characters.find(ch => ch.agentId === '1411')!
    expect(row.yuzuhaMechanicSource!.transferElement).toBe('fire')
    const executions = row.executions.filter(e => e.moveId === YUZUHA_FIREWORK_MOVE_ID || e.moveId === YUZUHA_FIREWORK_EXTREME_MOVE_ID)
    expect(executions.length).toBe(2)
    for (const exec of executions) expect((exec as any).element).toBe('fire')
  })
})
