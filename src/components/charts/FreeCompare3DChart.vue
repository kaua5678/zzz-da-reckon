<template>
  <div class="fc3d-root">
    <div class="fc3d-toolbar">
      <span class="fc3d-hint">拖动旋转 · 滚轮缩放 · 悬停看档位</span>
      <div class="fc3d-btns">
        <button class="fc3d-btn" :class="{ active: view === 'iso' }" @click="setView('iso')">斜视</button>
        <button class="fc3d-btn" :class="{ active: view === 'front' }" @click="setView('front')">正视（切片×值）</button>
        <button class="fc3d-btn" :class="{ active: view === 'side' }" @click="setView('side')">侧视（x×值）</button>
        <button class="fc3d-btn" @click="setView('iso')">重置</button>
      </div>
    </div>
    <div
      ref="wrapRef"
      class="fc3d-canvas-wrap"
      @mousedown="onDown"
      @mousemove="onMove"
      @mouseleave="onLeave"
      @wheel.prevent="onWheel"
      @click="onClick"
    >
      <canvas ref="canvasRef" class="fc3d-canvas" />
      <div v-if="hover" class="fc3d-tip" :style="{ left: hover.px + 12 + 'px', top: hover.py + 12 + 'px' }">
        <div v-for="(line, i) in hover.lines" :key="i">{{ line }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 自由对比 · 3D 图（x × 切片 × 指标）：把「多重二维切片」叠成三维折线阵。
 *
 * 口径：
 * - x 轴 = 自由对比的 x 维度档位；深度轴 = 切片档位；z 轴 = y 指标（与切片网格**同一把尺**：
 *   取全部有限值的 scYRangeOf，不按片/按线归一化，否则片间高低不可比）；
 * - 每条线 = 一个系列在**一个切片**里的 x 曲线（同系列同色，靠深度区分片）；
 * - 纯 canvas 2D 自绘（复用 composables/difficultyCurve3d#project3d 的正交投影，不引 WebGL），
 *   只读 props、不碰 store；主题色一律走 utils/canvasTheme.ts（CC-348 源码锁）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { project3d, type Camera3D } from '@/composables/difficultyCurve3d'
import { scGridStartOf, scYRangeOf, scYStepOf } from '@/composables/versionChartGeometry'
import { themeReader, withAlpha } from '@/utils/canvasTheme'
import { useCanvasScene } from '@/composables/charts/useCanvasScene'

interface Series3D {
  id: string
  label: string
  /** 外层 = 切片下标，内层 = x 档位下标；缺读数为 null */
  values: ReadonlyArray<ReadonlyArray<number | null>>
}

const props = defineProps<{
  levels: ReadonlyArray<{ label: string }>
  slices: ReadonlyArray<{ id: string; label: string }>
  series: ReadonlyArray<Series3D>
  colorOf: (seriesId: string) => string
  format: (v: number) => string
  xLabel: string
  sliceLabel: string
  zLabel: string
  /** 当前选中的切片 id（加粗/提亮；其余片降透明度） */
  selectedSliceId?: string | null
}>()

const emit = defineEmits<{ selectSlice: [id: string] }>()

const BOX = { x: 1.35, y: 0.72, z: 0.66 }
const cam = ref<Camera3D>({ yaw: 36, pitch: 22, zoom: 1 })
const view = ref<'iso' | 'front' | 'side' | 'custom'>('iso')
const hover = ref<{ px: number; py: number; lines: string[] } | null>(null)
const wrapRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
/** 共享 canvas 场景壳：DPR/尺寸/ResizeObserver/主题重绘都由它管 */
const scene = useCanvasScene({ wrapRef, canvasRef, render: drawFrame })
const size = scene.size
const requestRender = scene.requestRender

interface ProjectedPoint {
  sx: number
  sy: number
  seriesId: string
  sliceIdx: number
  levelIdx: number
  value: number
}
let projectedPts: ProjectedPoint[] = []

/** z 轴共用一把尺：全部切片的有限值（空 = 只画网格） */
const zRange = computed(() => scYRangeOf(
  props.series
    .flatMap(s => s.values.flat())
    .filter((v): v is number => v !== null && Number.isFinite(v)),
))

function toScreen(x: number, y: number, z: number) {
  const p = project3d(x, y, z, cam.value, BOX)
  const scale = Math.min(size.w * 0.62, size.h * 0.88) * cam.value.zoom
  return {
    sx: size.w / 2 + p.sx * scale,
    sy: size.h / 2 + 14 + p.sy * scale,
  }
}

function clip(text: string, max: number): string {
  const chars = [...text]
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : text
}

function setView(v: 'iso' | 'front' | 'side') {
  view.value = v
  cam.value = v === 'iso'
    ? { yaw: 36, pitch: 22, zoom: 1 }
    : v === 'front'
      ? { yaw: 0, pitch: 6, zoom: 1.02 }
      : { yaw: 90, pitch: 6, zoom: 1.32 }
}

function drawFrame(ctx: CanvasRenderingContext2D) {
  projectedPts = []

  const theme = themeReader()
  const ink = (a: number) => 'rgba(' + theme('--scene-ink-rgb') + ', ' + a + ')'
  const dim = theme('--scene-ink-dim')
  const axisX = theme('--scene-axis-x')
  const axisY = theme('--scene-axis-y')
  const axisZ = theme('--scene-axis-z')

  const levels = props.levels
  const slices = props.slices
  const n = levels.length
  const m = slices.length
  const xAt = (i: number) => (n <= 1 ? 0.5 : i / (n - 1))
  const yAt = (j: number) => (m <= 1 ? 0.5 : j / (m - 1))
  const range = zRange.value
  const span = Math.max(1e-9, range.max - range.min)
  const zAt = (v: number) => (v - range.min) / span

  const line3 = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, color: string, width: number) => {
    const a = toScreen(x1, y1, z1)
    const b = toScreen(x2, y2, z2)
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(a.sx, a.sy)
    ctx.lineTo(b.sx, b.sy)
    ctx.stroke()
  }

  // ---- 地板与竖棱 ----
  const corners: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]]
  /**
   * z 轴放在**屏幕最左**的地板角（yaw 旋转后最左角会变）。
   * 为什么不是固定 (0,0)：斜视下 (0,0) 投影在盒内，z 刻度会压在折线/切片刻度上；
   * 最左角在盒外，刻度直接落在左侧留白里（实机 2026-10-17 截图核对）。
   */
  const zCorner = corners.reduce((best, c) => (
    toScreen(c[0], c[1], 0).sx < toScreen(best[0], best[1], 0).sx ? c : best
  ), corners[0])
  ctx.beginPath()
  for (let i = 0; i < corners.length; i++) {
    const c = corners[i]
    const p = toScreen(c[0], c[1], 0)
    if (i === 0) ctx.moveTo(p.sx, p.sy)
    else ctx.lineTo(p.sx, p.sy)
  }
  ctx.closePath()
  ctx.strokeStyle = ink(0.42)
  ctx.lineWidth = 1
  ctx.stroke()
  for (const c of corners) {
    line3(c[0], c[1], 0, c[0], c[1], 1, ink(0.14), 1)
  }

  // ---- 网格：x 档位 × 切片道 × z 刻度 ----
  const xEvery = Math.max(1, Math.ceil(n / 9))
  for (let i = 0; i < n; i += xEvery) {
    line3(xAt(i), 0, 0, xAt(i), 1, 0, ink(0.13), 1)
  }
  const yEvery = Math.max(1, Math.ceil(m / 12))
  for (let j = 0; j < m; j += yEvery) {
    line3(0, yAt(j), 0, 1, yAt(j), 0, ink(0.13), 1)
  }
  const zStep = scYStepOf(range)
  const zStart = scGridStartOf(range, zStep)
  ctx.font = '10px sans-serif'
  for (let v = zStart; v <= range.max + 1e-9; v += zStep) {
    const z = zAt(v)
    line3(0, 0, z, 1, 0, z, ink(0.09), 1)
    line3(0, 0, z, 0, 1, z, ink(0.07), 1)
    const p = toScreen(zCorner[0], zCorner[1], z)
    const floor = toScreen(zCorner[0], zCorner[1], 0)
    // 地板刻度与「最左道」的切片刻度同点：跳过，避免叠字（其余刻度已给出读数锚）
    if (Math.abs(p.sy - floor.sy) <= 10) continue
    ctx.fillStyle = dim
    ctx.textAlign = 'right'
    ctx.fillText(props.format(v), p.sx - 8, p.sy + 3)
  }

  // ---- 坐标轴（前端 x / 左端切片 / 最左角 z）----
  line3(0, 0, 0, 1, 0, 0, axisX, 1.6)
  line3(0, 0, 0, 0, 1, 0, axisY, 1.6)
  line3(zCorner[0], zCorner[1], 0, zCorner[0], zCorner[1], 1, axisZ, 1.6)

  ctx.font = '11px sans-serif'
  ctx.fillStyle = axisX
  ctx.textAlign = 'center'
  const xTitle = toScreen(0.5, 0, 0)
  ctx.fillText(props.xLabel + ' →', xTitle.sx, xTitle.sy + 36)
  // 切片标题放在轴**远端**（y=1.04）：中段是逐道刻度，放那里会与「6命…0命」叠字
  ctx.fillStyle = axisY
  ctx.textAlign = 'right'
  const yTitle = toScreen(0, 1.04, 0)
  ctx.fillText(props.sliceLabel + ' →', yTitle.sx - 6, yTitle.sy - 6)
  ctx.fillStyle = axisZ
  const zTitle = toScreen(zCorner[0], zCorner[1], 1)
  ctx.fillText(props.zLabel + ' ↑', zTitle.sx - 8, zTitle.sy - 10)

  // ---- 刻度标签（长轴抽稀，避免糊成一片）----
  ctx.font = '10px sans-serif'
  ctx.fillStyle = dim
  ctx.textAlign = 'center'
  for (let i = 0; i < n; i += xEvery) {
    const p = toScreen(xAt(i), 0, 0)
    ctx.fillText(clip(levels[i] ? levels[i].label : '', 9), p.sx, p.sy + 15)
  }
  ctx.textAlign = 'right'
  for (let j = 0; j < m; j += yEvery) {
    const p = toScreen(0, yAt(j), 0)
    ctx.fillText(clip(slices[j] ? slices[j].label : '', 10), p.sx - 6, p.sy + 4)
  }

  // ---- 折线阵：画家算法（远片先画，近片压在上面）----
  // 选中片 = 当前片：线加粗提亮、其余片降到 32% 透明度；垂线只给选中片（否则 14 条线的垂线糊成一片）
  const hasSelection = !!props.selectedSliceId
  const depthOf = (j: number) => project3d(0.5, yAt(j), 0.5, cam.value, BOX).depth
  const order = slices.map((_, j) => j).sort((a, b) => depthOf(b) - depthOf(a))
  for (const j of order) {
    const y = yAt(j)
    const selected = hasSelection && slices[j]?.id === props.selectedSliceId
    for (const s of props.series) {
      const vals = s.values[j]
      if (!vals) continue
      const color = props.colorOf(s.id)
      const lineColor = withAlpha(color, hasSelection && !selected ? 0.32 : 1)
      const pts: Array<{ sx: number; sy: number; i: number }> = []
      const flush = () => {
        if (pts.length === 0) return
        // 垂线：每个点落到地板，给 3D 高度一个锚（比只看悬空折线容易读数）
        if (!hasSelection || selected) {
          ctx.strokeStyle = withAlpha(color, selected ? 0.24 : 0.16)
          ctx.lineWidth = 1
          ctx.setLineDash([2, 3])
          for (const p of pts) {
            const foot = toScreen(xAt(p.i), y, 0)
            ctx.beginPath()
            ctx.moveTo(foot.sx, foot.sy)
            ctx.lineTo(p.sx, p.sy)
            ctx.stroke()
          }
          ctx.setLineDash([])
        }
        if (pts.length > 1) {
          ctx.strokeStyle = lineColor
          ctx.lineWidth = selected ? 3 : hasSelection ? 1.4 : 2
          ctx.beginPath()
          ctx.moveTo(pts[0].sx, pts[0].sy)
          for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].sx, pts[k].sy)
          ctx.stroke()
        }
        const radius = selected ? 3.4 : hasSelection ? 2 : 2.8
        for (const p of pts) {
          ctx.fillStyle = lineColor
          ctx.beginPath()
          ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = ink(selected ? 0.65 : 0.35)
          ctx.lineWidth = 0.8
          ctx.stroke()
        }
        pts.length = 0
      }
      for (let i = 0; i < n; i++) {
        const v = vals[i]
        if (v === null || !Number.isFinite(v)) { flush(); continue }
        const p = toScreen(xAt(i), y, zAt(v))
        pts.push({ sx: p.sx, sy: p.sy, i })
        projectedPts.push({ sx: p.sx, sy: p.sy, seriesId: s.id, sliceIdx: j, levelIdx: i, value: v })
      }
      flush()
    }
  }

  if (n === 0 || m === 0 || props.series.length === 0) {
    ctx.fillStyle = dim
    ctx.font = '13px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('没有可画的读数', size.w / 2, size.h / 2)
  }
}
// ---- 交互：拖动旋转 / 滚轮缩放 / 悬停读数 ----
let dragging: { x: number; y: number; yaw: number; pitch: number } | null = null
/** 按下/拖动的区分：拖动旋转过就不算点选（与 DifficultyCurve3DChart 同一手感） */
let pressed: { x: number; y: number; moved: boolean } | null = null
function onDown(e: MouseEvent) {
  dragging = { x: e.clientX, y: e.clientY, yaw: cam.value.yaw, pitch: cam.value.pitch }
  pressed = { x: e.clientX, y: e.clientY, moved: false }
}
function onMove(e: MouseEvent) {
  const wrap = wrapRef.value
  if (!wrap) return
  if (dragging && (e.buttons & 1)) {
    if (pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 3) pressed.moved = true
    view.value = 'custom'
    cam.value = {
      ...cam.value,
      yaw: dragging.yaw + (e.clientX - dragging.x) * 0.5,
      pitch: Math.max(-5, Math.min(80, dragging.pitch + (e.clientY - dragging.y) * 0.4)),
    }
    hover.value = null
    return
  }
  dragging = null
  const rect = wrap.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  let best: ProjectedPoint | null = null
  let bestD = 12
  for (const p of projectedPts) {
    const d = Math.hypot(p.sx - px, p.sy - py)
    if (d <= bestD) { bestD = d; best = p }
  }
  if (!best) { hover.value = null; return }
  const hit = best
  const s = props.series.find(x => x.id === hit.seriesId)
  if (!s) { hover.value = null; return }
  const slice = props.slices[hit.sliceIdx]
  const level = props.levels[hit.levelIdx]
  hover.value = {
    px,
    py,
    lines: [
      s.label + ' · ' + (slice ? slice.label : ''),
      (level ? level.label : '') + '：' + props.format(hit.value),
    ],
  }
}
/** 点选：最近点所在的切片 → 当前片（表格/折线/网格同步）；没拖动才算点选 */
function onClick(e: MouseEvent) {
  if (pressed?.moved !== false) return
  const wrap = wrapRef.value
  if (!wrap) return
  const rect = wrap.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  let best: ProjectedPoint | null = null
  let bestD = 12
  for (const p of projectedPts) {
    const d = Math.hypot(p.sx - px, p.sy - py)
    if (d <= bestD) { bestD = d; best = p }
  }
  if (!best) return
  const slice = props.slices[best.sliceIdx]
  if (slice) emit('selectSlice', slice.id)
}
function onLeave() {
  dragging = null
  hover.value = null
}
function onWheel(e: WheelEvent) {
  cam.value = { ...cam.value, zoom: Math.max(0.5, Math.min(2.5, cam.value.zoom * (e.deltaY > 0 ? 0.92 : 1.08))) }
}
const onGlobalUp = () => { dragging = null }

onMounted(() => {
  window.addEventListener('mouseup', onGlobalUp)
})
onBeforeUnmount(() => {
  window.removeEventListener('mouseup', onGlobalUp)
})
watch(
  () => [props.series, props.slices, props.levels, props.selectedSliceId, cam.value],
  () => requestRender(),
  { deep: true },
)

</script>

<style scoped>
.fc3d-root {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fc3d-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
}
.fc3d-hint {
  font-size: 12px;
  color: var(--fg-3);
}
.fc3d-btns {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.fc3d-btn {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--line);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.fc3d-btn.active {
  border-color: var(--c-success);
  color: var(--c-success);
}
.fc3d-canvas-wrap {
  position: relative;
  width: 100%;
  height: 500px;
  border-radius: 6px;
  background: radial-gradient(circle at 50% 45%, var(--scene-bg-inner) 0%, var(--scene-bg-outer) 100%);
  border: 1px solid var(--fill-active);
  overflow: hidden;
  cursor: grab;
}
.fc3d-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.fc3d-tip {
  position: absolute;
  pointer-events: none;
  background: var(--scene-panel);
  border: 1px solid var(--scene-panel-line);
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--scene-ink-dim);
  white-space: nowrap;
  z-index: 2;
}
</style>
