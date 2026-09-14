/**
 * 环境膨胀曲线（`inflationCurve.ts`）的行为锁。
 *
 * 覆盖两件事：
 * ① **环境侧**（`buildInflationSeries`）——本模块数据完备、可独立验证的那一半：
 *    `hp` 聚合 / 归一化 / 环比 / 样本数 / lowSample 标记 / 模式隔离；
 * ② **首池锚定**（`buildReleaseStrengths`）——「角色实装时环境膨胀到几成」的对照表。
 *
 * ⚠ 本文件**不测**「角色有没有跟上膨胀」：那条结论的分子（版本直伤系数）实测是设计锚点
 * 而非强度（全库 34/43 恒为 1.000），已在模块文件头写成口径警告。这里用测试把
 * **「它不能当强度用」这件事也钉住**（防止后来者重新把它接成结论）。
 */
import { describe, expect, it } from 'vitest'
import {
  INFLATION_MODES,
  buildInflationFromFile,
  buildInflationSeries,
  buildReleaseStrengths,
  deflateScoreByInflation,
  mapRoomsToInflation,
  isLowSample,
  MIN_SAMPLES_PER_VERSION,
} from '@/composables/inflationCurve'
import { buildDirectDamageTimeline, type DirectDamagePoint } from '@/composables/multiplierCoefficients'
import { readFileSync } from 'node:fs'
import type { BossPresetFile } from '@/types/bossPreset'

const realFile = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile

/** 造 phase 的最小形状（只带本模块读的字段） */
const ph = (version: string, modeType: string, hp: number, begin = '2025-01-01 04:00:00') =>
  ({ version, modeType, hp, begin }) as unknown as BossPresetFile['bosses'][number]['phases'][number]

describe('buildInflationSeries（环境侧：Boss 平均血量膨胀）', () => {
  it('★ 按版本聚合求平均，且首版本归一为 100%', () => {
    const s = buildInflationSeries([
      { phases: [ph('1.0', 'defense', 100), ph('1.0', 'defense', 200)] },
      { phases: [ph('1.1', 'defense', 300)] },
    ])
    expect(s.baseVersion).toBe('1.0')
    expect(s.points.map(p => p.avgHp)).toEqual([150, 300])
    expect(s.points[0].index).toBe(100)
    expect(s.points[1].index).toBe(200)   // 300 / 150
    expect(s.cumulativePct).toBe(200)
  })

  it('★ 模式隔离：defense 与 critical_assault 不混算（量级差 3 倍，混算会失真）', () => {
    const presets = [
      { phases: [ph('1.0', 'defense', 100), ph('1.0', 'critical_assault', 10000)] },
    ]
    expect(buildInflationSeries(presets, 'defense').points[0].avgHp).toBe(100)
    expect(buildInflationSeries(presets, 'critical_assault').points[0].avgHp).toBe(10000)
  })

  it('★ 环比增幅：首版本为 null，其余为相对上一版本的变化', () => {
    const s = buildInflationSeries([
      { phases: [ph('1.0', 'defense', 100)] },
      { phases: [ph('1.1', 'defense', 150)] },
    ])
    expect(s.points[0].momPct).toBeNull()
    expect(s.points[1].momPct).toBeCloseTo(50, 6)
  })

  // 2026-09-14 实测修正：首版用**固定阈值** `samples < 6`，而真实 2.4 版本恰好 n=6
  // ⇒ 等于阈值不被标记，「低样本」机制在真实数据上一条都不触发（vacuous）。
  // 改自校准：样本数 < 本序列最大样本数。固定阈值也经不起数据补全（满编 9→12 就失效）。
  it('★ lowSample = 自校准（样本数 < 本序列最大样本数），不是固定阈值', () => {
    const few = Array.from({ length: 3 }, () => ph('1.0', 'defense', 100))
    const full = Array.from({ length: 9 }, () => ph('1.1', 'defense', 100))
    const s = buildInflationSeries([{ phases: [...few, ...full] }])
    expect(s.points[0].lowSample).toBe(true)    // 3 < 9
    expect(s.points[1].lowSample).toBe(false)   // 9 = 满编
    expect(s.points[0].samples).toBe(3)
  })

  it('★ 真实数据里恰好等于旧固定阈值的版本必须被标记（防止 vacuous 回归）', () => {
    const s = buildInflationFromFile(realFile, 'defense')
    const thin = s.points.filter(p => p.lowSample)
    // 实测 2.4（n=6 < 满编 9）是唯一短板版本；旧口径下它是 0 条
    expect(thin.length).toBeGreaterThanOrEqual(1)
    expect(thin.map(p => p.version)).toContain('2.4')
  })

  it('isLowSample 本体：严格小于才标记（相等 = 满编）', () => {
    expect(isLowSample(5, 9)).toBe(true)
    expect(isLowSample(9, 9)).toBe(false)
    expect(isLowSample(10, 9)).toBe(false)
    expect(MIN_SAMPLES_PER_VERSION).toBeGreaterThan(0)   // 绝对下限仍导出（数据不足的兜底语义）
  })

  it('样本数全相等时无人被标记（没有相对短板 = 合理）', () => {
    const s = buildInflationSeries([
      { phases: [ph('1.0', 'defense', 100), ph('1.0', 'defense', 100)] },
      { phases: [ph('1.1', 'defense', 200), ph('1.1', 'defense', 200)] },
    ])
    expect(s.points.every(p => !p.lowSample)).toBe(true)
  })

  it('脏数据被跳过（hp 非有限/≤0），不污染平均', () => {
    const s = buildInflationSeries([
      { phases: [ph('1.0', 'defense', 100), ph('1.0', 'defense', Number.NaN), ph('1.0', 'defense', 0)] },
    ])
    expect(s.points[0].avgHp).toBe(100)
    expect(s.points[0].samples).toBe(1)
  })

  it('空输入不炸（points 空、cumulative 退化为 100、无 NaN）', () => {
    const s = buildInflationSeries([])
    expect(s.points).toEqual([])
    expect(s.baseVersion).toBe('')
    expect(s.cumulativePct).toBe(100)
    expect(Number.isNaN(s.cumulativePct)).toBe(false)
  })

  it('版本按 VERSION_NODES 的顺序排（不是字典序：2.0 必须排在 1.7 之后）', () => {
    const s = buildInflationSeries([
      { phases: [ph('2.0', 'defense', 200)] },
      { phases: [ph('1.7', 'defense', 100)] },
    ])
    expect(s.points.map(p => p.version)).toEqual(['1.7', '2.0'])
  })

  it('★ 真实仓库：defense 覆盖 16+ 版本、末版本显著膨胀、base = 最早版本', () => {
    const s = buildInflationFromFile(realFile, 'defense')
    expect(s.points.length).toBeGreaterThanOrEqual(16)
    expect(s.baseVersion).toBe('1.4')
    // 实测 3.3 = 346.7%（涨到 3.47 倍）；用宽松下界防数据微调造成假红
    expect(s.cumulativePct).toBeGreaterThan(300)
    // 每版本样本数应至少为 1，且绝大多数版本满编
    const thin = s.points.filter(p => p.lowSample)
    expect(thin.length).toBeLessThanOrEqual(3)   // 实测仅 2.4（n=6 < 满编 9）一条
  })

  it('INFLATION_MODES 两个模式在真实数据里都有样本（判据不是死的）', () => {
    for (const m of INFLATION_MODES) {
      expect(buildInflationFromFile(realFile, m).points.length).toBeGreaterThan(0)
    }
  })
})

describe('buildReleaseStrengths（首池节点 ↔ 环境水位对照表）', () => {
  const dd = (over: Partial<DirectDamagePoint>): DirectDamagePoint => ({
    agentId: '1371', agentName: '仪玄', nodeId: '2.0-1', nodeLabel: '2.0 上半',
    nodeIndex: 100, value: 1.0, ...over,
  })

  it('★ 锚到同版本的环境指数（回答「实装时环境已膨胀到几成」）', () => {
    const series = buildInflationSeries([
      { phases: [ph('1.4', 'defense', 100)] },
      { phases: [ph('2.0', 'defense', 250)] },
    ])
    const rel = buildReleaseStrengths([dd({ nodeId: '2.0-1' })], series)
    expect(rel[0].version).toBe('2.0')
    expect(rel[0].environmentIndex).toBe(250)
  })

  it('★ 角色实装版本不在 Boss 覆盖范围内 → environmentIndex = null（不插值也不外推）', () => {
    const series = buildInflationSeries([{ phases: [ph('1.4', 'defense', 100)] }])
    // 3.3-1 不在上面这个只有 1.4 的序列里
    const rel = buildReleaseStrengths([dd({ nodeId: '3.3-1' })], series)
    expect(rel[0].environmentIndex).toBeNull()
    expect(rel[0].strengthVsEnvironment).toBeNull()
  })

  it('★ value 是比值、environmentIndex 是百分数：valuePct 做 ×100 归一', () => {
    const series = buildInflationSeries([{ phases: [ph('2.0', 'defense', 100)] }])
    const rel = buildReleaseStrengths([dd({ value: 1.5 })], series)
    expect(rel[0].value).toBe(1.5)
    expect(rel[0].valuePct).toBeCloseTo(150, 6)
  })

  it('value 为 null（无支援突击样本）→ valuePct 与比值都是 null（不猜）', () => {
    const series = buildInflationSeries([{ phases: [ph('2.0', 'defense', 100)] }])
    const rel = buildReleaseStrengths([dd({ value: null })], series)
    expect(rel[0].valuePct).toBeNull()
    expect(rel[0].strengthVsEnvironment).toBeNull()
  })

  it('★ 口径守卫：真实「版本直伤系数」是平坦锚点，不能当强度轴（防止有人重新接成结论）', () => {
    // 这条测试把模块文件头的实测结论钉住：该值 34/43 恒为 ~1.000，只有少数倍率设计处跳档
    // ⇒ 拿它当「角色强度随时间」会得出「全库仅 2 人跑赢（vs=1.0009）」这种无意义结论。
    // 若将来换成真正的强度度量（如引擎 hpRatio），这条会红 —— 那时应连同文件头口径一起改写，
    // 而不是删掉它（删掉 = 口径失去机器面，正是本仓库反复踩的坑）。
    const cat = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))
    const dd = buildDirectDamageTimeline(cat.agents ?? [], cat.agentSkills ?? [])
    const vals = dd.map(d => d.value).filter((v): v is number => v != null)
    expect(vals.length).toBeGreaterThan(30)
    // 平坦性：中位数附近（±1%）占比极高
    // 实测形态（2026-09-14，43 个点）：绝大多数落在 1.000/1.001 的**平坦锚点**上
    // （实测 28/43 = 0.651 在 ±1% 内），其余是**离散跳档**（1.181 / 1.273 / 2.068）——
    // 是「倍率设计档位」，不是「逐年增长」。故断言两点：平坦组占多数、跳档只有少数几档。
    const sorted = vals.slice().sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const nearMedian = vals.filter(v => Math.abs(v - median) <= 0.02).length
    expect(nearMedian / vals.length).toBeGreaterThan(0.6)   // 实测 28/43 ≈ 0.651
    // ★ 决定性判据：**取值是离散档位**，不是连续增长。
    // 实测（43 个点）：toFixed(2) 去重后**只有 4 档** —— 1.00（28 个）/ 1.18 / 1.27 / 2.07。
    // 若是「角色强度逐年增长」，不同取值会接近样本数（每期不同）；4 档说明它是**设计档位**。
    const distinct = [...new Set(vals.map(v => v.toFixed(2)))].sort()
    expect(distinct.length).toBeLessThanOrEqual(6)
    expect(distinct).toContain('1.00')
    // 且多数点落在同一档（平坦锚点），不是均匀铺开
    const flatShare = vals.filter(v => v.toFixed(2) === '1.00').length / vals.length
    expect(flatShare).toBeGreaterThan(0.5)   // 实测 28/43 ≈ 0.651
  })
})

describe('mapRoomsToInflation / deflateScoreByInflation（与抽取价值的连接）', () => {
  const series = (pts: Array<{ version: string; index: number; begin: string }>) => ({
    mode: 'defense' as const,
    baseVersion: pts[0]?.version ?? '',
    cumulativePct: pts[pts.length - 1]?.index ?? 100,
    points: pts.map((p, i) => ({
      version: p.version, versionIndex: i, avgHp: p.index * 1e6, samples: 9,
      lowSample: false, index: p.index, momPct: null, begin: p.begin,
    })),
  })

  it('★ 按房间日期取「begin ≤ date」的最后一个版本点', () => {
    const s = series([
      { version: '1.0', index: 100, begin: '2025-01-01 04:00:00' },
      { version: '2.0', index: 200, begin: '2025-06-01 04:00:00' },
      { version: '3.0', index: 300, begin: '2026-01-01 04:00:00' },
    ])
    const r = mapRoomsToInflation([
      { key: 'a', date: '2025-03-01' },   // 落在 1.0 区间
      { key: 'b', date: '2025-08-01' },   // 落在 2.0 区间
      { key: 'c', date: '2026-05-01' },   // 晚于末版本 → 取末版本
    ], s)
    expect(r.map(x => x.version)).toEqual(['1.0', '2.0', '3.0'])
    expect(r.map(x => x.index)).toEqual([100, 200, 300])
    expect(r.every(x => !x.clamped)).toBe(true)
  })

  // 实测踩到（2026-09-14）：真实数据里未上线版本（3.3）的 defense 期相 begin 全是空串。
  // 首版把空串也当候选 ⇒ 它「小于一切日期」又被当成最后一个点 ⇒ **32/32 房间全被误判到 3.3**。
  it('★ 无日期的版本点不参与区间判断（否则会吸走全部房间）', () => {
    const s = series([
      { version: '1.0', index: 100, begin: '2025-01-01 04:00:00' },
      { version: '2.0', index: 200, begin: '2025-06-01 04:00:00' },
      { version: '3.3', index: 347, begin: '' },   // 未上线：无日期
    ])
    const r = mapRoomsToInflation([{ key: 'a', date: '2025-03-01' }], s)
    expect(r[0].version).toBe('1.0')       // 不是 3.3
    expect(r[0].index).toBe(100)
  })

  it('早于首版本 / 房间无日期 → 钳到首版本并标 clamped', () => {
    const s = series([{ version: '2.0', index: 250, begin: '2025-06-01 04:00:00' }])
    const r = mapRoomsToInflation([{ key: 'a', date: '2024-01-01' }, { key: 'b', date: '' }], s)
    expect(r.map(x => x.index)).toEqual([250, 250])
    expect(r.map(x => x.clamped)).toEqual([true, true])
  })

  it('全部版本点无日期 / 空序列 → 返回空（不猜）', () => {
    expect(mapRoomsToInflation([{ key: 'a', date: '2025-01-01' }], series([{ version: 'x', index: 100, begin: '' }]))).toEqual([])
    expect(mapRoomsToInflation([{ key: 'a', date: '2025-01-01' }], series([]))).toEqual([])
  })

  it('★ deflateScoreByInflation：环境 300% 时的 30000 分 ≈ 首版本口径 10000 分', () => {
    expect(deflateScoreByInflation(30000, 300)).toBeCloseTo(10000, 6)
    expect(deflateScoreByInflation(10000, 100)).toBeCloseTo(10000, 6)  // 首版本：不变
  })

  it('deflateScoreByInflation：非正/非有限指数一律原样返回（不除零、不把 NaN 传染下游）', () => {
    expect(deflateScoreByInflation(500, 0)).toBe(500)
    expect(deflateScoreByInflation(500, -1)).toBe(500)
    expect(deflateScoreByInflation(500, Number.NaN)).toBe(500)          // 不产出 NaN
    expect(deflateScoreByInflation(500, Number.POSITIVE_INFINITY)).toBe(500)
  })

  it('★ 真实仓库端到端：32 个危局房间全部映射成功且**无 clamped**', () => {
    const s = buildInflationFromFile(realFile, 'defense')
    // 用真实的归档房间日期（与 pullValue 同源）
    const arch = JSON.parse(readFileSync(new URL('../../../public/static/run-archive.json', import.meta.url), 'utf8'))
    const rooms = Object.entries(arch.rooms as Record<string, { seasonStart?: string }>).map(([key, r]) => ({ key, date: r.seasonStart ?? '' }))
    const ctx = mapRoomsToInflation(rooms, s)
    expect(ctx).toHaveLength(rooms.length)
    // 观测窗口内（归档覆盖的赛季）不应出现钳位
    expect(ctx.filter(c => c.clamped)).toEqual([])
    // 指数应落在合理区间（首版本 100 ~ 末版本累计）
    for (const c of ctx) {
      expect(c.index).toBeGreaterThanOrEqual(100)
      expect(c.index).toBeLessThanOrEqual(s.cumulativePct + 1e-6)
    }
  })
})
