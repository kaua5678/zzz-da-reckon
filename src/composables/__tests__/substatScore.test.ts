/**
 * 副词条评分（`composables/substatScore`）判据。
 *
 * 用户口径 2026-10-23：「副词条评分该算单人的，因为有人要算他对一个角色的词条养成进度。
 *   也有人要比较两套盘子谁的伤害高」⇒ 本文件按**两个用法**分两组：
 *
 * A. 单人评分（主用法）：
 *   ① **口径**：基线只清**该槽位**的词条，队友一个都不动（单人 vs 全队的判别性判据）；
 *   ② **有效性**：Σ 逐词条贡献 ≡ 评分（全队口径 + 该角色自身口径，两个都要闭合）；
 *   ③ **成本**：`evals = 2^n − 1`（n = 该槽词条数，实测 2`4 ⇒ 3`15 次）；
 *   ④ **拆解粒度**：同槽每条词条都必须拿到非零贡献（整槽开关缺陷的防复发判据）；
 *   ⑤ **不动现场**：跑完源 store 逐字不变。
 * B. 两套盘子对比：
 *   ⑥ 换套装 / 主词条 / 副词条 ⇒ 差异逐项列出，伤害差值与「只换这一槽」口径一致；
 *   ⑦ 同一份配置 A vs A ⇒ 差值恒 0、diff 为空（反空洞：差值不是恒非零的填充物）。
 *
 * 预算压到单词条 5 步 / 总 6 步（1261+1221+1171 三异常队）：单人评分 n=2 ⇒ 3 次求值 ≈ 0.1s。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { SUBSTAT_CAP_SETTING } from '@/core/substatOptimizer'
import {
  binom,
  collectSubstatPlayers,
  compareDiscPlans,
  diffDiscPlans,
  MAX_EXACT_PLAYERS,
  readDiscPlan,
  scoreSubstats,
  shapleyValues,
} from '@/composables/substatScore'
import type { DiscPlan } from '@/composables/substatScore'

const flush = async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)) }

async function anomalyHarness() {
  const h = await setupHarness([{ agentId: '1261' }, { agentId: '1221' }, { agentId: '1171' }], { recommendedBuild: true })
  h.config.setMechanicSetting(SUBSTAT_CAP_SETTING, 5)
  h.config.setMechanicSetting('optimizer.totalSteps2', 6)
  await flush()
  return h
}

describe('副词条评分 · 纯函数', () => {
  it('binom / Shapley 权重：两人无交互 ⇒ 各自边际（evals = 2^n − 1）', async () => {
    expect(binom(3, 0)).toBe(1)
    expect(binom(3, 2)).toBe(3)
    const v = new Map<number, number[]>([[0, [0, 0]], [1, [3, 3]], [2, [5, 5]], [3, [8, 8]]])
    const r = await shapleyValues(2, [0, 0], [8, 8], mask => v.get(mask)!)
    expect(r.shap[0]).toEqual([3, 5])
    expect(r.shap[1]).toEqual([3, 5]) // 两个指标各自一套 Shapley，维度不串味
    expect(r.evals).toBe(3)
  })

  it('有效性：Σ Shapley ≡ v(全集) − v(∅)（含 min 型强交互）', async () => {
    // v = min(Σ 权重, 10)：极端互补，单项边际都低估，Shapley 仍必须可加
    const w = [4, 7, 3]
    const cap = 10
    const val = (mask: number) => Math.min(cap, w.reduce((a, x, i) => a + ((mask >> i) & 1 ? x : 0), 0))
    const r = await shapleyValues(3, [val(0)], [val(7)], m => [val(m)])
    const sum = r.shap[0]!.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(val(7) - val(0), 10)
    // 反证：朴素边际（leave-one-out）在本例上**不可加**（正是不能用它的理由）
    const loo = w.map((_, i) => val(7) - val(7 ^ (1 << i)))
    expect(loo.reduce((a, b) => a + b, 0)).not.toBeCloseTo(val(7) - val(0), 6)
  })
})

describe('副词条评分 · 单人（主用法）', () => {
  it('★ 基线只清该槽位：队友词条一字不动（单人 ≠ 全队）', async () => {
    const h = await anomalyHarness()
    const teamBefore = JSON.stringify(h.config.team.map(c => c.driveDisc.subStatAllocation))
    // 全队口径
    const allTeam = await withAnalysisScenario(s => scoreSubstats(s), h.config)
    // 单人口径（槽 0）
    const solo = await withAnalysisScenario(s => scoreSubstats(s, { slot: 0 }), h.config)
    expect(solo.slot).toBe(0)
    expect(allTeam.slot).toBeNull()
    // 单人评分必须**明显不同**于全队评分（否则「只清该槽」没生效，把队友也算进去了）
    expect(solo.gainPct).not.toBeCloseTo(allTeam.gainPct, 3)
    // 单人评分的分母 > 全队分母（队友的词条还在，0 词条基线更高）
    expect(solo.zeroTeam).toBeGreaterThan(allTeam.zeroTeam)
    // 单人评分的分子 = 当前配装（与全队口径同一个数）
    expect(solo.currentTeam).toBeCloseTo(allTeam.currentTeam, 6)
    // ④ 源 store 一字不动
    expect(JSON.stringify(h.config.team.map(c => c.driveDisc.subStatAllocation))).toBe(teamBefore)
  }, 180000)

  it('★ 两个口径都闭合：Σ pct ≡ gainPct、Σ ownPct ≡ ownGainPct；每条词条都非零', async () => {
    const h = await anomalyHarness()
    const res = await withAnalysisScenario(s => scoreSubstats(s, { slot: 0 }), h.config)
    expect(res.reason).toBe('')
    expect(res.complete).toBe(true)
    expect(res.gainPct).toBeCloseTo((res.currentTeam / res.zeroTeam - 1) * 100, 10)
    expect(res.ownGainPct).toBeCloseTo((res.currentOwn / res.zeroOwn - 1) * 100, 10)
    const sumTeam = res.contributions.reduce((a, c) => a + c.pct, 0)
    const sumOwn = res.contributions.reduce((a, c) => a + c.ownPct, 0)
    expect(sumTeam).toBeCloseTo(res.gainPct, 8)
    expect(sumOwn).toBeCloseTo(res.ownGainPct, 8)
    // 拆解粒度：该槽每条词条都必须拿到非零贡献
    for (const c of res.contributions) {
      expect(c.slot).toBe(0)
      expect(c.steps).toBeGreaterThan(0)
      expect(Number.isFinite(c.pct)).toBe(true)
      expect(Math.abs(c.ownPct), c.stat).toBeGreaterThan(1e-9)
    }
    // 分母与分子都取自同一次读（自身伤害 ≤ 全队）
    expect(res.currentOwn).toBeLessThanOrEqual(res.currentTeam + 1e-6)
  }, 180000)

  it('成本：evals = 2^n − 1（n = 该槽词条数）', async () => {
    const h = await anomalyHarness()
    const n = collectSubstatPlayers(h.config.team, [0]).length
    const res = await withAnalysisScenario(s => scoreSubstats(s, { slot: 0 }), h.config)
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(MAX_EXACT_PLAYERS)
    expect(res.contributions.length).toBe(n)
    expect(res.evals).toBe((1 << n) - 1)
  }, 180000)

  it('空槽 / 无副词条 ⇒ reason 说明，不抛', async () => {
    const h = await setupHarness([{ agentId: '1261' }], {})
    for (const c of h.config.team) c.driveDisc.subStatAllocation = {}
    const res = await withAnalysisScenario(s => scoreSubstats(s, { slot: 0 }), h.config)
    expect(res.reason).toBe('该角色没有副词条')
    expect(res.contributions).toEqual([])
  }, 180000)

  it('轴态签名随两次基线一起返回', async () => {
    const h = await anomalyHarness()
    const res = await withAnalysisScenario(s => scoreSubstats(s, { slot: 0 }), h.config)
    expect(res.zeroAxis.stunCount).toBeGreaterThanOrEqual(0)
    expect(res.currentAxis.stunCount).toBeGreaterThanOrEqual(0)
  }, 180000)
})

describe('转模（attributeConversions）必须在评分里被识别与计入', () => {
  /** 诺姆 1571：spec 声明 critRate→critDmg(1.7) 与 critRate→定向失衡(0.8)，阈值 50 / 步长 1 / cap 85 与 40 */
  it('★ 词条的转模被标出来（诺姆：暴击率 → 暴伤 + 定向失衡）', async () => {
    const h = await setupHarness([{ agentId: '1571' }, { agentId: '1481' }, { agentId: '1311' }], { recommendedBuild: true })
    await flush()
    const res = await withAnalysisScenario(s => scoreSubstats(s, { slot: 0 }), h.config)
    expect(res.reason).toBe('')
    // 该角色命中的转模清单来自 spec（单一事实源，不是模块里另抄一份）
    expect(res.conversions.map(c => c.id).sort()).toEqual(['norma_crit_to_critdmg', 'norma_crit_to_stun', 'norma_pen_to_atk'])
    const critRateRow = res.contributions.find(c => c.stat === 'critRate')
    expect(critRateRow, '本队推荐配装给暴击率词条').toBeTruthy()
    // 暴击率词条必须带上「critRate→critDmg / critRate→定向失衡」两条转模痕迹
    const ids = critRateRow!.conversions.map(c => c.id).sort()
    expect(ids).toEqual(['norma_crit_to_critdmg', 'norma_crit_to_stun'])
    for (const c of critRateRow!.conversions) {
      expect(c.sourceStat).toBe('critRate')
      expect(c.steps).toBeGreaterThan(0)
      expect(c.amount).toBeGreaterThan(0)
    }
    // 反空洞：不带转模的词条必须**没有**痕迹（否则「都有」等于没标）
    const plain = res.contributions.filter(c => c.stat !== 'critRate')
    for (const c of plain) expect(c.conversions, `${c.stat} 不该有转模`).toEqual([])
  }, 180000)

  /**
   * ★ **转模的收益必须真的体现在评分里**——这是「记得考虑转模」的机器判据。
   *
   * 诺姆的 critRate 每步在面板上同时给 critDmg(+1.7) 与定向失衡(+0.8)。
   * 判据 = 同一预算下「给 1 步暴击率」的收益 **明显大于** 「给 1 步爆伤」（实测比 ≈ 2.4），
   * 差额只能来自转模（1 步 critDmg 面板只给 4.8% 爆伤，而 1 步 critRate 给 2.4% 暴击 + 转出 4.08% 爆伤）。
   * 若有人把转模从面板层摘掉，本断言立刻红。
   */
  it('★ 转模真的抬高了该词条的评分（暴击率词条 ≫ 爆伤词条）', async () => {
    const measure = async (alloc: Record<string, number>) => {
      const h = await setupHarness([{ agentId: '1571' }, { agentId: '1481' }, { agentId: '1311' }], { recommendedBuild: true })
      h.config.team[0].driveDisc.subStatAllocation = { ...alloc }
      await flush()
      const res = await withAnalysisScenario(s => scoreSubstats(s, { slot: 0 }), h.config)
      return res.ownGainPct
    }
    const critRate = await measure({ critRate: 10 })
    const critDmg = await measure({ critDmg: 10 })
    expect(critRate).toBeGreaterThan(0)
    expect(critDmg).toBeGreaterThan(0)
    // 1 步暴击率的收益 ≈ 1 步爆伤的 2.4 倍（纯面板收益只有 2.4% vs 4.8% ⇒ 靠转模反超）
    const ratio = critRate / critDmg
    expect(ratio, `暴击率/爆伤 收益比实测 ${ratio.toFixed(2)}`).toBeGreaterThan(1.8)
  }, 180000)
})
describe('驱动盘 A/B 对比', () => {
  it('★ 只换这一槽：A vs B 差值与逐项 diff 同源；A vs A 恒 0（反空洞）', async () => {
    const h = await anomalyHarness()
    const base = await withAnalysisScenario(async (s) => {
      const plan = readDiscPlan(0, s.config.team)
      // B = 把槽 0 的「精通」砍掉一半步数（其余一模一样）
      const b: DiscPlan = { ...plan, subStatAllocation: { ...plan.subStatAllocation } }
      const first = Object.keys(b.subStatAllocation)[0]!
      b.subStatAllocation[first] = Math.max(0, (b.subStatAllocation[first] ?? 0) - 2)
      const same = await compareDiscPlans(s, { slot: 0, a: plan, b: plan })
      const diff = await compareDiscPlans(s, { slot: 0, a: plan, b })
      return { plan, b, same, diff, first }
    }, h.config)
    // 反空洞：同一份配置 A vs A ⇒ 差值恒 0、diff 为空
    expect(base.same.deltaTeamPct).toBe(0)
    expect(base.same.deltaOwnPct).toBe(0)
    expect(base.same.diff).toEqual([])
    // 真差异：砍词条 ⇒ 伤害下降（负 delta）、diff 精确列出那一条
    expect(base.diff.deltaTeamPct).toBeLessThan(0)
    expect(base.diff.deltaOwnPct).toBeLessThan(0)
    expect(base.diff.diff).toHaveLength(1)
    expect(base.diff.diff[0]!.kind).toBe('副词条')
    expect(base.diff.stepsA - base.diff.stepsB).toBe(2)
    // 三个口径同源：deltaPct 就是两份伤害之比
    expect(base.diff.deltaTeamPct).toBeCloseTo((base.diff.bTeam / base.diff.aTeam - 1) * 100, 10)
  }, 180000)

  it('diffDiscPlans：套装 / 主词条 / 副词条三类差异都能列出', async () => {
    const h = await anomalyHarness()
    const base = await withAnalysisScenario(async (s) => readDiscPlan(0, s.config.team), h.config)
    const b: DiscPlan = {
      ...base,
      fourPieceSetId: base.fourPieceSetId ? '' : '34200',
      mainStats: { ...base.mainStats, '4': base.mainStats['4'] === 'critRate' ? 'atkPct' : 'critRate' },
      subStatAllocation: { ...base.subStatAllocation, atkFlat: (base.subStatAllocation.atkFlat ?? 0) + 1 },
    }
    // diff 是纯函数（只查 catalog 的名字），不需要场景
    const diff = diffDiscPlans(base, b)
    const kinds = new Set(diff.map(d => d.kind))
    expect(kinds.has('套装4')).toBe(true)
    expect(kinds.has('主词条')).toBe(true)
    expect(kinds.has('副词条')).toBe(true)
  }, 180000)
})
