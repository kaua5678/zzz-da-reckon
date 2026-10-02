import { describe, expect, it } from 'vitest'
import { applyStat, finalizeCoreStatBonuses } from '@/core/buff'
import { emptyPanel } from '@/core/panel'

/**
 * 批次累加器的位置与语义锁（r401 CC-375）。
 * r401 前累加器挂在面板隐藏键 `__atkAccum` 等上（对象塞进「全是 number」的 PanelValues），现按面板对象存在
 * `buff.ts` 的模块级 WeakMap。反证：换回 r401 前的 buff.ts，第一条（泄漏 `__atkAccum` 等）与第三条（得 1200）失败。
 */
describe('buff 批次累加器', () => {
  it('applyStat 不在面板上留任何 __ 键', () => {
    const p = emptyPanel()
    p.atk = 1000
    applyStat(p, 'atkPct', 10, 'pct')
    applyStat(p, 'impact', 5, 'pct')
    applyStat(p, 'anomalyMastery', 3, 'flat')
    expect(Object.keys(p).filter(k => k.startsWith('__'))).toEqual([])
  })

  it('同一批次：百分比按批次起点汇总，再加固定值；finalize 后以当前值为新基数', () => {
    const p = emptyPanel()
    p.atk = 1000
    applyStat(p, 'atkPct', 10, 'pct')
    applyStat(p, 'atkFlat', 50, 'flat')
    applyStat(p, 'atkPct', 10, 'pct')
    expect(p.atk).toBeCloseTo(1000 * 1.2 + 50, 9)
    finalizeCoreStatBonuses(p)
    applyStat(p, 'atkPct', 10, 'pct')
    expect(p.atk).toBeCloseTo(1250 * 1.1, 9)
  })

  it('展开拷贝不继承累加状态：拷贝以当前值为新基数（旧写法共享同一累加器对象 ⇒ 1200）', () => {
    const p = emptyPanel()
    p.atk = 1000
    applyStat(p, 'atkPct', 10, 'pct')
    const q = { ...p }
    applyStat(q, 'atkPct', 10, 'pct')
    expect(q.atk).toBeCloseTo(1100 * 1.1, 9)
    expect(p.atk).toBeCloseTo(1100, 9)
  })
})
