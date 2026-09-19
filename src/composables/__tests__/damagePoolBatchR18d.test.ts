/**
 * R15-d 批次（`damagePool.ts` `:162` 叶瞬光帷幕封顶 agentId 分支迁进模块）的**精确值判据**。
 *
 * 迁移内容（2026-09-17 round 18，编排棘轮 18 → 17）：
 *  · 原判据 `row.agentId === '1431' && (panel as any).yeshuguangStunCapMult && stunForThis > 0`
 *    住在 `damagePool.ts#pushDirect` 里，算式 `veilStunMultiplier(boss, bonusPct, cap) - bonusPct/100`
 *    也在那里就地展开（就地读 `panel.stunDmgMultiplierBonus*` + `configStore.enemy.stunVuln`）。
 *  · 现整条迁进 `yeshuguang.ts#applyPanel`：面板阶段读新只读入参 `AgentPanelInput.enemyStunVuln`
 *    （= `configStore.enemy.stunVuln`），当场算出基数并盖章 `panel.yeshuguangVeilStunBase`；
 *    伤害池只做「字段非 0 ⇒ 取该值」。`agentId` 项删除，依据 = **T6 判据**
 *    （`yeshuguangStunCapMult` / `yeshuguangVeilStunBase` 的唯一写入方 = 本角色模块）。
 *
 * 为什么必须单独有这个文件（不是「补测试」的仪式）：
 *  · 迁移面对的是**易伤基数分支**，错一位就是全角色数值漂移，而 `timeGolden` 把 dmg 归为「信息项」
 *    （`diffEntry` push 进 `info` 而非 `fail`）⇒ **全绿 ≠ 正确**，必须自建精确值判据。
 *  · ⚠ **三项门控必须逐位保留**，本文件逐条钉住：
 *    ① `yeshuguangStunCapMult` 非 0 = 身份判据（下面「跨槽泄漏反锁」+「无该角色队反锁」两组）；
 *    ② `stunForThis > 0` = 「轴外段不吃帷幕封顶」的**必要**门控（R14 分诊 §4.2 实测，**不是冗余**）
 *       ——「轴外段」两组用 `stunMult === 1` 精确钉住；
 *    ③ `stunDmgMultiplierBonusCapAlways` 全仓零写入（R14 分诊 §4.3）⇒ 算式里原样保留，
 *       但**不许**当成「需要搬运的量」。
 *  · ⚠ **数值巧合对策**（round 17 的「成对对照」手法，本批照抄并加强）：
 *    `stunMult` 是 `1 + (stunBase − 1) × stunForThis`。在**默认** boss 易伤 1.5 下，
 *    帷幕基数恰好 = 1.5 = 全局回落值 ⇒ 短路后**落回同一个数**，断言无法分辨。
 *    故本文件把 boss 易伤推到 **2.0 / 3.0 / 3.5**（封顶真正咬合）并配 **C0/C4 两档封顶**，
 *    使「用帷幕基数」与「用 boss 裸值」给出**不同**的数（如 2 vs 1.3、2.4 vs 1.42）。
 *  · ⚠ **「缺字段时不伪造」**：非本角色面板该字段恒 0 ⇒ 必须回落到 `enemy.stunVuln`，
 *    下面「无 1431 的队」一组用精确值钉住（若实现改成 `?? 1.5` 之类兜底，该组精确红）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { yeshuguangMechanic, veilStunBase, veilStunMultiplier } from '@/mechanics/agents/yeshuguang'

type Harness = Awaited<ReturnType<typeof setupHarness>>

/** 关掉全部全局 buff（含额外能力），让「易伤口径」成为唯一变量 */
function isolate(config: Harness['config']) {
  for (const b of config.globalBuffs) b.enabled = false
}

/** 非轴态（关自动轴 + 清手动轴） */
function forceNonAxis(config: Harness['config']) {
  config.autoYidhariAxis = false
  config.stunAxisPlans.splice(0)
  config.stunAxes.splice(0)
  config.useStunAxis = false
}

/** 手动轴，**槽位 0 不参与**（用于钉住「轴模式下未进轴槽位仍落兜底臂」） */
function axisWithoutSlot0(config: Harness['config']) {
  forceNonAxis(config)
  config.stunAxes.push({
    name: '手动轴（不含槽0）',
    actions: [
      { slot: 1, moveId: '1481009', count: 1, startTime: 0 },
      { slot: 2, moveId: '1311009', count: 1, startTime: 3 },
    ],
  } as never)
  config.useStunAxis = true
}

const YSG_TEAM: Array<{ agentId: string; cinemaLevel?: number }> = [
  { agentId: '1431' }, { agentId: '1481' }, { agentId: '1311' },
]

async function calcOf(
  team: Array<{ agentId: string; cinemaLevel?: number }>,
  opts: { stunVuln?: number; cinema?: number; mode?: 'nonaxis' | 'axis-no-slot0' } = {},
) {
  // ⚠ 命座只推给**槽 0**（叶瞬光自己）：队友也设同命座会各自带上自己的失衡易伤加成
  // （如 1481/1311 的 C4），把 `panel.stunDmgMultiplierBonus` 从 60 改掉 ⇒ 帷幕基数跟着变，
  // 断言会测到「队友命座」而不是「本角色的封顶档位」。实测：三槽全 C4 时 boss3.5 得 2.2（非 2.4）。
  const cinema = opts.cinema ?? 0
  const { catalog, config } = await setupHarness(
    team.map((s, i) => ({ ...s, cinemaLevel: i === 0 ? cinema : 0 })),
    { recommendedBuild: true },
  )
  isolate(config)
  if (opts.mode === 'axis-no-slot0') axisWithoutSlot0(config)
  else forceNonAxis(config)
  if (opts.stunVuln !== undefined) config.enemy.stunVuln = opts.stunVuln
  const calc = useResourceCalc()
  await new Promise(r => setTimeout(r, 80))
  return { calc, config, catalog }
}

/** 取某槽某 moveId 的全部直伤行 */
function rowsOf(calc: ReturnType<typeof useResourceCalc>, slot: number, agentId: string, moveId: string) {
  return calc.damagePoolRows.value.filter(r => r.slot === slot && r.agentId === agentId && r.moveId === moveId)
}

/** 取某槽的全部行 note（跨槽泄漏反锁用） */
function notesOfSlot(calc: ReturnType<typeof useResourceCalc>, slot: number) {
  return calc.damagePoolRows.value.filter(r => r.slot === slot).map(r => r.note ?? '')
}

// ── 跳③：纯算式 + 面板钩子（绕开整条管线） ──────────────────────────────────────
describe('R15-d 跳③：veilStunBase 算式（逐位保留原 damagePool 就地展开的算术）', () => {
  it('cap 咬合时取 cap；未咬合时取 boss + bonus/100；两者都减掉 bonus/100', () => {
    // 原式：min(max(0,boss) + max(0,bonus)/100, cap) − bonus/100
    expect(veilStunBase(2.5, 60, 0, 2.1)).toBe(1.5)   // min(3.1, 2.1) − 0.6 = 1.5（封顶咬合）
    expect(veilStunBase(1.5, 60, 0, 2.1)).toBe(1.5)   // min(2.1, 2.1) − 0.6 = 1.5（恰好咬合）
    expect(veilStunBase(1.0, 60, 0, 2.1)).toBe(1.0)   // min(1.6, 2.1) − 0.6 = 1.0（未咬合）
    expect(veilStunBase(3.5, 60, 0, 3.0)).toBe(2.4)   // min(4.1, 3.0) − 0.6 = 2.4（C4 档）
    expect(veilStunBase(2.0, 0, 0, 3.0)).toBe(2.0)    // 无加成 ⇒ 原样
  })

  it('★ capAlways > 0 时先钳加成（该字段全仓零写入，但算式逐位保留、不许删）', () => {
    // capAlways = 30 把 60 钳成 30 ⇒ min(boss+0.3, cap) − 0.3
    expect(veilStunBase(2.5, 60, 30, 2.1)).toBe(1.8)  // min(2.8, 2.1) − 0.3 = 1.8
    expect(veilStunBase(1.5, 60, 30, 2.1)).toBe(1.5)  // min(1.8, 2.1) − 0.3 = 1.5
    // 与 capAlways=0 的对照必须不同（否则该分支没被测到）
    expect(veilStunBase(2.5, 60, 30, 2.1)).not.toBe(veilStunBase(2.5, 60, 0, 2.1))
  })

  it('★ 与 veilStunMultiplier 的关系：base 恒 = veil − bonus/100（两个函数不许漂移）', () => {
    for (const [boss, bonus, cap] of [[1.5, 60, 2.1], [2.5, 60, 2.1], [3.5, 60, 3.0], [1.0, 25, 2.1]] as const) {
      expect(veilStunBase(boss, bonus, 0, cap)).toBeCloseTo(veilStunMultiplier(boss, bonus, cap) - bonus / 100, 10)
    }
  })
})

describe('R15-d 跳③：applyPanel 盖章（唯一写入方 = 本角色模块）', () => {
  it('★ 基数由面板阶段算出并盖章；C0 → cap 2.1 / C4 → cap 3.0', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1431', cinemaLevel: 0 }, { agentId: '1481' }, { agentId: '1311' }], { recommendedBuild: true })
    config.enemy.stunVuln = 2.5
    const p0: any = computePanelPhases(0, config, catalog)!.inCombat
    expect(p0.yeshuguangStunCapMult).toBe(2.1)
    expect(p0.yeshuguangVeilStunBase).toBe(1.5)

    config.team[0].cinemaLevel = 4
    config.enemy.stunVuln = 3.5
    const p4: any = computePanelPhases(0, config, catalog)!.inCombat
    expect(p4.yeshuguangStunCapMult).toBe(3.0)
    expect(p4.yeshuguangVeilStunBase).toBe(2.4)
  })

  it('★ 非本角色：两个字段都恒 0（= 身份判据成立，T6）——缺字段时不伪造', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1481' }, { agentId: '1311' }, { agentId: '1211' }], { recommendedBuild: true })
    config.enemy.stunVuln = 2.5
    for (const slot of [0, 1, 2]) {
      const p: any = computePanelPhases(slot, config, catalog)!.inCombat
      expect(p.yeshuguangStunCapMult).toBe(0)
      expect(p.yeshuguangVeilStunBase).toBe(0)
    }
  })

  it('★ boss 易伤变了基数跟着变（入参真的接上了，不是常量）', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1431', cinemaLevel: 0 }, { agentId: '1481' }, { agentId: '1311' }], { recommendedBuild: true })
    const seen: number[] = []
    for (const v of [1.0, 1.5, 2.0, 2.5]) {
      config.enemy.stunVuln = v
      seen.push((computePanelPhases(0, config, catalog)!.inCombat as any).yeshuguangVeilStunBase)
    }
    // 未咬合段线性跟随：1.0 → 1.0、1.5 → 1.5；2.0 起 min(2.6, 2.1) − 0.6 = 1.5 封顶
    expect(seen).toEqual([1.0, 1.5, 1.5, 1.5])
    expect(new Set(seen).size).toBeGreaterThan(1)
  })

  it('钩子仍挂着（防「迁移时把 applyPanel 整个删了」）', () => {
    expect(typeof yeshuguangMechanic.applyPanel).toBe('function')
  })

  it('★ 钩子级：随迁的面板直加逐值钉住（C0/C1/C4 三档）——原 helpers.ts 硬编码块的等价物', () => {
    const mk = () => ({
      critRate: 5, dmgBonus: 100, enemyDefReduction: 0,
      stunDmgMultiplierBonus: 60, stunDmgMultiplierBonusAlways: 0, stunDmgMultiplierBonusCapAlways: 0,
    })
    const call = (panel: any, cinemaLevel: number, enemyStunVuln = 1.5) =>
      yeshuguangMechanic.applyPanel!({
        slot: 0, agent: {} as any, cinemaLevel, potentialLevel: 6, team: [],
        outOfCombatPanel: panel, panel, settings: {}, enemyStunVuln,
      } as any)

    const p0: any = mk()
    call(p0, 0)
    expect(p0.critRate).toBe(35)        // 5 + 30（核心被动·合道）
    expect(p0.dmgBonus).toBe(125)       // 100 + 25
    expect(p0.enemyDefReduction).toBe(0) // C0 无减防
    expect(p0.yeshuguangStunCapMult).toBe(2.1)
    expect(p0.yeshuguangVeilStunBase).toBe(1.5) // min(1.5+0.6, 2.1) − 0.6

    const p1: any = mk()
    call(p1, 1)
    expect(p1.dmgBonus).toBe(135)        // +10（影画1）
    expect(p1.enemyDefReduction).toBe(20) // +20（影画1）

    const p4: any = mk()
    call(p4, 4, 3.5)
    expect(p4.yeshuguangStunCapMult).toBe(3.0)
    expect(p4.yeshuguangVeilStunBase).toBe(2.4) // min(3.5+0.6, 3.0) − 0.6
  })
})

// ── 跳①：真管线（boss 易伤推高 ⇒ 封顶咬合 ⇒ 与回落值必须不同） ────────────────────
describe('R15-d 跳①：叶瞬光帷幕封顶 —— 成对精确值（默认 1.5 下巧合，必须推高 boss 易伤）', () => {
  it('★ C0 / boss 2.5：白名单招 1.5（封顶咬合）；非白名单招 1.15（回落覆盖率）——两者必须不同', async () => {
    const { calc } = await calcOf(YSG_TEAM, { stunVuln: 2.5 })
    const wl = rowsOf(calc, 0, '1431', '1431013')
    expect(wl.length).toBe(1)
    expect(wl[0].stunMult).toBe(1.5)
    // 次数锚同 R17c：刀 1 后该队 scale 0.625 → 0.75 ⇒ 14 → 16.206；R37-J5 ①④ ⇒ 16.618；吸收上限 40% ⇒ 16.571（见 damagePoolBatchR17c.test.ts 同处注释）
    expect(wl[0].count).toBeCloseTo(16.571, 3)
    expect(wl[0].note).toContain(' · 明心境满易伤')

    const nonwl = rowsOf(calc, 0, '1431', '1431016')
    expect(nonwl.length).toBe(1)
    expect(nonwl[0].stunMult).toBe(1.15)
    expect(nonwl[0].note).not.toContain('明心境满易伤')

    // ★ 成对反锁：若「帷幕基数」短路成 boss 裸值 2.5，wl 会变 2.5；若短路成回落值则两者同值
    expect(wl[0].stunMult).not.toBe(nonwl[0].stunMult)
    expect(wl[0].stunMult).not.toBe(2.5)
  })

  it('★ C4 / boss 3.5：白名单招 2.4（C4 封顶 3.0 咬合）；非白名单招 1.42——影画档位真的分叉', async () => {
    const { calc } = await calcOf(YSG_TEAM, { stunVuln: 3.5, cinema: 4 })
    const wl = rowsOf(calc, 0, '1431', '1431013')
    expect(wl.length).toBe(1)
    expect(wl[0].stunMult).toBeCloseTo(2.4, 10)
    const nonwl = rowsOf(calc, 0, '1431', '1431016')
    expect(nonwl[0].stunMult).toBeCloseTo(1.42, 10)
    const wlV = wl[0].stunMult as number
    const nonwlV = nonwl[0].stunMult as number
    expect(wlV).not.toBeCloseTo(nonwlV, 6)

    // ★ C0 同 boss：封顶 2.1 咬合得更早 ⇒ 1.5，与 C4 的 2.4 必须不同（防「cap 硬编码」）
    const { calc: c0 } = await calcOf(YSG_TEAM, { stunVuln: 3.5, cinema: 0 })
    const wlC0 = rowsOf(c0, 0, '1431', '1431013')
    expect(wlC0[0].stunMult).toBe(1.5)
    expect(wlC0[0].stunMult as number).not.toBeCloseTo(wlV, 6)
  })

  it('★ boss 2.0 / C4：封顶未咬合 ⇒ 2（= boss 裸值，但走的是帷幕路径）', async () => {
    const { calc } = await calcOf(YSG_TEAM, { stunVuln: 2.0, cinema: 4 })
    const wl = rowsOf(calc, 0, '1431', '1431013')
    // ⚠ 用 toBeCloseTo 不用 toBe：`min(2 + 0.6, 3) − 0.6` 有固有浮点残差
    // （实测 1.9999999999999998）——这是算式本身的性质，不是缺陷，别为它改成 toBe(2)。
    expect(wl[0].stunMult).toBeCloseTo(2, 10)
    // 非白名单回落 = 1 + (2.0−1) × 0.3 = 1.3
    const nonwlV = rowsOf(calc, 0, '1431', '1431016')[0].stunMult as number
    expect(nonwlV).toBeCloseTo(1.3, 10)
    // 成对反锁：封顶路径与回落路径必须不同
    expect(wl[0].stunMult as number).not.toBeCloseTo(nonwlV, 6)
  })

  it('★ 全槽白名单行一致（同一份 panel 基数）：9 行全 1.5，且 note 逐字未改', async () => {
    const { calc } = await calcOf(YSG_TEAM, { stunVuln: 2.5 })
    const marked = calc.damagePoolRows.value.filter(r => r.slot === 0 && r.agentId === '1431'
      && (r.note ?? '').includes('明心境满易伤'))
    expect(marked.length).toBe(9)
    expect(marked.every(r => r.stunMult === 1.5)).toBe(true)
    // ROLE_ONLY_MARKERS 裸字符串判据面：文案一个字都不许改
    for (const r of marked) expect(r.note).toContain(' · 明心境满易伤')
  })
})

// ── 跳②：★ 三项门控逐位钉住（本批最重要的一组） ─────────────────────────────────
describe('R15-d 跳②：门控逐位保留（身份 / stunForThis>0 / 轴模式兜底臂）', () => {
  it('★ `stunForThis > 0` 门控：**轴外段**（stunOverride=0）不吃帷幕封顶 ⇒ 精确 1', async () => {
    // 轴模式 + 槽0 有轴内动作 ⇒ 白毛招被切成轴内/轴外两段
    const { config } = await setupHarness(YSG_TEAM.map(s => ({ ...s, cinemaLevel: 0 })), { recommendedBuild: true })
    isolate(config)
    forceNonAxis(config)
    config.enemy.stunVuln = 2.5
    config.stunAxes.push({
      name: '含槽0（只放普攻，逼出轴外段）',
      actions: [{ slot: 0, moveId: '1431016', count: 1, startTime: 0 }],
    } as never)
    config.useStunAxis = true
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 80))
    const outRows = calc.damagePoolRows.value.filter(r => r.slot === 0 && r.agentId === '1431'
      && (r.id ?? '').endsWith('-out'))
    expect(outRows.length).toBeGreaterThan(0)
    // 轴外段：stunForThis = 0 ⇒ stunMult 恒 1（**不是**帷幕基数 1.5，也不是 boss 裸值 2.5）
    for (const r of outRows) {
      expect(r.stunMult).toBe(1)
      expect(r.note).toContain(' · 轴外（无失衡易伤）')
    }
  })

  it('★ 身份门控 + 轴模式兜底臂：轴开启但槽0 无轴内动作 ⇒ 关键招仍 1.5（= 原分支无 !isAxis 项）', async () => {
    const { calc } = await calcOf(YSG_TEAM, { stunVuln: 2.5, mode: 'axis-no-slot0' })
    const wl = rowsOf(calc, 0, '1431', '1431013')
    expect(wl.length).toBe(1)
    expect(wl[0].stunMult).toBe(1.5)
    expect(wl[0].note).toContain(' · 明心境满易伤')
    // 同槽非白名单行仍回落覆盖率 ⇒ 证明不是「整槽被满易伤」
    expect(rowsOf(calc, 0, '1431', '1431016')[0].stunMult).toBe(1.15)
  })

  it('★ 跨槽泄漏反锁：队友行不得吃叶瞬光帷幕封顶（boss 2.5 ⇒ 队友应得 1.45，不是 1.5）', async () => {
    const { calc } = await calcOf(YSG_TEAM, { stunVuln: 2.5 })
    // 队友 1481 的直伤行：回落全局覆盖率 ⇒ 1 + (2.5−1) × 0.3 = 1.45
    const mate = calc.damagePoolRows.value.find(r => r.slot === 1 && r.moveId)
    expect(mate?.stunMult).toBe(1.45)
    expect(mate?.stunMult).not.toBe(1.5)
    for (const slot of [1, 2]) {
      expect(notesOfSlot(calc, slot).some(n => n.includes('明心境满易伤'))).toBe(false)
    }
  })

  it('★ 无该角色队反锁：boss 2.5 下全队都吃裸 boss 值 ⇒ 无一行是封顶后的 1.5', async () => {
    const { calc } = await calcOf(
      [{ agentId: '1461' }, { agentId: '1521' }, { agentId: '1361' }],
      { stunVuln: 2.5 },
    )
    expect(calc.damagePoolRows.value.length).toBeGreaterThan(0)
    const marks = calc.damagePoolRows.value
      .flatMap(r => (r.note ?? '').includes('明心境满易伤') ? [`${r.agentId} ${r.moveId}`] : [])
    expect(marks).toEqual([])
    // 该队无 1431 ⇒ 面板字段恒 0 ⇒ 一行都不该拿到 1.5（封顶基数）；全队应落 1.45（覆盖率 0.3）
    const stunMults = calc.damagePoolRows.value.filter(r => r.moveId).map(r => r.stunMult)
    expect(stunMults).not.toContain(1.5)
  })
})
