<template>
  <n-card size="small" :bordered="true">
    <template #header>
      <div class="subc-title">
        <span>副词条收益曲线（第 x 步的边际提升）</span>
        <div class="subc-controls">
          <n-select
            v-model:value="slot"
            :options="slotOptions"
            size="small"
            style="width:150px"
            placeholder="槽位"
          />
          <n-button size="small" type="primary" :loading="computing" @click="run">
            {{ result ? '重算曲线' : '计算曲线' }}
          </n-button>
        </div>
      </div>
    </template>

    <div class="subc-caption">
      横轴 = 该词条的第 x 步（一步 = 一次副词条强化；其余词条留在自动配比给的值），
      纵轴 = 这一步相对「自动配比后」队伍总伤的边际提升。
      虚线 = 自动配比的门槛（入选词条末步边际的最小值）：曲线在虚线以下 ⇒ 这一步不值，配比没选它；
      空心圆点 = 自动配比实际给出的步数。表格「累计(到该步)」= 从 0 堆到「配比步数」的累计提升
      （与「配比步数」列说的是同一件事），「累计(到上限)」= 一路堆到单词条上限的累计（只作参考，
      不与步数并读）。采样不动你的配装（跑在独立场景里）。
    </div>

    <div v-if="computing || progressText" class="subc-progress">
      <n-progress type="line" :percentage="Math.round(progressPct * 100)" :show-indicator="false" :height="6" />
      <span class="subc-progress-text">{{ progressText }}</span>
    </div>

    <div v-if="errorMsg" class="subc-error">{{ errorMsg }}</div>
    <div v-if="stale" class="subc-stale">
      配装 / 角色已变：这张图是上一次采样的现场，点「重算曲线」更新。
    </div>

    <template v-if="result && visibleSeries.length > 0">
      <ChartLegend
        :items="legendItems"
        :is-visible="legend.isVisible"
        hint="点词条显隐（纵轴按可见曲线缩放）"
        show-all
        @toggle="legend.toggle"
        @show-all="legend.showAll"
      />
      <div class="subc-plot">
        <svg :viewBox="`0 0 ${svgW} ${SVG_H}`" class="subc-svg">
          <!-- y 刻度（**负值区**是真实存在的：某词条挪步后总伤可能下降，如暴击率已溢出） -->
          <!-- 网格 + y 刻度 -->
          <g v-for="(y, i) in yTicks" :key="`g${i}`">
            <line :x1="PAD_L" :y1="y" :x2="svgW - PAD_R" :y2="y" class="subc-grid" />
            <text :x="PAD_L - 6" :y="y + 3" text-anchor="end" class="subc-tick">{{ fmt(yLabels[i], 3) }}%</text>
          </g>
          <!-- x 刻度（第 x 步） -->
          <text v-for="t in xTicks" :key="`x${t.x}`" :x="sx(t.x)" :y="PAD_T + plotH + 14" text-anchor="middle" class="subc-tick">{{ t.x }}</text>
          <text :x="PAD_L + plotW / 2" :y="SVG_H - 3" text-anchor="middle" class="subc-axis-title">第 x 步（每步 +1 次强化）</text>

          <!--
            自动配比门槛：**按全部曲线算**（门槛是自动配比的事实，不随显隐改变——否则隐藏一条线
            就会把「配比为什么这么分」改写成另一个数）。但**画**只在可见纵轴范围内画：门槛来自
            某条被隐藏的曲线时可能落在轴外，画出去会是一条贴在框外的线。
          -->
          <template v-if="cutoffInView !== null">
            <line :x1="PAD_L" :y1="sy(cutoffInView)" :x2="svgW - PAD_R" :y2="sy(cutoffInView)" class="subc-cutline" stroke-dasharray="5,3" />
            <text :x="PAD_L + 4" :y="sy(cutoffInView) - 4" class="subc-cutlabel">配比门槛 {{ fmt(cutoffInView, 3) }}%</text>
          </template>

          <!-- 曲线 + 落点 -->
          <g v-for="s in drawnSeries" :key="s.stat">
            <polyline :points="s.path" fill="none" :style="{ stroke: s.color, strokeWidth: '1.6' }" stroke-linejoin="round" />
            <template v-for="p in s.points" :key="`${s.stat}p${p.x}`">
              <circle
                :cx="sx(p.x)"
                :cy="sy(p.gainPct)"
                :r="p.x === s.markerX ? 4 : 2"
                :style="p.x === s.markerX
                  ? { fill: 'none', stroke: s.color, strokeWidth: '1.6' }
                  : { fill: s.color, stroke: 'none' }"
              >
                <title>{{ s.label }} 第 {{ p.x }} 步：{{ fmt(p.gainPct, 3) }}%（总伤 {{ compact(p.damage) }}）</title>
              </circle>
            </template>
          </g>
        </svg>
      </div>

      <ChartTable
        :columns="tableColumns"
        align="right"
        dense
        :empty="'没有可显示的词条'"
        max-height="320px"
      >
        <tr v-for="r in tableRows" :key="r.stat">
          <td><span class="subc-dot" :style="{ background: r.color }"></span>{{ r.label }}</td>
          <td>{{ r.allocated }}</td>
          <td>{{ r.firstText }}</td>
          <td>{{ r.tailText }}</td>
          <td>{{ r.cumulativeText }}</td>
          <td>{{ r.cumulativeToCapText }}</td>
          <td :style="{ color: r.verdictColor }">{{ r.verdictText }}</td>
        </tr>
      </ChartTable>
    </template>
    <div v-else-if="result && !computing" class="subc-empty">
      曲线为空（{{ result.reason || '该槽位没有可选词条' }}）。
    </div>
    <div v-else-if="!result && !computing" class="subc-empty">
      选槽位后点「计算曲线」：逐词条采「第 x 步的边际提升」，并把自动配比的取舍画在同一张图上。
    </div>
  </n-card>
</template>

<script setup lang="ts">
/**
 * 副词条收益曲线（2026-10-21，用户需求「副词条的选择需要图表」）。
 *
 * 数据/口径全在 `composables/substatCurve.ts`（采样 + 门槛 + 判定 + 轴范围），本组件只负责：
 * ① 起任务（`useBatchOwner` 吊销上一次 / 离开页面即停）、跑在**独立场景**上（`withAnalysisScenario`，
 *    采样不动页面正在用的 UI store）；② 图例筛选（共享 `useSeriesFilter` + `ChartLegend`）；
 * ③ 画 SVG 与表格（表格基座走共享 `ChartTable`，不自己写壳）。
 *
 * 口径要点（改之前读 `substatCurve.ts` 头注释）：
 * - **筛选必须传导到派生量**：纵轴/表格只读 `visibleSeries`（`seriesFilter` 口径 ②），
 *   隐藏曲线后纵轴按剩下的线缩放——否则「筛掉了但轴还是按它撑高」。
 * - **默认可见集 = 模板词条 ∪ 已入选词条**（`defaultVisibleStats`）：用户口径「我选择显示了大攻击、精通、小穿透」，
 *   生存词条/零收益词条默认收起，点图例即可展开。
 * - 求值贵（实测 50–75ms/点，10 词条 ≈ 6–10s）⇒ 显式按钮触发，不在进页面时自动跑。
 */
import { computed, ref } from 'vue'
import { NCard, NButton, NSelect, NProgress } from 'naive-ui'
import ChartLegend from '@/components/charts/ChartLegend.vue'
import ChartTable from '@/components/charts/ChartTable.vue'
import { useSeriesFilter } from '@/composables/seriesFilter'
import { useBatchOwner } from '@/composables/batchTask'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import {
  allocationCutoff,
  allocationMarker,
  curveAxisRange,
  defaultVisibleStats,
  sampleSubstatCurves,
  substatCurveVerdict,
  type SubstatCurveResult,
  type SubstatCurveSeries,
} from '@/composables/substatCurve'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { substatShortLabel } from '@/data/substatLabels'
import { compact, fmt } from '@/utils/format'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
/** 图例/表格的词条名 = 中文简称（`data/substatLabels`，用户口径 2026-10-21「大攻击 / 精通 / 小穿透」） */
const statLabel = substatShortLabel

/**
 * 数据色（`<script>` 里的字面色值 = UI_THEME_GUIDE §5 认可的「数据色」，明暗通吃、不跟随主题）：
 * 词条色编码信息（哪条线是哪条），跟随主题反而会让图例与线条分叉。
 * 顺序固定 ⇒ 同一词条每次同色；池内 10 键各占一色，不循环复用。
 */
const STAT_COLORS: Record<string, string> = {
  anomalyProficiency: '#63e2b7',
  atkPct: '#f0a020',
  penFlat: '#38bdf8',
  critRate: '#f472b6',
  critDmg: '#a78bfa',
  atkFlat: '#facc15',
  defPct: '#34d399',
  hpPct: '#fb923c',
  defFlat: '#94a3b8',
  hpFlat: '#c084fc',
}
const FALLBACK_COLOR = '#8b8b8b'
function colorOf(stat: string): string { return STAT_COLORS[stat] ?? FALLBACK_COLOR }

/** 默认槽位 = 队伍里第一个有角色的槽（`uiStore.selectedSlot` 可能正好是空槽，会落到禁用的下拉项上） */
const slot = ref<number>(Math.max(0, configStore.team.findIndex(c => !!c.agentId)))
const computing = ref(false)
const errorMsg = ref('')
const progressPct = ref(0)
const progressText = ref('')
const result = ref<SubstatCurveResult | null>(null)
/** 采样时的现场签名：配装/角色/槽位一变，曲线就不再对应当前现场 ⇒ 提示重算（不静默沿用旧图） */
const signature = computed(() => JSON.stringify({ slot: slot.value, team: configStore.team }))
const sampledSignature = ref('')
const stale = computed(() => !!result.value && sampledSignature.value !== signature.value)

const slotOptions = computed(() => [0, 1, 2].map(i => {
  const id = configStore.team[i]?.agentId
  const name = id ? (catalogStore.getAgent(id)?.name?.zhCN || id) : '空槽'
  return { label: `槽${i + 1} · ${name}`, value: i, disabled: !id }
}))

// ========== 图例筛选（状态在 useSeriesFilter，本组件只喂清单） ==========
const legend = useSeriesFilter(() => (result.value?.series ?? []).map(s => ({ id: s.stat, name: statLabel(s.stat) })))
const legendItems = computed(() => (result.value?.series ?? []).map(s => ({
  id: s.stat,
  label: statLabel(s.stat),
  color: colorOf(s.stat),
  title: `${s.allocatedSteps > 0 ? `自动配比给了 ${s.allocatedSteps} 步` : '自动配比没选它'}；点击显隐`,
})))

/**
 * 可见曲线（纵轴/表格的唯一输入——隐藏必须退出派生量，见 seriesFilter 口径 ②）。
 * 用 `isVisible` 而不是 `filter`：曲线的 id 是 `stat`，两者是同一份 `useSeriesFilter` 状态
 * （`seriesFilter` 头注释允许页面读 `isVisible`，派生量必须读过滤后的集合）。
 */
const visibleSeries = computed<SubstatCurveSeries[]>(() =>
  (result.value?.series ?? []).filter(s => legend.isVisible(s.stat)))

// ========== 几何 ==========
const PAD_L = 62
const PAD_R = 14
const PAD_T = 10
const PAD_B = 34
const SVG_H = 240
const svgW = computed(() => Math.max(360, Math.min(880, typeof window !== 'undefined' ? window.innerWidth - 120 : 760)))
const plotW = computed(() => svgW.value - PAD_L - PAD_R)
const plotH = SVG_H - PAD_T - PAD_B

const axis = computed(() => curveAxisRange(visibleSeries.value))
const cutoff = computed(() => (result.value ? allocationCutoff(result.value) : null))
/** 门槛落在可见纵轴内才画（见模板注释：门槛本身按全部曲线算，不随显隐改变） */
const cutoffInView = computed(() => {
  const c = cutoff.value
  if (c === null) return null
  return c >= axis.value.yMin && c <= axis.value.yMax ? c : null
})
const sx = (x: number) => PAD_L + (x / (axis.value.xMax || 1)) * plotW.value
const sy = (y: number) => PAD_T + plotH - ((y - axis.value.yMin) / (axis.value.yMax - axis.value.yMin || 1)) * plotH

const yTicks = computed(() => Array.from({ length: 5 }, (_, i) => PAD_T + (plotH / 4) * i))
const yLabels = computed(() => Array.from({ length: 5 }, (_, i) => axis.value.yMax - ((axis.value.yMax - axis.value.yMin) / 4) * i))
const xTicks = computed(() => {
  const max = Math.max(1, Math.round(axis.value.xMax))
  const n = Math.min(6, max)
  if (n <= 1) return [{ x: 1 }]
  return Array.from({ length: n }, (_, i) => ({ x: Math.max(1, Math.round(1 + ((max - 1) / (n - 1)) * i)) }))
    .filter((t, i, arr) => arr.findIndex(o => o.x === t.x) === i)
})

/** 画线用的系列（含 path 与落点 x，供模板直接取） */
const drawnSeries = computed(() => visibleSeries.value.map(s => ({
  stat: s.stat,
  label: statLabel(s.stat),
  color: colorOf(s.stat),
  points: s.points,
  markerX: allocationMarker(s)?.x ?? -1,
  path: s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.gainPct).toFixed(1)}`).join(' '),
})))

// ========== 表格 ==========
const tableColumns = [
  { key: 'stat', label: '词条' },
  { key: 'allocated', label: '配比步数', width: '78px' },
  { key: 'first', label: '首步边际', width: '88px' },
  { key: 'tail', label: '该步边际', width: '88px' },
  { key: 'cum', label: '累计(到该步)', width: '104px' },
  { key: 'cumCap', label: '累计(到上限)', width: '104px' },
  { key: 'verdict', label: '判定', width: '104px' },
]
const VERDICT_TEXT: Record<string, string> = {
  chosen: '入选',
  dropped: '边际不足·舍弃',
  'kept-out': '够格但未入选',
  flat: '无收益',
}
const VERDICT_COLOR: Record<string, string> = {
  chosen: 'var(--c-success-strong)',
  dropped: 'var(--fg-3)',
  'kept-out': 'var(--c-warning-strong)',
  flat: 'var(--fg-3)',
}
const tableRows = computed(() => {
  const cut = cutoff.value
  return visibleSeries.value.map(s => {
    const first = s.points[0]
    const marker = allocationMarker(s)
    const tail = marker ?? s.points[s.points.length - 1]
    const verdict = substatCurveVerdict(s, cut)
    return {
      stat: s.stat,
      label: statLabel(s.stat),
      color: colorOf(s.stat),
      allocated: s.allocatedSteps,
      firstText: first ? `${fmt(first.gainPct, 3)}%` : '-',
      tailText: tail ? `${fmt(tail.gainPct, 3)}%` : '-',
      cumulativeText: `${fmt(s.cumulativePct, 2)}%`,
      cumulativeToCapText: `${fmt(s.cumulativeToCapPct, 2)}%`,
      verdictText: VERDICT_TEXT[verdict],
      verdictColor: VERDICT_COLOR[verdict],
    }
  })
})

// ========== 采样（独立场景；吊销上一次 / 离开页面即停） ==========
const owner = useBatchOwner()

/** 默认可见集 = 模板词条 ∪ 已入选词条（其余收起，用户点图例可展开） */
function applyDefaultVisibility(res: SubstatCurveResult) {
  const keep = new Set(defaultVisibleStats(res))
  for (const s of res.series) {
    if (!keep.has(s.stat) && legend.isVisible(s.stat)) legend.toggle(s.stat)
  }
}

async function run() {
  const task = owner.start()
  computing.value = true
  errorMsg.value = ''
  progressPct.value = 0
  progressText.value = ''
  try {
    const res = await withAnalysisScenario(s => sampleSubstatCurves(s, {
      slot: slot.value,
      control: { signal: task.signal },
      onProgress: p => {
        task.commit(() => { progressPct.value = p.pct; progressText.value = p.text })
      },
    }))
    task.commit(() => {
      result.value = res
      sampledSignature.value = signature.value
      legend.showAll()
      applyDefaultVisibility(res)
    })
  } catch (e) {
    task.commit(() => { errorMsg.value = `计算失败：${e instanceof Error ? e.message : String(e)}` })
  } finally {
    task.commit(() => { computing.value = false; progressPct.value = 0; progressText.value = '' })
  }
}
</script>

<style scoped>
.subc-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; width: 100%; }
.subc-controls { display: flex; align-items: center; gap: 8px; }
.subc-caption { font-size: 11px; color: var(--fg-3); line-height: 1.7; margin-bottom: 8px; }
.subc-progress { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.subc-progress-text { font-size: 11px; color: var(--fg-2); white-space: nowrap; }
.subc-error { font-size: 12px; color: var(--c-danger); margin-bottom: 8px; }
.subc-plot { width: 100%; overflow-x: auto; }
.subc-svg { width: 100%; height: auto; background: var(--app-inset); border-radius: 4px; }
.subc-grid { stroke: var(--line); }
.subc-tick { fill: var(--fg-2); font-size: 10px; }
.subc-axis-title { fill: var(--fg-3); font-size: 10px; }
.subc-cutline { stroke: var(--c-warning); }
.subc-cutlabel { fill: var(--c-warning-strong); font-size: 10px; }
.subc-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
.subc-empty { font-size: 12px; color: var(--fg-3); padding: 8px 0; }
.subc-stale { font-size: 11px; color: var(--c-warning-strong); margin-bottom: 8px; }
</style>
