<template>
  <div class="td3d-root">
    <!-- 顶部操作条 -->
    <div class="td3d-header">
      <div class="td3d-title-group">
        <span class="td3d-title">3D 团队伤害构成透视</span>
        <span class="td3d-subtitle">总伤害: {{ fmt(totalDamage, 0) }}</span>
      </div>

      <div class="td3d-actions">
        <!-- 分类维度切换 -->
        <span class="td3d-label">统计维度:</span>
        <div class="td3d-btn-group">
          <button
            class="td3d-tab-btn"
            :class="{ active: viewDimension === 'category' }"
            @click="viewDimension = 'category'"
          >
            按伤害类型
          </button>
          <button
            class="td3d-tab-btn"
            :class="{ active: viewDimension === 'character' }"
            @click="viewDimension = 'character'"
          >
            按出战角色
          </button>
        </div>

        <!-- 3D 视角模式 -->
        <span class="td3d-label">形态:</span>
        <div class="td3d-btn-group">
          <button
            class="td3d-tab-btn"
            :class="{ active: displayMode === '3d-donut' }"
            @click="displayMode = '3d-donut'"
          >
            3D 环体
          </button>
          <button
            class="td3d-tab-btn"
            :class="{ active: displayMode === '3d-bars' }"
            @click="displayMode = '3d-bars'"
          >
            3D 柱阵
          </button>
          <button
            class="td3d-tab-btn"
            :class="{ active: displayMode === '2d-donut' }"
            @click="displayMode = '2d-donut'"
          >
            2D 平面
          </button>
        </div>

        <button
          class="td3d-icon-btn"
          :class="{ active: autoRotate }"
          :title="autoRotate ? '停止旋转' : '自动旋转'"
          @click="autoRotate = !autoRotate"
        >
          🔄 旋转
        </button>
      </div>
    </div>

    <!-- 3D Canvas 画布容器 -->
    <div
      ref="containerRef"
      class="td3d-canvas-wrap"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerLeave"
      @wheel.prevent="onWheel"
    >
      <canvas ref="canvasRef" class="td3d-canvas" />

      <!-- 悬停探针浮层 HUD -->
      <div
        v-if="hoveredSlice"
        class="td3d-hud"
        :style="{ left: hoveredSlice.hudX + 'px', top: hoveredSlice.hudY + 'px' }"
      >
        <div class="td3d-hud-header">
          <span class="td3d-hud-dot" :style="{ background: hoveredSlice.color }" />
          <span class="td3d-hud-name">{{ hoveredSlice.label }}</span>
        </div>
        <div class="td3d-hud-row">
          <span>伤害数值:</span>
          <b>{{ fmt(hoveredSlice.damage, 0) }}</b>
        </div>
        <div class="td3d-hud-row">
          <span>团队占比:</span>
          <b :style="{ color: hoveredSlice.color }">{{ hoveredSlice.pct.toFixed(1) }}%</b>
        </div>
      </div>

      <!-- 中心总伤害指标（仅在环形模式下显示） -->
      <div v-if="displayMode === '3d-donut' || displayMode === '2d-donut'" class="td3d-center-kpi">
        <div class="td3d-kpi-sub">团队全域总伤</div>
        <div class="td3d-kpi-val">{{ fmt(totalDamage, 0) }}</div>
        <div class="td3d-kpi-hint">{{ currentSlices.length }} 个贡献源</div>
      </div>
    </div>

    <!-- 底部图例 Chips -->
    <div class="td3d-legend">
      <div
        v-for="(item, idx) in currentSlices"
        :key="item.key"
        class="td3d-legend-chip"
        :class="{ active: hoveredIndex === idx }"
        @mouseenter="hoveredIndex = idx; requestRender()"
        @mouseleave="hoveredIndex = -1; requestRender()"
      >
        <span class="td3d-chip-color" :style="{ background: item.color }" />
        <span class="td3d-chip-label">{{ item.label }}</span>
        <b class="td3d-chip-pct">{{ item.pct.toFixed(1) }}%</b>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { fmt } from '@/utils/format'

export interface DamageShareCategory {
  key: string
  label: string
  damage: number
  pct: number
}

export interface CharacterDamageShare {
  agentId: string
  name: string
  pct: number
  categories: DamageShareCategory[]
}

const props = defineProps<{
  totalDamage: number
  categories: DamageShareCategory[]
  characters: CharacterDamageShare[]
}>()

// 视图维度与模式
const viewDimension = ref<'category' | 'character'>('category')
const displayMode = ref<'3d-donut' | '3d-bars' | '2d-donut'>('3d-donut')
const autoRotate = ref(false)

// 元素/类型标准色系表
const TYPE_COLOR_MAP: Record<string, string> = {
  direct: '#60a5fa', // 直伤 浅蓝
  '直伤': '#60a5fa',
  burn: '#ef4444', // 灼烧 鲜红
  '灼烧': '#ef4444',
  shock: '#facc15', // 感电 亮黄
  '感电': '#facc15',
  corrosion: '#a78bfa', // 侵蚀 紫色
  '侵蚀': '#a78bfa',
  assault: '#9ca3af', // 强击 银灰
  '强击': '#9ca3af',
  frost: '#38bdf8', // 碎冰 冰蓝
  '碎冰': '#38bdf8',
  disorder: '#f97316', // 紊乱 橙色
  '紊乱': '#f97316',
  turbulence: '#10b981', // 乱流 翡翠绿
  '乱流': '#10b981',
  aurora: '#ec4899', // 耀变 粉红
  '耀变': '#ec4899',
  release: '#f43f5e', // 异放 玫瑰红
  '异放': '#f43f5e',
}

const CHAR_COLOR_PALETTE = ['#38bdf8', '#f59e0b', '#ec4899', '#10b981', '#a78bfa']

interface SliceData {
  key: string
  label: string
  damage: number
  pct: number
  color: string
  startAngle: number
  endAngle: number
}

// 当前切片数据集
const currentSlices = computed<SliceData[]>(() => {
  const slices: SliceData[] = []
  let accAngle = 0

  if (viewDimension.value === 'category') {
    const list = props.categories.filter(c => c.damage > 0)
    const sum = list.reduce((a, b) => a + b.damage, 0) || 1
    for (const c of list) {
      const pct = (c.damage / sum) * 100
      const span = (pct / 100) * Math.PI * 2
      const color = TYPE_COLOR_MAP[c.key] ?? TYPE_COLOR_MAP[c.label] ?? '#63e2b7'
      slices.push({
        key: c.key,
        label: c.label,
        damage: c.damage,
        pct,
        color,
        startAngle: accAngle,
        endAngle: accAngle + span,
      })
      accAngle += span
    }
  } else {
    // 按角色划分
    const list = props.characters.filter(c => c.pct > 0)
    for (let i = 0; i < list.length; i++) {
      const ch = list[i]
      const span = (ch.pct / 100) * Math.PI * 2
      const color = CHAR_COLOR_PALETTE[i % CHAR_COLOR_PALETTE.length]
      const dmg = (props.totalDamage * ch.pct) / 100
      slices.push({
        key: ch.agentId || `char-${i}`,
        label: ch.name || `角色${i + 1}`,
        damage: dmg,
        pct: ch.pct,
        color,
        startAngle: accAngle,
        endAngle: accAngle + span,
      })
      accAngle += span
    }
  }

  return slices
})

// 交互状态
const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const hoveredIndex = ref<number>(-1)

const rotationAngle = ref<number>(0.2) // 绕 Z 轴旋转弧度
const tiltAngle = ref<number>(0.65) // 俯视倾角 (0 = 顶视, PI/2 = 侧视)
const extrusionDepth = ref<number>(36) // 3D 立体挤出厚度

interface HoverHUD {
  label: string
  damage: number
  pct: number
  color: string
  hudX: number
  hudY: number
}
const hoveredSlice = ref<HoverHUD | null>(null)

let animId: number | null = null

function requestRender() {
  if (animId !== null) return
  animId = requestAnimationFrame(() => {
    animId = null
    render()
  })
}

// ========== 3D Canvas 渲染核心 ==========
function render() {
  const canvas = canvasRef.value
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

  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)

  const cx = w / 2
  const cy = h / 2 - (displayMode.value === '3d-donut' ? 8 : 0)

  if (displayMode.value === '3d-donut') {
    draw3DDonut(ctx, cx, cy)
  } else if (displayMode.value === '3d-bars') {
    draw3DBars(ctx, w, h)
  } else {
    draw2DDonut(ctx, cx, cy)
  }

  ctx.restore()

  if (autoRotate.value) {
    rotationAngle.value = (rotationAngle.value + 0.008) % (Math.PI * 2)
    requestRender()
  }
}

// 绘制 3D 挤出立体环
function draw3DDonut(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const slices = currentSlices.value
  if (slices.length === 0) return

  const rx = 150 // 水平长半轴
  const ry = rx * Math.cos(tiltAngle.value) // 倾斜压扁后的垂直短半轴
  const innerRatio = 0.52
  const inRx = rx * innerRatio
  const inRy = ry * innerRatio
  const depth = extrusionDepth.value

  const rot = rotationAngle.value

  // 1. 绘制底面阴影光晕
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(cx, cy + depth + 10, rx * 1.05, ry * 1.05, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
  ctx.filter = 'blur(10px)'
  ctx.fill()
  ctx.restore()

  // 2. 绘制 3D 柱壁外圈（从后往前绘制避免遮挡错误）
  // 按照与视线的前后关系绘制侧壁
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i]
    const isHovered = hoveredIndex.value === i
    const lift = isHovered ? -12 : 0

    const aStart = s.startAngle + rot
    const aEnd = s.endAngle + rot

    // 绘制外侧下延侧壁
    ctx.beginPath()
    const steps = 24
    const dTheta = (aEnd - aStart) / steps

    // 顶面外弧
    for (let st = 0; st <= steps; st++) {
      const th = aStart + st * dTheta
      const x = cx + rx * Math.cos(th)
      const y = cy + ry * Math.sin(th) + lift
      if (st === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }

    // 底面外弧（反向）
    for (let st = steps; st >= 0; st--) {
      const th = aStart + st * dTheta
      const x = cx + rx * Math.cos(th)
      const y = cy + ry * Math.sin(th) + depth + lift
      ctx.lineTo(x, y)
    }

    ctx.closePath()

    // 侧壁光照阴影
    const midAngle = (aStart + aEnd) / 2
    const lightFactor = Math.max(0.45, Math.min(0.95, 0.7 + 0.3 * Math.sin(midAngle)))
    ctx.fillStyle = shadeColor(s.color, -30 * (1 - lightFactor))
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
    ctx.lineWidth = 0.8
    ctx.stroke()
  }

  // 3. 绘制每个切片的顶面（Top Cap）
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i]
    const isHovered = hoveredIndex.value === i
    const lift = isHovered ? -12 : 0

    const aStart = s.startAngle + rot
    const aEnd = s.endAngle + rot

    ctx.beginPath()
    // 外圆弧
    ctx.ellipse(cx, cy + lift, rx, ry, 0, aStart, aEnd, false)
    // 内圆弧（反向）
    ctx.ellipse(cx, cy + lift, inRx, inRy, 0, aEnd, aStart, true)
    ctx.closePath()

    // 渐变光照
    const grad = ctx.createRadialGradient(cx - rx * 0.3, cy - ry * 0.3 + lift, inRx * 0.8, cx, cy + lift, rx)
    grad.addColorStop(0, shadeColor(s.color, isHovered ? 25 : 10))
    grad.addColorStop(1, s.color)

    ctx.fillStyle = grad
    ctx.fill()

    ctx.strokeStyle = isHovered ? '#ffffff' : 'rgba(255, 255, 255, 0.22)'
    ctx.lineWidth = isHovered ? 2 : 1
    ctx.stroke()
  }
}

// 绘制 3D 柱状阵列 (3D Isometric Bars)
function draw3DBars(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const slices = currentSlices.value
  if (slices.length === 0) return

  const n = slices.length
  const maxDmg = Math.max(...slices.map(s => s.damage), 1)
  const barW = Math.min(52, (w - 120) / n - 16)
  const maxBarH = h * 0.52
  const baseX = 60
  const baseY = h - 60
  const isoDepth = 18

  for (let i = 0; i < n; i++) {
    const s = slices[i]
    const isHover = hoveredIndex.value === i
    const x = baseX + i * (barW + 24)
    const barH = (s.damage / maxDmg) * maxBarH + (isHover ? 8 : 0)
    const y = baseY - barH

    // 1. 柱体正面
    ctx.fillStyle = s.color
    ctx.fillRect(x, y, barW, barH)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
    ctx.strokeRect(x, y, barW, barH)

    // 2. 柱体顶面 (Isometric Top)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + isoDepth, y - isoDepth * 0.6)
    ctx.lineTo(x + barW + isoDepth, y - isoDepth * 0.6)
    ctx.lineTo(x + barW, y)
    ctx.closePath()
    ctx.fillStyle = shadeColor(s.color, 25)
    ctx.fill()
    ctx.stroke()

    // 3. 柱体侧面 (Isometric Side)
    ctx.beginPath()
    ctx.moveTo(x + barW, y)
    ctx.lineTo(x + barW + isoDepth, y - isoDepth * 0.6)
    ctx.lineTo(x + barW + isoDepth, baseY - isoDepth * 0.6)
    ctx.lineTo(x + barW, baseY)
    ctx.closePath()
    ctx.fillStyle = shadeColor(s.color, -25)
    ctx.fill()
    ctx.stroke()

    // 标签与数值（⚠ Canvas 不解析 var() ⇒ 必须读回真实色值，见 cssVarColor 注释）
    ctx.fillStyle = isHover ? '#ffffff' : cssVarColor('--fg-3', 'rgba(255,255,255,0.55)')
    ctx.font = '10px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(s.label, x + barW / 2, baseY + 18)
    ctx.fillStyle = s.color
    ctx.fillText(`${s.pct.toFixed(1)}%`, x + barW / 2, y - isoDepth * 0.6 - 6)
  }
}

// 绘制 2D 平面环形
function draw2DDonut(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const slices = currentSlices.value
  if (slices.length === 0) return

  const r = 135
  const inR = 75

  for (let i = 0; i < slices.length; i++) {
    const s = slices[i]
    const isHover = hoveredIndex.value === i
    const expand = isHover ? 6 : 0

    ctx.beginPath()
    ctx.arc(cx, cy, r + expand, s.startAngle, s.endAngle, false)
    ctx.arc(cx, cy, inR, s.endAngle, s.startAngle, true)
    ctx.closePath()

    ctx.fillStyle = s.color
    ctx.fill()
    ctx.strokeStyle = isHover ? '#ffffff' : 'rgba(255, 255, 255, 0.18)'
    ctx.lineWidth = isHover ? 2 : 1
    ctx.stroke()
  }
}

// 颜色明暗调制辅助
function shadeColor(hex: string, percent: number): string {
  let c = hex.startsWith('#') ? hex.slice(1) : hex
  if (c.length === 3) c = c.split('').map(x => x + x).join('')
  const num = parseInt(c, 16)
  const amt = Math.round(2.55 * percent)
  const R = Math.min(255, Math.max(0, (num >> 16) + amt))
  const G = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amt))
  const B = Math.min(255, Math.max(0, (num & 0x0000ff) + amt))
  return `rgb(${R},${G},${B})`
}

/**
 * Canvas 用的主题色取值。
 *
 * ⚠ **不要写 `ctx.fillStyle = 'var(--wa-450)'`**：Canvas 的 fillStyle **不解析 CSS 变量**
 * （它不是 CSS 属性赋值，而是 CanvasRenderingContext2D 的 IDL 属性）⇒ 浏览器**静默忽略**该赋值，
 * 画布继续用**上一次**的颜色 ⇒ 观感错乱且不报错。实测（2026-09-18 round 29）本文件
 * 的 3D 柱阵标签就是这样：非 hover 时继承了上一笔的 `shadeColor(s.color, -25)`。
 * 正解 = 从计算样式读回真实色值（跟随主题），取不到再回落。
 */
function cssVarColor(name: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

// ========== 鼠标交互与射线判定 ==========
let isDragging = false
let startX = 0
let startY = 0
let startRot = 0
let startTilt = 0

function onPointerDown(e: PointerEvent) {
  isDragging = true
  startX = e.clientX
  startY = e.clientY
  startRot = rotationAngle.value
  startTilt = tiltAngle.value
  autoRotate.value = false
  ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (isDragging) {
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    rotationAngle.value = (startRot + dx * 0.01 + Math.PI * 2) % (Math.PI * 2)
    tiltAngle.value = Math.max(0.2, Math.min(1.3, startTilt + dy * 0.008))
    requestRender()
  } else {
    detectHover(e)
  }
}

function onPointerUp(e: PointerEvent) {
  isDragging = false
  ;(e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId)
}

function onPointerLeave() {
  isDragging = false
  hoveredIndex.value = -1
  hoveredSlice.value = null
  requestRender()
}

function onWheel(e: WheelEvent) {
  tiltAngle.value = Math.max(0.2, Math.min(1.3, tiltAngle.value + (e.deltaY > 0 ? 0.04 : -0.04)))
  requestRender()
}

// 检测鼠标悬停在哪个切片上
function detectHover(e: MouseEvent) {
  if (!canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top

  const cx = rect.width / 2
  const cy = rect.height / 2

  if (displayMode.value === '3d-donut' || displayMode.value === '2d-donut') {
    const dx = mx - cx
    const dy = (my - cy) / (displayMode.value === '3d-donut' ? Math.cos(tiltAngle.value) : 1)
    const dist = Math.hypot(dx, dy)

    if (dist >= 60 && dist <= 170) {
      let angle = (Math.atan2(dy, dx) - rotationAngle.value) % (Math.PI * 2)
      if (angle < 0) angle += Math.PI * 2

      const idx = currentSlices.value.findIndex(s => angle >= s.startAngle && angle < s.endAngle)
      if (idx >= 0) {
        hoveredIndex.value = idx
        const item = currentSlices.value[idx]
        hoveredSlice.value = {
          label: item.label,
          damage: item.damage,
          pct: item.pct,
          color: item.color,
          hudX: Math.min(rect.width - 150, Math.max(10, mx + 12)),
          hudY: Math.min(rect.height - 90, Math.max(10, my - 40)),
        }
        requestRender()
        return
      }
    }
  }

  hoveredIndex.value = -1
  hoveredSlice.value = null
  requestRender()
}

// 尺寸监听与初始化
let ro: ResizeObserver | null = null

onMounted(() => {
  if (containerRef.value) {
    ro = new ResizeObserver(() => requestRender())
    ro.observe(containerRef.value)
  }
  requestRender()
})

onUnmounted(() => {
  if (ro) ro.disconnect()
  if (animId !== null) cancelAnimationFrame(animId)
})

watch(
  () => [props.totalDamage, props.categories, props.characters],
  () => requestRender(),
  { deep: true },
)
</script>

<style scoped>
.td3d-root {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.td3d-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  background: var(--wa-30);
  border: 1px solid var(--fill-active);
  border-radius: 6px;
  padding: 8px 12px;
}

.td3d-title-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

.td3d-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--wa-800);
}

.td3d-subtitle {
  font-size: 11px;
  color: #63e2b7;
  background: rgba(99, 226, 183, 0.12);
  padding: 1px 6px;
  border-radius: 4px;
}

.td3d-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.td3d-label {
  font-size: 11px;
  color: var(--wa-450);
}

.td3d-btn-group {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
}

.td3d-tab-btn {
  background: var(--wa-30);
  border: none;
  font-size: 11px;
  color: var(--wa-500);
  padding: 3px 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.td3d-tab-btn:hover {
  background: var(--fill-hover);
  color: var(--wa-800);
}

.td3d-tab-btn.active {
  background: rgba(56, 189, 248, 0.15);
  color: #38bdf8;
  font-weight: 500;
}

.td3d-icon-btn {
  background: var(--wa-40);
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 11px;
  color: var(--wa-500);
  padding: 2px 7px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.td3d-icon-btn:hover {
  border-color: var(--wa-300);
}

.td3d-icon-btn.active {
  border-color: #f59e0b;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.15);
}

.td3d-canvas-wrap {
  position: relative;
  width: 100%;
  height: 340px;
  background: radial-gradient(circle at 50% 45%, rgba(26, 32, 54, 0.5) 0%, rgba(12, 16, 24, 0.9) 100%);
  border: 1px solid var(--fill-active);
  border-radius: 8px;
  overflow: hidden;
  cursor: grab;
}

.td3d-canvas-wrap:active {
  cursor: grabbing;
}

.td3d-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.td3d-hud {
  position: absolute;
  pointer-events: none;
  background: rgba(14, 18, 28, 0.9);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 11px;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
}

.td3d-hud-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-weight: 600;
  color: #ffffff;
}

.td3d-hud-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.td3d-hud-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--wa-450);
  margin-bottom: 2px;
}

.td3d-center-kpi {
  position: absolute;
  top: 48%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
}

.td3d-kpi-sub {
  font-size: 10px;
  color: var(--wa-400);
  letter-spacing: 0.5px;
}

.td3d-kpi-val {
  font-size: 16px;
  font-weight: 700;
  color: #ffffff;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
}

.td3d-kpi-hint {
  font-size: 10px;
  color: var(--wa-400);
}

.td3d-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0;
}

.td3d-legend-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 3px 8px;
  background: var(--wa-30);
  border: 1px solid var(--fill-active);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.td3d-legend-chip:hover,
.td3d-legend-chip.active {
  border-color: var(--app-primary);
  background: rgba(99, 226, 183, 0.12);
}

.td3d-chip-color {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.td3d-chip-label {
  color: var(--wa-500);
}

.td3d-chip-pct {
  color: var(--wa-800);
}
</style>
