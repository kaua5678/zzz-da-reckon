<template>
  <div class="dc3d-root">
    <div class="dc3d-toolbar">
      <span class="dc3d-hint">拖动旋转 · 滚轮缩放 · 悬停看档位</span>
      <div class="dc3d-btns">
        <button class="dc3d-btn" :class="{ active: view === 'iso' }" @click="setView('iso')">斜视</button>
        <button class="dc3d-btn" :class="{ active: view === 'front' }" @click="setView('front')">正视（难度×伤害）</button>
        <button class="dc3d-btn" :class="{ active: view === 'side' }" @click="setView('side')">侧视（版本×伤害）</button>
        <button class="dc3d-btn" :class="{ active: ribbons }" @click="ribbons = !ribbons">幕布</button>
        <button class="dc3d-btn" :class="{ active: wall }" @click="wall = !wall">血量垂面</button>
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
import { project3d, versionGridOf, zGridOf, type BossHpPoint, type Camera3D, type VersionLane } from '@/composables/difficultyCurve3d'
import { seriesForLane, type CurveDatum, type CurveSeries } from '@/composables/difficultyCurve'
import { axisKindLabel } from '@/composables/difficultyAxis'
import { fmt } from '@/utils/format'
import { readThemeVar, useThemeRedraw, withAlpha } from '@/utils/canvasTheme'

/**
 * 场景色一律走 `--scene-*` 令牌（自绘 canvas 场景不能借页面墨色 --wa-* 或 --fg-*：明亮主题下压在场景底上对比度会塌，
 * 见 global.css「3D Canvas 场景」段与 check-tokens 判据 9）。读取与夜间兜底统一走 utils/canvasTheme.ts（CC-348）。
 */
const sceneInk = (alpha: number) => `rgba(${readThemeVar('--scene-ink-rgb')}, ${alpha})`
const sceneDim = () => readThemeVar('--scene-ink-dim')
const sceneDanger = () => readThemeVar('--c-danger')

/**
 * 难度曲线 3D（版本轴）：x = 操作难度绝对值（与 2D 同尺）、y（深度）= 版本道（`deriveVersionAxis`）、z = 伤害。
 * 每队一条道：折线 + 落到地板的「幕布」+ 关键次数跃迁标记；画家算法按道位由近到远画。
 * 纯 canvas 2D 自绘（与 TeamDamage3DChart 同款做法，不引 WebGL），渲染只读 props，不碰 store。
 *
 * 侧视（yaw = 90°）**不是**「把正视图压扁」：此时版本轴与 z 轴共面、难度轴退化成深度 ⇒ 每队退化成
 * 一根竖柱（用户 2026-10-13 报「侧视图没能……表现出选定 boss 的血量膨胀曲线」）。故侧视下额外：
 * ① z 刻度加密到 4 档并画横向网格（给出柱高的读数锚）、② 逐道标版本名（坐标是 `lane.frac`，
 * 留空档时与道序不成比例，标签必须由道位反查）、③ 血量剖面（`bossCurve`）作为版本×伤害垂面叠上去。
 * ⚠「版本刻度」＝**道序**数值而不是版本号：`frac` 是节点序号归一化后的位置，拿节点序号当刻度会与
 * 道位对不上（判据见 `versionGridOf`）。
 * ⚠ 侧视下没有 x 轴可读 ⇒ 难度刻度与 `操作难度绝对值 →` 标题不画（该视角看不到 x），只留版本/伤害两轴。
 */
const props = defineProps<{
  series: CurveSeries[]
  /**
   * 道（顺序 = 画家算法序）。⚠ 用 `laneKey` 而不是 `presetId` 认 series：**环境模式下同一队有多条道**
   * （一个 presetId 对应多期）⇒ 按 presetId 找会全落回第一条，图上只剩一条线。
   * 缺省 `laneKey` = `VersionLane.presetId`（版本轴口径：一队一道）。
   */
  lanes: Array<VersionLane & { laneKey?: string }>
  costMax: number
  ratioMax: number
  colorOf: (presetId: string) => string
  /** 点名 → 可读标签（`baseline` / `axis` / `progress` / `max`，T140c 关键旋钮点） */
  pointLabel: (p: CurveDatum['point']) => string
  /** 版本轴标题（如「版本 = 击破位」） */
  axisLabel: string
  /**
   * z 值口径（用户 2026-09-19② 立项 / 2026-10-13 修订）：
   * - `percent`（缺省）全队同一把尺（伤害/当期血量%，击杀线平面）；
   * - `absolute` 全队绝对伤害 + 选中 Boss 在版本轴上的血量剖面。
   * 两档**都**画血量剖面（用户 2026-10-13「把点面改为选定 boss 的曲线面」）：`percent` 下剖面按
   * **该版本血量 ÷ 当期血量** 换成同一把尺的相对值 ⇒ 它同时承担了「按当前角色版本编号取 Boss 血量
   * 作为 100%」的诉求，而不需要再造第三档口径（用户原话是没画出来，不是口径不对）。
   */
  zMode?: 'percent' | 'absolute'
  /** 绝对伤害模式的 z 上限（全道 dmg 与 Boss 血量的共同最大值） */
  absMax?: number
  /** 选中 Boss 的血量剖面（两档都画；挂难度盒背缘 x=1 的版本×伤害垂面） */
  bossCurve?: { name: string; points: BossHpPoint[] }
  /** 当期 Boss 血量（`percent` 口径下把剖面的绝对血量换成同一把尺的分母；≤0 或缺失 ⇒ 剖面不画） */
  baseHp?: number
}>()

const wrapRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const cam = ref<Camera3D>({ yaw: 32, pitch: 28, zoom: 1 })
const view = ref<'iso' | 'front' | 'side'>('iso')
const ribbons = ref(true)
/** 血量剖面画成「面」（折线 + 落到地板 + 半透明填充）还是只画折线 */
const wall = ref(true)
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
  // 道位 = deriveVersionAxis 预计算：版本节点序号留空档（gapped）或等距回退
  const lane = props.lanes[idx]
  if (lane && Number.isFinite(lane.frac)) return lane.frac
  return laneCount.value <= 1 ? 0.5 : idx / (laneCount.value - 1)
}
/** 道位 = 某个 frac（血量剖面上的版本点要找「最近那条道」借血量基准） */
/** 当前相机是不是「侧视（yaw = 90°）= 版本 × 伤害」——此视角下难度轴退化成深度，第 4 个旋钮不参与 */
const isSide = computed(() => Math.abs(((cam.value.yaw % 360) + 360) % 360 - 90) < 0.5)
/** z 轴标题（随口径与侧视变） */
const zLabel = computed(() => {
  if (props.zMode === 'absolute') return '绝对伤害 ↑（虚线 = Boss 血量）'
  return isSide.value ? '伤害/当期血量 % ↑（虚线 = Boss 血量膨胀）' : '伤害/血量 % ↑'
})
/** 点值标签：绝对模式给 M，其余给 % */
function zModeLabel(dmg: number, z: number): string {
  return props.zMode === 'absolute' ? `${(dmg / 1e6).toFixed(1)}M` : `${fmt(z, 0)}%`
}
/**
 * 悬浮提示里的 z 值：**与图上的 z 口径一致**（图上按「伤害/当期血量」画，tip 却写别的口径，
 * 用户会以为算错了）。
 */
function zTipOf(pt: { dmg: number; ratio: number }): string {
  const abs = `${(pt.dmg / 1e6).toFixed(2)}M`
  return props.zMode === 'absolute' ? `伤害 ${abs}` : `伤害 ${fmt(pt.ratio, 1)}%（${abs}）`
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
  const absMode = props.zMode === 'absolute'
  // 画家算法：由远到近（`depth` 随道位单调增 ⇒ 等价于道位**降序**）。近端最后画，
  // 保证「近处那条」压在上面；yaw 恰好 90° 时 depth 与道位无关，退化成输入序（侧视下无遮挡问题）
  const laneOrder = props.lanes.map((_, i) => i).sort((a, b) => laneY(b) - laneY(a))
  /**
   * z 上限与取值：两档共用一条绘制路径。
   * - `percent`：各队点 = `p.ratio`（伤害 / **当期**血量），剖面的绝对血量按 `血量/当期血量` 换成同一把尺；
   * - `absolute`：全队同一把绝对尺，剖面就是绝对血量本身。
   */
  const zMax = Math.max(1, absMode ? (props.absMax ?? 1) : props.ratioMax)
  const baseHp = props.baseHp && props.baseHp > 0 ? props.baseHp : 0
  const zOf = (p: { ratio: number; dmg: number }): number => (absMode ? p.dmg : p.ratio)
  /** 剖面点的 z 值（同一把尺）：绝对伤害直接给；`percent` 下 = 该版本血量 / 当期血量 × 100（= 膨胀指数） */
  const wallZOf = (hp: number): number => (absMode ? hp : baseHp > 0 ? (hp / baseHp) * 100 : NaN)
  const fmtZTick = (v: number) => absMode ? (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}M` : `${(v / 1e3).toFixed(0)}K`) : `${fmt(v, 0)}%`

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
    if (!isSide.value) ctx.fillText(fmt(x * costMax, 0), near.sx, near.sy + 12)
  }
  for (let i = 0; i < laneCount.value; i++) {
    const y = laneY(i)
    const a = toScreen(0, y, 0); const b = toScreen(1, y, 0)
    ctx.strokeStyle = sceneInk(0.2)
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke()
  }
  /**
   * 击杀线平面（z = 100%）：`percent` 口径下它就是「当前期数 Boss」那一把共享尺的 100%；
   * 绝对伤害模式没有共享击杀线（参考就是血量剖面本身）。
   */
  if (!absMode && zMax >= 100) {
    const z = 100 / zMax
    const c = [toScreen(0, 0, z), toScreen(1, 0, z), toScreen(1, 1, z), toScreen(0, 1, z)]
    ctx.strokeStyle = sceneDanger(); ctx.globalAlpha = 0.7; ctx.setLineDash([6, 4])
    ctx.beginPath(); ctx.moveTo(c[0]!.sx, c[0]!.sy); for (const p of c.slice(1)) ctx.lineTo(p.sx, p.sy); ctx.closePath(); ctx.stroke()
    ctx.setLineDash([]); ctx.globalAlpha = 1
    ctx.fillStyle = sceneDanger(); ctx.textAlign = 'left'; ctx.fillText('击杀线 100%', c[0]!.sx + 4, c[0]!.sy - 4)
  }
  /**
   * 选中 Boss 的**血量剖面**（用户 2026-10-13「把点面改为选定 boss 的曲线面」，两档 z 口径都画）：
   * 挂在难度盒背缘 x = 1 的「版本 × 伤害」垂面上。
   * ⚠ 剖面本身是二维曲线（版本 × 血量），把它叫「面」是因为画法上带了「折线 → 地板」的填充；
   * 它每道都共用同一条（同一只 Boss 同一把尺），不是「每队各一条」。
   *
   * ⚠ 为什么 `percent` 档也要画、且要用 `血量/当期血量` 换算：曲线 z 轴那时是「伤害 ÷ **当期**血量」
   * （随期数变的一把尺），剖面直接拿绝对血量（2 亿量级）当前者（百分比量级）画会**整体飞出画布**
   * （实测：zMax = 100 而血量 = 2e8 ⇒ `Math.min(1, …)` 把每个点都压到天花板）；换算成同一把尺后，
   * 这条线就是**Boss 血量相对当期血量的膨胀指数**——与「血量膨胀」页同口径，也让侧视（版本 × 伤害）
   * 直接读出「版本推进时 Boss 血涨了多少」。
   */
  const bossCurve = props.bossCurve
  const pointScale = view.value === 'iso' ? 1 : 0.6
  if (bossCurve && bossCurve.points.length > 0 && (absMode || baseHp > 0)) {
    const bp = bossCurve.points
      .map(q => {
        const z = wallZOf(q.value)
        return Number.isFinite(z) ? { frac: q.frac, sc: toScreen(1, q.frac, Math.min(1, z / zMax)), v: q.version, samples: q.samples, value: q.value } : null
      })
      .filter((v): v is NonNullable<typeof v> => v !== null)
    // 垂面 + 地板幕布（「曲线面」而不是悬空折线；`幕布` 按钮关掉时只留折线）
    if (wall.value && bp.length > 0) {
      ctx.beginPath()
      ctx.moveTo(bp[0]!.sc.sx, bp[0]!.sc.sy)
      for (const p of bp.slice(1)) ctx.lineTo(p.sc.sx, p.sc.sy)
      for (let i = bp.length - 1; i >= 0; i--) {
        const f = toScreen(1, bp[i]!.frac, 0)
        ctx.lineTo(f.sx, f.sy)
      }
      ctx.closePath()
      ctx.fillStyle = withAlpha(sceneDanger(), 0.12); ctx.fill()
    }
    if (bp.length > 1) {
      ctx.strokeStyle = sceneDanger(); ctx.lineWidth = 2; ctx.setLineDash([8, 4])
      ctx.beginPath(); ctx.moveTo(bp[0]!.sc.sx, bp[0]!.sc.sy)
      for (const p of bp.slice(1)) ctx.lineTo(p.sc.sx, p.sc.sy)
      ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1
    }
    ctx.fillStyle = sceneDanger()
    for (const p of bp) { ctx.beginPath(); ctx.arc(p.sc.sx, p.sc.sy, 2.5 + pointScale, 0, Math.PI * 2); ctx.fill() }
    const tip = bp[bp.length - 1]!
    ctx.textAlign = 'right'; ctx.font = '10px sans-serif'
    ctx.fillText(bossCurve.name, tip.sc.sx - 6, tip.sc.sy - 6)
    ctx.textAlign = 'left'
  }
  /**
   * 侧视（yaw = 90°）= 版本 × 伤害平面：此时视线正对 x ⇒ 每道退化成一根竖柱，**必须**靠横向网格与
   * 版本刻度才读得出「曲线」（用户 2026-10-13「侧视图没能在对应角色的版本编号中表现出……曲线」）。
   */
  const zVals = zGridOf(zMax, { dense: isSide.value })
  for (const v of zVals) {
    const z = Math.min(1, v / zMax)
    const p = toScreen(0, 0, z)
    if (isSide.value) {
      const a = toScreen(1, 0, z); const b = toScreen(1, 1, z)
      ctx.strokeStyle = sceneInk(0.13)
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke()
    }
    ctx.fillStyle = sceneDim(); ctx.textAlign = 'right'; ctx.font = '10px sans-serif'
    ctx.fillText(fmtZTick(v), p.sx - 6, p.sy + 3)
  }
  if (isSide.value) {
    // 版本刻度：空白处本来没有东西可读（每道只有一条竖直投影）——这里逐道标出（道数多时抽稀，
    // `gapped` 时空档也照实反映在间距上）
    const lanes = laneOrder.map(idx => ({ idx, frac: laneY(idx), label: props.lanes[idx]?.label ?? '' }))
    ctx.font = '10px sans-serif'; ctx.textAlign = 'left'
    for (const t of versionGridOf(lanes.length)) {
      const lane = lanes[t]
      if (!lane) continue
      const p = toScreen(1, lane.frac, 0)
      ctx.fillStyle = sceneDim()
      ctx.fillText(lane.label, p.sx + 5, p.sy + 12)
      // 每道的垂柱：侧视下这条才是「该队曲线」，横向网格给出它的高度锚
      const top = toScreen(1, lane.frac, 1)
      ctx.strokeStyle = sceneInk(0.22)
      ctx.beginPath(); ctx.moveTo(p.sx, p.sy); ctx.lineTo(top.sx, top.sy); ctx.stroke()
    }
  } else {
    for (const t of versionGridOf(laneCount.value)) {
      const y = laneY(t)
      const a = toScreen(1, y, 0); const b = toScreen(1, y, 1)
      ctx.strokeStyle = sceneInk(0.12)
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke()
    }
  }
  const zAxisTop = toScreen(0, 0, 1); const zAxisBottom = toScreen(0, 0, 0)
  ctx.strokeStyle = sceneInk(0.5)
  ctx.beginPath(); ctx.moveTo(zAxisBottom.sx, zAxisBottom.sy); ctx.lineTo(zAxisTop.sx, zAxisTop.sy); ctx.stroke()
  // 轴标题
  ctx.fillStyle = sceneDim(); ctx.font = '11px sans-serif'
  const xl = toScreen(0.5, -0.08, 0); ctx.textAlign = 'center'; ctx.fillText('操作难度绝对值 →', xl.sx, xl.sy + 24)
  const yl = toScreen(1.06, 0.5, 0); ctx.textAlign = 'left'; ctx.fillText(`${props.axisLabel} →`, yl.sx, yl.sy)
  ctx.textAlign = 'left'
  ctx.fillText(zLabel.value, zAxisTop.sx - 70, zAxisTop.sy - 8)

  // ---- 各道：由远到近（同 laneOrder：近 = 后画，低道位的折线不会盖住高道位） ----
  for (const idx of laneOrder) {
    const lane = props.lanes[idx]!
    const s = seriesForLane(props.series, lane)
    if (!s || s.points.length === 0) continue
    const color = props.colorOf(lane.presetId)
    const y = laneY(idx)
    const pts = s.points.map((p, pi) => {
      const sc = toScreen(Math.min(1, p.cost / costMax), y, Math.min(1, zOf(p) / zMax))
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
    const lastPt = s.points[s.points.length - 1]!
    ctx.fillText(zModeLabel(lastPt.dmg, zOf(lastPt)), last.sx + 6, last.sy + 3)
  }
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
  const s = seriesForLane(props.series, lane)!
  const pt = s.points[best.p.ptIdx]!
  const lines = [
    `${s.name} · 版本：${lane.label}`,
    `${props.pointLabel(pt.point)} · 轴态 ${axisKindLabel(pt.axis)}`,
    `操作难度 ${fmt(pt.cost, 0)} · ${zTipOf(pt)}`,
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
// 切主题重绘（否则画面停在旧主题；CC-348）
useThemeRedraw(draw)
onMounted(() => {
  draw()
  window.addEventListener('mouseup', onGlobalUp)
  if (typeof ResizeObserver !== 'undefined' && wrapRef.value) {
    ro = new ResizeObserver(() => draw())
    ro.observe(wrapRef.value)
  }
})
onBeforeUnmount(() => { ro?.disconnect(); ro = null; window.removeEventListener('mouseup', onGlobalUp) })
watch(() => [props.series, props.lanes, props.costMax, props.ratioMax, props.zMode, props.absMax, props.bossCurve, props.baseHp, cam.value, ribbons.value, wall.value], () => draw(), { deep: true })
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
