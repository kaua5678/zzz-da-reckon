/**
 * 角色分数增量（charIncrement）真实归档集成测试：
 * - computeIncrementPass 全量：**性能判据 = 单位工作量 ÷ 同进程机器速度标尺**（≤1.0×，
 *   2026-10-09 口径纠正；2026-09-11 用户裁决废除绝对墙钟线，见下方「性能判据」段）、
 *   调用方 store 全程不被改写（r369 独立场景：含 yield 中途）
 * - 期/房间/基底队规模合理；账号分 ≤ 180000（3 房 × 60000 伤害分上限，操作分已剔除）
 * - 卡增量语义：卢西娅（1451，命破专拐）累计 > 0 且「禁用后被替代队顶上」至少出现一次
 *
 * 两个用例**共享同一次全量 pass**（2026-10-09，memo 而非 beforeAll；理由见 `fullPassOnce`）：
 * 同一队、同 runs、同 rooms 的全量求值原先各跑一遍（实测各 ~15s CPU），
 * 共享结果后本文件 CPU 约减半，而性能判据的负载本体与 r369 隔离断言都保持不变。
 *
 * 超时：**不写 per-test 绝对超时**（2026-09-14 实测：两个用例原先各钉 `90000`，而本文件单跑 41s / 29s、
 * 满套件并发下必然 `Test timed out in 90000ms` ⇒ 那是「机器/并发」的第二个副本，与已废除的绝对墙钟线同族）。
 * 基础设施超时统一由 `vite.config.ts` 的 `testTimeout: 180_000` 承担（本仓重负载用例的既定做法）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { useConfigStore } from '@/stores/config'
import { computeAllCardTotals, computeCardIncrements, computeIncrementPass } from '@/composables/charIncrement'
import type { IncrementPassResult } from '@/composables/charIncrement'
import type { BossPreset, BossPresetFile } from '@/types/bossPreset'
import type { ArchiveRoom } from '@/composables/runArchiveImport'

const raw = JSON.parse(readFileSync(new URL('../../../public/static/run-archive.json', import.meta.url), 'utf8'))
const bossData = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile

/**
 * 性能判据的机器速度标尺（2026-10-09 口径纠正）。
 *
 * 是什么：固定工作量的**分配型** CPU 循环（小 Map + 字符串键 churn，与被测引擎同为对象/GC 密集型），
 * 取 3 次采样中位数、采样前热身一次（抗 JIT 与 GC 暂停）。
 *
 * 为什么长这样：
 * - **零引擎代码** ⇒ 引擎变慢不会改变标尺读数（否则「引擎比引擎」的自参照会在回归时同比例膨胀，
 *   比值原地不动——实测见下方判据段的「旧口径反向」证据）；
 * - **固定迭代数**（不是「跑够 X 毫秒」）⇒ 快机上小、慢机/负载下大，才真正编码了「当前机器+负载的速度」；
 * - **中位数**而非最小值/均值：最小值会被「恰好没被抢占的那一次」系统性低估，均值被 GC 暂停抬高。
 */
const YARD_ITERS = 700_000
/** 标尺累加器（模块级：防 V8 把无副作用的纯循环整个消除，本地变量可被证明无用） */
let yardSink = 0

function machineYardMs(): number {
  const runOnce = (): number => {
    const t0 = performance.now()
    for (let i = 0; i < YARD_ITERS; i++) {
      const m = new Map<string, number>()
      for (let j = 0; j < 8; j++) m.set(`k${j % 4}:${j}:1`, i * j)
      yardSink += m.size
    }
    return performance.now() - t0
  }
  runOnce()
  const xs = [runOnce(), runOnce(), runOnce()].sort((a, b) => a - b)
  return xs[1]
}

describe('charIncrement · 真实归档集成', () => {
  /**
   * 全量 pass 的**单次求值 + 结果共享**（2026-10-09）。
   *
   * 为什么：两个用例原先各跑一遍**同队、同 runs、同 rooms** 的全量 `computeIncrementPass`
   * （实测各 ~15s CPU，全量套件里本文件因此占 ~32s）。`docs/mcp-dev-process-speed.md` §8.3
   * 早已把「同一全量跑两遍」列为顺手项（估省 14s CPU），触发条件写明「改到这些文件时做」。
   *
   * ⚠ 为什么是 memo 而不是 `beforeAll`：本次求值实测 ~15s，而 vitest 的 `hookTimeout` 默认 **10s**
   * （本仓 `vite.config.ts` 只配了 `testTimeout: 180_000`）⇒ 放进 `beforeAll` 会在慢机/并发下
   * `Hook timed out`，那正是本文件反复否决的「机器/并发第二个副本」。memo 挂在**首个调用它的用例**
   * 上，走 `testTimeout`（180s），且与用例顺序无关（谁先调谁付这笔）。
   *
   * ⚠ 为什么不能省掉第二次求值本身：本用例组里**只有这一次全量**带 `onProgress`，即
   * 「调用方 store 全程不变」那条隔离断言（r369）依赖它逐次回报；而那 84 次引擎求值同时是
   * 性能判据的负载本体。共享的是**结果**，不是把负载删掉——两个用例仍跑满同一份工作量一次。
   */
  let sharedPass: Promise<{ res: IncrementPassResult; midRunChecks: number; midRunDiffs: number; storeBefore: string; yardMs: number }> | null = null

  /** 跑（或复用）那次带 store 监视的全量 pass */
  function fullPassOnce() {
    if (!sharedPass) {
      sharedPass = (async () => {
        await setupHarness([{ agentId: '1021' }, { agentId: '1031' }, { agentId: '1131' }])
        const configStore = useConfigStore()
        const storeBefore = JSON.stringify(configStore.$state)
        let midRunChecks = 0
        let midRunDiffs = 0
        const watchStore = () => {
          midRunChecks++
          if (JSON.stringify(configStore.$state) !== storeBefore) midRunDiffs++
        }
        // 热身 pass（2 个 run ≈0.1s）：把引擎热路径的 JIT 编译与模块懒初始化成本挤出被测区间——
        // 那是**一次性**成本、不随工作量增长，计入「单位工作量」会系统性虚高（旧口径的参照 pass 恰好
        // 顺带起了这个作用；换尺后必须显式保留，否则本判据会因冷启动而漂移）。测量对象 = 稳态单位工作量。
        await withAnalysisScenario(scenario => computeIncrementPass({
          scenario,
          bosses: bossData.bosses as BossPreset[],
          runs: raw.runs.slice(0, 2),
          rooms: raw.rooms as Record<string, ArchiveRoom & { seasonStart?: string }>,
        }))
        const yardMs = machineYardMs()
        const res = await withAnalysisScenario(scenario => computeIncrementPass({
          scenario,
          bosses: bossData.bosses as BossPreset[],
          runs: raw.runs,
          rooms: raw.rooms as Record<string, ArchiveRoom & { seasonStart?: string }>,
          onProgress: watchStore,
        }))
        return { res, midRunChecks, midRunDiffs, storeBefore, yardMs }
      })()
    }
    return sharedPass
  }

  it('全量 pass：秒级完成、期规模合理、账号分不超上限、调用方 store 全程不变', async () => {
    // ===== 性能判据：单位工作量 ÷ 同进程机器速度标尺（2026-10-09 口径纠正）=====
    // 判据 = (stats.durationMs / stats.evaluations) / machineYardMs() ≤ RATIO_MAX
    //   「单位工作量」= 每次引擎求值（基底队）的平均耗时 —— 引擎求值正是本 pass 里唯一随规模增长的项；
    //   「标尺」= 同进程固定工作量纯 CPU 循环，编码当前机器+负载的速度。
    //
    // 为什么换掉旧口径（全量墙钟 ÷ 2-run 参照墙钟 ≤ 100×，2026-09-11 立）——两条实测否决：
    // ① **对负载敏感**（本任务要修的假红）：参照切片只有 2 个 run，实测其耗时 ≈55ms 中约四成是
    //    「场景深拷贝 + 期轴 + 44 房间匹配」的**固定开销**，而全量 84 次求值几乎全是可线性摊薄的工作量
    //    ⇒ 满套件并发下分子 ×2.15、分母仅 ×1.14（2026-10-09 实测：全量 12814→27617ms、参照 240→274ms）。
    // ② **对回归反向**（更严重，2026-10-09 负控实测）：把单位求值成本 ×3 后，旧比值从 88.7 **降到 46.5**
    //    （离 100 的红线更远、断言更绿）——分母同样按「每次求值」计费，且它只有 2 次求值、固定开销占比高，
    //    于是 u→3u 时分母涨得比分子更凶。**旧口径连它声称要抓的回归都抓不到**（同一份注入下新口径 0.409→1.761 红）。
    //    附带：参照切片取「前 2 条 run」是另一个 workload——前 50 条 run 全打同一个 Boss（3 次求值），
    //    「把参照放大到 20~50 run」拿不到线性工作量（求值数由归档出现的 Boss 桶数决定，不由 runs 条数决定）。
    //
    // 为什么新口径对负载不敏感：负载同时拖慢「引擎求值」与「同进程标尺」⇒ 相除约掉；
    // 而单位工作量回归只抬分子、不动标尺 ⇒ 比值上升。实测（本机 16 vCPU / 9GB）：
    //   | 条件             | 比值                             |
    //   | 空闲 ×4          | 0.492 0.587 0.603 0.561          |
    //   | 满套件并发 ×6    | 0.592 0.614 0.585 0.535 0.484 0.409 |
    //   | 单位求值 ×3 ×4   | 1.584 1.559 1.427 1.598          |
    //   噪声上界 0.624 / 回归下界 1.427 ⇒ 取几何中点 **1.0** 当回归线（分离度 2.3×，两侧余量均 ≥1.6×）。
    // 阈值语义：单位工作量比标定日慢 1.0/0.58 ≈ 1.7 倍即红（原设计意图「慢 3 倍即红」在此尺上更严，
    // 因该尺的噪声带比旧尺窄得多——旧尺无回归时已读到 88.7/100）。**不要靠调大 RATIO_MAX 求绿**——
    // 那正是旧口径的失败模式。
    //
    // @fact engine:charIncrement/性能判据 口径: 性能回归判据 = (stats.durationMs/stats.evaluations) ÷ 同进程固定工作量标尺（测试侧零引擎代码、3 次中位数），线 1.0×；禁用「引擎比引擎」自参照（回归时同比例膨胀 ⇒ 比值不动）与绝对墙钟线（测机器不测回归） | 据 用户@2026-09-11（废绝对墙钟线，改比值方向）·口径纠正@2026-10-09（实测旧尺对负载敏感且对回归反向：88.7→46.5 而新尺 0.409→1.761） | 验 src/composables/__tests__/charIncrementInt.test.ts | 锚 src/composables/__tests__/charIncrementInt.test.ts#machineYardMs | 信 确认
    // ⟳复核: 标尺常数 YARD_ITERS 与线 1.0× 是否仍匹配当时机器——看空闲/并发噪声上界是否仍 ≤0.63（超了就重标定，别只调线） | 到期 2027-04-09
    const RATIO_MAX = 1.0
    const { res, midRunChecks, midRunDiffs, storeBefore, yardMs } = await fullPassOnce()
    const unitMs = res.stats.durationMs / Math.max(1, res.stats.evaluations)
    const ratio = unitMs / yardMs
    // eslint-disable-next-line no-console
    console.log(`[perf] 单位求值 ${unitMs.toFixed(1)}ms × ${res.stats.evaluations} 次 = 全量 ${res.stats.durationMs}ms / 标尺 ${yardMs.toFixed(1)}ms = ${ratio.toFixed(3)}×（线 ${RATIO_MAX}×）`)
    expect(
      ratio,
      `单位工作量变慢（单位求值 ${unitMs.toFixed(1)}ms / 标尺 ${yardMs.toFixed(1)}ms = ${ratio.toFixed(3)}× > ${RATIO_MAX}×）`,
    ).toBeLessThan(RATIO_MAX)
    expect(res.periods.length).toBeGreaterThanOrEqual(8)
    expect(res.stats.baseTeams).toBeGreaterThan(60)
    for (const p of res.periods) {
      expect(p.rooms.length).toBeGreaterThan(0)
      expect(p.rooms.length).toBeLessThanOrEqual(3)
      const total = p.rooms.reduce((s, r) => s + Math.max(...r.scores.map(x => x.score)), 0)
      expect(total).toBeLessThanOrEqual(3 * 60000 + 1e-6)
    }
    // 时间升序
    for (let i = 1; i < res.periods.length; i++) {
      expect(res.periods[i - 1].date.localeCompare(res.periods[i].date)).toBeLessThanOrEqual(0)
    }
    // 调用方 store：中途（每次进度回报）与跑完都与开跑前逐字相同
    expect(midRunChecks).toBeGreaterThan(5)
    expect(midRunDiffs).toBe(0)
    expect(JSON.stringify(useConfigStore().$state)).toBe(storeBefore)
  })

  it('卢西娅增量：累计 > 0；被禁后存在「替代队顶上」的期（潘引壶/其他队）', async () => {
    const { res } = await fullPassOnce()
    const inc = computeCardIncrements(res.periods, '1451', '2025-12-17')
    expect(inc.total).toBeGreaterThan(0)
    // 至少一期「被禁后账号分下降但非塌零」（替代结构存在）
    const substituted = inc.perPeriod.filter(x => x != null && x.bannedScore > 0 && x.increment > 0)
    expect(substituted.length).toBeGreaterThan(0)
    // 实装前（2025-12-17 之前）的期 = null
    const early = inc.perPeriod.filter(x => x == null)
    if (res.periods.some(p => p.date < '2025-12-17')) expect(early.length).toBeGreaterThan(0)

    const rank = computeAllCardTotals(res.periods, [
      { agentId: '1451', releaseDate: '2025-12-17' },
      { agentId: '1531', releaseDate: '2026-05-27' },
    ])
    expect(rank).toHaveLength(2)
    for (const r of rank) expect(r.total).toBeGreaterThanOrEqual(0)
  })
})
