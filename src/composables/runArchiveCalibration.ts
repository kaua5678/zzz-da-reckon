/**
 * 实战归档校准：把「建模误差」从逸事变成可测指标。
 *
 * ── 为什么存在 ────────────────────────────────────────────────────────────
 * public/static/run-archive.json 有 5758 条 approved 危局投稿（队伍/命座/音擎/精炼/
 * 分数/是否击杀齐全），但此前只被用于「单条一键部署对比」（RunArchivePage）。
 * 没有全量误差度量 = 引擎的系统性偏差谁也说不清，只能靠个案争论。本模块提供
 * 抽样与统计的**纯函数层**，真引擎批跑在探针里。
 *
 * ── 观测口径：实战分是**区间观测**，不是点观测 ─────────────────────────────
 * 归档总分 = 伤害分（≤60000）+ 操作分（≤5000），归档不拆分两者。所以：
 *   - 击杀的 run：伤害分**恰好** 60000（打满），区间退化成一个点；
 *   - 未击杀的 run：伤害分 ∈ [总分−5000, 总分]（操作分未知，只知上界）。
 * 预测值落在区间内 = 误差 0（不是「差了一点」），落在外面才按到最近边界的距离计。
 * 这样处理才不会把「操作分未知」当成模型误差记账。
 *
 * ── 口径（用户 2026-09-01 裁决，决定了这份报告怎么读）────────────────────
 * **计算器算的是上限**（理想配装 + 理想操作）。于是两侧误差的性质完全不对称：
 *   - **低估（预测 < 实战下界）= 硬错误**：上限不可能低于真实发生过的事，每一条都是
 *     可证伪的建模缺口（多半是该角色机制没录完）。这是本模块唯一该卡的方向。
 *   - **高估 = 正常**：上限本来就高于普通实战（配装差 + 操作差），归档无法从上方证伪它。
 *     但**跨角色的高估离群点**仍值得查（派派 2026-09-01 即由此定位到三处恒满近似叠乘）。
 * 推论（用户明确要求）：**归档的低分不得反推去改资源循环**——别人分低是因为别人的机制
 * 没录完，不是计算器的循环该往下调。
 *
 * 2026-09-01 用户进一步裁决，**棘轮已删除**：当前每支队伍的计算逻辑都还不准，把「距离归档分数」
 * 冻成 CI 判据会惩罚方向正确、但单步之后暂时更远离实战的改动（正确性改动往往要几步才回到实战附近）。
 * 所以本模块只剩**只读诊断**：按需跑 npm run probe:calibration 看误差分布与分层偏差，
 * **不进 CI、不设基线、不作拟合目标**。
 * 击杀判定（bossKilled）不受操作分影响，是最干净的二分类信号。
 */
import { DEADLY_ASSAULT_SCORE_CAP } from '@/core/deadlyAssaultScore'

/** 确定性伪随机（mulberry32）：同种子同结果，供分层抽样洗牌用（原 acquisitionValue 迁入） */
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// @fact engine:calibration/配装前置 口径: 批跑归档前必须 catalog.loadBuildRecommendations()——applyTeamPreset 内的配装推荐在未加载时静默 no-op，全队裸装会伪造出巨幅「系统性低估」 | 据 实测@2026-08-31·复核@2026-09-01 | 验 src/composables/__tests__/runArchiveCalibration.test.ts | 锚 src/composables/runArchiveCalibration.ts#OPERATION_SCORE_MAX | 信 确认

/** 归档单房操作分上限（65000 = 60000 伤害分 + 5000 操作分，见 run-archive note） */
export const OPERATION_SCORE_MAX = 5000

export interface CalibrationCase {
  runId: string
  mode: string
  /** 困难/逆境模式（分段曲线不同） */
  hard: boolean
  primaryAgentId?: string
  team: string[]
  bossId?: string
  phaseId?: string
  actualScore: number
  actualKill: boolean
  predictedDamageScore: number
  predictedKill: boolean
  /** 预测伤害 / Boss 血量 */
  damageRatio: number
  /**
   * 该次预测是否走了失衡轴（通用自动轴命中预设队伍时自动开）。
   * 分层看它 = 把「口径差（没轴）」与「建模差（有轴仍偏）」分开的最直接刀口。
   */
  axisActive?: boolean
}

/** 实战伤害分的可行区间（击杀 → 退化为点 60000） */
export function damageScoreBounds(actualScore: number, actualKill: boolean, opsMax = OPERATION_SCORE_MAX): [number, number] {
  if (actualKill) return [DEADLY_ASSAULT_SCORE_CAP, DEADLY_ASSAULT_SCORE_CAP]
  const hi = Math.max(0, Math.min(actualScore, DEADLY_ASSAULT_SCORE_CAP))
  const lo = Math.max(0, Math.min(hi, actualScore - opsMax))
  return [lo, hi]
}

/** 有符号误差：区间内 = 0；高于上界 = 正（高估）；低于下界 = 负（低估） */
export function signedError(predicted: number, bounds: [number, number]): number {
  if (predicted > bounds[1]) return predicted - bounds[1]
  if (predicted < bounds[0]) return predicted - bounds[0]
  return 0
}

export type KillOutcome = 'tp' | 'fp' | 'fn' | 'tn'
/** 击杀判定四象限：fp = 预测击杀实战没杀（高估）；fn = 实战杀了预测没杀（保守） */
export function killOutcome(predictedKill: boolean, actualKill: boolean): KillOutcome {
  return predictedKill ? (actualKill ? 'tp' : 'fp') : (actualKill ? 'fn' : 'tn')
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))]
}

export interface CalibrationSummary {
  n: number
  /** 预测落在实战可行区间内的比例（越高越好） */
  insideRate: number
  /** 平均绝对误差（伤害分，0-60000 量纲） */
  mae: number
  medianError: number
  /** 有符号平均误差：正 = 系统性高估 */
  meanBias: number
  p10: number
  p90: number
  /** 低估侧（预测 < 实战下界）：**可证伪的建模缺口**，棘轮卡这一侧 */
  under: { count: number; mean: number }
  /** 高估侧：上限高于实战属正常，只报不卡（跨角色离群点仍要查） */
  over: { count: number; mean: number }
  /**
   * 伤害/血量比的分位（**不被 60000 天花板削顶**）。
   * 分数在 ratio ≥ 1 之后就饱和了，所以「上限降了 15%」这种改动在分数上完全看不见
   * （2026-09-01 派派实测：5 条样本 ratio 1.19~3.49，分数全钉在 60000）。
   * 要看高估侧的改动效果，只能看这里。
   */
  ratio: { median: number; p90: number; overOneRate: number }
  kill: { tp: number; fp: number; fn: number; tn: number; accuracy: number; precision: number; recall: number }
}

export function summarizeCalibration(cases: CalibrationCase[]): CalibrationSummary {
  const errs = cases.map(c => signedError(c.predictedDamageScore, damageScoreBounds(c.actualScore, c.actualKill)))
  const abs = [...errs].map(Math.abs).sort((a, b) => a - b)
  const sorted = [...errs].sort((a, b) => a - b)
  const n = cases.length || 1
  const kill = { tp: 0, fp: 0, fn: 0, tn: 0 }
  for (const c of cases) kill[killOutcome(c.predictedKill, c.actualKill)]++
  const acc = (kill.tp + kill.tn) / n
  const precision = kill.tp + kill.fp > 0 ? kill.tp / (kill.tp + kill.fp) : 0
  const recall = kill.tp + kill.fn > 0 ? kill.tp / (kill.tp + kill.fn) : 0
  const under = errs.filter(e => e < 0)
  const over = errs.filter(e => e > 0)
  const ratios = cases.map(c => c.damageRatio).sort((a, b) => a - b)
  return {
    n: cases.length,
    insideRate: errs.filter(e => e === 0).length / n,
    under: { count: under.length, mean: under.length ? under.reduce((s, v) => s + v, 0) / under.length : 0 },
    over: { count: over.length, mean: over.length ? over.reduce((s, v) => s + v, 0) / over.length : 0 },
    ratio: {
      median: quantile(ratios, 0.5),
      p90: quantile(ratios, 0.9),
      overOneRate: cases.length ? cases.filter(c => c.damageRatio >= 1).length / cases.length : 0,
    },
    mae: abs.reduce((s, v) => s + v, 0) / n,
    medianError: quantile(sorted, 0.5),
    meanBias: errs.reduce((s, v) => s + v, 0) / n,
    p10: quantile(sorted, 0.1),
    p90: quantile(sorted, 0.9),
    kill: { ...kill, accuracy: acc, precision, recall },
  }
}

export interface GroupBias { key: string; n: number; meanBias: number; medianError: number; insideRate: number; killAccuracy: number }

/** 分层偏差：找出「哪个角色/Boss/命座档最不准」——排查从这里起头 */
export function groupBias(cases: CalibrationCase[], keyOf: (c: CalibrationCase) => string, minN = 5): GroupBias[] {
  const groups = new Map<string, CalibrationCase[]>()
  for (const c of cases) {
    const k = keyOf(c)
    const arr = groups.get(k) ?? []
    arr.push(c)
    groups.set(k, arr)
  }
  const out: GroupBias[] = []
  for (const [key, arr] of groups) {
    if (arr.length < minN) continue
    const s = summarizeCalibration(arr)
    out.push({ key, n: arr.length, meanBias: s.meanBias, medianError: s.medianError, insideRate: s.insideRate, killAccuracy: s.kill.accuracy })
  }
  return out.sort((a, b) => Math.abs(b.meanBias) - Math.abs(a.meanBias))
}

/**
 * 分层抽样（确定性）：按 keyOf 分组后**按组大小比例**取样，组内用固定种子洗牌。
 * 为什么不用随机全抽：归档分布极不均匀（32 个 target 里 top1 占 839 条），
 * 均匀随机会让报告被少数房间主导，改动前后的对比也不可复现。
 */
export function stratifiedSample<T>(items: T[], size: number, keyOf: (item: T) => string, seed = 20260831): T[] {
  if (size >= items.length) return [...items]
  const groups = new Map<string, T[]>()
  for (const it of items) {
    const k = keyOf(it)
    const arr = groups.get(k) ?? []
    arr.push(it)
    groups.set(k, arr)
  }
  const rng = makeRng(seed)
  const shuffled = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, arr]) => {
      const copy = [...arr]
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
      }
      return { key, items: copy }
    })
  const out: T[] = []
  // 轮转取样：保证小组也有代表，同时整体贴近组大小比例
  for (let round = 0; out.length < size; round++) {
    let progressed = false
    for (const g of shuffled) {
      if (out.length >= size) break
      const quota = Math.max(1, Math.round((g.items.length / items.length) * size))
      if (round < quota && round < g.items.length) {
        out.push(g.items[round])
        progressed = true
      }
    }
    if (!progressed) break
  }
  return out
}
