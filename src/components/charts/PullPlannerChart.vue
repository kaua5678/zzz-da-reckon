<template>
<n-card size="small" :bordered="true">
  <template #header>
    抽卡规划器 · 危局最优策略
    <span class="chart-subtitle">从起点节点、每版本 {{ PLANNER_FILM }}/菲林收入出发，beam search 规划限定卡抽取（本体/专武/满配阶梯，首 UP 窗口唯一），每期 3 Boss × 9 人不重叠组队最大化危局总分；卡价值 = VCG 反事实差分（禁用重规划的分数损失）</span>
  </template>
  <template #header-extra>
    <div class="chart3-actions">
      <n-select v-model:value="ppPreset" :options="ppPresetOptions" size="small" style="width: 170px" />
      <n-select v-model:value="ppStartDate" :options="ppStartOptions" size="small" style="width: 130px" filterable />
      <n-button size="small" type="primary" :loading="ppComputing" @click="runPlanner">
        {{ ppResult ? '重新规划' : '规划' }}
      </n-button>
    </div>
  </template>

  <!-- 参数 -->
  <div class="sim-controls">
    <div class="ctl-field">
      <span class="ctl-label">起点银行（菲林）</span>
      <n-input-number v-model:value="ppInitialBank" :min="0" :max="500000" :step="5000" size="small" style="width: 120px" />
    </div>
    <div class="ctl-field">
      <span class="ctl-label">每版本菲林（默认 25000）</span>
      <n-input-number v-model:value="ppFilmPerVersion" :min="0" :max="100000" :step="1000" size="small" style="width: 120px" />
    </div>
    <div class="ctl-field">
      <span class="ctl-label">beam 宽度</span>
      <n-input-number v-model:value="ppBeamWidth" :min="1" :max="16" size="small" style="width: 80px" />
    </div>
    <div class="ctl-field">
      <span class="ctl-label">规划期数上限（0=全部）</span>
      <n-input-number v-model:value="ppMaxPeriods" :min="0" :max="47" size="small" style="width: 110px" />
    </div>
    <div class="ctl-field">
      <label class="ctl-check">
        <input v-model="ppWithVcg" type="checkbox" />
        VCG 卡价值归因（每卡一次重规划，慢）
      </label>
    </div>
    <div class="ctl-field ctl-hint">
      <span class="ctl-label">口径：分数 = 60000×伤害/当期Boss血量 + 5000 操作分（全满）；单房上限 65000。
        限定卡首 UP 窗口唯一可购（复刻不建模）；购买阶梯 = 本体 15000 → 专武 10000 → 满配。
        贬值内生（每期 Boss 血量/抗性数据驱动，无折现参数）。
        ⚠ 性能：默认参数（近起点 + beam 2 + 4 期）≈ 十秒级；调远起点/加大 beam/放开期数上限会进入分钟级——
        规划是同步计算，期间页面无响应属正常，请勿连点。想要全角色兑现曲线请用「角色兑现」页（基底队方案，秒级）。</span>
    </div>
  </div>

  <div v-if="ppComputing || ppProgress" class="chart-progress">
    <n-progress type="line" :percentage="Math.round((ppProgress?.pct ?? 0) * 100)" :show-indicator="false" :height="6" />
    <span class="progress-text">{{ ppProgress?.text ?? '' }}</span>
  </div>

  <template v-if="ppResult">
    <!-- 结果摘要 -->
    <div class="pv-summary">
      <span>规划 {{ ppResult!.plan.steps.length }} 期 · 总分 {{ fmt(ppResult!.plan.totalScore, 0) }}（均值 {{ fmt(ppResult!.plan.totalScore / Math.max(1, ppResult!.plan.steps.length), 0) }}/期）</span>
      <span>持有 {{ Object.keys(ppResult!.plan.holdings).filter(k => ppResult!.plan.holdings[k] > 0).length }} 张限定 · 累计花费 {{ compact(ppResult!.plan.totalSpent) }} 菲林 · 终态银行 {{ compact(ppResult!.plan.finalBank) }}</span>
      <span v-if="ppResult!.stats">引擎求值 {{ ppResult!.stats.evaluations }} 次（缓存命中 {{ ppResult!.stats.cacheHits }}）· 耗时 {{ (ppResult!.stats.durationMs / 1000).toFixed(1) }}s</span>
    </div>

    <!-- 泳道图例（点击显隐；泳道各自 y 固定，隐藏后留空位而不重排——避免开关一下整张图跳动） -->
    <div class="legend">
      <span class="legend-hint">点图例显隐泳道</span>
      <div
        v-for="d in ppLaneDefs"
        :key="d.id"
        class="legend-item"
        :class="{ off: !ppLegend.isVisible(d.id) }"
        :title="`${d.desc}：点击${ppLegend.isVisible(d.id) ? '隐藏' : '显示'}`"
        @click="ppLegend.toggle(d.id)"
      >
        <span class="swatch" :style="{ background: d.color }"></span><span class="name">{{ d.label }}</span>
      </div>
      <span class="legend-hint legend-action" @click="ppLegend.showAll()">全显示</span>
    </div>

    <!-- 策略甘特：期数 × 购买/队伍 -->
    <div class="timeline-wrap pp-plot">
      <svg :viewBox="`0 0 ${svgW} ${ppSvgH}`" class="timeline-svg">
        <!-- 期刻度 -->
        <g v-for="t in ppXTicks" :key="'ppx' + t.index">
          <line :x1="ppX(t.index)" :y1="ppPadT - 6" :x2="ppX(t.index)" :y2="ppSvgH - ppXLabelH" class="grid-line" />
          <text :x="ppX(t.index)" :y="ppSvgH - 8" text-anchor="middle" class="axis-label x-label">{{ t.label }}</text>
        </g>
        <!-- 购买泳道 -->
        <template v-if="ppLegend.isVisible('purchase')">
        <text :x="ppLabelW - 6" :y="ppPadT + 8" text-anchor="end" class="lane-label">购买</text>
        <g v-for="(st, i) in ppResult.plan.steps" :key="'ppp' + i">
          <rect
            v-for="(p, j) in st.purchases"
            :key="j"
            :x="ppX(i) - 9"
            :y="ppPadT - 6 + j * 14"
            :width="18" :height="12" rx="3"
            :fill="colorOf(p.agentId)"
            class="pp-purchase"
          >
            <title>{{ st.periodLabel }}：{{ agentName(p.agentId) }} {{ ppTierLabel(p.tier) }}（−{{ p.cost }} 菲林）</title>
          </rect>
          <text v-if="st.purchases.length > 0" :x="ppX(i)" :y="ppPadT + 30" text-anchor="middle" class="pp-purchase-label">
            {{ st.purchases.map(p => agentName(p.agentId)).join('/') }}
          </text>
        </g>
        </template>
        <!-- 分数折线（期总分 + 累计） -->
        <template v-if="ppLegend.isVisible('score')">
        <text :x="ppLabelW - 6" :y="ppScoreY(0) + 4" text-anchor="end" class="lane-label">期分</text>
        <polyline :points="ppScoreLine" class="pp-score-line" />
        <g v-for="(pt, i) in ppScorePts" :key="'pps' + i">
          <circle :cx="pt.x" :cy="pt.y" r="3" fill="var(--app-primary)" class="trend-point">
            <title>{{ pt.label }}：{{ fmt(pt.score, 0) }} 分</title>
          </circle>
        </g>
        </template>
        <!-- 三队伍泳道（当期 3 Boss 的选队） -->
        <template v-for="(lane, li) in ppVisibleTeamLanes" :key="'pptl' + li">
          <text :x="ppLabelW - 6" :y="lane.y + 10" text-anchor="end" class="lane-label">房{{ lane.roomNo }}</text>
          <g v-for="(cell, i) in lane.cells" :key="i">
            <rect
              :x="ppX(i) - ppCellW / 2" :y="lane.y" :width="ppCellW - 1" :height="lane.h"
              :fill="cell.empty ? 'var(--wa-30)' : 'rgba(99, 179, 237, 0.13)'"
              class="lane-cell"
            >
              <title>{{ cell.title }}</title>
            </rect>
            <text v-if="!cell.empty" :x="ppX(i)" :y="lane.y + lane.h / 2 + 3" text-anchor="middle" class="lane-text pp-team-text">
              {{ cell.text }}
            </text>
          </g>
        </template>
      </svg>
    </div>

    <!-- VCG 台账 -->
    <div v-if="ppResult.values.length > 0" class="table-wrap pp-values">
      <table class="tl-table">
        <thead>
          <tr>
            <th>卡</th>
            <th>VCG 价值（分）</th>
            <th>禁用后总分</th>
            <th>规划终态档位</th>
            <th>折算（分/万菲林）</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in ppTopValues" :key="v.agentId" :class="{ 'pv-sel-row': v.value > 0 && v.tierInPlan > 0 }">
            <td><span class="dot" :style="{ background: colorOf(v.agentId) }"></span>{{ agentName(v.agentId) }}</td>
            <td :class="{ 'kill-line': v.value > 0 }">{{ fmt(v.value, 0) }}</td>
            <td>{{ fmt(v.baselineTotal, 0) }}</td>
            <td>{{ ppTierLabel(v.tierInPlan) }}</td>
            <td>{{ v.value > 0 && v.tierInPlan > 0 ? fmt(v.value / (v.tierInPlan === 3 ? 17 : v.tierInPlan === 2 ? 2.5 : 1.5), 0) : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
  <div v-else class="empty-hint small-hint">
    选起点预设与起始节点后点「规划」：beam search 在每版本节点展开「买卡 / 攒菲林」分支，
    每期用真实引擎算 3 Boss × 9 人不重叠最优组队，全程最大化危局总分。勾选 VCG 出卡价值台账
    （禁用该卡重规划的分数损失——卢西娅式「专拐被禁 → 被迫用潘引壶」的机会差会直接呈现）。
  </div>
</n-card>
</template>

<script setup lang="ts">
/**
 * Chart 6「抽卡规划器 · 危局最优策略」（2026-09-14 从 TimeChartsPage 抽组件，165 行模板 + 82 行脚本）。
 *
 * 与 Chart 4/7 同型：`calc`/`catalogStore`/`agentName` 在组件内自取，布局/数据经 props 注入。
 * **组件内状态**（页面不关心，规划器自身就很大）：起点预设/起始节点/银行/每版本菲林/beam 宽度/
 * 期数上限/VCG 开关、跑批状态（ppComputing/ppProgress/ppResult）、泳道图例显隐、几何适配层。
 * **props 注入**（页面级状态，Chart 1/2/4/7 与顶部控件也在用，不许下沉）：
 * - `svgW`（页面 svgW 计算属性）——本组件只用宽度，pad/plot 由 `pullPlannerChart.ts` 自带
 *   （ppLabelW/ppPadT/ppXLabelH 直接读自 buildPlannerChart 的返回值，原样保留非响应式写法）；
 * - `boss`（顶部所选 Boss）——runPlanner 的 `boss` 入参与「先选 Boss」校验用它；
 * - `bosses`（页面 fetch 的 bossPresets 全量）、`periodViews`（页面 fetch 的 phaseViews）。
 * ⚠ 文案与 `formula` 口径字符串逐字保留（有测试断言，改一个字就红）。
 */
import { computed, nextTick, ref } from 'vue'
import { NButton, NCard, NInputNumber, NProgress, NSelect } from 'naive-ui'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useSeriesFilter } from '@/composables/seriesFilter'
import { colorOf } from '@/composables/charts/agentPresentation'
import {
  buildPlannerChart,
  PP_LANE_DEFS,
  ppTierLabelOf,
} from '@/composables/pullPlannerChart'
import { PLANNER_FILM_PER_VERSION } from '@/data/filmEconomy'
import { runPullPlanner, type PlannerRunResult } from '@/composables/pullPlannerEngine'
import { VERSION_NODES } from '@/data/versionTimeline'
import { fmt, compact } from '@/utils/format'
import type { BossPreset, PhaseView } from '@/types/bossPreset'

const props = defineProps<{
  /** 布局宽度（页面 svgW；本图纵向几何自带，见头注释） */
  svgW: number
  /** 顶部所选 Boss（规划对象；空时点击「规划」给引导提示） */
  boss: BossPreset | null
  /** 全部 Boss（页面 fetch 的 boss-presets.json bosses） */
  bosses: BossPreset[]
  /** 危局期数视图（页面 fetch 的 phaseViews） */
  periodViews: PhaseView[]
}>()

const catalogStore = useCatalogStore()
const calc = useResourceCalc()
function agentName(id: string): string {
  return catalogStore.getAgent(id)?.name.zhCN ?? id
}

// ========== Chart 6：抽卡规划器（beam search 最优策略 + VCG 价值归因） ==========
const PLANNER_FILM = PLANNER_FILM_PER_VERSION
const ppPreset = ref<'fresh' | 'established' | 'custom'>('established')
const ppPresetOptions = [
  { value: 'established', label: '成型号（常驻S+A 免费，0 限定）' },
  { value: 'fresh', label: '新号（全限定待抽）' },
  { value: 'custom', label: '自选持有（暂同成型号）' },
]
const ppStartDate = ref('2026-07-08')
/** 起点候选 = 版本节点日期（近 12 个） */
const ppStartOptions = computed(() =>
  VERSION_NODES.slice(-14).map(n => ({ value: n.date, label: `${n.label}（${n.date}）` })),
)
const ppInitialBank = ref(30000)
const ppFilmPerVersion = ref(PLANNER_FILM_PER_VERSION)
const ppBeamWidth = ref(2)
const ppMaxPeriods = ref(1)
const ppWithVcg = ref(false)
const ppComputing = ref(false)
const ppProgress = ref<{ pct: number; text: string } | null>(null)
const ppResult = ref<PlannerRunResult | null>(null)

async function runPlanner() {
  const catalog = catalogStore
  const boss = props.boss
  if (!boss) {
    ppProgress.value = { pct: 1, text: '先选 Boss（顶部）' }
    setTimeout(() => { ppProgress.value = null }, 2500)
    return
  }
  ppComputing.value = true
  ppProgress.value = { pct: 0, text: '准备…' }
  await nextTick()
  try {
    ppResult.value = await runPullPlanner({
      calc,
      allBosses: props.bosses,
      boss,
      periodViews: props.periodViews,
      allAgentIds: catalog.displayAgents.map(a => a.id),
      preset: ppPreset.value,
      startDate: ppStartDate.value,
      maxPeriods: ppMaxPeriods.value || undefined,
      initialBank: ppInitialBank.value,
      filmPerVersion: ppFilmPerVersion.value,
      beamWidth: ppBeamWidth.value,
      assignmentTopM: 6,
      withVcg: ppWithVcg.value,
      onProgress: p => { ppProgress.value = p },
    })
  } catch (e) {
    ppProgress.value = { pct: 1, text: `规划失败：${e instanceof Error ? e.message : String(e)}` }
    setTimeout(() => { ppProgress.value = null }, 4000)
  } finally {
    ppComputing.value = false
  }
}

// ---- Chart 6 几何与泳道模型：见 composables/pullPlannerChart.ts（纯函数，可单测）----
const ppc = computed(() => buildPlannerChart({
  steps: ppResult.value?.plan.steps ?? [],
  svgW: props.svgW,
  nameOf: (id) => agentName(id),
  fmt,
  isLaneVisible: (id) => ppLegend.isVisible(id),
}))
const ppLaneDefs = PP_LANE_DEFS
const ppLegend = useSeriesFilter(() => ppLaneDefs.map(d => ({ id: d.id, name: d.label })))
const ppLabelW = ppc.value.labelW
const ppPadT = ppc.value.padT
const ppXLabelH = ppc.value.xLabelH
const ppSvgH = computed(() => ppc.value.svgH)
const ppCellW = computed(() => ppc.value.cellW)
function ppX(i: number): number { return ppc.value.x(i) }
const ppXTicks = computed(() => ppc.value.xTicks)
function ppScoreY(v: number): number { return ppc.value.scoreY(v) }
const ppScorePts = computed(() => ppc.value.scorePts)
const ppScoreLine = computed(() => ppc.value.scoreLine)
const ppVisibleTeamLanes = computed(() => ppc.value.visibleTeamLanes)
const ppTierLabel = ppTierLabelOf
const ppTopValues = computed(() => (ppResult.value?.values ?? []).slice(0, 20))
</script>

<style scoped src="@/styles/chart-blocks.css"></style>
<style scoped src="../../views/timeCharts/pull-planner-chart.css"></style>
