/**
 * **连续失衡：末窗时钟截短**（用户 2026-11-01 裁明机制；2026-11-07 追问「尾窗残疾表现出来了吗」）。
 *
 * 机制：满条开出 K 窗后，若「非失衡攒条时间 + K×W」超过有效战斗时间，**溢出从最后一窗的时间里丢掉**
 * ——第 K 窗不是「没开」，而是「开了但被时钟截短」。
 *
 * 兑现在这里不需要新机制：`stunWindowFraction(plan, W, eff) = plan·W/eff` 本来就吃小数计划，
 * 所以「末窗只有 W−δ 秒」= 计划窗数 `plan = K − δ/W`（实测 2.5 窗 ⇒ 覆盖 34.72% 逐位成立）。
 *
 * 判据守三件事：
 * ① 该截的截：`auto-1501-1511-1491` C4 的 K=3（cont 2.958 < 3）必须变成**可行**，且 clip ∈ (1,2) 秒；
 * ② 不该给的不给（负控）：K=4（cont 2.288）截短量远超一窗 ⇒ **仍不可行**，不许把打不出来的窗也算上；
 * ③ 交付转正：C3→C4 从 −10.14% 变正（等价地：同一批数据上 K3 的伤害必须 > K2 的伤害）。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { applyTeamToStore } from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'
import { scanKFrontier, type KFrontier } from '@/composables/cinemaUpliftFrontier'

async function fronts(presetId: string, from: number, to: number): Promise<[KFrontier, KFrontier]> {
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

describe('判据①：攒满但时间装不下的 K，按「末窗截短」兑现', () => {
  beforeAll(async () => { await setupHarness(['', '', ''], { productionBasicWeights: true }) })

  it('auto-1501-1511-1491 C4 K=3：cont 2.958 < 3，clip ≈1.5s ⇒ 可行', async () => {
    const [, c4] = await fronts('auto-1501-1511-1491', 3, 4)
    const p3 = c4.points.find(p => p.k === 3)!
    // 整数口径下这一窗攒不出（判据左边 < K）——这是截短的**前提**
    expect(p3.contiguous).toBeLessThan(3)
    expect(p3.contiguous).toBeGreaterThan(2.9)
    // 但时间上只差一点点 ⇒ 截短后可行，且记下截了多少、按几个窗兑现
    expect(p3.continuous, 'K=3 应走连续失衡').toBe(true)
    expect(p3.feasible).toBe(true)
    expect(p3.clip).toBeGreaterThan(0.5)
    expect(p3.clip).toBeLessThan(2.5)
    expect(p3.plan).toBeGreaterThan(2.85)
    expect(p3.plan).toBeLessThan(3)
    // 反空洞：这一帧的伤害必须是真算出来的（> K2 的伤害），不是一个占位
    const p2 = c4.points.find(p => p.k === 2)!
    expect(p3.dmg).toBeGreaterThan(p2.dmg)
  }, 300_000)

  it('banyue-roxy-lucia C2 K=3：同理（clip ≈1.07s）', async () => {
    const [, c2] = await fronts('banyue-roxy-lucia', 1, 2)
    const p3 = c2.points.find(p => p.k === 3)!
    expect(p3.contiguous).toBeLessThan(3)
    expect(p3.continuous).toBe(true)
    expect(p3.feasible).toBe(true)
    expect(p3.clip).toBeGreaterThan(0.3)
    expect(p3.clip).toBeLessThan(2)
  }, 300_000)
})

describe('判据①b：舍入级的缺口也要兑现（0.004 窗 = 0.18s）', () => {
  beforeAll(async () => { await setupHarness(['', '', ''], { productionBasicWeights: true }) })

  it('auto-1371-1481-1451 C3→C4：C4 的 K3 缺口只有 0.004 窗 ⇒ 截短 0.18s 后可行，读数转正', async () => {
    const [c3, c4] = await fronts('auto-1371-1481-1451', 3, 4)
    const p3 = c4.points.find(x => x.k === 3)!
    expect(p3.contiguous).toBeLessThan(3)
    expect(3 - p3.contiguous).toBeLessThan(0.05)
    expect(p3.continuous, '舍入级缺口也应走截短，而不是判死').toBe(true)
    expect(p3.clip).toBeLessThan(0.5)
    expect((c4.delivery.dmg / c3.delivery.dmg - 1) * 100, '这一级不许因为 0.004 窗掉整窗').toBeGreaterThan(0)
  }, 300_000)
})

describe('判据②：负控——截短量 ≥ 一窗时不采纳', () => {
  beforeAll(async () => { await setupHarness(['', '', ''], { productionBasicWeights: true }) })

  it('auto-1501-1511-1491 C4 K=4：cont 2.288，缺口远超一窗 ⇒ 仍不可行', async () => {
    const [, c4] = await fronts('auto-1501-1511-1491', 3, 4)
    const p4 = c4.points.find(p => p.k === 4)!
    expect(p4.contiguous).toBeLessThan(2.5)
    expect(p4.continuous, '缺口 > 一窗时不该硬凑').toBe(false)
    expect(p4.clip).toBe(0)
    expect(p4.plan).toBe(4)
    expect(p4.feasible).toBe(false)
    expect(p4.rejectReason).toBe('contiguous')
  }, 300_000)
})

describe('判据③：交付转正（原来 −10.14% 的那一级）', () => {
  beforeAll(async () => { await setupHarness(['', '', ''], { productionBasicWeights: true }) })

  it('auto-1501-1511-1491 C3→C4 交付点提升率必须 > 0', async () => {
    const [c3, c4] = await fronts('auto-1501-1511-1491', 3, 4)
    const pct = (c4.delivery.dmg / c3.delivery.dmg - 1) * 100
    expect(c3.delivery.k).toBe(3)
    expect(c4.delivery.k, 'C4 应交付在 K3（末窗截短）而不是退回 K2').toBe(3)
    expect(pct, '交付点口径应转正').toBeGreaterThan(2)
    expect(pct).toBeLessThan(12)
  }, 300_000)
})
