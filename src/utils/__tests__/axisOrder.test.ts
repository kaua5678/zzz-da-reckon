/**
 * 轴内动作**规范序**（2026-11-03 用户口径：「顺序几乎没啥用」）。
 *
 * 该原语是**唯一**的规范化实现：引擎入口（`core/stunAxisStack#calcStunAxisStack`）、轴状态写入口
 * （`stores/config#setAxisState`）、轴编辑器每次编辑（`views/StunAxisPage#editAxis` / 拖拽收手）都调它。
 */
import { describe, expect, it } from 'vitest'
import { axisActionsAreOrdered, canonicalizeAxis, sortAxisActionsByTime } from '@/utils/axisOrder'
import type { StunAxis } from '@/types/resource'

const act = (moveId: string, startTime: number) => ({ slot: 0, moveId, count: 1, startTime })

describe('轴内动作规范序', () => {
  it('已按时间序 ⇒ 返回原数组引用（调用方据此零拷贝零变化）', () => {
    const actions = [act('a', 0), act('b', 3), act('c', 3)]
    expect(axisActionsAreOrdered(actions)).toBe(true)
    expect(sortAxisActionsByTime(actions)).toBe(actions)
  })

  it('乱序 ⇒ 稳定升序（同刻保持原有相对次序）', () => {
    const actions = [act('a', 0), act('b', 5), act('c', 3), act('d', 3)]
    expect(axisActionsAreOrdered(actions)).toBe(false)
    expect(sortAxisActionsByTime(actions).map(a => a.moveId)).toEqual(['a', 'c', 'd', 'b'])
  })

  it('缺省 startTime = 0（排最前）', () => {
    const actions: Array<{ slot: number; moveId: string; count: number; startTime?: number }> = [
      { slot: 0, moveId: 'x', count: 1 },
      act('y', -2),
      act('z', 1),
    ]
    expect(sortAxisActionsByTime(actions).map(a => a.moveId)).toEqual(['y', 'x', 'z'])
  })

  it('canonicalizeAxis：已规范 ⇒ 原对象；乱序 ⇒ 新对象且其余字段逐位保留', () => {
    const axis: StunAxis = { name: '轴1', count: 2, basicFillerSlot: 1, actions: [act('a', 0), act('b', 3)] }
    expect(canonicalizeAxis(axis)).toBe(axis)
    const messy: StunAxis = { name: '轴1', count: 2, basicFillerSlot: 1, actions: [act('a', 0), act('b', 5), act('c', 3)] }
    const fixed = canonicalizeAxis(messy)
    expect(fixed).not.toBe(messy)
    expect(fixed.actions.map(a => a.moveId)).toEqual(['a', 'c', 'b'])
    expect(fixed.name).toBe('轴1')
    expect(fixed.count).toBe(2)
    expect(fixed.basicFillerSlot).toBe(1)
    expect(messy.actions.map(a => a.moveId), '不改原对象').toEqual(['a', 'b', 'c'])
  })
})