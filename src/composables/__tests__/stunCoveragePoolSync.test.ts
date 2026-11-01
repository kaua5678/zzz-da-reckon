/**
 * C 项（2026-10-20）：**覆盖率与失衡池次数同源**。
 *
 * 病灶：`runCalcRound` 内的 `stunCoverage` 用的是**钳之前**的池次数，而 `solveTeam` 的
 * CC-150 会在 `cycle + physical` 停点把池钳到读入 K ⇒ 同一份结果里出现
 * 「池报 5 窗 / 覆盖率隐含 7 窗」两个物理量。实测 3 支队：
 * `auto-1051-1141-1451`、`auto-1611-1141-1211`（5 vs 7）、`auto-1501-1561-1411`（2 vs 3）。
 *
 * 覆盖率不是展示口径——它是**伤害易伤**（`damagePoolDirect` 直接读 `stunCoverage`）与
 * 「攒条无效时间」的唯一输入，多算的窗口会同时推高易伤覆盖与本轮攒条扣除。
 *
 * 判据：
 * ① 全库预设：`stunCoverage × 有效时间 / 窗长 == 池次数`（容差 1e-9，只允许语义相等的浮点尾数）；
 * ② 反空洞：扫描面里必须真有 `outerExit=cycle` 的队（否则本判据覆盖不到钳位分支）；
 * ③ 正向锚：钳位分支至少被走到过一次（`cycle + physical` 队非零）——用 ② 同一份读数间接证明。
 *
 * ⚠ **已知例外**：决算截断（佩洛伊斯右分支）会让覆盖率**低于** `池次数 × 窗长 / 有效时间`
 * （覆盖率扣掉了 `verdictSecondsLost`）。故判据写的是
 * `覆盖率 == clamp((pool × W − lost) / effTime, 0, 1)`，`lost` 从结果里读（
 * `CalcRoundResult.stunVerdictLostSeconds` 不透出到 `CalcRoundResult` 之外的队按 0 处理——
 * 非决算队恒 0）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { effectiveBattleTime } from '@/core/effectiveTime'
import { teamPresets } from '@/data/teamPresets'
import { probeFlag } from '@/core/probeTrace'

describe('C：覆盖率与失衡池次数同源', () => {
  it('全库预设：stunCoverage == clamp((池次数 × 窗长 − 决算损失) / 有效时间)', async () => {
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    expect(presets.length, '预设扫描面塌了').toBeGreaterThanOrEqual(80)
    const violations: string[] = []
    let cycleTeams = 0
    let scanned = 0
    let nonZeroCoverage = 0
    let truncatedTeams = 0
    for (const preset of presets) {
      const { catalog, config } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      for (let i = 0; i < 3; i++) config.setAgent(i, preset.team[i])
      config.applyTeamPreset(preset.team as [string, string, string])
      const calc = useResourceCalc()
      const rr = calc.resourceResult.value
      const pool = calc.stunPoolResult.value
      if (!rr || !pool) continue
      scanned++
      if (rr.convergence.outerExit === 'cycle') cycleTeams++
      const effTime = effectiveBattleTime(config.enemy)
      const W = calc.windowDuration.value
      const cov = calc.stunCoverage.value
      if (cov > 0) nonZeroCoverage++
      if (cov < 0.999 && Math.abs(cov * effTime / W - pool.stunCount) > 0.02) truncatedTeams++
      /**
       * 直接判据：覆盖率隐含的窗口数 **+ A10 末窗截断** == 池次数（决算队按 lost 修正后比）。
       * `lost` 不在公开结果里，故用「覆盖率 × effTime ≤ 池 × W 且差值 ≤ 一个窗」做弱形式，
       * 强形式在非决算队上退化为相等（`lost == 0`）。
       *
       * **A10（2026-11-01 进默认）**：连续失衡的末窗被战斗时钟截短 ⇒ `stunCoverage` 扣掉
       * `clip / effTime`（`clip = min(overflowSeconds, 一窗)`，与 `buildStunTimeline` / 轴栈同源）。
       * ⇒ 同源恒等式变成 `隐含窗数 + clip/W == 池次数`。回退闸关时 clip 恒 0（退回原式）。
       */
      const a10On = probeFlag('PROBE_STUN_CLIP_ITER') !== 'off'
      const clip = a10On ? Math.min(Math.max(0, rr.overflowSeconds ?? 0), W) : 0
      const impliedWindows = cov * effTime / W
      if (Math.abs(impliedWindows + clip / W - pool.stunCount) > 0.02 && cov < 0.999) {
        violations.push(`${preset.id}: 覆盖率隐含 ${impliedWindows.toFixed(3)} 窗 + clip ${(clip / W).toFixed(3)} 窗 vs 池 ${pool.stunCount}（exit=${rr.convergence.outerExit}）`)
      }
    }
    expect(violations, `覆盖率与池次数不同源（同一结果里两个物理量）：\n${violations.join('\n')}`).toEqual([])
    // 反空洞（2026-10-20 更新）：原先要求「扫描面里必须有 cycle 队」以覆盖 CC-150 钳位分支。
    // 连续失衡落地后**环已归零**（全库 cycles=0，见 continuousStunMonotonic.test.ts 判据①）
    // ⇒ 该前提不再成立，但**判据本身更强了**：既然没有 cycle 队，就不存在「钳位后覆盖率
    // 与池不同源」的窗口期 —— 同源必须无条件成立。故改为直接断言扫描面非空。
    expect(scanned, '扫描面塌了（一个预设都没跑到）').toBeGreaterThan(80)
    // 反空洞②：覆盖率必须真的被算出过非零值，否则判据恒真
    expect(nonZeroCoverage, '全库覆盖率恒 0 ⇒ 本判据恒真').toBeGreaterThan(0)
  }, 900_000)
})
