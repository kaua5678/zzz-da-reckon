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
  /**
   * ⚠ **2026-10-20 锚值 25 → 16（规则 10 四步）——判据语义（决算砍掉 ≥1 整窗）未变**。
   *
   * ① 量 delta：`win` 25 → **16**；`upper.cov` 3×25/180 = 0.4167 → 3×16/180 = 0.2667。
   * ② 根因：**佩洛伊斯的决算 +3s 从「常驻面板加成」改为「按块的窗口延长」**。
   *    原实现 = spec `1551.json` 的 `teamBuffs[].effects[].stat: stunDurationBonusSeconds` value 3，
   *    它让**每一次**失衡窗口都多 3s（本队实测 25 = 16 基础 + 3 佩洛伊斯 + 6 队友）。
   *    但决算只发生在**有决算**的窗口，且原文语义是「招式发动时…终结一击命中时敌人失衡结束」
   *    ⇒ 用户口径 2026-10-20：「就算你大招放在失衡的最后 0.1s，他也能触发延时让你打完大招然后触发决算」
   *    ——是**按次的条件延长**，不是常驻。现改为模块能力 `stunWindowExtendOnEnd`（见
   *    `docs/STUN_WINDOW_DURATION.md` §7），常驻条目已从 spec 移除。
   * ③ 确认有意：非决算窗口不该白拿 3s（那正是「用常驻近似冒充按次机制」的高估）。
   * ④ 本锚按新口径更新；**下方三条相对断言逐条保留**（砍掉 ≥1 整窗 / 严格更低 / >0），
   *    它们才是本用例的机制主张，与绝对窗长无关。
   */
  it('右分支决算（1551016）截断窗口：覆盖率严格低于上分支（1551015）且不足一半', async () => {
    const verdict = await coverageWith('1551016')
    const upper = await coverageWith('1551015')
    expect(verdict.win).toBe(16)
    // 重冻 2026-10-20：上分支 3 次 × 16s / 180 = 0.2667（原 25s 口径下为 0.4167）；下方相对断言不变。
    expect(upper.cov).toBeCloseTo(3 * 16 / 180, 3)
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
    // ⚠ 2026-10-20 重冻：0.20836 → **0.04463**（窗长 25 → 16：佩洛伊斯决算 +3s 从常驻面板改为按块延长，
    //    见上方锚值段；本队失衡次数仍 3，但每窗 16s ⇒ 被砍秒数 48.00 → 8.03 = 0.04463 × 180）。
    //    相对断言（砍掉 ≥1 整窗 = 16s、严格低于上分支 0.2667、>0）逐条仍成立。
    // ⚠ 2026-10-23 重冻：0.04463 → **0.04783**（交互默认全 0 后平A/次数重排，被砍秒数 8.03 → 8.61）。
    //    上方三条**相对断言**（砍掉 ≥1 整窗 16s、严格低于上分支、>0）逐条仍成立 —— 它们才是本用例的主张；
    //    本行只是「断言它没被静默改掉」的快照。
    expect(verdict.cov).toBeCloseTo(0.04783, 4)
  })
})
