// @ts-nocheck
/**
 * 驱动盘优化器入口
 *
 * 提供统一的优化器接口，管理 Worker 的创建和通信。
 * 同时提供候选驱动盘生成工具（虚拟生成满级满词条的"完美"驱动盘）。
 */
import type {
  Agent,
  WEngine,
  DriveDisc,
  DriveDiscSet,
  DriveDiscMainStat,
  DriveDiscSubStat,
  StatId,
  StatMode,
  StatRules,
  Specialty,
  OptimizerConfig,
  OptimizerMetrics,
  OptimizerResult,
  Rarity,
} from '@/types/catalog'
import type { OptimizerInput, OptimizerOutput } from './super-bound'
import type { WorkerRequest, WorkerResponse } from './worker'

// Vite ?worker 导入：返回 Worker 构造函数
import OptimizerWorker from './worker?worker'

// ============ 类型重导出 ============

export type { OptimizerInput, OptimizerOutput } from './super-bound'
export type { ScoringConfig, ScoringContext, ScoreMode, SuperVector } from './scoring'
export type { WorkerRequest, WorkerResponse } from './worker'
export type {
  OptimizerConfig,
  OptimizerResult,
  OptimizerMetrics,
} from '@/types/catalog'

// ============ 常量 ============

/** 完美副词条步数（9 总步数 / 4 副词条 ≈ 2.25） */
const SUB_STAT_STEPS = 2.25

/** 副词条优先级表（按角色定位） */
const SUB_STAT_PRIORITY: Record<Specialty, StatId[]> = {
  attack: ['critRate', 'critDmg', 'atkPct', 'atkFlat', 'anomalyProficiency', 'penFlat'],
  stun: ['critRate', 'critDmg', 'atkPct', 'atkFlat', 'anomalyProficiency', 'penFlat'],
  anomaly: ['anomalyProficiency', 'atkPct', 'critRate', 'critDmg', 'penFlat', 'atkFlat'],
  support: ['atkPct', 'atkFlat', 'hpPct', 'hpFlat', 'critRate', 'critDmg'],
  defense: ['defPct', 'defFlat', 'hpPct', 'hpFlat', 'atkPct', 'atkFlat'],
}

// ============ 候选驱动盘生成 ============

/** 判定属性模式：百分比属性用 pct，其余用 flat */
function getStatMode(stat: StatId): StatMode {
  if (stat === 'hpPct' || stat === 'atkPct' || stat === 'defPct') return 'pct'
  return 'flat'
}

/** 为给定角色和主词条选择最优 4 个副词条 */
function selectSubStats(
  specialty: Specialty,
  mainStat: StatId,
  subStatPool: StatId[],
): StatId[] {
  const priority = SUB_STAT_PRIORITY[specialty] ?? SUB_STAT_PRIORITY.attack
  return priority
    .filter((s) => s !== mainStat && subStatPool.includes(s))
    .slice(0, 4)
}

/** 创建一张满级满词条的"完美"驱动盘 */
function createPerfectDisc(
  slot: number,
  setId: string,
  setName: string,
  mainStat: StatId,
  statRules: StatRules,
  agent: Agent,
  subStatSteps: number,
): DriveDisc {
  const maxMainStat = statRules.driveDisc.sRankMaxMainStat
  const subStatBaseStep = statRules.driveDisc.sRankSubStatBaseStep
  const subStatPool = statRules.driveDisc.subStatPool

  // 主词条
  const mainStatValue = maxMainStat[mainStat] ?? 0
  const mainStatEntry: DriveDiscMainStat = {
    stat: mainStat,
    value: mainStatValue,
    mode: getStatMode(mainStat),
  }

  // 副词条
  const selectedSubStats = selectSubStats(agent.specialty, mainStat, subStatPool)
  const subStats: DriveDiscSubStat[] = selectedSubStats.map((stat) => ({
    stat,
    value: (subStatBaseStep[stat] ?? 0) * subStatSteps,
    mode: getStatMode(stat),
  }))

  return {
    id: `opt_${setId}_s${slot}_${mainStat}`,
    setId,
    setName,
    partition: slot,
    rarity: 'S' as Rarity,
    level: 15,
    maxLevel: statRules.driveDisc.rarityMaxLevel['S'] ?? 15,
    mainStat: mainStatEntry,
    subStats,
  }
}

/**
 * 生成候选驱动盘列表。
 *
 * 根据主词条限制和套装限制，为每个槽位生成满级满词条的"完美"驱动盘。
 * 每个槽位的候选数 = 套装数 × 允许主词条数。
 *
 * @param agent      角色（用于判定副词条优先级）
 * @param config     优化器配置（含套装和主词条限制）
 * @param statRules  属性规则（来自 catalog.statRules）
 * @param setsMap    套装映射（用于查套装名）
 * @returns 6 个槽位的候选盘列表
 */
export function generateCandidates(
  agent: Agent,
  config: OptimizerConfig,
  statRules: StatRules,
  setsMap: Map<string, DriveDiscSet>,
): DriveDisc[][] {
  const candidates: DriveDisc[][] = []

  // 合并去重套装 ID
  const allSetIds = [...new Set([...config.fourPieceSetIds, ...config.twoPieceSetIds])]

  if (allSetIds.length === 0) {
    // 无套装指定，返回 6 个空数组
    return Array.from({ length: 6 }, () => [])
  }

  for (let slot = 1; slot <= 6; slot++) {
    const slotKey = String(slot)
    const pool: StatId[] = statRules.driveDisc.mainStatPools[slotKey] ?? []
    const limits: StatId[] = config.mainStatLimits[slot] ?? pool
    // 取池子和用户限制的交集
    const allowedMainStats = pool.filter((s) => limits.includes(s))

    const slotCandidates: DriveDisc[] = []

    for (const setId of allSetIds) {
      const setDef = setsMap.get(setId)
      const setName = setDef?.name?.zhCN ?? setId

      for (const mainStat of allowedMainStats) {
        const disc = createPerfectDisc(
          slot,
          setId,
          setName,
          mainStat,
          statRules,
          agent,
          SUB_STAT_STEPS,
        )
        slotCandidates.push(disc)
      }
    }

    candidates.push(slotCandidates)
  }

  return candidates
}

/**
 * 构建优化器输入（便捷方法）。
 *
 * 自动生成候选盘并组装 OptimizerInput。
 */
export function buildOptimizerInput(
  agent: Agent,
  wEngine: WEngine,
  config: OptimizerConfig,
  statRules: StatRules,
  setsMap: Map<string, DriveDiscSet>,
  scoringConfig: OptimizerInput['scoringConfig'],
): OptimizerInput {
  const candidateDiscs = generateCandidates(agent, config, statRules, setsMap)
  return {
    agent,
    wEngine,
    candidateDiscs,
    setsMap,
    config,
    scoringConfig,
  }
}

// ============ Worker 管理 ============

/** 优化器取消错误 */
export class OptimizerCancelledError extends Error {
  constructor(message = '优化已取消') {
    super(message)
    this.name = 'OptimizerCancelledError'
  }
}

/** Worker 实例（惰性创建） */
let worker: Worker | null = null

/** 当前运行的 Promise 回调 */
let currentResolve: ((output: OptimizerOutput) => void) | null = null
let currentReject: ((error: Error) => void) | null = null
let currentOnProgress: ((metrics: OptimizerMetrics) => void) | null = null
/** 当前 abort 监听器（用于清理） */
let currentOnAbort: (() => void) | null = null
/** 当前 AbortSignal */
let currentSignal: AbortSignal | null = null

/** 确保 Worker 存在并已绑定消息处理 */
function ensureWorker(): Worker {
  if (!worker) {
    worker = new OptimizerWorker()

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data
      switch (msg.type) {
        case 'progress':
          currentOnProgress?.(msg.metrics)
          break
        case 'result':
          currentResolve?.(msg.output)
          cleanupCurrent()
          break
        case 'cancelled':
          currentReject?.(new OptimizerCancelledError())
          cleanupCurrent()
          break
        case 'error':
          currentReject?.(new Error(msg.message))
          cleanupCurrent()
          break
      }
    }

    worker.onerror = (e: ErrorEvent) => {
      currentReject?.(new Error(`Worker 错误: ${e.message}`))
      cleanupCurrent()
    }
  }
  return worker
}

/** 清理当前运行状态 */
function cleanupCurrent(): void {
  if (currentSignal && currentOnAbort) {
    currentSignal.removeEventListener('abort', currentOnAbort)
  }
  currentResolve = null
  currentReject = null
  currentOnProgress = null
  currentOnAbort = null
  currentSignal = null
}

/**
 * 运行驱动盘优化（异步，在 Web Worker 中执行）。
 *
 * @param input      优化器输入
 * @param onProgress 进度回调（可选）
 * @param signal     AbortSignal，用于取消优化（可选）
 * @returns 优化器输出（Top-K 结果 + 指标）
 *
 * @example
 * ```ts
 * const controller = new AbortController()
 * const output = await runOptimizer(input, (m) => {
 *   console.log(`已评估 ${m.evaluated} / ${m.estimatedCombinationCount}`)
 * }, controller.signal)
 * // 取消：controller.abort()
 * ```
 */
export function runOptimizer(
  input: OptimizerInput,
  onProgress?: (metrics: OptimizerMetrics) => void,
  signal?: AbortSignal,
): Promise<OptimizerOutput> {
  return new Promise<OptimizerOutput>((resolve, reject) => {
    // 已有任务在运行
    if (currentResolve) {
      reject(new Error('优化器已在运行中，请先取消当前任务'))
      return
    }

    const w = ensureWorker()

    // 已取消
    if (signal?.aborted) {
      reject(new OptimizerCancelledError())
      return
    }

    currentResolve = resolve
    currentReject = reject
    currentOnProgress = onProgress ?? null
    currentSignal = signal ?? null

    // 绑定 abort
    if (signal) {
      currentOnAbort = () => {
        w.postMessage({ type: 'cancel' } satisfies WorkerRequest)
      }
      signal.addEventListener('abort', currentOnAbort, { once: true })
    }

    // 启动优化
    w.postMessage({ type: 'start', input } satisfies WorkerRequest)
  })
}

/**
 * 取消当前正在运行的优化。
 *
 * 也可以通过 AbortController.abort() 取消。
 */
export function cancelOptimizer(): void {
  if (worker && currentResolve) {
    worker.postMessage({ type: 'cancel' } satisfies WorkerRequest)
  }
}

/**
 * 终止优化器 Worker，释放资源。
 *
 * 调用后需要重新运行优化时会自动创建新 Worker。
 */
export function terminateOptimizer(): void {
  if (worker) {
    worker.terminate()
    worker = null
  }
  if (currentReject) {
    currentReject(new OptimizerCancelledError('优化器已终止'))
  }
  cleanupCurrent()
}

/** 检查优化器是否正在运行 */
export function isOptimizerRunning(): boolean {
  return currentResolve !== null
}
