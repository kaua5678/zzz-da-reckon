/**
 * 角色动作次数：上下界表 + 统一写入通道（评审第二梯队 #9「角色 setter 泛化」）。
 *
 * 为什么值得测：这些字段此前是 15 份逐字复制的 setter，每份自带 clamp 上下界
 * （99 / 999 / 3 / -1 四档）。重构成「集中界表 + 一行包装」后，**上下界就是数值口径**——
 * 表里写错一个数字 = 用户输入被静默钳到错误范围（如把 999 写成 99，强袭训令>99 直接失真）。
 * 本文件把①界表数值②纯 clamp 语义③命名 setter 的委托一致性 三层都钉住。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { newPinia } from '@/test/harness'
import {
  ACTION_COUNT_BOUNDS,
  clampActionCount,
  useConfigStore,
  type ActionCountField,
} from '@/stores/config'

/** 重构前的原始上下界（逐字抄自旧 setter）——界表必须与它逐位一致，这是本测试的核心判据 */
const LEGACY_BOUNDS: Record<ActionCountField, { min: number; max: number }> = {
  parryCount: { min: 0, max: 99 },
  dodgeCounterCount: { min: 0, max: 99 },
  blockCount: { min: 0, max: 99 },
  dualCounterCount: { min: 0, max: 99 },
  quickAssistCount: { min: 0, max: 99 },
  chainCountPerStun: { min: 0, max: 3 },
  basicAttackTimeWeight: { min: 0, max: 99 },
  assaultOrderCount: { min: 0, max: 999 },
  perfectBlockCount: { min: 0, max: 999 },
  yixuanInk2Count: { min: 0, max: 99 },
  yixuanInk3Count: { min: 0, max: 99 },
  yixuanPerfectBlockCount: { min: 0, max: 99 },
  yixuanExtremeAssistCount: { min: -1, max: 99 },
  yixuanBackstageComboCount: { min: 0, max: 99 },
  promiaNiyingCount: { min: 0, max: 99 },
  tauntCancelCount: { min: 0, max: 99 },
}

describe('ACTION_COUNT_BOUNDS（上下界表 = 数值口径的单一事实源）', () => {
  it('与重构前的 15 个 setter 逐位一致（改数字就是数值回归）', () => {
    expect(ACTION_COUNT_BOUNDS).toEqual(LEGACY_BOUNDS)
  })

  it('字段数 = 16（新增/删除字段必须显式来改这条）', () => {
    expect(Object.keys(ACTION_COUNT_BOUNDS)).toHaveLength(16)
  })
})

describe('clampActionCount（纯函数：越界收敛到界内）', () => {
  it('界内原样通过', () => {
    expect(clampActionCount('parryCount', 0)).toBe(0)
    expect(clampActionCount('parryCount', 6)).toBe(6)
    expect(clampActionCount('parryCount', 99)).toBe(99)
  })

  it('上溢钳到 max（999 档不得被当成 99 档）', () => {
    expect(clampActionCount('assaultOrderCount', 1000)).toBe(999)
    expect(clampActionCount('perfectBlockCount', 12345)).toBe(999)
    expect(clampActionCount('parryCount', 100)).toBe(99)
    expect(clampActionCount('chainCountPerStun', 4)).toBe(3)
  })

  it('下溢钳到 min；-1 哨兵值必须保留（仪玄极限支援 = 自动）', () => {
    expect(clampActionCount('parryCount', -5)).toBe(0)
    expect(clampActionCount('yixuanExtremeAssistCount', -1)).toBe(-1)
    expect(clampActionCount('yixuanExtremeAssistCount', -9)).toBe(-1)
    // 其余字段的负值一律归 0（不继承 -1 语义）
    expect(clampActionCount('yixuanInk2Count', -1)).toBe(0)
    expect(clampActionCount('chainCountPerStun', -1)).toBe(0)
  })

  it('小数不取整（沿用旧 setter 的 Math.max/min 行为，不做四舍五入）', () => {
    expect(clampActionCount('parryCount', 6.5)).toBe(6.5)
  })
})

describe('setActionCount / 命名 setter（store 内委托一致）', () => {
  beforeEach(() => { newPinia() })

  it('setActionCount 写进对应槽位并钳制', () => {
    const config = useConfigStore()
    config.setActionCount(0, 'parryCount', 500)
    expect(config.team[0].parryCount).toBe(99)
    config.setActionCount(1, 'chainCountPerStun', 9)
    expect(config.team[1].chainCountPerStun).toBe(3)
    config.setActionCount(2, 'yixuanExtremeAssistCount', -1)
    expect(config.team[2].yixuanExtremeAssistCount).toBe(-1)
  })

  it('16 个命名 setter 都委托到通用入口（逐个验钳制与落点）', () => {
    const config = useConfigStore()
    const cases: [string, (slot: number, v: number) => void, number][] = [
      ['parryCount', (s, v) => config.setParryCount(s, v), 99],
      ['dodgeCounterCount', (s, v) => config.setDodgeCounterCount(s, v), 99],
      ['blockCount', (s, v) => config.setBlockCount(s, v), 99],
      ['dualCounterCount', (s, v) => config.setDualCounterCount(s, v), 99],
      ['quickAssistCount', (s, v) => config.setQuickAssistCount(s, v), 99],
      ['chainCountPerStun', (s, v) => config.setChainCountPerStun(s, v), 3],
      ['basicAttackTimeWeight', (s, v) => config.setBasicAttackTimeWeight(s, v), 99],
      ['assaultOrderCount', (s, v) => config.setAssaultOrderCount(s, v), 999],
      ['perfectBlockCount', (s, v) => config.setPerfectBlockCount(s, v), 999],
      ['yixuanInk2Count', (s, v) => config.setYixuanInk2Count(s, v), 99],
      ['yixuanInk3Count', (s, v) => config.setYixuanInk3Count(s, v), 99],
      ['yixuanPerfectBlockCount', (s, v) => config.setYixuanPerfectBlockCount(s, v), 99],
      ['yixuanBackstageComboCount', (s, v) => config.setYixuanBackstageComboCount(s, v), 99],
      ['promiaNiyingCount', (s, v) => config.setPromiaNiyingCount(s, v), 99],
      ['tauntCancelCount', (s, v) => config.setTauntCancelCount(s, v), 99],
    ]
    for (const [field, call, max] of cases) {
      call(0, 1e6)
      expect((config.team[0] as unknown as Record<string, number>)[field], `${field} 上溢`).toBe(max)
      // 常规值用 2（对**所有**字段都合法：最小的一档是 chainCountPerStun 的 max=3）
      call(0, 2)
      expect((config.team[0] as unknown as Record<string, number>)[field], `${field} 常规值`).toBe(2)
    }
    // -1 哨兵那条单独验（min 与其它字段不同）
    config.setYixuanExtremeAssistCount(0, -1)
    expect(config.team[0].yixuanExtremeAssistCount).toBe(-1)
    config.setYixuanExtremeAssistCount(0, 1e6)
    expect(config.team[0].yixuanExtremeAssistCount).toBe(99)
  })

  it('空槽位静默忽略（与旧 setter 的 if (char) 行为一致）', () => {
    const config = useConfigStore()
    for (let i = 0; i < 3; i++) config.setAgent(i, '')
    expect(() => config.setActionCount(0, 'parryCount', 5)).not.toThrow()
  })
})
