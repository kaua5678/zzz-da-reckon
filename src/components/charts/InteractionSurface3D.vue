<template>
  <div class="is3d-root">
    <div class="is3d-toolbar">
      <div class="is3d-chips">
        <span
          v-for="s in seriesList"
          :key="s.key"
          class="is3d-chip"
          :class="{ on: s.key === activeKey }"
          @click="selectSeries(s.key)"
        >{{ s.label }}</span>
      </div>
      <div class="is3d-btns">
        <button class="is3d-btn" :class="{ active: view === 'iso' }" @click="setView('iso')">斜视</button>
        <button class="is3d-btn" :class="{ active: view === 'front' }" @click="setView('front')">正视</button>
        <button class="is3d-btn" :class="{ active: view === 'top' }" @click="setView('top')">俯视</button>
        <button class="is3d-btn" :class="{ active: showPaths }" @click="toggle('paths')">参考路径</button>
        <button class="is3d-btn" :class="{ active: showFrontier }" @click="toggle('frontier')">梯度线</button>
        <button class="is3d-btn" :class="{ active: showDirty }" @click="toggle('dirty')">不可行格</button>
        <button class="is3d-btn" @click="setView('iso')">重置</button>
      </div>
    </div>

    <div
      ref="wrapRef" class="is3d-canvas-wrap"
      @mousedown="onDown" @mousemove="onMove" @mouseleave="onLeave" @wheel.prevent="onWheel"
    >
      <canvas ref="canvasRef" class="is3d-canvas" />
      <div v-if="hover" class="is3d-tip" :style="{ left: hover.px + 12 + 'px', top: hover.py + 12 + 'px' }">
        <div v-for="(line, i) in hover.lines" :key="i">{{ line }}</div>
      </div>
      <div v-if="empty" class="is3d-empty">
        {{ busy ? '正在采样二维面…' : '先在上面点「生成二维面」' }}
      </div>
    </div>

    <div v-if="activeSeries" class="is3d-readout">
      <div class="is3d-card">
        <div class="is3d-card-title">面峰值</div>
        <div class="is3d-card-main">{{ compact(activeSeries.best.dmg) }}</div>
        <div class="is3d-card-sub">
          交互 {{ activeSeries.best.count }} 次 × 合轴 {{ pct(activeSeries.best.ratio) }}
          <span v-if="!activeSeries.best.clean" class="is3d-warn">（已{{ dirtyLabel(activeSeries.best) }}）</span>
        </div>
      </div>
      <div v-for="p in activeSeries.paths" :key="p.kind" class="is3d-card">
        <div class="is3d-card-title">{{ p.label }}</div>
        <div class="is3d-card-main" :class="{ neg: p.gain < 0, pos: p.gain > 0 }">
          {{ p.gain >= 0 ? '+' : '' }}{{ compact(p.gain) }}
        </div>
        <div class="is3d-card-sub">
          终点 {{ compact(p.cells[p.cells.length - 1]!.dmg) }}
          · 途中最低 {{ compact(p.worst.dmg) }}<template v-if="p.worst.dmg < p.cells[0]!.dmg">（掉下去过）</template>
        </div>
      </div>
      <div class="is3d-card wide">
        <div class="is3d-card-title">干净边界（每档合轴下，交互最多还能加到几次）</div>
        <div class="is3d-card-sub">
          <span v-for="(lim, i) in activeSeries.cleanLimitByRatio" :key="i" class="is3d-lim">
            {{ pct(activeSeries.ratios[i]!) }} → {{ lim < 0 ? '×' : lim }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
/**
 * **交互 × 合轴 三维面**（用户口径 2026-10-18）：
 *
 * > 「难度提升导致伤害增加，实际上是在这个二维面找一个最优梯度线，不该由我之前那样口述
 * >   说什么交互该挤压，交互该顺便提高合轴让他纯赚……用最短的时间得到最多的交互效益」
 *
 * x = 交互次数、y = 合轴吸收率、**z = 队总伤害（高度）**。
 *
 * ## 为什么是 z 高度不是颜色
 *
 * 颜色只给离散分档（要读图例、相邻档看不出连续），而这张面上真正要读的是**形状**：
 * 可行域是向左收窄的斜坡、掉档是断崖、梯度线贴着斜坡上沿走。高度 + 光照让这三件事同时可见，
 * 颜色只作辅助（沿用 ResponseSurface3D 的冷暖映射，数据色明暗通吃）。
 *
 * ## 图上叠加三层（都可关）
 *
 * 1. **不可行格**（弃轴 / 降配）：面上那些坑不是数据噪声，是引擎的离散分支（挤压臂削连段、
 *    降配缩交互）。默认画暗红点。
 * 2. **梯度线**（`frontier`）= 帕累托前沿：每一步 x、y 都不回头的**可执行**路线（实线 + 顶点）；
 *    `columnBest` 是「每列最优」的**上界包络**（虚线）—— 两者不同，前者才能一步步走。
 * 3. **参考路径**（用户口述的两条走法）：贴地画，让「先交互会掉下去」一眼看见。
 *
 * ⚠ 渲染只读 props，不碰 store。场景色一律 `--scene-*`（Canvas 自绘不能借页面墨色，判据 9/10）。
 */
import { computed, ref, watch } from "vue"
import { fmt } from "@/utils/format"
import { readThemeVar, withAlpha } from "@/utils/canvasTheme"
import { useCanvasScene } from "@/composables/charts/useCanvasScene"
import type { SurfaceCell, SurfaceSeries, SweepSurface } from "@/composables/interactionSurface"

const props = defineProps<{ surface: SweepSurface | null; busy?: boolean }>()

const wrapRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

const sceneInk = (alpha: number) => "rgba(" + readThemeVar("--scene-ink-rgb") + ", " + alpha + ")"
const axisX = () => readThemeVar("--scene-axis-x")
const axisY = () => readThemeVar("--scene-axis-y")
const axisZ = () => readThemeVar("--scene-axis-z")
const markCur = () => readThemeVar("--scene-mark-cur")
const markMax = () => readThemeVar("--scene-mark-max")

const seriesList = computed<SurfaceSeries[]>(() => props.surface?.series ?? [])
const empty = computed(() => seriesList.value.length === 0)
const activeKey = ref<string>("")
const activeSeries = computed<SurfaceSeries | null>(() =>
  seriesList.value.find(s => s.key === activeKey.value) ?? seriesList.value[0] ?? null)

function selectSeries(key: string) {
  activeKey.value = key
  requestRender()
}

/**
 * 默认选中「最值得看」的那一维：按**峰值增益**（面峰值 − 0 次交互时的伤害）排序。
 *
 * 不按绝对伤害排——绝对伤害最高的那一维常常是「加不加交互都一样」的平坡，
 * 用户第一眼会以为图没画出来。峰值增益最高 = 这一维真的把伤害抬起来了。
 */
watch(seriesList, list => {
  if (list.length === 0) return
  let best = list[0]!
  const gainOf = (s: SurfaceSeries) => s.best.dmg - (s.cells[0]?.[0]?.dmg ?? s.best.dmg)
  for (const s of list) if (gainOf(s) > gainOf(best)) best = s
  activeKey.value = best.key
  requestRender()
}, { immediate: true })

const pct = (v: number) => (v * 100).toFixed(0) + "%"
const compact = (v: number) => fmt(v / 1e6, 2) + "M"

function dirtyLabel(c: SurfaceCell): string {
  if (c.fallback) return "弃轴"
  if (c.downscale !== undefined) return "降配 ×" + c.downscale
  return "挤压 " + c.trim + " 份"
}

const view = ref<"iso" | "front" | "top">("iso")
const yaw = ref(38)
const pitch = ref(26)
const zoom = ref(1)
function setView(v: "iso" | "front" | "top") {
  view.value = v
  if (v === "iso") { yaw.value = 38; pitch.value = 26 }
  else if (v === "front") { yaw.value = 0; pitch.value = 8 }
  else { yaw.value = 0; pitch.value = 88 }
  requestRender()
}

const showPaths = ref(true)
const showFrontier = ref(true)
const showDirty = ref(true)
function toggle(which: "paths" | "frontier" | "dirty") {
  if (which === "paths") showPaths.value = !showPaths.value
  else if (which === "frontier") showFrontier.value = !showFrontier.value
  else showDirty.value = !showDirty.value
  requestRender()
}

const scene = useCanvasScene({ wrapRef, canvasRef, render: drawFrame })
const requestRender = scene.requestRender

interface P3 { sx: number; sy: number; depth: number }
function project(wx: number, wy: number, wz: number, cx: number, cy: number, scale: number): P3 {
  const radY = (yaw.value * Math.PI) / 180
  const radP = (pitch.value * Math.PI) / 180
  const cosY = Math.cos(radY), sinY = Math.sin(radY)
  const cosP = Math.cos(radP), sinP = Math.sin(radP)
  const zShifted = wz - 0.5
  const x1 = wx * cosY - wy * sinY
  const y1 = wx * sinY + wy * cosY
  const y2 = y1 * cosP - zShifted * sinP
  const z2 = y1 * sinP + zShifted * cosP
  const cameraDist = 4.2
  const k = cameraDist / (cameraDist + y2)
  return { sx: cx + x1 * scale * zoom.value * k, sy: cy - z2 * scale * zoom.value * k, depth: y2 }
}

function heat(t: number, lighting: number): string {
  const x = Math.max(0, Math.min(1, t))
  let r = 0, g = 0, b = 0
  if (x < 0.25) { const s = x / 0.25; r = 30 + s * 10; g = 58 + s * 80; b = 138 + s * 110 }
  else if (x < 0.5) { const s = (x - 0.25) / 0.25; r = 40 - s * 30; g = 138 + s * 50; b = 248 - s * 35 }
  else if (x < 0.75) { const s = (x - 0.5) / 0.25; r = 10 + s * 230; g = 188 - s * 30; b = 213 - s * 200 }
  else { const s = (x - 0.75) / 0.25; r = 240 + s * 15; g = 158 - s * 90; b = 13 - s * 13 }
  const lit = (v: number) => Math.round(Math.max(0, Math.min(255, v * lighting)))
  return "rgb(" + lit(r) + "," + lit(g) + "," + lit(b) + ")"
}

const hover = ref<{ px: number; py: number; lines: string[] } | null>(null)

function cellXYZ(s: SurfaceSeries, ci: number, ri: number): { wx: number; wy: number; wz: number } {
  const c = s.cells[ri]![ci]!
  const nx = s.counts.length
  const ny = s.ratios.length
  const dmgMin = Math.min(...s.cells.flat().map(v => v.dmg))
  const dmgMax = Math.max(...s.cells.flat().map(v => v.dmg))
  const zRange = Math.max(1, dmgMax - dmgMin)
  return {
    wx: -1 + (2 / Math.max(1, nx - 1)) * ci,
    wy: -1 + (2 / Math.max(1, ny - 1)) * ri,
    wz: ((c.dmg - dmgMin) / zRange) * 0.9,
  }
}

function geom() {
  const w = scene.size.w
  const h = scene.size.h
  return { cx: w / 2, cy: h / 2 + 18, scale: Math.min(w, h) * 0.36 }
}

function drawFrame(ctx: CanvasRenderingContext2D) {
  const w = scene.size.w
  const h = scene.size.h
  const { cx, cy, scale } = geom()
  const s = activeSeries.value
  ctx.clearRect(0, 0, w, h)
  drawFloor(ctx, cx, cy, scale)
  if (!s) return
  const nx = s.counts.length
  const ny = s.ratios.length
  const dmgMin = Math.min(...s.cells.flat().map(c => c.dmg))
  const dmgMax = Math.max(...s.cells.flat().map(c => c.dmg))
  const zRange = Math.max(1, dmgMax - dmgMin)

  interface Quad { depth: number; pts: P3[]; fill: string }
  const quads: Quad[] = []
  for (let ri = 0; ri < ny - 1; ri++) {
    for (let ci = 0; ci < nx - 1; ci++) {
      const a = cellXYZ(s, ci, ri), b = cellXYZ(s, ci + 1, ri)
      const c2 = cellXYZ(s, ci + 1, ri + 1), d = cellXYZ(s, ci, ri + 1)
      const p00 = project(a.wx, a.wy, a.wz, cx, cy, scale)
      const p10 = project(b.wx, b.wy, b.wz, cx, cy, scale)
      const p11 = project(c2.wx, c2.wy, c2.wz, cx, cy, scale)
      const p01 = project(d.wx, d.wy, d.wz, cx, cy, scale)
      const avgDmg = (s.cells[ri]![ci]!.dmg + s.cells[ri]![ci + 1]!.dmg
        + s.cells[ri + 1]![ci + 1]!.dmg + s.cells[ri + 1]![ci]!.dmg) / 4
      const dzdx = (b.wz - a.wz)
      const dzdy = (d.wz - a.wz)
      const lit = Math.max(0.5, Math.min(1.25, 0.88 - dzdx * 1.6 - dzdy * 1.0))
      quads.push({
        depth: (p00.depth + p10.depth + p11.depth + p01.depth) / 4,
        pts: [p00, p10, p11, p01],
        fill: heat((avgDmg - dmgMin) / zRange, lit),
      })
    }
  }
  quads.sort((a, b) => a.depth - b.depth)
  for (const q of quads) {
    ctx.beginPath()
    ctx.moveTo(q.pts[0]!.sx, q.pts[0]!.sy)
    for (let i = 1; i < q.pts.length; i++) ctx.lineTo(q.pts[i]!.sx, q.pts[i]!.sy)
    ctx.closePath()
    ctx.fillStyle = q.fill
    ctx.fill()
    ctx.strokeStyle = "rgba(0,0,0,0.10)"
    ctx.lineWidth = 0.5
    ctx.stroke()
  }

  if (showDirty.value) {
    for (let ri = 0; ri < ny; ri++) {
      for (let ci = 0; ci < nx; ci++) {
        if (s.cells[ri]![ci]!.clean) continue
        const t = cellXYZ(s, ci, ri)
        const p = project(t.wx, t.wy, t.wz, cx, cy, scale)
        ctx.beginPath()
        ctx.arc(p.sx, p.sy, 3.0, 0, Math.PI * 2)
        ctx.fillStyle = withAlpha(readThemeVar("--c-danger"), 0.85)
        ctx.fill()
      }
    }
  }

  if (showFrontier.value) {
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = withAlpha(markMax(), 0.55)
    ctx.lineWidth = 1.3
    ctx.beginPath()
    s.columnBest.forEach((c, i) => {
      const t = cellXYZ(s, s.counts.indexOf(c.count), s.ratios.indexOf(c.ratio))
      const p = project(t.wx, t.wy, t.wz, cx, cy, scale)
      if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy)
    })
    ctx.stroke()
    ctx.setLineDash([])
    ctx.strokeStyle = markCur()
    ctx.lineWidth = 2.4
    ctx.beginPath()
    s.frontier.forEach((c, i) => {
      const t = cellXYZ(s, s.counts.indexOf(c.count), s.ratios.indexOf(c.ratio))
      const p = project(t.wx, t.wy, t.wz, cx, cy, scale)
      if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy)
    })
    ctx.stroke()
    for (const c of s.frontier) {
      const t = cellXYZ(s, s.counts.indexOf(c.count), s.ratios.indexOf(c.ratio))
      const p = project(t.wx, t.wy, t.wz, cx, cy, scale)
      ctx.beginPath()
      ctx.arc(p.sx, p.sy, 3, 0, Math.PI * 2)
      ctx.fillStyle = markCur()
      ctx.fill()
    }
  }

  if (showPaths.value) {
    for (const path of s.paths) {
      ctx.strokeStyle = path.kind === "interact-first" ? axisX() : axisY()
      ctx.lineWidth = 2.2
      ctx.setLineDash([])
      ctx.beginPath()
      path.cells.forEach((c, i) => {
        const ci = s.counts.indexOf(c.count)
        const ri = s.ratios.indexOf(c.ratio)
        const wx = -1 + (2 / Math.max(1, nx - 1)) * ci
        const wy = -1 + (2 / Math.max(1, ny - 1)) * ri
        const p = project(wx, wy, 0, cx, cy, scale)
        if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy)
      })
      ctx.stroke()
    }
  }

  {
    const t = cellXYZ(s, s.counts.indexOf(s.best.count), s.ratios.indexOf(s.best.ratio))
    const p = project(t.wx, t.wy, t.wz, cx, cy, scale)
    ctx.beginPath()
    ctx.arc(p.sx, p.sy, 5.5, 0, Math.PI * 2)
    ctx.fillStyle = markMax()
    ctx.fill()
  }

  drawLabels(ctx, cx, cy, scale, s)
}

function drawFloor(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number) {
  ctx.save()
  ctx.strokeStyle = withAlpha(sceneInk(0.18), 0.5)
  ctx.lineWidth = 0.7
  for (let i = 0; i <= 4; i++) {
    const t = -1 + i / 2
    const a = project(t, -1, 0, cx, cy, scale)
    const b = project(t, 1, 0, cx, cy, scale)
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke()
    const c = project(-1, t, 0, cx, cy, scale)
    const d = project(1, t, 0, cx, cy, scale)
    ctx.beginPath(); ctx.moveTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.stroke()
  }
  ctx.restore()
}

function drawLabels(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, s: SurfaceSeries) {
  ctx.save()
  ctx.font = "11px system-ui, sans-serif"
  ctx.textAlign = "center"
  ctx.fillStyle = axisX()
  ctx.fillText("交互次数 →", cx, cy + scale * 1.15)
  ctx.fillStyle = sceneInk(0.62)
  const nx = s.counts.length
  const stepX = Math.max(1, Math.ceil(nx / 6))
  for (let i = 0; i < nx; i += stepX) {
    const p = project(-1 + (2 / Math.max(1, nx - 1)) * i, -1, 0, cx, cy, scale)
    ctx.fillText(String(s.counts[i]), p.sx, p.sy + 14)
  }
  ctx.fillStyle = axisY()
  const yEnd = project(-1, 1, 0, cx, cy, scale)
  ctx.fillText("合轴率 ↑", yEnd.sx - 46, yEnd.sy - 8)
  ctx.fillStyle = sceneInk(0.62)
  const ny = s.ratios.length
  for (let i = 0; i < ny; i++) {
    const p = project(-1, -1 + (2 / Math.max(1, ny - 1)) * i, 0, cx, cy, scale)
    ctx.fillText(pct(s.ratios[i]!), p.sx - 26, p.sy + 4)
  }
  ctx.fillStyle = axisZ()
  ctx.textAlign = "left"
  ctx.fillText("高度 = 伤害", 8, 16)
  ctx.restore()
}

let dragging = false
let lastX = 0
let lastY = 0
function onDown(e: MouseEvent) {
  dragging = true
  lastX = e.clientX
  lastY = e.clientY
}
function onMove(e: MouseEvent) {
  if (dragging) {
    yaw.value = (yaw.value + (e.clientX - lastX) * 0.5) % 360
    pitch.value = Math.max(-10, Math.min(89, pitch.value + (e.clientY - lastY) * 0.35))
    lastX = e.clientX
    lastY = e.clientY
    requestRender()
  }
  const s = activeSeries.value
  if (!s) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  const { cx, cy, scale } = geom()
  const nx = s.counts.length
  const ny = s.ratios.length
  let best: SurfaceCell | null = null
  let bestD = 20
  for (let ri = 0; ri < ny; ri++) {
    for (let ci = 0; ci < nx; ci++) {
      const t = cellXYZ(s, ci, ri)
      const p = project(t.wx, t.wy, t.wz, cx, cy, scale)
      const d = Math.hypot(p.sx - px, p.sy - py)
      if (d < bestD) { bestD = d; best = s.cells[ri]![ci]! }
    }
  }
  hover.value = best
    ? {
        px, py,
        lines: [
          s.label + " " + best.count + " 次 × 合轴 " + pct(best.ratio),
          "伤害 " + compact(best.dmg),
          best.clean ? "可行" : dirtyLabel(best),
          "平A " + best.basicTime.toFixed(1) + "s · 净占用 " + best.net.toFixed(1) + "s",
        ],
      }
    : null
  requestRender()
}
function onLeave() {
  dragging = false
  hover.value = null
  requestRender()
}
function onWheel(e: WheelEvent) {
  zoom.value = Math.max(0.55, Math.min(2.2, zoom.value * (e.deltaY > 0 ? 0.92 : 1.08)))
  requestRender()
}
</script>

<style scoped>
.is3d-root { display: flex; flex-direction: column; gap: 8px; }
.is3d-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.is3d-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.is3d-chip { padding: 2px 10px; border-radius: 10px; cursor: pointer; font-size: 12px;
  border: 1px solid var(--app-border); color: var(--app-text-dim); }
.is3d-chip.on { border-color: var(--app-primary); color: var(--app-primary); }
.is3d-btns { display: flex; gap: 4px; flex-wrap: wrap; }
.is3d-btn { padding: 2px 8px; font-size: 12px; border-radius: 4px; cursor: pointer;
  border: 1px solid var(--app-border); background: transparent; color: var(--app-text-dim); }
.is3d-btn.active { border-color: var(--app-primary); color: var(--app-primary); }
.is3d-canvas-wrap { position: relative; width: 100%; height: 420px; cursor: grab;
  background: linear-gradient(180deg, var(--scene-bg-inner), var(--scene-bg-outer)); border-radius: 6px; }
.is3d-canvas-wrap:active { cursor: grabbing; }
.is3d-canvas { width: 100%; height: 100%; display: block; }
.is3d-tip { position: absolute; pointer-events: none; background: var(--app-tooltip-bg);
  color: var(--app-tooltip-text); padding: 6px 8px; border-radius: 4px; font-size: 12px; line-height: 1.5; }
.is3d-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: var(--scene-ink-dim); font-size: 13px; }
.is3d-readout { display: flex; gap: 10px; flex-wrap: wrap; }
.is3d-card { border: 1px solid var(--app-border); border-radius: 6px; padding: 8px 12px; flex: 1 1 180px; }
.is3d-card.wide { flex: 1 1 100%; }
.is3d-card-title { font-size: 12px; color: var(--app-text-dim); }
.is3d-card-main { font-size: 18px; font-weight: 600; color: var(--app-text-solid); }
.is3d-card-main.pos { color: var(--c-success); }
.is3d-card-main.neg { color: var(--c-danger); }
.is3d-card-sub { font-size: 12px; color: var(--app-text-dim); line-height: 1.6; }
.is3d-warn { color: var(--c-danger); }
.is3d-lim { display: inline-block; margin-right: 10px; }
</style>