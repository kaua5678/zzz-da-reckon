/**
 * 时间图表页 · 跑批编排（第一片拆分，2026-09-13）。
 *
 * 从 `src/views/TimeChartsPage.vue` 的 `<script setup>` **原样搬迁**四张图的「校验 → 参数装配 →
 * 调用引擎 → 进度回写」流程。搬迁原则 = 校验分支、提示文案、超时时长（2500/4000ms）、参数默认值
 * （`budget ?? 6`、`initialGold ?? 6`、`filmPerVersion ?? 15000`、`spendRatio ?? 0.5`、
 * `budgetYuan ?? 0`）、try/finally 结构逐字不变。
 *
 * Chart 5 的 `runPullValue` 留在组件里：归档缓存已收进 `catalog#loadRunArchive`（arena-D 第 367 轮），
 * 若要搬过来，只剩「调 loadRunArchive + computePullValue」两步。
 *
 * 依赖注入：批任务归属 `owner`（页面 `useBatchOwner()`）与各 ref/getter 由页面传入，本文件不读 store、
 * 不碰组件生命周期，可单测。每次运行经 `owner.start()` 发车：重算吊销上一次，离开页面也吊销；
 * 进度 / 结果 / finally 一律经 `run.commit` 提交，被顶掉的运行一个字都写不进去。
 * CC-485（r670）：这段生命周期四份逐字相同 ⇒ 收成 `runBatch`，各 runner 只剩「校验 + 参数装配 + 结果落在哪个 ref」。
 */
import { withAnalysisScenario, type AnalysisScenario } from '@/composables/analysisScenario'
import type { BatchOwner } from '@/composables/batchTask'
import { nextTick, type Ref } from 'vue'
import { releaseNodeOf } from '@/data/versionTimeline'
import { computeTeamTimeline, computeNewCharacterPoints, computeSlotComparePoints, type NewCharacterPoint, type NewCharacterRow, type SlotComparePoint, type SlotCompareSlot, type TeamTimelineResult } from '@/composables/teamTimeline'
import { computeFilmSimulation, type FilmSimPoint } from '@/composables/teamTimelineFilm'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'

type Progress = { pct: number; text: string } | null

/** 校验失败时的短提示（原地 setTimeout 收起，2500ms 为原值） */
function flash(io: { progress: Ref<Progress> }, text: string, ms = 2500): void {
  io.progress.value = { pct: 1, text }
  setTimeout(() => { io.progress.value = null }, ms)
}

/** 引擎跑批共用的取消 / 进度接线：`control.signal` 取自本次运行，进度只经 `run.commit` 回写 */
type BatchWiring = { control: { signal: AbortSignal }; onProgress: (p: { pct: number; text: string }) => void }

/**
 * 四张图共用的跑批生命周期（CC-485）：`owner.start()` 发车 → `computing=true` / 进度「准备…」→
 * （可选）让出一帧让提示先画出来 → 在独立分析场景里算 → 结果经 `run.commit` 发布 → finally 经 `run.commit` 收尾。
 * 被新运行顶掉的旧运行，其 publish / finally 一个字都写不进去（BatchRun 契约）。
 * `yieldFirst`：Chart 1 / 7 自 TimeChartsPage 搬迁时就有 `await nextTick()`，Chart 3 / 4 没有——历史差异原样保留，不在此轮统一。
 */
export async function runBatch<T>(
  io: { owner: BatchOwner; computing: Ref<boolean>; progress: Ref<Progress> },
  opts: { yieldFirst?: boolean },
  compute: (scenario: AnalysisScenario, batch: BatchWiring) => Promise<T>,
  publish: (res: T) => void,
): Promise<void> {
  const run = io.owner.start()
  io.computing.value = true
  io.progress.value = { pct: 0, text: '准备…' }
  if (opts.yieldFirst) await nextTick()
  const batch: BatchWiring = {
    control: { signal: run.signal },
    onProgress: p => run.commit(() => { io.progress.value = p }),
  }
  try {
    const res = await withAnalysisScenario(scenario => compute(scenario, batch))
    run.commit(() => publish(res))
  } finally {
    run.commit(() => { io.computing.value = false; io.progress.value = null })
  }
}

/** Chart 1：队伍强度随版本演变 */
export async function runTeamTimelineCompute(io: {
  owner: BatchOwner
  computing: Ref<boolean>
  progress: Ref<Progress>
  result: Ref<TeamTimelineResult | null>
  boss: BossPreset | null
  phase: BossPresetPhase | null
  mainAgentId: string
  axisNodes: Array<{ id: string; label: string; date: string }>
  candidatePool: string[]
  budget: number | null
  autoBuild: boolean
  optimalGold: boolean
}): Promise<void> {
  const { boss, phase } = io
  if (!boss || !phase) return
  if (!releaseNodeOf(io.mainAgentId)) return
  const pool = io.candidatePool.filter(id => id !== io.mainAgentId)
  if (pool.length < 2) { flash(io, '候选队友至少需要 2 名（不含主C）'); return }
  if (io.axisNodes.length === 0) { flash(io, '所选 Boss 在危局期数数据中无登场记录'); return }
  return runBatch(io, { yieldFirst: true }, (scenario, batch) => computeTeamTimeline(scenario, {
      mainAgentId: io.mainAgentId,
      boss,
      phase,
      budget: io.budget ?? 6,
      // 横轴刻度用期号（seq，如「45」代表 69045）；只算所选 Boss 登场的期数
      axisNodes: io.axisNodes,
      candidatePool: io.candidatePool,
      autoBuild: io.autoBuild,
      optimalGold: io.optimalGold,
      ...batch,
    }), res => { io.result.value = res })
}

/** Chart 3：每期新角色 · 强队强度 */
export async function runChart3Compute(io: {
  owner: BatchOwner
  computing: Ref<boolean>
  progress: Ref<Progress>
  points: Ref<NewCharacterPoint[]>
  boss: BossPreset | null
  phase: BossPresetPhase | null
  rows: NewCharacterRow[]
  teams: Record<string, [string, string, string][]>
  budget: number | null
  autoBuild: boolean
  optimalGold: boolean
}): Promise<void> {
  const { boss, phase } = io
  if (!boss || !phase) return
  return runBatch(io, {}, (scenario, batch) => computeNewCharacterPoints(scenario, {
      rows: io.rows,
      teams: io.teams,
      boss,
      phase,
      budget: io.budget ?? 6,
      autoBuild: io.autoBuild,
      optimalGold: io.optimalGold,
      ...batch,
    }), res => { io.points.value = res })
}

/** Chart 7：同槽位角色对比 */
export async function runSlotCompareCompute(io: {
  owner: BatchOwner
  computing: Ref<boolean>
  progress: Ref<Progress>
  points: Ref<SlotComparePoint[]>
  boss: BossPreset | null
  phase: BossPresetPhase | null
  slot: SlotCompareSlot
  agentA: string
  agentB: string
  budget: number | null
  autoBuild: boolean
  optimalGold: boolean
}): Promise<void> {
  const { boss, phase } = io
  if (!boss || !phase) { flash(io, '先选 Boss（卡片右上角，默认跟随顶部）'); return }
  if (io.agentA === io.agentB) { flash(io, '两名对比角色不能相同'); return }
  return runBatch(io, { yieldFirst: true }, (scenario, batch) => computeSlotComparePoints(scenario, {
      slot: io.slot,
      agentA: io.agentA,
      agentB: io.agentB,
      boss,
      phase,
      budget: io.budget ?? 6,
      autoBuild: io.autoBuild,
      optimalGold: io.optimalGold,
      ...batch,
    }), res => { io.points.value = res })
}

/** Chart 4：菲林经济模拟 */
export async function runFilmSimCompute(io: {
  owner: BatchOwner
  computing: Ref<boolean>
  progress: Ref<Progress>
  points: Ref<FilmSimPoint[]>
  boss: BossPreset | null
  axisNodes: Array<{ id: string; label: string; date: string }>
  mainAgentId: string
  candidatePool: string[]
  initialGold: number | null
  filmPerVersion: number | null
  spendRatio: number | null
  budgetYuan: number | null
  targetPeriod: string
  autoBuild: boolean
}): Promise<void> {
  const { boss } = io
  if (!boss) return
  const axis = io.axisNodes
  if (axis.length === 0) { flash(io, '所选 Boss 在危局期数数据中无登场记录'); return }
  if (io.candidatePool.filter(id => id !== io.mainAgentId).length < 2) { flash(io, '候选队友至少 2 名（不含主C）'); return }
  return runBatch(io, {}, (scenario, batch) => computeFilmSimulation(scenario, {
      boss,
      axisNodes: axis,
      mainAgentId: io.mainAgentId,
      candidatePool: io.candidatePool,
      initialGold: io.initialGold ?? 6,
      filmPerVersion: io.filmPerVersion ?? 15000,
      spendRatio: io.spendRatio ?? 0.5,
      budgetYuanPerVersion: io.budgetYuan ?? 0,
      targetPeriodId: io.targetPeriod || undefined,
      autoBuild: io.autoBuild,
      ...batch,
    }), res => { io.points.value = res.points })
}
