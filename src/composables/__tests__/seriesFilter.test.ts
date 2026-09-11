/**
 * 图表系列筛选的生效判据（AGENTS 规则 5/9：加了交互就要有「改了确实变」的测试）。
 *
 * 三条口径对应 `seriesFilter.ts` 文件头的 ①②③，逐条钉住：
 *  ① 默认全可见 + 新系列自动可见（重算后不需要用户重开一遍）
 *  ② 筛选必须传导到派生量（轴上限/明细表）——这里用「过滤后的最大值」模拟轴上限，
 *     断言隐藏大值系列后轴上界跟着降（页面里就是 yMax/costMax/chart3YMax 那类 computed）
 *  ③ 不允许把最后一个可见系列关掉 ⇒ 可见数 ≥1 是 API 层不变式
 */
import { describe, expect, it } from 'vitest'
import { useSeriesFilter } from '@/composables/seriesFilter'

const SERIES = [
  { id: 'a', name: 'A 队' },
  { id: 'b', name: 'B 队' },
  { id: 'c', name: 'C 队' },
]

describe('useSeriesFilter', () => {
  it('默认全可见，未知 id 也视为可见（新系列自动显示）', () => {
    const f = useSeriesFilter(() => SERIES)
    expect(f.isVisible('a')).toBe(true)
    expect(f.filter(SERIES).map(s => s.id)).toEqual(['a', 'b', 'c'])
    expect(f.counts.value).toEqual({ visible: 3, total: 3 })
    // 重算后冒出来的新系列（此前没在清单里）默认可见 ①
    expect(f.isVisible('brand-new')).toBe(true)
  })

  it('点图例隐藏该系列，再点恢复', () => {
    const f = useSeriesFilter(() => SERIES)
    f.toggle('b')
    expect(f.isVisible('b')).toBe(false)
    expect(f.filter(SERIES).map(s => s.id)).toEqual(['a', 'c'])
    expect(f.counts.value).toEqual({ visible: 2, total: 3 })
    f.toggle('b')
    expect(f.isVisible('b')).toBe(true)
    expect(f.filter(SERIES).map(s => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('隐藏传导到派生量：轴上限跟着可见集合降（② 的机器形态）', () => {
    const data = [{ id: 'a', max: 180 }, { id: 'b', max: 900 }]
    const f = useSeriesFilter(() => data.map(d => ({ id: d.id, name: d.id })))
    const axisMax = () => Math.max(0, ...f.filter(data).map(d => d.max))
    expect(axisMax()).toBe(900)
    f.toggle('b')
    expect(axisMax()).toBe(180)
  })

  it('不允许关掉最后一个可见系列（③）', () => {
    const f = useSeriesFilter(() => SERIES)
    f.toggle('a')
    f.toggle('b')
    expect(f.counts.value.visible).toBe(1)
    f.toggle('c') // 最后一个 → 忽略
    expect(f.isVisible('c')).toBe(true)
    expect(f.counts.value.visible).toBe(1)
    expect(f.filter(SERIES).map(s => s.id)).toEqual(['c'])
  })

  it('反复点同一个系列不破坏可见数 ≥1 不变式', () => {
    const f = useSeriesFilter(() => SERIES)
    for (let i = 0; i < 10; i++) {
      f.toggle('a'); f.toggle('b'); f.toggle('c')
    }
    expect(f.counts.value.visible).toBeGreaterThanOrEqual(1)
  })

  it('showAll 一键恢复全部可见', () => {
    const f = useSeriesFilter(() => SERIES)
    f.toggle('a')
    f.toggle('b')
    f.showAll()
    expect(f.filter(SERIES).map(s => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('用户隐藏的 id 在系列清单变化后仍记住（不因重算被重置）', () => {
    const list = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
    const f = useSeriesFilter(() => list)
    f.toggle('b')
    expect(f.isVisible('b')).toBe(false)
    // 重算后同一批 id 回来了（可能顺序/数量变了）——隐藏状态跨重算保留
    list.push({ id: 'c', name: 'C' })
    expect(f.isVisible('b')).toBe(false)
    expect(f.isVisible('c')).toBe(true)
    expect(f.filter(list).map(s => s.id)).toEqual(['a', 'c'])
  })

  it('空系列清单：counts 全 0、toggle 是安全的 no-op', () => {
    const f = useSeriesFilter(() => [])
    expect(f.counts.value).toEqual({ visible: 0, total: 0 })
    expect(f.isVisible('anything')).toBe(true)
    f.toggle('anything') // 不应抛
    expect(f.counts.value).toEqual({ visible: 0, total: 0 })
  })

  it('filter 保序且不改原数组', () => {
    const f = useSeriesFilter(() => SERIES)
    f.toggle('a')
    const out = f.filter(SERIES)
    expect(out.map(s => s.id)).toEqual(['b', 'c'])
    expect(SERIES.map(s => s.id)).toEqual(['a', 'b', 'c'])
  })
})
