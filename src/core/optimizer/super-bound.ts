// @ts-nocheck
/**
 * Super-Bound 分支定界算法
 *
 * 原理：
 * - 6 个槽位（1-6 号位），每个槽位有多个候选驱动盘
 * - 深度优先搜索，从 1 号位到 6 号位逐层选择
 * - 在每一步用"超级边界"剪枝：计算当前已选盘 + 剩余所有候选盘的最优词条
 *   叠加的理论伤害上界，如果上界 < 当前最优解（Top-K 末位），剪掉整条分支
 *
 * 剪枝策略：
 * a. 组边界剪枝（Group Bound）：整组（当前槽位 + 后续所有槽位）的超级向量上界检查
 * b. 单盘边界剪枝（Disc Bound）：选定单个盘后，后续槽位的超级向量上界检查
 * c. 全局截断（Global Cutoff）：每找到更优解就抬高及格线（Top-K 末位分数）
 *
 * 算法保证找到全局最优解（精确算法）。
 */
import type {
  Agent,
  WEngine,
  DriveDisc,
  DriveDiscSet,
  OptimizerConfig,
  OptimizerResult,
  OptimizerMetrics,
  SkillEvent,
  PanelValues,
} from '@/types/catalog'
import {
  type ScoringContext,
  type ScoringConfig,
  type SuperVector,
  createScoringContext,
  fastScoreWithContext,
  evaluateWithContext,
  computeSuperVector,
  computeUpperBoundScore,
  computeMaxSetBuffs,
} from './scoring'
import type { CollectedBuffs } from '@/core/buff'

// 套装 buff 类型别名
type SetBuffs = CollectedBuffs

// ============ 接口定义 ============

export interface OptimizerInput {
  agent: Agent
  wEngine: WEngine
  candidateDiscs: DriveDisc[][] // 每个槽位的候选盘列表（6 个数组）
  setsMap: Map<string, DriveDiscSet>
  config: OptimizerConfig
  scoringConfig: ScoringConfig
}

export interface OptimizerOutput {
  results: OptimizerResult[]
  metrics: OptimizerMetrics
}

// ============ 内部状态 ============

/** Top-K 结果条目 */
interface TopEntry {
  score: number
  discs: DriveDisc[]
}

/** 优化器内部状态 */
interface OptimizerState {
  ctx: ScoringContext
  candidateDiscs: DriveDisc[][]
  config: OptimizerConfig

  /** 后缀超级向量：suffixSV[d] = 槽位 d..5 的超级向量 */
  suffixSV: SuperVector[]
  /** 最优套装 buff（用于上界估计） */
  maxSetBuffs: SetBuffs

  /** Top-K 结果（按分数降序） */
  topK: TopEntry[]
  /** 当前及格线（Top-K 末位分数，不足 K 个时为 -Infinity） */
  cutoff: number

  /** 指标 */
  metrics: OptimizerMetrics
  /** 起始时间 */
  startTime: number
  /** 上次进度上报时间 */
  lastProgressTime: number

  /** 取消标志 */
  cancelled: boolean
  /** 进度回调（返回 true 可取消优化） */
  onProgress?: (metrics: OptimizerMetrics) => boolean | void
}

/** 每多少次评估 yield 一次（让出事件循环，处理取消/进度） */
const YIELD_INTERVAL = 5000

/** 进度上报间隔（毫秒） */
const PROGRESS_INTERVAL_MS = 100

// ============ 辅助函数 ============

/** 检查面板是否满足最小值约束 */
function checkMinimums(
  panel: PanelValues,
  minimums: OptimizerConfig['minimums'],
): boolean {
  if (minimums.atk != null && panel.atk < minimums.atk) return false
  if (minimums.critRate != null && panel.critRate < minimums.critRate) return false
  if (minimums.critDmg != null && panel.critDmg < minimums.critDmg) return false
  if (
    minimums.anomalyProficiency != null &&
    panel.anomalyProficiency < minimums.anomalyProficiency
  )
    return false
  return true
}

/** 从驱动盘组合中判定 4 件套 ID */
function determineFourPieceSet(discs: DriveDisc[]): string {
  const counts = new Map<string, number>()
  for (const disc of discs) {
    counts.set(disc.setId, (counts.get(disc.setId) ?? 0) + 1)
  }
  for (const [setId, count] of counts) {
    if (count >= 4) return setId
  }
  return ''
}

/** 预排序候选盘：按单独装备时的评分降序，使 DFS 优先尝试更优候选 */
function preSortCandidates(
  ctx: ScoringContext,
  candidateDiscs: DriveDisc[][],
): DriveDisc[][] {
  return candidateDiscs.map((candidates) => {
    if (candidates.length <= 1) return candidates
    return candidates
      .map((disc) => ({
        disc,
        score: fastScoreWithContext(ctx, [disc]),
      }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.disc)
  })
}

/** 计算预估组合总数 */
function estimateCombinationCount(candidateDiscs: DriveDisc[][]): number {
  let product = 1
  for (const slot of candidateDiscs) {
    product *= Math.max(1, slot.length)
  }
  return product
}

/** 让出事件循环 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// ============ Top-K 维护 ============

/**
 * 将新结果插入 Top-K 列表。
 * 列表保持按分数降序，超过 topK 时淘汰末位。
 */
function insertTopK(state: OptimizerState, score: number, discs: DriveDisc[]): void {
  const k = state.config.topK
  if (k <= 0) return

  const entry: TopEntry = { score, discs: [...discs] }

  if (state.topK.length < k) {
    // 列表未满，直接插入
    insertSorted(state.topK, entry)
    // 更新及格线
    if (state.topK.length >= k) {
      state.cutoff = state.topK[k - 1].score
    }
  } else if (score > state.cutoff) {
    // 超过及格线，替换末位
    state.topK.pop()
    insertSorted(state.topK, entry)
    state.cutoff = state.topK[k - 1].score
  }
}

/** 将 entry 插入已排序数组（降序），使用二分查找 */
function insertSorted(arr: TopEntry[], entry: TopEntry): void {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid].score > entry.score) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  arr.splice(lo, 0, entry)
}

// ============ DFS 核心搜索 ============

/**
 * 深度优先搜索，逐槽位选择驱动盘。
 *
 * @param state    优化器状态
 * @param depth    当前深度（0-5 对应槽位 1-6，6 为叶子）
 * @param selected 已选驱动盘（可变数组，push/pop 维护）
 */
async function dfs(
  state: OptimizerState,
  depth: number,
  selected: DriveDisc[],
): Promise<void> {
  if (state.cancelled) return

  // ---- 叶子节点：评估完整组合 ----
  if (depth >= 6) {
    state.metrics.evaluated++

    const result = evaluateWithContext(state.ctx, selected)

    // 检查最小值约束
    if (!checkMinimums(result.outOfCombat, state.config.minimums)) {
      return
    }

    // 检查是否进入 Top-K
    if (result.score > state.cutoff || state.topK.length < state.config.topK) {
      insertTopK(state, result.score, selected)
    } else {
      state.metrics.prunedByGlobalCutoff++
    }

    // 定期 yield + 进度上报
    if (state.metrics.evaluated % YIELD_INTERVAL === 0) {
      await yieldToEventLoop()
      if (state.cancelled) return
      reportProgress(state)
    }
    return
  }

  // ---- 内部节点：组边界剪枝（Group Bound）----
  // 检查当前已选 + 后续所有槽位（含当前）的超级向量上界
  state.metrics.processedCombinationCount++
  const groupUB = computeUpperBoundScore(
    state.ctx,
    selected,
    state.suffixSV[depth],
    state.maxSetBuffs,
  )
  if (groupUB < state.cutoff) {
    state.metrics.prunedBySuperBound++
    return
  }

  // ---- 遍历候选盘 ----
  const candidates = state.candidateDiscs[depth]
  for (const disc of candidates) {
    selected.push(disc)

    // 单盘边界剪枝（Disc Bound）：选定此盘后，后续槽位的超级向量上界
    const discUB = computeUpperBoundScore(
      state.ctx,
      selected,
      state.suffixSV[depth + 1],
      state.maxSetBuffs,
    )
    if (discUB < state.cutoff) {
      state.metrics.prunedByUpperBound++
      selected.pop()
      continue
    }

    // 递归
    await dfs(state, depth + 1, selected)
    selected.pop()

    if (state.cancelled) return
  }
}

/** 上报进度 */
function reportProgress(state: OptimizerState): void {
  const now = performance.now()
  state.metrics.elapsedMs = Math.round(now - state.startTime)
  if (state.onProgress && now - state.lastProgressTime >= PROGRESS_INTERVAL_MS) {
    state.lastProgressTime = now
    const shouldCancel = state.onProgress({ ...state.metrics })
    if (shouldCancel) {
      state.cancelled = true
    }
  }
}

// ============ 主入口 ============

/**
 * 执行驱动盘优化。
 *
 * @param input     优化器输入
 * @param onProgress 进度回调（可选）
 * @returns 优化器输出（Top-K 结果 + 指标）
 */
export async function optimize(
  input: OptimizerInput,
  onProgress?: (metrics: OptimizerMetrics) => boolean | void,
): Promise<OptimizerOutput> {
  const startTime = performance.now()

  // ---- 校验输入 ----
  const { agent, wEngine, candidateDiscs, setsMap, config, scoringConfig } = input

  if (candidateDiscs.length !== 6) {
    throw new Error(`candidateDiscs 必须有 6 个槽位，当前 ${candidateDiscs.length}`)
  }
  if (candidateDiscs.some((slot) => slot.length === 0)) {
    // 某槽位无候选盘，返回空结果
    return {
      results: [],
      metrics: {
        estimatedCombinationCount: 0,
        processedCombinationCount: 0,
        evaluated: 0,
        prunedBySuperBound: 0,
        prunedByUpperBound: 0,
        prunedByGlobalCutoff: 0,
        elapsedMs: Math.round(performance.now() - startTime),
      },
    }
  }

  // ---- 创建评分上下文 ----
  const ctx = createScoringContext(agent, wEngine, setsMap, scoringConfig)

  // ---- 预排序候选盘 ----
  const sortedCandidates = preSortCandidates(ctx, candidateDiscs)

  // ---- 预计算后缀超级向量 ----
  // suffixSV[d] = 槽位 d..5 的超级向量
  // suffixSV[6] = 空超级向量
  const suffixSV: SuperVector[] = []
  for (let d = 6; d >= 0; d--) {
    const slotIndices: number[] = []
    for (let i = d; i < 6; i++) slotIndices.push(i)
    suffixSV[d] = computeSuperVector(sortedCandidates, slotIndices)
  }

  // ---- 预计算最优套装 buff（用于上界估计）----
  const maxSetBuffs = computeMaxSetBuffs(
    config.fourPieceSetIds,
    config.twoPieceSetIds,
    setsMap,
    ctx,
  )

  // ---- 初始化状态 ----
  const state: OptimizerState = {
    ctx,
    candidateDiscs: sortedCandidates,
    config,
    suffixSV,
    maxSetBuffs,
    topK: [],
    cutoff: -Infinity,
    metrics: {
      estimatedCombinationCount: estimateCombinationCount(sortedCandidates),
      processedCombinationCount: 0,
      evaluated: 0,
      prunedBySuperBound: 0,
      prunedByUpperBound: 0,
      prunedByGlobalCutoff: 0,
      elapsedMs: 0,
    },
    startTime,
    lastProgressTime: startTime,
    cancelled: false,
    onProgress,
  }

  // ---- 执行 DFS ----
  const selected: DriveDisc[] = []
  await dfs(state, 0, selected)

  // ---- 构建输出 ----
  state.metrics.elapsedMs = Math.round(performance.now() - startTime)

  const results: OptimizerResult[] = state.topK.map((entry, i) => ({
    rank: i + 1,
    score: entry.score,
    driveDiscs: entry.discs,
    fourPieceSetId: determineFourPieceSet(entry.discs),
  }))

  // 最终进度上报
  if (onProgress) {
    onProgress({ ...state.metrics })
  }

  return {
    results,
    metrics: state.metrics,
  }
}