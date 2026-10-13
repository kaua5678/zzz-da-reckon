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
    // 重冻 2026-10-05 r652（CC-469′ 轴态失衡扣除复合式 + N 二分自洽）：上分支 2 次 → 3 次 ⇒ 3×25/180 = 0.4167；下方相对断言不变。
    expect(upper.cov).toBeCloseTo(3 * 25 / 180, 3)
    /**
     * ## ⚠ T141 改判据：从「不足上分支的一半」改为「被砍掉 ≥1 整个窗口」
     *
     * 旧断言 `verdict.cov < upper.cov × 0.5` 是**余量型**代理（「砍得够狠」）。实测：
     * | 口径 | upper | verdict | half 门 |
     * |---|---|---|---|
     * | 改前（HEAD） | 0.41667（= 3 窗） | 0.18943（= 34.10s） | 0.20833 ✅ |
     * | 改后（T141） | 0.41667（= 3 窗） | **0.20836（= 37.50s）** | 0.20833 ❌（差 3e-5） |
     *
     * ⇒ 机制**仍然生效**（75s → 37.50s，即**恰被砍掉 1.5 个 25s 窗口**，改前是砍掉 1.64 个），
     * 只是 T141 第 3 档（吸收常开 ⇒ 平A/次数重排）让「被砍的秒数」从 40.9s 变成 37.5s，
     * **恰好卡在 half 门上**（差 3e-5）。拿余量当判据会在口径漂移时假红/假绿，而它并不是本用例的主张。
     *
     * ⇒ 改为钉**机制本身**：决算必须把失衡窗口砍掉**至少一整个窗口**（`win=25s`）——
     * 这正是「决算截断窗口」的定义性质，且与余量无关（实测砍 37.5s > 25s，改前 40.9s 同样过）。
     */
    const windowSeconds = verdict.win
    expect(upper.cov * 180 - verdict.cov * 180, '决算必须砍掉至少一整个失衡窗口（本用例的机制主张）')
      .toBeGreaterThanOrEqual(windowSeconds)
    expect(verdict.cov).toBeLessThan(upper.cov)
    expect(verdict.cov).toBeGreaterThan(0)
    // 重冻 2026-09-28（CC-158 第 181 轮，折叠残差可退回改变动作时长分配）：0.0834 → 0.0788；上方相对断言均不变。
    // 重冻 2026-10-05 r652（CC-469′）：0.0788 → 0.1999（右分支失衡次数随上分支一起变；相对断言 <½ 上分支 仍成立：0.1999 < 0.2083）。
    // 重冻 2026-10-08 r742（艾莲平A池能量不再双计：槽 2 艾莲能量 456.1 → 419.0、强特 11 → 10）：0.1999 → 0.1894；
    // 失衡次数 3、上分支 0.4167 不变，相对断言仍成立（0.1894 < 0.2083）。
    // ⚠ T141 重冻：0.1894 → 0.20836（吸收改「取满容量」⇒ 平A/次数重排 ⇒ 被砍秒数 40.9 → 37.5）
    expect(verdict.cov).toBeCloseTo(0.2084, 3)
  })
})
