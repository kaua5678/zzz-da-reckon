<template>
<n-card size="small" :bordered="true">
  <template #header>
    菲林经济模拟 · 队伍强度
    <span class="chart-subtitle">主C 固定（顶部选择），队友 = 候选池按当前金数自动换最优（如 琉音换青衣、卢西娅换潘引壶）；起点 = 主C 首次 UP 之后的 Boss 初登场；每期用当期 Boss 数值 + 关卡固有 buff 算强度（伤害/当期 Boss 血量%）</span>
  </template>
  <template #header-extra>
    <div class="chart3-actions">
      <n-button size="small" type="primary" :loading="simComputing" @click="runFilmSim">
        {{ simPoints.length > 0 ? '重新模拟' : '模拟' }}
      </n-button>
    </div>
  </template>

  <!-- 参数表单 -->
  <div class="sim-controls">
    <div class="ctl-field">
      <span class="ctl-label">主C（顶部「主C角色」选择）</span>
      <span class="sim-main-name">{{ agentName(mainAgentId) }}</span>
    </div>
    <div class="ctl-field">
      <span class="ctl-label">队友候选池（顶部「候选队友」；按金数自动换最优双人）</span>
      <span class="sim-main-name">{{ candidatePool.map(agentName).join(' / ') || '—' }}</span>
    </div>
    <div class="ctl-field">
      <span class="ctl-label">初始金数</span>
      <n-input-number v-model:value="simInitialGold" :min="0" :max="24" size="small" style="width: 90px" />
    </div>
    <div class="ctl-field">
      <span class="ctl-label">菲林/版本（≈1金=15000）</span>
      <n-input-number v-model:value="simFilmPerVersion" :min="0" :max="100000" :step="1000" size="small" style="width: 110px" />
    </div>
    <div class="ctl-field">
      <span class="ctl-label">消耗占比（0~1）</span>
      <n-input-number v-model:value="simSpendRatio" :min="0" :max="1" :step="0.05" size="small" style="width: 90px" />
    </div>
    <div class="ctl-field">
      <span class="ctl-label">每版本充值预算（元）</span>
      <n-input-number v-model:value="simBudgetYuan" :min="0" :max="100000" :step="30" size="small" style="width: 110px" />
      <span class="ctl-note">按性价比自动分配：月卡(30元→3300) → 大月卡(68元→≈2600) → 直充(10菲林/元)，汇率固定</span>
    </div>
    <div class="ctl-field">
      <span class="ctl-label">目标卡池（清空银行投入）</span>
      <n-select v-model:value="simTargetPeriod" :options="simTargetOptions" size="small" clearable filterable style="width: 180px" placeholder="无（不加码）" />
    </div>
  </div>

  <!-- 折线图：血量%主线 + 金数副线（图例可点显隐） -->
  <div v-if="simPoints.length > 0" class="timeline-wrap sim-plot">
    <div class="legend">
      <span class="legend-hint">点图例显隐</span>
      <div
        class="legend-item"
        :class="{ off: !simLegend.isVisible('hp') }"
        title="队伍强度（伤害/当期 Boss 血量%）"
        @click="simLegend.toggle('hp')"
      >
        <span class="swatch sim-swatch-hp"></span><span class="name">队伍强度 %</span>
      </div>
      <div
        class="legend-item"
        :class="{ off: !simLegend.isVisible('gold') }"
        title="累计限定金数（右轴）"
        @click="simLegend.toggle('gold')"
      >
        <span class="swatch sim-swatch-gold"></span><span class="name">金数（右轴）</span>
      </div>
    </div>
    <svg
      :viewBox="`0 0 ${svgW} ${simSvgH}`"
      class="timeline-svg"
      @mousemove="onSimMove"
      @mouseleave="simHover = -1"
    >
      <g v-for="(y, i) in simYGrid" :key="'fg' + i">
        <line :x1="padL" :x2="svgW - padR" :y1="y" :y2="y" class="grid-line" />
        <text :x="padL - 8" :y="y + 3" class="axis-label" text-anchor="end">{{ simYLabel(i) }}%</text>
      </g>
      <!-- 100% 击杀线 -->
      <line :x1="padL" :y1="simY(100)" :x2="svgW - padR" :y2="simY(100)" class="kill-line-ref" />
      <text :x="svgW - padR - 2" :y="simY(100) - 5" class="axis-label" text-anchor="end">100%</text>
      <!-- 队伍强度主线 -->
      <polyline v-if="simLegend.isVisible('hp')" :points="simHpLine" class="sim-line" />
      <!-- 金数副线（右轴） -->
      <polyline v-if="simLegend.isVisible('gold')" :points="simGoldLine" class="sim-gold-line" />
      <!-- 金数右轴刻度 -->
      <text v-for="g in (simLegend.isVisible('gold') ? 4 : 0)" :key="'gp' + g" :x="svgW - padR + 2" :y="simGoldY((simGoldMax / 4) * g) + 3" class="axis-label gold-axis-label">{{ Math.round((simGoldMax / 4) * g) }}</text>
      <!-- 点 -->
      <g v-for="(p, i) in simPts" :key="'fp' + i">
        <circle v-if="simLegend.isVisible('hp')" :cx="p.x" :cy="p.y" r="3.5" :fill="p.color" :style="{ stroke: simHover === i ? 'var(--app-text-solid)' : 'var(--wa-250)' }" :stroke-width="simHover === i ? 2 : 1" class="trend-point">
          <title>{{ p.label }}：{{ fmt(p.hpRatio, 1) }}%（{{ p.totalGold }}金）</title>
        </circle>
      </g>
      <!-- X 轴标签（抽稀） -->
      <g v-for="t in simXTicks" :key="'fx' + t.index">
        <text :x="simX(t.index)" :y="simSvgH - 8" class="axis-label x-label" text-anchor="middle">{{ t.label }}</text>
      </g>
      <line v-if="simHover >= 0" :x1="simPts[simHover].x" :y1="padT" :x2="simPts[simHover].x" :y2="padT + plotH" class="hover-line" />
    </svg>

    <!-- 悬浮卡外壳见 components/ChartHoverCard.vue -->
    <ChartHoverCard
      v-if="simHover >= 0 && simHoverInfo"
      :x="simCardX"
      :y="simCardY"
      :title="`期 ${simHoverInfo.label}`"
      :rows="simHoverRows"
    />
  </div>
  <div v-else class="empty-hint small-hint">设置模拟参数后点「模拟」：每期按菲林投放 → 占比花/存 → 主C优先买金 → 当期 Boss + buff 出强度。</div>

  <!-- 进度条 -->
  <div v-if="simComputing || simProgress" class="chart-progress">
    <n-progress
      type="line"
      :percentage="Math.round((simProgress?.pct ?? 0) * 100)"
      :show-indicator="false"
      :height="6"
    />
    <span class="progress-text">{{ simProgress?.text ?? '' }}</span>
  </div>
</n-card>
</template>

<script setup lang="ts">
/**
 * Chart 4「菲林经济模拟 · 队伍强度」（2026-09-14 从 TimeChartsPage 抽组件，122 行模板 + 77 行脚本）。
 *
 * **组件内状态**（页面不关心）：模拟参数（初始金数/菲林/占比/充值/目标卡池）、跑批状态、
 * 图例显隐、悬浮——与 Chart 7 同型：布局/数据经 props 注入，跑批编排调
 * `composables/charts/chartRunners.ts#runFilmSimCompute`（实现不动）。
 * **props 注入**：
 * - 布局六件（svgW/padL/padR/padT/plotW/plotH）——与 Chart 1/2/6 共享同一套页面几何；
 * - `boss`（顶部所选 Boss；`bossPeriodAxis` 派生链留在页面，本轮只按 props 传，
 *   不下沉 composable——唯一消费者就是本组件，抽 composable 违反规则 12 第一档 YAGNI）；
 * - `axisNodes`（所选 Boss 的登场期数轴，PeriodAxisNode[] 整份传入）：**两个映射在组件内做**——
 *   「目标卡池」下拉用 `${p.seq} · ${p.label}`，runner 的 axisNodes 用 `${p.seq}`（横轴刻度用期号），
 *   两处文案不同、必须逐字保留；
 * - `periodViews`（页面 fetch 的 phaseViews）、`mainAgentId`/`candidatePool`/`autoBuild`（顶部控件状态）。
 */
import { computed, ref } from 'vue'
import { NButton, NCard, NInputNumber, NProgress, NSelect } from 'naive-ui'
import { fmt } from '@/utils/format'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useSeriesFilter } from '@/composables/seriesFilter'
import { hoverCardPosition, readSvgPointer } from '@/composables/svgPointer'
import { nearestIndexByX, xHitTolerance } from '@/composables/svgHitTest'
import { colorOf } from '@/composables/charts/agentPresentation'
import { runFilmSimCompute } from '@/composables/charts/chartRunners'
import { filmSimHoverRows as buildFilmSimHoverRows } from '@/composables/charts/hoverCardRows'
import { buildFilmSimHoverInfo } from '@/composables/charts/hoverInfoBuilders'
import { buildFilmSimChart } from '@/composables/filmSimChart'
import ChartHoverCard, { type HoverCardRow } from '@/components/ChartHoverCard.vue'
import type { FilmSimPoint } from '@/composables/teamTimeline'
import type { PeriodAxisNode } from '@/composables/bossSchedule'
import type { BossPreset, PhaseView } from '@/types/bossPreset'

const props = defineProps<{
  /** 布局（页面 svgW + TIMELINE_LAYOUT 的 pad/plot） */
  svgW: number
  padL: number
  padR: number
  padT: number
  plotW: number
  plotH: number
  /** 顶部所选 Boss（模拟起点 = 主C 首次 UP 之后的 Boss 初登场） */
  boss: BossPreset | null
  /** 所选 Boss 的登场期数轴（页面 bossPeriodAxis；映射在本组件内做，见头注释） */
  axisNodes: PeriodAxisNode[]
  /** 危局期数视图（页面 fetch 的 phaseViews） */
  periodViews: PhaseView[]
  /** 顶部控件状态（主C / 候选队友池 / 自动配装） */
  mainAgentId: string
  candidatePool: string[]
  autoBuild: boolean
}>()

const catalogStore = useCatalogStore()
const calc = useResourceCalc()
function agentName(id: string): string {
  return catalogStore.getAgent(id)?.name.zhCN ?? id
}

// ========== Chart 4：菲林经济模拟（队伍强度随菲林投入；主C固定，队友按金数换最优） ==========
const simInitialGold = ref(6)
const simFilmPerVersion = ref(15000)
const simSpendRatio = ref(0.5)
const simBudgetYuan = ref(0)
const simTargetPeriod = ref('')
const simComputing = ref(false)
const simProgress = ref<{ pct: number; text: string } | null>(null)
const simPoints = ref<FilmSimPoint[]>([])

const simTargetOptions = computed(() =>
  props.axisNodes.map(p => ({ value: p.id, label: `${p.seq} · ${p.label}` })),
)

async function runFilmSim() {
  // 校验/装配/调用已出函 composables/charts/chartRunners.ts#runFilmSimCompute（第一片拆分，逐字搬迁）
  await runFilmSimCompute({
    calc, computing: simComputing, progress: simProgress, points: simPoints,
    boss: props.boss,
    axisNodes: props.axisNodes.map(p => ({ id: p.id, label: `${p.seq}`, date: p.begin })),
    periodViews: props.periodViews,
    mainAgentId: props.mainAgentId,
    candidatePool: props.candidatePool,
    initialGold: simInitialGold.value,
    filmPerVersion: simFilmPerVersion.value,
    spendRatio: simSpendRatio.value,
    budgetYuan: simBudgetYuan.value,
    targetPeriod: simTargetPeriod.value,
    autoBuild: props.autoBuild,
  })
}

// ---- Chart 4 SVG（血量%主线 + 金数副线） ----
// Chart 4 几何：见 composables/filmSimChart.ts（与 Chart 1/3 共享血量%纵轴）
/** 绘图盒（Chart 4 用；原与 Chart 3 共用，Chart 3/7 相继抽走后随本组件走） */
const TB = { padT: props.padT, plotH: props.plotH }
const sim = computed(() => buildFilmSimChart({
  points: simPoints.value,
  svgW: props.svgW,
  padL: props.padL,
  plotW: props.plotW,
  box: TB,
  colorOf: (key) => colorOf(key),
}))
const simSvgH = sim.value.svgH
function simY(v: number): number { return sim.value.y(v) }
const simYGrid = computed(() => sim.value.yGrid)
function simYLabel(i: number): number { return sim.value.yLabel(i) }
const simGoldMax = computed(() => sim.value.goldMax)
function simGoldY(g: number): number { return sim.value.goldY(g) }
function simX(i: number): number { return sim.value.x(i) }
const simXTicks = computed(() => sim.value.xTicks)
const simPts = computed(() => sim.value.pts)
const simHpLine = computed(() => sim.value.hpLine)
const simGoldLine = computed(() => sim.value.goldLine)
/** 两条线的显隐（图例可点）；隐藏主线时 Y 轴仍按血量%口径（尺度含义不变，只是不画线） */
const simLegend = useSeriesFilter(() => [
  { id: 'hp', name: '队伍强度 %' },
  { id: 'gold', name: '金数（右轴）' },
])
const simHover = ref(-1)
const simHoverInfo = computed(() =>
  buildFilmSimHoverInfo(simPoints.value[simHover.value], { agentName }))

const simHoverRows = computed<HoverCardRow[]>(() => buildFilmSimHoverRows(simHoverInfo.value))
const simCardX = ref(0)
const simCardY = ref(0)
function onSimMove(e: MouseEvent) {
  const { svgX, relX, relY, rect } = readSvgPointer(e, { w: props.svgW, h: simSvgH })
  const { index: best, distance: bestDist } = nearestIndexByX(simPts.value, svgX)
  if (best >= 0 && bestDist < xHitTolerance(props.plotW, simPoints.value.length, 2)) {
    simHover.value = best
    const card = hoverCardPosition({ relX, relY, containerWidth: rect.width, cardWidth: 260 })
    simCardX.value = card.x
    simCardY.value = card.y
  } else {
    simHover.value = -1
  }
}
</script>

<style scoped src="@/styles/chart-blocks.css"></style>
<style scoped src="../../views/timeCharts/film-sim-chart.css"></style>
