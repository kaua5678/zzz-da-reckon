<template>
  <div
    v-if="ui.recordWindowOpen"
    ref="rootEl"
    class="rw"
    :class="{ 'rw-collapsed': ui.recordWindowCollapsed }"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
  >
    <div class="rw-head" @pointerdown="onDragStart">
      <span class="rw-title">记录小窗</span>
      <span class="rw-count">{{ rows.length }} 项</span>
      <span class="rw-spacer" />
      <button class="rw-icon" title="以当前为基准" @click="rowsApi.capture()">⌖</button>
      <button
        class="rw-icon"
        :disabled="!rowsApi.hasBaseline.value"
        title="清除基准"
        @click="rowsApi.clearBaseline()"
      >⌀</button>
      <button class="rw-icon" title="收起/展开" @click="ui.recordWindowCollapsed = !ui.recordWindowCollapsed">
        {{ ui.recordWindowCollapsed ? '▸' : '▾' }}
      </button>
    </div>

    <div v-show="!ui.recordWindowCollapsed" class="rw-body">
      <div v-if="rows.length === 0" class="rw-empty">没有可显示的指标，去设置里勾选</div>
      <table v-else class="rw-table">
        <thead>
          <tr>
            <th class="rw-th-name">指标</th>
            <th class="rw-th-num">当前</th>
            <th v-if="rowsApi.hasBaseline.value" class="rw-th-num">基准</th>
            <th v-if="rowsApi.hasBaseline.value" class="rw-th-num">Δ</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key">
            <td class="rw-td-name" :title="row.def.hint">{{ rowLabel(row) }}</td>
            <td class="rw-td-num">{{ row.formatted }}</td>
            <td v-if="rowsApi.hasBaseline.value" class="rw-td-num rw-base">{{ row.baseFormatted }}</td>
            <td
              v-if="rowsApi.hasBaseline.value"
              class="rw-td-num"
              :class="`rw-delta-${row.tone}`"
            >{{ row.deltaFormatted }}</td>
          </tr>
        </tbody>
      </table>
      <div class="rw-foot">
        <span v-if="rowsApi.hasBaseline.value" class="rw-hint">⌖ 已钉基准 · Δ 颜色按「越大/越小越好」</span>
        <span v-else class="rw-hint">点 ⌖ 以当前读数为基准，之后看 Δ</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 便携记录小窗（悬浮、常驻、可拖动、可收起）。
 *
 * ## 挂载点与读数来源（本组件最重要的两条约束）
 * ① **常驻 = 挂在 `CalculatorView` 的 `pageMap` 之外**（页面切换不重挂），不是塞进某一页；
 * ② **读数由 props 传入** —— `calc` 是 `CalculatorView` 的应用级 `useResourceCalc()` 实例。
 *    ⚠ 本组件**不得**调用 `useResourceCalc()`：每次调用都新建一整套 computed 图，
 *    r705 事故（`ImpactChart` 自建第二个实例）实测让资源利用率页每次状态变化整条管线跑两遍
 *    （重队每遍 430–506ms）。判据 = `recordWindow.test.ts` 的源码锁 + A4 性能判据。
 *
 * 拖动用 **pointer 事件 + 归一化比例**（不是像素）：窗口大小/屏幕尺寸变化后位置仍成立，
 * 且 `position: fixed` 的百分比在缩放时自动跟随（像素坐标会在缩窗后跑到屏外）。
 * 位置/开关/收起状态住 `stores/ui.ts`（**界面态不进 config**：config 的 `$state` 是 calcOutput
 * 记忆化键，进键的字段一变就全量重算——小窗开关绝不该触发引擎求值）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useCatalogStore } from '@/stores/catalog'
import type { Calc, MetricEnv } from '@/composables/freeCompare/metrics'
import { pickLabel, useRecordRows, type RecordRow } from '@/composables/recordWindow'

const props = defineProps<{
  /** 页面持有的资源计算实例（**只读**，见头注 ②） */
  calc: Calc
  /** Boss 血量（Boss 血量比指标要；引擎里没有这个量，见 metrics.ts#MetricEnv） */
  hp: number
}>()

const ui = useUiStore()
const catalog = useCatalogStore()
const rootEl = ref<HTMLElement | null>(null)

const env = (): MetricEnv => ({ hp: props.hp })
const rowsApi = useRecordRows(() => props.calc, env, () => ui.recordWindowPicks)

/** 分人行的角色名（catalog 未就绪时回落 agentId，不显示空） */
const nameOf = (agentId: string): string => {
  const agent = catalog.agentsMap.get(agentId)
  return agent?.name.zhCN || agent?.name.en || agentId
}
const rows = computed<RecordRow[]>(() => rowsApi.rows.value)
const rowLabel = (row: RecordRow): string => pickLabel(row.def, row.pick, nameOf)

// ---------- 拖动（归一化比例，见头注） ----------
const pos = computed(() => ({
  x: ui.recordWindowPos.x * Math.max(0, window.innerWidth - 320),
  y: ui.recordWindowPos.y * Math.max(0, window.innerHeight - 120),
}))

let drag: { dx: number; dy: number } | null = null

function onDragStart(e: PointerEvent) {
  // 头部按钮不参与拖动（否则点「收起」会顺带挪窗）
  if ((e.target as HTMLElement).closest('button')) return
  const rect = rootEl.value?.getBoundingClientRect()
  if (!rect) return
  drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
  e.preventDefault()
}

function onDragMove(e: PointerEvent) {
  if (!drag) return
  const maxX = Math.max(1, window.innerWidth - 320)
  const maxY = Math.max(1, window.innerHeight - 120)
  ui.recordWindowPos = {
    x: Math.min(1, Math.max(0, (e.clientX - drag.dx) / maxX)),
    y: Math.min(1, Math.max(0, (e.clientY - drag.dy) / maxY)),
  }
}

function onDragEnd() {
  drag = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
}

onMounted(() => {
  if (catalog.teammateBuffsStatus === 'idle') void catalog.loadTeammateBuffs()
})
onBeforeUnmount(onDragEnd)

/** 供设置弹层展示「当前会显示几项」（避免两处各算一遍行数） */
defineExpose({ rowCount: computed(() => ui.recordWindowPicks.length), hasBaseline: rowsApi.hasBaseline })
</script>

<style scoped>
/* 悬浮层：z-index 取 --z-dropdown（100）之下、页面内容之上——
   它要压住 sticky 表头（--z-sticky 10），但不能压住 naive 的下拉/弹层（100+）。 */
.rw {
  position: fixed;
  z-index: 60;
  width: 300px;
  background: var(--app-header-bg);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-3);
  backdrop-filter: blur(10px);
  color: var(--app-text);
  font-size: var(--text-md);
  user-select: none;
  overflow: hidden;
}

.rw-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--app-tablehead-bg);
  border-bottom: 1px solid var(--app-border);
  cursor: move;
}

.rw-title {
  font-size: var(--text-md);
  font-weight: var(--weight-bold);
  color: var(--app-text-solid);
}

.rw-count {
  font-size: var(--text-xs);
  color: var(--fg-3);
}

.rw-spacer {
  flex: 1;
}

.rw-icon {
  border: 1px solid var(--app-border);
  background: var(--fill-hover);
  color: var(--fg-2);
  border-radius: var(--radius-sm);
  font-size: var(--text-md);
  line-height: 1;
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
}

.rw-icon:hover:not(:disabled) {
  border-color: var(--line-strong);
  color: var(--app-text-solid);
}

.rw-icon:disabled {
  opacity: 0.4;
  cursor: default;
}

.rw-body {
  max-height: 46vh;
  overflow-y: auto;
}

.rw-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

.rw-table th {
  position: sticky;
  top: 0;
  background: var(--app-inset);
  color: var(--fg-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  text-align: right;
  padding: var(--space-2) var(--space-4);
}

.rw-th-name,
.rw-td-name {
  text-align: left;
}

.rw-td-name {
  color: var(--fg-2);
  padding: var(--space-2) var(--space-4);
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rw-td-num {
  text-align: right;
  padding: var(--space-2) var(--space-4);
  color: var(--app-text-solid);
}

.rw-base {
  color: var(--fg-3);
}

/* Δ 颜色方向由 recordWindow#deltaTone 按 MetricDef.higherBetter 决定（不在这里判方向） */
.rw-delta-good {
  color: var(--c-success);
}

.rw-delta-bad {
  color: var(--c-danger);
}

.rw-delta-same,
.rw-delta-none {
  color: var(--fg-3);
}

.rw-empty,
.rw-foot {
  padding: var(--space-4);
  color: var(--fg-3);
  font-size: var(--text-sm);
}

.rw-foot {
  border-top: 1px solid var(--app-border);
}

.rw-hint {
  line-height: var(--leading-tight);
}
</style>
