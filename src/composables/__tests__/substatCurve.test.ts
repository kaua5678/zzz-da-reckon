/**
 * 副词条收益曲线（`composables/substatCurve`）判据。
 *
 * 这张图要回答的是「自动配比为什么这么分」，所以判据分三面：
 * ① **结构**：每条曲线 x 从 1 递增、点内自洽（gainPct = Δ总伤 / 基线）、覆盖全部候选词条；
 * ② **与配比一致**：入选词条的落点 = 配比给的步数，被舍弃词条的首步边际低于「入选词条末步最小值」（门槛）；
 * ③ **可读性派生量**：止损真的省求值、纵轴只按传入（可见）曲线算、默认可见集 = 模板 ∪ 入选。
 *
 * 预算压到 单词条 5 步 / 总 6 步（1261+1221+1171 三异常队）：一次完整求值实测 50–75ms，
 * 十几个采样点 ≈ 2–3s。用生产预算（20×43）跑这个判据要 10s+，而结构判据不依赖预算大小。
 * ⚠ 单词条上限必须**大于**「总步数 ÷ 模板词条数」：否则入选词条全部顶到上限，
 * 「累计(到该步)」与「累计(到上限)」恒等，那条口径判据就失去判别力（实测 cap=3/6 步时正是如此）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { SUBSTAT_CAP_SETTING } from '@/core/substatOptimizer'
import {
  ZERO_GAIN_PCT,
  allocationCutoff,
  allocationMarker,
  curveAxisRange,
  axisChangeNote,
  defaultVisibleStats,
  nextStepMarginals,
  pointGain,
  sampleSubstatCurves,
  substatCurveCandidates,
  substatCurveVerdict,
  type SubstatCurveResult,
  type SubstatCurveSeries,
} from '@/composables/substatCurve'

const flush = async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)) }

/** 三异常队 + 小预算；返回可直接喂 `sampleSubstatCurves` 的场景调用器 */
async function anomalyHarness() {
  const h = await setupHarness([{ agentId: '1261' }, { agentId: '1221' }, { agentId: '1171' }], { recommendedBuild: true })
  h.config.setMechanicSetting(SUBSTAT_CAP_SETTING, 5)
  h.config.setMechanicSetting('optimizer.totalSteps2', 6)
  await flush()
  return h
}

function sample(h: Awaited<ReturnType<typeof anomalyHarness>>, slot = 0): Promise<SubstatCurveResult> {
  return withAnalysisScenario(s => sampleSubstatCurves(s, { slot }), h.config)
}

/** 合成曲线（只测派生量，不花求值成本） */
const STABLE_AXIS = { stunCount: 5, coverage: 0.5 }

/** 合成曲线（只测派生量，不花求值成本）；`axisFrom` = 从第几步起轴态变化（缺省 = 全程不变） */
function synthetic(stat: string, gains: number[], allocatedSteps = 0, axisFrom?: number): SubstatCurveSeries {
  const points = gains.map((gainPct, i) => {
    const changed = axisFrom !== undefined && i + 1 >= axisFrom
    return {
      x: i + 1,
      gainPct,
      // 「相比于上一步」：合成曲线只验结构/派生量，等值即可（真实口径见真实采样用例）
      gainStepPct: gainPct,
      damage: 100 + i,
      axis: changed ? { stunCount: 6, coverage: 0.6 } : STABLE_AXIS,
      axisJump: changed,
    }
  })
  const stable = points.findIndex(p => p.axisJump)
  return {
    stat,
    points,
    allocatedSteps,
    originDamage: 100,
    cumulativePct: points.slice(0, allocatedSteps).reduce((a, p) => a + (p.axisJump ? 0 : p.gainPct), 0),
    cumulativeToCapPct: gains.reduce((a, b) => a + b, 0),
    axisStableSteps: stable < 0 ? points.length : stable,
    axisChangedAt: points.filter(p => p.axisJump).map(p => p.x),
    stopped: false,
  }
}

describe('副词条收益曲线 · 结构与自洽', () => {
  it('覆盖全部候选词条（模板优先），每点 gainPct = Δ总伤 / 基线，且采样不动源 store', async () => {
    const h = await anomalyHarness()
    const before = JSON.stringify(h.config.team[0]!.driveDisc.subStatAllocation)
    const res = await sample(h)
    expect(res.reason).toBe('')
    expect(res.complete).toBe(true)
    expect(res.baseDamage).toBeGreaterThan(0)
    expect(res.series.length).toBeGreaterThan(3)
    // 顺序 = 模板词条在前（`substatCurveCandidates` 的口径），其余池内词条随后
    const pool = (h.catalog.statRules?.driveDisc.subStatPool ?? []) as string[]
    expect(res.series.map(s => s.stat)).toEqual(substatCurveCandidates(h.catalog.getAgent('1261')!, pool))
    expect(res.templateStats.length).toBeGreaterThan(0)
    expect(res.series.slice(0, res.templateStats.length).map(s => s.stat)).toEqual(res.templateStats)
    for (const s of res.series) {
      let prev = s.originDamage
      // 每点 x 从 1 连续递增；gainPct 与 damage 自洽（分母固定 = 基线）
      s.points.forEach((p, i) => {
        expect(p.x, s.stat).toBe(i + 1)
        expect(p.gainPct, s.stat).toBeCloseTo(((p.damage - prev) / res.baseDamage) * 100, 10)
        prev = p.damage
      })
      expect(s.points.length, s.stat).toBeGreaterThan(0)
    }
    // 源 store 的分配没被改写（采样只在独立场景里动）
    expect(JSON.stringify(h.config.team[0]!.driveDisc.subStatAllocation)).toBe(before)
  }, 120000)

  it('空槽 / 无角色 ⇒ reason 说明，不抛', async () => {
    const h = await anomalyHarness()
    // 三异常队没有空槽 ⇒ 用超界槽位号（= 空槽分支）
    const res = await sample(h, 5)
    expect(res.reason).toBe('该槽位没有角色')
    expect(res.series).toEqual([])
  }, 120000)
})

describe('副词条收益曲线 · 与自动配比一致', () => {
  it('入选词条落点 = 配比步数；被舍弃词条首步低于门槛；判定列与门槛同源', async () => {
    const h = await anomalyHarness()
    const res = await sample(h)
    const cutoff = allocationCutoff(res)
    expect(cutoff).not.toBeNull()
    expect(cutoff!).toBeGreaterThan(0)
    const chosen = res.series.filter(s => s.allocatedSteps > 0)
    expect(chosen.length).toBeGreaterThan(0)
    for (const s of res.series) {
      expect(s.allocatedSteps, s.stat).toBe(res.allocation[s.stat] ?? 0)
      const marker = allocationMarker(s)
      if (s.allocatedSteps > 0) {
        // 落点必须落在曲线上，且 x = 配比步数（否则图上的圆点会指向别的步）
        expect(marker, s.stat).not.toBeNull()
        expect(marker!.x).toBe(s.allocatedSteps)
        expect(substatCurveVerdict(s, cutoff)).toBe('chosen')
      } else {
        expect(marker).toBeNull()
      }
    }
    // 门槛 = 入选词条末步边际的最小值
    const tails = chosen.map(s => allocationMarker(s)!.gainPct)
    expect(cutoff).toBeCloseTo(Math.min(...tails), 10)
    // 被舍弃但首步有收益的词条：判定必须是「低于门槛」，否则图与配比矛盾
    for (const s of res.series) {
      const v = substatCurveVerdict(s, cutoff)
      if (v === 'dropped') expect(s.points[0]!.gainPct).toBeLessThan(cutoff!)
      if (v === 'kept-out') expect(s.points[0]!.gainPct).toBeGreaterThanOrEqual(cutoff! - ZERO_GAIN_PCT)
    }
    // 判别力：本样本必须同时存在「入选」与「有收益却未入选」两类，否则上面两条恒真
    expect(res.series.some(s => substatCurveVerdict(s, cutoff) === 'dropped'), '样本里没有『有收益但被舍弃』的词条 ⇒ 判据无判别力').toBe(true)
  }, 120000)

  it('累计口径：cumulativePct 只累到配比步数（与步数列同一件事），cumulativeToCapPct 才到上限', async () => {
    const h = await anomalyHarness()
    const res = await sample(h)
    const chosen = res.series.filter(s => s.allocatedSteps > 0)
    expect(chosen.length).toBeGreaterThan(0)
    for (const s of res.series) {
      const toCap = s.points.reduce((a, p) => a + p.gainPct, 0)
      expect(s.cumulativeToCapPct, `${s.stat} 到上限累计`).toBeCloseTo(toCap, 10)
      const toAlloc = s.points.slice(0, s.allocatedSteps).reduce((a, p) => a + p.gainPct, 0)
      expect(s.cumulativePct, `${s.stat} 到配比步数累计`).toBeCloseTo(toAlloc, 10)
      // 未入选词条：累计(到该步) 必须是 0（不是「到上限」的那个数）——这正是旧口径的错
      if (s.allocatedSteps === 0) expect(s.cumulativePct).toBe(0)
    }
    // 判别力：本样本里必须有「到上限 ≫ 到步数」的词条，否则两列永远相等、这条判据看不出区别
    expect(chosen.some(s => s.cumulativeToCapPct > s.cumulativePct + 0.05),
      '样本里没有『配比步数 < 上限』的入选词条 ⇒ 两列口径无判别力').toBe(true)
  }, 120000)

  it('无收益词条触发止损：点数停在 ZERO_GAIN_RUN，求值次数少于全采', async () => {
    const h = await anomalyHarness()
    const res = await sample(h)
    const flat = res.series.filter(s => s.points.every(p => Math.abs(p.gainPct) <= ZERO_GAIN_PCT))
    expect(flat.length, '三异常队里应当存在对该配装零收益的词条（生存词条），否则本条无判别力').toBeGreaterThan(0)
    for (const s of flat) {
      expect(s.stopped, s.stat).toBe(true)
      expect(s.points.length, s.stat).toBe(2) // ZERO_GAIN_RUN
      expect(s.cumulativePct).toBe(0)
    }
    // 有收益的词条不得被止损截断（止损只砍恒 0 的尾巴）
    const planned = res.series.length * res.statCap
    expect(res.evals).toBeLessThan(planned + res.series.length + 2)
  }, 120000)

  it('取消 ⇒ complete=false，保留已采部分', async () => {
    const h = await anomalyHarness()
    const controller = new AbortController()
    controller.abort()
    const res = await withAnalysisScenario(s => sampleSubstatCurves(s, { slot: 0, control: { signal: controller.signal } }), h.config)
    expect(res.complete).toBe(false)
    expect(res.baseDamage).toBeGreaterThan(0)
    expect(res.series.every(s => s.points.length === 0)).toBe(true)
  }, 120000)
})

describe('副词条收益曲线 · 轴态标注（用户 2026-10-21 报「锯齿 / 负数」）', () => {
  it('轴态变化的点被标出、且不计入「到该步累计」', () => {
    // 前 3 步轴态不变，第 4 步起失衡次数跳了（模拟琉音 critRate 转冲击力）
    const s = synthetic('critRate', [1, 1, 1, -5, 0.2], 4, 4)
    expect(s.axisChangedAt).toEqual([4, 5])
    expect(s.axisStableSteps).toBe(3)
    // 累计只累不变前缀：1+1+1 = 3（第 4 步的 −5 不算词条收益）
    expect(s.cumulativePct).toBe(3)
    expect(s.cumulativeToCapPct).toBeCloseTo(1 + 1 + 1 - 5 + 0.2, 10)
    // 说明文案点出「第 4 步跳变」与具体变化
    expect(axisChangeNote(s)).toBe('第 4 步跳变（失衡 5 → 6 次，易伤覆盖 50.0% → 60.0%）（共 2 步跳变：第 4、5 步）')
    // 全程平滑的曲线 ⇒ 空串（不显示警示）
    expect(axisChangeNote(synthetic('atkPct', [1, 1]))).toBe('')
  })

  it('真实采样：每个点都带轴态；基线与首点轴态一致；critRate 的轴态变化可被检出', async () => {
    const h = await anomalyHarness()
    const res = await sample(h)
    expect(res.baseAxis.stunCount).toBeGreaterThanOrEqual(0)
    for (const s of res.series) {
      for (const p of s.points) {
        expect(p.axis, `${s.stat} x=${p.x}`).toBeTruthy()
        expect(typeof p.axis.stunCount, `${s.stat} x=${p.x}`).toBe('number')
      }
      // axisChangedAt 与 points 里的标记同源
      expect(s.axisChangedAt).toEqual(s.points.filter(p => p.axisJump).map(p => p.x))
      // 不变前缀长度自洽
      const stable = s.points.findIndex(p => p.axisJump)
      expect(s.axisStableSteps).toBe(stable < 0 ? s.points.length : stable)
    }
  }, 120000)
})

describe('副词条收益曲线 · 两种纵轴口径（用户 2026-10-24 裁决）', () => {
  it('相比于上一步 = Δ / 上一步总伤；加算词条在「相比于基础」是直线、在「相比于上一步」单调下弯', async () => {
    const h = await anomalyHarness()
    const res = await sample(h)
    for (const s of res.series) {
      let prev = s.originDamage
      for (const p of s.points) {
        // 两条尺子都要与 damage 自洽（分母不同：base 用基线，step 用上一步）
        expect(p.gainPct, `${s.stat} x=${p.x} base`).toBeCloseTo(((p.damage - prev) / res.baseDamage) * 100, 10)
        expect(p.gainStepPct, `${s.stat} x=${p.x} step`).toBeCloseTo(((p.damage - prev) / prev) * 100, 10)
        prev = p.damage
      }
    }
    // 判别力：样本里必须有「base 逐位恒定（直线）」的词条，否则这条口径判据看不出两把尺子的差别
    const linear = res.series.find(s => s.points.length >= 3 && s.points.every(p => Math.abs(p.gainPct - s.points[0]!.gainPct) < 1e-9))
    expect(linear, '样本里没有「相比于基础」恒定的加算词条（大攻击/小攻击），判据无判别力').toBeTruthy()
    // 同一条线：base 平、step 严格递减（分母在长大 ⇒ 边际效用递减的直观读数）
    const pts = linear!.points
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]!.gainStepPct, `${linear!.stat} x=${i + 1} 相比于上一步必须严格小于上一步`).toBeLessThan(pts[i - 1]!.gainStepPct)
    }
  }, 120000)

  it('现场可以由玩家给：基线 = 这份现场的总伤，前缀不出现在曲线上（x 从 1 起）', async () => {
    const h = await anomalyHarness()
    const manual = { anomalyProficiency: 3, atkPct: 2 }
    const res = await withAnalysisScenario(s => sampleSubstatCurves(s, { slot: 0, allocation: manual }), h.config)
    expect(res.reason).toBe('')
    // 分配原样回传（没有跑优化器去改写）
    expect(res.allocation).toEqual(manual)
    for (const s of res.series) expect(s.allocatedSteps, s.stat).toBe(manual[s.stat as keyof typeof manual] ?? 0)
    // 基线 = 现场总伤 ⇒ 回到现场那一步的总伤应当等于 baseDamage（cumulative 从 0 堆到现场步数）
    const atk = res.series.find(s => s.stat === 'atkPct')!
    expect(atk.points[1]!.damage, '现场 2 步的总伤必须等于 baseDamage').toBeCloseTo(res.baseDamage, 6)
    // 手动现场与自动配比的现场不同 ⇒ 基线不同（判据有判别力：不能静默忽略 allocation）
    const auto = await sample(h)
    expect(auto.baseDamage).not.toBeCloseTo(res.baseDamage, 6)
  }, 120000)

  it('下一步该堆谁：取现场 +1 步的 base 边际，可跨词条排序；到上限给 null', async () => {
    const h = await anomalyHarness()
    // 现场：大攻击 2 步、精通 1 步（其余 0）⇒ 每行都应有下一步读数
    const res = await withAnalysisScenario(s => sampleSubstatCurves(s, { slot: 0, allocation: { anomalyProficiency: 1, atkPct: 2 } }), h.config)
    const rows = nextStepMarginals(res)
    expect(rows.length).toBe(res.series.length)
    for (const row of rows) {
      const series = res.series.find(s => s.stat === row.stat)!
      const next = series.points.find(p => p.x === row.steps + 1)
      if (row.atCap) {
        expect(row.nextGainPct, `${row.stat} 到上限必须是 null（不是 0）`).toBeNull()
      } else {
        // 分母是现场总伤：拿 base 口径的 gainPct（同尺），否则跨词条排序会把「堆得多的」误判成便宜
        expect(row.nextGainPct, row.stat).toBeCloseTo(next ? next.gainPct : NaN, 10)
      }
    }
    // 判别力：至少两行有读数，且最大值确实是「下一步最值得堆的」
    const scored = rows.filter(r => r.nextGainPct !== null)
    expect(scored.length).toBeGreaterThan(1)
    const best = scored.reduce((a, b) => (b.nextGainPct! > a.nextGainPct! ? b : a))
    expect(Math.max(...scored.map(r => r.nextGainPct!))).toBe(best.nextGainPct)
    // 到上限：现场把某词条拉到单词条上限 ⇒ 该行 null + atCap
    const capped = await withAnalysisScenario(s => sampleSubstatCurves(s, { slot: 0, allocation: { atkPct: 5 } }), h.config)
    const capRow = nextStepMarginals(capped).find(r => r.stat === 'atkPct')!
    expect(capRow.atCap).toBe(true)
    expect(capRow.nextGainPct).toBeNull()
  }, 120000)
})

describe('副词条收益曲线 · 派生量（不花求值成本）', () => {
  it('纵轴只按传入曲线算（隐藏曲线必须退出纵轴）；两张图各自按自己的尺子算轴', () => {
    const big = synthetic('a', [0.1, 5.0])
    const small = synthetic('b', [0.1, 0.2])
    const all = curveAxisRange([big, small])
    const onlySmall = curveAxisRange([small])
    expect(all.yMax).toBeCloseTo(5.0 * 1.08, 10)
    expect(onlySmall.yMax).toBeLessThan(all.yMax)
    expect(onlySmall.yMax).toBeCloseTo(0.2 * 1.08, 10)
    expect(curveAxisRange([])).toEqual({ xMax: 1, yMin: 0, yMax: 1 })
    expect(all.xMax).toBe(2)
  })

  it('curveAxisRange 的 reading 参数：step 口径取 gainStepPct（合成曲线里两者等值 ⇒ 用显式构造验差别）', () => {
    const s = synthetic('c', [1, 1, 1])
    // 手工改一个点，让两种口径给出不同轴
    s.points[0]!.gainStepPct = 9
    expect(curveAxisRange([s], 'base').yMax).toBeCloseTo(1 * 1.08, 10)
    expect(curveAxisRange([s], 'step').yMax).toBeCloseTo(9 * 1.08, 10)
    // pointGain 与 reading 同源（图上的 y 不自己再判一次口径）
    expect(pointGain(s.points[0]!, 'base')).toBe(1)
    expect(pointGain(s.points[0]!, 'step')).toBe(9)
  })

  it('判定三态 + 门槛为空时的兜底', () => {
    const cutoff = 0.5
    expect(substatCurveVerdict(synthetic('chosen', [1, 0.6], 2), cutoff)).toBe('chosen')
    expect(substatCurveVerdict(synthetic('low', [0.2, 0.2]), cutoff)).toBe('dropped')
    expect(substatCurveVerdict(synthetic('edge', [0.5, 0.4]), cutoff)).toBe('kept-out')
    expect(substatCurveVerdict(synthetic('zero', [0, 0]), cutoff)).toBe('flat')
    // 没有任何词条入选（门槛 null）⇒ 有收益的未入选词条记 kept-out，不能谎称「低于门槛」
    expect(substatCurveVerdict(synthetic('x', [0.3]), null)).toBe('kept-out')
    expect(allocationCutoff({ series: [synthetic('a', [1])] } as unknown as SubstatCurveResult)).toBeNull()
  })

  it('默认可见集 = 模板 ∪ 入选 ∪ 首步最高的 N 条非模板（零收益不占位）', () => {
    const result = {
      series: [
        synthetic('atkPct', [1], 3),
        synthetic('penFlat', [0.2]),
        synthetic('anomalyProficiency', [0.8], 3),
        synthetic('hpFlat', [0]),
        synthetic('critDmg', [0.9]),
        synthetic('critRate', [0.1]),
        synthetic('atkFlat', [0.05]),
      ],
      templateStats: ['anomalyProficiency', 'atkPct'],
    } as unknown as SubstatCurveResult
    // 模板两条 + 非模板里首步最高的两条（critDmg 0.9 > penFlat 0.2 > critRate 0.1 > atkFlat 0.05）
    expect(defaultVisibleStats(result)).toEqual(['atkPct', 'penFlat', 'anomalyProficiency', 'critDmg'])
    // 零收益词条永不默认展开（恒 0 的线只是噪声）
    expect(defaultVisibleStats(result)).not.toContain('hpFlat')
    // 模板外的入选词条也要可见（否则用户看不到配比动了什么）
    const withExtra = { ...result, series: [...result.series, synthetic('defPct', [0.01], 1)] } as unknown as SubstatCurveResult
    expect(defaultVisibleStats(withExtra)).toContain('defPct')
  })
})

describe('副词条简称（图表图例的文案来源）', () => {
  it('池内 10 键都有中文简称，且与用户说法一致；池外键回落键本身', async () => {
    const { SUBSTAT_SHORT_LABELS, substatShortLabel } = await import('@/data/substatLabels')
    const h = await setupHarness([{ agentId: '1261' }])
    const pool = (h.catalog.statRules?.driveDisc.subStatPool ?? []) as string[]
    expect(pool.length).toBeGreaterThan(0)
    for (const stat of pool) {
      expect(SUBSTAT_SHORT_LABELS[stat], `池内词条 ${stat} 没有中文简称`).toBeTruthy()
    }
    // 用户口径原话（2026-10-21）：「大攻击、精通、小穿透」
    expect(substatShortLabel('atkPct')).toBe('大攻击')
    expect(substatShortLabel('anomalyProficiency')).toBe('精通')
    expect(substatShortLabel('penFlat')).toBe('小穿透')
    expect(substatShortLabel('futureStatKey')).toBe('futureStatKey')
  }, 60000)
})

describe('暴击词条的百暴截断（用户 2026-10-24：「别让人觉得百暴后还能堆高收益暴击」）', () => {
  /**
   * 雅 C2（局内暴击 +15%）+ 推荐配装（优化器局外百暴）⇒ 局内暴击 115% 溢出。
   * 乘区里的溢出→爆伤整条转化是「**换**词条」的收益（配平终态），不属于「**堆**暴击」——
   * 若不截断，转化补偿会让暴击曲线在百暴后仍显示 ≈ 爆伤/步的假收益，诱导玩家继续堆暴击。
   */
  it('★ 雅 C2 局内溢出面板：暴击曲线每步边际恒 0（含「下一步该堆谁」不再推暴击）', async () => {
    const h = await setupHarness([
      { agentId: '1091', cinemaLevel: 2 }, { agentId: '1411' }, { agentId: '1131' },
    ] as never, { recommendedBuild: true } as never)
    // 局内溢出 = 局外百暴（优化器含 C2 +15% 配平）+ 游球局内 +20%（优化器看不见的 buff）⇒ 局内 120%
    h.config.team[2].wEngineId = '14002'
    h.config.setMechanicSetting(SUBSTAT_CAP_SETTING, 30)
    await flush()
    const res = await withAnalysisScenario(s => sampleSubstatCurves(s, { slot: 0, stats: ['critRate', 'critDmg'] }), h.config)
    const crit = res.series.find(x => x.stat === 'critRate')
    const dmg = res.series.find(x => x.stat === 'critDmg')
    expect(crit, '夹具前提：暴击曲线在结果里').toBeTruthy()
    expect(crit!.points.length, '夹具前提：曲线有采样点').toBeGreaterThan(0)
    // 曲线把暴击词条从 0 重堆：前段（局内 <100）有真实收益，过线后的步截断为 0
    const nonzero = crit!.points.filter(p => p.gainPct !== 0)
    const zeros = crit!.points.filter(p => p.gainPct === 0)
    expect(nonzero.length, '前段应有真实收益（夹具前提）').toBeGreaterThan(0)
    expect(zeros.length, '★ 过线后必须截断为 0（修前转化补偿会让这些步显示 ≈ 爆伤/步的假收益）').toBeGreaterThan(0)
    const firstZero = crit!.points.findIndex(p => p.gainPct === 0)
    expect(crit!.points.slice(firstZero).every(p => p.gainPct === 0), '一旦截断不再恢复收益').toBe(true)
    // 对照组：爆伤曲线不受截断影响（百暴后换爆伤是真实收益，每步 > 0）
    expect(dmg, '夹具前提：爆伤曲线在结果里').toBeTruthy()
    expect(dmg!.points.some(p => p.gainPct > 0), '爆伤曲线应有正边际（对照组）').toBe(true)
  }, 600000)
})
