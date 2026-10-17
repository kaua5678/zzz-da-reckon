<template>
  <div class="fc-table">
    <div v-if="series.length > 1" class="fc-best-hint">
      绿底 = 该档最优（{{ def.higherBetter === false ? '本指标越小越好' : '越大越好' }}）
    </div>
    <ChartTable :columns="columns" align="right" :empty="levels.length ? '' : '暂无数据'">
      <tr v-for="(lv, i) in levels" :key="i">
        <td>{{ lv.label }}</td>
        <td
          v-for="(s, si) in series"
          :key="s.id"
          :class="{ 'fc-best': bestByLevel[i]?.has(si) }"
        >{{ cellText(s.values[i]) }}</td>
      </tr>
    </ChartTable>
  </div>
</template>

<script setup lang="ts">
/**
 * 自由对比 · 汇总表（单图与各切片共用）：每档最优系列绿底标出。
 *
 * 为什么抽成组件：加了切片后同一张表要在「无切片」与「每片一张」两种形态出现；
 * 表结构/胜负口径（bestSeriesIndexByLevel 的 higherBetter 方向）必须只有一份实现。
 */
import { computed } from 'vue'
import ChartTable from '@/components/charts/ChartTable.vue'
import { bestSeriesIndexByLevel, formatMetric, type MetricDef } from '@/composables/freeCompare/metrics'

const props = defineProps<{
  levels: ReadonlyArray<{ label: string }>
  series: ReadonlyArray<{ id: string; label: string; values: ReadonlyArray<number | null> }>
  def: MetricDef
}>()

const columns = computed(() => [
  { key: 'x', label: 'x' },
  ...props.series.map(s => ({ key: s.id, label: s.label })),
])
const bestByLevel = computed(() => bestSeriesIndexByLevel(props.def, props.series))

function cellText(v: number | null): string {
  return v === null ? '—' : formatMetric(props.def, v)
}
</script>

<style scoped>
.fc-best-hint {
  font-size: 12px;
  color: var(--fg-3);
  margin: 4px 0;
}
.fc-best {
  color: var(--c-success);
  background: var(--c-success-soft);
  font-weight: 600;
}
</style>
