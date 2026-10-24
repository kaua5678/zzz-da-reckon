<template>
  <n-card size="small" :bordered="true">
    <template #header>
      <div class="subc-title">
        <span>副词条收益曲线（相比于上一步 / 相比于基础）</span>
        <div class="subc-controls">
          <n-select v-model:value="slot" :options="slotOptions" size="small" style="width:150px" placeholder="槽位" />
          <n-select v-model:value="sceneMode" :options="sceneOptions" size="small" style="width:170px" />
          <n-button size="small" type="primary" :loading="computing" @click="run">
            {{ result ? "重算曲线" : "计算曲线" }}
          </n-button>
        </div>
      </div>
    </template>

    <div class="subc-caption">
      横轴 = 该词条的第 x 步（一步 = 一次副词条强化；其余词条留在<strong>现场</strong>给的步数）。两张图同一批采样点，只有纵轴口径不同：
      <br><strong>相比于上一步</strong>：这一步的边际 ÷ <strong>上一步的总伤</strong>（分母随步数长大）⇒ 曲线下弯 = 边际效用递减——
      同一条线越往后越便宜，看的是「这个词条堆到多少开始不值」。⚠ 每条线的分母不同 ⇒ 这张图<strong>不能</strong>跨词条比高低。
      <br><strong>相比于基础</strong>：这一步的边际 ÷ <strong>现场总伤</strong>（分母固定）。加算词条（爆伤 / 大攻击 / 小攻击）在这里是直线——
      那是对的，一步的绝对增量本来就是常数；同分母 ⇒ <strong>跨词条可比</strong>，虚线与「下一步该堆谁」都只认它。
      <br>空心圆点 = 现场给该词条的步数；采样不动你的配装（跑在独立场景里）。
    </div>

    <div v-if="sceneMode === 'manual'" class="subc-scene">
      <div class="subc-scene-head">
        <span class="subc-scene-title">现场 = 每个词条当前已投的步数（基线总伤就是这份现场的总伤）</span>
        <div class="subc-scene-actions">
          <n-button size="tiny" secondary :disabled="!autoAllocation" @click="fillScene(autoAllocation)">载入自动配比</n-button>
          <n-button size="tiny" secondary @click="fillScene(buildAllocation())">载入当前配装</n-button>
          <n-button size="tiny" secondary @click="fillScene({})">清零</n-button>
          <span class="subc-scene-total">合计 {{ draftTotal }} 步</span>
        </div>
      </div>
      <div class="subc-scene-grid">
        <div v-for="stat in sceneStats" :key="stat" class="subc-scene-item">
          <span class="subc-scene-label">
            <span class="subc-dot" :style="{ background: colorOf(stat) }"></span>{{ statLabel(stat) }}
          </span>
          <n-input-number
            :value="draft[stat] ?? 0"
            size="tiny"
            :min="0"
            :max="statCapSetting"
            :step="1"
            style="width:82px"
            @update:value="setDraft(stat, $event)"
          />
        </div>
      </div>
    </div>
    <div v-else-if="sceneMode === 'build'" class="subc-scene-note">
      现场 = 该槽位当前配装的副词条分配（{{ buildSceneTotal }} 步）：在主页改完词条再回来点「重算曲线」。
    </div>

    <div v-if="computing || progressText" class="subc-progress">
      <n-progress type="line" :percentage="Math.round(progressPct * 100)" :show-indicator="false" :height="6" />
      <span class="subc-progress-text">{{ progressText }}</span>
    </div>

    <div v-if="errorMsg" class="subc-error">{{ errorMsg }}</div>
    <div v-if="axisNotes.length > 0" class="subc-axis-note">
      轴态跳变：{{ axisNotesText }}。
      跳变那一步一次吞下整窗易伤（失衡次数一变就换一整个窗），不是该词条这一步的收益 ——
      图上用橙色虚线空心圈标出，「累计(到该步)」不计入它们。曲线其余部分会随词条连续漂移轴态，那是真实收益，照常计入。
    </div>
    <div v-if="stale" class="subc-stale">
      配装 / 角色 / 现场已变：这两张图是上一次采样的现场，点「重算曲线」更新。
    </div>

    <template v-if="result && visibleSeries.length > 0">
      <ChartLegend
        :items="legendItems"
        :is-visible="legend.isVisible"
        hint="点词条显隐（两张图的纵轴各按可见曲线缩放）"
        show-all
        @toggle="legend.toggle"
        @show-all="legend.showAll"
      />

      <div class="subc-next">
        <div class="subc-next-head">
          <span class="subc-next-title">下一步该堆谁</span>
          <span class="subc-next-sub">{{ nextHint }}</span>
        </div>
        <ChartTable :columns="nextColumns" align="right" dense max-height="260px" empty="没有可比的词条">
          <tr v-for="r in nextRows" :key="r.stat">
            <td>{{ r.rank }}</td>
            <td>
              <span class="subc-dot" :style="{ background: r.color }"></span>{{ r.label }}
              <span v-if="r.best" class="subc-badge">下一步就堆它</span>
            </td>
            <td>{{ r.steps }}</td>
            <td>{{ r.nextText }}</td>
            <td>{{ r.cumulativeText }}</td>
            <td :style="{ color: r.noteColor }">{{ r.note }}</td>
          </tr>
        </ChartTable>
        <div v-if="nextHiddenCount > 0" class="subc-next-foot">另有 {{ nextHiddenCount }} 个词条下一步无收益（恒 0 或已到上限），未列出。</div>
      </div>

      <div v-for="plot in plots" :key="plot.key" class="subc-plot-block">
        <div class="subc-plot-head">
          <span class="subc-plot-title">{{ plot.title }}</span>
          <span class="subc-plot-sub">{{ plot.sub }}</span>
        </div>
        <div class="subc-plot">
          <svg :viewBox="plot.viewBox" class="subc-svg">
            <g v-for="g in plot.yTicks" :key="g.key">
              <line :x1="plot.left" :y1="g.y" :x2="plot.right" :y2="g.y" class="subc-grid" />
              <text :x="plot.left - 6" :y="g.y + 3" text-anchor="end" class="subc-tick">{{ g.label }}</text>
            </g>
            <text v-for="t in plot.xTicks" :key="t.key" :x="t.px" :y="plot.xTickY" text-anchor="middle" class="subc-tick">{{ t.x }}</text>
            <text :x="plot.titleX" :y="plot.axisTitleY" text-anchor="middle" class="subc-axis-title">第 x 步（每步 +1 次强化）</text>
            <template v-if="plot.cutoffY !== null">
              <line :x1="plot.left" :y1="plot.cutoffY" :x2="plot.right" :y2="plot.cutoffY" class="subc-cutline" stroke-dasharray="5,3" />
              <text :x="plot.left + 4" :y="plot.cutoffY - 4" class="subc-cutlabel">{{ plot.cutoffText }}</text>
            </template>
            <g v-for="s in plot.series" :key="s.stat">
              <polyline :points="s.path" fill="none" :style="{ stroke: s.color, strokeWidth: '1.6' }" stroke-linejoin="round" />
              <circle v-for="p in s.points" :key="p.key" :cx="p.cx" :cy="p.cy" :r="p.r" :style="p.style">
                <title>{{ p.title }}</title>
              </circle>
            </g>
          </svg>
        </div>
      </div>

      <ChartTable :columns="tableColumns" align="right" dense empty="没有可显示的词条" max-height="340px">
        <tr v-for="r in tableRows" :key="r.stat">
          <td><span class="subc-dot" :style="{ background: r.color }"></span>{{ r.label }}</td>
          <td>{{ r.allocated }}</td>
          <td>{{ r.firstText }}</td>
          <td>{{ r.tailText }}</td>
          <td>{{ r.tailStepText }}</td>
          <td>{{ r.cumulativeText }}</td>
          <td>{{ r.cumulativeToCapText }}</td>
          <td :style="{ color: r.axisJumped ? 'var(--c-warning-strong)' : 'var(--fg-3)' }">{{ r.axisText }}</td>
          <td :style="{ color: r.verdictColor }">{{ r.verdictText }}</td>
        </tr>
      </ChartTable>
    </template>
    <div v-else-if="result && !computing" class="subc-empty">
      曲线为空（{{ result.reason || "该槽位没有可选词条" }}）。
    </div>
    <div v-else-if="!result && !computing" class="subc-empty">
      选槽位后点「计算曲线」：逐词条采「第 x 步的边际」，把自动配比的取舍、以及「下一步该堆谁」画在同一张卡上。
    </div>
  </n-card>
</template>
<script setup lang="ts">
/**
 * 副词条收益曲线（2026-10-21 建；2026-10-24 加「两种纵轴口径 + 现场可选 + 下一步该堆谁」）。
 *
 * 数据/口径全在 `composables/substatCurve.ts`（采样 + 两种读数 + 门槛 + 下一步边际 + 轴范围），本组件只负责：
 * ① 起任务（`useBatchOwner` 吊销上一次 / 离开页面即停）、跑在**独立场景**上（`withAnalysisScenario`，
 *    采样不动页面正在用的 UI store）；② 图例筛选（共享 `useSeriesFilter` + `ChartLegend`）；
 * ③ 画**两张** SVG（同一批点、两种纵轴）与两张表（下一步决策表 / 明细表）。
 *
 * 口径要点（改之前读 `substatCurve.ts` 头注释）：
 * - **两种读法缺一不可**（用户 2026-10-24 裁决）：「相比于基础」分母固定 ⇒ 跨词条可比、决定下一步堆谁；
 *   「相比于上一步」分母随步数长大 ⇒ 边际效用递减的直观读数。**不能**拿「相比于上一步」跨词条比高低。
 * - **筛选必须传导到派生量**：两张图的纵轴/两张表只读 `visibleSeries`（`seriesFilter` 口径 ②）。
 * - **现场可以由玩家给**（`sceneMode`）：自动配比 / 当前配装 / 手动步数。基线总伤 = 现场总伤
 *   ⇒ 「我在 a 有 19 步、b 有 13 步的情况下还该堆谁」就是这张卡的默认问题。
 * - 求值贵（实测 50–75ms/点，10 词条 ≈ 6–10s）⇒ 显式按钮触发，不在进页面时自动跑。
 */
import { computed, reactive, ref } from "vue"
import { NCard, NButton, NSelect, NProgress, NInputNumber } from "naive-ui"
import ChartLegend from "@/components/charts/ChartLegend.vue"
import ChartTable from "@/components/charts/ChartTable.vue"
import { useSeriesFilter } from "@/composables/seriesFilter"
import { useBatchOwner } from "@/composables/batchTask"
import { withAnalysisScenario } from "@/composables/analysisScenario"
import {
  allocationCutoff,
  allocationMarker,
  axisChangeNote,
  curveAxisRange,
  defaultVisibleStats,
  nextStepMarginals,
  pointGain,
  sampleSubstatCurves,
  substatCurveCandidates,
  substatCurveVerdict,
  ZERO_GAIN_PCT,
  type SubstatCurveReading,
  type SubstatCurveResult,
  type SubstatCurveSeries,
} from "@/composables/substatCurve"
import { useConfigStore } from "@/stores/config"
import { useCatalogStore } from "@/stores/catalog"
import { substatShortLabel } from "@/data/substatLabels"
import { compact, fmt } from "@/utils/format"

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
/** 图例/表格的词条名 = 中文简称（`data/substatLabels`，用户口径 2026-10-21「大攻击 / 精通 / 小穿透」） */
const statLabel = substatShortLabel

/**
 * 数据色（`<script>` 里的字面色值 = UI_THEME_GUIDE §5 认可的「数据色」，明暗通吃、不跟随主题）：
 * 词条色编码信息（哪条线是哪条），跟随主题反而会让图例与线条分叉。
 */
const STAT_COLORS: Record<string, string> = {
  anomalyProficiency: "#63e2b7",
  atkPct: "#f0a020",
  penFlat: "#38bdf8",
  critRate: "#f472b6",
  critDmg: "#a78bfa",
  atkFlat: "#facc15",
  defPct: "#34d399",
  hpPct: "#fb923c",
  defFlat: "#94a3b8",
  hpFlat: "#c084fc",
}
const FALLBACK_COLOR = "#8b8b8b"
function colorOf(stat: string): string { return STAT_COLORS[stat] ?? FALLBACK_COLOR }

/** 默认槽位 = 队伍里第一个有角色的槽（`uiStore.selectedSlot` 可能正好是空槽，会落到禁用的下拉项上） */
const slot = ref<number>(Math.max(0, configStore.team.findIndex(c => !!c.agentId)))

// ========== 现场（基线）来源 ==========
type SceneMode = "auto" | "build" | "manual"
const sceneMode = ref<SceneMode>("auto")
const sceneOptions = [
  { label: "现场：自动配比", value: "auto" },
  { label: "现场：当前配装", value: "build" },
  { label: "现场：手动步数", value: "manual" },
]
const draft = reactive<Record<string, number>>({})
const statCapSetting = computed(() => configStore.getMechanicSetting("optimizer.substatCap", 20))
/** 自动配比现场（跑过一次 auto 才有；「载入自动配比」按钮只读它，不在这里重跑优化器） */
const autoAllocation = ref<Record<string, number> | null>(null)

function buildAllocation(): Record<string, number> {
  return { ...(configStore.team[slot.value]?.driveDisc.subStatAllocation ?? {}) }
}
function fillScene(allocation: Record<string, number> | null) {
  const src = allocation ?? {}
  for (const k of Object.keys(draft)) delete draft[k]
  for (const [k, v] of Object.entries(src)) {
    const n = Math.round(Number(v) || 0)
    if (n > 0) draft[k] = Math.min(statCapSetting.value, n)
  }
}
function setDraft(stat: string, v: number | null) {
  const n = Math.max(0, Math.min(statCapSetting.value, Math.round(v ?? 0)))
  if (n > 0) draft[stat] = n
  else delete draft[stat]
}
const draftTotal = computed(() => Object.values(draft).reduce((a, b) => a + b, 0))
const buildSceneTotal = computed(() => Object.values(buildAllocation()).reduce((a, b) => a + b, 0))
/** 手动模式的可编辑词条 = 模板词条在前 + 池内其余（与采样顺序同源） */
const sceneStats = computed(() => {
  const pool = (catalogStore.statRules?.driveDisc.subStatPool ?? []) as string[]
  const id = configStore.team[slot.value]?.agentId
  const agent = id ? catalogStore.getAgent(id) : null
  return agent ? substatCurveCandidates(agent, pool) : [...pool]
})

const computing = ref(false)
const errorMsg = ref("")
const progressPct = ref(0)
const progressText = ref("")
const result = ref<SubstatCurveResult | null>(null)
/** 采样时的现场签名：配装/角色/槽位/现场一变，曲线就不再对应当前现场 ⇒ 提示重算（不静默沿用旧图） */
const signature = computed(() => JSON.stringify({
  slot: slot.value,
  mode: sceneMode.value,
  manual: sceneMode.value === "manual" ? { ...draft } : null,
  team: configStore.team,
}))
const sampledSignature = ref("")
const stale = computed(() => !!result.value && sampledSignature.value !== signature.value)

const slotOptions = computed(() => [0, 1, 2].map(i => {
  const id = configStore.team[i]?.agentId
  const name = id ? (catalogStore.getAgent(id)?.name?.zhCN || id) : "空槽"
  return { label: "槽" + (i + 1) + " · " + name, value: i, disabled: !id }
}))

// ========== 图例筛选（状态在 useSeriesFilter，本组件只喂清单） ==========
const legend = useSeriesFilter(() => (result.value?.series ?? []).map(s => ({ id: s.stat, name: statLabel(s.stat) })))
const legendItems = computed(() => (result.value?.series ?? []).map(s => ({
  id: s.stat,
  label: statLabel(s.stat),
  color: colorOf(s.stat),
  title: (s.allocatedSteps > 0 ? "现场给了 " + s.allocatedSteps + " 步" : "现场没给它步数") + "；点击显隐",
})))

/**
 * 可见曲线（纵轴/表格的唯一输入——隐藏必须退出派生量，见 seriesFilter 口径 ②）。
 * 用 `isVisible` 而不是 `filter`：曲线的 id 是 `stat`，两者是同一份 `useSeriesFilter` 状态。
 */
const visibleSeries = computed<SubstatCurveSeries[]>(() =>
  (result.value?.series ?? []).filter(s => legend.isVisible(s.stat)))

// ========== 几何（两套坐标：同一批点、两种纵轴口径各自算轴） ==========
const PAD_L = 62
const PAD_R = 14
const PAD_T = 12
const PAD_B = 34
const SVG_H = 280
const svgW = computed(() => Math.max(420, Math.min(1180, typeof window !== "undefined" ? window.innerWidth - 100 : 860)))
const cutoff = computed(() => (result.value ? allocationCutoff(result.value) : null))
/** 门槛文案：自动配比现场叫「配比门槛」；玩家手填的现场叫「现场末步最小边际」 */
const cutoffLabel = computed(() => (sceneMode.value === "auto" ? "配比门槛" : "现场末步最小边际"))
const nextHint = computed(() => (sceneMode.value === "auto"
  ? "每行 = 在自动配比的现场上，再给这一个词条 +1 步值多少（分母 = 现场总伤，同尺 ⇒ 可直接比大小）。"
  : "每行 = 在你填的现场上，再给这一个词条 +1 步值多少（分母 = 现场总伤，同尺 ⇒ 可直接比大小）。"))

/** 一张图的坐标与路径（`reading` 决定纵轴取哪个数） */
function buildPlot(reading: SubstatCurveReading) {
  const series = visibleSeries.value
  const axis = curveAxisRange(series, reading)
  const plotW = svgW.value - PAD_L - PAD_R
  const plotH = SVG_H - PAD_T - PAD_B
  const sx = (x: number) => PAD_L + (x / (axis.xMax || 1)) * plotW
  const sy = (y: number) => PAD_T + plotH - ((y - axis.yMin) / (axis.yMax - axis.yMin || 1)) * plotH
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const y = axis.yMax - ((axis.yMax - axis.yMin) / 4) * i
    return { key: "g" + i, y: sy(y), label: fmt(y, 3) + "%" }
  })
  const max = Math.max(1, Math.round(axis.xMax))
  const n = Math.min(6, max)
  const xTicks = (n <= 1
    ? [{ x: 1 }]
    : Array.from({ length: n }, (_, i) => ({ x: Math.max(1, Math.round(1 + ((max - 1) / (n - 1)) * i)) }))
      .filter((t, i, arr) => arr.findIndex(o => o.x === t.x) === i))
    .map(t => ({ key: "x" + t.x, x: t.x, px: sx(t.x) }))
  const c = cutoff.value
  const cutoffInView = reading === "base" && c !== null && c >= axis.yMin && c <= axis.yMax ? c : null
  const origin = { stunCount: result.value?.baseAxis.stunCount ?? -1, coverage: result.value?.baseAxis.coverage ?? 0 }
  const drawn = series.map(s => {
    const pts = s.points.map((p, i) => {
      const prev = i > 0 ? s.points[i - 1]! : null
      const y = pointGain(p, reading)
      const isMarker = p.x === s.allocatedSteps && s.allocatedSteps > 0
      const warn = " —— 此处轴态跳变（失衡 " + (prev ? prev.axis.stunCount : origin.stunCount) + " → " + p.axis.stunCount
        + " 次，易伤覆盖 " + fmt((prev ? prev.axis.coverage : origin.coverage) * 100, 1) + "% → " + fmt(p.axis.coverage * 100, 1)
        + "%），这一步混入了整窗易伤差，不是词条收益"
      return {
        key: s.stat + "p" + p.x,
        cx: sx(p.x),
        cy: sy(y),
        r: isMarker ? 4 : p.axisJump ? 3.2 : 2,
        style: p.axisJump
          ? { fill: "none", stroke: "var(--c-warning)", strokeWidth: "1.6", strokeDasharray: "2,1.5" }
          : isMarker
            ? { fill: "none", stroke: colorOf(s.stat), strokeWidth: "1.6" }
            : { fill: colorOf(s.stat), stroke: "none" },
        title: statLabel(s.stat) + " 第 " + p.x + " 步：相比于基础 " + fmt(p.gainPct, 3) + "% / 相比于上一步 "
          + fmt(p.gainStepPct, 3) + "%（总伤 " + compact(p.damage) + "）" + (p.axisJump ? warn : ""),
      }
    })
    return {
      stat: s.stat,
      color: colorOf(s.stat),
      points: pts,
      path: pts.map((p, i) => (i === 0 ? "M" : "L") + p.cx.toFixed(1) + "," + p.cy.toFixed(1)).join(" "),
    }
  })
  return {
    axis,
    left: PAD_L,
    right: svgW.value - PAD_R,
    viewBox: "0 0 " + svgW.value + " " + SVG_H,
    xTickY: PAD_T + plotH + 14,
    axisTitleY: SVG_H - 3,
    titleX: PAD_L + plotW / 2,
    yTicks,
    xTicks,
    cutoffY: cutoffInView === null ? null : sy(cutoffInView),
    cutoffText: cutoffLabel.value + " " + fmt(cutoffInView ?? 0, 3) + "%",
    series: drawn,
  }
}

/**
 * 两张图的标题/说明（用户 2026-10-24：「按照基础的来标题就写相比于基础」「按照上一个的来就能体现
 * 边际效用递减」）。顺序：**相比于上一步在前**（用户点名「词条的显示应该显示当前 x 对于 x-1 的进步幅度」
 * = 主读数），相比于基础在后（跨词条比较 / 门槛 / 下一步决策的尺子）。
 */
const READINGS: Array<{ key: SubstatCurveReading; title: string; sub: string }> = [
  {
    key: "step",
    title: "相比于上一步（边际效用递减）",
    sub: "分母 = 上一步总伤（随步数长大）⇒ 曲线下弯就是这个词条越堆越不值；各自分母不同，不跨词条比高低",
  },
  {
    key: "base",
    title: "相比于基础",
    sub: "分母 = 现场总伤（固定）⇒ 加算词条是直线；同尺可比 ⇒ 虚线门槛与「下一步该堆谁」用它",
  },
]
const plots = computed(() => READINGS.map(r => ({ key: r.key, title: r.title, sub: r.sub, ...buildPlot(r.key) })))

// ========== 表 1：下一步该堆谁 ==========
const nextColumns = [
  { key: "rank", label: "#", width: "42px" },
  { key: "stat", label: "词条" },
  { key: "steps", label: "现场步数", width: "84px" },
  { key: "next", label: "下一步边际(相比于基础)", width: "170px" },
  { key: "cum", label: "累计(到该步)", width: "104px" },
  { key: "note", label: "说明", width: "150px" },
]
/** 表里只列「下一步真的能涨」的词条：恒 0 / 到上限的行会淹掉真答案（其余的条数写在表下脚注） */
const nextHiddenCount = computed(() => {
  const r = result.value
  if (!r) return 0
  return nextStepMarginals(r).filter(x => x.nextGainPct === null || x.nextGainPct <= ZERO_GAIN_PCT).length
})
const nextRows = computed(() => {
  const r = result.value
  if (!r) return []
  const rows = nextStepMarginals(r).filter(x => x.nextGainPct !== null && x.nextGainPct > ZERO_GAIN_PCT)
  const byStat = new Map(r.series.map(s => [s.stat, s]))
  const sorted = [...rows].sort((a, b) => {
    const av = a.nextGainPct!
    const bv = b.nextGainPct!
    return bv - av
  })
  return sorted.map((x, i) => {
    const s = byStat.get(x.stat)
    const note = x.atCap ? "已到单词条上限" : ""
    return {
      rank: i + 1,
      stat: x.stat,
      label: statLabel(x.stat),
      color: colorOf(x.stat),
      steps: x.steps,
      nextText: x.nextGainPct === null ? "—" : fmt(x.nextGainPct, 3) + "%",
      cumulativeText: s ? fmt(s.cumulativePct, 2) + "%" : "—",
      note,
      noteColor: i === 0 ? "var(--c-success-strong)" : "var(--fg-3)",
      best: i === 0,
    }
  })
})

// ========== 表 2：明细 ==========
const tableColumns = [
  { key: "stat", label: "词条" },
  { key: "allocated", label: "现场步数", width: "78px" },
  { key: "first", label: "首步边际", width: "88px" },
  { key: "tail", label: "该步边际", width: "88px" },
  { key: "tailStep", label: "该步(相比于上一步)", width: "130px" },
  { key: "cum", label: "累计(到该步)", width: "104px" },
  { key: "cumCap", label: "累计(到上限)", width: "104px" },
  { key: "axis", label: "轴态", width: "92px" },
  { key: "verdict", label: "判定", width: "116px" },
]
/** 判定文案：现场可以是玩家给的 ⇒ 用中性词（已投 / 低于末步 / 够格未投） */
const VERDICT_TEXT: Record<string, string> = {
  chosen: "已投",
  dropped: "低于末步·不必加",
  "kept-out": "够格但未投",
  flat: "无收益",
}
const VERDICT_COLOR: Record<string, string> = {
  chosen: "var(--c-success-strong)",
  dropped: "var(--fg-3)",
  "kept-out": "var(--c-warning-strong)",
  flat: "var(--fg-3)",
}
const tableRows = computed(() => {
  const cut = cutoff.value
  return visibleSeries.value.map(s => {
    const first = s.points[0]
    const marker = allocationMarker(s)
    // 「该步边际」= 现场在**这一步**的边际；0 步的词条没有「该步」，给 —（别拿它末个采样点冒充）
    const tail = marker
    const verdict = substatCurveVerdict(s, cut)
    return {
      stat: s.stat,
      label: statLabel(s.stat),
      color: colorOf(s.stat),
      allocated: s.allocatedSteps,
      firstText: first ? fmt(first.gainPct, 3) + "%" : "-",
      tailText: tail ? fmt(tail.gainPct, 3) + "%" : "-",
      tailStepText: tail ? fmt(tail.gainStepPct, 3) + "%" : "-",
      cumulativeText: fmt(s.cumulativePct, 2) + "%",
      cumulativeToCapText: fmt(s.cumulativeToCapPct, 2) + "%",
      axisJumped: s.axisChangedAt.length > 0,
      axisText: s.axisChangedAt.length > 0 ? "第 " + s.axisChangedAt.join("、") + " 步跳变" : "平滑",
      verdictText: VERDICT_TEXT[verdict],
      verdictColor: VERDICT_COLOR[verdict],
    }
  })
})

const axisNotes = computed(() => {
  const r = result.value
  if (!r) return []
  return visibleSeries.value
    .map(s => ({ stat: s.stat, label: statLabel(s.stat), note: axisChangeNote(s) }))
    .filter(x => !!x.note)
})
const axisNotesText = computed(() => axisNotes.value.map(n => n.label + " " + n.note).join("；"))

// ========== 采样（独立场景；吊销上一次 / 离开页面即停） ==========
const owner = useBatchOwner()

/** 默认可见集 = 模板词条 ∪ 已投词条（其余收起，用户点图例可展开） */
function applyDefaultVisibility(res: SubstatCurveResult) {
  const keep = new Set(defaultVisibleStats(res))
  for (const s of res.series) {
    if (!keep.has(s.stat) && legend.isVisible(s.stat)) legend.toggle(s.stat)
  }
}

async function run() {
  const task = owner.start()
  computing.value = true
  errorMsg.value = ""
  progressPct.value = 0
  progressText.value = ""
  const allocation = sceneMode.value === "auto"
    ? undefined
    : sceneMode.value === "build" ? buildAllocation() : { ...draft }
  try {
    const res = await withAnalysisScenario(s => sampleSubstatCurves(s, {
      slot: slot.value,
      control: { signal: task.signal },
      allocation,
      onProgress: p => {
        task.commit(() => { progressPct.value = p.pct; progressText.value = p.text })
      },
    }))
    task.commit(() => {
      result.value = res
      sampledSignature.value = signature.value
      if (sceneMode.value === "auto") {
        autoAllocation.value = { ...res.allocation }
        // 手动现场从「自动配比」起步（省得玩家自己从零填 10 个格子）
        if (Object.keys(draft).length === 0) fillScene(res.allocation)
      }
      legend.showAll()
      applyDefaultVisibility(res)
    })
  } catch (e) {
    task.commit(() => { errorMsg.value = "计算失败：" + (e instanceof Error ? e.message : String(e)) })
  } finally {
    task.commit(() => { computing.value = false; progressPct.value = 0; progressText.value = "" })
  }
}
</script>
<style scoped>
.subc-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; width: 100%; }
.subc-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.subc-caption { font-size: 11px; color: var(--fg-3); line-height: 1.8; margin-bottom: 8px; }
.subc-scene { border: 1px solid var(--app-border); border-radius: 4px; padding: 8px; margin-bottom: 10px; background: var(--app-panel); }
.subc-scene-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.subc-scene-title { font-size: 12px; color: var(--fg-2); }
.subc-scene-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.subc-scene-total { font-size: 11px; color: var(--fg-3); }
.subc-scene-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px 14px; }
.subc-scene-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.subc-scene-label { font-size: 12px; color: var(--fg-2); }
.subc-scene-note { font-size: 11px; color: var(--fg-3); margin-bottom: 8px; }
.subc-progress { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.subc-progress-text { font-size: 11px; color: var(--fg-2); white-space: nowrap; }
.subc-error { font-size: 12px; color: var(--c-danger); margin-bottom: 8px; }
.subc-next { margin-top: 8px; }
.subc-next-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.subc-next-title { font-size: 13px; font-weight: 600; color: var(--app-text-solid); }
.subc-next-sub { font-size: 11px; color: var(--fg-3); }
.subc-next-foot { font-size: 11px; color: var(--fg-3); padding: 4px 2px; }
.subc-badge { display: inline-block; margin-left: 6px; padding: 0 5px; border-radius: 3px; font-size: 10px; color: var(--c-success-strong); background: var(--c-success-soft); }
.subc-plot-block { margin-top: 14px; }
.subc-plot-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
.subc-plot-title { font-size: 13px; font-weight: 600; color: var(--app-text-solid); }
.subc-plot-sub { font-size: 11px; color: var(--fg-3); }
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
.subc-axis-note { font-size: 11px; color: var(--c-warning-strong); background: var(--c-warning-soft); border-radius: 3px; padding: 6px 8px; margin-bottom: 8px; line-height: 1.6; }
</style>
