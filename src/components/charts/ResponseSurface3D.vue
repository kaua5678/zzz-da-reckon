<template>
  <div class="rs3d-root">
    <!-- 控制栏：双变量选择与预设 -->
    <div class="rs3d-controls">
      <div class="rs3d-var-row">
        <div class="rs3d-var-item">
          <span class="rs3d-ctl-label">X 轴变量</span>
          <n-select
            v-model:value="varXId"
            :options="varOptions"
            :render-label="renderVarLabel"
            size="small"
            filterable
            style="width: 200px"
            placeholder="选择 X 变量"
          />
          <span v-if="curValX !== undefined" class="rs3d-cur-badge">当前: {{ fmt(curValX, 1) }}{{ selVarX?.suffix ?? '' }}</span>
        </div>

        <div class="rs3d-var-item">
          <span class="rs3d-ctl-label">Y 轴变量</span>
          <n-select
            v-model:value="varYId"
            :options="varOptions"
            :render-label="renderVarLabel"
            size="small"
            filterable
            style="width: 200px"
            placeholder="选择 Y 变量"
          />
          <span v-if="curValY !== undefined" class="rs3d-cur-badge">当前: {{ fmt(curValY, 1) }}{{ selVarY?.suffix ?? '' }}</span>
        </div>

        <div class="rs3d-var-item">
          <span class="rs3d-ctl-label">精度</span>
          <n-select
            v-model:value="gridDensity"
            :options="densityOptions"
            size="small"
            style="width: 95px"
          />
        </div>

        <div class="rs3d-action-item">
          <n-button size="small" type="primary" :loading="computing" @click="runCompute">
            {{ surfaceReady ? '重新计算曲面' : '生成 3D 曲面' }}
          </n-button>
        </div>
      </div>

      <!-- 快速预设对 -->
      <div class="rs3d-presets-row">
        <span class="rs3d-preset-title">快捷对比对:</span>
        <span
          v-for="p in PRESET_PAIRS"
          :key="p.label"
          class="rs3d-preset-chip"
          :class="{ active: isPresetActive(p) }"
          @click="applyPreset(p)"
        >
          {{ p.label }}
        </span>
      </div>

      <!-- 计算进度条 -->
      <div v-if="computing && progress" class="rs3d-progress-wrap">
        <n-progress
          type="line"
          :percentage="Math.round(progress.pct * 100)"
          :show-indicator="false"
          status="info"
          processing
          style="margin-bottom: 4px"
        />
        <div class="rs3d-progress-text">
          <span>{{ progress.text }}</span>
          <span>已耗时 {{ ((Date.now() - progress.startTime) / 1000).toFixed(1) }}s</span>
        </div>
      </div>
    </div>

    <!-- 3D 视图主区域 -->
    <div class="rs3d-viewport-wrap">
      <!-- 视口操作栏 -->
      <div class="rs3d-toolbar">
        <div class="rs3d-toolbar-left">
          <span class="rs3d-mode-label">视角:</span>
          <n-button size="tiny" quaternary :type="cameraMode === 'iso' ? 'primary' : 'default'" @click="setCameraView('iso')">
            等轴 3D
          </n-button>
          <n-button size="tiny" quaternary :type="cameraMode === 'top' ? 'primary' : 'default'" @click="setCameraView('top')">
            顶视热力
          </n-button>
          <n-button size="tiny" quaternary :type="cameraMode === 'side' ? 'primary' : 'default'" @click="setCameraView('side')">
            侧视剖面
          </n-button>
          <n-button size="tiny" quaternary @click="resetCamera">
            复位
          </n-button>
          <n-button size="tiny" quaternary :type="autoSpin ? 'warning' : 'default'" @click="autoSpin = !autoSpin">
            {{ autoSpin ? '停止自转' : '缓动自转' }}
          </n-button>
        </div>

        <div class="rs3d-toolbar-right">
          <span class="rs3d-mode-label">渲染:</span>
          <span class="rs3d-chip-toggle" :class="{ on: renderStyle === 'surface' }" @click="renderStyle = 'surface'">
            光照曲面
          </span>
          <span class="rs3d-chip-toggle" :class="{ on: renderStyle === 'wireframe' }" @click="renderStyle = 'wireframe'">
            霓虹网格
          </span>
          <span class="rs3d-chip-toggle" :class="{ on: showContours }" @click="showContours = !showContours">
            等高线
          </span>
          <span class="rs3d-chip-toggle" :class="{ on: showFloorContours }" @click="showFloorContours = !showFloorContours">
            底面投影
          </span>
        </div>
      </div>

      <!-- 3D Canvas 容器 -->
      <div
        ref="containerRef"
        class="rs3d-canvas-container"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="onPointerLeave"
        @wheel.prevent="onWheel"
        @dblclick="resetCamera"
      >
        <canvas ref="canvasRef" class="rs3d-canvas" />

        <!-- 悬停 HUD 探针浮层 -->
        <div
          v-if="hoverInfo"
          class="rs3d-hud"
          :style="{ left: hoverInfo.hudX + 'px', top: hoverInfo.hudY + 'px' }"
        >
          <div class="rs3d-hud-title">📍 坐标探针</div>
          <div class="rs3d-hud-row">
            <span class="rs3d-hud-lbl">{{ selVarX?.label ?? 'X' }}:</span>
            <b>{{ fmt(hoverInfo.x, 1) }}{{ selVarX?.suffix ?? '' }}</b>
          </div>
          <div class="rs3d-hud-row">
            <span class="rs3d-hud-lbl">{{ selVarY?.label ?? 'Y' }}:</span>
            <b>{{ fmt(hoverInfo.y, 1) }}{{ selVarY?.suffix ?? '' }}</b>
          </div>
          <div class="rs3d-hud-row rs3d-hud-highlight">
            <span class="rs3d-hud-lbl">队伍总伤害:</span>
            <b>{{ fmt(hoverInfo.z, 0) }}</b>
          </div>
          <div class="rs3d-hud-row">
            <span class="rs3d-hud-lbl">相对当前落点:</span>
            <b :style="{ color: hoverInfo.deltaPct >= 0 ? '#63e2b7' : '#ef4444' }">
              {{ hoverInfo.deltaPct >= 0 ? '+' : '' }}{{ hoverInfo.deltaPct.toFixed(2) }}%
            </b>
          </div>
        </div>

        <!-- 状态标签指示器 -->
        <div class="rs3d-legend-bar">
          <div class="rs3d-legend-item">
            <span class="rs3d-marker-dot dot-cur" />
            <span>当前实战落点: {{ fmt(curZ, 0) }}</span>
          </div>
          <div class="rs3d-legend-item">
            <span class="rs3d-marker-dot dot-max" />
            <span>全域最高峰值: {{ fmt(maxZ, 0) }} (+{{ maxDeltaPct.toFixed(1) }}%)</span>
          </div>
          <div class="rs3d-legend-item">
            <span class="rs3d-color-spectrum" />
            <span class="rs3d-spectrum-labels">{{ fmt(minZ, 0) }} ➔ {{ fmt(maxZ, 0) }}</span>
          </div>
        </div>

        <!-- 未计算时的空状态覆盖 -->
        <div v-if="!surfaceReady && !computing" class="rs3d-empty-overlay">
          <div class="rs3d-empty-icon">📊</div>
          <div class="rs3d-empty-text">选择两个变量后，点击「生成 3D 曲面」查看伤害联合响应全景</div>
          <n-button size="small" type="primary" secondary @click="runCompute">
            立即生成 ({{ selVarX?.label }} × {{ selVarY?.label }})
          </n-button>
        </div>
      </div>

      <!-- 交互提示说明 -->
      <div class="rs3d-help-hint">
        💡 交互提示：按住鼠标左键拖动可 360° 自由旋转视角；滚轮缩放；Shift + 拖动平移；双击复位视角；鼠标悬停可探查曲面任一点坐标与增幅。
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { NButton, NSelect, NProgress } from 'naive-ui'
import { fmt } from '@/utils/format'

interface ImpactVar {
  id: string
  label: string
  defaultRange: [number, number]
  suffix?: string
}

const props = defineProps<{
  allVars: ImpactVar[]
  readVar: (id: string) => number
  writeVar: (id: string, value: number) => void
  readDamageSnapshot: () => { x: number; y: number; byType: Record<string, number> }
  teamTotalDamage: number
  hasTeam: boolean
  varOptions: Array<{ label: string; value: string }>
  renderVarLabel: (opt: { label: string; value: string }) => any
}>()

// 预设双变量对
const PRESET_PAIRS = [
  { label: '双暴配比 (Boss失衡 × 无敌)', x: 'bossStunValue', y: 'bossInvincible' },
  { label: '环境压迫 (总时间 × Boss失衡)', x: 'totalTime', y: 'bossStunValue' },
  { label: '易伤与异常 (失衡易伤 × 异常系数)', x: 'stunVulnerability', y: 'anomalyCoeff' },
  { label: '双抗压制 (物理抗性 × 火抗性)', x: 'physicalResistance', y: 'fireResistance' },
]

// 变量选择
const varXId = ref<string>('bossStunValue')
const varYId = ref<string>('bossInvincible')
const gridDensity = ref<number>(13) // 默认 13x13 = 169 点

const densityOptions = [
  { label: '快速 (9×9)', value: 9 },
  { label: '标准 (13×13)', value: 13 },
  { label: '精细 (17×17)', value: 17 },
]

const selVarX = computed(() => props.allVars.find(v => v.id === varXId.value))
const selVarY = computed(() => props.allVars.find(v => v.id === varYId.value))

const curValX = computed(() => props.readVar(varXId.value))
const curValY = computed(() => props.readVar(varYId.value))

function isPresetActive(p: { x: string; y: string }) {
  return varXId.value === p.x && varYId.value === p.y
}

function applyPreset(p: { x: string; y: string }) {
  varXId.value = p.x
  varYId.value = p.y
  nextTick(() => {
    runCompute()
  })
}

// 进度与状态
const computing = ref(false)
const progress = ref<{ current: number; total: number; pct: number; text: string; startTime: number } | null>(null)
const surfaceReady = ref(false)
const zGrid = ref<number[][]>([])
const xGrid = ref<number[]>([])
const yGrid = ref<number[]>([])
const minZ = ref<number>(0)
const maxZ = ref<number>(1)
const curZ = ref<number>(0)
const maxCoords = ref<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 })

const maxDeltaPct = computed(() => {
  if (curZ.value <= 0) return 0
  return ((maxZ.value - curZ.value) / curZ.value) * 100
})

// 3D 摄像机与渲染选项
const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)

const cameraMode = ref<'iso' | 'top' | 'side'>('iso')
const renderStyle = ref<'surface' | 'wireframe'>('surface')
const showContours = ref(true)
const showFloorContours = ref(true)
const autoSpin = ref(false)

const yaw = ref(42) // 绕 Z 轴方位角（度）
const pitch = ref(30) // 绕 X 轴俯仰角（度）
const zoom = ref(1.05)
const panX = ref(0)
const panY = ref(10)

// 悬停探针
interface HoverInfo {
  x: number
  y: number
  z: number
  deltaPct: number
  hudX: number
  hudY: number
}
const hoverInfo = ref<HoverInfo | null>(null)

// 视角切换
function setCameraView(mode: 'iso' | 'top' | 'side') {
  cameraMode.value = mode
  autoSpin.value = false
  if (mode === 'iso') {
    yaw.value = 42
    pitch.value = 30
    zoom.value = 1.05
    panX.value = 0
    panY.value = 10
  } else if (mode === 'top') {
    yaw.value = 0
    pitch.value = 88
    zoom.value = 0.95
    panX.value = 0
    panY.value = 0
  } else if (mode === 'side') {
    yaw.value = 90
    pitch.value = 5
    zoom.value = 1.1
    panX.value = 0
    panY.value = 15
  }
  requestRender()
}

function resetCamera() {
  setCameraView('iso')
}

// ========== 计算网格曲面 ==========
async function runCompute() {
  const vx = selVarX.value
  const vy = selVarY.value
  if (!vx || !vy) return

  computing.value = true
  surfaceReady.value = false
  hoverInfo.value = null

  const origX = props.readVar(vx.id)
  const origY = props.readVar(vy.id)
  curZ.value = props.teamTotalDamage

  const N = gridDensity.value
  const totalPoints = N * N
  const [minX, maxX] = vx.defaultRange
  const [minY, maxY] = vy.defaultRange

  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < N; i++) {
    xs.push(minX + ((maxX - minX) / (N - 1)) * i)
    ys.push(minY + ((maxY - minY) / (N - 1)) * i)
  }

  const grid: number[][] = []
  let globalMin = Infinity
  let globalMax = -Infinity
  let peakPoint = { x: minX, y: minY, z: 0 }

  const startTime = Date.now()
  progress.value = { current: 0, total: totalPoints, pct: 0, text: `计算 3D 响应面 (0/${totalPoints})…`, startTime }

  const BATCH_SIZE = 8

  try {
    let completed = 0

    for (let i = 0; i < N; i++) {
      grid[i] = []
      const xVal = xs[i]

      for (let j = 0; j < N; j++) {
        const yVal = ys[j]

        props.writeVar(vx.id, xVal)
        props.writeVar(vy.id, yVal)

        // 让出主线程以保持 UI 响应
        if (completed % BATCH_SIZE === 0) {
          await new Promise(r => setTimeout(r, 0))
        }

        const snap = props.readDamageSnapshot()
        const zVal = snap.y
        grid[i][j] = zVal

        if (zVal < globalMin) globalMin = zVal
        if (zVal > globalMax) {
          globalMax = zVal
          peakPoint = { x: xVal, y: yVal, z: zVal }
        }

        completed++
        if (completed % 5 === 0 || completed === totalPoints) {
          const pct = completed / totalPoints
          const elapsed = (Date.now() - startTime) / 1000
          const eta = pct > 0 ? (elapsed / pct) * (1 - pct) : 0
          progress.value = {
            current: completed,
            total: totalPoints,
            pct,
            text: `采样中 ${completed}/${totalPoints} · 预计剩余 ${eta.toFixed(0)}s`,
            startTime,
          }
        }
      }
    }

    // 恢复原始参数
    props.writeVar(vx.id, origX)
    props.writeVar(vy.id, origY)
    await new Promise(r => setTimeout(r, 0))

    // 存储数据
    xGrid.value = xs
    yGrid.value = ys
    zGrid.value = grid
    minZ.value = globalMin === Infinity ? 0 : globalMin
    maxZ.value = globalMax === -Infinity ? 1 : globalMax
    maxCoords.value = peakPoint
    surfaceReady.value = true
  } catch (err) {
    console.error('3D 曲面计算失败:', err)
  } finally {
    computing.value = false
    progress.value = null
    nextTick(() => {
      requestRender()
    })
  }
}

// ========== 3D Canvas 渲染引擎 ==========
let animationFrameId: number | null = null

function requestRender() {
  if (animationFrameId !== null) return
  animationFrameId = requestAnimationFrame(() => {
    animationFrameId = null
    drawScene()
  })
}

// 颜色映射函数（由低到高的渐变色）
function getZColor(normalizedZ: number, lighting = 1.0): { r: number; g: number; b: number; css: string } {
  const t = Math.max(0, Math.min(1, normalizedZ))
  let r = 0, g = 0, b = 0

  if (t < 0.25) {
    const s = t / 0.25
    r = 30 + s * 10
    g = 58 + s * 80
    b = 138 + s * 110 // Deep Navy -> Royal Blue
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25
    r = 40 - s * 30
    g = 138 + s * 50
    b = 248 - s * 35 // Royal Blue -> Teal/Cyan
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25
    r = 10 + s * 230
    g = 188 - s * 30
    b = 213 - s * 200 // Teal -> Amber/Gold
  } else {
    const s = (t - 0.75) / 0.25
    r = 240 + s * 15
    g = 158 - s * 90
    b = 13 - s * 13 // Amber/Gold -> Crimson Red
  }

  const litR = Math.min(255, Math.max(0, Math.round(r * lighting)))
  const litG = Math.min(255, Math.max(0, Math.round(g * lighting)))
  const litB = Math.min(255, Math.max(0, Math.round(b * lighting)))

  return { r: litR, g: litG, b: litB, css: `rgb(${litR},${litG},${litB})` }
}

interface ProjectedPoint {
  screenX: number
  screenY: number
  depth: number
  worldX: number
  worldY: number
  worldZ: number
  normZ: number
}

function projectPoint(
  wx: number,
  wy: number,
  wz: number,
  cx: number,
  cy: number,
  scale: number,
): ProjectedPoint {
  // 归一化输入范围：wx in [-1, 1], wy in [-1, 1], wz in [0, 1]
  const radY = (yaw.value * Math.PI) / 180
  const radP = (pitch.value * Math.PI) / 180

  const cosY = Math.cos(radY)
  const sinY = Math.sin(radY)
  const cosP = Math.cos(radP)
  const sinP = Math.sin(radP)

  const zShifted = wz - 0.5

  // 1. 绕 Z 轴旋转 (Yaw)
  const x1 = wx * cosY - wy * sinY
  const y1 = wx * sinY + wy * cosY
  const z1 = zShifted

  // 2. 绕 X 轴旋转 (Pitch)
  const x2 = x1
  const y2 = y1 * cosP - z1 * sinP
  const z2 = y1 * sinP + z1 * cosP

  // 3. 弱透视除法（增加纵深感，同时避免严重畸变）
  const cameraDist = 4.2
  const k = cameraDist / (cameraDist + y2)

  const screenX = cx + panX.value + x2 * scale * zoom.value * k
  const screenY = cy + panY.value - z2 * scale * zoom.value * k

  return {
    screenX,
    screenY,
    depth: y2,
    worldX: wx,
    worldY: wy,
    worldZ: wz,
    normZ: wz,
  }
}

function drawScene() {
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

  const midX = w / 2
  const midY = h / 2
  const baseScale = Math.min(w, h) * 0.42

  // 绘制深空背景微光与网格底盘
  const bgGrad = ctx.createRadialGradient(midX, midY, 20, midX, midY, w * 0.7)
  bgGrad.addColorStop(0, 'rgba(20, 24, 38, 0.4)')
  bgGrad.addColorStop(1, 'rgba(12, 14, 20, 0)')
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, w, h)

  // 绘制 3D 底座网格（Floor Box）
  drawFloorGrid(ctx, midX, midY, baseScale)

  if (surfaceReady.value && zGrid.value.length > 0) {
    drawSurfaceMesh(ctx, midX, midY, baseScale)
    drawKeyMarkers(ctx, midX, midY, baseScale)
  }

  ctx.restore()

  // 自动旋转驱动
  if (autoSpin.value) {
    yaw.value = (yaw.value + 0.35) % 360
    requestRender()
  }
}

// 绘制底座网格与坐标轴
function drawFloorGrid(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number) {
  const N = 8
  ctx.lineWidth = 1

  // 底面 X-Y 网格线 (z = 0)
  for (let i = 0; i <= N; i++) {
    const t = -1 + (2 / N) * i
    const pX1 = projectPoint(t, -1, 0, cx, cy, scale)
    const pX2 = projectPoint(t, 1, 0, cx, cy, scale)
    ctx.strokeStyle = i === 0 || i === N ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.05)'
    ctx.beginPath()
    ctx.moveTo(pX1.screenX, pX1.screenY)
    ctx.lineTo(pX2.screenX, pX2.screenY)
    ctx.stroke()

    const pY1 = projectPoint(-1, t, 0, cx, cy, scale)
    const pY2 = projectPoint(1, t, 0, cx, cy, scale)
    ctx.beginPath()
    ctx.moveTo(pY1.screenX, pY1.screenY)
    ctx.lineTo(pY2.screenX, pY2.screenY)
    ctx.stroke()
  }

  // 坐标轴标签
  const pOrigin = projectPoint(-1, -1, 0, cx, cy, scale)
  const pXEnd = projectPoint(1.15, -1, 0, cx, cy, scale)
  const pYEnd = projectPoint(-1, 1.15, 0, cx, cy, scale)
  const pZEnd = projectPoint(-1, -1, 1.15, cx, cy, scale)

  // X 轴
  ctx.strokeStyle = '#38bdf8'
  ctx.beginPath()
  ctx.moveTo(pOrigin.screenX, pOrigin.screenY)
  ctx.lineTo(pXEnd.screenX, pXEnd.screenY)
  ctx.stroke()
  ctx.fillStyle = '#38bdf8'
  ctx.font = '10px Inter, system-ui, sans-serif'
  ctx.fillText(`X: ${selVarX.value?.label ?? ''}`, pXEnd.screenX + 4, pXEnd.screenY)

  // Y 轴
  ctx.strokeStyle = '#a78bfa'
  ctx.beginPath()
  ctx.moveTo(pOrigin.screenX, pOrigin.screenY)
  ctx.lineTo(pYEnd.screenX, pYEnd.screenY)
  ctx.stroke()
  ctx.fillStyle = '#a78bfa'
  ctx.fillText(`Y: ${selVarY.value?.label ?? ''}`, pYEnd.screenX + 4, pYEnd.screenY)

  // Z 轴
  ctx.strokeStyle = '#63e2b7'
  ctx.beginPath()
  ctx.moveTo(pOrigin.screenX, pOrigin.screenY)
  ctx.lineTo(pZEnd.screenX, pZEnd.screenY)
  ctx.stroke()
  ctx.fillStyle = '#63e2b7'
  ctx.fillText('Z: 伤害', pZEnd.screenX - 10, pZEnd.screenY - 8)
}

// 绘制曲面多边形网格
function drawSurfaceMesh(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number) {
  const N = zGrid.value.length
  if (N < 2) return

  const zMinVal = minZ.value
  const zRange = Math.max(1, maxZ.value - zMinVal)

  // 1. 投影全网格点
  const proj: ProjectedPoint[][] = []
  for (let i = 0; i < N; i++) {
    proj[i] = []
    const wx = -1 + (2 / (N - 1)) * i
    for (let j = 0; j < N; j++) {
      const wy = -1 + (2 / (N - 1)) * j
      const zVal = zGrid.value[i][j]
      const normZ = (zVal - zMinVal) / zRange
      proj[i][j] = projectPoint(wx, wy, normZ, cx, cy, scale)
    }
  }

  // 2. 构建四边形面元列表并按深度排序 (画家算法)
  interface Quad {
    i: number
    j: number
    avgDepth: number
    avgZ: number
    p00: ProjectedPoint
    p10: ProjectedPoint
    p11: ProjectedPoint
    p01: ProjectedPoint
    normalLighting: number
  }

  const quads: Quad[] = []
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < N - 1; j++) {
      const p00 = proj[i][j]
      const p10 = proj[i + 1][j]
      const p11 = proj[i + 1][j + 1]
      const p01 = proj[i][j + 1]

      const avgDepth = (p00.depth + p10.depth + p11.depth + p01.depth) / 4
      const avgZ = (p00.normZ + p10.normZ + p11.normZ + p01.normZ) / 4

      // 计算表面法向量与方向光照强度
      const v1x = p10.worldX - p00.worldX
      const v1y = p10.worldY - p00.worldY
      const v1z = p10.normZ - p00.normZ

      const v2x = p01.worldX - p00.worldX
      const v2y = p01.worldY - p00.worldY
      const v2z = p01.normZ - p00.normZ

      // 叉乘 nx, ny, nz
      const nx = v1y * v2z - v1z * v2y
      const ny = v1z * v2x - v1x * v2z
      const nz = v1x * v2y - v1y * v2x
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1

      // 光源方向向量 (0.4, 0.5, 0.77)
      const lx = 0.4, ly = 0.5, lz = 0.77
      const dot = (nx * lx + ny * ly + nz * lz) / len
      const normalLighting = Math.max(0.35, Math.min(1.15, 0.5 + 0.65 * dot))

      quads.push({ i, j, avgDepth, avgZ, p00, p10, p11, p01, normalLighting })
    }
  }

  // 深度从远到近排序
  quads.sort((a, b) => b.avgDepth - a.avgDepth)

  // 3. 逐个面元绘制
  for (const q of quads) {
    const color = getZColor(q.avgZ, q.normalLighting)

    ctx.beginPath()
    ctx.moveTo(q.p00.screenX, q.p00.screenY)
    ctx.lineTo(q.p10.screenX, q.p10.screenY)
    ctx.lineTo(q.p11.screenX, q.p11.screenY)
    ctx.lineTo(q.p01.screenX, q.p01.screenY)
    ctx.closePath()

    if (renderStyle.value === 'surface') {
      ctx.fillStyle = color.css
      ctx.fill()
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
      ctx.lineWidth = 0.5
      ctx.stroke()
    } else {
      ctx.fillStyle = 'rgba(10, 16, 28, 0.8)'
      ctx.fill()
      ctx.strokeStyle = color.css
      ctx.lineWidth = 1.2
      ctx.stroke()
    }

    // 绘制等高线 (Iso-Contour)
    if (showContours.value) {
      drawQuadContour(ctx, q)
    }
  }

  // 4. 底面等高线投影 (Floor Contours)
  if (showFloorContours.value) {
    drawFloorProjectedContours(ctx, proj, cx, cy, scale)
  }
}

// 单面元内等高线生成 (Marching linear cuts)
function drawQuadContour(ctx: CanvasRenderingContext2D, q: any) {
  const levels = [0.2, 0.4, 0.6, 0.8]
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'
  ctx.lineWidth = 0.8

  for (const lvl of levels) {
    const pts = [q.p00, q.p10, q.p11, q.p01]
    const zVals = [q.p00.normZ, q.p10.normZ, q.p11.normZ, q.p01.normZ]
    const cuts: { x: number; y: number }[] = []

    for (let e = 0; e < 4; e++) {
      const next = (e + 1) % 4
      const zA = zVals[e]
      const zB = zVals[next]
      if ((zA <= lvl && zB >= lvl) || (zA >= lvl && zB <= lvl)) {
        const factor = Math.abs(zB - zA) < 1e-5 ? 0.5 : (lvl - zA) / (zB - zA)
        cuts.push({
          x: pts[e].screenX + factor * (pts[next].screenX - pts[e].screenX),
          y: pts[e].screenY + factor * (pts[next].screenY - pts[e].screenY),
        })
      }
    }

    if (cuts.length >= 2) {
      ctx.beginPath()
      ctx.moveTo(cuts[0].x, cuts[0].y)
      ctx.lineTo(cuts[1].x, cuts[1].y)
      ctx.stroke()
    }
  }
}

// 底面等高线同心环投影
function drawFloorProjectedContours(
  ctx: CanvasRenderingContext2D,
  proj: ProjectedPoint[][],
  cx: number,
  cy: number,
  scale: number,
) {
  const N = proj.length
  const levels = [0.25, 0.5, 0.75]

  for (const lvl of levels) {
    const color = getZColor(lvl, 0.7)
    ctx.strokeStyle = color.css
    ctx.lineWidth = 0.9

    for (let i = 0; i < N - 1; i++) {
      for (let j = 0; j < N - 1; j++) {
        const z00 = proj[i][j].normZ
        const z10 = proj[i + 1][j].normZ
        const z11 = proj[i + 1][j + 1].normZ
        const z01 = proj[i][j + 1].normZ

        const w00 = { x: -1 + (2 / (N - 1)) * i, y: -1 + (2 / (N - 1)) * j, z: z00 }
        const w10 = { x: -1 + (2 / (N - 1)) * (i + 1), y: -1 + (2 / (N - 1)) * j, z: z10 }
        const w11 = { x: -1 + (2 / (N - 1)) * (i + 1), y: -1 + (2 / (N - 1)) * (j + 1), z: z11 }
        const w01 = { x: -1 + (2 / (N - 1)) * i, y: -1 + (2 / (N - 1)) * (j + 1), z: z01 }

        const edges = [[w00, w10], [w10, w11], [w11, w01], [w01, w00]]
        const cuts: { x: number; y: number }[] = []

        for (const [pA, pB] of edges) {
          if ((pA.z <= lvl && pB.z >= lvl) || (pA.z >= lvl && pB.z <= lvl)) {
            const factor = Math.abs(pB.z - pA.z) < 1e-5 ? 0.5 : (lvl - pA.z) / (pB.z - pA.z)
            const floorX = pA.x + factor * (pB.x - pA.x)
            const floorY = pA.y + factor * (pB.y - pA.y)
            const pFloor = projectPoint(floorX, floorY, 0, cx, cy, scale)
            cuts.push({ x: pFloor.screenX, y: pFloor.screenY })
          }
        }

        if (cuts.length >= 2) {
          ctx.beginPath()
          ctx.moveTo(cuts[0].x, cuts[0].y)
          ctx.lineTo(cuts[1].x, cuts[1].y)
          ctx.stroke()
        }
      }
    }
  }
}

// 绘制当前实战点与全域峰值点
function drawKeyMarkers(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number) {
  const vx = selVarX.value
  const vy = selVarY.value
  if (!vx || !vy) return

  const [minX, maxX] = vx.defaultRange
  const [minY, maxY] = vy.defaultRange
  const zRange = Math.max(1, maxZ.value - minZ.value)

  // 1. 当前配置落点
  const curXVal = curValX.value ?? minX
  const curYVal = curValY.value ?? minY
  const curZVal = curZ.value

  const normCurX = Math.max(-1, Math.min(1, -1 + 2 * ((curXVal - minX) / (maxX - minX || 1))))
  const normCurY = Math.max(-1, Math.min(1, -1 + 2 * ((curYVal - minY) / (maxY - minY || 1))))
  const normCurZ = Math.max(0, Math.min(1, (curZVal - minZ.value) / zRange))

  const pCurTop = projectPoint(normCurX, normCurY, normCurZ, cx, cy, scale)
  const pCurBase = projectPoint(normCurX, normCurY, 0, cx, cy, scale)

  // 垂直投影虚线
  ctx.setLineDash([4, 3])
  ctx.strokeStyle = '#63e2b7'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(pCurTop.screenX, pCurTop.screenY)
  ctx.lineTo(pCurBase.screenX, pCurBase.screenY)
  ctx.stroke()
  ctx.setLineDash([])

  // 底面投影光晕
  ctx.fillStyle = 'rgba(99, 226, 183, 0.4)'
  ctx.beginPath()
  ctx.arc(pCurBase.screenX, pCurBase.screenY, 5, 0, Math.PI * 2)
  ctx.fill()

  // 顶部实战点光球
  ctx.fillStyle = '#63e2b7'
  ctx.beginPath()
  ctx.arc(pCurTop.screenX, pCurTop.screenY, 5.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.5
  ctx.stroke()

  ctx.fillStyle = '#63e2b7'
  ctx.font = 'bold 10px Inter, system-ui, sans-serif'
  ctx.fillText('★ 当前落点', pCurTop.screenX + 8, pCurTop.screenY + 3)

  // 2. 全域最高峰值点
  const peak = maxCoords.value
  const normMaxX = -1 + 2 * ((peak.x - minX) / (maxX - minX || 1))
  const normMaxY = -1 + 2 * ((peak.y - minY) / (maxY - minY || 1))
  const normMaxZ = (peak.z - minZ.value) / zRange

  const pMaxTop = projectPoint(normMaxX, normMaxY, normMaxZ, cx, cy, scale)
  const pMaxBase = projectPoint(normMaxX, normMaxY, 0, cx, cy, scale)

  ctx.setLineDash([3, 3])
  ctx.strokeStyle = '#fbbf24'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(pMaxTop.screenX, pMaxTop.screenY)
  ctx.lineTo(pMaxBase.screenX, pMaxBase.screenY)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.fillStyle = '#fbbf24'
  ctx.beginPath()
  ctx.arc(pMaxTop.screenX, pMaxTop.screenY, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()

  ctx.fillStyle = '#fbbf24'
  ctx.font = 'bold 10px Inter, system-ui, sans-serif'
  ctx.fillText('👑 理论峰值', pMaxTop.screenX + 8, pMaxTop.screenY + 3)
}

// ========== 鼠标与触摸交互 ==========
let isDragging = false
let startX = 0
let startY = 0
let startYaw = 0
let startPitch = 0
let startPanX = 0
let startPanY = 0
let isPanning = false

function onPointerDown(e: PointerEvent) {
  isDragging = true
  isPanning = e.shiftKey || e.button === 2
  startX = e.clientX
  startY = e.clientY
  startYaw = yaw.value
  startPitch = pitch.value
  startPanX = panX.value
  startPanY = panY.value
  autoSpin.value = false
  ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (isDragging) {
    const dx = e.clientX - startX
    const dy = e.clientY - startY

    if (isPanning) {
      panX.value = startPanX + dx
      panY.value = startPanY + dy
    } else {
      yaw.value = (startYaw + dx * 0.5 + 360) % 360
      pitch.value = Math.max(5, Math.min(88, startPitch - dy * 0.4))
    }
    requestRender()
  } else {
    // 悬停探查
    checkHover(e)
  }
}

function onPointerUp(e: PointerEvent) {
  isDragging = false
  isPanning = false
  ;(e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId)
}

function onPointerLeave() {
  isDragging = false
  isPanning = false
  hoverInfo.value = null
}

function onWheel(e: WheelEvent) {
  const delta = e.deltaY < 0 ? 1.08 : 0.92
  zoom.value = Math.max(0.4, Math.min(2.8, zoom.value * delta))
  requestRender()
}

// 悬停最近点射线检测
function checkHover(e: MouseEvent) {
  if (!surfaceReady.value || !canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top

  const N = zGrid.value.length
  if (N < 2) return

  const zMinVal = minZ.value
  const zRange = Math.max(1, maxZ.value - zMinVal)
  const baseScale = Math.min(rect.width, rect.height) * 0.42

  let closestDist = 28 // 像素吸附容差
  let hit: HoverInfo | null = null

  for (let i = 0; i < N; i++) {
    const wx = -1 + (2 / (N - 1)) * i
    for (let j = 0; j < N; j++) {
      const wy = -1 + (2 / (N - 1)) * j
      const zVal = zGrid.value[i][j]
      const normZ = (zVal - zMinVal) / zRange
      const pt = projectPoint(wx, wy, normZ, rect.width / 2, rect.height / 2, baseScale)

      const dist = Math.hypot(pt.screenX - mouseX, pt.screenY - mouseY)
      if (dist < closestDist) {
        closestDist = dist
        const xReal = xGrid.value[i]
        const yReal = yGrid.value[j]
        const deltaPct = curZ.value > 0 ? ((zVal - curZ.value) / curZ.value) * 100 : 0
        hit = {
          x: xReal,
          y: yReal,
          z: zVal,
          deltaPct,
          hudX: Math.min(rect.width - 190, Math.max(10, pt.screenX + 12)),
          hudY: Math.min(rect.height - 110, Math.max(10, pt.screenY - 50)),
        }
      }
    }
  }

  hoverInfo.value = hit
}

// 窗口尺寸自适应
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      requestRender()
    })
    resizeObserver.observe(containerRef.value)
  }
  requestRender()
})

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
})

// 监听外层队伍与伤害变化
watch(
  () => props.teamTotalDamage,
  newVal => {
    curZ.value = newVal
    requestRender()
  },
)
</script>

<style scoped>
.rs3d-root {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.rs3d-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--wa-40);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 10px 14px;
}

.rs3d-var-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
}

.rs3d-var-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.rs3d-ctl-label {
  font-size: 12px;
  color: var(--wa-500);
  white-space: nowrap;
}

.rs3d-cur-badge {
  font-size: 11px;
  color: #63e2b7;
  background: rgba(99, 226, 183, 0.12);
  padding: 2px 6px;
  border-radius: 4px;
}

.rs3d-presets-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.rs3d-preset-title {
  font-size: 11px;
  color: var(--wa-400);
}

.rs3d-preset-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 12px;
  border: 1px solid var(--wa-150);
  color: var(--wa-500);
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.rs3d-preset-chip:hover {
  border-color: var(--app-primary);
  color: var(--app-primary);
}

.rs3d-preset-chip.active {
  border-color: var(--app-primary);
  background: rgba(99, 226, 183, 0.15);
  color: #63e2b7;
}

.rs3d-progress-wrap {
  margin-top: 4px;
}

.rs3d-progress-text {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--wa-450);
}

.rs3d-viewport-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rs3d-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 4px;
}

.rs3d-toolbar-left,
.rs3d-toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.rs3d-mode-label {
  font-size: 11px;
  color: var(--wa-450);
}

.rs3d-chip-toggle {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 4px;
  border: 1px solid var(--line);
  color: var(--wa-450);
  cursor: pointer;
  user-select: none;
  transition: all 0.15s ease;
}

.rs3d-chip-toggle:hover {
  border-color: var(--wa-300);
}

.rs3d-chip-toggle.on {
  border-color: #38bdf8;
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.12);
}

.rs3d-canvas-container {
  position: relative;
  width: 100%;
  height: 480px;
  background: radial-gradient(circle at 50% 50%, rgba(26, 32, 52, 0.6) 0%, rgba(13, 16, 24, 0.95) 100%);
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
  cursor: grab;
}

.rs3d-canvas-container:active {
  cursor: grabbing;
}

.rs3d-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.rs3d-hud {
  position: absolute;
  pointer-events: none;
  background: rgba(15, 20, 32, 0.88);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  padding: 8px 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  font-size: 11px;
  z-index: 10;
  min-width: 160px;
}

.rs3d-hud-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--wa-450);
  margin-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 3px;
}

.rs3d-hud-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 2px;
  gap: 8px;
}

.rs3d-hud-lbl {
  color: var(--wa-400);
}

.rs3d-hud-highlight {
  color: #38bdf8;
  font-weight: 600;
  margin-top: 2px;
}

.rs3d-legend-bar {
  position: absolute;
  left: 12px;
  bottom: 10px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  background: rgba(12, 16, 26, 0.75);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--wa-500);
  pointer-events: none;
}

.rs3d-legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.rs3d-marker-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dot-cur {
  background: #63e2b7;
  box-shadow: 0 0 6px #63e2b7;
}

.dot-max {
  background: #fbbf24;
  box-shadow: 0 0 6px #fbbf24;
}

.rs3d-color-spectrum {
  width: 60px;
  height: 8px;
  border-radius: 2px;
  background: linear-gradient(to right, #1e3a8a, #06b6d4, #10b981, #f59e0b, #ef4444);
}

.rs3d-spectrum-labels {
  font-size: 10px;
  color: var(--wa-400);
}

.rs3d-empty-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 12px;
  background: rgba(14, 18, 28, 0.7);
  backdrop-filter: blur(4px);
  z-index: 5;
}

.rs3d-empty-icon {
  font-size: 36px;
}

.rs3d-empty-text {
  font-size: 13px;
  color: var(--wa-450);
  max-width: 380px;
  text-align: center;
}

.rs3d-help-hint {
  font-size: 11px;
  color: var(--wa-400);
  line-height: 1.5;
  padding: 0 4px;
}
</style>
