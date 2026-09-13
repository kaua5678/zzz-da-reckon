/**
 * 时间图表页 · 跑批编排（第一片拆分，2026-09-13）。
 *
 * 从 `src/views/TimeChartsPage.vue` 的 `<script setup>` **原样搬迁**四张图的「校验 → 参数装配 →
 * 调用引擎 → 进度回写」流程。搬迁原则 = 校验分支、提示文案、超时时长（2500/4000ms）、参数默认值
 * （`budget ?? 6`、`initialGold ?? 6`、`filmPerVersion ?? 15000`、`spendRatio ?? 0.5`、
 * `budgetYuan ?? 0`）、try/finally 结构逐字不变。
 *
 * ⚠ **为什么不搬 Chart 5 的 `runPullValue`**：它带**模块级缓存 + 全局 fetch**（`pvArchive` 缓存
 * `/static/run-archive.json`），属全局副作用深耦合，搬走要顺带决定缓存归属（模块级 vs 调用方）——
 * 那是行为改动不是搬迁，按任务约定跳过并留在此处。
 *
 * 依赖注入：`calc`（useResourceCalc 实例）与各 ref/getter 由页面传入，本文件不读 store、
 * 不碰组件生命周期，可单测。
 */
import { nextTick, type Ref } from 'vue'
import { releaseNodeOf } from '@/data/versionTimeline'
import { computeTeamTimeline, computeNewCharacterPoints, computeSlotComparePoints, computeFilmSimulation, type FilmSimPoint, type NewCharacterPoint, type NewCharacterRow, type SlotComparePoint, type SlotCompareSlot, type TeamTimelineResult } from '@/composables/teamTimeline'
import type { BossPreset, BossPresetPhase, PhaseView } from '@/types/bossPreset'

type Calc = Parameters<typeof computeTeamTimeline>[0]
type Progress = { pct: number; text: string } | null

/** 校验失败时的短提示（原地 setTimeout 收起，2500ms 为原值） */
function flash(io: { progress: Ref<Progress> }, text: string, ms = 2500): void {
  io.progress.value = { pct: 1, text }
  setTimeout(() => { io.progress.value = null }, ms)
}

/** Chart 1：队伍强度随版本演变 */
export async function runTeamTimelineCompute(io: {
  calc: Calc
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
  io.computing.value = true
  io.progress.value = { pct: 0, text: '准备…' }
  await nextTick()
  try {
    io.result.value = await computeTeamTimeline(io.calc, {
      mainAgentId: io.mainAgentId,
      boss,
      phase,
      budget: io.budget ?? 6,
      // 横轴刻度用期号（seq，如「45」代表 69045）；只算所选 Boss 登场的期数
      axisNodes: io.axisNodes,
      candidatePool: io.candidatePool,
      autoBuild: io.autoBuild,
      optimalGold: io.optimalGold,
      onProgress: p => { io.progress.value = p },
    })
  } finally {
    io.computing.value = false
    io.progress.value = null
  }
}

/** Chart 3：每期新角色 · 强队强度 */
export async function runChart3Compute(io: {
  calc: Calc
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
  io.computing.value = true
  io.progress.value = { pct: 0, text: '准备…' }
  try {
    io.points.value = await computeNewCharacterPoints(io.calc, {
      rows: io.rows,
      teams: io.teams,
      boss,
      phase,
      budget: io.budget ?? 6,
      autoBuild: io.autoBuild,
      optimalGold: io.optimalGold,
      onProgress: p => { io.progress.value = p },
    })
  } finally {
    io.computing.value = false
    io.progress.value = null
  }
}

/** Chart 7：同槽位角色对比 */
export async function runSlotCompareCompute(io: {
  calc: Calc
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
  io.computing.value = true
  io.progress.value = { pct: 0, text: '准备…' }
  await nextTick()
  try {
    io.points.value = await computeSlotComparePoints(io.calc, {
      slot: io.slot,
      agentA: io.agentA,
      agentB: io.agentB,
      boss,
      phase,
      budget: io.budget ?? 6,
      autoBuild: io.autoBuild,
      optimalGold: io.optimalGold,
      onProgress: p => { io.progress.value = p },
    })
  } finally {
    io.computing.value = false
    io.progress.value = null
  }
}

/** Chart 4：菲林经济模拟 */
export async function runFilmSimCompute(io: {
  calc: Calc
  computing: Ref<boolean>
  progress: Ref<Progress>
  points: Ref<FilmSimPoint[]>
  boss: BossPreset | null
  axisNodes: Array<{ id: string; label: string; date: string }>
  periodViews: PhaseView[]
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
  io.computing.value = true
  io.progress.value = { pct: 0, text: '准备…' }
  try {
    const res = await computeFilmSimulation(io.calc, {
      boss,
      axisNodes: axis,
      periodViews: io.periodViews,
      mainAgentId: io.mainAgentId,
      candidatePool: io.candidatePool,
      initialGold: io.initialGold ?? 6,
      filmPerVersion: io.filmPerVersion ?? 15000,
      spendRatio: io.spendRatio ?? 0.5,
      budgetYuanPerVersion: io.budgetYuan ?? 0,
      targetPeriodId: io.targetPeriod || undefined,
      autoBuild: io.autoBuild,
      onProgress: p => { io.progress.value = p },
    })
    io.points.value = res.points
  } finally {
    io.computing.value = false
    io.progress.value = null
  }
}
