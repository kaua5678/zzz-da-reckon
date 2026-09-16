/**
 * R15-b 批次（`damagePool.ts` 三处 agentId 分支迁进模块 `axisWindowOverlays`）的**精确值判据**。
 *
 * 迁移内容（2026-09-16 round 16，编排棘轮 23 → 20）：
 *  · `:441` 般岳明王 —— 原 `charResult.agentId === '1471' && (execPanel?.additionalAbilityActive ?? 0) > 0
 *    && banyueCinema < 6`（内层 `if (isAxis) 扫描层数 / else 覆盖率折算`）→ `banyue.ts#axisWindowOverlays`。
 *  · `:455` 可琳扫除帮手 —— 原 `=== '1061' && aaActive > 0`（内层同形两臂）→ `corin.ts#axisWindowOverlays`。
 *  · `:466` 希格莉德浸染 —— 原 `=== '1591' && aaActive > 0`（**与轴模式无关**）→ `sigrid.ts#axisWindowOverlays`。
 *
 * 契约面：`AgentAxisOverlayInput` 补 `isAxis` / `additionalAbilityActive` / `windInfectionRate` / `settings`；
 * `AgentAxisOverlays` 新增 `scalarBySlot`（按槽位键控的标量表）。
 *
 * 为什么必须单独有这个文件（不是「补测试」的仪式）：
 *  · `:441`/`:455` 的**非轴臂**在迁移前**物理不可达**（派发器在 `axes.length === 0` 时早退，
 *    钩子根本不被调用）⇒ 这条路径**从来没被任何测试跑过**，迁完等于**第一次**让它上线。
 *    既有 `banyue.test.ts:534` / `corin.test.ts:234` 走的确实是非轴队（它们当时走的是伤害池里的
 *    `else` 臂），迁后它们仍绿 = 「逐位等价」的强证据；但**它们证不了新契约的相位语义**
 *    （`isAxis` 真/假、门控缺字段时不伪造）——那正是本文件的职责。
 *  · ⚠ **假绿形态③「数值巧合」在本批特别危险**：般岳非轴默认值 `0.5` 与可琳 `0.5` 恰好使
 *    `5×3×0.5 = 7.5`、`35×0.5 = 17.5` 都是「看着就合法」的数。故本文件**每个断言写精确值**，
 *    并把滑块推到 **1 与 0** 两个端点（端点值与默认值不同 ⇒ 数值巧合无法伪装）。
 *  · ⚠ **标量表按槽位键控是本批最易错处**：合并成裸标量会把本角色增伤泄漏给**队友行**
 *    （四个既有桶不受影响是因为 moveId 全局唯一 —— 见 `AxisScalarOverlays` 头注释）。
 *    故下面每个角色用例都带**跨槽泄漏反锁**（队友行必须拿不到该标记）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { banyueMechanic } from '@/mechanics/agents/banyue'
import { corinMechanic } from '@/mechanics/agents/corin'
import { sigridMechanic } from '@/mechanics/agents/sigrid'

/** 关掉全部全局 buff（含额外能力），让门控/命座差异成为唯一变量 */
function isolate(config: Awaited<ReturnType<typeof setupHarness>>['config']) {
  for (const b of config.globalBuffs) b.enabled = false
}

async function calcOf(team: Parameters<typeof setupHarness>[0]) {
  const { config } = await setupHarness(team)
  isolate(config)
  const calc = useResourceCalc()
  await new Promise(r => setTimeout(r, 60))
  return { calc, config }
}

/** 取某槽某 moveId 的行 note（按身份找槽位，不按下标） */
function noteOf(calc: ReturnType<typeof useResourceCalc>, slot: number, agentId: string, moveId: string) {
  return calc.damagePoolRows.value.find(r => r.slot === slot && r.agentId === agentId && r.moveId === moveId)?.note ?? ''
}

/** 取某槽的全部行 note（跨槽泄漏反锁用：队友行不许出现本角色的标记） */
function notesOfSlot(calc: ReturnType<typeof useResourceCalc>, slot: number) {
  return calc.damagePoolRows.value.filter(r => r.slot === slot).map(r => r.note ?? '')
}

// ── 跳③：模块钩子（纯函数级，绕开整条管线） ─────────────────────────────────────
describe('R15-b 跳③：般岳明王非轴折算臂（精确值 + 桶语义不被污染）', () => {
  const input = (o: Record<string, unknown> = {}) => ({
    slot: 1, axes: [], cinemaLevel: 0, getAgentSkills: () => undefined,
    isAxis: false, additionalAbilityActive: true, windInfectionRate: 0, settings: {},
    ...o,
  } as never)

  it('非轴：不产桶、只产标量；默认 0.5 → 精确 7.5；滑块端点 1→15 / 0→0（端点值排除数值巧合）', () => {
    const d = banyueMechanic.axisWindowOverlays!(input())!
    expect(d.banyueMingwangStacks).toBeUndefined()
    expect(d.scalarBySlot!.get(1)!.banyueMingwangPct).toBe(7.5)

    expect(banyueMechanic.axisWindowOverlays!(input({ settings: { 'banyue.mingwangCoverage': 1 } }))!
      .scalarBySlot!.get(1)!.banyueMingwangPct).toBe(15)
    expect(banyueMechanic.axisWindowOverlays!(input({ settings: { 'banyue.mingwangCoverage': 0 } }))!
      .scalarBySlot!.get(1)!.banyueMingwangPct).toBe(0)
  })

  it('★ 标量值是**百分比**而桶值是**层数**：同一份滑块下两者数值必须不同（防「复用桶」回归）', () => {
    // 轴臂：桶给层数（这里轴内无动作 ⇒ 空表 ⇒ null，故直接用纯函数对照）
    // 非轴臂：标量 = 5 × 3 × cov = 15（cov=1）
    const nonAxis = banyueMechanic.axisWindowOverlays!(input({ settings: { 'banyue.mingwangCoverage': 1 } }))!
    expect(nonAxis.scalarBySlot!.get(1)!.banyueMingwangPct).toBe(15)
    // 若误把 15 当层数塞进桶，消费端会再乘 5% ⇒ 75%（错 5 倍）。桶必须缺席：
    expect(nonAxis.banyueMingwangStacks).toBeUndefined()
  })

  it('门控：额外能力未触发 / 6 命 ⇒ 两条臂都不参与（返回 null，不是产 0）', () => {
    expect(banyueMechanic.axisWindowOverlays!(input({ additionalAbilityActive: false }))).toBeNull()
    expect(banyueMechanic.axisWindowOverlays!(input({ cinemaLevel: 6 }))).toBeNull()
    // 轴臂同门控（防「只给非轴臂加门控」）
    expect(banyueMechanic.axisWindowOverlays!(input({ isAxis: true, additionalAbilityActive: false }))).toBeNull()
    expect(banyueMechanic.axisWindowOverlays!(input({ isAxis: true, cinemaLevel: 6 }))).toBeNull()
  })
})

describe('R15-b 跳③：可琳扫除帮手非轴折算臂（精确值 + 桶值恒 35 的不变量）', () => {
  const input = (o: Record<string, unknown> = {}) => ({
    slot: 0, axes: [], cinemaLevel: 0, getAgentSkills: () => ({ categories: [{ id: 'basic', moves: [{ id: 'b1' }] }] }),
    isAxis: false, additionalAbilityActive: true, windInfectionRate: 0, settings: {},
    ...o,
  } as never)

  it('非轴：不产桶、只产标量；默认 0.5 → 精确 17.5；端点 1→35 / 0→0', () => {
    const d = corinMechanic.axisWindowOverlays!(input())!
    expect(d.corinStunBonusMap).toBeUndefined()
    expect(d.scalarBySlot!.get(0)!.corinStunBonusPct).toBe(17.5)

    expect(corinMechanic.axisWindowOverlays!(input({ settings: { 'corin.additionalStunCoverage': 1 } }))!
      .scalarBySlot!.get(0)!.corinStunBonusPct).toBe(35)
    expect(corinMechanic.axisWindowOverlays!(input({ settings: { 'corin.additionalStunCoverage': 0 } }))!
      .scalarBySlot!.get(0)!.corinStunBonusPct).toBe(0)
  })

  it('★ 桶值恒 35 的不变量不被污染：非轴折算时桶缺席；轴臂桶值仍精确 35', () => {
    expect(corinMechanic.axisWindowOverlays!(input())!.corinStunBonusMap).toBeUndefined()
    const axisRes = corinMechanic.axisWindowOverlays!(input({
      isAxis: true, axes: [{ name: 'a', actions: [{ slot: 0, moveId: '1061009', count: 1, startTime: 0 }] }],
    }))!
    expect(axisRes.corinStunBonusMap!.get('1061009')).toBe(35)   // 恒 35，不是 35×cov
  })

  it('门控：额外能力未触发 ⇒ 两条臂都不参与', () => {
    expect(corinMechanic.axisWindowOverlays!(input({ additionalAbilityActive: false }))).toBeNull()
    expect(corinMechanic.axisWindowOverlays!(input({ isAxis: true, additionalAbilityActive: false }))).toBeNull()
  })
})

describe('R15-b 跳③：希格莉德浸染（与轴模式无关的标量臂）', () => {
  const input = (o: Record<string, unknown> = {}) => ({
    slot: 2, axes: [], cinemaLevel: 0, getAgentSkills: () => undefined,
    isAxis: false, additionalAbilityActive: true, windInfectionRate: 0, settings: {},
    ...o,
  } as never)

  it('精确值：覆盖率 0.5→7.5 / 1→15 / 0→不产出（不是产 0）', () => {
    expect(sigridMechanic.axisWindowOverlays!(input({ windInfectionRate: 0.5 }))!
      .scalarBySlot!.get(2)!.sigridInfectionPct).toBe(7.5)
    expect(sigridMechanic.axisWindowOverlays!(input({ windInfectionRate: 1 }))!
      .scalarBySlot!.get(2)!.sigridInfectionPct).toBe(15)
    expect(sigridMechanic.axisWindowOverlays!(input({ windInfectionRate: 0 }))).toBeNull()
  })

  it('★ 与轴模式无关：isAxis 真/假给出**同一**标量（原分支里 isAxis 不出现）', () => {
    const onAxis = sigridMechanic.axisWindowOverlays!(input({ windInfectionRate: 0.5, isAxis: true }))!
    const offAxis = sigridMechanic.axisWindowOverlays!(input({ windInfectionRate: 0.5, isAxis: false }))!
    expect(onAxis.scalarBySlot!.get(2)!.sigridInfectionPct).toBe(7.5)
    expect(offAxis.scalarBySlot!.get(2)!.sigridInfectionPct).toBe(7.5)
  })

  it('门控：额外能力未触发 ⇒ 不参与', () => {
    expect(sigridMechanic.axisWindowOverlays!(input({ windInfectionRate: 1, additionalAbilityActive: false }))).toBeNull()
  })
})

// ── 跳①：真管线（含门控 + 跨槽泄漏反锁） ────────────────────────────────────────
describe('R15-b 跳①：般岳非轴折算进伤害池（精确 note + 滑块端点）', () => {
  it('非6命非轴：默认 0.5 → note 精确「明王+7.5%（覆盖率近似）」；滑块 1 → 15.0；0 → 标记消失', async () => {
    // 队 [1471, 1481, 1451]：1481 支援 ⇒ 般岳额外能力触发；无轴预设 ⇒ 非轴
    const { calc, config } = await calcOf([
      { agentId: '1471', cinemaLevel: 0 },
      { agentId: '1481', cinemaLevel: 0 },
      { agentId: '1451', cinemaLevel: 0 },
    ])
    // 取一个有明王标注的行（轴外非 1471 的行必须没有）
    const marked = () => calc.damagePoolRows.value.filter(r => (r.note ?? '').includes('明王+'))
    expect(marked().length).toBeGreaterThan(0)
    expect(marked().every(r => r.agentId === '1471')).toBe(true)
    expect(marked().some(r => (r.note ?? '').includes('明王+7.5%（覆盖率近似）'))).toBe(true)

    config.setMechanicSetting('banyue.mingwangCoverage', 1)
    await new Promise(r => setTimeout(r, 60))
    expect(marked().some(r => (r.note ?? '').includes('明王+15.0%（覆盖率近似）'))).toBe(true)
    expect(marked().some(r => (r.note ?? '').includes('明王+7.5%'))).toBe(false)

    config.setMechanicSetting('banyue.mingwangCoverage', 0)
    await new Promise(r => setTimeout(r, 60))
    expect(marked().length).toBe(0)
  })

  it('★ 跨槽泄漏反锁：般岳队里**队友行**不得出现「明王+」标记', async () => {
    const { calc } = await calcOf([
      { agentId: '1471', cinemaLevel: 0 },
      { agentId: '1481', cinemaLevel: 0 },
      { agentId: '1451', cinemaLevel: 0 },
    ])
    for (const slot of [1, 2]) {
      expect(notesOfSlot(calc, slot).some(n => n.includes('明王+'))).toBe(false)
    }
  })

  it('反锁：无般岳的队（额外能力全开的支援/击破队）不得出现「明王+」', async () => {
    const { calc } = await calcOf([
      { agentId: '1481', cinemaLevel: 0 },
      { agentId: '1451', cinemaLevel: 0 },
      { agentId: '1311', cinemaLevel: 0 },
    ])
    expect(calc.damagePoolRows.value.some(r => (r.note ?? '').includes('明王+'))).toBe(false)
  })
})

describe('R15-b 跳①：可琳非轴折算进伤害池（精确 note + 滑块端点）', () => {
  it('非轴：滑块 1 → 「失衡增伤+35.0%（覆盖率近似）」；0.5 → 17.5；0 → 标记消失', async () => {
    // 队 [1061, 1021]：1021 同阵营 ⇒ 可琳额外能力触发；二槽无轴 ⇒ 非轴
    const { calc, config } = await calcOf([
      { agentId: '1061', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1021', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ])
    const note = () => noteOf(calc, 0, '1061', 'basic_attack')

    config.setMechanicSetting('corin.additionalStunCoverage', 1)
    await new Promise(r => setTimeout(r, 60))
    expect(note()).toContain('失衡增伤+35.0%（覆盖率近似）')

    config.setMechanicSetting('corin.additionalStunCoverage', 0.5)
    await new Promise(r => setTimeout(r, 60))
    expect(note()).toContain('失衡增伤+17.5%（覆盖率近似）')

    config.setMechanicSetting('corin.additionalStunCoverage', 0)
    await new Promise(r => setTimeout(r, 60))
    expect(note()).not.toContain('失衡增伤')
  })

  it('★ 跨槽泄漏反锁：可琳队里队友行不得出现「失衡增伤+…（覆盖率近似）」', async () => {
    const { calc, config } = await calcOf([
      { agentId: '1061', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1021', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ])
    config.setMechanicSetting('corin.additionalStunCoverage', 1)
    await new Promise(r => setTimeout(r, 60))
    expect(notesOfSlot(calc, 1).some(n => n.includes('失衡增伤+35.0%（覆盖率近似）'))).toBe(false)
  })
})

describe('R15-b 跳①：希格莉德浸染进伤害池（精确 note + 无风反锁）', () => {
  it('风角色在队：覆盖率 1 → 「浸染增伤+15.0%（风化覆盖率×15%）」；0.5 → 7.5', async () => {
    const { calc, config } = await calcOf([
      { agentId: '1591', cinemaLevel: 0 },
      { agentId: '1561', cinemaLevel: 0 },   // 维琳娜（风）⇒ 浸染存在
      { agentId: '1211', cinemaLevel: 0 },   // 丽娜（支援）⇒ 额外能力触发
    ])
    const hit = () => calc.damagePoolRows.value.filter(r => r.slot === 0 && r.agentId === '1591'
      && (r.note ?? '').includes('浸染增伤'))

    config.setMechanicSetting('wind.infectionCoverage', 1)
    await new Promise(r => setTimeout(r, 60))
    expect(hit().some(r => (r.note ?? '').includes('浸染增伤+15.0%（风化覆盖率×15%）'))).toBe(true)

    config.setMechanicSetting('wind.infectionCoverage', 0.5)
    await new Promise(r => setTimeout(r, 60))
    expect(hit().some(r => (r.note ?? '').includes('浸染增伤+7.5%（风化覆盖率×15%）'))).toBe(true)
    expect(hit().some(r => (r.note ?? '').includes('浸染增伤+15.0%'))).toBe(false)
  })

  it('反锁：队伍无风角色 ⇒ 不得出现「浸染增伤」', async () => {
    const { calc } = await calcOf([
      { agentId: '1591', cinemaLevel: 0 },
      { agentId: '1211', cinemaLevel: 0 },
      { agentId: '', cinemaLevel: 0 },
    ])
    expect(calc.damagePoolRows.value.some(r => (r.note ?? '').includes('浸染增伤'))).toBe(false)
  })

  it('★ 跨槽泄漏反锁：希格莉德队里队友行不得出现「浸染增伤」', async () => {
    const { calc, config } = await calcOf([
      { agentId: '1591', cinemaLevel: 0 },
      { agentId: '1561', cinemaLevel: 0 },
      { agentId: '1211', cinemaLevel: 0 },
    ])
    config.setMechanicSetting('wind.infectionCoverage', 1)
    await new Promise(r => setTimeout(r, 60))
    for (const slot of [1, 2]) {
      expect(notesOfSlot(calc, slot).some(n => n.includes('浸染增伤'))).toBe(false)
    }
  })
})
