/**
 * **逐槽 Δ%（本槽 / 队友）** 与 **「交付点掉窗」解释** 的判据。
 *
 * 由来（用户 2026-11-07）：「−0.03% 这种如果他是主c就不合理，他自己的属性区都有十几的提升」
 * ⇒ 页面只给一个全队合计数，把「主 C 涨 / 辅助跌」这个真实结构藏掉了。
 *
 * 守三件事：
 * ① **恒等式**：每个求值帧 `Σ slots === dmg`，且两级交付帧的 `Σ槽增量 === 全队增量`
 *    （`teamTotalDamage` 的定义就是 Σ `damagePoolRows.totalDamage`；若某类行挂错槽或有跨槽行，这里立刻红）；
 * ② **结构看得见**：仪玄 C1→C2 的交付帧上本槽为正、队友为负、合计只 −0.03% —— 这正是被藏掉的那一层；
 * ③ **掉窗必须被点名**：交付点从 K3 掉到 K2 时，主读数旁的 `deliveryNote` 必须说明它，
 *    并且分布条上的断点必须带出「差多少窗」（整数门槛下差 0.04 窗与差 2 窗印出来是同一个 ✕）。
 *
 * ⚠ 不做的事：不改交付规则、不改结算口径、不把主读数换成主 C 口径（那会让「队伍总伤害」失真）。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { applyTeamToStore } from '@/composables/teamCompare'
import { clearDifficultyLevers } from '@/composables/difficultyLadder'
import { teamPresets } from '@/data/teamPresets'
import { compareAtSameK, sameKBand, scanKFrontier } from '@/composables/cinemaUpliftFrontier'
import { analyzeCinemaUplift, buildSlotSummary, computeSlotDeltas } from '@/composables/cinemaUplift'
import type { KFrontier } from '@/composables/cinemaUpliftFrontier'

/** 扫两级前沿并返回两条前沿（同一场景、同一难度、只差命座等级） */
async function scanPair(presetId: string, from: number, to: number): Promise<[KFrontier, KFrontier]> {
  const preset = teamPresets.find(p => p.id === presetId)!
  let out: [KFrontier, KFrontier] | null = null
  await withAnalysisScenario(async s => {
    applyTeamToStore(s.config, preset)
    const a = await scanKFrontier(s, { cinemaLevel: from })
    s.config.setCinemaLevel(0, to)
    s.config.syncTeammateBuffsFromTeam()
    const b = await scanKFrontier(s, { cinemaLevel: to })
    out = [a!, b!]
  })
  expect(out, presetId + ' 前沿没扫出来').toBeTruthy()
  return out!
}

describe('判据①：恒等式 —— 逐槽之和 == 全队（每个求值帧 + 两个交付帧）', () => {
  beforeAll(async () => { await setupHarness(['', '', ''], { productionBasicWeights: true }) })

  it('auto-1371-1481-1451 C1→C2：Σ slots === dmg 逐点成立，Σ槽增量 === 全队增量', async () => {
    const [a, b] = await scanPair('auto-1371-1481-1451', 1, 2)
    for (const f of [a, b]) {
      const scanned = f.points.filter(p => p.scanned)
      expect(scanned.length, '反空洞：必须有求值过的点').toBeGreaterThan(1)
      for (const p of scanned) {
        const sum = p.slots.reduce((x, y) => x + y, 0)
        expect(p.slots.length, `K${p.k} 的逐槽数组长度应等于队伍槽数`).toBe(3)
        expect(Math.abs(sum - p.dmg) / Math.max(1, p.dmg), `K${p.k} 逐槽之和应等于该帧伤害`).toBeLessThan(1e-9)
        // 反空洞：逐槽读数不能是「全挂在一个槽上」的空壳
        expect(p.slots.filter(x => x > 0).length, `K${p.k} 至少两个槽有伤害`).toBeGreaterThan(1)
      }
    }
    const d = computeSlotDeltas(a.delivery.slots, b.delivery.slots)
    const sumDelta = d.reduce((x, y) => x + y.delta, 0)
    const totalDelta = b.delivery.dmg - a.delivery.dmg
    expect(Math.abs(sumDelta - totalDelta), 'Σ槽增量必须 == 全队增量').toBeLessThan(1e-6)
    // 交付帧的逐槽之和也必须 == 交付伤害（不是「另一个帧的槽数据」）
    expect(Math.abs(a.delivery.slots.reduce((x, y) => x + y, 0) - a.delivery.dmg)).toBeLessThan(1e-6)
    expect(Math.abs(b.delivery.slots.reduce((x, y) => x + y, 0) - b.delivery.dmg)).toBeLessThan(1e-6)
  }, 300_000)
})

describe('判据①b：投影 off 口径（难度曲线基线）下恒等式同样成立', () => {
  beforeAll(async () => { await setupHarness(['', '', ''], { productionBasicWeights: true }) })

  it('clearDifficultyLevers 之后：Σ slots === dmg 逐点成立，Σ槽增量 === 全队增量', async () => {
    const preset = teamPresets.find(p => p.id === 'auto-1371-1481-1451')!
    let a: KFrontier | null = null
    let b: KFrontier | null = null
    await withAnalysisScenario(async s => {
      clearDifficultyLevers({ config: s.config, calc: s.calc })
      applyTeamToStore(s.config, preset)
      a = await scanKFrontier(s, { cinemaLevel: 1 })
      s.config.setCinemaLevel(0, 2)
      s.config.syncTeammateBuffsFromTeam()
      b = await scanKFrontier(s, { cinemaLevel: 2 })
    })
    expect(a && b, '前沿没扫出来').toBeTruthy()
    for (const f of [a!, b!]) {
      for (const pt of f.points.filter(x => x.scanned)) {
        expect(Math.abs(pt.slots.reduce((x, y) => x + y, 0) - pt.dmg) / Math.max(1, pt.dmg)).toBeLessThan(1e-9)
      }
    }
    const d = computeSlotDeltas(a!.delivery.slots, b!.delivery.slots)
    expect(Math.abs(d.reduce((x, y) => x + y.delta, 0) - (b!.delivery.dmg - a!.delivery.dmg))).toBeLessThan(1e-6)
    // 反空洞：off 口径下也不是全零
    expect(d.some(x => Math.abs(x.delta) > 1e-6), 'off 口径也要有非零逐槽增量').toBe(true)
  }, 300_000)
})

describe('判据②：结构看得见 —— 仪玄 C1→C2 本槽涨、队友跌、合计几乎为零', () => {
  beforeAll(async () => { await setupHarness(['', '', ''], { productionBasicWeights: true }) })

  it('本槽 +1.46%、队友 −6.2%、合计 −0.03%（用户点名的那一格）', async () => {
    const [a, b] = await scanPair('auto-1371-1481-1451', 1, 2)
    const d = computeSlotDeltas(a.delivery.slots, b.delivery.slots)
    const main = d.find(x => x.slot === 0)!
    const mates = d.filter(x => x.slot !== 0)
    const matePct = (mates.reduce((s, x) => s + x.after, 0) / mates.reduce((s, x) => s + x.before, 0) - 1) * 100
    const totalPct = (b.delivery.dmg / a.delivery.dmg - 1) * 100

    // 本槽涨、队友跌 —— 这就是「全队 −0.03%」底下被藏掉的结构
    expect(main.pct, '本槽应上涨').toBeGreaterThan(0.5)
    expect(main.pct!).toBeLessThan(3)
    expect(matePct, '队友应下跌').toBeLessThan(-3)
    // 合计：正负相抵 ⇒ 全队读数几乎为零（±0.5% 内）
    expect(Math.abs(totalPct), '全队合计应接近 0').toBeLessThan(0.5)
    // 三槽符号不同 ⇒ 单看合计会把方向读反（反空洞：本判据不是「三个槽都涨」也能过）
    expect(Math.sign(main.pct!) * Math.sign(matePct)).toBe(-1)

    // 页面印的那一行必须与数据一致（不许页面另拼一套数）
    const summary = buildSlotSummary(d, 0)
    expect(summary).toContain('本槽 +1.5%')
    expect(summary).toContain('队友 -6.2%')
  }, 300_000)
})

describe('判据③：交付点掉窗必须被点名（K3→K2 不是「命座变弱」）', () => {
  beforeAll(async () => { await setupHarness(['', '', ''], { productionBasicWeights: true }) })

  it('auto-1501-1511-1491 C3→C4：交付 −10.14%，同 K2 仍 +9.4%，断点差 0.042 窗', async () => {
    const [a, b] = await scanPair('auto-1501-1511-1491', 3, 4)
    const sameK = compareAtSameK(a, b, a.delivery.k)
    const band = sameKBand(a, b)

    // 交付点确实掉了一个窗，且这就是负值的来源
    expect(a.delivery.k).toBe(3)
    expect(b.delivery.k).toBe(2)
    expect((b.delivery.dmg / a.delivery.dmg - 1) * 100, '交付点口径应为负').toBeLessThan(-5)
    // 同 K 口径是正的 ⇒ 掉的是**操作强度**，不是同 K 收益
    expect(sameK.pct, '同 K 提升应为正').toBeGreaterThan(5)
    expect(sameK.k).toBe(2)
    expect(sameK.atPreferred, '首选 K3 在后一级不可行 ⇒ 已下探').toBe(false)

    // 断点带出「差多少窗」：整数门槛下这是唯一能分辨「门槛抖动」与「真墙」的读数
    const brk = band.points.find(p => p.k === 3)!
    expect(brk.bothFeasible).toBe(false)
    expect(brk.afterReject).toBe('contiguous')
    expect(brk.afterContiguous!).toBeGreaterThan(2.9)
    expect(brk.afterContiguous!).toBeLessThan(3)
    expect(brk.afterGap!).toBeLessThan(0)
    expect(brk.afterGap!).toBeGreaterThan(-0.1)

  }, 300_000)

  it('页面路径（analyzeCinemaUplift, frontier: true）：掉窗那行的字符串由 readFrontier 拼出', async () => {
    const preset = teamPresets.find(p => p.id === 'auto-1501-1511-1491')!
    let note = ''
    let noteAt3 = ''
    let noteAt1 = ''
    let slotSummary = ''
    await withAnalysisScenario(async s => {
      applyTeamToStore(s.config, preset)
      const rows = await analyzeCinemaUplift(s, { targetStunCount: 0, frontier: true, slots: [0], maxLevel: 4 })
      const entries = rows[0]!.entries
      note = entries.find(x => x.to === 4)!.frontier!.deliveryNote
      noteAt3 = entries.find(x => x.to === 3)!.frontier!.deliveryNote
      noteAt1 = entries.find(x => x.to === 1)!.frontier!.deliveryNote
      slotSummary = entries.find(x => x.to === 4)!.frontier!.slotSummary
    })
    // 掉窗：必须点名 K 的移动，并给出「同 K 仍为正」的对照（这正是负号被误读的那一层）
    expect(note).toContain('掉窗 K3→K2')
    expect(note).toContain('同 K2')
    expect(note).toMatch(/\+\d/)
    // 反向对照：K 上升时印「增窗」、K 不变时不印（否则这行字是恒真的装饰）
    expect(noteAt3).toContain('增窗')
    expect(noteAt1).toBe('')
    // 逐槽读数也在页面的那条路径上
    expect(slotSummary).toContain('本槽')
    expect(slotSummary).toContain('队友')
  }, 600_000)
})
