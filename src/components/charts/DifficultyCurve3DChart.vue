<template>
  <div class="dc3d-root">
    <div class="dc3d-toolbar">
      <span class="dc3d-hint">拖动旋转 · 滚轮缩放 · 悬停看档位</span>
      <div class="dc3d-btns">
        <button class="dc3d-btn" :class="{ active: view === 'iso' }" @click="setView('iso')">斜视</button>
        <button class="dc3d-btn" :class="{ active: view === 'front' }" @click="setView('front')">正视（难度×伤害）</button>
        <button class="dc3d-btn" :class="{ active: view === 'side' }" @click="setView('side')">侧视（版本×伤害）</button>
        <button class="dc3d-btn" :class="{ active: ribbons }" @click="ribbons = !ribbons">幕布</button>
        <button class="dc3d-btn" @click="setView('iso')">重置</button>
      </div>
    </div>
    <div ref="wrapRef" class="dc3d-canvas-wrap" @mousedown="onDown" @mousemove="onMove" @mouseleave="onLeave" @wheel.prevent="onWheel">
      <canvas ref="canvasRef" class="dc3d-canvas" />
      <div v-if="hover" class="dc3d-tip" :style="{ left: hover.px + 12 + 'px', top: hover.py + 12 + 'px' }">
        <div v-for="(line, i) in hover.lines" :key="i">{{ line }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { project3d, type Camera3D, type VersionLane } from '@/composables/difficultyCurve3d'
import type { CurveSeries } from '@/composables/difficultyCurve'
import { fmt } from '@/utils/format'

/**
 * 场景色一律走 `--scene-*` 令牌（自绘 canvas 场景不能借页面墨色 --wa-* 或 --fg-*：明亮主题下压在场景底上对比度会塌，
 * 见 global.css「3D Canvas 场景」段与 check-tokens 判据 9）。从计算样式读回真实值以跟随主题，无 DOM 时回落夜间值。
 */
function cssVarColor(name: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}
const SCENE_FALLBACK = { rgb: '255, 255, 255', dim: 'rgba(255, 255, 255, 0.55)', danger: '#f87171' }
const sceneInk = (alpha: number) => `rgba(${cssVarColor('--scene-ink-rgb', SCENE_FALLBACK.rgb)}, ${alpha})`
const sceneDim = () => cssVarColor('--scene-ink-dim', SCENE_FALLBACK.dim)
const sceneDanger = () => cssVarColor('--c-danger', SCENE_FALLBACK.danger)

/**
 * 难度曲线 3D（版本轴）：x = 操作难度绝对值（与 2D 同尺）、y（深度）= 版本道（`deriveVersionAxis`）、z = 伤害/血量%。
 * 每队一条道：折线 + 落到地板的「幕布」+ 关键次数跃迁标记；画家算法按投影深度由远到近画。
 * 纯 canvas 2D 自绘（与 TeamDamage3DChart 同款做法，不引 WebGL），渲染只读 props，不碰 store。
 */
const props = defineProps<{
  series: CurveSeries[]
  lanes: VersionLane[]
  costMax: number
  ratioMax: number
  colorOf: (presetId: string) => string
  goalLabel: (id: string | null) => string
  /** 版本轴标题（如「版本 = 击破位」） */
  axisLabel: string
}>()

const wrapRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const cam = ref<Camera3D>({ yaw: 32, pitch: 28, zoom: 1 })
const view = ref<'iso' | 'front' | 'side'>('iso')
const ribbons = ref(true)
const hover = ref<{ px: number; py: number; lines: string[] } | null>(null)

function setView(v: 'iso' | 'front' | 'side') {
  view.value = v
  cam.value = v === 'iso' ? { yaw: 32, pitch: 28, zoom: 1 } : v === 'front' ? { yaw: 0, pitch: 4, zoom: 1 } : { yaw: 90, pitch: 6, zoom: 1 }
}

type Pt = { sx: number; sy: number; depth: number; laneIdx: number; ptIdx: number }
let projectedPts: Pt[] = []
let size = { w: 0, h: 0 }

const laneCount = computed(() => Math.max(1, props.lanes.length))

function toScreen(x: number, y: number, z: number) {
  const p = project3d(x, y, z, cam.value)
  const scale = Math.min(size.w, size.h) * 0.78
  return { sx: size.w / 2 + p.sx * scale, sy: size.h / 2 + 14 + p.sy * scale, depth: p.depth }
}
function laneY(idx: number): number {
  return laneCount.value <= 1 ? 0.5 : idx / (laneCount.value - 1)
}

function draw() {
  const canvas = canvasRef.value
  const wrap = wrapRef.value
  if (!canvas || !wrap) return
  const dpr = window.devicePixelRatio || 1
  size = { w: wrap.clientWidth, h: wrap.clientHeight }
  if (size.w === 0 || size.h === 0) return
  if (canvas.width !== size.w * dpr || canvas.height !== size.h * dpr) {
    canvas.width = size.w * dpr
    canvas.height = size.h * dpr
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, size.w, size.h)
  projectedPts = []
  const costMax = Math.max(1, props.costMax)
  const ratioMax = Math.max(1, props.ratioMax)

  // ---- 地板网格：难度刻度 × 版本道 ----
  ctx.lineWidth = 1
  const xTicks = 5
  for (let i = 0; i <= xTicks; i++) {
    const x = i / xTicks
    const a = toScreen(x, 0, 0); const b = toScreen(x, 1, 0)
    ctx.strokeStyle = sceneInk(0.28)
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke()
    const near = toScreen(x, 0, 0)
    ctx.fillStyle = sceneDim(); ctx.font = '10px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(fmt(x * costMax, 0), near.sx, near.sy + 12)
  }
  for (let i = 0; i < laneCount.value; i++) {
    const y = laneY(i)
    const a = toScreen(0, y, 0); const b = toScreen(1, y, 0)
    ctx.strokeStyle = sceneInk(0.2)
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke()
  }
  // 击杀线平面（z = 100%）
  if (ratioMax >= 100) {
    const z = 100 / ratioMax
    const c = [toScreen(0, 0, z), toScreen(1, 0, z), toScreen(1, 1, z), toScreen(0, 1, z)]
    ctx.strokeStyle = sceneDanger(); ctx.globalAlpha = 0.7; ctx.setLineDash([6, 4])
    ctx.beginPath(); ctx.moveTo(c[0]!.sx, c[0]!.sy); for (const p of c.slice(1)) ctx.lineTo(p.sx, p.sy); ctx.closePath(); ctx.stroke()
    ctx.setLineDash([]); ctx.globalAlpha = 1
    ctx.fillStyle = sceneDanger(); ctx.textAlign = 'left'; ctx.fillText('击杀线 100%', c[0]!.sx + 4, c[0]!.sy - 4)
  }
  // 竖轴刻度（伤害/血量%）在左前角
  const zTicks = ratioMax <= 100 ? 5 : Math.min(6, Math.ceil(ratioMax / 50))
  for (let i = 0; i <= zTicks; i++) {
    const v = (i / zTicks) * ratioMax
    const p = toScreen(0, 0, i / zTicks)
    ctx.fillStyle = sceneDim(); ctx.textAlign = 'right'; ctx.font = '10px sans-serif'
    ctx.fillText(`${fmt(v, 0)}%`, p.sx - 6, p.sy + 3)
  }
  const zAxisTop = toScreen(0, 0, 1); const zAxisBottom = toScreen(0, 0, 0)
  ctx.strokeStyle = sceneInk(0.5)
  ctx.beginPath(); ctx.moveTo(zAxisBottom.sx, zAxisBottom.sy); ctx.lineTo(zAxisTop.sx, zAxisTop.sy); ctx.stroke()
  // 轴标题
  ctx.fillStyle = sceneDim(); ctx.font = '11px sans-serif'
  const xl = toScreen(0.5, -0.08, 0); ctx.textAlign = 'center'; ctx.fillText('操作难度绝对值 →', xl.sx, xl.sy + 24)
  const yl = toScreen(1.06, 0.5, 0); ctx.textAlign = 'left'; ctx.fillText(`${props.axisLabel} →`, yl.sx, yl.sy)
  ctx.textAlign = 'left'; ctx.fillText('伤害/血量 % ↑', zAxisTop.sx - 30, zAxisTop.sy - 8)

  // ---- 各道：由远到近 ----
  const order = props.lanes
    .map((lane, idx) => ({ lane, idx, depth: toScreen(0.5, laneY(idx), 0).depth }))
    .sort((a, b) => b.depth - a.depth)
  for (const { lane, idx } of order) {
    const s = props.series.find(x => x.presetId === lane.presetId)
    if (!s || s.points.length === 0) continue
    const color = props.colorOf(lane.presetId)
    const y = laneY(idx)
    const pts = s.points.map((p, pi) => {
      const sc = toScreen(Math.min(1, p.cost / costMax), y, Math.min(1, p.ratio / ratioMax))
      projectedPts.push({ ...sc, laneIdx: idx, ptIdx: pi })
      return sc
    })
    // 幕布：折线 → 地板
    if (ribbons.value && pts.length > 1) {
      ctx.beginPath()
      ctx.moveTo(pts[0]!.sx, pts[0]!.sy)
      for (const p of pts.slice(1)) ctx.lineTo(p.sx, p.sy)
      for (let i = s.points.length - 1; i >= 0; i--) {
        const f = toScreen(Math.min(1, s.points[i]!.cost / costMax), y, 0)
        ctx.lineTo(f.sx, f.sy)
      }
      ctx.closePath()
      ctx.fillStyle = withAlpha(color, 0.16)
      ctx.fill()
    }
    // 落点竖线（起点/终点）
    for (const i of [0, s.points.length - 1]) {
      const f = toScreen(Math.min(1, s.points[i]!.cost / costMax), y, 0)
      ctx.strokeStyle = withAlpha(color, 0.45); ctx.setLineDash([2, 3])
      ctx.beginPath(); ctx.moveTo(f.sx, f.sy); ctx.lineTo(pts[i]!.sx, pts[i]!.sy); ctx.stroke(); ctx.setLineDash([])
    }
    // 折线（难度回落段虚线，与 2D 同语义）
    for (let i = 1; i < pts.length; i++) {
      const back = s.points[i]!.cost < s.points[i - 1]!.cost - 1e-9
      ctx.strokeStyle = color; ctx.lineWidth = back ? 1.4 : 2.2; ctx.setLineDash(back ? [4, 3] : [])
      ctx.beginPath(); ctx.moveTo(pts[i - 1]!.sx, pts[i - 1]!.sy); ctx.lineTo(pts[i]!.sx, pts[i]!.sy); ctx.stroke()
    }
    ctx.setLineDash([]); ctx.lineWidth = 1
    // 点 + 关键次数跃迁圈
    pts.forEach((p, pi) => {
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(p.sx, p.sy, 3.2, 0, Math.PI * 2); ctx.fill()
      if (s.points[pi]!.changes.some(c => c.major)) {
        ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(p.sx, p.sy, 6.5, 0, Math.PI * 2); ctx.stroke()
      }
    })
    // 道标签（起点左侧）+ 终点值
    const start = toScreen(-0.02, y, 0)
    ctx.fillStyle = color; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'right'
    ctx.fillText(lane.label, start.sx, start.sy + 4)
    const last = pts[pts.length - 1]!
    ctx.font = '10px sans-serif'; ctx.textAlign = 'left'
    ctx.fillText(`${fmt(s.points[s.points.length - 1]!.ratio, 0)}%`, last.sx + 6, last.sy + 3)
  }
}

function withAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (m) {
    const n = parseInt(m[1]!, 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
  }
  const rgb = /^rgba?\(([^)]+)\)/.exec(color)
  if (rgb) {
    const parts = rgb[1]!.split(',').slice(0, 3).map(s => s.trim())
    return `rgba(${parts.join(',')},${a})`
  }
  return color
}

// ---- 交互 ----
let dragging: { x: number; y: number; yaw: number; pitch: number } | null = null
function onDown(e: MouseEvent) {
  dragging = { x: e.clientX, y: e.clientY, yaw: cam.value.yaw, pitch: cam.value.pitch }
}
function onMove(e: MouseEvent) {
  const wrap = wrapRef.value
  if (!wrap) return
  const rect = wrap.getBoundingClientRect()
  const px = e.clientX - rect.left; const py = e.clientY - rect.top
  if (dragging && (e.buttons & 1)) {
    cam.value = {
      ...cam.value,
      yaw: dragging.yaw + (e.clientX - dragging.x) * 0.5,
      pitch: Math.max(-10, Math.min(89, dragging.pitch + (e.clientY - dragging.y) * 0.4)),
    }
    hover.value = null
    return
  }
  dragging = null
  let best: { d: number; p: Pt } | null = null
  for (const p of projectedPts) {
    const d = Math.hypot(p.sx - px, p.sy - py)
    if (d <= 10 && (!best || d < best.d)) best = { d, p }
  }
  if (!best) { hover.value = null; return }
  const lane = props.lanes[best.p.laneIdx]!
  const s = props.series.find(x => x.presetId === lane.presetId)!
  const pt = s.points[best.p.ptIdx]!
  const lines = [
    `${s.name} · 版本：${lane.label}`,
    `${pt.opened ? props.goalLabel(pt.opened) : '全关起点'}`,
    `操作难度 ${fmt(pt.cost, 0)} · 伤害 ${fmt(pt.ratio, 1)}%（${(pt.dmg / 1e6).toFixed(2)}M）`,
    ...pt.changes.filter(c => c.major).slice(0, 4).map(c => `${c.label} ${fmt(c.from, 1)} → ${fmt(c.to, 1)}`),
  ]
  hover.value = { px, py, lines }
}
function onLeave() { dragging = null; hover.value = null }
function onWheel(e: WheelEvent) {
  cam.value = { ...cam.value, zoom: Math.max(0.5, Math.min(2.5, cam.value.zoom * (e.deltaY > 0 ? 0.92 : 1.08))) }
}
const onGlobalUp = () => { dragging = null }

let ro: ResizeObserver | null = null
onMounted(() => {
  draw()
  window.addEventListener('mouseup', onGlobalUp)
  if (typeof ResizeObserver !== 'undefined' && wrapRef.value) {
    ro = new ResizeObserver(() => draw())
    ro.observe(wrapRef.value)
  }
})
onBeforeUnmount(() => { ro?.disconnect(); ro = null; window.removeEventListener('mouseup', onGlobalUp) })
watch(() => [props.series, props.lanes, props.costMax, props.ratioMax, cam.value, ribbons.value], () => draw(), { deep: true })
</script>

<style scoped>
.dc3d-root { display: flex; flex-direction: column; gap: 6px; }
.dc3d-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; }
.dc3d-hint { font-size: 12px; color: var(--fg-3); }
.dc3d-btns { display: flex; gap: 4px; flex-wrap: wrap; }
.dc3d-btn { font-size: 12px; padding: 2px 8px; border-radius: 4px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
.dc3d-btn.active { border-color: var(--c-success); color: var(--c-success); }
.dc3d-canvas-wrap { position: relative; width: 100%; height: 460px; border-radius: 6px; background: radial-gradient(circle at 50% 45%, var(--scene-bg-inner) 0%, var(--scene-bg-outer) 100%); border: 1px solid var(--fill-active); overflow: hidden; cursor: grab; }
.dc3d-canvas { width: 100%; height: 100%; display: block; }
.dc3d-tip { position: absolute; pointer-events: none; background: var(--scene-panel); border: 1px solid var(--scene-panel-line); border-radius: 4px; padding: 6px 8px; font-size: 11px; line-height: 1.45; color: var(--scene-ink-dim); white-space: nowrap; z-index: 2; }
</style>
