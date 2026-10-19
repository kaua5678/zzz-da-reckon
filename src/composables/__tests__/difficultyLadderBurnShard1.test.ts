/**
 * 「② 的落点 = **最小**吸收率」全库判据 —— **分片 1/4**（T182，2026-10-18）。
 *
 * 判据原文与分片理由见 `src/test/ladderBurnShard.ts` 文件头；**断言一字未改**：
 * 每队 `r > 0 ⇒ absorbCap=0 时 ② 必须缺失`（吸收确实是必需的，不是白烧）。
 *
 * 本片 = 全库 3 槽预设排序后下标 `% 4 === 1`（24/23/23/23 队，实测 101/146/122/146s）。
 * 覆盖完全性（并集 == 全库、两两互斥）由 `difficultyLadderBurnCoverage.test.ts` 静态断言。
 */
import { describe, expect, it } from 'vitest'
import { burnCheckShard, runBurnCheck } from '@/test/ladderBurnShard'

describe('难度曲线关键旋钮点（T140c）· ② 的落点分片 1/4', () => {
  it('② 的落点 = **最小**吸收率（r 恰好是首个使轴成立的网格点，不是机械取 cap）', async () => {
    const presets = burnCheckShard(1)
    expect(presets.length, '分片 1 不得为空（分片数改大后必须同步加文件）').toBeGreaterThan(0)
    const { scanned, withAxis, notMinimal } = await runBurnCheck(presets)
    expect(scanned, '本片必须跑完自己那批队（覆盖面自证）').toBe(presets.length)
    expect(notMinimal, `② 烧吸收必须确有必要（这些队 r=0 就够）：\n${notMinimal.join('\n')}`).toEqual([])
    // 分片级自证：本片确实有队产出 ②（否则这一片对判据零覆盖）
    expect(withAxis, '反空洞：本片必须有队产出 ②（否则本判据零覆盖）').toBeGreaterThan(0)
  }, 1_800_000)
})
