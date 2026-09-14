<template>
  <n-card
    size="small"
    :bordered="true"
    title="限定S首次UP · 版本直伤系数（中心系数 = 支援突击伤害 / 标准值；支援突击通常不随角色改版，偏离即历代直伤膨胀档位）"
  >
    <!-- 档位筛选（点图例显隐；三档就是散点颜色的语义，与图例同一把尺） -->
    <div class="legend">
      <span class="legend-hint">点图例显隐档位</span>
      <div
        v-for="band in ddBandDefs"
        :key="band.id"
        class="legend-item"
        :class="{ off: !ddLegend.isVisible(band.id) }"
        :title="`${band.desc}：点击${ddLegend.isVisible(band.id) ? '隐藏' : '显示'}该档（Y 轴固定 0.7~1.3 档位口径，不随筛选缩放）`"
        @click="ddLegend.toggle(band.id)"
      >
        <span class="swatch" :style="{ background: band.color }"></span><span class="name">{{ band.label }}</span>
      </div>
    </div>
    <svg :width="svgW" :height="ddSvgH" class="dd-svg">
      <!-- 测试服节点阴影 -->
      <rect
        v-for="r in ddTestServerRects"
        :key="`ddts${r.x}`"
        :x="r.x"
        :y="ddPadT"
        :width="r.w"
        :height="ddPlotBottom - ddPadT"
        fill="rgba(246, 173, 85, 0.06)"
      />
      <!-- 版本分隔网格 + 版本号刻度（网格线在版本列左缘，刻度文字在列中心） -->
      <g v-for="t in ddXTicks" :key="`ddx${t.index}`">
        <line :x1="ddX(t.index)" :y1="ddPadT" :x2="ddX(t.index)" :y2="ddPlotBottom" style="stroke: var(--wa-60)" />
        <text :x="ddTickCenterX(t.index)" :y="ddPlotBottom + 14" text-anchor="middle" class="dd-tick">{{ t.label }}</text>
      </g>
      <!-- y 刻度 -->
      <text v-for="t in ddYTicks" :key="`ddy${t}`" :x="ddPadL - 6" :y="ddY(t) + 4" text-anchor="end" class="dd-tick">
        {{ Math.round(t * 100) }}%
      </text>
      <!-- 100% 基准线 -->
      <line
        :x1="ddPadL"
        :y1="ddY(1)"
        :x2="svgW - ddPadR"
        :y2="ddY(1)"
        style="stroke: var(--wa-280)"
        stroke-dasharray="4 4"
      />
      <text :x="svgW - ddPadR - 2" :y="ddY(1) - 5" text-anchor="end" class="dd-baseline">100% 标准</text>
      <!-- 散点（按档位筛选：隐藏档不画；标签槽位仍按全量算 ⇒ 不因筛选而重排） -->
      <g v-for="p in ddVisiblePoints" :key="`ddp${p.agentId}`">
        <circle
          v-if="p.value != null"
          :cx="ddCX(p.nodeIndex) + ddJitter(p.agentId)"
          :cy="ddY(p.value)"
          r="4"
          :style="{ fill: ddColor(p.value) }"
        >
          <title>{{ p.agentName }}（{{ p.nodeLabel }}{{ p.nodeNote ? '，' + p.nodeNote : '' }}）：{{ (p.value * 100).toFixed(1) }}%</title>
        </circle>
        <text
          v-if="p.value != null && ddNeedLabel(p.value)"
          :x="ddCX(p.nodeIndex) + ddJitter(p.agentId)"
          :y="ddLabelY(p)"
          text-anchor="middle"
          class="dd-label"
        >{{ ddShortName(p.agentName) }}</text>
      </g>
    </svg>
    <div class="dd-caption">
      每点 = 一位限定S在其首次 UP 节点的支援突击伤害比值。灰 ≈100%（无直伤特调）、蓝 &gt;105%（当期加强档）、橙 &lt;95%；悬停看数值。3.2 阴影为测试服数据；常驻 S 与 A 级不参与。演算口径见「倍率系数记录」页。
    </div>
  </n-card>
</template>

<script setup lang="ts">
/**
 * 「限定S首次UP × 版本直伤系数」图（2026-09-14 从 TimeChartsPage 抽组件）。
 *
 * 为什么现在能抽（T11 报告曾列为「同因被 scoped 挡住」）：本图用的 `dd-*` 5 个类
 * （`dd-svg`/`dd-tick`/`dd-label`/`dd-baseline`/`dd-caption`）此前定义在页面 scoped 样式里，
 * scoped 不作用到子组件元素 ⇒ 抽组件会掉样式。本轮先做了**图表样式收敛**（6 个跨页类 →
 * `styles/charts.css`），顺带确认这 5 个 `dd-*` 类是**本图独占**（全页仅 `dd-caption` 被
 * Chart 5 复用作通用说明文字样式——故组件内自带一份同名 `.dd-caption`，页面那份留给 Chart 5；
 * 两份内容一致）。
 *
 * 组件只做渲染：几何/标度来自 `composables/directDamageChart.ts`（已有单测），
 * 数据 `points` 由父组件传入。筛选状态（`useSeriesFilter`）是**组件内状态**——
 * 与本图语义绑定，父组件不关心。
 */
import { computed } from 'vue'
import { NCard } from 'naive-ui'
import { useSeriesFilter } from '@/composables/seriesFilter'
import { VERSION_NODES } from '@/data/versionTimeline'
import {
  DD_BAND_DEFS,
  DD_CHART_LAYOUT,
  buildDirectDamageChart,
  ddBandOf,
  ddColor,
  ddJitter,
  ddNeedLabel,
  ddShortName,
} from '@/composables/directDamageChart'
import type { DirectDamagePoint } from '@/composables/multiplierCoefficients'

const props = defineProps<{
  /** 直伤系数时间线（父组件算：buildDirectDamageTimeline） */
  points: DirectDamagePoint[]
  /** 图宽（父组件的响应式 svgW） */
  svgW: number
}>()

const dd = computed(() => buildDirectDamageChart({
  points: props.points,
  svgW: props.svgW,
  versionNodes: VERSION_NODES,
}))

const { padL: ddPadL, padR: ddPadR, padT: ddPadT, svgH: ddSvgH } = DD_CHART_LAYOUT
const ddPlotBottom = DD_CHART_LAYOUT.svgH - DD_CHART_LAYOUT.padB
const ddYTicks = computed(() => dd.value.yTicks)
function ddX(nodeIndex: number): number { return dd.value.x(nodeIndex) }
function ddCX(nodeIndex: number): number { return dd.value.cx(nodeIndex) }
function ddTickCenterX(firstIndex: number): number { return dd.value.tickCenterX(firstIndex) }
function ddY(v: number): number { return dd.value.y(v) }
const ddXTicks = computed(() => dd.value.xTicks)
const ddTestServerRects = computed(() => dd.value.testServerRects)
function ddLabelY(p: DirectDamagePoint): number { return dd.value.labelY(p) }

const ddBandDefs = DD_BAND_DEFS
const ddLegend = useSeriesFilter(() => ddBandDefs.map(b => ({ id: b.id, name: b.label })))
/** 可见点（图上画什么）；注意 ddLabelSlots 仍按全量算，筛选不改变标签槽位分配 */
const ddVisiblePoints = computed(() =>
  props.points.filter(p => p.value == null || ddLegend.isVisible(ddBandOf(p.value))))

// ddJitter / ddColor / ddNeedLabel / ddShortName / ddBandOf 直接来自模块（名字与模板绑定一致，无需包装）

</script>

<style scoped>
/* 图例类（.legend/.legend-item/.legend-hint/.legend-action/.swatch/.name）是**跨块共享**的，
   从 TimeChartsPage.css 整段复制（scoped 不作用到子组件；页面那份保留给其他块）。
   ⚠ 漏掉这几个类会让图例退化成竖排（实测：legend 高度 19px → 83px，整卡 +54px）。 */
.legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  margin-bottom: 10px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
}
.swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex: 0 0 auto;
}
.legend-hint {
  font-size: 12px;
  color: var(--fg-3);
}
.legend-action {
  cursor: pointer;
  border-bottom: 1px dashed var(--line-strong);
}

/* 逐字复制自 views/timeCharts/TimeChartsPage.css 的本图独占类（scoped 不作用到子组件 ⇒ 必须随组件走）。
   ⚠ `.dd-caption` 在页面里被 Chart 5 复用作通用说明文字样式，故页面那份保留（两份内容一致）。
   复制方式 = 按顶层规则块整段搬运（不是手抄），保证零视觉 delta。 */
.dd-svg {
  display: block;
  max-width: 100%;
}
.dd-tick {
  fill: var(--wa-450);
  font-size: 10px;
}
.dd-baseline {
  fill: var(--wa-600);
  font-size: 10px;
}
.dd-label {
  fill: var(--wa-820);
  font-size: 10px;
  paint-order: stroke;
  stroke: rgba(10, 10, 14, 0.85);
  stroke-width: 3px;
}
.dd-caption {
  margin-top: 6px;
  color: var(--wa-500);
  font-size: 11.5px;
  line-height: 1.7;
}
</style>
