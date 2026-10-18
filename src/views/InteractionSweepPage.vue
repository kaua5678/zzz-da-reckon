<template>
  <div class="interaction-sweep-page">
    <n-card size="small" :bordered="true">
      <template #header>
        <span>交互扫描 · 每加一次交互，到底变了什么</span>
      </template>
      <template #header-extra>
        <span class="muted">
          单一自变量 = 某一类交互次数（弹刀 / 闪避反击 / 格挡 / 双反），其余全部保持你当前配置不动；
          逐格 +1 采一份完整快照，相邻两格做差 = 「这一次加交互换来了什么、又挤掉了什么」。
        </span>
      </template>

      <div class="controls">
        <div class="ctl-field">
          <span class="ctl-label">队伍</span>
          <n-select
            v-model:value="presetId"
            :options="presetOptions"
            size="small"
            filterable
            style="width: 280px"
            placeholder="选一支队"
          />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">Boss</span>
          <n-select
            v-model:value="bossId"
            :options="bossOptions"
            size="small"
            filterable
            style="width: 220px"
            placeholder="选 Boss"
          />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">期数</span>
          <n-select
            v-model:value="phaseId"
            :options="phaseOptions"
            size="small"
            style="width: 220px"
          />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">扫到次数</span>
          <n-input-number v-model:value="maxCount" :min="2" :max="40" size="small" style="width: 80px" />
        </div>
        <div class="ctl-field">
          <n-button type="primary" size="small" :loading="computing" @click="runSweep">计算</n-button>
          <n-button v-if="computing" size="small" quaternary @click="cancel">取消</n-button>
        </div>
        <div class="ctl-field ctl-hint">
          <span class="ctl-label">
            每格一次全队求值（约 0.3~0.5s）；4 类 × 20 格 ≈ 80 次 ⇒ 十几秒。
            起点 = 你当前配置里该交互的次数（不是全 0）——这是诊断工具，看的是「在我这队上继续加会怎样」。
          </span>
        </div>
      </div>

      <div v-if="computing && sweepProgress" class="progress-row">
        <n-progress type="line" :percentage="sweepProgress.pct" :show-indicator="false" status="info" processing />
        <span class="progress-text">{{ sweepProgress.text }}</span>
      </div>

      <n-alert v-if="error" type="error" title="计算失败" style="margin-top: 8px">{{ error }}</n-alert>
    </n-card>

    <!-- 二维面：交互 × 合轴（用户口径 2026-10-18「用 z 轴高度」） -->
    <n-card size="small" :bordered="true">
      <template #header>
        <span>交互 × 合轴 二维面（z = 伤害）</span>
      </template>
      <template #header-extra>
        <span class="muted">
          x = 交互次数 · y = 合轴吸收率 · <b>高度 = 伤害</b>。面上的坑 = 弃轴 / 降配的离散切换；
          绿线 = 帕累托梯度线（可一步步走），黄虚线 = 每列最优上界；贴地平线 = 两条走法参考路径。
          <template v-if="surface">求值 {{ surface.evaluations }} 次，合轴上限 {{ (surface.absorbCap * 100).toFixed(0) }}%</template>
        </span>
      </template>
      <div class="controls">
        <div class="ctl-field">
          <span class="ctl-label">交互扫到</span>
          <n-input-number v-model:value="surfaceMaxCount" :min="4" :max="40" :step="2" size="small" style="width: 80px" />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">合轴采样</span>
          <n-select v-model:value="surfaceRatioSteps" :options="ratioStepOptions" size="small" style="width: 110px" />
        </div>
        <div class="ctl-field">
          <n-button type="primary" size="small" :loading="surfaceComputing" @click="runSurface">生成二维面</n-button>
          <n-button v-if="surfaceComputing" size="small" quaternary @click="cancel">取消</n-button>
        </div>
        <div class="ctl-field ctl-hint">
          <span class="ctl-label">每格一次全队求值；12 次 × 4 档 = 48 次 ≈ 20~30s（采样会让出主线程，页面不会卡）。</span>
        </div>
      </div>

      <div v-if="surfaceComputing && surfaceProgress" class="progress-row">
        <n-progress type="line" :percentage="surfaceProgress.pct" :show-indicator="false" status="info" processing />
        <span class="progress-text">{{ surfaceProgress.text }}</span>
      </div>
      <n-alert v-if="surface?.downscaleLeak" type="warning" style="margin-top: 8px">
        弹刀反推绕过了非轴降配：设置值被缩放，但 parrySplit 用 store 原值覆盖回去 ⇒
        弹刀这一维的降配格「实打次数」可能仍等于设置值。
      </n-alert>
      <InteractionSurface3D :surface="surface" :busy="surfaceComputing" style="margin-top: 8px" />
    </n-card>

    <template v-if="result">
      <!-- 总览：每条扫描线的起点 / 最优 / 差 -->
      <n-card size="small" :bordered="true">
        <template #header>
          <span>总览（{{ result.presetName }} · {{ result.bossName }} · {{ result.phaseLabel }}）</span>
        </template>
        <template #header-extra>
          <span class="muted">求值 {{ result.evaluations }} 次</span>
        </template>
        <table class="sweep-table">
          <thead>
            <tr>
              <th>交互</th>
              <th>起点次数</th>
              <th>起点伤害</th>
              <th>最优次数</th>
              <th>最优伤害</th>
              <th>差</th>
              <th>结论</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in result.series" :key="s.key">
              <td>{{ s.label }}</td>
              <td>{{ s.base.count }}</td>
              <td>{{ compact(s.base.dmg) }}</td>
              <td>{{ s.best.count }}</td>
              <td>{{ compact(s.best.dmg) }}</td>
              <td :class="{ neg: s.gainAtBest < 0, pos: s.gainAtBest > 0 }">
                {{ s.gainAtBest >= 0 ? '+' : '' }}{{ compact(s.gainAtBest) }}
              </td>
              <td class="muted">{{ verdictOf(s) }}</td>
            </tr>
          </tbody>
        </table>
      </n-card>

      <!-- 逐格明细（每条扫描线一张） -->
      <n-card v-for="s in result.series" :key="'d' + s.key" size="small" :bordered="true">
        <template #header>
          <span>{{ s.label }} · 逐格变化</span>
        </template>
        <template #header-extra>
          <span class="muted">起点 {{ s.from }} 次 → 扫到 {{ s.steps[s.steps.length - 1]?.count }} 次</span>
        </template>
        <table class="sweep-table dense">
          <thead>
            <tr>
              <th>次数</th>
              <th>伤害</th>
              <th>Δ伤害</th>
              <th>轴态</th>
              <th>失衡</th>
              <th>大招</th>
              <th>连携</th>
              <th>合轴节省</th>
              <th>净占用</th>
              <th>毛前台</th>
              <th>主要变化</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(st, i) in s.steps" :key="i">
              <td>{{ st.count }}</td>
              <td>{{ compact(st.dmg) }}</td>
              <td :class="deltaClass(i, s)">{{ deltaText(i, s) }}</td>
              <td :class="{ warn: st.axis.kind === 'infeasible', dim: st.axis.kind === 'partial' }">
                {{ st.axisLabel }}
              </td>
              <td>{{ st.stunCount }}</td>
              <td>{{ num(st.counts['大招']) }}</td>
              <td>{{ num(st.counts['连携']) }}</td>
              <td>{{ st.time.saved.toFixed(1) }}</td>
              <td>{{ st.time.net.toFixed(1) }}</td>
              <td>{{ st.time.grossFrontline.toFixed(1) }}</td>
              <td class="detail">{{ changesOf(i, s) }}</td>
            </tr>
          </tbody>
        </table>
      </n-card>
    </template>
  </div>
</template>
<script setup lang="ts">
/**
 * **交互扫描页**（用户口径 2026-10-18：「我建议做一个单独页面，分别计算交互上升的每一点变化了什么」）。
 *
 * 起因：难度曲线上 `banyue-liuyin-lucia` 从 ① 全 0 交互 → ② 角色基准（31 次）伤害反而降了
 * （74.46M → 59.31M）。曲线只给两个点，看不出中间发生了什么；实测本页一跑就抓到：
 * **加 1 次弹刀（6→7）就让整个轴 `infeasible`，伤害掉 15.4M**，而 7~20 次全程轴不可行、
 * 伤害在 77~90M 之间锯齿跳动 —— 这些在曲线上只会呈现为「两个点、斜率很怪」。
 *
 * 引擎在 `composables/interactionSweep.ts`（纯逻辑 + 判据测试）；本页只做展示与调度。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { NAlert, NButton, NCard, NInputNumber, NSelect, useMessage } from 'naive-ui'
import { useBatchOwner, type BatchProgress } from '@/composables/batchTask'
import { cloneConfigState, withAnalysisScenario } from '@/composables/analysisScenario'
import { applyAxisBinding, applyTeamToStore } from '@/composables/teamCompare'
import { applyBossRoom } from '@/composables/bossRoom'
import { runInteractionSweep, type SweepSeries, type SweepResult, type SweepStep } from '@/composables/interactionSweep'
import { type SweepSurface } from '@/composables/interactionSurface'
import { runSurfaceInWorker } from '@/composables/interactionSurfaceRunner'
import InteractionSurface3D from '@/components/charts/InteractionSurface3D.vue'
import { useCatalogStore } from '@/stores/catalog'
import { teamPresets } from '@/data/teamPresets'
import { compact, fmt } from '@/utils/format'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'

const catalog = useCatalogStore()
const message = useMessage()

const presetId = ref<string | null>(null)
const bossId = ref<string | null>(null)
const phaseId = ref<string | null>(null)
const maxCount = ref(20)
const computing = ref(false)
const error = ref<string | null>(null)
const result = ref<SweepResult | null>(null)
/** 二维面（交互 × 合轴）状态 */
const surface = ref<SweepSurface | null>(null)
const surfaceComputing = ref(false)
/** 批任务进度（`{pct 0-1, text}`）；页面只渲染，不参与计算 */
const sweepProgress = ref<BatchProgress | null>(null)
const surfaceProgress = ref<BatchProgress | null>(null)
/**
 * 当前运行的取消句柄。两个扫描共用一条通道（`batchTask` 的唯一取消通道 = AbortSignal）：
 * 页面同一时刻只跑一个扫描，新的 `start` 会顶掉旧的。
 */
const owner = useBatchOwner()
/** 取消当前扫描（两个按钮共用） */
function cancel() { owner.cancel() }
const surfaceMaxCount = ref(12)
const surfaceRatioSteps = ref(4)
const ratioStepOptions = [
  { label: '粗 (4 档)', value: 4 },
  { label: '标准 (6 档)', value: 6 },
  { label: '细 (9 档)', value: 9 },
]

const presetOptions = computed(() => teamPresets
  .filter(p => Array.isArray(p.team) && p.team.length === 3)
  .map(p => ({ label: `${p.name}（${p.id}）`, value: p.id })))

const bosses = ref<BossPreset[]>([])
const bossOptions = computed(() => bosses.value.map(b => ({ label: b.name, value: b.id })))
const currentBoss = computed(() => bosses.value.find(b => b.id === bossId.value) ?? null)
const phaseOptions = computed(() => (currentBoss.value?.phases ?? [])
  .map(p => ({ label: `${p.label}（${p.modeType === 'critical_assault' ? '危局' : '防卫战'}）`, value: p.phaseId })))
const currentPhase = computed<BossPresetPhase | null>(() =>
  currentBoss.value?.phases.find(p => p.phaseId === phaseId.value) ?? null)

/** 载入 Boss 预设 + 选默认值（最新一期危局；没有就取第一个） */
async function loadBosses() {
  const data = await catalog.loadBossPresets()
  bosses.value = [...(data.bosses ?? [])] as BossPreset[]
  if (bosses.value.length > 0 && !presetId.value) {
    /**
     * 默认队挑「交互机制最全」的那支，而不是字母序第一支。
     *
     * 本页是诊断工具：默认落在一支交互全负收益的队上，用户第一眼看到的就是一张全平的废面，
     * 会误以为图坏了。般岳队（1471）自带金身/双反/弹刀三条链，面形状最完整 ⇒ 作默认。
     * 找不到就退回第一支满槽队，绝不空着。
     */
    const first = teamPresets.find(p => p.id === 'banyue-liuyin-lucia')
      ?? teamPresets.find(p => Array.isArray(p.team) && p.team.length === 3)
    if (first) presetId.value = first.id
  }
  if (bosses.value.length > 0 && !bossId.value) {
    const sorted = [...bosses.value].sort((a, b) =>
      String(b.phases[0]?.begin ?? '').localeCompare(String(a.phases[0]?.begin ?? '')))
    const b = sorted[0]!
    bossId.value = b.id
    const ca = b.phases.find(p => p.modeType === 'critical_assault') ?? b.phases[0]
    phaseId.value = ca?.phaseId ?? null
  }
}

watch(bossId, () => {
  const b = currentBoss.value
  if (!b) return
  const ca = b.phases.find(p => p.modeType === 'critical_assault') ?? b.phases[0]
  phaseId.value = ca?.phaseId ?? null
})

onMounted(() => { void loadBosses() })


/** 跑一次扫描（独立场景，不污染 UI 现场） */
async function runSweep() {
  const preset = teamPresets.find(p => p.id === presetId.value)
  const boss = currentBoss.value
  const phase = currentPhase.value
  if (!preset || !boss || !phase) {
    message.warning('先选队伍 / Boss / 期数')
    return
  }
  const run = owner.start()
  computing.value = true
  sweepProgress.value = { pct: 0, text: '准备中…' }
  error.value = null
  try {
    const res = await withAnalysisScenario(async s => {
      applyBossRoom(s.config, boss, phase)
      applyTeamToStore(s.config, preset)
      applyAxisBinding(s.config, s.config.getAxisState(), preset)
      return runInteractionSweep(s, {
        preset, boss, phase,
        maxCount: maxCount.value,
        control: { signal: run.signal },
        onProgress: p => { if (run.isCurrent()) sweepProgress.value = p },
      })
    })
    // 只有当前运行能提交结果（被新运行顶掉 / 页面已离开 ⇒ 丢弃）
    run.commit(() => { result.value = res })
  } catch (e) {
    if (run.isCurrent()) error.value = (e as Error).message
  } finally {
    if (run.isCurrent()) { computing.value = false; sweepProgress.value = null }
  }
}

/**
 * 跑一次二维面（交互 × 合轴）。
 *
 * 与一维扫描共用同一个独立场景模式，但额外扫合轴吸收率这一维——
 * 用户口径 2026-10-18：「一次交互赚不赚，取决于合轴率给不给它腾时间」。
 * 两次扫描互不依赖，各自开场景、各自 dispose。
 */
async function runSurface() {
  const preset = teamPresets.find(p => p.id === presetId.value)
  const boss = currentBoss.value
  const phase = currentPhase.value
  if (!preset || !boss || !phase) {
    message.warning('先选队伍 / Boss / 期数')
    return
  }
  const run = owner.start()
  surfaceComputing.value = true
  surfaceProgress.value = { pct: 0, text: '准备中…' }
  error.value = null
  try {
    /**
     * **走 worker 通道**（`interactionSurfaceRunner`）：
     *
     * 单格内部是引擎同步代码（降配格要跑满 8 档 DOWNSCALE_SCALES），主线程会卡 5~6s；
     * 换线程后主线程彻底解放，网格再大也不影响交互。
     *
     * ⚠ 场景装配（Boss 房 / 队伍 / 轴绑定）必须在**取快照之前**落到配置上——
     * 两条通道都从这份快照复刻场景；先在临时场景里装配、取出装配后的 state、再交给 runner。
     * 这样 worker 与主线程回落**看到的是同一份输入**（数值逐位相同，判据见 runner 头注释）。
     */
    const prepared = await withAnalysisScenario(s => {
      applyBossRoom(s.config, boss, phase)
      applyTeamToStore(s.config, preset)
      applyAxisBinding(s.config, s.config.getAxisState(), preset)
      return cloneConfigState(s.config.$state) as unknown as Record<string, unknown>
    })
    const outcome = await runSurfaceInWorker(
      {
        preset, boss, phase,
        maxCount: surfaceMaxCount.value,
        countStep: 2,
        ratioSteps: surfaceRatioSteps.value,
        configState: prepared,
      },
      {
        signal: run.signal,
        onProgress: p => { if (run.isCurrent()) surfaceProgress.value = p },
      },
    )
    if (!outcome.aborted) run.commit(() => { surface.value = outcome.surface })
  } catch (e) {
    if (run.isCurrent()) error.value = (e as Error).message
  } finally {
    if (run.isCurrent()) { surfaceComputing.value = false; surfaceProgress.value = null }
  }
}

/** 总览的结论列：把「加交互赚不赚」压成一句话 */
function verdictOf(s: SweepSeries): string {
  if (Math.abs(s.gainAtBest) < 1e4) return '加交互基本无收益'
  if (s.gainAtBest < 0) return `加交互反而掉 ${compact(-s.gainAtBest)}`
  return `加到 ${s.best.count} 次最优（+${compact(s.gainAtBest)}）`
}

const num = (v: number | undefined) => (v === undefined ? '—' : fmt(v, 1))

/** 相邻两格的 Δ伤害（第一格无参照） */
function deltaText(i: number, s: SweepSeries): string {
  if (i === 0) return '—'
  const d = s.steps[i]!.dmg - s.steps[i - 1]!.dmg
  if (Math.abs(d) < 1e4) return '±0'
  return `${d > 0 ? '+' : ''}${compact(d)}`
}
function deltaClass(i: number, s: SweepSeries): Record<string, boolean> {
  if (i === 0) return {}
  const d = s.steps[i]!.dmg - s.steps[i - 1]!.dmg
  return { pos: d > 1e4, neg: d < -1e4 }
}

/**
 * **本格相对上一格的主要变化**（用户要的就是这个：每一点变化了什么）。
 * 只列**真的变了**的量：轴态 / 失衡次数 / 大招 / 连携 / 合轴节省 / 净占用。
 * 不在这里做因果解释——引擎给什么列什么，解释留给读者。
 */
function changesOf(i: number, s: SweepSeries): string {
  if (i === 0) return '起点'
  const a = s.steps[i - 1]!
  const b = s.steps[i]!
  const out: string[] = []
  if (a.axisLabel !== b.axisLabel) out.push(`轴态 ${a.axisLabel} → ${b.axisLabel}`)
  if (a.stunCount !== b.stunCount) out.push(`失衡 ${a.stunCount} → ${b.stunCount}`)
  const dUlt = (b.counts['大招'] ?? 0) - (a.counts['大招'] ?? 0)
  if (Math.abs(dUlt) >= 0.05) out.push(`大招 ${signed(dUlt)}`)
  const dChain = (b.counts['连携'] ?? 0) - (a.counts['连携'] ?? 0)
  if (Math.abs(dChain) >= 0.05) out.push(`连携 ${signed(dChain)}`)
  const dSaved = b.time.saved - a.time.saved
  if (Math.abs(dSaved) >= 0.5) out.push(`合轴节省 ${signed(dSaved, 1)}s`)
  const dNet = b.time.net - a.time.net
  if (Math.abs(dNet) >= 0.5) out.push(`净占用 ${signed(dNet, 1)}s`)
  return out.length > 0 ? out.join(' · ') : '（无关键量变化）'
}
function signed(v: number, digits = 1): string {
  return `${v > 0 ? '+' : ''}${fmt(v, digits)}`
}

/** 类型别名只为让模板里的 `SweepStep` 可见（vue-tsc 需要显式引用） */
void (0 as unknown as SweepStep)
</script>
<style scoped>
.interaction-sweep-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.ctl-field {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ctl-label {
  color: var(--fg-2);
  font-size: 12px;
}
.ctl-hint {
  flex: 1 1 100%;
}
.ctl-hint .ctl-label {
  color: var(--fg-3);
  line-height: 1.5;
}
/* 批任务进度行：采样器每格让出主线程，进度条才能动；文字给「已算/总格数」 */
.progress-row {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  margin-top: var(--space-4);
}
.progress-row :deep(.n-progress) {
  flex: 1 1 auto;
}
.progress-text {
  flex: 0 0 auto;
  color: var(--fg-3);
  font-size: var(--text-md);
  font-variant-numeric: tabular-nums;
}
.muted {
  color: var(--fg-3);
  font-size: 12px;
}
.sweep-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.sweep-table th,
.sweep-table td {
  padding: 4px 8px;
  text-align: right;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
.sweep-table th {
  color: var(--fg-3);
  font-weight: 500;
}
.sweep-table th:first-child,
.sweep-table td:first-child {
  text-align: left;
}
.sweep-table.dense td {
  padding: 3px 8px;
}
.sweep-table td.detail {
  text-align: left;
  color: var(--fg-2);
  white-space: normal;
  max-width: 420px;
}
.pos {
  color: var(--c-success);
}
.neg {
  color: var(--c-danger);
}
.warn {
  color: var(--c-warning);
}
.dim {
  color: var(--fg-3);
}
</style>