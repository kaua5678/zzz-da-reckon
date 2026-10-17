<template>
  <div class="sg-grid">
    <div
      v-for="panel in panels"
      :key="panel.id"
      class="sg-panel"
      :class="{ selected: panel.id === selectedId }"
      role="button"
      tabindex="0"
      :aria-pressed="panel.id === selectedId"
      @click="emit('select', panel.id)"
      @keydown.enter="emit('select', panel.id)"
    >
      <div class="sg-panel-title">{{ panel.label }}</div>
      <svg :viewBox="viewBox" class="sg-svg" role="img" :aria-label="panel.label">
        <g v-for="(y, i) in yGrid" :key="'g' + i">
          <line :x1="padL" :x2="W - padR" :y1="y" :y2="y" class="sg-grid-line" />
          <text :x="padL - 6" :y="y + 3" class="sg-axis-label" text-anchor="end">{{ yLabel(i) }}</text>
        </g>
        <g v-for="(lv, i) in levels" :key="'x' + i">
          <text
            :x="levelX(i)"
            :y="H - 8"
            class="sg-axis-label"
            :text-anchor="rotateLabels ? 'end' : 'middle'"
            :transform="labelTransform(levelX(i), H - 8)"
          >{{ shortLabel(lv.label) }}</text>
        </g>
        <g v-for="line in linesOf(panel)" :key="line.id">
          <polyline
            v-for="(seg, si) in line.segs"
            :key="si"
            :points="seg"
            class="sg-line"
            :style="{ stroke: colorOf(line.id) }"
          />
          <circle
            v-for="pt in line.pts"
            :key="pt.i"
            :cx="pt.x"
            :cy="pt.y"
            r="3"
            class="sg-point"
            :style="{ fill: colorOf(line.id) }"
          >
            <title>{{ line.label }} · {{ levelLabel(pt.i) }}：{{ pt.text }}</title>
          </circle>
        </g>
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 多重二维切片（small multiples）：一片一个 2D 折线图，**纵轴共用一把尺**。
 *
 * 为什么必须共用纵轴（而不是每片各自缩放）：切片的目的就是「某些变量情况下直接比高低」——
 * 各自缩放的片会让「2 命比 0 命低」画成一样高，是比单张图更隐蔽的错读。纵轴几何复用
 * versionChartGeometry（与自由对比单图 / 时间图表页同口径）。
 *
 * 纯展示：只读 props，不碰 store、不求值。null（无读数）断开折线而不是落到轴底（后者会被读成一个值）。
 */
import { computed } from 'vue'
import { scGridStartOf, scYGridOf, scYOf, scYRangeOf, scYStepOf } from '@/composables/versionChartGeometry'

interface SliceSeries {
  id: string
  label: string
  values: ReadonlyArray<number | null>
}
interface SlicePanel {
  id: string
  label: string
  series: ReadonlyArray<SliceSeries>
}

const props = defineProps<{
  levels: ReadonlyArray<{ label: string }>
  panels: ReadonlyArray<SlicePanel>
  colorOf: (seriesId: string) => string
  format: (v: number) => string
  /** 面板高度（px，含轴标签）；默认 170 */
  height?: number
  /** 当前选中的切片 id（高亮 + 作为表格/折线的当前片） */
  selectedId?: string | null
}>()

const emit = defineEmits<{ select: [id: string] }>()

const W = 320
const padL = 46
const padR = 12
const padT = 12
const padB = 38

const H = computed(() => props.height ?? 170)
const viewBox = computed(() => '0 0 ' + W + ' ' + H.value)
const plotH = computed(() => H.value - padT - padB)
const plotBox = computed(() => ({ padT, plotH: plotH.value }))

/** 纵轴范围：**全部切片**的有限值（共用尺；隐藏系列已在页面侧过滤掉） */
const yRange = computed(() => scYRangeOf(
  props.panels
    .flatMap(panel => panel.series.flatMap(s => s.values))
    .filter((v): v is number => v !== null && Number.isFinite(v)),
))
const yGrid = computed(() => scYGridOf(yRange.value, plotBox.value))
const rotateLabels = computed(() =>
  props.levels.length > 5 || props.levels.some(l => [...l.label].length > 4),
)

function yOf(v: number): number {
  return scYOf(v, yRange.value, plotBox.value)
}
function yLabel(i: number): string {
  const step = scYStepOf(yRange.value)
  return props.format(scGridStartOf(yRange.value, step) + i * step)
}
function levelX(i: number): number {
  const n = props.levels.length
  if (n <= 1) return padL + (W - padL - padR) / 2
  return padL + (i / (n - 1)) * (W - padL - padR)
}
function labelTransform(x: number, y: number): string | undefined {
  return rotateLabels.value ? 'rotate(-32 ' + x + ' ' + y + ')' : undefined
}
function shortLabel(label: string): string {
  const chars = [...label]
  return chars.length > 10 ? chars.slice(0, 9).join('') + '…' : label
}
function levelLabel(i: number): string {
  return props.levels[i]?.label ?? ''
}

interface GridPoint { i: number; x: number; y: number; text: string }
interface GridLine { id: string; label: string; segs: string[]; pts: GridPoint[] }

function linesOf(panel: SlicePanel): GridLine[] {
  return panel.series.map(s => {
    const pts: GridPoint[] = []
    const segs: string[] = []
    let cur: string[] = []
    s.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        if (cur.length > 0) { segs.push(cur.join(' ')); cur = [] }
        return
      }
      const x = levelX(i)
      const y = yOf(v)
      pts.push({ i, x, y, text: props.format(v) })
      cur.push(x + ',' + y)
    })
    if (cur.length > 0) segs.push(cur.join(' '))
    return { id: s.id, label: s.label, segs, pts }
  })
}
</script>

<style scoped>
.sg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 10px;
}
.sg-panel {
  min-width: 0;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  padding: 6px 8px 2px;
  background: var(--app-panel);
  cursor: pointer;
}
.sg-panel.selected {
  border-color: var(--c-success);
  box-shadow: 0 0 0 1px var(--c-success-soft) inset;
}
.sg-panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--app-text);
  margin-bottom: 2px;
}
.sg-svg {
  width: 100%;
  height: auto;
  display: block;
}
.sg-grid-line {
  stroke: var(--line);
  stroke-width: 1;
}
.sg-axis-label {
  font-size: 10px;
  fill: var(--fg-3);
}
.sg-line {
  fill: none;
  stroke-width: 2;
}
.sg-point {
  stroke: var(--line-strong);
  stroke-width: 0.6;
}
</style>
