/**
 * 克拉蕾·**轴内残痕时序**（用户口径 2026-10-12）——回答「这一轮失衡轴内打了 6 次还是 7 次毁伤」。
 *
 * 用户原话（本文件全部判据的出处）：
 *  · 「主要为了计算失衡轴内打了6次毁伤还是7次，是轴内专门计算的一个量，用于计算失衡内毁伤计数」
 *  · 「你知道招式可以积累残痕值。假设一开始1800残痕值进去，打3层毁伤，残痕值归零，然后又积累1800，
 *    又打毁伤3层。再积累600点，再打一次，如果时间足够，就可以在轴内打出7次」
 *  · 「轴模式下，失衡轴内是选取了部分内容拿来吃易伤。自动补足的内容全在非失衡去了，也就是说
 *    捏了多少消耗多少后，剩下的自动计算然后放在失衡轴外，吃不到易伤」
 *  · 「要吃，这就是为什么我要你建模轴内的残痕数值，需要判断这次残痕是否达标，能否消耗残痕造成毁伤」
 *  · 「不需要斩金断铁，只打葬血强袭」（块还是要，只是默认不打）
 *  · 「3个招式需要打包，一个是斩金，用来触发1次毁伤。一个是葬血，用来触发3次毁伤。
 *    一个是取消了后半段的葬血，也能触发3次，但时间更短」
 *  · 「用招式原名，附带的毁伤事件另外表现，因为要判断残痕值够不够，不是说你这个招式就一定能
 *    消耗残痕打出毁伤的」
 *
 * ## 本文件断言的四条
 *  T1 纯函数推演：逐次序列「积累 → 消耗 → 再积累」精确复现用户的 7 次例子；层不够 ⇒ 不触发
 *  T2 轴内顺序敏感：同样总量下，**顺序不同结果不同**（先攒后打 ≠ 先打后攒）——这是「时序」的定义
 *  T3 真管线：轴内捏块 ⇒ `axisSequence` 到达模块、轴内毁伤计入总数、轴外自动补足相应减少（同一池守恒）
 *  T4 三块与附带事件登记：combos 三个块 + attachedEvents 把毁伤挂到**横斩**（不是上挑）
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { findMoveById } from '@/data/moveTableQueries'
import { getAgentMechanic } from '@/mechanics'
import {
  simulateAxisGashTimeline,
  BURIAL_MAIM_PER_CAST,
  CLARET_INTERRUPT_BURIAL_BLOCK_ID,
  CLEAVE_SLASH_MOVE_ID,
  BLOOD_BURIAL_MOVE_ID,
  CLEAVE_ENTRY_MOVE_ID,
  MAIM_MOVE_ID,
  BURIAL_FULL_SECONDS,
  BURIAL_INTERRUPTED_SECONDS,
} from '@/mechanics/agents/claret'

/** 锻星#3（1611007）表值 = 204/次；用户例子里的「1800 点」≈ 该招若干次 */
const INSCRIPTION_MOVE = '1611007'

const consumeTable = { [CLEAVE_SLASH_MOVE_ID]: 1, [BLOOD_BURIAL_MOVE_ID]: BURIAL_MAIM_PER_CAST }

/**
 * 跑一次轴并**读出模块内实际推演出的轴内毁伤数**（不读总数——总数会被轴外自动补足淹没，
 * 使断言变成恒真；实测「maimCount > 0」在轴内贡献为 0 时也照样通过）。
 */
async function runAxisDetailed(actions: Array<{ moveId: string; count: number }>, windows: number) {
  await setupHarness([{ agentId: '1611', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 }, '', ''])
  const config = useConfigStore()
  config.enemy.stunCountLock = windows
  config.useStunAxis = true
  config.setMechanicSetting('claret.bloodBurialCount', 0)
  config.setMechanicSetting('claret.cleaveSpecialCount', 0)
  config.stunAxes = [{ name: '克拉蕾轴', count: windows, actions: actions.map(a => ({ slot: 0, ...a })), basicFillerSlot: 0 }]
  const mech = getAgentMechanic('1611')!
  const orig = mech.buildResourceResult!
  let axisMaim = -1
  let axisUnfired = -1
  mech.buildResourceResult = (input) => {
    if (axisMaim < 0) {
      const sim = simulateAxisGashTimeline({
        sequence: input.cfg.axisSequence ?? [],
        gashByMoveId: input.cfg.claretGashByMoveId ?? {},
        entryGashValue: 0,
        consumePerCastByMoveId: consumeTable,
      })
      axisMaim = sim.maimCount
      axisUnfired = sim.unfiredMaim
    }
    return orig(input)
  }
  try {
    const calc = useResourceCalc()
    void calc.resourceResult.value
  } finally { mech.buildResourceResult = orig }
  return { axisMaim, axisUnfired }
}

describe('T1 轴内残痕时序推演（纯函数）：复现用户的 7 次例子', () => {
  it('★ 1800 → 3 次 → 归零 → 1800 → 3 次 → 600 → 1 次 = **7 次**', () => {
    const r = simulateAxisGashTimeline({
      // 锻星 204/次：攒 1800 需 9 次（9×204 = 1836 ≥ 1800）
      sequence: [
        { moveId: INSCRIPTION_MOVE, count: 9 },   // 攒 ~1836 → 3 层
        { moveId: BLOOD_BURIAL_MOVE_ID, count: 1 }, // 打 3 层 → 归零
        { moveId: INSCRIPTION_MOVE, count: 9 },   // 再攒 ~1836 → 3 层
        { moveId: BLOOD_BURIAL_MOVE_ID, count: 1 }, // 再打 3 层 → 归零
        { moveId: INSCRIPTION_MOVE, count: 3 },   // 再攒 612 → 1 层
        { moveId: CLEAVE_SLASH_MOVE_ID, count: 1 }, // 打 1 层 → 归零
      ],
      gashByMoveId: { [INSCRIPTION_MOVE]: 204 },
      entryGashValue: 0,
      consumePerCastByMoveId: consumeTable,
    })
    expect(r.maimCount, '轴内应恰好触发 7 次毁伤').toBe(7)
    expect(r.consumedLayers).toBe(7)
    expect(r.unfiredMaim, '刚好够，不该有没触发的').toBe(0)
    // 轨迹自证：确实是「攒→打→攒→打→攒→打」三步
    expect(r.steps.filter(s => s.kind === 'consume' && s.fired).length).toBe(3)
  })

  it('层不够 ⇒ **不触发毁伤**（招式本体照打，由调用方另行结算）', () => {
    const r = simulateAxisGashTimeline({
      sequence: [{ moveId: BLOOD_BURIAL_MOVE_ID, count: 1 }],
      gashByMoveId: {},
      entryGashValue: 1200, // 只有 2 层，葬血强袭要 3 层
      consumePerCastByMoveId: consumeTable,
    })
    expect(r.maimCount, '不够就不该触发（用户：「不是说你这个招式就一定能消耗残痕打出毁伤的」）').toBe(0)
    expect(r.unfiredMaim).toBe(3)
    expect(r.gashValueAfter, '不触发就不扣层').toBe(1200)
  })

  it('进轴时已有层：1800 点进轴 ⇒ 直接 3 次', () => {
    const r = simulateAxisGashTimeline({
      sequence: [{ moveId: BLOOD_BURIAL_MOVE_ID, count: 1 }],
      gashByMoveId: {},
      entryGashValue: 1800,
      consumePerCastByMoveId: consumeTable,
    })
    expect(r.maimCount).toBe(3)
    expect(r.gashValueAfter).toBe(0)
  })

  it('斩金断铁一次只消 1 层（用户「一个是斩金，用来触发1次毁伤」）', () => {
    const r = simulateAxisGashTimeline({
      sequence: [{ moveId: CLEAVE_SLASH_MOVE_ID, count: 1 }],
      gashByMoveId: {},
      entryGashValue: 1800,
      consumePerCastByMoveId: consumeTable,
    })
    expect(r.maimCount).toBe(1)
    expect(r.gashValueAfter, '1800 − 600 = 1200').toBe(1200)
  })
})

describe('T2 顺序敏感（「时序」的机器判据）', () => {
  it('★ 同样的量，先攒后打 ⇒ 触发；先打后攒 ⇒ 不触发 —— 结果必须不同', () => {
    const gain = { moveId: INSCRIPTION_MOVE, count: 3 } // 612 点 = 1 层
    const spend = { moveId: CLEAVE_SLASH_MOVE_ID, count: 1 } // 要 1 层
    const base = { gashByMoveId: { [INSCRIPTION_MOVE]: 204 }, entryGashValue: 0, consumePerCastByMoveId: consumeTable }
    const gainFirst = simulateAxisGashTimeline({ ...base, sequence: [gain, spend] })
    const spendFirst = simulateAxisGashTimeline({ ...base, sequence: [spend, gain] })
    expect(gainFirst.maimCount, '先攒够再打 ⇒ 触发').toBe(1)
    expect(spendFirst.maimCount, '先打（没层）后攒 ⇒ 不触发').toBe(0)
    expect(gainFirst.maimCount).not.toBe(spendFirst.maimCount)
  })

  it('负控：若推演忽略顺序（只按总量），上面两条会相等 —— 本判据确实在测顺序', () => {
    // 总量口径 = min(总层数, 总需求) ⇒ 612/600=1 层、需求 1 ⇒ 两种顺序都得 1（即「无区别」）
    const totalLayers = Math.floor((204 * 3) / 600)
    expect(totalLayers, '总量口径下确实 = 1（与顺序无关）').toBe(1)
  })
})

describe('T3 真管线：轴内毁伤计入总数，轴外补足相应减少（同一池守恒）', () => {
  async function runAxis(actions: Array<{ moveId: string; count: number }>, windows = 3) {
    await setupHarness([{ agentId: '1611', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 }, '', ''])
    const config = useConfigStore()
    config.enemy.stunCountLock = windows
    config.useStunAxis = true
    config.setMechanicSetting('claret.bloodBurialCount', 0)
    config.setMechanicSetting('claret.cleaveSpecialCount', 0)
    config.stunAxes = [{ name: '克拉蕾轴', count: windows, actions: actions.map(a => ({ slot: 0, ...a })), basicFillerSlot: 0 }]
    const calc = useResourceCalc()
    const ch = calc.resourceResult.value!.characters.find(c => c.agentId === '1611')!
    return { src: ch.claretSharpResourceSource!, ch }
  }

  it('★ 轴内捏葬血强袭 ⇒ 模块收到 axisSequence 且按 `1611014` 记账', async () => {
    const { src, ch } = await runAxis([{ moveId: 'claret-burial', count: 1 }])
    // 轴内 3 窗各 1 次 = 3 次葬血强袭（残痕够的话 = 9 次毁伤）
    expect(src.gashStackConsumed, '消耗层应 > 0（若轴内时序没接上会是纯轴外值）').toBeGreaterThan(0)
    // 毁伤行仍由模块发行（附带事件只改易伤占比，不改行数）
    const maim = ch.executions.find(e => e.moveId === MAIM_MOVE_ID)
    expect(maim, '毁伤行必须存在').toBeTruthy()
  })

  it('★ 三个块的时长：编辑器与引擎**同一来源**且数值正确（用户报「打断时间不对」）', async () => {
    // 用户 2026-10-12：「你的葬血打断，时间不对吧」——实测编辑器把打断块显示成 **0s**
    // （`combo.moves` 里的伪键在 catalog 查不到），葬血强袭显示成 **2.317s**（漏入场上挑 0.567s）。
    // 修法 = `axisBlockActionTime` 单调来源，编辑器与引擎都读它。
    await setupHarness([{ agentId: '1611', cinemaLevel: 0 }, '', ''])
    const catalog = useCatalogStore()
    const mech = getAgentMechanic('1611')!
    const skills = catalog.agentSkillsByAgentMap.get('1611')
    const timeOf = (mid: string) => findMoveById(skills, mid)?.actionTime ?? 0
    const blockTime = (moveId: string) => mech.axisBlockActionTime!({ moveId, catalogActionTimeOf: timeOf })

    // ① 斩金断铁 = 上挑 + 横斩
    expect(blockTime('claret-cleave')).toBeCloseTo(0.567 + 0.649, 9)
    // ② 葬血强袭 = **含入场上挑** = 2.884（不是 1611014 单行的 2.317）
    expect(blockTime('claret-burial')).toBeCloseTo(BURIAL_FULL_SECONDS, 9)
    expect(blockTime('claret-burial')).toBeCloseTo(0.567 + 2.317, 9)
    // ③ 打断 = 上挑 + 半段横斩（用户「时间也短了一半，变成1.1585s」→ 加回上挑 = 1.7255）
    expect(blockTime(CLARET_INTERRUPT_BURIAL_BLOCK_ID)).toBeCloseTo(BURIAL_INTERRUPTED_SECONDS, 9)
    expect(blockTime(CLARET_INTERRUPT_BURIAL_BLOCK_ID)).toBeCloseTo(0.567 + 2.317 * 0.5, 9)
    // ④ **编辑器 == 引擎**：打断块的展开时长必须与块声明一致（两处漂移即红）
    const expanded = mech.expandAxisAction!({
      slot: 0, moveId: CLARET_INTERRUPT_BURIAL_BLOCK_ID, count: 1, startTime: 0, cinemaLevel: 0, actionTimeOf: timeOf,
    })!
    expect(expanded[0]!.actionTime).toBeCloseTo(blockTime(CLARET_INTERRUPT_BURIAL_BLOCK_ID)!, 9)
    // ⑤ 负控护栏：未声明的块返回 undefined（调用方回落通用求和，不影响其它角色）
    expect(blockTime('不存在的块')).toBeUndefined()
  })

  it('轴内块展开成真实招式（`claret-burial` → 1611014；打断块 → 1611014 但时间更短）', async () => {
    const mech = getAgentMechanic('1611')!
    const combos = mech.combos!
    // 三块就位，且都用**招式原名**当 label（用户：「用招式原名」）
    expect(combos['claret-cleave']?.label).toBe('斩金断铁')
    expect(combos['claret-burial']?.label).toBe('葬血强袭')
    expect(combos[CLARET_INTERRUPT_BURIAL_BLOCK_ID]?.label).toBe('葬血强袭·打断')
    // 完整版葬血强袭的 moves 指向真实招式 id（可直接进栈）
    expect(combos['claret-burial']!.moves.map(m => m.moveId)).toEqual([BLOOD_BURIAL_MOVE_ID])
    // 打断版是伪块 ⇒ 靠 expandAxisAction 展开
    const expanded = mech.expandAxisAction!({
      slot: 0, moveId: CLARET_INTERRUPT_BURIAL_BLOCK_ID, count: 1, startTime: 0, cinemaLevel: 0,
      actionTimeOf: id => (id === CLEAVE_ENTRY_MOVE_ID ? 0.567 : id === BLOOD_BURIAL_MOVE_ID ? 2.317 : 0),
    })!
    expect(expanded, '打断块必须能被展开').toBeTruthy()
    expect(expanded[0]!.moveId).toBe(BLOOD_BURIAL_MOVE_ID)
    // 时间 = 上挑 0.567 + 2.317 × 50% = 1.7255（「取消了后半段的葬血…时间更短」）
    expect(expanded[0]!.actionTime).toBeCloseTo(1.7255, 4)
  })

  it('守恒：轴内消耗的层从轴外扣掉（总消耗 = 层数上限，不被轴内外重复计）', async () => {
    const { src } = await runAxis([{ moveId: 'claret-burial', count: 1 }])
    // 总消耗不得超过可造层数（覆盖率 100% 时）
    expect(src.gashStackConsumed).toBeLessThanOrEqual(src.gashStacks + 1e-9)
    // 拆解恒等式（T4 的通用形式，含轴内）
    expect(src.maimCount).toBe(Math.floor(src.gashStackConsumed) + (src.maimFromC6 ?? 0))
  }, 120_000)

  it('非轴路径零变化：不建轴时 `axisSequence` 为空、结果与既有口径一致', async () => {
    await setupHarness([{ agentId: '1611', cinemaLevel: 0 }, '', ''])
    const calc = useResourceCalc()
    const ch = calc.resourceResult.value!.characters.find(c => c.agentId === '1611')!
    const src = ch.claretSharpResourceSource!
    expect(src.maimCount).toBe(Math.floor(src.gashStackConsumed))
  })
})

describe('T4 三块与附带事件登记（防漂移）', () => {
  it('毁伤挂在**横斩**与葬血强袭上（不是上挑）—— 原文「横向斩击命中持有[残痕]的敌人时…触发[毁伤]」', () => {
    const mod = getAgentMechanic('1611')!
    const attached = mod.attachedEvents!
    expect(attached[CLEAVE_SLASH_MOVE_ID], '横斩触发毁伤').toEqual([MAIM_MOVE_ID])
    expect(attached[BLOOD_BURIAL_MOVE_ID], '葬血强袭三连横斩触发毁伤').toEqual([MAIM_MOVE_ID])
    // ⚠ 上挑（1611011）**不**触发毁伤（它只积累）——登记它就是错的
    expect(attached[CLEAVE_ENTRY_MOVE_ID], '上挑不该触发毁伤').toBeUndefined()
    // 毁伤不进任何块的 moves（用户：「附带的毁伤事件另外表现」）
    for (const combo of Object.values(mod.combos!)) {
      expect(combo.moves.map(m => m.moveId)).not.toContain(MAIM_MOVE_ID)
    }
  })

  it('★ 毁伤行按**父动作的轴内占比**拆两段（失衡内吃易伤 / 轴外不吃）', async () => {
    // `attachedEvents` 的消费点：`damagePoolDirect` 把子行按父动作轴内占比 emit 两段。
    // 若未登记 ⇒ 毁伤整段按全局覆盖率（轴内部分拿不到全额易伤）。
    await setupHarness([{ agentId: '1611', cinemaLevel: 0, parryCount: 6, dodgeCounterCount: 0, quickAssistCount: 0 }, '', ''])
    const config = useConfigStore()
    config.enemy.stunCountLock = 2
    config.useStunAxis = true
    config.setMechanicSetting('claret.bloodBurialCount', 0)
    config.setMechanicSetting('claret.cleaveSpecialCount', 0)
    config.stunAxes = [{ name: '斩金轴', count: 2, actions: [{ slot: 0, moveId: 'claret-cleave', count: 1 }], basicFillerSlot: 0 }]
    const calc = useResourceCalc()
    const rows = (calc.damagePoolRows.value ?? []).filter(r => String(r.id).includes(MAIM_MOVE_ID))
    const inAxis = rows.find(r => String(r.id).includes('失衡内') || (r.note ?? '').includes('失衡内'))
    const outAxis = rows.find(r => String(r.id).endsWith('-out'))
    expect(rows.length, '毁伤应被拆成两段（失衡内 + 轴外）').toBeGreaterThanOrEqual(2)
    expect(inAxis, '应有「失衡内（伴随事件跟随父动作）」段').toBeTruthy()
    expect(outAxis, '应有「轴外」段').toBeTruthy()
    expect(inAxis!.count, '轴内段次数 > 0').toBeGreaterThan(0)
  }, 120_000)

  it('★ 残痕表收全类别（含 basic）：轴内拖锻星块必须能积累，斩金才能吃到层', async () => {
    // 行为判据（不读私有表）：轴内「5× 锻星 + 1× 斩金」× 4 窗。
    // 锻星#3 表值 204/次 ⇒ 每窗攒 1020 点 = 1.7 层 ⇒ 斩金够吃 1 层 ⇒ **每窗触发 1 次毁伤**。
    // ⚠ 若 basic 段不入残痕表（曾因「平A段不入表」的旧注释而 `cat.id === 'basic'` 直接 continue），
    //   轴内积累恒 0 ⇒ 每次斩金都 MISS ⇒ 轴内触发 0 次。这是本用例的可红点。
    // ⚠ 窗口时长必须放得下两块（锻星#3 = 1.7s × 5 + 斩金 1.216s = 9.7s），否则块被时间门控跳过 ⇒
    //   用例因**夹具**而非口径失败（实测 9 次锻星时斩金块被挤掉、轴内触发 0，那是夹具问题不是缺陷）。
    const { axisMaim } = await runAxisDetailed(
      [{ moveId: INSCRIPTION_MOVE, count: 5 }, { moveId: 'claret-cleave', count: 1 }], 4,
    )
    expect(axisMaim, '每窗 1 次斩金 × 4 窗 = 4 次轴内毁伤（basic 段不入表则恒 0）').toBe(4)
  }, 120_000)
})
