<template>
  <div class="contrib3d-root">
    <div class="contrib3d-controls">
      <span class="ctl-label">拖拽旋转</span>
      <n-radio-group v-model:value="mode" size="small">
        <n-radio-button value="provider">按提供者分层</n-radio-button>
        <n-radio-button value="content">按内容分层</n-radio-button>
      </n-radio-group>
      <span class="muted">
        X = 属性 · Y = {{ mode === 'provider' ? '提供者' : '内容大类' }} · 柱高 = 贡献量
      </span>
    </div>
    <div class="contrib3d-canvas-wrap">
      <canvas ref="canvasEl" />
      <div v-if="!bars.length" class="contrib3d-empty">当前词条层没有可画的贡献</div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 三维贡献分布图（**直观演示用小玩具**，2026-10-20）。
 *
 * 用户口径：「A 这个可视化可以稍作演示，算是直观小玩具，**主要还是 BC**」——
 * 所以本组件刻意保持精简：只做**只读展示 + 拖拽旋转**，不做筛选、不做下钻、不承担数据核对职责
 * （核对用 B/C 两种表格视图，它们才有逐条可读的数字）。
 *
 * 复用 `composables/difficultyCurve3d#project3d`（仓库既有 3D 相机模型），
 * 不另写一套投影数学（规则 11：共享量单一来源）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NRadioButton, NRadioGroup } from 'naive-ui'
import { project3d, type Camera3D } from '@/composables/difficultyCurve3d'
import { readThemeVar } from '@/utils/canvasTheme'
import type { FlatContribution } from '@/composables/agentMechanicView'

const props = defineProps<{
  rows: FlatContribution[]
  /** 属性 → 显示名 */
  labelOf: (key: string) => string
}>()

const mode = ref<'provider' | 'content'>('provider')
const canvasEl = ref<HTMLCanvasElement | null>(null)
const cam = ref<Camera3D>({ yaw: -35, pitch: 28, zoom: 1 })

interface Bar {
  x: number
  y: number
  value: number
  provider: string
  content: string
  key: string
}

/** 只取维度最大的前 N 条属性（3D 图里列太多会挤成一片） */
const MAX_COLS = 12
const MAX_LANES = 10

const bars = computed<Bar[]>(() => {
  const totals = new Map<string, number>()
  for (const r of props.rows) totals.set(r.key, (totals.get(r.key) ?? 0) + Math.abs(r.amount))
  const keys = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_COLS).map(([k]) => k)
  if (!keys.length) return []

  const laneOf = (r: FlatContribution): string => (mode.value === 'provider' ? r.provider : r.content)
  const lanes = [...new Set(props.rows.map(laneOf))].slice(0, MAX_LANES)
  const max = Math.max(1e-9, ...props.rows.map(r => Math.abs(r.amount)))

  const out: Bar[] = []
  for (const r of props.rows) {
    const xi = keys.indexOf(r.key)
    const yi = lanes.indexOf(laneOf(r))
    if (xi < 0 || yi < 0) continue
    out.push({
      x: keys.length > 1 ? xi / (keys.length - 1) : 0.5,
      y: lanes.length > 1 ? yi / (lanes.length - 1) : 0.5,
      value: Math.abs(r.amount) / max,
      provider: r.provider,
      content: r.content,
      key: r.key,
    })
  }
  return out
})

const labels = computed(() => {
  const totals = new Map<string, number>()
  for (const r of props.rows) totals.set(r.key, (totals.get(r.key) ?? 0) + Math.abs(r.amount))
  const keys = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_COLS).map(([k]) => k)
  const laneOf = (r: FlatContribution): string => (mode.value === 'provider' ? r.provider : r.content)
  const lanes = [...new Set(props.rows.map(laneOf))].slice(0, MAX_LANES)
  return { xLabels: keys.map(props.labelOf), yLabels: lanes }
})

let raf = 0
function draw() {
  const canvas = canvasEl.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr
    canvas.height = h * dpr
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const ink = (a: number) => `rgba(${readThemeVar('--scene-ink-rgb')}, ${a})`
  const cx = w / 2
  const cy = h / 2 + 40
  const scale = Math.min(w, h) * 0.9

  const project = (x: number, y: number, z: number) => {
    const p = project3d(x, y, z, { ...cam.value, zoom: cam.value.zoom * scale })
    return { x: cx + p.sx, y: cy + p.sy, depth: p.depth }
  }

  // 底面网格（帮助判读 X/Y 位置）
  ctx.strokeStyle = ink(0.12)
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const t = i / 4
    const a = project(t, 0, 0); const b = project(t, 1, 0)
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    const c = project(0, t, 0); const d = project(1, t, 0)
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke()
  }

  // 柱体：按 depth 从远到近画（画家算法，近处覆盖远处）
  const sorted = [...bars.value].sort((a, b) => project(b.x, b.y, 0).depth - project(a.x, a.y, 0).depth)
  for (const bar of sorted) {
    const w2 = 0.018
    const base = project(bar.x, bar.y, 0)
    const top = project(bar.x, bar.y, bar.value)
    const glow = 0.35 + 0.65 * bar.value
    ctx.fillStyle = ink(glow * 0.85)
    ctx.strokeStyle = ink(glow)
    ctx.lineWidth = 1
    const half = w2 * scale * 0.5
    ctx.fillRect(top.x - half, top.y, half * 2, base.y - top.y)
    ctx.strokeRect(top.x - half, top.y, half * 2, base.y - top.y)
    // 顶盖高亮
    ctx.fillStyle = ink(glow)
    ctx.fillRect(top.x - half, top.y - 2, half * 2, 2)
  }

  // 轴标签
  ctx.fillStyle = ink(0.66)
  ctx.font = '11px system-ui, sans-serif'
  labels.value.xLabels.forEach((label, i) => {
    const n = labels.value.xLabels.length
    const p = project(n > 1 ? i / (n - 1) : 0.5, 0, 0)
    ctx.fillText(label, p.x - 18, p.y + 16)
  })
  labels.value.yLabels.forEach((label, i) => {
    const n = labels.value.yLabels.length
    const p = project(0, n > 1 ? i / (n - 1) : 0.5, 0)
    ctx.textAlign = 'right'
    ctx.fillText(label.slice(0, 10), p.x - 8, p.y + 4)
    ctx.textAlign = 'left'
  })
}

function scheduleDraw() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(draw)
}

// 拖拽旋转
let dragging = false
let lastX = 0
let lastY = 0
function onDown(e: PointerEvent) {
  dragging = true
  lastX = e.clientX
  lastY = e.clientY
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
}
function onMove(e: PointerEvent) {
  if (!dragging) return
  const dx = e.clientX - lastX
  const dy = e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
  cam.value = {
    ...cam.value,
    yaw: cam.value.yaw + dx * 0.4,
    pitch: Math.max(-10, Math.min(80, cam.value.pitch + dy * 0.3)),
  }
  scheduleDraw()
}
function onUp() { dragging = false }

let ro: ResizeObserver | null = null
onMounted(() => {
  const canvas = canvasEl.value
  if (!canvas) return
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  ro = new ResizeObserver(() => scheduleDraw())
  ro.observe(canvas)
  scheduleDraw()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  ro?.disconnect()
  const canvas = canvasEl.value
  if (!canvas) return
  canvas.removeEventListener('pointerdown', onDown)
  canvas.removeEventListener('pointermove', onMove)
  canvas.removeEventListener('pointerup', onUp)
  canvas.removeEventListener('pointercancel', onUp)
})

watch([bars, mode], () => scheduleDraw())
</script>

<style scoped>
.contrib3d-root { display: flex; flex-direction: column; gap: 8px; }
.contrib3d-controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.ctl-label { color: var(--app-text-dim); font-size: 12px; }
.muted { color: var(--app-text-dim); font-size: 12px; }
.contrib3d-canvas-wrap {
  position: relative;
  width: 100%;
  height: 420px;
  border-radius: 6px;
  /* 场景底与墨必须成对（--scene-* 令牌），否则亮色主题下对比度会塌 */
  background: radial-gradient(circle at 50% 45%, var(--scene-bg-inner) 0%, var(--scene-bg-outer) 100%);
  border: 1px solid var(--app-border);
  overflow: hidden;
}
.contrib3d-canvas-wrap canvas { width: 100%; height: 100%; cursor: grab; touch-action: none; }
.contrib3d-canvas-wrap canvas:active { cursor: grabbing; }
.contrib3d-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--scene-ink-dim);
  font-size: 12px;
}
</style>
