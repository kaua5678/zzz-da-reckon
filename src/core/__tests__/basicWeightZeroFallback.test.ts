/**
 * 「全队平A权重为 0 ⇒ 一号位独享平A池」（用户 2026-10-18 裁决）。
 *
 * ## 为什么需要它
 *
 * 三人都是「后台型/不分配平A」的角色时（蕾米埃尔声明 0 + 支援/防护职业 0 + 再一个支援 0），
 * 静态权重恒 0 ⇒ `iterate` 的 `totalWeight = 0` 直接跳过平A分配 ⇒ **整池蒸发、留白**，
 * 主C 拿不到一点平A能量。用户原话（逐字）：
 * > 「如果三人平a权重都是0，默认一号位享有全部平a」
 *
 * ## 落点与边界
 *
 * - 只改 `iterate` 内的**分配权重**（局部量），**不写回 store** ⇒ 界面仍显示用户填的 0，
 *   用户随时可以自己改；也不产生「store 被引擎偷偷改写」的一类问题。
 * - 水填法（单人物理上限截断 + 回流）照旧生效 ⇒ 一号位若贴顶，剩余量按同一套规则回流给还有余量的槽
 *   （而不是又蒸发）。
 * - **只在全队皆 0 时触发**：只要有一个槽 > 0，行为与修前逐位相同（本测试的第二个用例锁这一点）。
 * - 空槽不影响：`configs` 按位置压缩，取 `slot` 最小的在队槽（正常就是 1 号位 slot 0）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'

/** 蕾米埃尔（模块声明 0）+ 两名支援（职业 0）⇒ 三人权重天然全 0 */
const ZERO_WEIGHT_TEAM = ['1581', '1211', '1451'] as const

describe('平A权重全 0 ⇒ 一号位独享平A池', () => {
  it('全队权重 0：一号位分到平A时间，其余槽为 0', async () => {
    await setupHarness([])
    const config = useConfigStore()
    for (let i = 0; i < 3; i++) config.setAgent(i, ZERO_WEIGHT_TEAM[i]!)
    expect(config.team.map(c => c.basicAttackTimeWeight), '夹具前提：三人权重都是 0').toEqual([0, 0, 0])
    const calc = useResourceCalc()
    const basic = calc.resourceResult.value!.characters.map(c => c.timeAllocation.basicAttackTime)
    expect(basic[0], '一号位应拿到整池（旧实现 = 0 ⇒ 池蒸发）').toBeGreaterThan(1)
    expect([basic[1], basic[2]], '其余槽不分配平A（权重仍是 0）').toEqual([0, 0])
    // store 不被引擎改写：界面读到的仍是用户填的 0
    expect(config.team.map(c => c.basicAttackTimeWeight)).toEqual([0, 0, 0])
  }, 200_000)

  it('任一槽权重 > 0 ⇒ 行为不变（不触发兜底）', async () => {
    await setupHarness([])
    const config = useConfigStore()
    const team = ['1261', '1561', '1411']
    for (let i = 0; i < 3; i++) config.setAgent(i, team[i]!)
    // 1261 简 / 1561 维琳娜 都是非支援（权重 1），1411 柚叶支援（0）
    expect(config.team.map(c => c.basicAttackTimeWeight)).toEqual([1, 1, 0])
    const calc = useResourceCalc()
    const basic = calc.resourceResult.value!.characters.map(c => c.timeAllocation.basicAttackTime)
    expect(basic[2], '支援位仍是 0').toBe(0)
    expect(basic[0], '两槽按 1:1 分配').toBeCloseTo(basic[1]!, 6)
  }, 200_000)
})
