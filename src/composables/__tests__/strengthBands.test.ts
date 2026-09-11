/**
 * Chart 2「多队并存强度」强度带（Top-K 淘汰算法，评审 #14 第五刀抽出）。
 *
 * 这段算法此前内联在 3052 行页面里且**零单测**，而它带着一条血泪注释：
 * 「可达集合为空不能提前 break，否则后续所有期的 Top-K 裁剪都不执行 ⇒ 弱队全部存活到最后」。
 * 本文件的第 2 条测试就是那条事故的回归断言。
 */
import { describe, expect, it } from 'vitest'
import { computeStrengthBands, strengthBandTitle } from '@/composables/strengthBands'
import type { TeamStrengthSeed } from '@/composables/teamTimeline'

const seed = (key: string, startIndex: number, damage: number, team: string[] = ['A', 'B', 'C']): TeamStrengthSeed =>
  ({ key, startIndex, damage, hpRatio: damage / 10, team, shortLabel: key } as unknown as TeamStrengthSeed)

const byKey = (bands: ReturnType<typeof computeStrengthBands>) =>
  Object.fromEntries(bands.map(b => [b.seed.key, { start: b.startIndex, end: b.endIndex, elim: b.eliminatedAt }]))

describe('computeStrengthBands（Top-K 淘汰，淘汰永久）', () => {
  it('同起点多队：K 名之外在第 0 节点即淘汰，带止于 -1（被过滤掉）', () => {
    // 三队同起点，K=2 → 第三名在 n=0 就淘汰 → endIndex = -1 < startIndex=0 → 不产生带
    const bands = computeStrengthBands([seed('s1', 0, 300), seed('s2', 0, 200), seed('s3', 0, 100)], 3, 2)
    expect(bands.map(b => b.seed.key).sort()).toEqual(['s1', 's2'])
    expect(byKey(bands).s1).toEqual({ start: 0, end: 2, elim: null })
  })

  it('晚实装的强队入池后把弱队淘汰（且不因"首期可达为空"而失效）——历史事故回归', () => {
    // n=0/1 时可达集合为空（两队都还没实装）→ 若提前 break，后面的淘汰永不执行。
    // 正解：n=3 时 a 被 b 挤出 Top-1 → a 的带 endIndex=2 < startIndex=3 → 不产生带。
    const bands = computeStrengthBands([seed('b', 2, 100), seed('a', 3, 10)], 4, 1)
    expect(bands.map(b => b.seed.key)).toEqual(['b'])
    expect(byKey(bands).b).toEqual({ start: 2, end: 3, elim: null })
  })

  it('淘汰是永久的：被淘汰队的后续更高伤害不会让它复活', () => {
    // n=0: c(100) vs a(50) → a 出局（K=1）；n=1 a 的伤害变高也不会回来（淘汰在 map 里）
    const bands = computeStrengthBands([seed('c', 0, 100), seed('a', 0, 50)], 3, 1)
    expect(bands.map(b => b.seed.key)).toEqual(['c'])
  })

  it('K 被钳到 ≥1 的整数', () => {
    const seeds = [seed('x', 0, 10), seed('y', 0, 5)]
    expect(computeStrengthBands(seeds, 2, 0).map(b => b.seed.key)).toEqual(['x'])
    expect(computeStrengthBands(seeds, 2, 2).map(b => b.seed.key).sort()).toEqual(['x', 'y'])
    expect(computeStrengthBands(seeds, 2, 1.9).map(b => b.seed.key)).toEqual(['x'])  // floor(1.9)=1
  })

  it('存活到最后 → eliminatedAt 为 null、endIndex = 末节点', () => {
    const bands = computeStrengthBands([seed('only', 0, 100)], 5, 3)
    expect(byKey(bands).only).toEqual({ start: 0, end: 4, elim: null })
  })

  it('中途跌出：endIndex = 淘汰节点 - 1，且 eliminatedAt 记录该节点', () => {
    // K=1：n=0 只有 a；n=1 b 实装且更强 → a 在 n=1 淘汰 → a 带 [0,0]
    const bands = computeStrengthBands([seed('a', 0, 100), seed('b', 1, 200)], 3, 1)
    expect(byKey(bands).a).toEqual({ start: 0, end: 0, elim: 1 })
    expect(byKey(bands).b).toEqual({ start: 1, end: 2, elim: null })
  })

  it('空输入 / 零节点 → 空数组', () => {
    expect(computeStrengthBands([], 5, 2)).toEqual([])
    expect(computeStrengthBands([seed('a', 0, 1)], 0, 2)).toEqual([])
  })
})

describe('strengthBandTitle（悬浮卡文案）', () => {
  const opts = {
    k: 3,
    nameOf: (id: string) => `名(${id})`,
    labelOf: (i: number) => ['R0', 'R1', 'R2', 'R3'][i],
    fmtCompact: (n: number) => `c${n}`,
    fmtRatio: (n: number, d: number) => n.toFixed(d),
  }
  const band = (elim: number | null) => ({
    seed: seed('s', 0, 1234, ['x', 'y', 'z']),
    startIndex: 0, endIndex: 2, eliminatedAt: elim,
  })

  it('存活到最后：写「存活到最后」，无淘汰标注', () => {
    const t = strengthBandTitle(band(null), opts)
    expect(t).toContain('名(x)+名(y)+名(z)')
    expect(t).toContain('c1234')
    expect(t).toContain('123.4%')
    expect(t).toContain('R0 ~ R2')
    expect(t).toContain('存活到最后')
  })

  it('被淘汰：写「<节点> 起跌出 Top-<k> 淘汰」', () => {
    const t = strengthBandTitle(band(3), opts)
    expect(t).toContain('R3 起跌出 Top-3 淘汰')
    expect(t).not.toContain('存活到最后')
  })

  it('淘汰节点标签缺失时回落「存活到最后」（不输出 undefined）', () => {
    const t = strengthBandTitle(band(9), { ...opts, labelOf: () => undefined })
    expect(t).not.toContain('undefined')
    expect(t).toContain('存活到最后')
  })
})
