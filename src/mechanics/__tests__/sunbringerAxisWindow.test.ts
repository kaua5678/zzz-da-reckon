/**
 * 挽昼（1601）**通用失衡轴**与「末位大招伤害全吃易伤」的口径。
 *
 * 用户原话（本文件全部判据的出处，逐字）：
 *  · 「这个轴希望不要限定这队伍，**仅仅通过失衡长度来筛选**行吗。而且辅助也不需要固定知更鸟」
 *  · 「洛克茜这个18s的**多了一个强特**，后面大招也超出了一点，但还是能打的」
 *  · 「v1挽昼**第二段大招在第一秒就会把所有伤害打出来，后面3秒都是后摇**，所以这里大招后摇
 *    放在失衡后面也应当算他所有伤害都吃到失衡易伤了，比如这个16s的失衡轴最后大招超出去了，
 *    但你要算都吃到易伤」
 *
 * ## 判据
 *  T1 **不锁队伍**：只要挽昼在槽 0，任意两个队友都命中同一条预设；辅助换谁不影响「命中」这件事。
 *  T2 **按窗长分支**：≤16s 窗走 16s 轴（不放强特），≥17s 窗走 18s 轴（多一发焚夜·曦生 1601106）。
 *     反空洞：同一支队伍把窗长门挪开 ⇒ 分支必须变化，证明分支真的由窗长决定而不是碰巧。
 *  T3 **末位大招整段吃满易伤**：`inAxisCount === count`，且窗内行是完整一发。
 *  T4 **时间账不动**：大招仍占满 4.083s/发（后摇照占前台）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { stunAxisPresets, resolveStunAxisPlan } from '@/data/stunAxisPresets'
import { calcStunAxis, computeInAxisRatio } from '@/core/stunAxis'
import { calcStunAxisStack } from '@/core/stunAxisStack'
import { SUNBRINGER_ULT_B_DAMAGE_SECONDS, SUNBRINGER_ULT_B_MOVE_ID, sunbringerMechanic } from '@/mechanics/agents/sunbringer'
import { axisMoveDamageSecondsOf } from '@/composables/resourceCalc/helpers'

const ULT_ACTION_TIME = 4.083
const EX_MOVE_ID = '1601106'
const PRESET_ID = 'preset-1601-any-window'

/** 跑一支队，读出窗长 / 命中方案 / 槽0 执行结果 / 末位大招的池行与物化行 */
async function runTeam(agentIds: string[]) {
  await setupHarness(agentIds.map(a => ({ agentId: a })))
  const calc = useResourceCalc()
  const stack = calc.stackTraversalResult.value
  const ultEntry = stack?.executed[`0:${SUNBRINGER_ULT_B_MOVE_ID}`]
  return {
    window: calc.windowDuration.value,
    autoPreset: calc.autoPreset.value,
    planName: calc.matchedPlanName.value,
    exCount: stack?.executed[`0:${EX_MOVE_ID}`]?.count ?? 0,
    ultEntry,
    ultRows: calc.damagePoolRows.value.filter(r => r.moveId === SUNBRINGER_ULT_B_MOVE_ID),
    ultExecRow: calc.resourceResult.value?.characters
      .find(c => c.slot === 0)?.executions.find(e => e.moveId === SUNBRINGER_ULT_B_MOVE_ID),
    /** 资源页（总量口径）两段终结技的次数：与轴栈 executed 对账（T5） */
    execUlts: {
      a: calc.resourceResult.value?.characters.find(c => c.slot === 0)?.executions
        .find(e => e.moveId === '1601111')?.count ?? 0,
      b: calc.resourceResult.value?.characters.find(c => c.slot === 0)?.executions
        .find(e => e.moveId === SUNBRINGER_ULT_B_MOVE_ID)?.count ?? 0,
    },
    stack,
  }
}

describe('T1 不锁队伍：挽昼在槽0 + 任意两个队友都命中同一条轴', () => {
  it('预设 team = [1601, *, *]：辅助换成谁都能命中（不再固定知更鸟）', () => {
    const p = stunAxisPresets.find(x => x.id === PRESET_ID)
    expect(p, '缺挽昼通用轴预设').toBeDefined()
    expect(p!.team).toEqual(['1601', '*', '*'])
    // 旧的两条「按队伍锁死」预设必须已删除（否则同队会命中多条、选中谁取决于文件名序）
    expect(stunAxisPresets.some(x => x.id === 'preset-1601-1101-1661'), '16s 锁队预设应已删除').toBe(false)
    expect(stunAxisPresets.some(x => x.id === 'preset-1601-1621-1661'), '18s 锁队预设应已删除').toBe(false)
  })

  it('★ 真管线：四种辅助组合都命中同一预设（含完全不带延长的组合）', async () => {
    const combos = [
      ['1601', '1101', '1661'], // 珂蕾妲 + 知更鸟（无延长）
      ['1601', '1621', '1661'], // 洛克茜 +2s
      ['1601', '1481', '1661'], // 琉音 +2s
      ['1601', '1451', '1021'], // 卢西娅 + 妮可（都不带延长，且不再是知更鸟）
    ]
    for (const team of combos) {
      const r = await runTeam(team)
      expect(r.autoPreset?.id, `${team.join('-')} 应命中挽昼通用轴`).toBe(PRESET_ID)
      expect(r.planName, `${team.join('-')} 应有命中方案名`).toBeTruthy()
      expect(r.ultEntry, `${team.join('-')} 末位大招应被执行`).toBeDefined()
    }
  }, 180_000)
})

describe('T2 按「失衡窗口长度」分支（不是按队友）', () => {
  it('★ 窗长 16s ⇒ 16s 轴（不放强特）；窗长 18s ⇒ 18s 轴（多一强特）', async () => {
    const r16 = await runTeam(['1601', '1101', '1661'])
    expect(r16.window, '珂蕾妲/知更鸟都不带失衡延长 ⇒ 12 + 4 = 16s').toBeCloseTo(16, 6)
    expect(r16.planName).toContain('16s窗')
    expect(r16.exCount, '16s 窗装不下多发强特 ⇒ 轴里不放 1601106').toBe(0)

    // 洛克茜额外能力「辉金心脏」失衡持续时间 +2 ⇒ 18s
    const r18 = await runTeam(['1601', '1621', '1661'])
    expect(r18.window, '洛克茜 +2s ⇒ 18s').toBeCloseTo(18, 6)
    expect(r18.planName).toContain('18s窗')
    expect(r18.exCount, '18s 轴多一个强特（用户口径逐字）').toBeGreaterThan(0)
  }, 180_000)

  it('★ 换成别的带延长辅助也走 18s 分支（证明判据是窗长不是队友身份）', async () => {
    // 琉音 +2s：队友完全换人，窗长与洛克茜一样是 18s ⇒ 必须选中同一条 18s 轴
    const r = await runTeam(['1601', '1481', '1661'])
    expect(r.window).toBeCloseTo(18, 6)
    expect(r.planName).toContain('18s窗')
    expect(r.exCount).toBeGreaterThan(0)
  }, 180_000)

  it('反空洞：窗长门是真门（把边界挪到 19s ⇒ 18s 队也必须掉回 16s 轴）', () => {
    const p = stunAxisPresets.find(x => x.id === PRESET_ID)!
    const plans = p.plans!
    const base = { stunCount: 3, goodReview: 0 }
    // 真实声明：17s 起走 18s 分支
    expect(resolveStunAxisPlan(plans, { ...base, windowDuration: 16 })?.plan.name).toContain('16s窗')
    expect(resolveStunAxisPlan(plans, { ...base, windowDuration: 18 })?.plan.name).toContain('18s窗')
    // 把门抬到 19s ⇒ 同样 18s 的队必须掉回 16s 轴（说明分支读的是窗长，不是队伍/名字）
    const raised = plans.map(pl => (pl.when?.windowMin !== undefined
      ? { ...pl, when: { ...pl.when, windowMin: 19 } }
      : pl))
    expect(resolveStunAxisPlan(raised, { ...base, windowDuration: 18 })?.plan.name).toContain('16s窗')
    // 没给窗长 ⇒ 声明了窗长门的方案不命中（不猜）
    expect(resolveStunAxisPlan(plans, base)?.plan.name).toContain('16s窗')
  })
})

describe('T3 末位大招：伤害整段吃满失衡易伤', () => {
  it('★ 16s 轴：大招 12.9s 起手（名义 16.98s 出窗），轴内那一发仍 inAxisCount === count = 1', async () => {
    const r = await runTeam(['1601', '1101', '1661'])
    const ult = r.ultEntry!
    expect(ult, '16s 轴里末位大招没被执行').toBeDefined()
    // 2026-10-31：二段由愿核购买后，轴内次数 = 总量次数（修前被 3000×2 喧响截成 1 发）。
    // 只断言「整数、且与总量同源」，不写死 1 —— 喧响供给变化时这条判据仍然有判别力。
    expect(ult.count, '施放次数恒为整数').toBe(r.execUlts.b)
    expect(Number.isInteger(ult.count), '施放次数恒为整数').toBe(true)
    expect(ult.inAxisCount, '伤害段（1s）完整在窗内 ⇒ 整次吃满易伤').toBeCloseTo(ult.count, 9)
    const inSum = r.ultRows.filter(row => (row.stunCoverage ?? 0) > 0).reduce((a, row) => a + row.count, 0)
    expect(inSum, '窗内吃易伤的份数应等于轴内认领的整发').toBeCloseTo(ult.count, 6)
  }, 180_000)

  it('★ 18s 轴（多一个强特、大招 15.4s 起手）：轴内那一发同样整次吃满', async () => {
    const r = await runTeam(['1601', '1621', '1661'])
    const ult = r.ultEntry!
    expect(ult).toBeDefined()
    expect(ult.inAxisCount).toBeCloseTo(ult.count, 9)
    const inSum = r.ultRows.filter(row => (row.stunCoverage ?? 0) > 0).reduce((a, row) => a + row.count, 0)
    expect(inSum).toBeCloseTo(ult.count, 6)
  }, 180_000)

  it('反空洞：按动作全长折算时同一位置只剩 0.76 / 0.64（判据有判别力）', () => {
    expect(computeInAxisRatio(12.9, ULT_ACTION_TIME, 16)).toBeCloseTo(0.7592, 3)
    expect(computeInAxisRatio(15.4, ULT_ACTION_TIME, 18)).toBeCloseTo(0.6368, 3)
    expect(computeInAxisRatio(12.9, SUNBRINGER_ULT_B_DAMAGE_SECONDS, 16)).toBeCloseTo(1, 9)
    expect(computeInAxisRatio(15.4, SUNBRINGER_ULT_B_DAMAGE_SECONDS, 18)).toBeCloseTo(1, 9)
  })

  it('模块声明只在 1601011 上生效（第一段大招 1601111 不认领）', () => {
    const hook = sunbringerMechanic.axisMoveDamageSeconds!
    expect(hook(SUNBRINGER_ULT_B_MOVE_ID, ULT_ACTION_TIME)).toBe(SUNBRINGER_ULT_B_DAMAGE_SECONDS)
    expect(hook('1601111', 2.883), '第一段大招没有「伤害前置」的原文').toBeUndefined()
    expect(hook('1601006', 2.433)).toBeUndefined()
  })
})

describe('T4 时间账不动：后摇照占前台，只有易伤折算换成伤害段', () => {
  it('★ 16s 轴：大招每发仍占 4.083s 前台（后摇没被抹掉）', async () => {
    const r = await runTeam(['1601', '1101', '1661'])
    const row = r.ultExecRow
    expect(row, '大招执行行缺失').toBeDefined()
    expect(row!.actionTime).toBeCloseTo(ULT_ACTION_TIME, 3)
    expect(row!.totalTime).toBeCloseTo(row!.count * ULT_ACTION_TIME, 3)
  }, 180_000)

  it('★ 引擎原语：perActionDamageSeconds 只改 inAxisUnits，不改轴时长', () => {
    const base = {
      axes: [{
        name: 't', count: 1,
        actions: [{ slot: 0, moveId: 'U', count: 1, startTime: 12.9 }],
        basicFillerSlot: 0,
      }],
      globalPool: { '0:U': 1 },
      perActionStun: { '0:U': 10 },
      perActionDuration: { '0:U': ULT_ACTION_TIME },
      stunCount: 1,
      windowDuration: 16,
    }
    const naive = calcStunAxis(base)
    const withDamage = calcStunAxis({ ...base, perActionDamageSeconds: { '0:U': 1 } })
    expect(withDamage.axisDetails[0].axisDuration).toBeCloseTo(naive.axisDetails[0].axisDuration, 9)
    expect(naive.allocation['0:U'].inAxisUnits).toBeCloseTo(0.7592, 3)
    expect(withDamage.allocation['0:U'].inAxisUnits).toBeCloseTo(1, 9)
  })
})

describe('T5 二段终结技**不扣喧响**：由 [愿核] 购买（用户口径 2026-10-31）', () => {
  /**
   * 用户逐字：「挽昼失衡轴第二个大招消耗的资源不是喧响，但却说我喧响不够只打了一个。
   * 结果导致总量说2个，失衡轴显示1个。」
   *
   * 判据 = **总量与轴一致**：资源页（总量口径）每个终结技发几次，轴栈就必须执行几次。
   * 修前槽0 喧响 7577 ⇒ 轴里两段各收 3000 ⇒ 只够 1 组，第 2/3 窗两段一起被判 decibel
   * （实测 executed 1/1 vs 执行行 2/2）。
   */
  it('★ 两段终结技在轴内的执行次数 == 资源页（总量）次数', async () => {
    const r = await runTeam(['1601', '1101', '1661'])
    const slot0 = r.execUlts
    const totalA = slot0.a
    const totalB = slot0.b
    expect(totalA, '资源页应打出终结技·此行共赴前路').toBeGreaterThan(0)
    expect(totalB, '资源页应打出终结技·此愿重塑万象').toBeGreaterThan(0)
    const axisA = r.stack?.executed['0:1601111']?.count ?? 0
    const axisB = r.stack?.executed['0:1601011']?.count ?? 0
    expect(axisA, '一段（喧响大）轴内次数必须等于总量').toBe(totalA)
    expect(axisB, '二段（愿核大）轴内次数必须等于总量——修前这里少 1 发').toBe(totalB)
  }, 180_000)

  it('模块声明：只有二段免喧响；一段产 1 愿核、二段耗 1 愿核', () => {
    expect(sunbringerMechanic.axisMoveFreeOfDecibel!('1601011'), '二段由 [愿核] 购买，不是喧响大').toBe(true)
    expect(sunbringerMechanic.axisMoveFreeOfDecibel!('1601111'), '一段仍是真正的喧响大').toBe(false)
    expect(sunbringerMechanic.axisSwayFlow!('1601111')).toEqual({ produce: 1 })
    expect(sunbringerMechanic.axisSwayFlow!('1601011')).toEqual({ cost: 1 })
    expect(sunbringerMechanic.axisSwayFlow!('1601006')).toBeUndefined()
  })

  it('反空洞：没有一段产出 ⇒ 二段照样跳过（不是无条件免单）', () => {
    const base = {
      axes: [{
        count: 1,
        actions: [{ slot: 0, moveId: '1601011', count: 1, actionTime: 4.083, energyCost: 0, decibelCost: 0, swayCost: 1 }],
        basicFillerSlot: 0,
      }],
      stunCount: 1,
      windowDuration: 16,
    }
    const noWishCore = calcStunAxisStack(base)
    expect(noWishCore.executed['0:1601011'], '无愿核时二段不得执行').toBeUndefined()
    expect(noWishCore.skipped.some(s => s.moveId === '1601011' && s.reason === 'sway')).toBe(true)
    // 一段执行时回补 1 点 ⇒ 二段可执行（同一本账、跨块累积）
    const withProduce = calcStunAxisStack({
      ...base,
      axes: [{
        count: 1,
        actions: [
          { slot: 0, moveId: '1601111', count: 1, actionTime: 2.883, energyCost: 0, decibelCost: 0, producesSway: 1 },
          { slot: 0, moveId: '1601011', count: 1, actionTime: 4.083, energyCost: 0, decibelCost: 0, swayCost: 1 },
        ],
        basicFillerSlot: 0,
      }],
    })
    expect(withProduce.executed['0:1601011']?.count ?? 0).toBe(1)
  })
})

describe('派发器边界：axisMoveDamageSecondsOf 的退化区间一律视作「未声明」', () => {
  it('≤0 / ≥动作全长 / 非有限数 ⇒ undefined；未实现该钩子的角色 ⇒ undefined', () => {
    const mech = sunbringerMechanic
    const orig = mech.axisMoveDamageSeconds
    try {
      mech.axisMoveDamageSeconds = () => 1
      expect(axisMoveDamageSecondsOf('1601', 'X', ULT_ACTION_TIME)).toBe(1)
      mech.axisMoveDamageSeconds = () => 0
      expect(axisMoveDamageSecondsOf('1601', 'X', ULT_ACTION_TIME)).toBeUndefined()
      mech.axisMoveDamageSeconds = () => ULT_ACTION_TIME
      expect(axisMoveDamageSecondsOf('1601', 'X', ULT_ACTION_TIME)).toBeUndefined()
      mech.axisMoveDamageSeconds = () => Number.NaN
      expect(axisMoveDamageSecondsOf('1601', 'X', ULT_ACTION_TIME)).toBeUndefined()
    } finally {
      if (orig) mech.axisMoveDamageSeconds = orig
      else delete mech.axisMoveDamageSeconds
    }
    expect(axisMoveDamageSecondsOf('1101', '1101001', 2)).toBeUndefined()
    expect(axisMoveDamageSecondsOf(undefined, '1101001', 2)).toBeUndefined()
  })
})
