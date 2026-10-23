/**
 * 副词条评分（`composables/substatScore`）判据。
 *
 * 三面：
 * ① **有效性**：Σ 逐词条贡献 ≡ 评分（Shapley 公理，防「拆解和 ≠ 总分」）；
 * ② **口径**：评分 = 当前 / 0 词条 − 1；0 词条基线的面板确实少了那些词条；
 * ③ **成本与兜底**：子集复用（2^n−1 次求值）、玩家过多时退化按槽位、取消时 complete=false；
 * ④ **不动现场**：跑完源 store 的分配逐字不变（独立场景）；`analysisScenario` 源码锁另外守着。
 *
 * 预算压到单词条 5 步 / 总 6 步（1261+1221+1171 三异常队，n=6）：一次求值 20~30ms，
 * 全子集 63 次 ≈ 1.2–2s。生产预算（20 步 × 3 槽）n 可达 9 ⇒ 511 次 ≈ 10s，由 UI 的显式按钮承担。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { SUBSTAT_CAP_SETTING } from '@/core/substatOptimizer'
import { binom, collectSubstatPlayers, MAX_EXACT_PLAYERS, scoreSubstats, shapleyValues } from '@/composables/substatScore'

const flush = async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)) }

async function anomalyHarness() {
  const h = await setupHarness([{ agentId: '1261' }, { agentId: '1221' }, { agentId: '1171' }], { recommendedBuild: true })
  h.config.setMechanicSetting(SUBSTAT_CAP_SETTING, 5)
  h.config.setMechanicSetting('optimizer.totalSteps2', 6)
  await flush()
  return h
}

describe('副词条评分 · 归并与有效性', () => {
  it('纯函数：binom 与 shapley 权重（单人 / 两人解析值）', async () => {
    expect(binom(3, 0)).toBe(1)
    expect(binom(3, 2)).toBe(3)
    // 两名玩家、无交互（可加）⇒ Shapley 恰好等于各自边际
    const v = new Map<number, number>([[0, 0], [1, 3], [2, 5], [3, 8]])
    const r = await shapleyValues(2, 0, 8, mask => v.get(mask)!)
    expect(r.shap).toEqual([3, 5])
    expect(r.complete).toBe(true)
    expect(r.evals).toBe(3) // 2^2 − 1（空集复用 v0）
  })

  it('纯函数：Σ Shapley ≡ v(全集) − v(∅)（含强交互：min 型函数）', async () => {
    // v = min(Σ 权重, 10)：极端互补，单项边际都低估，Shapley 仍必须可加
    const w = [4, 7, 3]
    const cap = 10
    const val = (mask: number) => Math.min(cap, w.reduce((a, x, i) => a + ((mask >> i) & 1 ? x : 0), 0))
    const v0 = val(0)
    const vAll = val(7)
    const r = await shapleyValues(3, v0, vAll, val)
    const sum = r.shap.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(vAll - v0, 10)
    // 反证：朴素边际（leave-one-out）在本例上**不可加**（正是不能用它的理由）
    const loo = w.map((_, i) => vAll - val(7 ^ (1 << i)))
    expect(loo.reduce((a, b) => a + b, 0)).not.toBeCloseTo(vAll - v0, 6)
  })
})

describe('副词条评分 · 真管线', () => {
  it('★ 评分 = 当前 / 0 词条 − 1，且 Σ 逐词条贡献 ≡ 评分；不动源 store', async () => {
    const h = await anomalyHarness()
    const before = JSON.stringify(h.config.team.map(c => c.driveDisc.subStatAllocation))
    const res = await withAnalysisScenario(s => scoreSubstats(s), h.config)
    expect(res.reason).toBe('')
    expect(res.complete).toBe(true)
    expect(res.coarse).toBe(false)
    expect(res.zeroDamage).toBeGreaterThan(0)
    expect(res.currentDamage).toBeGreaterThan(res.zeroDamage)
    expect(res.gainPct).toBeCloseTo((res.currentDamage / res.zeroDamage - 1) * 100, 10)
    // ① 有效性：拆解和 ≡ 评分（这是"把一切拆开"能成立的前提）
    const sum = res.contributions.reduce((a, c) => a + c.pct, 0)
    expect(sum).toBeCloseTo(res.gainPct, 8)
    // 每个词条都在（玩家 = 槽位 × 词条）
    expect(res.contributions.length).toBeGreaterThan(3)
    for (const c of res.contributions) {
      expect(c.steps).toBeGreaterThan(0)
      expect(Number.isFinite(c.pct)).toBe(true)
    }
    // 份额归一
    const share = res.contributions.reduce((a, c) => a + c.sharePct, 0)
    expect(share).toBeCloseTo(100, 6)
    // ④ 源 store 一字不动（独立场景）
    expect(JSON.stringify(h.config.team.map(c => c.driveDisc.subStatAllocation))).toBe(before)
  }, 180000)

  it('成本可核对：evals = 2^n − 1（子集复用，不重复求值）', async () => {
    const h = await anomalyHarness()
    const players = collectSubstatPlayers(h.config.team)
    const res = await withAnalysisScenario(s => scoreSubstats(s), h.config)
    expect(res.contributions.length).toBe(players.length)
    expect(players.length).toBeLessThanOrEqual(MAX_EXACT_PLAYERS)
    expect(res.evals).toBe((1 << players.length) - 1)
  }, 180000)

  it('轴态签名随两次基线一起返回（跨轴态可见）', async () => {
    const h = await anomalyHarness()
    const res = await withAnalysisScenario(s => scoreSubstats(s), h.config)
    expect(res.zeroAxis.stunCount).toBeGreaterThanOrEqual(0)
    expect(res.currentAxis.stunCount).toBeGreaterThanOrEqual(0)
    // 与本队实测一致：词条**没有**改失衡次数（132 步异常精通/攻击不触冲击力转模）
    expect(res.axisChanged).toBe(false)
  }, 180000)

  it('空队伍 / 无副词条 ⇒ reason 说明，不抛', async () => {
    const h = await setupHarness([{ agentId: '1261' }], {})
    for (const c of h.config.team) c.driveDisc.subStatAllocation = {}
    const res = await withAnalysisScenario(s => scoreSubstats(s), h.config)
    expect(res.reason).toBe('当前队伍没有任何副词条')
    expect(res.contributions).toEqual([])
  }, 180000)
})
