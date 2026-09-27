/** CC-44：resolveUltimateTargetSlot 迁 core 后的口径锁 */
import { describe, expect, it } from 'vitest'
import { resolveUltimateTargetSlot } from '@/core/resource/targetSlot'

describe('resolveUltimateTargetSlot', () => {
  it('自动（-1）= 上一位队友，环绕', () => {
    expect(resolveUltimateTargetSlot(1, 3, -1)).toBe(0)
    expect(resolveUltimateTargetSlot(0, 3, -1)).toBe(2)
    expect(resolveUltimateTargetSlot(2, 3, -1)).toBe(1)
  })
  it('手动设置有效时直接用；越界或指向自己回退自动', () => {
    expect(resolveUltimateTargetSlot(0, 3, 1)).toBe(1)
    expect(resolveUltimateTargetSlot(0, 3, 0)).toBe(2)
    expect(resolveUltimateTargetSlot(0, 3, 5)).toBe(2)
  })
  it('单人队：落回自己槽位（0）', () => {
    expect(resolveUltimateTargetSlot(0, 1, -1)).toBe(0)
  })
})
