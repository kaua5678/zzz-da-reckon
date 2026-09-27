/**
 * CC-143（第 166 轮）：非轴降配 `selectDownscaleScale` 第三层「缓解档」。
 *
 * 旧语义：全部候选档截断都 > 容差 ⇒ null ⇒ 保基线（满交互 + 最大截断）。physical 模式下
 * `auto-1431-1481-1491` / `auto-1431-1481-1341` 因此保留 94.6s / 82.5s 截断，而 0.125 档三臂不劣、截断约 20s。
 * 新语义：前两层落空时，取「三臂不劣、截断比基线少一个容差以上、外层 stable」的档里截断最小者（并列取较大档）。
 * off 模式 104 队逐字段不变（off 下没有队走到这一层）。详见 docs/mcp-stun-dual-source.md §7。
 */
import { describe, expect, it } from 'vitest'
import { DOWNSCALE_SCALES, selectDownscaleScale } from '@/composables/resourceCalc/feasibilitySearch'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'

describe('selectDownscaleScale 第三层：缓解档', () => {
  const trunc: Record<number, number> = { 0.875: 60, 0.75: 58, 0.625: 48, 0.5: 39, 0.375: 31, 0.25: 29, 0.125: 19, 0.0625: 19 }
  it('全档未 accepted：取截断最小的缓解档，并列取较大档', () => {
    const got = selectDownscaleScale(DOWNSCALE_SCALES, s => ({ accepted: false, feasible: false, relief: true, reliefTruncation: trunc[s], value: s }))
    expect(got?.scale).toBe(0.125)
  })
  it('只有部分档是缓解档：只在缓解档里选', () => {
    const got = selectDownscaleScale(DOWNSCALE_SCALES, s => ({ accepted: false, relief: s >= 0.5, reliefTruncation: trunc[s], value: s }))
    expect(got?.scale).toBe(0.5)
  })
  it('有相对档（accepted）时第三层不生效；无缓解档仍返回 null', () => {
    const got = selectDownscaleScale(DOWNSCALE_SCALES, s => ({ accepted: s === 0.75, feasible: false, relief: true, reliefTruncation: 0, value: s }))
    expect(got?.scale).toBe(0.75)
    expect(selectDownscaleScale(DOWNSCALE_SCALES, s => ({ accepted: false, value: s }))).toBeNull()
  })
})

describe('physical 模式：1431+1481 结构性溢出队不再保基线', () => {
  for (const id of ['auto-1431-1481-1491', 'auto-1431-1481-1341']) {
    it(id, async () => {
      const p = teamPresets.find(x => x.id === id)
      expect(p, `预设 ${id} 缺失：换一个 physical 下全档截断 > 1s 的队并更新文档 §7`).toBeTruthy()
      const { catalog, config } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      for (let i = 0; i < 3; i++) config.setAgent(i, p!.team[i])
      config.applyTeamPreset(p!.team as [string, string, string])
      config.setMechanicSetting('time.stunPlanProjection', 4)
      const cv = calc.resourceResult.value?.convergence
      // 修复前：interactionScale undefined（保基线），截断 94.6 / 82.5s；修复后 0.125 档，截断约 20s
      expect(cv?.interactionScale).toBeDefined()
      expect(cv?.timeTruncatedSeconds ?? Infinity).toBeLessThan(40)
      expect(cv?.outerExit).toBe('stable')
    }, 60000)
  }
})
