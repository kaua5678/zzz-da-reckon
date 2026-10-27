<template>
  <div class="step-matrix-block">
    <div class="step-matrix-title">
      {{ title }}
      <span v-if="hint">{{ hint }}</span>
    </div>
    <table class="step-matrix">
      <thead>
        <tr>
          <th class="th-row">{{ rowHeader }}</th>
          <th v-for="(col, i) in columns" :key="i">{{ col }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <th class="th-row" :style="{ color: row.color }">{{ row.label }}</th>
          <td
            v-for="(cell, i) in row.cells"
            :key="i"
            :class="{ best: cell.best, empty: cell.empty }"
          >{{ cell.text }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
/**
 * 逐档提升矩阵（2026-10-27，从自由对比页抽出）
 *
 * 纯展示：列（档位名）、行（系列短标签 + 颜色）、每格（文本 / 是否该档最优 / 是否缺读数）
 * 由调用方算好——数据口径复用 `freeCompare/views.ts#stepGainsOf` + `bestStepIndexByLevel`，
 * 本组件只管**美术**（边框/字号/数字对齐/最优绿字），别的图表要「图下数据块」直接复用。
 */
withDefaults(defineProps<{
  columns: ReadonlyArray<string>
  rows: ReadonlyArray<{
    id: string
    label: string
    color: string
    cells: ReadonlyArray<{ text: string; best: boolean; empty: boolean }>
  }>
  title?: string
  rowHeader?: string
  hint?: string
}>(), {
  title: '逐档提升（相对上一档）',
  rowHeader: '系列',
  hint: '',
})
</script>

<style scoped>
.step-matrix-block {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--app-border);
}
.step-matrix-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--fg-2);
}
.step-matrix-title span {
  font-size: 11px;
  color: var(--fg-3);
}
.step-matrix {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.step-matrix th,
.step-matrix td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--app-border);
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.step-matrix .th-row {
  text-align: left;
  white-space: nowrap;
  font-weight: 600;
  color: var(--fg-2);
}
.step-matrix td.empty {
  color: var(--fg-3);
}
.step-matrix td.best {
  color: var(--c-success);
  font-weight: 600;
}
</style>
