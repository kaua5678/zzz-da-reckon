/**
 * CC-39b（2026-09-27）：「结束失衡窗口的轴块」与「动作时长兜底」按槽位角色派发模块能力。
 * 设计稿 docs/mcp-cc39b-stun-window-end.md。convergence 决算截断与 roundInputs 的 endsStunWindow
 * 都走 resourceCalc/helpers.ts 的这两个函数，本测试锁住派发结果与原字面量判定逐项一致。
 */
import { describe, it, expect } from 'vitest'
import { axisMoveEndsStunWindow, axisMoveActionTimeOf } from '@/composables/resourceCalc/helpers'

describe('CC-39b 终结失衡窗口能力派发', () => {
  it('佩洛伊斯：右分支决算 1551016 结束窗口，上 / 下分支不结束', () => {
    for (const c of [0, 6]) {
      expect(axisMoveEndsStunWindow('1551', '1551016', c)).toBe(true)
      expect(axisMoveEndsStunWindow('1551', '1551015', c)).toBe(false)
      expect(axisMoveEndsStunWindow('1551', '1551014', c)).toBe(false)
    }
  })
  it('雨果：强特终结一击恒结束；终结技仅影画 0/1 结束', () => {
    expect(axisMoveEndsStunWindow('1291', '1291_ex_verdict_final', 0)).toBe(true)
    expect(axisMoveEndsStunWindow('1291', '1291_ex_verdict_final', 6)).toBe(true)
    expect(axisMoveEndsStunWindow('1291', '1291018', 1)).toBe(true)
    expect(axisMoveEndsStunWindow('1291', '1291018', 2)).toBe(false)
    expect(axisMoveEndsStunWindow('1291', '1291015', 0)).toBe(false)
  })
  it('空槽 / 无此能力的角色 ⇒ 不结束', () => {
    expect(axisMoveEndsStunWindow(undefined, '1551016', 0)).toBe(false)
    expect(axisMoveEndsStunWindow('', '1551016', 0)).toBe(false)
    expect(axisMoveEndsStunWindow('1191', '1191018', 0)).toBe(false)
  })
  it('动作时长兜底：雨果合成行 ≤0 取 1.805，其余原值', () => {
    expect(axisMoveActionTimeOf('1291', '1291_ex_verdict_final', 0)).toBe(1.805)
    expect(axisMoveActionTimeOf('1291', '1291_ex_verdict_final', 2.5)).toBe(2.5)
    expect(axisMoveActionTimeOf('1291', '1291018', 0)).toBe(0)
    expect(axisMoveActionTimeOf('1551', '1551016', 0)).toBe(0)
    expect(axisMoveActionTimeOf(undefined, '1291_ex_verdict_final', 0)).toBe(0)
  })
})
