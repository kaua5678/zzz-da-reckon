import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import {
  computeOutsideSwordGain,
  computeYeshuguangCycle,
  yeshuguangMechanic,
  YESHUGUANG_FULL_STUN_MOVES,
  veilStunMultiplier,
} from '@/mechanics/agents/yeshuguang'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'physicalDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, defAssistCount: 20,
  quickAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1,
}

async function setup(team: Array<{ agentId: string; cinemaLevel: number }>) {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (let i = 0; i < 3; i++) {
    const t = team[i]
    config.team[i] = { slot: i, agentId: t?.agentId ?? '', cinemaLevel: t?.cinemaLevel ?? 0, ...baseConfig } as any
  }
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

const baseDmg = {
  '1431013': 1783, '1431009': 1209, '1431017': 182,
  '1431018': 2116, '1431019': 2322, '1431027': 6168,
  '1431025': 3850, '1431028': 800,
}
const baseTimes = {
  '1431013': 1.5, '1431009': 1.4, '1431017': 0.325,
  '1431018': 1.967, '1431019': 2.533, '1431027': 0.001,
  '1431025': 1, '1431028': 2.2,
}

describe('叶瞬光 computeYeshuguangCycle', () => {
  it('打满 0命：观止2/轮，飞光=总观止/6 线性；喧响→斩妄', () => {
    const c = computeYeshuguangCycle({
      ultimateCount: 2, giftUltCount: 1, zhaoyingCountSetting: -1,
      outsideSwordGain: 12, cinemaLevel: 0, battleTime: 180, formAxis: 'full',
    })
    expect(c.totalForms).toBe(5)
    expect(c.guanzhiPerForm).toBe(2)
    expect(c.feiguangFullCasts).toBeCloseTo((2 * 5) / 6)
    expect(c.miePerForm).toBe(2)
    expect(c.jiPerForm).toBe(2)
    expect(c.finisherZhanwang).toBe(2)
    expect(c.finisherGuichen).toBe(3)
  })

  it('打满 2命：观止8/轮，飞光=8/6 当量', () => {
    const c = computeYeshuguangCycle({
      ultimateCount: 1, giftUltCount: 0, zhaoyingCountSetting: 0,
      outsideSwordGain: 0, cinemaLevel: 2, battleTime: 180, formAxis: 'full',
    })
    expect(c.guanzhiPerForm).toBe(8)
    expect(c.feiguangFullCasts).toBeCloseTo(8 / 6)
  })

  // 用户口径 2026-09-05：短轴**只省时间不省资源**——归尘的触发条件是「青溟剑势耗尽」、
  // 飞光是「持续消耗直至耗尽」，所以一轮不管走哪档轴，6 点青溟剑势都得打光；
  // 省下的灭/极段不是省下的资源，是换成更快的飞光把同一批剑势花掉。
  it('短轴灭极：仍打满 6 点剑势（只省段数不省资源）；0命观止2→飞光2/6；2命观止8→飞光8/6', () => {
    const c0 = computeYeshuguangCycle({
      ultimateCount: 1, giftUltCount: 0, zhaoyingCountSetting: 0,
      outsideSwordGain: 0, cinemaLevel: 0, battleTime: 180, formAxis: 'short_pair',
    })
    expect(c0.miePerForm).toBe(1)
    expect(c0.jiPerForm).toBe(1)
    expect(c0.swordSpentPerForm).toBe(6)
    expect(c0.guanzhiPerForm).toBe(2)
    expect(c0.feiguangFullCasts).toBeCloseTo(2 / 6)
    const c2 = computeYeshuguangCycle({
      ultimateCount: 1, giftUltCount: 0, zhaoyingCountSetting: 0,
      outsideSwordGain: 0, cinemaLevel: 2, battleTime: 180, formAxis: 'short_pair',
    })
    expect(c2.guanzhiPerForm).toBe(8)
    expect(c2.feiguangFullCasts).toBeCloseTo(8 / 6)
  })

  it('短轴仅灭：同样打满 6 点剑势，观止线性飞光', () => {
    const c = computeYeshuguangCycle({
      ultimateCount: 1, giftUltCount: 0, zhaoyingCountSetting: 0,
      outsideSwordGain: 0, cinemaLevel: 0, battleTime: 180, formAxis: 'short_mie',
    })
    expect(c.miePerForm).toBe(1)
    expect(c.jiPerForm).toBe(0)
    expect(c.swordSpentPerForm).toBe(6)
    expect(c.feiguangFullCasts).toBeCloseTo(2 / 6)
  })

  it('三档轴每轮资源消耗相同（短轴只省时间，不省剑势不省观止）', () => {
    for (const cinema of [0, 2, 6]) {
      const per = (axis: 'full' | 'short_pair' | 'short_mie') => computeYeshuguangCycle({
        ultimateCount: 1, giftUltCount: 0, zhaoyingCountSetting: 0,
        outsideSwordGain: 0, cinemaLevel: cinema, battleTime: 180, formAxis: axis,
      })
      const full = per('full')
      expect(per('short_pair').swordSpentPerForm).toBe(full.swordSpentPerForm)
      expect(per('short_mie').swordSpentPerForm).toBe(full.swordSpentPerForm)
      expect(per('short_pair').guanzhiPerForm).toBe(full.guanzhiPerForm)
      expect(per('short_mie').guanzhiPerForm).toBe(full.guanzhiPerForm)
      // 但段数（=时间）确实逐级变少
      expect(full.miePerForm + full.jiPerForm + full.fuyaoPerForm)
        .toBeGreaterThan(per('short_pair').miePerForm + per('short_pair').jiPerForm + per('short_pair').fuyaoPerForm)
      expect(per('short_pair').miePerForm + per('short_pair').jiPerForm + per('short_pair').fuyaoPerForm)
        .toBeGreaterThan(per('short_mie').miePerForm + per('short_mie').jiPerForm + per('short_mie').fuyaoPerForm)
    }
  })

  it('C6 明灯愿：进场2+每轮1，floor/3 归尘改斩妄；附伤=轮次', () => {
    // 3 轮：明灯愿 2+3=5 → upgrade 1；假设 2 归尘+1 斩妄 基础 → 归尘1 斩妄2
    const c = computeYeshuguangCycle({
      ultimateCount: 1, giftUltCount: 1, zhaoyingCountSetting: 0,
      outsideSwordGain: 0, cinemaLevel: 6, battleTime: 180, formAxis: 'full',
    })
    // gift 1 forms? ultimate 1 + gift 1 = 2 forms. mingdeng=2+2=4, upgrade=1
    expect(c.totalForms).toBe(2)
    expect(c.mingdengTotal).toBe(4)
    expect(c.mingdengUpgrade).toBe(1)
    // base zhanwang=1 guichen=1 → after upgrade zhanwang=2 guichen=0
    expect(c.finisherZhanwang).toBe(2)
    expect(c.finisherGuichen).toBe(0)
    expect(c.c6AttachCount).toBe(2)
  })
})

describe('叶瞬光面板', () => {
  beforeEach(() => { newPinia(); mockStaticFetch() })

  it('0→1：伤害+10、减防+20', async () => {
    const { catalog, config } = await setup([{ agentId: '1431', cinemaLevel: 0 }])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 1
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p1.dmgBonus - p0.dmgBonus).toBe(10)
    expect((p1.enemyDefReduction ?? 0) - (p0.enemyDefReduction ?? 0)).toBe(20)
  })

  it('帷幕易伤上限 0命2.1 / 4命3.0', async () => {
    const { catalog, config } = await setup([{ agentId: '1431', cinemaLevel: 0 }])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    expect(computePanelPhases(0, config, catalog)!.inCombat.yeshuguangStunCapMult).toBe(2.1)
    config.team[0].cinemaLevel = 4
    expect(computePanelPhases(0, config, catalog)!.inCombat.yeshuguangStunCapMult).toBe(3.0)
  })
})

describe('叶瞬光 buildExecutions', () => {
  it('打满 1 喧响：灭2 极2 扶摇1；飞光倍率=表×(2/6)，count=1', () => {
    const cfg: any = {
      yeshuguangCinemaLevel: 0, yeshuguangSwordInitial: 0, yeshuguangGiftUltCount: 0,
      yeshuguangMoveDmg: baseDmg, yeshuguangMoveTimes: baseTimes,
      yeshuguangAtk0PerSec: 0, battleTime: 180, dodgeCounterCount: 0,
      'setting:yeshuguang.formAxis': 0,
    }
    const executions: any[] = []
    yeshuguangMechanic.buildExecutions!({
      cfg, state: { ultimateCount: 1, exSpecialCount: 0, basicAttackTime: 0, chainCountTotal: 0 }, executions,
    } as any)
    const cnt = (id: string) => executions.find(e => e.moveId === id)?.count ?? 0
    expect(cnt('1431013')).toBe(2)
    expect(cnt('1431009')).toBe(2)
    expect(cnt('1431017')).toBe(1)
    expect(cnt('1431018')).toBe(1)
    expect(executions.find(e => e.moveId === '1431018').damageMultiplier).toBeCloseTo(2116 * (2 / 6))
    expect(cnt('1431027')).toBe(1)
  })

  it('影画2：飞光/斩妄 moveId 限定 defIgnore +40，其它招不加', () => {
    const cfg: any = {
      yeshuguangCinemaLevel: 2, yeshuguangSwordInitial: 0, yeshuguangGiftUltCount: 0,
      yeshuguangMoveDmg: baseDmg, yeshuguangMoveTimes: baseTimes,
      yeshuguangAtk0PerSec: 0, battleTime: 180, dodgeCounterCount: 0,
      'setting:yeshuguang.formAxis': 0,
    }
    const executions: any[] = [
      { moveId: '1431018', count: 1 },
      { moveId: '1431027', count: 1 },
      { moveId: '1431013', count: 1 },
    ]
    yeshuguangMechanic.patchExecutions!({ cfg, state: {}, executions } as any)
    expect(executions.find(e => e.moveId === '1431018').defIgnore).toBe(40)
    expect(executions.find(e => e.moveId === '1431027').defIgnore).toBe(40)
    expect(executions.find(e => e.moveId === '1431013').defIgnore ?? 0).toBe(0)
  })

  it('短轴灭极 0命：灭1 极1；飞光=2/6 满档当量', () => {
    const cfg: any = {
      yeshuguangCinemaLevel: 0, yeshuguangSwordInitial: 0, yeshuguangGiftUltCount: 0,
      yeshuguangMoveDmg: baseDmg, yeshuguangMoveTimes: baseTimes,
      yeshuguangAtk0PerSec: 0, battleTime: 180, dodgeCounterCount: 0,
      'setting:yeshuguang.formAxis': 1,
    }
    const executions: any[] = []
    yeshuguangMechanic.buildExecutions!({
      cfg, state: { ultimateCount: 1, exSpecialCount: 0, basicAttackTime: 0, chainCountTotal: 0 }, executions,
    } as any)
    const cnt = (id: string) => executions.find(e => e.moveId === id)?.count ?? 0
    expect(cnt('1431013')).toBe(1)
    expect(cnt('1431009')).toBe(1)
    expect(cnt('1431017')).toBe(0)
    expect(cnt('1431018')).toBe(1)
    expect(executions.find(e => e.moveId === '1431018').damageMultiplier).toBeCloseTo(2116 * (2 / 6))
  })

  it('C6：附伤次数=轮次，满易伤集合含附伤 id', () => {
    const cfg: any = {
      yeshuguangCinemaLevel: 6, yeshuguangSwordInitial: 0, yeshuguangGiftUltCount: 0,
      yeshuguangMoveDmg: baseDmg, yeshuguangMoveTimes: baseTimes,
      yeshuguangAtk0PerSec: 0, battleTime: 180, dodgeCounterCount: 0,
      'setting:yeshuguang.formAxis': 0,
    }
    const executions: any[] = []
    yeshuguangMechanic.buildExecutions!({
      cfg, state: { ultimateCount: 2, exSpecialCount: 0, basicAttackTime: 0, chainCountTotal: 0 }, executions,
    } as any)
    const attach = executions.find(e => e.moveId === '1431_c6_finisher_attach')
    expect(attach.count).toBe(2)
    expect(attach.damageMultiplier).toBe(1500)
    expect(YESHUGUANG_FULL_STUN_MOVES.has('1431_c6_finisher_attach')).toBe(true)
  })

  it('estimateExSpecialTime 计入定风波（通用强特）前台时间，不被覆盖丢弃', () => {
    const cfg: any = {
      yeshuguangCinemaLevel: 0, yeshuguangSwordInitial: 0, yeshuguangGiftUltCount: 0,
      yeshuguangMoveDmg: baseDmg, yeshuguangMoveTimes: baseTimes,
      yeshuguangAtk0PerSec: 0, battleTime: 180, dodgeCounterCount: 0,
      exSpecialActionTime: 2.833, // 定风波(1431016)
      'setting:yeshuguang.formAxis': 0,
    }
    const est = yeshuguangMechanic.estimateExSpecialTime!({ cfg, exSpecialCount: 8, ultimateCount: 1 } as any)!
    // 形态内必要时间（灭/极/扶摇/收尾 + 飞光 + 照影）
    const formOnly = 1 * (2 * 1.5 + 2 * 1.4 + 1 * 0.325 + 2.533) + (2 / 6) * 1.967 + 0
    // 必须再计入 8 次定风波 × 2.833s，否则定风波时间丢失、经 timeBudgetExcess 折叠造成必要时间虚高
    expect(est.necessaryTime).toBeCloseTo(formOnly + 8 * 2.833, 6)
  })

  /** 自动选轴的输入样板（默认 auto，起始打满） */
  const autoCfg = (over: Record<string, unknown> = {}): any => ({
    yeshuguangCinemaLevel: 0, yeshuguangSwordInitial: 0, yeshuguangGiftUltCount: 0,
    yeshuguangMoveDmg: baseDmg, yeshuguangMoveTimes: baseTimes,
    yeshuguangAtk0PerSec: 0, battleTime: 180, dodgeCounterCount: 0,
    exSpecialActionTime: 2.833,
    'setting:yeshuguang.formAxis': -1, // 自动
    yeshuguangAutoAxis: 'full',
    ...over,
  })

  it('自动选轴：真实时间压力超阈值时逐级退化并清零旧轴折叠残差', () => {
    const cfg = autoCfg({ timePressureSeconds: 20, timeBudgetExcess: 30 })
    yeshuguangMechanic.estimateExSpecialTime!({ cfg, exSpecialCount: 8, ultimateCount: 1 } as any)!
    expect(cfg.yeshuguangAutoAxis).toBe('short_pair') // 退化一级
    expect(cfg.timeBudgetExcess).toBe(0) // 旧轴残差清零
    // 压力持续 → 再退一级；到底后不再退（short_mie 之后归外层 interactionScale 缩交互）
    cfg.timePressureSeconds = 20
    yeshuguangMechanic.estimateExSpecialTime!({ cfg, exSpecialCount: 8, ultimateCount: 1 } as any)!
    expect(cfg.yeshuguangAutoAxis).toBe('short_mie')
    cfg.timePressureSeconds = 20
    yeshuguangMechanic.estimateExSpecialTime!({ cfg, exSpecialCount: 8, ultimateCount: 1 } as any)!
    expect(cfg.yeshuguangAutoAxis).toBe('short_mie')
  })

  it('回归守卫：虚高的折叠残差不得驱动结构退化（auto 曾被此关掉）', () => {
    // 折叠残差 30s（pass0 平A池满额发放灌进来的、后续再也不会出现的值），
    // 但真实时间压力 = 0（队友占完后她自己的动作装得下）→ 必须保持打满，不退化。
    const cfg = autoCfg({ timeBudgetExcess: 30, timePressureSeconds: 0 })
    yeshuguangMechanic.estimateExSpecialTime!({ cfg, exSpecialCount: 8, ultimateCount: 1 } as any)!
    expect(cfg.yeshuguangAutoAxis).toBe('full')
    expect(cfg.timeBudgetExcess).toBe(30) // 残差不被误清
  })

  it('手动指定轴时自动退化完全不介入', () => {
    for (const manual of [0, 1, 2, 'full', 'short_mie']) {
      const cfg = autoCfg({ 'setting:yeshuguang.formAxis': manual, timePressureSeconds: 999 })
      yeshuguangMechanic.estimateExSpecialTime!({ cfg, exSpecialCount: 8, ultimateCount: 1 } as any)!
      expect(cfg.yeshuguangAutoAxis, `手动=${manual}`).toBe('full') // 未被自动改写
    }
  })
})

describe('局外剑势', () => {
  it('帷幕×3 需额外能力（自动 teamVeilCountTotal 通道）', () => {
    const cfg: any = {
      yeshuguangSwordInitial: 6, yeshuguangAtk0PerSec: 0,
      teamVeilCountTotal: 2, yeshuguangAdditionalAbilityActive: 1, dodgeCounterCount: 0,
    }
    expect(computeOutsideSwordGain(cfg, { basicAttackTime: 0, exSpecialCount: 0, chainCountTotal: 0 })).toBe(12)
  })

  it('手动滑块 >0 优先于自动注入；额外能力未激活时帷幕剑势为 0', () => {
    const manual: any = {
      yeshuguangSwordInitial: 0, yeshuguangAtk0PerSec: 0,
      teamVeilCountTotal: 2, yeshuguangAdditionalAbilityActive: 1, dodgeCounterCount: 0,
      'setting:yeshuguang.teamCurtainCount': 5,
    }
    expect(computeOutsideSwordGain(manual, { basicAttackTime: 0, exSpecialCount: 0, chainCountTotal: 0 })).toBe(15)
    const noAa: any = {
      yeshuguangSwordInitial: 0, yeshuguangAtk0PerSec: 0,
      teamVeilCountTotal: 2, yeshuguangAdditionalAbilityActive: 0, dodgeCounterCount: 0,
    }
    expect(computeOutsideSwordGain(noAa, { basicAttackTime: 0, exSpecialCount: 0, chainCountTotal: 0 })).toBe(0)
  })
  it('定风波每次 +1 剑势（文本）', () => {
    const cfg: any = {
      yeshuguangSwordInitial: 0, yeshuguangAtk0PerSec: 0, yeshuguangAtk0Ex: 0,
      yeshuguangAdditionalAbilityActive: 0, dodgeCounterCount: 0,
    }
    expect(computeOutsideSwordGain(cfg, { basicAttackTime: 0, exSpecialCount: 3, chainCountTotal: 0 })).toBe(3)
  })
})

describe('帷幕易伤封顶（用户 2026-09-01 裁决：吃满基础+易伤buff，再按影画封顶）', () => {
  it('无易伤 buff 时 = boss 基础失衡易伤（帷幕不凭空造易伤）', () => {
    expect(veilStunMultiplier(1.5, 0, 2.1)).toBe(1.5)
  })

  it('易伤 buff 累加进去，恰好到顶时取顶（1.5 + 60% = 2.1）', () => {
    expect(veilStunMultiplier(1.5, 60, 2.1)).toBeCloseTo(2.1, 9)
  })

  it('超过上限被封顶——这正是修复前从未生效的那一刀（旧实现 min(1.5, 2.1) 恒等于 1.5）', () => {
    expect(veilStunMultiplier(1.5, 100, 2.1)).toBe(2.1)
  })

  it('影画4 把顶抬到 300%：同样的 buff 下能吃到 2.5，旧实现里 C4 完全空转', () => {
    expect(veilStunMultiplier(1.5, 100, 3.0)).toBeCloseTo(2.5, 9)
    expect(veilStunMultiplier(1.5, 200, 3.0)).toBe(3.0)
    // C4 相对 C0 必须有增量（空命座回归护栏）
    expect(veilStunMultiplier(1.5, 100, 3.0)).toBeGreaterThan(veilStunMultiplier(1.5, 100, 2.1))
  })

  it('负值与越界不炸', () => {
    expect(veilStunMultiplier(1.5, -50, 2.1)).toBe(1.5)
    expect(veilStunMultiplier(-1, 0, 2.1)).toBe(0)
  })
})
