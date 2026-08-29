<template>
  <div class="boss-hp-page">
    <n-card size="small" :bordered="true">
      <template #header>
        <span>Boss 血量版本系数演变</span>
      </template>
      <template #header-extra>
        <span class="muted">危局血量膨胀：横轴 = 期数，纵轴 = 血量版本系数（%）；点/线 = 各 Boss 逐期系数。数据源 = boss-presets.json <code>hpVersionCoeff</code></span>
      </template>

      <div v-if="loading" class="muted" style="padding: 20px 8px">数据加载中…</div>
      <n-alert v-else-if="error" type="error" title="加载失败">{{ error }}</n-alert>

      <template v-else>
        <!-- 图例（点击显隐） -->
        <div class="legend">
          <div
            v-for="b in bossSeries"
            :key="b.id"
            class="legend-item"
            :class="{ off: !visible.has(b.id) }"
            @click="toggle(b.id)"
          >
            <span class="swatch" :style="{ background: b.color }"></span>
            <span class="name">{{ b.name }}{{ b.isCriticalAssault ? '·困难' : '' }}</span>
          </div>
        </div>

        <!-- SVG 折线图 -->
        <div class="chart-wrap">
          <svg
            :viewBox="`0 0 ${svgW} ${svgH}`"
            class="chart-svg"
            @mousemove="onMove"
            @mouseleave="hover = null"
          >
            <!-- 网格 + Y 轴标签 -->
            <g v-for="t in yTicks" :key="'y' + t">
              <line :x1="padL" :x2="svgW - padR" :y1="yOf(t)" :y2="yOf(t)" class="grid-line" />
              <text :x="padL - 8" :y="yOf(t) + 3" class="axis-label" text-anchor="end">{{ t }}%</text>
            </g>

            <!-- 100% 基准线（无膨胀） -->
            <line :x1="padL" :x2="svgW - padR" :y1="yOf(100)" :y2="yOf(100)" class="ref-line" />
            <text :x="svgW - padR - 4" :y="yOf(100) - 5" class="ref-label" text-anchor="end">100% 基准</text>

            <!-- 折线 + 数据点 -->
            <g v-for="b in visibleSeries" :key="b.id">
              <polyline :points="b.linePoints" :stroke="b.color" fill="none" class="trend-line" />
              <circle
                v-for="p in b.points"
                :key="p.seasonIdx"
                :cx="xOf(p.seasonIdx)"
                :cy="yOf(p.coeff)"
                :r="3"
                :fill="b.color"
                class="trend-point"
              >
                <title>{{ b.name }} · {{ seasonLabel(p.seasonIdx) }} · {{ p.coeff }}%</title>
              </circle>
            </g>

            <!-- X 轴标签 -->
            <g v-for="t in xTicks" :key="'x' + t.idx">
              <text :x="xOf(t.idx)" :y="svgH - 8" class="axis-label x-label" text-anchor="middle">{{ t.label }}</text>
            </g>

            <!-- 悬浮参考线 + 高亮点 -->
            <g v-if="hover">
              <line :x1="xOf(hover.seasonIdx)" :x2="xOf(hover.seasonIdx)" :y1="padT" :y2="svgH - padB" class="hover-line" />
              <circle
                :cx="xOf(hover.seasonIdx)"
                :cy="yOf(hover.coeff)"
                :r="5"
                :fill="hover.color"
                stroke="#fff"
                stroke-width="1.5"
              />
            </g>
          </svg>
        </div>

        <!-- 悬浮卡片 -->
        <div v-if="hover" class="hover-card">
          <span class="swatch" :style="{ background: hover.color }"></span>
          {{ hover.name }} · {{ hover.seasonLabel }} · <b>{{ hover.coeff }}%</b>
        </div>
      </template>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { NCard, NAlert } from 'naive-ui'
import type { BossPreset, BossPresetFile } from '@/types/bossPreset'

/** 20 色盘（区分不同 Boss 折线） */
const PALETTE = [
  '#f6ad55', '#63b3ed', '#68d391', '#fc8181', '#b794f4',
  '#f687b3', '#4fd1c5', '#f6e05e', '#9ae6b4', '#cbd5e0',
  '#fcb0f0', '#7f9cf5', '#fbd38d', '#81e6d9', '#fca5a5',
  '#b8b2ff', '#a3e635', '#f9a8d4', '#5eead4', '#fcd34d',
]

interface SeasonPoint { seasonIdx: number; coeff: number }
interface BossSeries {
  id: string
  name: string
  isCriticalAssault: boolean
  color: string
  points: SeasonPoint[]
}

const loading = ref(true)
const error = ref('')
const presets = ref<BossPreset[]>([])
const visible = reactive(new Set<string>())
const hover = ref<null | { name: string; color: string; seasonIdx: number; coeff: number; seasonLabel: string }>(null)

onMounted(async () => {
  try {
    const res = await fetch('/static/boss-presets.json')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j = (await res.json()) as BossPresetFile
    presets.value = j.bosses ?? []
    // 按源怪物 id 初始化可见集（合并预设会拆成试炼版/恶名版多条，须用系列 id 而非预设 id）
    for (const b of bossSeries.value) visible.add(b.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

/** 全部期数（按开始日期升序，跨 Boss 去重） */
const seasons = computed(() => {
  const m = new Map<string, { phaseId: string; begin: string; label: string }>()
  for (const b of presets.value) {
    for (const p of b.phases) {
      if (!m.has(p.phaseId)) {
        m.set(p.phaseId, { phaseId: p.phaseId, begin: p.begin || p.phaseId, label: p.label || p.version || p.phaseId })
      }
    }
  }
  return [...m.values()].sort((a, b) => a.begin.localeCompare(b.begin))
})

const seasonIdxOf = computed(() => {
  const m = new Map<string, number>()
  seasons.value.forEach((s, i) => m.set(s.phaseId, i))
  return m
})

/** 各 Boss 系列（按源怪物 id 分组：合并预设的试炼版/恶名版拆成独立折线；纯数据，不含坐标） */
const bossSeries = computed<BossSeries[]>(() => {
  const idx = seasonIdxOf.value
  const groups = new Map<string, { id: string; name: string; isCriticalAssault: boolean; points: SeasonPoint[] }>()
  for (const b of presets.value) {
    for (const p of b.phases) {
      const c = p.hpVersionCoeff
      if (c == null || !Number.isFinite(c)) continue
      const seasonIdx = idx.get(p.phaseId)
      if (seasonIdx == null) continue
      const mid = p.monsterId ?? b.id
      let g = groups.get(mid)
      if (!g) {
        g = { id: mid, name: p.monsterName ?? b.name, isCriticalAssault: !!b.isCriticalAssault, points: [] }
        groups.set(mid, g)
      }
      g.points.push({ seasonIdx, coeff: c })
    }
  }
  return [...groups.values()]
    .map((g, i) => ({
      id: g.id,
      name: g.name,
      isCriticalAssault: g.isCriticalAssault,
      color: PALETTE[i % PALETTE.length],
      points: g.points.sort((a, b) => a.seasonIdx - b.seasonIdx),
    }))
    .filter(s => s.points.length > 0)
})

/** 可见系列（纯数据，供 maxCoeff 与坐标计算；不依赖坐标 → 无循环依赖） */
const visibleData = computed(() => bossSeries.value.filter(b => visible.has(b.id)))

/** 可见系列（含折线坐标；依赖 visibleData + maxCoeff，晚于 maxCoeff 求值） */
const visibleSeries = computed(() =>
  visibleData.value.map(b => ({
    ...b,
    linePoints: b.points.map(p => `${xOf(p.seasonIdx)},${yOf(p.coeff)}`).join(' '),
  })),
)

function toggle(id: string) {
  if (visible.has(id)) visible.delete(id)
  else visible.add(id)
}

function seasonLabel(seasonIdx: number): string {
  return seasons.value[seasonIdx]?.label ?? ''
}

// ============ SVG 布局 ============
const svgW = 1160
const svgH = 480
const padL = 52
const padR = 24
const padT = 16
const padB = 34

/** Y 轴上限：可见系数最大值向上取整到 50 的倍数（至少 200） */
const maxCoeff = computed(() => {
  let mx = 0
  for (const b of visibleData.value) {
    for (const p of b.points) mx = Math.max(mx, p.coeff)
  }
  return Math.max(200, Math.ceil(mx / 50) * 50)
})

const yTicks = computed(() => {
  const step = 50
  const out: number[] = []
  for (let v = 0; v <= maxCoeff.value; v += step) out.push(v)
  return out
})

function xOf(seasonIdx: number): number {
  const n = Math.max(1, seasons.value.length - 1)
  return padL + (seasonIdx / n) * (svgW - padL - padR)
}

function yOf(coeff: number): number {
  return svgH - padB - (coeff / maxCoeff.value) * (svgH - padT - padB)
}

/** X 轴标签抽稀：最多 ~12 个 */
const xTicks = computed(() => {
  const n = seasons.value.length
  if (n === 0) return []
  const step = Math.max(1, Math.ceil(n / 12))
  const out: { idx: number; label: string }[] = []
  for (let i = 0; i < n; i += step) out.push({ idx: i, label: seasons.value[i].label })
  const last = n - 1
  if (!out.some(t => t.idx === last)) out.push({ idx: last, label: seasons.value[last].label })
  return out
})

// ============ 悬浮 ============
function onMove(e: MouseEvent) {
  const svg = (e.currentTarget as SVGSVGElement)
  const rect = svg.getBoundingClientRect()
  const mx = ((e.clientX - rect.left) / rect.width) * svgW
  const my = ((e.clientY - rect.top) / rect.height) * svgH
  const n = Math.max(1, seasons.value.length - 1)
  // 最近的期数索引
  let seasonIdx = Math.round(((mx - padL) / (svgW - padL - padR)) * n)
  seasonIdx = Math.max(0, Math.min(n, seasonIdx))
  // 在可见系列里找该期最近的点
  let best: null | { name: string; color: string; seasonIdx: number; coeff: number; seasonLabel: string } = null
  let bestDist = Infinity
  for (const b of visibleSeries.value) {
    for (const p of b.points) {
      if (p.seasonIdx !== seasonIdx) continue
      const dx = xOf(p.seasonIdx) - mx
      const dy = yOf(p.coeff) - my
      const d = Math.hypot(dx, dy)
      if (d < bestDist) {
        bestDist = d
        best = { name: b.name, color: b.color, seasonIdx: p.seasonIdx, coeff: p.coeff, seasonLabel: seasonLabel(p.seasonIdx) }
      }
    }
  }
  hover.value = best
}
</script>

<style scoped>
.boss-hp-page { max-width: 1280px; }
.muted { color: var(--wa-500); font-size: 12px; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-bottom: 12px; }
.legend-item { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; user-select: none; }
.legend-item.off { opacity: 0.35; text-decoration: line-through; }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; flex: 0 0 auto; }
.name { color: var(--wa-750); white-space: nowrap; }
.chart-wrap { overflow-x: auto; }
.chart-svg { width: 100%; min-width: 900px; height: auto; }
.grid-line { stroke: var(--wa-80); stroke-width: 1; }
.ref-line { stroke: var(--wa-300); stroke-width: 1; stroke-dasharray: 4 3; }
.ref-label { fill: var(--wa-420); font-size: 11px; }
.axis-label { fill: var(--wa-450); font-size: 11px; }
.x-label { font-size: 10px; }
.trend-line { stroke-width: 1.8; }
.trend-point { stroke: var(--wa-250); stroke-width: 0.5; }
.hover-line { stroke: var(--wa-350); stroke-width: 1; stroke-dasharray: 3 3; }
.hover-card {
  display: flex; align-items: center; gap: 6px;
  margin-top: 8px; font-size: 12px; color: var(--wa-750);
}
</style>
