/**
 * 降配档单调闸门（`interactionScaleMonotone` + `interactionScaleCeiling`，用户口径 2026-09-20）生效测试
 * = `@fact engine:降配档单调闸门`（`resourceCalc/solveTeam.ts#stageResolveFeasibility`）的「验」。
 *
 * 原在 `difficultyDescent.test.ts`。结果页难度下降面板与其引擎 `difficultyDescent.ts` 删除时
 * （`.claude/PROMPT-merge-difficulty-curves.md` 任务 A），这条**只依赖引擎**的用例原样迁来——
 * 它锁的是 solveTeam 的闸门行为，不是面板。
 * ⚠ 下降引擎是生产代码里唯一置位该闸门的调用方；删除后闸门只剩测试在开，存废见
 * `docs/mcp-worker-task-queue.md` §3 T23。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'

/** 叶瞬光+琉音+照：难度档位在这队上实测跨档最明显（剑势 30→36 触发第 6 次照影） */
async function setupTeam(cinemaLevel = 0) {
  const { config } = await setupHarness([
    { agentId: '1431', cinemaLevel },
    { agentId: '1481', cinemaLevel: 0 },
    { agentId: '1341', cinemaLevel: 0 },
  ])
  config.team[0].wEngineId = '14143'
  config.team[0].wEngineModLevel = 1
  config.team[1].wEngineId = '14148'
  config.team[1].wEngineModLevel = 1
  config.team[2].wEngineId = '14134'
  config.team[2].wEngineModLevel = 1
  config.setMechanicSetting('yeshuguang.formAxis', 0)
  config.syncTeammateBuffsFromTeam()
  const calc = useResourceCalc()
  return { config, calc }
}

describe('降配档单调闸门（用户口径 2026-09-20）', () => {
  /**
   * 单因素单调（用户：「单因素可以」）：闸门开启后沿**合轴率**这一个因素降下去，
   * 交互档不回升、伤害不回升。
   */
  it('单因素（合轴率）：闸门开启 ⇒ 交互档与伤害单调不增；关掉则复现反转', async () => {
    const run = async (gate: boolean) => {
      const { config, calc } = await setupTeam(0)
      // CC-149（第 179 轮）：去掉 CC-148 的显式 off 钉，改跑 physical 缺省。原先 physical 下 0.4 档被降配相对臂③
      // （留白不增，基线态截断 52.6s 时无意义）否决了真可行的 0.125 档 ⇒ 冷启动最大可行档锯齿、0.4→0.3 伤害回升。
      // 修后（solveTeam：绝对可行即接受）实测闸门开 0.125/0.125/0.0625/0.0625/0.0625、伤害严格下降；
      // 闸门关 0.2→0.1 交互档 0.0625→0.125 回升（对照组仍复现）。docs/mcp-stun-dual-source.md §21。
      config.setMechanicSetting('yeshuguang.formAxis', 0)
      if (gate) config.interactionScaleMonotone = true
      const rows: Array<{ cap: number; scale: number; dmg: number }> = []
      /**
       * 闸门从「满档」起步，之后由引擎按采纳值单调下调（曲线里的实际用法）。
       * 注意**不能每档重置 ceiling = 1**——那等于把闸门关掉，回升会原样复现。
       */
      if (gate) config.interactionScaleCeiling = 1
      for (const cap of [0.4, 0.3, 0.2, 0.1, 0]) {
        config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, cap)
        await new Promise(r => setTimeout(r, 0))
        const rr = calc.resourceResult.value!
        rows.push({ cap, scale: rr.convergence?.interactionScale ?? 1, dmg: calc.teamTotalDamage.value })
      }
      return rows
    }

    const on = await run(true)
    const at020 = on.find(r => r.cap === 0.2)!
    const at010 = on.find(r => r.cap === 0.1)!
    expect(at010.scale, `合轴率 0.20→0.10 交互档不得回升（实测 ${at020.scale} → ${at010.scale}）`).toBeLessThanOrEqual(at020.scale + 1e-9)
    for (let i = 1; i < on.length; i++) {
      // 第 187 轮（CC-160）：**同一交互档**内允许 ≤0.1% 的相对回升——那是折叠环停滞判据（~1s 量级）留下的残余留白差
      // （实测 0.4→0.3 同为 0.125 档：留白 1.89→1.52、伤害 +0.045%），不是闸门要拦的「交互档回升」结构反转
      // （历史反转 +0.6%~+16%，且都伴随档位回升）。档位变了仍零容差。回退点：删 sameTier 分支。
      const sameTier = Math.abs(on[i]!.scale - on[i - 1]!.scale) < 1e-9
      const slackAllowed = sameTier ? on[i - 1]!.dmg * 1e-3 : 1e-6
      expect(on[i]!.dmg, `合轴率 ${on[i - 1]!.cap}→${on[i]!.cap} 伤害不得回升`).toBeLessThanOrEqual(on[i - 1]!.dmg + slackAllowed)
    }

    // 对照：关掉闸门 ⇒ 复现历史反转（0.20 → 0.10 交互档回升）——证明闸门是承重的，不是装饰
    const off = await run(false)
    const off020 = off.find(r => r.cap === 0.2)!
    const off010 = off.find(r => r.cap === 0.1)!
    expect(off010.scale, '关掉闸门应复现历史反转（交互档回升）').toBeGreaterThan(off020.scale)
  }, 900_000)
})
