/**
 * R15-c 批次（`damagePool.ts` `:567`/`:570` 两处 agentId 分支迁进模块行级 `stunOverride` 自报）的
 * **精确值判据**。
 *
 * 迁移内容（2026-09-16 round 17，编排棘轮 20 → 18）：
 *  · `:567` 叶瞬光「明心境满易伤」—— 原 `charResult.agentId === '1431' && YESHUGUANG_FULL_STUN_MOVES.has(moveId)`
 *    → `yeshuguang.ts#stunOverrideForMove`。
 *  · `:570` 雨果「非轴精确口径」—— 原 `!isAxis && charResult.agentId === '1291'`
 *    → `hugo.ts#stunOverrideForMove`。
 *  · 兜底臂改为「模块认领 / 不认领」分流（不认领 ⇒ 回落全局失衡覆盖率，与原 `else` 臂同义）。
 *
 * 契约面：`AgentMechanicModule.stunOverrideForMove?(input: AgentStunOverrideInput): AgentStunOverride | null`。
 *
 * 为什么必须单独有这个文件（不是「补测试」的仪式）：
 *  · 迁移面对的是**易伤基数分支**，错一位就是全角色数值漂移，而 `timeGolden` 把 dmg 归为「信息项」
 *    （`diffEntry` push 进 `info` 而非 `fail`）⇒ **全绿 ≠ 正确**，必须自建精确值判据。
 *  · ⚠ **两处的 `isAxis` 口径刻意不对称**（R14 分诊 §4.1 实测）：叶瞬光**没有** `!isAxis` 项、
 *    雨果**有**。伤害池的轴内分段链是 `else if (isAxis && axisSlots.has(slot))`，而
 *    `axisSlots.has(slot)` 在「轴模式下本槽没进轴」时为假 ⇒ 兜底臂**在轴模式下也会被问到**。
 *    下面的「跳③」段把这条不对称**逐位钉住**（统一两者 ⇒ 本文件精确红）。
 *  · ⚠ **`stunOverride: 0` 与「不认领」语义不同**：前者 = 明确「不吃易伤」（雨果非白名单招），
 *    后者 = 回落全局覆盖率。把 0 折成 null 会让雨果的非白名单行静默吃上覆盖率
 *    ⇒ 下面既有「0 也被认领」的正控，也有「不认领 ⇒ 落覆盖率」的对照。
 *  · ⚠ **数值巧合对策**：本批断言一律写**精确值**（`toBe`），不写 `> 0`；
 *    并以「同一 moveId 在白名单内/外给出不同的 `stunMult`」成对断言（1.5 vs 1.2916…），
 *    使「短路后恰好落回同一个数」无法伪装。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { yeshuguangMechanic } from '@/mechanics/agents/yeshuguang'
import { hugoMechanic } from '@/mechanics/agents/hugo'

/** 关掉全部全局 buff（含额外能力），让「易伤口径」成为唯一变量 */
function isolate(config: Awaited<ReturnType<typeof setupHarness>>['config']) {
  for (const b of config.globalBuffs) b.enabled = false
}

/** 非轴态（关自动轴 + 清手动轴） */
function forceNonAxis(config: Awaited<ReturnType<typeof setupHarness>>['config']) {
  config.autoYidhariAxis = false
  config.stunAxisPlans.splice(0)
  config.stunAxes.splice(0)
  config.useStunAxis = false
}

/** 手动轴，**槽位 0 不参与**（用于钉住「轴模式下未进轴槽位仍落兜底臂」） */
function axisWithoutSlot0(config: Awaited<ReturnType<typeof setupHarness>>['config']) {
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

async function calcOf(team: Parameters<typeof setupHarness>[0], mode: 'nonaxis' | 'axis-no-slot0') {
  const { config } = await setupHarness(team, { recommendedBuild: true })
  isolate(config)
  if (mode === 'nonaxis') forceNonAxis(config)
  else axisWithoutSlot0(config)
  const calc = useResourceCalc()
  await new Promise(r => setTimeout(r, 80))
  return { calc, config }
}

/** 取某槽某 moveId 的全部直伤行（同 moveId 可能有多行：轴内/轴外切段、赠送等） */
function rowsOf(calc: ReturnType<typeof useResourceCalc>, slot: number, agentId: string, moveId: string) {
  return calc.damagePoolRows.value.filter(r => r.slot === slot && r.agentId === agentId && r.moveId === moveId)
}

/** 取某槽的全部行 note（跨槽泄漏反锁用） */
function notesOfSlot(calc: ReturnType<typeof useResourceCalc>, slot: number) {
  return calc.damagePoolRows.value.filter(r => r.slot === slot).map(r => r.note ?? '')
}

// ── 跳③：模块钩子（纯函数级，绕开整条管线） ─────────────────────────────────────
describe('R15-c 跳③：叶瞬光 stunOverrideForMove（口径：**无** isAxis 项）', () => {
  const hook = (moveId: string, isAxis: boolean) =>
    yeshuguangMechanic.stunOverrideForMove!({ slot: 0, moveId, isAxis } as never)

  it('白名单关键招 → 认领且吃满（stunOverride 精确 1）+ note 逐字', () => {
    // 1431013 强特 / 1431027 展望 / 1431_c6_finisher_attach C6 收尾附伤
    expect(hook('1431013', false)).toEqual({ stunOverride: 1, note: ' · 明心境满易伤' })
    expect(hook('1431027', false)).toEqual({ stunOverride: 1, note: ' · 明心境满易伤' })
    expect(hook('1431_c6_finisher_attach', false)).toEqual({ stunOverride: 1, note: ' · 明心境满易伤' })
  })

  it('非白名单招 → **不认领**（null，不是 0）：回落全局覆盖率', () => {
    // 1431016 普攻变体 / 1431022 闪反 都不在白名单
    expect(hook('1431016', false)).toBeNull()
    expect(hook('1431022', false)).toBeNull()
    expect(hook('basic_attack', false)).toBeNull()
  })

  it('★ 口径不对称：**isAxis 真假都认领**（原分支没有 `!isAxis` 项）——加 !isAxis 即静默改行为', () => {
    expect(hook('1431013', true)).toEqual({ stunOverride: 1, note: ' · 明心境满易伤' })
    expect(hook('1431013', false)).toEqual({ stunOverride: 1, note: ' · 明心境满易伤' })
    // 与雨果对照（那边 isAxis 为真时**不认领**）—— 两处必须不同
    expect(hugoMechanic.stunOverrideForMove!({ slot: 0, moveId: '1291015', isAxis: true } as never)).toBeNull()
  })
})

describe('R15-c 跳③：雨果 stunOverrideForMove（口径：**有** !isAxis 项 + 明确 0）', () => {
  const hook = (moveId: string, isAxis: boolean) =>
    hugoMechanic.stunOverrideForMove!({ slot: 0, moveId, isAxis } as never)

  it('非轴 + 白名单（连携 1291015 / 终结技 1291018 / 决算 1291_ex_verdict_final / 决算追加）→ 精确 1', () => {
    expect(hook('1291015', false)).toEqual({ stunOverride: 1, note: ' · 失衡内（连携/决算满易伤）' })
    expect(hook('1291018', false)).toEqual({ stunOverride: 1, note: ' · 失衡内（连携/决算满易伤）' })
    expect(hook('1291_ex_verdict_final', false)).toEqual({ stunOverride: 1, note: ' · 失衡内（连携/决算满易伤）' })
    expect(hook('1291_ultimate_verdict_bonus', false)).toEqual({ stunOverride: 1, note: ' · 失衡内（连携/决算满易伤）' })
  })

  it('★ 非轴 + 非白名单 → **认领且明确 0**（不是 null）：语义 = 不吃易伤，不许回落覆盖率', () => {
    expect(hook('1291009', false)).toEqual({ stunOverride: 0, note: ' · 失衡外（无易伤）' })
    expect(hook('1291012', false)).toEqual({ stunOverride: 0, note: ' · 失衡外（无易伤）' })
    expect(hook('1291_ex_normal_final', false)).toEqual({ stunOverride: 0, note: ' · 失衡外（无易伤）' })
  })

  it('★ 口径不对称：轴模式 → **整支不认领**（轴模式走上方 axisSplitFor）', () => {
    expect(hook('1291015', true)).toBeNull()
    expect(hook('1291009', true)).toBeNull()
  })
})

// ── 跳①：真管线（含 note 逐字 + 非白名单行不得被认领） ───────────────────────────
describe('R15-c 跳①：叶瞬光非轴 —— 白名单满易伤 / 非白名单回落覆盖率（成对精确值）', () => {
  it('同一队同一轮：1431013 → stunMult 精确 1.5；1431016 → 精确 1.15（覆盖率折扣值）', async () => {
    const { calc } = await calcOf(
      [{ agentId: '1431', cinemaLevel: 0 }, { agentId: '1481', cinemaLevel: 0 }, { agentId: '1311', cinemaLevel: 0 }],
      'nonaxis',
    )
    // stunMult = 1 + (stunVuln − 1) × stunForThis ⇒ 1.5 表示 stunForThis = 1（吃满）
    const full = rowsOf(calc, 0, '1431', '1431013')
    expect(full.length).toBe(1)
    expect(full[0].stunMult).toBe(1.5)
    expect(full[0].note).toContain(' · 明心境满易伤')
    expect(full[0].count).toBe(14)

    // 非白名单普攻变体：不认领 ⇒ 回落 stunCoverage（本轮 0.3 ⇒ 1 + 0.5×0.3 = 1.15）
    const plain = rowsOf(calc, 0, '1431', '1431016')
    expect(plain.length).toBe(1)
    expect(plain[0].stunMult).toBe(1.15)
    expect(plain[0].note).not.toContain('明心境满易伤')
    // 成对反锁：两者必须不同（同值即「短路后落回同一个数」的数值巧合）
    expect(full[0].stunMult).not.toBe(plain[0].stunMult)
  })

  it('★ 白名单行数 = 名单内实际出场的招数（不是「全部行都满易伤」）', async () => {
    const { calc } = await calcOf(
      [{ agentId: '1431', cinemaLevel: 0 }, { agentId: '1481', cinemaLevel: 0 }, { agentId: '1311', cinemaLevel: 0 }],
      'nonaxis',
    )
    const marked = calc.damagePoolRows.value.filter(r => r.slot === 0 && r.agentId === '1431'
      && (r.note ?? '').includes('明心境满易伤'))
    // 实测 8 行（1431013/1431009/1431017/1431018/1431019/1431025×2/1431028/1431027）
    expect(marked.length).toBe(9)
    expect(marked.every(r => r.stunMult === 1.5)).toBe(true)
  })

  it('★ 跨槽泄漏反锁：队友行不得出现「明心境满易伤」', async () => {
    const { calc } = await calcOf(
      [{ agentId: '1431', cinemaLevel: 0 }, { agentId: '1481', cinemaLevel: 0 }, { agentId: '1311', cinemaLevel: 0 }],
      'nonaxis',
    )
    expect(calc.damagePoolRows.value.some(r => r.agentId === '1431' && (r.note ?? '').includes('明心境满易伤'))).toBe(true)
    for (const slot of [1, 2]) {
      expect(notesOfSlot(calc, slot).some(n => n.includes('明心境满易伤'))).toBe(false)
    }
  })
})

describe('R15-c 跳①：雨果非轴 —— 白名单 1.5 / 非白名单精确 1（**不吃**易伤）', () => {
  it('1291015（连携）→ 1.5；1291009（强特起手）→ 精确 1；终结技 1291018 → 1.5', async () => {
    const { calc } = await calcOf(
      [{ agentId: '1291', cinemaLevel: 0 }, { agentId: '1481', cinemaLevel: 0 }, { agentId: '1161', cinemaLevel: 0 }],
      'nonaxis',
    )
    const chain = rowsOf(calc, 0, '1291', '1291015')
    expect(chain.length).toBe(1)
    expect(chain[0].stunMult).toBe(1.5)
    expect(chain[0].note).toContain(' · 失衡内（连携/决算满易伤）')

    const open = rowsOf(calc, 0, '1291', '1291009')
    expect(open.length).toBe(1)
    // 精确 1 = stunForThis 为 0（明确不吃），**不是**覆盖率的 1.2916…
    expect(open[0].stunMult).toBe(1)
    expect(open[0].note).toContain(' · 失衡外（无易伤）')

    // 1291018 有两行：本体终结技 + 「好评转大」赠送队友终结技（两行都走同一支 ⇒ 都吃满）
    const ult = rowsOf(calc, 0, '1291', '1291018')
    expect(ult.length).toBe(2)
    expect(ult.map(r => r.stunMult)).toEqual([1.5, 1.5])
    expect(ult.map(r => r.count)).toEqual([2, 4])

    // ★ 决定性对照：若把 0 折成 null（回落覆盖率），强特起手会变成 1.2916… ⇒ 本对锁住该语义
    const otherSlotRow = calc.damagePoolRows.value.find(r => r.slot === 1 && r.type === '直伤' && r.stunMult !== undefined)
    expect(otherSlotRow?.stunMult).toBe(1.2916666666666667)
    expect(open[0].stunMult).not.toBe(otherSlotRow?.stunMult)
  })

  it('★ 跨槽泄漏反锁：队友行不得出现雨果的两族 note', async () => {
    const { calc } = await calcOf(
      [{ agentId: '1291', cinemaLevel: 0 }, { agentId: '1481', cinemaLevel: 0 }, { agentId: '1161', cinemaLevel: 0 }],
      'nonaxis',
    )
    for (const slot of [1, 2]) {
      const notes = notesOfSlot(calc, slot)
      expect(notes.some(n => n.includes('失衡内（连携/决算满易伤）'))).toBe(false)
      expect(notes.some(n => n.includes('失衡外（无易伤）'))).toBe(false)
    }
  })

  it('反锁：不含 1431/1291 的队，两族 note 一个都不许出现', async () => {
    const { calc } = await calcOf(
      [{ agentId: '1461', cinemaLevel: 0 }, { agentId: '1521', cinemaLevel: 0 }, { agentId: '1361', cinemaLevel: 0 }],
      'nonaxis',
    )
    expect(calc.damagePoolRows.value.length).toBeGreaterThan(0)
    const marks = ['明心境满易伤', '失衡内（连携/决算满易伤）', '失衡外（无易伤）']
    const leaked = calc.damagePoolRows.value
      .flatMap(r => marks.filter(m => (r.note ?? '').includes(m)).map(m => `${r.agentId} ${r.moveId} ${m}`))
    expect(leaked).toEqual([])
  })
})

// ── 跳②：★ 口径不对称的管线级判据（本批最重要的一条） ─────────────────────────────
describe('R15-c 跳②：轴模式下**未进轴槽位**仍落兜底臂 ⇒ 叶瞬光仍满易伤、雨果不认领', () => {
  it('★ 叶瞬光：轴开启但槽0 无轴内动作 ⇒ 关键招仍 1.5（叶支没有 !isAxis 项）', async () => {
    const { calc } = await calcOf(
      [{ agentId: '1431', cinemaLevel: 0 }, { agentId: '1481', cinemaLevel: 0 }, { agentId: '1311', cinemaLevel: 0 }],
      'axis-no-slot0',
    )
    const full = rowsOf(calc, 0, '1431', '1431013')
    expect(full.length).toBe(1)
    expect(full[0].stunMult).toBe(1.5)
    expect(full[0].note).toContain(' · 明心境满易伤')
    // 同槽非白名单行仍回落覆盖率（本轮 0.3 ⇒ 1.15）- 证明不是「整槽被满易伤」
    const plain = rowsOf(calc, 0, '1431', '1431016')
    expect(plain[0].stunMult).toBe(1.15)
  })

  it('★ 雨果：轴开启但槽0 无轴内动作 ⇒ 关键招**掉落全局覆盖率**（雨支有 !isAxis 项）', async () => {
    const { calc } = await calcOf(
      [{ agentId: '1291', cinemaLevel: 0 }, { agentId: '1481', cinemaLevel: 0 }, { agentId: '1161', cinemaLevel: 0 }],
      'axis-no-slot0',
    )
    // 终结技本体（轴模式下连携行 1291015 由轴配额决定、本轮不产 ⇒ 用 1291018 做判据）
    const ult = rowsOf(calc, 0, '1291', '1291018')
    expect(ult.length).toBe(1)
    // 1.2333… = 全局覆盖率的折扣值（**不是** 1.5）——这正是与叶瞬光的不对称：
    // 同步跑叶瞬光同态（上一例）得 1.5，两处**必须不同**。
    expect(ult[0].stunMult).toBe(1.2333333333333334)
    expect(ult[0].stunMult).not.toBe(1.5)
    expect(ult[0].note).not.toContain('失衡内（连携/决算满易伤）')
    expect(ult[0].note).not.toContain('失衡外（无易伤）')
  })
})
