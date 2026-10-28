/**
 * 「② 烧吸收」判据的**非平凡性见证**（T182，2026-10-18）。
 *
 * ## 为什么需要这个文件
 *
 * 分片前那条用例（`difficultyLadder.test.ts` 的 592s `it`）末尾有一句：
 * `expect(burning > 0, '新口径下应有队需要烧吸收才能让轴一招不少（否则本判据是空转的）')`。
 * 它是**整条判据的非空性闸门**：若全库 ② 都落在 `r = 0`，「吸收确实必需」这条命题就退化成
 * 「所有人都没烧 ⇒ 没人可冤枉」，判据虽然全绿却零判别力。
 *
 * 拆成 4 个分片后，这句**跨片**断言无处安放（vitest 的文件之间不共享状态），
 * 而 4 个分片里各自只承担 1/4 的队（实测分片 3 恰好 0 支烧吸收队）。
 * ⇒ 单列本文件：只跑**实测确实烧吸收**的 3 支队（跨 r=0.4/0.55/0.85 三档），
 * 断言「确实有队要烧」+「烧是必需的」。成本 ≈ 15s，换掉原来 592s 里的那句闸门。
 *
 * ## 见证队（2026-10-28 重扫：`.zc/perf/r74witness.probe.perf.ts`，全库 102 预设逐队实测）
 *
 * | 队 | ② 的吸收率 |
 * |---|---|
 * | `yixuan-roxy-lucia` | 0.30 |
 * | `auto-1591-1481-1211` | 0.80 |
 * | `auto-1591-1571-1211` | 0.05 |
 *
 * ⚠ **见证队若某天不再烧吸收**（引擎口径收紧/放宽使轴更容易/更难成立），本文件会红。
 * 那是**该复核**的信号，不是「改断言」的信号：先重跑全库扫描（`.zc/perf/r74witness.probe.perf.ts`，
 * 原 `T185ms.perf.ts` 已不在盘上）重新量分布，
 * 确认「还有没有别的队在烧」，再把见证集换成新实测出来的队（并在提交说明里写 delta）。
 * **不许**直接把断言删掉——那就把非空性闸门整个拆了。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { climbDifficultyLadder } from '@/composables/difficultyLadder'

/**
 * 实测确实烧吸收的见证队（跨三档吸收率）。
 *
 * ⚠ **2026-10-28 重选**（本文件头「该复核的信号」）：轴模式失衡改逐招口径后，原 3 支
 * （`auto-1371-1481-1451` / `claret-koleda-rina` / `auto-1611-1571-1211`）② 全落 `r=0`。
 * 重扫全库 102 预设（`.zc/perf/r74witness.probe.perf.ts`，原 `T185ms.perf.ts` 已不在盘上）：
 * 仍烧吸收的恰 3 支 = 下表（`yixuan-roxy-lucia@0.3` / `auto-1591-1481-1211@0.8` / `auto-1591-1571-1211@0.05`）。
 * 谓词（`② 的吸收率 > 0`）与断言主体（非空 + 必需性）一字未改，只换样本队。
 */
const WITNESSES = ['yixuan-roxy-lucia', 'auto-1591-1481-1211', 'auto-1591-1571-1211'] as const

describe('难度曲线关键旋钮点（T140c）· ② 烧吸收的非平凡性见证', () => {
  it('这些队 ② 真的烧吸收，且 r=0 时轴立不起来（吸收确实必需）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const burning: string[] = []
    const notNecessary: string[] = []
    for (const id of WITNESSES) {
      const p = teamPresets.find(x => x.id === id)
      expect(p, `见证队 ${id} 已不在预设库里（改名/删除 ⇒ 先重跑 T185ms.perf.ts 重选见证集）`).toBeDefined()
      const team = p!.team as [string, string, string]
      const r = climbDifficultyLadder({ config, calc, absorbCap: 1 }, team)
      const a = r.points.find(x => x.point === 'axis')
      if (a && a.knobs.absorb > 0) {
        burning.push(`${id}@${a.knobs.absorb}`)
        // 必需性：cap 压到 0（唯一格点 = 0）时 ② 必须不再存在
        const rZero = climbDifficultyLadder({ config, calc, absorbCap: 0 }, team)
        if (!rZero.axisPointMissing) notNecessary.push(`${id}: ② 落在 r=${a.knobs.absorb}，但 r=0 就已能立轴`)
      }
    }
    // 非空性闸门（原 `burning > 0` 的等价物，现在钉在实测见证队上）
    expect(burning, '见证集里必须仍有队在烧吸收（若全变 r=0 ⇒ 先重跑 T185ms.perf.ts 重选见证集，别删断言）')
      .not.toHaveLength(0)
    expect(notNecessary, `烧吸收必须确有必要：\n${notNecessary.join('\n')}`).toEqual([])
  }, 600_000)
})
