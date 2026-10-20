<template>
  <div class="heatmap-root">
    <div class="heatmap-controls">
      <n-radio-group v-model:value="mode" size="small">
        <n-radio-button value="provider">行=提供者 · 列=属性</n-radio-button>
        <n-radio-button value="content">行=内容 · 列=属性</n-radio-button>
      </n-radio-group>
      <div class="legend">
        <span class="legend-label">拐力强度</span>
        <span class="legend-bar" />
        <span class="legend-label">弱 → 强</span>
      </div>
      <span class="muted">行小计 / 列小计 = 该提供者 / 该属性的拐力总量（用于跨队大致对比）</span>
    </div>

    <div v-if="!rows.length" class="empty">当前层没有可画的贡献</div>

    <div v-else class="heatmap-scroll">
      <table class="heatmap">
        <thead>
          <tr>
            <th class="corner">{{ mode === 'provider' ? '提供者' : '内容' }}</th>
            <th v-for="col in columns" :key="col.key" class="col-head" :title="col.label">
              <span class="col-head-text">{{ col.label }}</span>
            </th>
            <th class="total-head">行小计</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key">
            <th class="row-head" :title="row.label">{{ row.label }}</th>
            <td
              v-for="col in columns"
              :key="col.key"
              class="cell"
              :class="{ 'cell-empty': !cellOf(row, col.key) }"
              :style="cellStyle(cellOf(row, col.key))"
              :title="cellTitle(row, col)"
            >
              <span v-if="cellOf(row, col.key)" class="cell-text">{{ formatAmount(cellOf(row, col.key)!, col.mode) }}</span>
            </td>
            <td class="row-total">{{ formatAmount(row.total, row.mode) }}</td>
          </tr>
          <tr class="col-total-row">
            <th class="row-head">列小计</th>
            <td v-for="col in columns" :key="col.key" class="col-total">{{ formatAmount(col.total, col.mode) }}</td>
            <td class="grand-total">{{ formatAmount(grandTotal, 'flat') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 拐力热力图（2026-10-20 重写，替代此前的伪 3D 柱状图）。
 *
 * 用户口径：
 * > 「你用柱子把 2d 装成 3d 完全没必要，那还不如直接 2d 呢。3d 数字图加上颜色更好区分，
 * >   因为是玩具，唯一的功能就是对比两个热力图可以大致对比属性拐力这一模块的强弱，
 * >   或者主要属性拐力的分布来源。」
 *
 * ⇒ 定位是**玩具/概览**：不承担数据核对（那是下钻/分面表格的职责），
 *   只回答两个问题：① 哪个属性区的拐力最强；② 这份拐力主要来自谁。
 *   用颜色深浅（连续色阶）表达强弱，比柱高更省空间也更容易跨图对比。
 */
import { computed, ref } from 'vue'
import { NRadioButton, NRadioGroup } from 'naive-ui'
import type { FlatContribution } from '@/composables/agentMechanicView'

const props = defineProps<{
  rows: FlatContribution[]
  labelOf: (key: string) => string
}>()

const mode = ref<'provider' | 'content'>('provider')

/** 列 = 属性（按总拐力降序，取前 N 列避免过宽） */
const MAX_COLS = 14
const MAX_ROWS = 14

interface Cell { amount: number; mode: 'flat' | 'pct'; detail: string }

const laneOf = (r: FlatContribution): string => (mode.value === 'provider' ? r.provider : r.content)

const columns = computed(() => {
  const totals = new Map<string, number>()
  const modes = new Map<string, 'flat' | 'pct'>()
  for (const r of props.rows) {
    totals.set(r.key, (totals.get(r.key) ?? 0) + Math.abs(r.amount))
    if (!modes.has(r.key)) modes.set(r.key, r.mode)
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_COLS)
    .map(([key, total]) => ({ key, total, mode: modes.get(key) ?? 'flat', label: props.labelOf(key) }))
})

const colKeys = computed(() => new Set(columns.value.map(c => c.key)))

const rows = computed(() => {
  const byLane = new Map<string, Map<string, Cell>>()
  for (const r of props.rows) {
    if (!colKeys.value.has(r.key)) continue
    const lane = laneOf(r)
    const m = byLane.get(lane) ?? new Map<string, Cell>()
    const prev = m.get(r.key)
    if (prev) {
      m.set(r.key, { amount: prev.amount + r.amount, mode: prev.mode, detail: `${prev.detail} · ${r.detail}` })
    } else {
      m.set(r.key, { amount: r.amount, mode: r.mode, detail: r.detail })
    }
    byLane.set(lane, m)
  }
  const out = [...byLane.entries()].map(([key, cells]) => {
    const total = [...cells.values()].reduce((a, c) => a + Math.abs(c.amount), 0)
    const mode = [...cells.values()][0]?.mode ?? 'flat'
    return { key, label: key, cells, total, mode }
  })
  return out.sort((a, b) => b.total - a.total).slice(0, MAX_ROWS)
})

const maxAmount = computed(() =>
  Math.max(1e-9, ...rows.value.flatMap(r => [...r.cells.values()].map(c => Math.abs(c.amount)))),
)

const grandTotal = computed(() => rows.value.reduce((a, r) => a + r.total, 0))

function cellOf(row: { cells: Map<string, Cell> }, key: string): Cell | undefined {
  return row.cells.get(key)
}

/**
 * 色阶：强度 → 透明度/色相。
 *
 * 刻意只用**一个色相**（`--c-chart-1` 电蓝）做深浅变化，而不是彩虹色相——
 * 用户要的是「大致对比强弱」，单色阶在直觉上就是「越深越强」；
 * 多色相会让读者误以为颜色代表类别。
 */
function cellStyle(cell: Cell | undefined): Record<string, string> {
  if (!cell) return {}
  const intensity = Math.min(1, Math.abs(cell.amount) / maxAmount.value)
  // 非线性（平方根）让小值也可见：线性映射下小贡献几乎与背景同色
  const alpha = 0.12 + Math.sqrt(intensity) * 0.80
  return {
    background: `color-mix(in srgb, var(--c-chart-1) ${(alpha * 100).toFixed(1)}%, transparent)`,
    // 深色格子用浅字，浅色格子用正文色（对比度 ≥4.5）
    color: alpha > 0.55 ? 'var(--app-text-solid)' : 'var(--app-text)',
  }
}

function cellTitle(row: { label: string }, col: { key: string; label: string }): string {
  const c = rows.value.find(r => r.label === row.label)?.cells.get(col.key)
  if (!c) return `${row.label} × ${col.label}：无`
  return `${row.label} × ${col.label} = ${formatAmount(c, c.mode)}\n${c.detail}`
}

function formatAmount(cell: { amount: number } | number, mode: 'flat' | 'pct'): string {
  const v = typeof cell === 'number' ? cell : cell.amount
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  const text = Number(v.toFixed(decimals)).toLocaleString()
  return mode === 'pct' ? `${text}%` : text
}
</script>

<style scoped>
.heatmap-root { display: flex; flex-direction: column; gap: 10px; }
.heatmap-controls { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.muted { color: var(--app-text-dim); font-size: 12px; }
.legend { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--app-text-dim); }
.legend-bar {
  width: 96px;
  height: 10px;
  border-radius: 2px;
  /* 与格子同一色阶（--c-chart-1 深浅），保证图例与数据同源 */
  background: linear-gradient(to right,
    color-mix(in srgb, var(--c-chart-1) 12%, transparent),
    color-mix(in srgb, var(--c-chart-1) 92%, transparent));
  border: 1px solid var(--app-border);
}
.empty { color: var(--app-text-dim); font-size: 12px; padding: 24px; text-align: center; }

.heatmap-scroll { overflow: auto; max-height: 60vh; border: 1px solid var(--app-border); border-radius: 6px; isolation: isolate; }
.heatmap { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; font-size: 12px; }

.heatmap th, .heatmap td {
  border-bottom: 1px solid var(--app-border);
  border-right: 1px solid var(--app-border);
  padding: 4px 6px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* 左上角 + 首列 sticky（横向滚动时提供者始终可见） */
.corner, .row-head {
  position: sticky;
  left: 0;
  z-index: 3;
  background: var(--app-tablehead-bg);
  text-align: left;
  box-shadow: 1px 0 0 var(--app-border);
  white-space: nowrap;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.corner { z-index: 4; }

.col-head {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--app-tablehead-bg);
  color: var(--app-text);
  font-weight: 500;
  /* 竖排但保持单一文本流（`vertical-rl` + nowrap），避免每个字换行导致「一列一个字」 */
  writing-mode: vertical-rl;
  text-orientation: upright;
  height: 110px;
  padding: 6px 2px;
  vertical-align: bottom;
}
.col-head-text {
  display: inline-block;
  white-space: nowrap;
  letter-spacing: 1px;
}
.total-head {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--app-tablehead-bg);
  color: var(--app-text);
  font-weight: 600;
}

.cell { min-width: 56px; height: 26px; transition: filter 0.12s; }
.cell-text { white-space: nowrap; }
.cell-empty { background: transparent; }
.cell:hover { filter: brightness(1.18); }

.row-total, .col-total, .grand-total {
  font-weight: 600;
  background: var(--app-inset);
  color: var(--app-text);
  /* 小计列至少要放得下 6,429 这种四位数 —— 太窄会挤压相邻格子 */
  min-width: 72px;
  padding-left: 10px;
  padding-right: 10px;
}
.col-total-row .row-head { background: var(--app-tablehead-bg); }
</style>
