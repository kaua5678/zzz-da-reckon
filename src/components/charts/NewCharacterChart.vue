<template>
<n-card size="small" :bordered="true">
  <template #header>
    每期新角色 · 强队强度
    <span class="chart-subtitle">横轴 = 版本（卡池期）；点 = 当期新 S 角色的强队（纯用户手填展示，同角色可加多队对比；按当前全部已实装 + 所选金数配装）</span>
  </template>
  <template #header-extra>
    <div class="chart3-actions">
      <span class="ctl-label">未配置强队的角色不出点</span>
      <n-button size="small" type="primary" :loading="chart3Computing" @click="runChart3">
        {{ chart3Points.length > 0 ? '重新计算强队图' : '计算强队图' }}
      </n-button>
    </div>
  </template>

  <!-- 强队清单（版本 → 新角色 → 强队列表；同角色多队 = 同一时间点多点展示） -->
  <div class="table-wrap chart3-list">
    <table class="tl-table">
      <thead>
        <tr>
          <th>版本</th>
          <th>当期新角色</th>
          <th>强队（每支 = 主C + 队友1 + 队友2；可添加多支）</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in chart3Rows" :key="row.charId">
          <td>
            {{ row.nodeLabel }}
            <span v-if="row.nodeNote" class="node-note" :title="row.nodeNote">{{ row.nodeNote }}</span>
          </td>
          <td>
            <span class="dot" :style="{ background: colorOf(row.charId) }"></span>{{ agentName(row.charId) }}
          </td>
          <td class="chart3-teams-cell">
            <div v-for="(team, ti) in chart3Teams[row.charId]" :key="ti" class="team-cell chart3-team-inputs">
              <span class="team-no">{{ ti + 1 }}</span>
              <n-select
                v-model:value="team[0]"
                :options="allAgentOptions"
                size="tiny"
                filterable
                style="width: 118px"
                placeholder="主C"
              />
              <n-select
                v-model:value="team[1]"
                :options="allAgentOptions"
                size="tiny"
                filterable
                style="width: 118px"
                placeholder="队友1"
              />
              <n-select
                v-model:value="team[2]"
                :options="allAgentOptions"
                size="tiny"
                filterable
                style="width: 118px"
                placeholder="队友2"
              />
              <n-button size="tiny" quaternary @click="removeChart3Team(row.charId, ti)">✕</n-button>
            </div>
            <n-button size="tiny" quaternary dashed class="add-team-btn" @click="addChart3Team(row.charId)">＋ 添加队伍</n-button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- 强队强度散点 -->
  <div v-if="chart3Points.length > 0" class="timeline-wrap chart3-plot">
    <svg
      :viewBox="`0 0 ${svgW} ${chart3SvgH}`"
      class="timeline-svg"
      @mousemove="onChart3Move"
      @mouseleave="chart3Hover = -1"
    >
      <g v-for="(y, i) in chart3YGrid" :key="'c3g' + i">
        <line :x1="padL" :x2="svgW - padR" :y1="y" :y2="y" class="grid-line" />
        <text :x="padL - 8" :y="y + 3" class="axis-label" text-anchor="end">{{ chart3YLabel(i) }}%</text>
      </g>
      <!-- 100% 击杀线 -->
      <line :x1="padL" :y1="yOf3(100)" :x2="svgW - padR" :y2="yOf3(100)" class="kill-line-ref" />
      <text :x="svgW - padR - 2" :y="yOf3(100) - 5" class="axis-label" text-anchor="end">100% 击杀线</text>
      <!-- X 轴版本刻度 -->
      <g v-for="t in chart3XTicks" :key="'c3x' + t.index">
        <line :x1="chart3X(t.index)" :y1="padT" :x2="chart3X(t.index)" :y2="padT + plotH" style="stroke: var(--wa-60)" />
        <text :x="chart3X(t.index)" :y="chart3SvgH - 8" class="axis-label x-label" text-anchor="middle">{{ t.label }}</text>
      </g>
      <!-- 点 -->
      <g v-for="(p, i) in chart3Pts" :key="'c3p' + i">
        <circle
          :cx="p.x"
          :cy="p.y"
          r="4.5"
          :fill="p.color"
          :style="{ stroke: chart3Hover === i ? 'var(--app-text-solid)' : 'var(--wa-250)' }"
          :stroke-width="chart3Hover === i ? 2 : 1"
          class="trend-point"
        >
          <title>{{ p.charName }}：{{ p.teamNames.join('+') }}（{{ fmt(p.hpRatio, 1) }}%）</title>
        </circle>
      </g>
      <line
        v-if="chart3Hover >= 0"
        :x1="chart3Pts[chart3Hover].x" :y1="padT"
        :x2="chart3Pts[chart3Hover].x" :y2="padT + plotH"
        class="hover-line"
      />
    </svg>

    <!-- 图例（点击显隐某支队；隐藏队的点不画，且退出 Y 轴刻度与悬浮命中——筛选传导到派生量） -->
    <div class="legend">
      <span class="legend-hint">点图例显隐 · 显示 {{ chart3Counts.visible }}/{{ chart3Counts.total }} 支队</span>
      <div
        v-for="s in chart3Series"
        :key="s.id"
        class="legend-item"
        :class="{ off: !chart3Legend.isVisible(s.id) }"
        :title="`${s.name}：点击${chart3Legend.isVisible(s.id) ? '隐藏' : '显示'}（隐藏后不参与 Y 轴刻度）`"
        @click="chart3Legend.toggle(s.id)"
      >
        <span class="swatch" :style="{ background: colorOf(s.id) }"></span>
        <span class="name">{{ s.name }}</span>
      </div>
      <span class="legend-hint legend-action" @click="chart3Legend.showAll()">全显示</span>
    </div>

    <!-- 悬浮卡外壳见 components/ChartHoverCard.vue -->
    <ChartHoverCard
      v-if="chart3Hover >= 0 && chart3HoverInfo"
      :x="chart3CardX"
      :y="chart3CardY"
      :title="`${chart3HoverInfo.nodeLabel} · ${chart3HoverInfo.charName} · 第${chart3HoverInfo.teamNo}队`"
      :rows="chart3HoverRows"
    />
  </div>
  <div v-else class="empty-hint small-hint">
    为角色配置强队（手填三人或点「引擎建议」）后点「计算强队图」；预填 = 仓库 preset 队伍。
  </div>

  <!-- 进度条 -->
  <div v-if="chart3Computing || chart3Progress" class="chart-progress">
    <n-progress
      type="line"
      :percentage="Math.round((chart3Progress?.pct ?? 0) * 100)"
      :show-indicator="false"
      :height="6"
    />
    <span class="progress-text">{{ chart3Progress?.text ?? '' }}</span>
  </div>
</n-card>
</template>

<script setup lang="ts">
/**
 * Chart 3「每期新角色 · 强队强度」（2026-09-14 从 TimeChartsPage 抽组件，153 行模板 + 90 行脚本）。
 *
 * 与 Chart 5 同型：`calc` 用 `useResourceCalc()` 在组件内取（它是 pinia store 的无状态包装，
 * 任何组件调用都拿到同一份 store —— 已在本文件注释中确认），其余是标量 props。
 * 强队清单 `chart3Teams` 是**组件内状态**（用户手填，与图语义绑定），页面不关心。
 *
 * 样式：共享基元走 `styles/chart-blocks.css`，本图独占的 `.chart3-*`/`.team-*` 走
 * `views/timeCharts/new-character-chart.css`，两者都以 scoped src 载入（特异性不变）。
 */
import { computed, ref } from 'vue'
import { NButton, NCard, NSelect } from 'naive-ui'
import { fmt } from '@/utils/format'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useSeriesFilter } from '@/composables/seriesFilter'
import { readSvgPointer } from '@/composables/svgPointer'
import { nearestIndexByX, xHitTolerance } from '@/composables/svgHitTest'
import { hoverCardPosition } from '@/composables/svgPointer'
import { colorOf } from '@/composables/charts/agentPresentation'
import { runChart3Compute } from '@/composables/charts/chartRunners'
import { chart3HoverRows as buildChart3HoverRows } from '@/composables/charts/hoverCardRows'
import ChartHoverCard, { type HoverCardRow } from '@/components/ChartHoverCard.vue'
import {
  buildChart3Scatter,
  chart3YGridOf,
  chart3YLabelOf,
  chart3YMaxOf,
  chart3YOf,
  versionXTicksOf,
  versionXOf,
} from '@/composables/versionChartGeometry'
import {
  buildNewCharacterRows,
  prefillStrongTeamsFromPresets,
  type NewCharacterPoint,
  type NewCharacterRow,
} from '@/composables/teamTimeline'
import { VERSION_NODES, nodeIndexOf } from '@/data/versionTimeline'
import { TIMELINE_LAYOUT } from '@/composables/timelineChart'
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
  boss: BossPreset | null
  phase: BossPresetPhase | null
  budget: number
  autoBuild: boolean
  optimalGold: boolean
}>()

const catalogStore = useCatalogStore()
const calc = useResourceCalc()
function agentName(id: string): string {
  return catalogStore.getAgent(id)?.name.zhCN ?? id
}

const chart3Rows = computed<NewCharacterRow[]>(() => buildNewCharacterRows())
/** 强队清单：charId → 强队列表（每支 3 人；同角色多队 = 同一时间点多点展示；空数组 = 不出点）；预填口述预设 */
const chart3Teams = ref<Record<string, [string, string, string][]>>(initChart3Teams())
function initChart3Teams(): Record<string, [string, string, string][]> {
  const out: Record<string, [string, string, string][]> = {}
  const prefill = prefillStrongTeamsFromPresets()
  for (const row of buildNewCharacterRows()) out[row.charId] = prefill[row.charId] ? [prefill[row.charId]] : []
  return out
}
function addChart3Team(charId: string) {
  chart3Teams.value[charId].push(['', '', ''])
}
function removeChart3Team(charId: string, index: number) {
  chart3Teams.value[charId].splice(index, 1)
}
/** 强队成员可选全部角色（S+A；A 级支援如苍角/妮可可作队友） */
const allAgentOptions = computed(() =>
  catalogStore.displayAgents.map(a => ({ value: a.id, label: `${a.name.zhCN ?? a.id}（${a.rarity}）` })),
)

const chart3Computing = ref(false)
const chart3Progress = ref<{ pct: number; text: string } | null>(null)
const chart3Points = ref<NewCharacterPoint[]>([])
async function runChart3() {
  // 校验/装配/调用已出函 composables/charts/chartRunners.ts#runChart3Compute（第一片拆分，逐字搬迁）
  await runChart3Compute({
    calc, computing: chart3Computing, progress: chart3Progress, points: chart3Points,
    boss: props.boss,
    phase: props.phase,
    rows: chart3Rows.value,
    teams: chart3Teams.value,
    budget: props.budget,
    autoBuild: props.autoBuild,
    optimalGold: props.optimalGold,
  })
}

// ---- Chart 3 SVG ----
// Chart 3 几何：见 composables/versionChartGeometry.ts（纯函数，可单测）
const TB = { padT: props.padT, plotH: props.plotH }
const chart3SvgH = computed(() => props.padT + props.plotH + 30)
const chart3YMax = computed(() => chart3YMaxOf(chart3VisiblePts.value.map(p => p.hpRatio)))
function yOf3(v: number): number { return chart3YOf(v, chart3YMax.value, TB) }
const chart3YGrid = computed(() => chart3YGridOf(chart3YMax.value, TB))
function chart3YLabel(i: number): number { return chart3YLabelOf(i, chart3YMax.value) }
function chart3X(i: number): number { return versionXOf(i, VERSION_NODES.length, props.padL, props.plotW) }
const chart3XTicks = computed(() => versionXTicksOf(VERSION_NODES, 16))
/** Chart 3 图例系列 = 队伍构成（与散点颜色同一把钥匙：同队同色、跨角色同一条图例） */
const chart3Series = computed(() => {
  const seen = new Map<string, string>()
  for (const p of chart3Points.value) {
    const key = p.team.join(',')
    if (!seen.has(key)) seen.set(key, p.team.map(agentName).join(' + '))
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }))
})
const chart3Legend = useSeriesFilter(() => chart3Series.value)
const chart3Counts = chart3Legend.counts
/** 可见散点（Y 轴刻度、散点、悬浮命中三者同源 ⇒ 隐藏高值队后轴跟着降） */
const chart3VisiblePts = computed(() => chart3Points.value.filter(p => chart3Legend.isVisible(p.team.join(','))))
const chart3Pts = computed(() => buildChart3Scatter({
  points: chart3VisiblePts.value,
  nodeIndexOf: (id) => nodeIndexOf(id),
  yMax: chart3YMax.value,
  box: TB,
  padL: props.padL,
  plotW: props.plotW,
  versionTotal: VERSION_NODES.length,
  colorOf: (key) => colorOf(key),
  nameOf: (id) => agentName(id),
}))
const chart3Hover = ref(-1)
const chart3HoverInfo = computed(() => chart3Pts.value[chart3Hover.value] ?? null)
const chart3HoverRows = computed<HoverCardRow[]>(() => buildChart3HoverRows(chart3HoverInfo.value))
const chart3CardX = ref(0)
const chart3CardY = ref(0)
function onChart3Move(e: MouseEvent) {
  const { svgX, relX, relY, rect } = readSvgPointer(e, { w: props.svgW, h: chart3SvgH.value })
  const { index: best, distance: bestDist } = nearestIndexByX(chart3Pts.value, svgX)
  if (best >= 0 && bestDist < xHitTolerance(props.plotW, VERSION_NODES.length, 2)) {
    chart3Hover.value = best
    const card = hoverCardPosition({ relX, relY, containerWidth: rect.width, cardWidth: 240 })
    chart3CardX.value = card.x
    chart3CardY.value = card.y
  } else {
    chart3Hover.value = -1
  }
}
void TIMELINE_LAYOUT
</script>

<style scoped src="@/styles/chart-blocks.css"></style>
<style scoped src="../../views/timeCharts/new-character-chart.css"></style>
