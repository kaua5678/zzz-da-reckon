<template>
<n-card size="small" :bordered="true">
  <template #header>
    同槽位角色对比
    <span class="chart-subtitle">
      横轴 = 主C实装节点；每组 = 预设中「其余两槽相同、{{ scSlotLabel }}位恰好一队
      {{ agentName(scAgentA) }}、一队 {{ agentName(scAgentB) }}」的两支队伍；
      {{ agentName(scAgentA) }} 队连成蓝线、{{ agentName(scAgentB) }} 队连成橙线，孰高孰低即该主C下谁更强。
      纵轴 = 伤害自动刻度（贴合数据范围，不看 Boss 血量/击杀线）；Boss 可单独切换（默认跟随顶部），
      不同 Boss 的弱点/抗性对不同角色克制不同。预算/配装口径同顶部各图
    </span>
  </template>
  <template #header-extra>
    <div class="chart3-actions">
      <n-select v-model:value="scSlot" :options="scSlotOptions" size="small" style="width: 92px" />
      <n-select v-model:value="scAgentA" :options="allAgentOptions" size="small" filterable style="width: 140px" />
      <n-select v-model:value="scAgentB" :options="allAgentOptions" size="small" filterable style="width: 140px" />
      <n-select
        v-model:value="scBossId"
        :options="bossOptions"
        size="small"
        filterable
        style="width: 170px"
        placeholder="Boss（默认跟随顶部）"
        @update:value="scBossTouched = true"
      />
      <n-button size="small" type="primary" :loading="scComputing" @click="runSlotCompare">
        {{ scPoints.length > 0 ? '重新对比' : '对比' }}
      </n-button>
    </div>
  </template>

  <!-- 进度条 -->
  <div v-if="scComputing || scProgress" class="chart-progress">
    <n-progress
      type="line"
      :percentage="Math.round((scProgress?.pct ?? 0) * 100)"
      :show-indicator="false"
      :height="6"
    />
    <span class="progress-text">{{ scProgress?.text ?? '' }}</span>
  </div>

  <!-- 双折线 SVG -->
  <div v-if="scPoints.length > 0" class="timeline-wrap chart3-plot">
    <div class="sc-legend">
      <span class="sc-legend-item sc-legend-click" :class="{ off: !scLegend.isVisible('A') }" @click="scLegend.toggle('A')">
        <span class="sc-dot" :style="{ background: SC_COLOR_A }"></span>{{ agentName(scAgentA) }} 队
      </span>
      <span class="sc-legend-item sc-legend-click" :class="{ off: !scLegend.isVisible('B') }" @click="scLegend.toggle('B')">
        <span class="sc-dot" :style="{ background: SC_COLOR_B }"></span>{{ agentName(scAgentB) }} 队
      </span>
      <span class="sc-legend-item">Boss：{{ scBossName }}</span>
      <span class="legend-hint">点队名显隐该线（纵轴按剩下的线缩放）</span>
    </div>
    <svg
      :viewBox="`0 0 ${svgW} ${scSvgH}`"
      class="timeline-svg"
      @mousemove="onScMove"
      @mouseleave="scHover = -1"
    >
      <g v-for="(y, i) in scYGrid" :key="'scg' + i">
        <line :x1="padL" :x2="svgW - padR" :y1="y" :y2="y" class="grid-line" />
        <text :x="padL - 8" :y="y + 3" class="axis-label" text-anchor="end">{{ scYLabel(i) }}</text>
      </g>
      <!-- X 轴版本刻度 -->
      <g v-for="t in chart3XTicks" :key="'scx' + t.index">
        <line :x1="chart3X(t.index)" :y1="padT" :x2="chart3X(t.index)" :y2="padT + plotH" style="stroke: var(--fill-hover)" />
        <text :x="chart3X(t.index)" :y="scSvgH - 8" class="axis-label x-label" text-anchor="middle">{{ t.label }}</text>
      </g>
      <!-- 两条对比折线（图例可显隐；纵轴只按剩下的线缩放） -->
      <polyline v-if="scLegend.isVisible('A')" :points="scLineA" class="sc-line sc-line-a" />
      <polyline v-if="scLegend.isVisible('B')" :points="scLineB" class="sc-line sc-line-b" />
      <!-- 点 -->
      <g v-for="(p, i) in scPts" :key="'scp' + i">
        <circle
          v-if="scLegend.isVisible('A')"
          :cx="p.x" :cy="p.yA" r="4" :fill="SC_COLOR_A"
          :style="{ stroke: scHover === i ? 'var(--app-text-solid)' : 'var(--line-strong)' }"
          :stroke-width="scHover === i ? 2 : 1"
          class="trend-point"
        >
          <title>{{ p.mainName }}：{{ p.teamA.map(agentName).join('+') }}（{{ fmt(p.hpRatioA, 1) }}%）</title>
        </circle>
        <circle
          v-if="scLegend.isVisible('B')"
          :cx="p.x" :cy="p.yB" r="4" :fill="SC_COLOR_B"
          :style="{ stroke: scHover === i ? 'var(--app-text-solid)' : 'var(--line-strong)' }"
          :stroke-width="scHover === i ? 2 : 1"
          class="trend-point"
        >
          <title>{{ p.mainName }}：{{ p.teamB.map(agentName).join('+') }}（{{ fmt(p.hpRatioB, 1) }}%）</title>
        </circle>
      </g>
      <line
        v-if="scHover >= 0"
        :x1="scPts[scHover].x" :y1="padT"
        :x2="scPts[scHover].x" :y2="padT + plotH"
        class="hover-line"
      />
    </svg>

    <!-- 悬浮卡外壳见 components/ChartHoverCard.vue -->
    <ChartHoverCard
      v-if="scHover >= 0 && scHoverInfo"
      :x="scCardX"
      :y="scCardY"
      :title="`${scHoverInfo.nodeLabel} · ${scHoverInfo.mainName} + ${scHoverInfo.supportName}`"
      :rows="scHoverRows"
    />
  </div>
  <div v-else class="empty-hint small-hint">
    选对比槽位与两名角色后点「对比」：预设中「其余两槽相同、该槽位恰好一队 A 一队 B」的队伍
    按主C实装节点各连一条线，可直读哪个角色在哪个主C下更强（例：击破位对比琉音 vs 诺姆）。
    换右上角 Boss 看不同克制环境下的胜负变化。
  </div>

  <!-- 汇总表：每组 A/B 强度与胜负，直接回答「哪些队伍 A > B」 -->
  <div v-if="scPoints.length > 0" class="table-wrap sc-table">
    <table class="tl-table">
      <thead>
        <tr>
          <th>主C</th>
          <th>支援</th>
          <th>{{ agentName(scAgentA) }} 队伤害</th>
          <th>{{ agentName(scAgentB) }} 队伤害</th>
          <th>相对差值</th>
          <th>结论</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in scTableRows" :key="i">
          <td><span class="dot" :style="{ background: colorOf(r.mainId) }"></span>{{ agentName(r.mainId) }}</td>
          <td>{{ agentName(r.supportId) }}</td>
          <td>{{ compact(r.damageA) }}</td>
          <td>{{ compact(r.damageB) }}</td>
          <td :class="r.diff > 0 ? 'sc-diff-a' : r.diff < 0 ? 'sc-diff-b' : ''">{{ r.diff > 0 ? '+' : '' }}{{ fmt(r.diff, 1) }}%</td>
          <td :class="r.winner === 'A' ? 'sc-diff-a' : r.winner === 'B' ? 'sc-diff-b' : ''">{{ r.conclusion }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</n-card>
</template>

<script setup lang="ts">
/**
 * Chart 7「同槽位角色对比」（2026-09-14 从 TimeChartsPage 抽组件，143 行模板 + 115 行脚本）。
 *
 * 与 Chart 3 同型：`calc` 用 `useResourceCalc()` 在组件内取，布局/数据经 props 注入。
 * **组件内状态**（页面不关心）：槽位与 A/B 选择、卡片内 Boss 选择、跑批状态、图例显隐、悬浮。
 * **props 注入**：`bossOptions`（页面按各 Boss 最近出场排序）与 `selectedBossId`（顶部选择，
 * 用于「默认跟随顶部」的 watch）——两者留在页面是因为 Chart 1/2/4 与顶部控件也用它们。
 */
import { computed, ref, watch } from 'vue'
import { NButton, NCard, NProgress, NSelect } from 'naive-ui'
import { fmt, compact } from '@/utils/format'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useSeriesFilter } from '@/composables/seriesFilter'
import { hoverCardPosition, readSvgPointer } from '@/composables/svgPointer'
import { nearestIndexByX, xHitTolerance } from '@/composables/svgHitTest'
import { colorOf, slotCompareTableRows } from '@/composables/charts/agentPresentation'
import { runSlotCompareCompute } from '@/composables/charts/chartRunners'
import { slotCompareHoverRows as buildSlotCompareHoverRows } from '@/composables/charts/hoverCardRows'
import { buildSlotCompareHoverInfo } from '@/composables/charts/hoverInfoBuilders'
import ChartHoverCard, { type HoverCardRow } from '@/components/ChartHoverCard.vue'
import {
  buildScPts,
  linePointsOf,
  scYGridOf,
  scYLabelOf,
  scYRangeOf,
  versionXOf,
  versionXTicksOf,
} from '@/composables/versionChartGeometry'
import { type SlotComparePoint, type SlotCompareSlot } from '@/composables/teamTimeline'
import { VERSION_NODES, nodeIndexOf } from '@/data/versionTimeline'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'

const props = defineProps<{
  /** 布局宽度（页面 svgW） */
  svgW: number
  /** 绘图区左右留白 + 宽度（页面 TIMELINE_LAYOUT.padL / plotW） */
  padL: number
  padR: number
  plotW: number
  padT: number
  plotH: number
  /** Boss 下拉选项（页面按「最近一次出场」倒序） */
  bossOptions: Array<{ value: string; label: string }>
  /** 顶部所选 Boss（用于「卡片内 Boss 默认跟随顶部」） */
  selectedBossId: string
  /** 全部 Boss（卡片内按 id 自行解析，避免把整个页面数据面提成 prop） */
  bosses: BossPreset[]
  budget: number
  autoBuild: boolean
  optimalGold: boolean
}>()

const catalogStore = useCatalogStore()
const calc = useResourceCalc()
function agentName(id: string): string {
  return catalogStore.getAgent(id)?.name.zhCN ?? id
}

const SC_COLOR_A = 'var(--c-info)'
const SC_COLOR_B = 'var(--c-warning)'
const scSlot = ref<SlotCompareSlot>(1)
const scSlotOptions: Array<{ value: SlotCompareSlot; label: string }> = [
  { value: 0, label: '主C槽' },
  { value: 1, label: '击破槽' },
  { value: 2, label: '支援槽' },
]
const scAgentA = ref('1481') // 琉音（用户口径示例的对比对象之一）
const scAgentB = ref('1571') // 诺姆·霍洛维尔
const scComputing = ref(false)
const scProgress = ref<{ pct: number; text: string } | null>(null)
const scPoints = ref<SlotComparePoint[]>([])
const scSlotLabel = computed(() => scSlotOptions.find(o => o.value === scSlot.value)?.label ?? '')
/** 强队成员可选全部角色（S+A；A 级支援如苍角/妮可可作队友） */
const allAgentOptions = computed(() =>
  catalogStore.displayAgents.map(a => ({ value: a.id, label: `${a.name.zhCN ?? a.id}（${a.rarity}）` })),
)

// ---- 卡片内 Boss 选择（默认跟随顶部；手动改过后不再跟随） ----
const scBossId = ref('')
const scBossTouched = ref(false)
watch(() => props.selectedBossId, v => {
  if (!scBossTouched.value && v) scBossId.value = v
}, { immediate: true })
const scBoss = computed(() => props.bosses.find(b => b.id === scBossId.value) ?? null)
/** 与顶部 selectedPhase 同口径：取该 Boss 最新危局期，否则最新期 */
const scPhase = computed<BossPresetPhase | null>(() => {
  const b = scBoss.value
  if (!b) return null
  const sorted = [...b.phases].filter(p => p.begin).sort((x, y) => y.begin.localeCompare(x.begin))
  return sorted.find(p => p.modeType === 'critical_assault') ?? sorted[0] ?? b.phases[0] ?? null
})
const scBossName = computed(() => scBoss.value?.name ?? '—')

async function runSlotCompare() {
  // 校验/装配/调用已出函 composables/charts/chartRunners.ts#runSlotCompareCompute（第一片拆分，逐字搬迁）
  await runSlotCompareCompute({
    calc, computing: scComputing, progress: scProgress, points: scPoints,
    boss: scBoss.value,
    phase: scPhase.value,
    slot: scSlot.value,
    agentA: scAgentA.value,
    agentB: scAgentB.value,
    budget: props.budget,
    autoBuild: props.autoBuild,
    optimalGold: props.optimalGold,
  })
}

// ---- Chart 7 SVG（双折线：A 蓝 / B 橙，横轴 = 主C实装节点；纵轴 = 伤害自动刻度） ----
// Chart 7 几何：见 composables/versionChartGeometry.ts（与 Chart 3 共享版本轴）
const TB = { padT: props.padT, plotH: props.plotH }
const scSvgH = props.padT + props.plotH + 30
/** A/B 两线的显隐（图例可点；纵轴按**剩下的线**缩放 ⇒ 只看一队时那条线铺满全高更好读） */
const scLegend = useSeriesFilter(() => [
  { id: 'A', name: agentName(scAgentA.value) },
  { id: 'B', name: agentName(scAgentB.value) },
])
/** 纵轴贴合可见线的伤害范围（±8% 边距），不看 Boss 血量/击杀线，只看相对强弱 */
const scYRange = computed(() => scYRangeOf(scPoints.value.flatMap(p => [
  ...(scLegend.isVisible('A') ? [p.damageA] : []),
  ...(scLegend.isVisible('B') ? [p.damageB] : []),
])))
const scYGrid = computed(() => scYGridOf(scYRange.value, TB))
function scYLabel(i: number): string { return scYLabelOf(i, scYRange.value, compact) }
function chart3X(i: number): number { return versionXOf(i, VERSION_NODES.length, props.padL, props.plotW) }
const chart3XTicks = computed(() => versionXTicksOf(VERSION_NODES, 16))
const scPts = computed(() => buildScPts(scPoints.value, {
  nodeIndexOf: (id) => nodeIndexOf(id),
  range: scYRange.value,
  box: TB,
  padL: props.padL,
  plotW: props.plotW,
  versionTotal: VERSION_NODES.length,
}))
const scLineA = computed(() => linePointsOf(scPts.value, p => ({ x: p.x, y: p.yA })))
const scLineB = computed(() => linePointsOf(scPts.value, p => ({ x: p.x, y: p.yB })))
const scHover = ref(-1)
const scHoverInfo = computed(() =>
  buildSlotCompareHoverInfo(scPoints.value[scHover.value], {
    agentName,
    scAgentA: scAgentA.value,
    scAgentB: scAgentB.value,
  }))

const scHoverRows = computed<HoverCardRow[]>(() => buildSlotCompareHoverRows(scHoverInfo.value))
const scCardX = ref(0)
const scCardY = ref(0)
function onScMove(e: MouseEvent) {
  const { svgX, relX, relY, rect } = readSvgPointer(e, { w: props.svgW, h: scSvgH })
  const { index: best, distance: bestDist } = nearestIndexByX(scPts.value, svgX)
  if (best >= 0 && bestDist < xHitTolerance(props.plotW, VERSION_NODES.length, 2)) {
    scHover.value = best
    const card = hoverCardPosition({ relX, relY, containerWidth: rect.width, cardWidth: 260 })
    scCardX.value = card.x
    scCardY.value = card.y
  } else {
    scHover.value = -1
  }
}
/** 相对差值 = (A−B)/B × 100（伤害口径，不受 Boss 血量影响）；三态判据与文案见 agentPresentation */
const scTableRows = computed(() =>
  slotCompareTableRows(scPoints.value, {
    nameA: agentName(scAgentA.value),
    nameB: agentName(scAgentB.value),
  }),
)
</script>

<style scoped src="@/styles/chart-blocks.css"></style>
<style scoped src="../../views/timeCharts/slot-compare-chart.css"></style>
