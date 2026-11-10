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
import { useCatalogStore } from '@/stores/catalog'
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
describe('击破侧：主评分 = 固定失衡下的静态值，连续失衡贡献单列（用户口径 2026-11-09）', () => {
  /**
   * ★ 本组核心判据。用户 2026-11-09 裁决（逐字）：
   * 「评分在固定失衡的情况下算的是静态值，是多数情况下的主要观察目标，他直观表达了这个词条的总伤精进。
   *   当然连续失衡在 6 号冲击盘或者转模影响连续失衡的情况下需要额外算一份数据……
   *   这一步是为了让人分辨你的原始评分和特殊条件下的评分，防止用户被特殊评分误导。」
   *
   * 夹具（琉音 1481 + 简 1021 + 妮可 1031，只投 critRate:9）实测：
   *   0 词条帧 cont **3.46873** / δ **16.541s** / 覆盖率 0.3081（末窗只分到 1.46s）
   *   crit 帧   cont **4.08176** / δ **0**      / 覆盖率 0.4000（末窗被填满）
   * ⇒ 整数次数都是 4，但那 6.99pp 是**连续失衡兑现**，不是属性收益。
   *
   * ⚠ **断言已于本卡重锚**（用户裁决改口径，不是为了让数字好看）：旧断言写的是「入口门关闭口径」的
   *   zeroAxis 3 / delta 1 / jump>10 —— 入口门默认开启后该夹具不再跨整数 K。新断言**更严**：
   *   新增「两帧覆盖率逐位相同」这条**冻结不变量**（旧版没有，正是漏口所在）。
   */
  it('★ 主评分冻结失衡状态（静态值），连续失衡贡献单列', async () => {
    const h = await setupHarness([{ agentId: '1481' }, { agentId: '1021' }, { agentId: '1031' }], { recommendedBuild: true })
    h.config.team[0].driveDisc.subStatAllocation = { critRate: 9 }
    await flush()
    const r = await withAnalysisScenario(s => scoreSubstats(s, { slot: 0 }), h.config)
    // ① 冻结不变量（新）：两帧必须处在**同一个**失衡状态 —— 次数相同 **且** 覆盖率逐位相同
    expect(r.zeroAxis.stunCount, '两次基线必须锁在同一次数上').toBe(r.currentAxis.stunCount)
    expect(r.zeroAxis.coverage, '冻结后两帧覆盖率必须逐位相同（同次数下 cont 不同 = 漏口）')
      .toBeCloseTo(r.currentAxis.coverage, 12)
    expect(r.axisChanged, '冻结后不该再报「跨轴态」').toBe(false)
    // ② 主评分是**静态值**：严格小于自由口径（连续失衡那笔不许混进来）
    expect(r.gainPct, '静态值必须严格低于自由口径').toBeLessThan(r.stunOutput.freeformGainPct)
    // ③ 连续失衡贡献单列，且与「自由 − 静态」恒等（同一笔钱只记一次）
    const cont = r.stunOutput.continuous
    expect(cont.frozenStunCount, '冻结次数 = 主评分锁的次数').toBe(r.zeroAxis.stunCount)
    expect(cont.crossedCritical, '这套词条把末窗填满 ⇒ 属于「临界」').toBe(true)
    expect(cont.clipDeltaSeconds, 'δ 必须从 16.5s 降到 0').toBeGreaterThan(10)
    expect(cont.gainPct).toBeCloseTo(r.stunOutput.jumpGainPct, 10)
    expect(r.stunOutput.jumpGainPct, '连续失衡贡献必须显著').toBeGreaterThan(5)
    // ④ 静态值远小于自由口径（「特殊条件评分」不许冒充原始评分）
    expect(r.gainPct).toBeLessThan(r.stunOutput.freeformGainPct / 3)
    // ⑤ 闭合：Σ 逐条 ≡ 主评分
    const sum = r.contributions.reduce((a, c) => a + c.pct, 0)
    expect(sum).toBeCloseTo(r.gainPct, 8)
  }, 180000)

  it('★ 没跨阈值的队：stunOutput 全零、两口径相等（反空洞）', async () => {
    const h = await setupHarness([{ agentId: '1261' }, { agentId: '1221' }, { agentId: '1171' }], { recommendedBuild: true })
    await flush()
    const r = await withAnalysisScenario(s => scoreSubstats(s, { slot: 0 }), h.config)
    expect(r.stunOutput.stunCountDelta).toBe(0)
    expect(r.stunOutput.jumpGainPct).toBeCloseTo(0, 6)
    expect(r.gainPct).toBeCloseTo(r.stunOutput.freeformGainPct, 6)
  }, 180000)

  it('锁定是临时状态：跑完 stunCountLock / stunClipLock 都必须还原', async () => {
    const h = await setupHarness([{ agentId: '1481' }, { agentId: '1021' }, { agentId: '1031' }], { recommendedBuild: true })
    h.config.team[0].driveDisc.subStatAllocation = { critRate: 9 }
    h.config.enemy.stunCountLock = -1
    h.config.enemy.stunClipLock = undefined
    await flush()
    await withAnalysisScenario(s => scoreSubstats(s, { slot: 0 }), h.config)
    expect(h.config.enemy.stunCountLock, '场景内锁过，跑完必须还原').toBe(-1)
    expect(h.config.enemy.stunClipLock, '冻结的 δ 也是临时状态，跑完必须还原').toBeUndefined()
  }, 180000)
})
describe('配装 A/B：换音擎 / 换精炼（用户口径 2026-10-23）', () => {
  it('★ 换精炼档：差值为正、diff 精确报「精炼」一栏', async () => {
    const h = await anomalyHarness()
    const base = await withAnalysisScenario(async (s) => readDiscPlan(0, s.config.team), h.config)
    // 该队配装推荐带专武 ⇒ 有音擎可比
    expect(base.wEngineId, '夹具前提：推荐配装带音擎').toBeTruthy()
    const low: DiscPlan = { ...base, wEngineModLevel: 1 }
    const high: DiscPlan = { ...base, wEngineModLevel: 5 }
    const cmp = await withAnalysisScenario(s => compareDiscPlans(s, { slot: 0, a: low, b: high }), h.config)
    expect(cmp.reason).toBe('')
    expect(cmp.deltaTeamPct, '提高精炼 ⇒ 伤害提升').toBeGreaterThan(0)
    const kinds = cmp.diff.map(d => d.kind)
    expect(kinds).toEqual(['精炼'])
    expect(cmp.diff[0]).toMatchObject({ a: 'R1', b: 'R5' })
  }, 180000)

  it('★ 换音擎：diff 报「音擎」一栏（换武器 ≠ 换精炼）', async () => {
    const h = await anomalyHarness()
    const base = await withAnalysisScenario(async (s) => readDiscPlan(0, s.config.team), h.config)
    const catalog = useCatalogStore()
    const other = catalog.displayWEngines.find(w => w.id !== base.wEngineId && w.rarity === 'S')!
    expect(other, '夹具前提：目录里还有别的 S 音擎').toBeTruthy()
    const otherPlan: DiscPlan = { ...base, wEngineId: other.id, wEngineModLevel: 1 }
    const cmp = await withAnalysisScenario(s => compareDiscPlans(s, { slot: 0, a: base, b: otherPlan }), h.config)
    expect(cmp.reason).toBe('')
    const kinds = cmp.diff.map(d => d.kind).sort()
    // 换了一把且精炼也动了 ⇒ 两栏都报（这是「换武器」与「换精炼」分开的意义）
    expect(kinds).toContain('音擎')
    const engineRow = cmp.diff.find(d => d.kind === '音擎')!
    expect(engineRow.a).not.toBe(engineRow.b)
  }, 180000)

  /**
   * 用户 2026-10-26 报障：「诺姆带精5人为刀俎 vs 精1专武，全队 +20% / 个人 +60%，
   * 12.5% 火抗和 25% 增伤怎么提升 60% 的？」
   *
   * 根因：换音擎会改**冲击力 → 失衡次数**，而 A/B 对比原先是**自由收敛**（不锁次数）
   * ⇒ 多打的那一次失衡把百分比抬高了一个量级。与 scoreSubstats 的处置同源，改为锁 A 的次数。
   *
   * 判据（负控）：换成会改冲击力的武器时，必须
   *   ① 报出 stunCountDelta ≠ 0；② 锁口径 < 自由口径；③ 锁口径 = 两边同次数下的比值。
   */
  it('★ 锁失衡次数：换冲击力武器时，自由口径的离散跳变要被拆出来（用户 2026-10-26 报障）', async () => {
    const h = await setupHarness([{ agentId: '1611' }, { agentId: '1571' }, { agentId: '1211' }], { recommendedBuild: true })
    h.config.enemy.stunCountLock = -1
    await flush()
    // 诺姆（槽位 1）：⚠ 2026-10-28 夹具武器对重选（残差分摊删除 ⇒ 失衡次数整体上移，
    // 旧对 13005x5→14157x1 的 stunCountDelta 变 0）。新对 = A 精1 首席跟班(13002，低冲击)
    // vs B（2026-11-08 起）精1 14148：实测 delta +1（4→5），锁口径按 A 的 4 次。
    const base = await withAnalysisScenario(async (s) => readDiscPlan(1, s.config.team), h.config)
    const a: DiscPlan = { ...base, wEngineId: '13002', wEngineModLevel: 1 }
    // ⚠ 2026-11-08：入口门默认开后 13005x5 的失衡次数与 13002x1 **都落到 4**（delta 0 ⇒ 夹具前提失效）。
    //   全槽实扫（`.zc/perf` 探针）取一对仍跨档的：13002x1 = stun 4，14148x1 = stun 5 ⇒ delta +1。
    //   判据（①delta>0 ②锁口径<自由 ③锁口径=同次数比值）一字未改，只换夹具武器对。
    const b: DiscPlan = { ...base, wEngineId: '14148', wEngineModLevel: 1 }
    const cmp = await withAnalysisScenario(s => compareDiscPlans(s, { slot: 1, a, b }), h.config)
    expect(cmp.reason).toBe('')
    expect(cmp.complete).toBe(true)
    // ① 这把武器确实改了冲击力 ⇒ 自由收敛多打一次失衡（夹具前提，不是断言结果方向）
    expect(cmp.stunCountDelta, '夹具前提：13002x1→13005x5 会改变失衡次数').toBeGreaterThan(0)
    expect(cmp.stunLock).toBeGreaterThanOrEqual(0)
    // ② 锁口径 = 两边**同次数**（这才是「只比配装」）；自由口径混入了次数变化
    expect(cmp.aStunCount, '锁口径下 A 的次数 = 锁定值').toBe(cmp.stunLock)
    expect(cmp.bStunCount, '锁口径下 B 的次数 = 锁定值（不是它自己收敛的次数）').toBe(cmp.stunLock)
    // ③ 次数变了 ⇒ 两个口径必然不同（反空洞：若相同就说明锁没生效）
    expect(cmp.deltaTeamPct, '次数不同 ⇒ 锁/自由口径必须不同').not.toBeCloseTo(cmp.freeformDeltaTeamPct, 6)
    // ④ 锁口径就是两边伤害之比（口径自洽）
    expect(cmp.deltaTeamPct).toBeCloseTo((cmp.bTeam / cmp.aTeam - 1) * 100, 10)
    expect(cmp.deltaOwnPct).toBeCloseTo((cmp.bOwn / cmp.aOwn - 1) * 100, 10)
    // ⑥ 连续失衡侧单列（用户裁决 2026-11-09）：主口径冻结在 A 的 (次数, δ) 上，B 的推进不许混进去
    const cont = cmp.continuous
    expect(cont.frozenStunCount, '冻结次数 = A 的收敛次数（= 主口径锁值）').toBe(cmp.stunLock)
    expect(cont.clipDeltaSeconds, 'δ 推进 = A 的 δ − B 的 δ（自洽）')
      .toBeCloseTo(cont.frozenClipSeconds - cont.bFreeClipSeconds, 10)
    expect(cont.gainPct, '连续失衡贡献 ≡ 自由口径 − 主口径（同一笔钱只记一次）')
      .toBeCloseTo(cmp.freeformDeltaTeamPct - cmp.deltaTeamPct, 10)
    // ⑤ 跑完不许留锁（δ 也一样）
    expect(h.config.enemy.stunCountLock, '场景内锁过，跑完必须还原').toBe(-1)
    expect(h.config.enemy.stunClipLock, '冻结的 δ 也是临时状态，跑完必须还原').toBeUndefined()
  }, 180000)

  it('★ A vs A 在锁口径下恒 0（反空洞：锁定本身不能制造差值）', async () => {
    const h = await setupHarness([{ agentId: '1611' }, { agentId: '1571' }, { agentId: '1211' }], { recommendedBuild: true })
    h.config.enemy.stunCountLock = -1
    await flush()
    const plan = await withAnalysisScenario(async (s) => readDiscPlan(1, s.config.team), h.config)
    const cmp = await withAnalysisScenario(s => compareDiscPlans(s, { slot: 1, a: plan, b: plan }), h.config)
    expect(cmp.deltaTeamPct).toBe(0)
    expect(cmp.deltaOwnPct).toBe(0)
    expect(cmp.freeformDeltaTeamPct).toBe(0)
    expect(cmp.freeformDeltaOwnPct).toBe(0)
    expect(cmp.stunCountDelta).toBe(0)
    expect(h.config.enemy.stunCountLock).toBe(-1)
  }, 180000)

  it('★ 音擎是临时状态：跑完必须还原（防污染现场）', async () => {
    const h = await anomalyHarness()
    const before = { id: h.config.team[0].wEngineId, mod: h.config.team[0].wEngineModLevel }
    const base = await withAnalysisScenario(async (s) => readDiscPlan(0, s.config.team), h.config)
    const mutated: DiscPlan = { ...base, wEngineModLevel: 3 }
    await withAnalysisScenario(s => compareDiscPlans(s, { slot: 0, a: mutated, b: base }), h.config)
    expect(h.config.team[0].wEngineId).toBe(before.id)
    expect(h.config.team[0].wEngineModLevel).toBe(before.mod)
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
