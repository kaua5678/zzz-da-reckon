/**
 * CC-452 锁：结果页「合轴率调节」弹窗读引擎有效值，不再页面侧重算。
 * 此前弹窗 `getComboAlignOverride(slot, moveId, 0)` × `exec.totalTime`：模块行（强化特殊技·合轴 = 1 等）与
 * 未改过的倍率表默认行都显示 0，总合轴时间少算。单源：`exec.comboAlignRatio` / `exec.totalComboAlignTime`。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { totalComboAlignTimeOf } from '@/composables/resourceCalc/comboAlignDisplay'

const code = (rel: string) =>
  readFileSync(resolve(__dirname, '../../', rel), 'utf-8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l)).join('\n')

describe('CC-452 合轴率弹窗读引擎有效值', () => {
  it('总合轴时间 = Σ 引擎 totalComboAlignTime（与 totalTime、覆盖值无关）', () => {
    const charResult = {
      executions: [
        { totalTime: 10, totalComboAlignTime: 10 }, // 模块行：比例 1，覆盖表里没有它
        { totalTime: 20, totalComboAlignTime: 6 },  // 倍率表默认 0.3
        { totalTime: 5, totalComboAlignTime: 0 },
      ],
    }
    expect(totalComboAlignTimeOf(charResult)).toBeCloseTo(16, 9)
    expect(totalComboAlignTimeOf({ executions: [] })).toBe(0)
  })
  it('ResultPage：弹窗读数不再经 getComboAlignOverride，写侧仍走 setComboAlignOverride', () => {
    const src = code('views/ResultPage.vue')
    expect(src).not.toMatch(/getComboAlignOverride\(/)
    expect(src).not.toMatch(/exec\.totalTime \* getComboAlignRatio/)
    expect(src).toMatch(/exec\.comboAlignRatio \* 100/)
    expect(src).toMatch(/exec\.totalComboAlignTime\.toFixed/)
    expect(src).toMatch(/totalComboAlignTimeOf\(charResult\)/)
    expect(src).toMatch(/setComboAlignOverride\(/)
  })
})
