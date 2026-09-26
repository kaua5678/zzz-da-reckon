/**
 * CC-39c（2026-09-27）：佩洛伊斯右分支决算（1551016）轴内截断失衡窗口的集成快照。
 * 设计稿 docs/mcp-cc39b-stun-window-end.md §4：perf 语料对决算截断零覆盖，雨果有 stunVulnSummary
 * 集成快照，佩洛伊斯此前没有。本文件用「同轴只换一个招式」做对照：
 *   右分支决算 1551016（endsStunWindow = true）vs 上分支 1551015（不结束窗口）。
 * 截断会扣掉窗口剩余失衡秒 ⇒ calc.stunCoverage（含 verdictSecondsLost 的权威口径）必须严格更低。
 * 链路：specPanelBuffs.ts endsStunWindow → resourceCalc/helpers.ts#axisMoveEndsStunWindow
 *      → convergence.ts 决算截断（verdictSecondsLost）→ stunCoverage。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

async function coverageWith(moveId: string) {
  const { config } = await setupHarness(
    [{ agentId: '1551' }, { agentId: '1011' }, { agentId: '1191' }],
    { recommendedBuild: true },
  )
  config.autoYidhariAxis = false
  config.stunAxisPlans.splice(0)
  config.stunAxes.splice(0)
  config.useStunAxis = false
  config.setCinemaLevel(0, 0)
  config.stunAxes.push({ name: '轴1', actions: [{ slot: 0, moveId, count: 1, startTime: 0 }] } as never)
  config.useStunAxis = true
  const calc = useResourceCalc()
  return { cov: Number(calc.stunCoverage.value ?? NaN), win: Number(calc.windowDuration.value ?? NaN) }
}

describe('CC-39c 集成快照：佩洛伊斯右分支决算截断失衡窗口', () => {
  // 快照 2026-09-27（CC-39c 首冻）：窗长 25s；上分支不截断 = 2 次 × 25 / 180 = 0.2778；
  // 右分支决算在 t=0 起手 ⇒ 窗口剩余失衡秒被清空 ⇒ 0.0834。
  // 若数值快照因无关口径（动作时长 / 失衡次数）漂移，先确认相对断言仍成立再重冻数值。
  it('右分支决算（1551016）截断窗口：覆盖率严格低于上分支（1551015）且不足一半', async () => {
    const verdict = await coverageWith('1551016')
    const upper = await coverageWith('1551015')
    expect(verdict.win).toBe(25)
    expect(upper.cov).toBeCloseTo(2 * 25 / 180, 3)
    expect(verdict.cov).toBeLessThan(upper.cov * 0.5)
    expect(verdict.cov).toBeGreaterThan(0)
    expect(verdict.cov).toBeCloseTo(0.0834, 3)
  })
})
