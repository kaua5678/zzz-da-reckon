/**
 * 「② 的落点 = 最小吸收率」全库判据的**分片执行器**（T182，2026-10-18）。
 *
 * ## 为什么单独成文件 + 为什么拆成 4 个**文件**（不是 4 条 `it`）
 *
 * 这条判据原本是 `difficultyLadder.test.ts` 里的**一条** `it()`：内部顺序跑全库 93 队，
 * 每队一次 `climbDifficultyLadder`（含一次 joint 联合搜索 + ②③ 吸收网格 + ④ 逐槽阶梯），
 * 烧吸收的队再跑一次 `absorbCap = 0`。实测**单条用例 592s**，是整套 `npm run verify` 的
 * **唯一长尾**：全量墙钟 691s，其中这一条占 **86%**。
 *
 * vitest 只做**文件级**并行（同文件内的用例串行）⇒ 拆成 4 条 `it` 墙钟不变，必须拆成 4 个文件。
 *
 * ## 判据本身一字未改
 *
 * 每队仍断言「**r > 0 ⇒ cap=0 时 ② 必须缺失**」（吸收确实是必需的，不是白烧）。
 * 分片只改变**谁在哪跑**，不改变断言、不改变阈值、不改变夹具口径（3 槽队全库）。
 *
 * ## 分片口径 = 排序后下标取模（不是硬编码 id 清单）
 *
 * `teamPresets` 已按 `name.localeCompare` 排序（`data/teamPresets.ts:119`）⇒ 下标在所有分片文件里一致。
 * 取模的好处：**新增预设自动落入某一片**，不会像手写清单那样静默漏覆盖。
 * 覆盖的完全性由 `difficultyLadderBurnCoverage.test.ts` 静态断言（并集 == 全库、两两互斥、非空）。
 *
 * ## 实测分片成本
 *
 * 队数/覆盖率来自 `.zc/perf/T185ms.perf.ts`（93 队逐队计时，顺序跑）；耗时列**实测于 4 文件并发跑**
 * （`npx vitest run …BurnShard{0,1,2,3}`，4 个分片互抢 CPU 的现场，与全量套件里的情形同量级）：
 *
 * | 分片 | 队数 | 含 ② 的队 | 需烧吸收 | 实测耗时（4 文件并发） |
 * |---|---|---|---|---|
 * | 0 | 24 | 5 | 1 | 102s |
 * | 1 | 23 | 5 | 1 | 134s |
 * | 2 | 23 | 5 | 3 | 146s |
 * | 3 | 23 | 5 | 0 | 112s |
 *
 * ⚠ 分片 3 恰好**不需要烧吸收**的队 ⇒ 「必要性」在该片空跑，故非平凡性由
 * `difficultyLadderBurnCoverage.test.ts` 的**见证队**全局断言承担（原用例的 `burning > 0` 就是这条）。
 */
import { teamPresets } from '@/data/teamPresets'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { climbDifficultyLadder } from '@/composables/difficultyLadder'
import type { TeamPreset } from '@/types/teamPreset'

/** 分片数（改它要同步 `package.json` 的 `test:fast` 排除集与 `EXPECTED_FAST_EXCLUDES`） */
export const LADDER_BURN_SHARD_COUNT = 4

/** 参与本判据的预设：与分片前逐字同口径（3 槽队全库） */
export function burnCheckPresets(): TeamPreset[] {
  return teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
}

/** 本分片负责的预设（排序后下标取模；越界即抛，防「分片号写错 ⇒ 静默跑全库两遍」） */
export function burnCheckShard(shard: number, count = LADDER_BURN_SHARD_COUNT): TeamPreset[] {
  if (!Number.isInteger(shard) || shard < 0 || shard >= count) {
    throw new Error(`分片号非法：${shard}（合法范围 0..${count - 1}）`)
  }
  return burnCheckPresets().filter((_, i) => i % count === shard)
}

export interface BurnCheckResult {
  /** 本片实际扫描的队数（覆盖面自证用） */
  scanned: number
  /** 本片产出 ② 的队数（分片级反空洞） */
  withAxis: number
  /** 本片 ② 落在 r > 0 的队数（= 真正触发「必要性」分支的样本） */
  burning: number
  /** 违例：「② 落在 r>0，但 r=0 就已能立轴」 */
  notMinimal: string[]
}

/**
 * 跑一片（或全库，若传全量预设）的判据。
 *
 * 夹具口径与分片前一致：**一个** harness + 一个 calc 复用于全部队（`climbDifficultyLadder`
 * 自带现场还原契约 ⇒ 队间不串味；否则分片前那条用例早就互相污染了）。
 */
export async function runBurnCheck(presets: readonly TeamPreset[]): Promise<BurnCheckResult> {
  const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
  await catalog.loadBuildRecommendations()
  const calc = useResourceCalc()
  const notMinimal: string[] = []
  let withAxis = 0
  let burning = 0
  for (const p of presets) {
    const team = p.team as [string, string, string]
    const r = climbDifficultyLadder({ config, calc, absorbCap: 1 }, team)
    const a = r.points.find(x => x.point === 'axis')
    if (!a) continue
    withAxis++
    if (a.knobs.absorb <= 0) continue
    burning++
    // r > 0 ⇒ 吸收是必需的：把 cap 压到 0（唯一格点 = 0）时 ② 必须不再存在
    const rZero = climbDifficultyLadder({ config, calc, absorbCap: 0 }, team)
    if (!rZero.axisPointMissing) {
      notMinimal.push(`${p.id}: ② 落在 r=${a.knobs.absorb}，但 r=0 就已能立轴（白烧吸收）`)
    }
  }
  return { scanned: presets.length, withAxis, burning, notMinimal }
}
