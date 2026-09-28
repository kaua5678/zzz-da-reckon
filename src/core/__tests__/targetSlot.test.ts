/** CC-44 口径锁；CC-180（第 203 轮）改为编队槽位 + 已上场序列（跳过空槽） */
import { describe, expect, it } from 'vitest'
import { resolveTeammateTargetSlot } from '@/core/resource/targetSlot'

describe('resolveTeammateTargetSlot', () => {
  it('满编自动（-1）= 上一位队友，环绕（与旧式 (own-1+3)%3 逐值相同）', () => {
    expect(resolveTeammateTargetSlot(1, [0, 1, 2], -1)).toBe(0)
    expect(resolveTeammateTargetSlot(0, [0, 1, 2], -1)).toBe(2)
    expect(resolveTeammateTargetSlot(2, [0, 1, 2], -1)).toBe(1)
  })
  it('手动设置有效时直接用；越界或指向自己回退自动', () => {
    expect(resolveTeammateTargetSlot(0, [0, 1, 2], 1)).toBe(1)
    expect(resolveTeammateTargetSlot(0, [0, 1, 2], 0)).toBe(2)
    expect(resolveTeammateTargetSlot(0, [0, 1, 2], 5)).toBe(2)
  })
  it('有空槽：跳过空槽取已上场序列的上一位（游戏换人顺序没有空槽这一位）', () => {
    expect(resolveTeammateTargetSlot(0, [0, 1], -1)).toBe(1)
    expect(resolveTeammateTargetSlot(1, [1, 2], -1)).toBe(2)
    expect(resolveTeammateTargetSlot(1, [0, 1], -1)).toBe(0)
    expect(resolveTeammateTargetSlot(2, [0, 2], -1)).toBe(0)
  })
  it('手动指向空槽 ⇒ 回退自动（不再落空丢失）', () => {
    expect(resolveTeammateTargetSlot(0, [0, 1], 2)).toBe(1)
  })
  it('只有自己：无落点（-1），不自赠', () => {
    expect(resolveTeammateTargetSlot(0, [0], -1)).toBe(-1)
    expect(resolveTeammateTargetSlot(2, [2], 0)).toBe(-1)
  })
})
