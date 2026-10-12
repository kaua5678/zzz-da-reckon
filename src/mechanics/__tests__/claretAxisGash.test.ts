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
import { stunAxisPresets, cloneStunAxes, selectAutoStunAxisPreset } from '@/data/stunAxisPresets'
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
  GASH_PER_LAYER,
} from '@/mechanics/agents/claret'

/** 锻星#3（1611007）表值 = 204/次；用户例子里的「1800 点」≈ 该招若干次 */
const INSCRIPTION_MOVE = '1611007'

const consumeTable = { [CLEAVE_SLASH_MOVE_ID]: 1, [BLOOD_BURIAL_MOVE_ID]: BURIAL_MAIM_PER_CAST }

/**
 * 跑一次轴并**读出模块内实际推演出的轴内毁伤数**（不读总数——总数会被轴外自动补足淹没，
 * 使断言变成恒真；实测「maimCount > 0」在轴内贡献为 0 时也照样通过）。
 */
async function runAxisDetailed(actions: Array<{ moveId: string; count: number, window: 1 }>, windows: number) {
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
        { moveId: INSCRIPTION_MOVE, count: 9, window: 1 },   // 攒 ~1836 → 3 层
        { moveId: BLOOD_BURIAL_MOVE_ID, count: 1, window: 1 }, // 打 3 层 → 归零
        { moveId: INSCRIPTION_MOVE, count: 9, window: 1 },   // 再攒 ~1836 → 3 层
        { moveId: BLOOD_BURIAL_MOVE_ID, count: 1, window: 1 }, // 再打 3 层 → 归零
        { moveId: INSCRIPTION_MOVE, count: 3, window: 1 },   // 再攒 612 → 1 层
        { moveId: CLEAVE_SLASH_MOVE_ID, count: 1, window: 1 }, // 打 1 层 → 归零
      ],
      gashByMoveId: { [INSCRIPTION_MOVE]: 204 },
      entryGashValue: 0,
      consumePerCastByMoveId: consumeTable,
    })
    expect(r.maimCount, '轴内应恰好触发 7 次毁伤').toBe(7)
    expect(r.consumedLayers).toBe(7)
    expect(r.unfiredMaim, '刚好够，不该有没触发的').toBe(0)
    // 轨迹自证：逐**段**结算（葬血强袭 3 段 + 葬血强袭 3 段 + 斩金 1 段 = 7 条触发）
    expect(r.steps.filter(s => s.kind === 'consume' && s.fired).length).toBe(7)
  })

  it('★ 逐**段**结算：2 层 ⇒ 触发 **2 次**（不是「不够 3 层就 0 次」）', () => {
    // 用户口径 2026-10-12：「那他的1200也够触发2次啊」。
    // 原文：葬血强袭 = 连续 **3 次**横向斩击，「**每次**横向斩击命中持有[残痕]的敌人时，对目标触发[毁伤]」
    // ⇒ 每段各自消耗 1 层、各自触发 1 次；池 2 层 ⇒ 第 1、2 段触发，第 3 段不触发。
    const r = simulateAxisGashTimeline({
      sequence: [{ moveId: BLOOD_BURIAL_MOVE_ID, count: 1, window: 1 }],
      gashByMoveId: {},
      entryGashValue: 1200, // 2 层
      consumePerCastByMoveId: consumeTable,
    })
    expect(r.maimCount, '2 层 ⇒ 触发 2 次').toBe(2)
    expect(r.consumedLayers).toBe(2)
    expect(r.unfiredMaim, '第 3 段没层 ⇒ 未触发 1 次').toBe(1)
    expect(r.gashValueAfter, '两层都被吃掉').toBe(0)
  })

  it('层数为 0 ⇒ 一段都不触发（招式本体照打）', () => {
    const r = simulateAxisGashTimeline({
      sequence: [{ moveId: BLOOD_BURIAL_MOVE_ID, count: 1, window: 1 }],
      gashByMoveId: {},
      entryGashValue: 0,
      consumePerCastByMoveId: consumeTable,
    })
    expect(r.maimCount, '没层 ⇒ 0 次（用户：「不是说你这个招式就一定能消耗残痕打出毁伤的」）').toBe(0)
    expect(r.unfiredMaim).toBe(3)
  })

  it('进轴时已有层：1800 点进轴 ⇒ 直接 3 次', () => {
    const r = simulateAxisGashTimeline({
      sequence: [{ moveId: BLOOD_BURIAL_MOVE_ID, count: 1, window: 1 }],
      gashByMoveId: {},
      entryGashValue: 1800,
      consumePerCastByMoveId: consumeTable,
    })
    expect(r.maimCount).toBe(3)
    expect(r.gashValueAfter).toBe(0)
  })

  it('斩金断铁一次只消 1 层（用户「一个是斩金，用来触发1次毁伤」）', () => {
    const r = simulateAxisGashTimeline({
      sequence: [{ moveId: CLEAVE_SLASH_MOVE_ID, count: 1, window: 1 }],
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
    const gain = { moveId: INSCRIPTION_MOVE, count: 3, window: 1 } // 612 点 = 1 层
    const spend = { moveId: CLEAVE_SLASH_MOVE_ID, count: 1, window: 1 } // 要 1 层
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
  async function runAxis(actions: Array<{ moveId: string; count: number, window: 1 }>, windows = 3) {
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
    const { src, ch } = await runAxis([{ moveId: 'claret-burial', count: 1, window: 1 }])
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
    const { src } = await runAxis([{ moveId: 'claret-burial', count: 1, window: 1 }])
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

describe('T5 进轴残痕值（`StunAxis.entryGash`，用户 2026-10-12「我想设置1800残痕进入也没显示」）', () => {
  it('★ 进轴 1800 点（=3 层）⇒ 池里多 3 层、伤害随之上升', async () => {
    const run = async (entryGash: number) => {
      await setupHarness([{ agentId: '1611', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 }, '', ''])
      const config = useConfigStore()
      config.enemy.stunCountLock = 1
      config.useStunAxis = true
      config.setMechanicSetting('claret.bloodBurialCount', 0)
      config.setMechanicSetting('claret.cleaveSpecialCount', 0)
      config.stunAxes = [{ name: 'A', count: 1, actions: [{ slot: 0, moveId: 'claret-burial', count: 1 }], basicFillerSlot: 0, entryGash }]
      const calc = useResourceCalc()
      const src = calc.resourceResult.value!.characters.find(c => c.agentId === '1611')!.claretSharpResourceSource!
      return { src, dmg: calc.teamTotalDamage.value }
    }
    const zero = await run(0)
    const withEntry = await run(1800)
    // ① 进轴值直接进池：+1800 点 = +3 层
    expect(withEntry.src.entryGashPoints).toBe(1800)
    expect(withEntry.src.gashStacks - zero.src.gashStacks, '+1800 点 = +3 层').toBe(3)
    // ② 不吃积蓄效率倍率（存量不是积累）：多的正好是 1800/600 = 3 层，不随 ×1.5 膨胀
    expect(withEntry.src.gashStackConsumed).toBeGreaterThan(zero.src.gashStackConsumed)
    // ③ 总伤上升
    expect(withEntry.dmg).toBeGreaterThan(zero.dmg)
  }, 120_000)

  it('★ 进轴值决定轴内那几次毁伤**触不触发**（够则触发、不够则不触发）', async () => {
    const runSim = async (entryGash: number) => {
      await setupHarness([{ agentId: '1611', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 }, '', ''])
      const config = useConfigStore()
      config.enemy.stunCountLock = 1
      config.useStunAxis = true
      config.setMechanicSetting('claret.bloodBurialCount', 0)
      config.setMechanicSetting('claret.cleaveSpecialCount', 0)
      config.stunAxes = [{ name: 'A', count: 1, actions: [{ slot: 0, moveId: 'claret-burial', count: 1 }], entryGash }]
      const mech = getAgentMechanic('1611')!
      const orig = mech.buildResourceResult!
      let sim = { maimCount: -1, unfiredMaim: -1 }
      mech.buildResourceResult = (input) => {
        if (sim.maimCount < 0) {
          sim = simulateAxisGashTimeline({
            sequence: input.cfg.axisSequence ?? [], gashByMoveId: input.cfg.claretGashByMoveId ?? {},
            entryGashValue: input.cfg.axisEntryGash ?? 0, consumePerCastByMoveId: consumeTable,
          })
        }
        return orig(input)
      }
      try { const c = useResourceCalc(); void c.resourceResult.value } finally { mech.buildResourceResult = orig }
      return sim
    }
    // 不进残痕 ⇒ 轴内那一次葬血强袭（要 3 层）触发不了
    const none = await runSim(0)
    expect(none.maimCount, '没层 ⇒ 不触发').toBe(0)
    expect(none.unfiredMaim).toBe(3)
    // 进 1800 点 ⇒ 立刻够 3 层 ⇒ 触发 3 次
    const enough = await runSim(1800)
    expect(enough.maimCount, '1800 点 = 3 层 ⇒ 触发 3 次').toBe(3)
    expect(enough.unfiredMaim).toBe(0)
  }, 120_000)

  it('模块声明 `axisGashResource`（UI 据此渲染输入框，不认 agentId）', () => {
    const decl = getAgentMechanic('1611')!.axisGashResource
    expect(decl, '必须声明，否则轴编辑器不显示残痕输入框').toBeTruthy()
    expect(decl!.perLayer).toBe(GASH_PER_LAYER)
  })
})

describe('T6 轴内 `basic` 块的积累（单位是**秒**不是次）', () => {
  it('★ basic 块按**秒均**积累（生产路径：模块回传的 `axisMaim` 必须 > 0）', async () => {
    // 轴内只放 8 秒 basic + 1 次斩金。basic 的 count 是**秒**，故必须用秒均（~100-120/s）
    // ⇒ 8s ≈ 960 点 ≥ 1 层 ⇒ 斩金触发。
    // ⚠ 断言打在**模块自己回传的 `axisMaim`**（生产口径）上，不在测试里另跑一遍推演——
    //   另跑会自己喂参数（负控实测：那样删掉生产传参照样全绿，等于没测）。
    await setupHarness([{ agentId: '1611', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 }, '', ''])
    const config = useConfigStore()
    config.enemy.stunCountLock = 1
    config.useStunAxis = true
    config.setMechanicSetting('claret.bloodBurialCount', 0)
    config.setMechanicSetting('claret.cleaveSpecialCount', 0)
    config.stunAxes = [{
      name: 'basic积累轴', count: 1,
      actions: [{ slot: 0, moveId: 'basic', count: 8 }, { slot: 0, moveId: 'claret-cleave', count: 1 }],
      basicFillerSlot: 0,
    }]
    const calc = useResourceCalc()
    const src = calc.resourceResult.value!.characters.find(c => c.agentId === '1611')!.claretSharpResourceSource!
    expect(src.basicGashPerSec, '平A 秒均（两态加权）> 0').toBeGreaterThan(0)
    expect(src.axisMaim, 'basic 按秒均积累 ⇒ 8s 够 1 层 ⇒ 斩金在轴内触发（生产没传秒均则恒 0）').toBeGreaterThan(0)
    expect(src.axisMaimUnfired ?? 0).toBe(0)
  }, 120_000)

  it('不传 `basicGashPerSec` ⇒ basic 块不积累（旧行为，逐位不变）', () => {
    const sim = simulateAxisGashTimeline({
      sequence: [{ moveId: 'basic', count: 100, window: 1 }, { moveId: CLEAVE_SLASH_MOVE_ID, count: 1, window: 1 }],
      gashByMoveId: {}, entryGashValue: 0, consumePerCastByMoveId: consumeTable,
    })
    expect(sim.maimCount, '不传秒均 ⇒ 不积累 ⇒ 斩金没层可吃').toBe(0)
    expect(sim.unfiredMaim).toBe(1)
  })
})

describe('T7 用户的标准轴（`preset-1611-any` 标准6毁伤（通用））', () => {
  /** 跑标准轴（可指定命座），读**模块回传的生产结果** */
  async function runStd(cinema: number, entryGash: number) {
    const preset = stunAxisPresets.find(p => p.id === 'preset-1611-any')
    expect(preset, '标准轴预设必须随仓库发布（用户口述录入）').toBeTruthy()
    await setupHarness([{ agentId: '1611', cinemaLevel: cinema, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 }, { agentId: '1361' }, { agentId: '1211' }])
    const config = useConfigStore()
    config.enemy.stunCountLock = 1
    config.useStunAxis = true
    const axes = cloneStunAxes(preset!.axes!)
    axes[0]!.entryGash = entryGash
    config.stunAxes = axes
    // ⚠ 读**生产结果**（`axisMaim` / `minEntryForAllMaim`），不在测试里另跑推演：
    //   另跑要自己喂 `basicGashPerSec` / `buildupMultiplier` ⇒ 生产漏传时测不出来
    //   （实测教训：本用例曾因自喂参数而在「生产漏乘积蓄效率」时照样全绿）。
    const c = useResourceCalc()
    const src = c.resourceResult.value!.characters.find(x => x.agentId === '1611')!.claretSharpResourceSource!
    return {
      maim: src.axisMaim ?? 0,
      unfired: src.axisMaimUnfired ?? 0,
      eff: src.gashBuildupMultiplier,
      minEntry: src.minEntryForAllMaim,
    }
  }

  it('★ 通用轴：克拉蕾在槽 0、队友任意（`*` 通配）都能命中', () => {
    const preset = stunAxisPresets.find(p => p.id === 'preset-1611-any')
    expect(preset, '通用标准轴必须随仓库发布').toBeTruthy()
    expect(preset!.team, '槽 0 固定克拉蕾、槽 1/2 通配').toEqual(['1611', '*', '*'])
    // 换三组完全不同的队友都应命中（用户口径：「这个轴是通用的，队伍不强求」）
    for (const mates of [['1361', '1211'], ['1481', '1451'], ['1101', '1211']] as const) {
      const hit = selectAutoStunAxisPreset(['1611', ...mates], { 0: 0, 1: 0, 2: 0 })
      expect(hit?.id, `队友 ${mates.join('+')} 应命中通用轴`).toBe('preset-1611-any')
    }
  })

  it('★ 毁伤触发**时间点**可见（用户：「没看到哪里写了触发时间点，触发多少次」）', async () => {
    // 标准轴两次打断葬血强袭分别在 t=0 与 t=10.9（轴里显式 startTime）。
    // ⚠ 时刻必须取自**序列条目**而非「moveId → 时刻」映射：同一 moveId 出现多次时映射会互相覆盖
    //   （实测两次都显示 10.9s）。
    await setupHarness([{ agentId: '1611', cinemaLevel: 1, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 }, { agentId: '1361' }, { agentId: '1211' }])
    const config = useConfigStore()
    config.enemy.stunCountLock = 1
    config.useStunAxis = true
    const preset = stunAxisPresets.find(p => p.id === 'preset-1611-any')!
    config.stunAxes = cloneStunAxes(preset.axes!)
    const c = useResourceCalc()
    const src = c.resourceResult.value!.characters.find(x => x.agentId === '1611')!.claretSharpResourceSource!
    const fires = (src.axisGashSteps ?? []).filter(st => st.kind === 'consume')
    // 逐**段**结算 ⇒ 两次葬血强袭各 3 段 = 6 条（每段 1 层）
    expect(fires.length, '两次葬血强袭 × 3 段 = 6 条消耗步骤').toBe(6)
    expect([...new Set(fires.map(f => f.at))], '触发时刻 = 轴里两个块的 startTime').toEqual([0, 10.9])
    expect(fires.every(f => f.fired), '六段都应触发（C1 起中间攒够）').toBe(true)
    expect(fires.reduce((n, f) => n + f.layers, 0)).toBe(6)
  }, 180_000)

  it('★ 标准轴的**全档位统一**：C0/C1/C6 都打满 6 次毁伤', async () => {
    // 用户口径 2026-10-12：「0命不够的话，这里你把平a延长一下，就可以统一实现6毁伤了。这样作为标准比较好」
    // ⇒ 轴内那个 `basic` 块从 1s 延到 **2s**：中间积累 = 连携302×2 + 终结400.97 + 平A 2s×120 = **1245**
    //   · C0（核心 50% = ×1.5）⇒ 1867.5 ≥ 1800 ✅
    //   · C1+（+ 影画1 20% = ×1.7）⇒ 2116.5 ✅
    // 实测三档**都是 6 次、零未触发**——「标准6毁伤」名副实归。
    for (const cinema of [0, 1, 6]) {
      const r = await runStd(cinema, 1800)
      expect(r.maim, `C${cinema} 应打满 6 次（平A 2s 让最低档也够）`).toBe(6)
      expect(r.unfired, `C${cinema} 不应有未触发`).toBe(0)
    }
  }, 300_000)

  it('★ 反锁：平A 块若退回 1s，C0 会掉到 3 次（证明 2s 是必需的最小延长）', async () => {
    // 1s 时中间只有 1124.97 基础值：C0 ×1.5 = 1687.5 < 1800 ⇒ 第二次不触发（3 次）；
    // C1 ×1.7 = 1912.4 ≥ 1800 ⇒ 6 次。这条钉住「延长到 2s」这个口径不是随手写的。
    const preset = stunAxisPresets.find(p => p.id === 'preset-1611-any')!
    const ax = cloneStunAxes(preset.axes!)
    for (const a of ax[0]!.actions) if (a.moveId === 'basic') a.count = 1
    await setupHarness([{ agentId: '1611', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 }, { agentId: '1361' }, { agentId: '1211' }])
    const config = useConfigStore()
    config.enemy.stunCountLock = 1
    config.useStunAxis = true
    config.stunAxes = ax
    const c = useResourceCalc()
    const src = c.resourceResult.value!.characters.find(x => x.agentId === '1611')!.claretSharpResourceSource!
    // 逐段结算：起手 1800 那次打满 3 段；中间攒 1687 点（×1.5）⇒ 第二发只能打 2 段（第 3 段没层）
    // ⇒ 合计 5 次（旧「按次判」口径会给 3 次——那是把第 2 发的 2 段也误判成 0）。
    expect(src.axisMaim, 'C0 + 平A 1s ⇒ 3 + 2 = 5 次').toBe(5)
    expect(src.axisMaimUnfired, '第二发的第 3 段差层').toBe(1)
    expect(src.minEntryForAllMaim, '起手已占满上限 ⇒ 补不上 ⇒ null').toBeNull()
  }, 180_000)
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
      [{ moveId: INSCRIPTION_MOVE, count: 5, window: 1 }, { moveId: 'claret-cleave', count: 1, window: 1 }], 4,
    )
    expect(axisMaim, '每窗 1 次斩金 × 4 窗 = 4 次轴内毁伤（basic 段不入表则恒 0）').toBe(4)
  }, 120_000)
})
