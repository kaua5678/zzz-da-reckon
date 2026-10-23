/**
 * CC-143（第 166 轮）：非轴降配 `selectDownscaleScale` 第三层「缓解档」。
 *
 * 旧语义：全部候选档截断都 > 容差 ⇒ null ⇒ 保基线（满交互 + 最大截断）。physical 模式下
 * `auto-1431-1481-1491` / `auto-1431-1481-1341` 因此保留 94.6s / 82.5s 截断，而 0.125 档三臂不劣、截断约 20s。
 * （⚠ 这两条是 2026-10-08 库重生成**之前**的实测值：`auto-1431-1481-1341` 已改名换 run 为
 *  `auto-1431-1341-1481`，两条新值见下方用例内注释。）
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
  // 2026-10-08 自动预设库重生成：`auto-1431-1481-1341`（同 3 人）槽序变为 `auto-1431-1341-1481`
  // （叶瞬光+照+琉音）。⚠ 不是纯改名——来自另一条实战 run（金数 5、音擎 14143/13007/13005），
  // 断言值已按新预设实测重取（physical 下截断 8.617s、scale 0.625、outerExit stable）。
  for (const id of ['auto-1431-1481-1491', 'auto-1431-1341-1481']) {
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
      /**
       * ⚠ **2026-10-23 前提失效（规则 10 四步）——「降配是否被调用」已无法在这两支队上度量**。
       *
       * ① 量 delta：`interactionScale` **undefined**（两支队都不再降配），截断 5.42s / 0.00s。
       * ② 根因：**2026-10-21「交互默认全 0」（`13b9f584`）**——本用例的前提是「交互占前台 ⇒ 结构性溢出
       *    ⇒ S3 降配搜档」；交互归 0 后这两支队物理上不再溢出（实测截断 ≤ 5.42s，远低于 40s 门槛），
       *    降配臂**无需求可降** ⇒ 不调用。
       * ③ 确认有意：用户裁决「交互全 0」，且降配臂本身的判据在 `feasibilitySearch` 系列单测里覆盖。
       * ④ 处置 = 把本用例改为钉**现在真正成立的结构不变量**：两支队必须 stable、截断 ≤ 40s、
       *    且**若**降配被调用则档位必须在 (0,1) 内（不钉「必须调用」）。
       *    ⚠ 保留本条的理由 = 它仍是 `auto-1431-*` 结构性溢出族的回归网；只是「必须降配」这个
       *    断言依赖「交互非 0」，那是数据前提不是代码不变量（规则 47：别把用户数据质量写成不变量）。
       */
      expect(cv?.timeTruncatedSeconds ?? Infinity).toBeLessThan(40)
      expect(cv?.outerExit).toBe('stable')
      if (cv?.interactionScale !== undefined) {
        expect(cv.interactionScale, '降配档位必须在 (0,1) 开区间').toBeGreaterThan(0)
        expect(cv.interactionScale, '降配档位必须在 (0,1) 开区间').toBeLessThan(1)
      }
    }, 60000)
  }
})
