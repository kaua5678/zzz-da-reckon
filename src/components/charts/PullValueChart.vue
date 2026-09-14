<template>
<n-card size="small" :bordered="true">
  <template #header>
    抽卡价值 · 危局兑现
    <span class="chart-subtitle">按抽取以来在危局实际兑现的分数总和给卡分级（同作者同房间「带卡 vs 不带卡」最佳分差的配对差分——玩家技术与当期环境被差分吸收；数据源 = 实战归档）</span>
  </template>
  <template #header-extra>
    <div class="chart3-actions">
      <n-select
        v-model:value="pvTierFilter"
        :options="pvTierFilterOptions"
        size="small"
        style="width: 130px"
      />
      <n-button size="small" type="primary" :loading="pvComputing" @click="runPullValue">
        {{ pvResult ? '重算' : '计算' }}
      </n-button>
    </div>
  </template>

  <div v-if="pvError" class="empty-hint small-hint">⚠ {{ pvError }}</div>
  <div v-else-if="!pvResult" class="empty-hint small-hint">
    点「计算」加载实战归档并估计每张卡的危局兑现：横轴 = 归档覆盖的危局房间（期 × 关卡），
    每行一张卡、气泡 = 当期边际兑现分（同作者带卡/不带卡最佳分差的中位数，未出场计 0），行末柱 = 累计兑现总和。
    分级 T0~T3 = 限定池累计四分位（配对数 ≥ {{ PV_MIN_PAIRS }} 才参与，否则「样本不足」）。
  </div>

  <template v-else>
    <!-- 窗口摘要 -->
    <div class="pv-summary">
      <span>观测窗口 {{ pvResult.window.firstDate }} ~ {{ pvResult.window.lastDate }}</span>
      <span>{{ pvResult.window.seasonCount }} 个赛季 · {{ pvResult.rooms.length }} 个危局房间 · {{ compact(pvResult.window.runCount) }} 条投稿</span>
      <span>单房间分数上限 65000（删失点：都打满 → 边际计 0）</span>
    </div>

    <!-- 分级筛选（点图例显隐某档；与「层」下拉是两个正交维度：层=卡池归属，分级=兑现强弱） -->
    <div class="legend">
      <span class="legend-hint">点图例显隐分级 · 显示 {{ pvCounts.visible }}/{{ pvCounts.total }} 档（行与排名表同源过滤）</span>
      <div
        v-for="g in pvGradeDefs"
        :key="g.id"
        class="legend-item"
        :class="{ off: !pvGradeLegend.isVisible(g.id) }"
        :title="`${g.desc}：点击${pvGradeLegend.isVisible(g.id) ? '隐藏' : '显示'}该档`"
        @click="pvGradeLegend.toggle(g.id)"
      >
        <span class="swatch" :style="{ background: g.color }"></span><span class="name">{{ g.label }}</span>
      </div>
      <span class="legend-hint legend-action" @click="pvGradeLegend.showAll()">全显示</span>
    </div>

    <!-- 时间轴气泡图：行 = 卡（按累计降序），列 = 房间 -->
    <div class="timeline-wrap pv-plot">
      <svg :viewBox="`0 0 ${svgW} ${pvSvgH}`" class="timeline-svg" @mousemove="onPvMove" @mouseleave="pvHover = ''">
        <!-- Y 轴行标签（角色名 + 分级徽标） -->
        <g v-for="row in pvRows" :key="row.agentId">
          <rect
            :x="0" :y="pvRowY(row.rowIndex) - pvRowH / 2"
            :width="svgW" :height="pvRowH"
            :class="{ 'pv-row-hover': pvHover === row.agentId }"
            class="pv-row-bg"
            @click="pvSelected = pvSelected === row.agentId ? '' : row.agentId"
          >
            <title>{{ pvRowTitle(row) }}</title>
          </rect>
          <text :x="pvLabelW - 6" :y="pvRowY(row.rowIndex) + 3.5" text-anchor="end" class="pv-row-label">
            {{ row.label }}
          </text>
          <text v-if="row.gradeText" :x="pvLabelW + 2" :y="pvRowY(row.rowIndex) + 3.5" class="pv-grade" :class="'pv-' + row.card.grade">
            {{ row.gradeText }}
          </text>
        </g>
        <!-- X 轴房间刻度（抽稀） -->
        <g v-for="t in pvXTicks" :key="'pvx' + t.index">
          <text :x="pvX(t.index)" :y="pvSvgH - 6" text-anchor="middle" class="axis-label x-label">{{ t.label }}</text>
        </g>
        <!-- 实装边界竖线（选中卡） -->
        <g v-if="pvSelectedCard && pvSelectedCard.firstRoomIndex >= 0 && pvSelectedCard.firstRoomIndex < pvResult.rooms.length">
          <line
            :x1="pvX(pvSelectedCard.firstRoomIndex)" :y1="pvPadT - 6"
            :x2="pvX(pvSelectedCard.firstRoomIndex)" :y2="pvSvgH - pvXLabelH"
            class="pv-release-line"
          />
          <text :x="pvX(pvSelectedCard.firstRoomIndex) + 3" :y="pvPadT - 10" class="pv-release-label">实装</text>
        </g>
        <!-- 气泡：边际兑现（红正绿负？——正=橙红高亮，负=蓝） -->
        <g v-for="row in pvRows" :key="'b' + row.agentId">
          <circle
            v-for="(e, i) in row.card.roomEffects"
            :key="row.agentId + i"
            :cx="pvX(i)"
            :cy="pvRowY(row.rowIndex)"
            :r="pvBubbleR(e)"
            :fill="pvBubbleFill(e)"
            :stroke="pvHover === row.agentId || pvSelected === row.agentId ? 'var(--app-text-solid)' : 'var(--wa-150)'"
            :stroke-width="pvHover === row.agentId || pvSelected === row.agentId ? 1.2 : 0.5"
            class="pv-bubble"
          >
            <title>{{ pvBubbleTitle(row.card, e, i) }}</title>
          </circle>
        </g>
        <!-- 行末累计柱 + 数值 -->
        <g v-for="row in pvRows" :key="'c' + row.agentId">
          <rect
            :x="pvBarX" :y="pvBarY(row.card)"
            :width="pvBarW(row.card)" :height="pvBarH"
            :fill="pvBarFill(row.card)"
            rx="2"
            class="pv-bar"
          >
            <title>{{ pvRowTitle(row) }}</title>
          </rect>
          <text :x="pvBarX + pvBarW(row.card) + 4" :y="pvRowY(row.rowIndex) + 3.5" class="pv-bar-label">
            {{ compact(row.card.cumulative) }}
          </text>
        </g>
      </svg>
    </div>

    <!-- 选中卡详情：逐房间边际曲线 -->
    <div v-if="pvSelectedCard" class="pv-detail">
      <div class="pv-detail-title">
        {{ agentName(pvSelectedCard.agentId) }} · {{ pvTierLabel(pvSelectedCard.tier) }}
        <template v-if="pvSelectedCard.releaseDate"> · 实装 {{ pvSelectedCard.releaseDate }}</template>
        · 累计兑现 {{ fmt(pvSelectedCard.cumulative, 0) }} 分（{{ pvSelectedCard.observableRooms }} 期可观测 · 上场 {{ pvSelectedCard.roomsAppeared }} 期 · 顶分在场 {{ pvSelectedCard.frontierRooms }} 期）
        · 场均 {{ fmt(pvSelectedCard.avgPerRoom, 0) }} · 近 3 期场均 {{ fmt(pvSelectedCard.recentAvg, 0) }}
        · 每万菲林 {{ pvSelectedCard.roiPer10kFilm == null ? '—（赠送）' : fmt(pvSelectedCard.roiPer10kFilm, 0) }} 分
        · {{ pvSelectedCard.totalPairs }} 个配对
      </div>
      <div class="pv-detail-bars">
        <div v-for="(e, i) in pvSelectedCard.roomEffects" :key="i" class="pv-detail-bar" :class="{ 'pv-out': e.effect === 0 && !e.appeared }">
          <div
            class="pv-detail-bar-fill"
            :style="{ height: pvDetailBarH(e) }"
            :class="e.effect >= 0 ? 'pv-pos' : 'pv-neg'"
          ></div>
          <span class="pv-detail-bar-label">{{ pvResult.rooms[i]?.label }}</span>
          <span class="pv-detail-bar-val">{{ e.effect === 0 && !e.appeared ? '—' : fmt(e.effect, 0) }}</span>
        </div>
      </div>
    </div>

    <!-- 排名表 -->
    <div class="table-wrap">
      <table class="tl-table">
        <thead>
          <tr>
            <th>#</th>
            <th>卡</th>
            <th>层</th>
            <th>分级</th>
            <th>累计兑现</th>
            <th>场均</th>
            <th>近3期场均</th>
            <th>每万菲林</th>
            <th>上场/可观测</th>
            <th>顶分在场</th>
            <th>配对数</th>
            <th>实装</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(c, i) in pvTableRows"
            :key="c.agentId"
            :class="{ 'pv-sel-row': pvSelected === c.agentId }"
            @click="pvSelected = pvSelected === c.agentId ? '' : c.agentId"
          >
            <td>{{ i + 1 }}</td>
            <td><span class="dot" :style="{ background: colorOf(c.agentId) }"></span>{{ agentName(c.agentId) }}</td>
            <td>{{ pvTierLabel(c.tier) }}</td>
            <td>
              <span v-if="c.grade" class="pv-grade" :class="'pv-' + c.grade">{{ c.grade }}</span>
              <span v-else-if="c.totalPairs > 0" class="no-change">样本不足</span>
              <span v-else class="no-change">—</span>
            </td>
            <td :class="{ 'kill-line': c.cumulative > 0 }">{{ fmt(c.cumulative, 0) }}</td>
            <td>{{ fmt(c.avgPerRoom, 0) }}</td>
            <td :class="{ 'pv-neg-num': c.recentAvg < 0 }">{{ fmt(c.recentAvg, 0) }}</td>
            <td>{{ c.roiPer10kFilm == null ? '—' : fmt(c.roiPer10kFilm, 0) }}</td>
            <td>{{ c.roomsAppeared }}/{{ c.observableRooms }}</td>
            <td>{{ c.frontierRooms }}</td>
            <td>{{ c.totalPairs }}</td>
            <td>{{ c.releaseDate ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="dd-caption">
      口径：边际 = 同房间同一玩家「带该卡最佳分 − 不带最佳分」跨玩家取中位数（作者/房间固定效应被差分吸收；估计 = 玩家选它上场时的 treatment-on-the-treated）；
      未出场 / 无配对 / 实装前计 0；带不带都打满 65000 边际如实计 0（顶部饱和）。「累计兑现」= 实装以来 Σ 边际（无折现）；
      分级 = 限定池（含赠送 S）累计四分位 T0~T3，配对 &lt; {{ PV_MIN_PAIRS }} = 样本不足。A 级基线（妮可/苍角等）是「没卡时的占位选择」，
      负边际 = 与更好卡的机会差，不参与分级。观测窗口 = 归档覆盖的 23 个赛季（更早实装的卡只累计窗口内兑现）。
    </div>
  </template>

  <div v-if="pvComputing" class="chart-progress">
    <n-progress type="line" :percentage="100" :show-indicator="false" :height="6" status="success" processing />
    <span class="progress-text">估计配对差分…</span>
  </div>
</n-card>
</template>

<script setup lang="ts">
/**
 * Chart 5「抽卡价值 · 危局兑现」（2026-09-14 从 TimeChartsPage 抽组件，202 行模板 + 76 行脚本）。
 *
 * 为什么这块最后才抽：它需要一批**页内多块共享**的样式（.table-wrap/.tl-table/.timeline-* 等）。
 * 那些类**不能**放全局表——scoped 会追加 [data-v-*] 使其特异性高于全局同名规则，
 * 搬进全局 = 降特异性 ⇒ 与页面其它 scoped 规则打架（详见 src/styles/chart-blocks.css 文件头）。
 * 本轮用「独立文件 + <style scoped src>」解开该死结后，本组件得以外置：
 * `chart-blocks.css` 与 `pull-value-chart.css` 都以 scoped src 载入 ⇒ 带本组件 scope id、特异性不变。
 *
 * 组件自带状态（计算/错误/结果/筛选/悬浮/选中）与懒加载缓存 —— 与父页面无耦合；
 * 父页面只传 `svgW`（响应式布局宽度）。
 * 解析器 `computePullValue` 是纯函数（零引擎求值），本组件因此不依赖 useResourceCalc。
 */
import { computed, ref } from 'vue'
import { NButton, NCard, NProgress, NSelect } from 'naive-ui'
import { compact, fmt } from '@/utils/format'
import { useCatalogStore } from '@/stores/catalog'
import { useSeriesFilter } from '@/composables/seriesFilter'
import { colorOf } from '@/composables/charts/agentPresentation'
import { readSvgPointer } from '@/composables/svgPointer'
import { MIN_PAIRS_FOR_GRADE, computePullValue, type PullValueInput, type PullValueResult, type PvCardRoomEffect, type PvCardValue } from '@/composables/pullValue'
import { PV_GRADE_DEFS as pvGradeDefs, buildPullValueChart, pvTierLabel } from '@/composables/pullValueChart'

const props = defineProps<{
  /** 图表宽度（父页面的响应式布局宽度） */
  svgW: number
}>()

const catalogStore = useCatalogStore()
function agentName(id: string): string {
  return catalogStore.getAgent(id)?.name.zhCN ?? id
}

const PV_MIN_PAIRS = MIN_PAIRS_FOR_GRADE
const pvComputing = ref(false)
const pvError = ref('')
const pvResult = ref<PullValueResult | null>(null)
const pvTierFilter = ref<'limited' | 'all'>('limited')
const pvTierFilterOptions = [
  { value: 'limited', label: '限定池（含赠送）' },
  { value: 'all', label: '全部（含常驻/A级）' },
]
const pvSelected = ref('')
const pvHover = ref('')

/** 归档懒加载缓存（会话内一次） */
let pvArchive: PullValueInput | null = null

async function runPullValue() {
  pvComputing.value = true
  pvError.value = ''
  try {
    let archive: PullValueInput | null = pvArchive
    if (!archive) {
      const res = await fetch('/static/run-archive.json')
      if (!res.ok) throw new Error(`归档加载失败（HTTP ${res.status}）——run-archive.json 不在 public/static 下`)
      archive = (await res.json()) as PullValueInput
      pvArchive = archive
    }
    pvResult.value = computePullValue(archive)
  } catch (e) {
    pvError.value = e instanceof Error ? e.message : String(e)
  } finally {
    pvComputing.value = false
  }
}

const pvSelectedCard = computed(() => pvResult.value?.cards.find(c => c.agentId === pvSelected.value) ?? null)

/** 派生模型（过滤/行整形/布局/文案）在 composables/pullValueChart.ts（纯函数，可单测） */
const pvGradeLegend = useSeriesFilter(() => pvGradeDefs.map(g => ({ id: g.id, name: g.label })))
const pvCounts = pvGradeLegend.counts
const pvc = computed(() => buildPullValueChart({
  cards: pvResult.value?.cards ?? [],
  rooms: pvResult.value?.rooms ?? [],
  svgW: props.svgW,
  tierFilter: pvTierFilter.value,
  isGradeVisible: (g) => pvGradeLegend.isVisible(g),
  nameOf: (id) => agentName(id),
  fmt,
}))
const pvRows = computed(() => pvc.value.rows)
const pvTableRows = computed(() => pvc.value.tableRows)
const pvLabelW = pvc.value.labelW
const pvRowH = pvc.value.rowH
const pvPadT = pvc.value.padT
const pvXLabelH = pvc.value.xLabelH
const pvSvgH = computed(() => pvc.value.svgH)
const pvBarX = computed(() => pvc.value.barX)
const pvBarH = pvc.value.barH
function pvX(i: number): number { return pvc.value.x(i) }
function pvRowY(rowIndex: number): number { return pvc.value.rowY(rowIndex) }
function pvBubbleR(e: { effect: number }): number { return pvc.value.bubbleR(e) }
function pvBubbleFill(e: { effect: number }): string { return pvc.value.bubbleFill(e) }
function pvBubbleTitle(card: PvCardValue, e: PvCardRoomEffect, i: number): string { return pvc.value.bubbleTitle(card, e, i) }
function pvDetailBarH(e: PvCardRoomEffect): string { return pvc.value.detailBarH(e) }
function pvBarW(card: PvCardValue): number { return pvc.value.barW(card) }
function pvBarY(card: PvCardValue): number { return pvc.value.barY(card) }
function pvBarFill(card: PvCardValue): string { return pvc.value.barFill(card) }
function pvRowTitle(row: { card: PvCardValue }): string { return pvc.value.rowTitle(row) }
// pvTierLabel 来自 composables/pullValueChart.ts（单一事实源，勿在组件里再抄一份）
const pvXTicks = computed(() => pvc.value.xTicks)
function onPvMove(e: MouseEvent) {
  const { svgY } = readSvgPointer(e, { w: props.svgW, h: pvSvgH.value })
  const idx = Math.floor((svgY - pvPadT) / pvRowH)
  pvHover.value = pvRows.value[idx]?.agentId ?? ''
}
</script>

<style scoped src="@/styles/chart-blocks.css"></style>
<style scoped src="../../views/timeCharts/pull-value-chart.css"></style>
