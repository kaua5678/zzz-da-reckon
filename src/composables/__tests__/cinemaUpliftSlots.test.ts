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
import { sameKBand, scanKFrontier } from '@/composables/cinemaUpliftFrontier'
import { analyzeCinemaUplift, buildDeliveryNote, buildSlotSummary, computeSlotDeltas } from '@/composables/cinemaUplift'
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

describe('判据⓪：掉窗注记的三态（纯函数，不依赖某个预设是否还掉窗）', () => {
  const sameK = (k: number, pct: number | null) => ({
    k, preferredK: k, atPreferred: true, beforeDmg: 1, afterDmg: 1, pct, preferredReason: null,
  })

  it('掉窗：点名 K 的移动 + 同 K 对照；增窗/不变成对应文案', () => {
    expect(buildDeliveryNote(3, 2, sameK(2, 9.4))).toBe('掉窗 K3→K2（同 K2 仍 +9.4%）')
    expect(buildDeliveryNote(3, 2, sameK(2, null)), '同 K 不可比时不编数字').toBe('掉窗 K3→K2')
    expect(buildDeliveryNote(2, 3, sameK(3, 5))).toBe('增窗 K2→K3')
    expect(buildDeliveryNote(3, 3, sameK(3, 5)), '没移动就不印（否则是恒真的装饰）').toBe('')
  })
})

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

describe('判据②：结构看得见 —— 仪玄 C1→C2 本槽远高于队友', () => {
  beforeAll(async () => { await setupHarness(['', '', ''], { productionBasicWeights: true }) })

  it('本槽 +14.1%、队友合计 +0.9%、槽2 −1.0%（合计 −0.03% 那一版已随连续失衡消失）', async () => {
    const [a, b] = await scanPair('auto-1371-1481-1451', 1, 2)
    const d = computeSlotDeltas(a.delivery.slots, b.delivery.slots)
    const main = d.find(x => x.slot === 0)!
    const mates = d.filter(x => x.slot !== 0)
    const matePct = (mates.reduce((s, x) => s + x.after, 0) / mates.reduce((s, x) => s + x.before, 0) - 1) * 100
    const totalPct = (b.delivery.dmg / a.delivery.dmg - 1) * 100

    /**
     * 2026-11-07 连续失衡落地后，这一级的交付从 K2 变成 K3（末窗截短 1.95s），
     * 于是用户最早点名的「全队 −0.03% / 本槽 +1.46%」不再出现；**结构本身仍然在**：
     * 本槽 +14.1% 与队友合计 +0.9% 差 13pp，且槽 2 是负的（−1.0%）⇒ 单看合计会把队伍结构读平。
     */
    expect(main.pct, '本槽应明显上涨').toBeGreaterThan(10)
    expect(Math.abs(main.pct! - matePct), '本槽与队友合计必须分得开（否则这一行没意义）').toBeGreaterThan(8)
    expect(totalPct, '全队合计为正').toBeGreaterThan(5)
    // 至少一个队友槽与主槽符号相反 ⇒ 合计会掩盖反向的那一槽（反空洞）
    expect(d.filter(x => x.slot !== 0).some(x => x.pct !== null && Math.sign(x.pct) !== Math.sign(main.pct!))).toBe(true)

    // 页面印的那一行必须与数据一致（不许页面另拼一套数）
    const summary = buildSlotSummary(d, 0)
    expect(summary).toContain('本槽 +14.1%')
    expect(summary).toContain('队友 +0.9%')
  }, 300_000)
})

describe('判据③：交付点不再掉窗（连续失衡落地后），真掉窗的仍被点名', () => {
  beforeAll(async () => { await setupHarness(['', '', ''], { productionBasicWeights: true }) })

  it('auto-1501-1511-1491 C3→C4：末窗截短 1.5s 后交付仍在 K3，读数转正', async () => {
    const [a, b] = await scanPair('auto-1501-1511-1491', 3, 4)
    const band = sameKBand(a, b)

    // 2026-11-07 前这里是 K3→K2、交付 −10.14%；连续失衡落地后第 3 窗「开了但短 1.5s」⇒ 不掉窗
    const p3 = b.points.find(p => p.k === 3)!
    expect(p3.continuous).toBe(true)
    expect(p3.feasible).toBe(true)
    expect(a.delivery.k).toBe(3)
    expect(b.delivery.k).toBe(3)
    expect((b.delivery.dmg / a.delivery.dmg - 1) * 100, '交付点口径应转正').toBeGreaterThan(2)

    // 分布条：K3 现在两级都可行；真正的断点在 K4（攒条差 1.7 窗，远超一窗 ⇒ 不许凑）
    expect(band.points.find(p => p.k === 3)!.bothFeasible).toBe(true)
    const brk = band.points.find(p => p.k === 4)!
    expect(brk.bothFeasible).toBe(false)
    expect(brk.afterReject).toBe('contiguous')
    expect(brk.afterGap!).toBeLessThan(-1)
  }, 300_000)

  it('页面路径（analyzeCinemaUplift, frontier: true）：逐槽读数与掉窗字符串都走同一条路径', async () => {
    // 连续失衡落地后，这一队的 K3 不再掉窗（末窗截短 1.5s）⇒ 页面上的掉窗注记应为空，
    // 「掉窗」那条分支改由下面的纯函数判据守住（见「掉窗注记的三态」）。
    const preset = teamPresets.find(p => p.id === 'auto-1501-1511-1491')!
    let note = ''
    let slotSummary = ''
    await withAnalysisScenario(async s => {
      applyTeamToStore(s.config, preset)
      const rows = await analyzeCinemaUplift(s, { targetStunCount: 0, frontier: true, slots: [0], maxLevel: 4 })
      const entries = rows[0]!.entries
      note = entries.find(x => x.to === 4)!.frontier!.deliveryNote
      slotSummary = entries.find(x => x.to === 4)!.frontier!.slotSummary
    })
    expect(note, 'K3→K3：没有掉窗就不印注记').toBe('')
    // 「增窗」分支已由上面的纯函数判据覆盖（这一队现在各级都交付在同 K，没有真实预设可测）
    expect(slotSummary).toContain('本槽')
    expect(slotSummary).toContain('队友')
  }, 600_000)
})
