<template>
  <div class="fc-table">
    <div v-if="series.length > 1" class="fc-best-hint">
      绿底 = 该档最优（{{ def.higherBetter === false ? '本指标越小越好' : '越大越好' }}）
      <template v-if="showStepGain">· 小字 = 较上档提升%（绿字 = 该档提升最大）</template>
    </div>
    <ChartTable :columns="columns" align="right" :empty="levels.length ? '' : '暂无数据'">
      <tr v-for="(lv, i) in levels" :key="i">
        <td>{{ lv.label }}</td>
        <td
          v-for="(s, si) in series"
          :key="s.id"
          :class="{ 'fc-best': bestByLevel[i]?.has(si) }"
        >
          <div>{{ cellText(s.values[i]) }}</div>
          <div
            v-if="showStepGain && stepCells[si]?.[i]?.text"
            class="fc-step-gain"
            :class="{ 'fc-best-step': stepCells[si]?.[i]?.best }"
          >{{ stepCells[si]?.[i]?.text }}</div>
        </td>
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
import { bestStepIndexByLevel, formatSignedDeltaPercent, stepGainsOf } from '@/composables/freeCompare/views'

const props = defineProps<{
  levels: ReadonlyArray<{ label: string }>
  series: ReadonlyArray<{ id: string; label: string; values: ReadonlyArray<number | null> }>
  def: MetricDef
  /** 每档显示「较上档提升%」小字（2026-10-27 三条命座线；图上一行只标最优，全量在这里） */
  showStepGain?: boolean
}>()

const columns = computed(() => [
  { key: 'x', label: 'x' },
  ...props.series.map(s => ({ key: s.id, label: s.label })),
])
const bestByLevel = computed(() => bestSeriesIndexByLevel(props.def, props.series))
/** 逐档提升%（相邻档；第一档为空） */
const stepGains = computed(() => stepGainsOf(props.series, props.levels.length))
const bestStep = computed(() => bestStepIndexByLevel(stepGains.value, props.def.higherBetter))
/** 每个格子的「小字」：提升% + 是否本档最优（模板不做非空断言） */
const stepCells = computed(() => props.series.map((s, si) => s.values.map((_, i) => {
  const g = stepGains.value[si]?.[i]
  return {
    text: i > 0 && g != null ? formatSignedDeltaPercent(g) : '',
    best: i > 0 && g != null && bestStep.value[i] === si,
  }
})))

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
.fc-step-gain {
  margin-top: 2px;
  font-size: 10px;
  color: var(--fg-3);
  font-variant-numeric: tabular-nums;
}
.fc-best-step {
  color: var(--c-success);
  font-weight: 600;
}
</style>
