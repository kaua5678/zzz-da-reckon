/**
 * 「综合合轴 −X s」行（用户口径 2026-10-24）的生效测试。
 *
 * 用户原话（逐字）：「合轴就是切人，人在场打完动作但是非当前操作。感觉要展示也是在动作下面列一行：
 * 综合合轴。然后说这是 -多少秒」。
 *
 * 为什么单独立锁：动态合轴吸收（`TimeAllocation.dynamicComboAlignSeconds`）此前**只**进团队账本，
 * 角色卡动作行与时间条都读执行行的 `totalComboAlignTime`（静态逐招合轴），于是「队友的 40% 综合合轴」
 * 在时间分配里完全不可见（全库实测 186 个有吸收的槽里 156 槽时间条合轴段为 0，Σ1630.7s）。
 * 契约：
 *  ① 综合合轴读数 = 引擎实际值（不按吸收比重算——咬合支下吸收量 < 容量）；
 *  ② 它是**槽级统筹量**，不进 `buildTimeChartRows`、不摊进动作行 ⇒ Σ时间条仍 == 战斗总时长；
 *  ③ 卡片从 `dynamicComboAlignSecondsOf` 取数（源锁）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  buildActionOperationRows,
  buildTimeChartRows,
  dynamicComboAlignSecondsOf,
} from '@/composables/resourceCard/actionOperationRows'

const TEAM = [
  { agentId: '1171', cinemaLevel: 0 },
  { agentId: '1191', cinemaLevel: 0 },
  { agentId: '1211', cinemaLevel: 0 },
]

describe('综合合轴行 == 引擎动态合轴吸收', () => {
  it('① 三槽读数与引擎一致、≤ 容量上限、且不进时间条（Σ时间条仍 == 总时长）', async () => {
    await setupHarness(TEAM, { recommendedBuild: true })
    const { resourceResult } = useResourceCalc()
    const rr = resourceResult.value!
    expect(rr.characters.length).toBe(3)

    let absorbedSlots = 0
    for (const ch of rr.characters) {
      const t = ch.timeAllocation
      const dyn = t.dynamicComboAlignSeconds ?? 0
      // ① 卡片读数 == 引擎读数（不是页面重算）
      expect(dynamicComboAlignSecondsOf(ch), `${ch.agentId} 综合合轴读数`).toBeCloseTo(Math.max(0, dyn), 9)

      // 容量上限：非操作槽最多被吸收 comboAlignAbsorbRatio × 其净必要（操作槽 dyn = 0）
      const netBefore = t.necessaryTime - ((t.comboAlignCredit ?? 0) - dyn)
      expect(dyn, `${ch.agentId} 吸收 ≤ 容量`).toBeLessThanOrEqual(0.4 * Math.max(0, netBefore) + 1e-6)
      if (dyn > 0.01) {
        absorbedSlots++
        // 吸收量已计入 comboAlignCredit（账本口径），不是额外冒出来的秒数
        expect(t.comboAlignCredit ?? 0).toBeGreaterThanOrEqual(dyn - 1e-9)
      }

      // ② 不进时间条：合轴段的 Σ 与条总分都不因它改变
      const chart = buildTimeChartRows(ch)
      const chartTotal = chart.reduce((s, r) => s + r.time, 0)
      expect(chartTotal, `${ch.agentId} Σ时间条`).toBeCloseTo(rr.totalTime, 6)
      expect(chart.some(r => r.key === 'dynamicComboAlign'), `${ch.agentId} 时间条不单列综合合轴`).toBe(false)
      // 动作行也不摊吸收（行上的合轴只来自静态逐招合轴）
      const rows = buildActionOperationRows(ch)
      expect(rows.every(r => r.comboAlignTime >= 0)).toBe(true)
    }
    // 反空洞：本队至少有一槽真的被吸收，否则上面全是恒真断言
    expect(absorbedSlots, '本队应有被综合合轴吸收的槽').toBeGreaterThan(0)
  }, 600_000)

  it('② 源锁：卡片从 dynamicComboAlignSecondsOf 取数、且不把吸收摊进时间条', () => {
    const vue = readFileSync(resolve(__dirname, '../../components/ResourceResultCard.vue'), 'utf-8')
    expect(vue).toContain('dynamicComboAlignSecondsOf')
    expect(vue).toContain('综合合轴')
    // 展示层不得按吸收比重算（页面重算会与引擎闭式解分叉）
    expect(vue).not.toMatch(/dynamicComboAlignSeconds\s*\*\s*0\.4/)
    const mod = readFileSync(resolve(__dirname, '../resourceCard/actionOperationRows.ts'), 'utf-8')
    // 时间条构造器里不许出现吸收读数（它只画执行行 + 合轴 + 后台）
    const chartBody = mod.slice(mod.indexOf('export function buildTimeChartRows'))
    expect(chartBody).not.toContain('dynamicComboAlignSecondsOf')
  })
})
