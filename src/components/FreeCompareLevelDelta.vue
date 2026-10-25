<template>
  <div class="fc-step">
    <div class="fc-step-ctl">
      <span class="ctl-label">起点档</span>
      <n-select v-model:value="fromIndex" :options="options" size="small" style="width: 130px" />
      <span class="ctl-label">→ 终点档</span>
      <n-select v-model:value="toIndex" :options="options" size="small" style="width: 130px" />
      <n-button size="tiny" quaternary :disabled="!canSwap" @click="swap">交换</n-button>
      <span class="fc-step-hint">{{ hint }}</span>
    </div>

    <ChartTable :columns="columns" align="right" :empty="rows.length ? '' : '暂无数据'">
      <tr v-for="r in rows" :key="r.seriesId">
        <td class="fc-step-name">
          <span class="fc-step-dot" :style="{ background: colorOf(r.seriesId) }"></span>{{ r.label }}
        </td>
        <td>{{ fmtValue(r.fromValue) }}</td>
        <td>{{ fmtValue(r.toValue) }}</td>
        <td :class="deltaClass(r.delta)">{{ signed(r.delta) }}</td>
        <td :class="deltaClass(r.pct)">{{ pctText(r.pct) }}</td>
      </tr>
    </ChartTable>
  </div>
</template>

<script setup lang="ts">
/**
 * 两档对比（用户 2026-10-25：「我对比了多个配置，我想知道某个配置到某个配置是进步了多少，
 * 现在这个就看不了，还得我抄写数字再做除法」）。
 *
 * 与「差值」视角不是一回事：差值 = 同一档位上 系列A vs 系列B（比队）；
 * 这里是同一系列内 x=A 档 vs x=B 档（比配置）。口径全在 `views.ts#levelDeltaRowsOf`（纯函数，有单测），
 * 本组件只管选档 + 画表。
 */
import { computed, ref, watch } from 'vue'
import { NSelect, NButton } from 'naive-ui'
import ChartTable from '@/components/charts/ChartTable.vue'
import {
  levelDeltaRowsOf,
  levelOptionsOf,
  formatDeltaPercent,
  type LevelDeltaRow,
  type LevelDeltaSource,
} from '@/composables/freeCompare/views'
import { formatMetric, type MetricDef } from '@/composables/freeCompare/metrics'
import type { FreeCompareResult } from '@/composables/freeCompare/engine'

const props = defineProps<{
  result: FreeCompareResult
  /** 当前切片的系列（与图例显隐一致）；缺省 = 第一片全部系列 */
  series: ReadonlyArray<{ id: string; label: string; values: ReadonlyArray<number | null> }>
  def: MetricDef
  colorOf: (id: string) => string
}>()

/** 起点/终点档位下标（缺省 = 第一档 → 最后一档，正好是「这条曲线整体赚了多少」） */
const fromIndex = ref(0)
const toIndex = ref(Math.max(0, props.result.levels.length - 1))

// 换了一份结果（档位数变了 / 换了轴）⇒ 档位下标可能越界，回落到首尾
watch(() => props.result, r => {
  const last = Math.max(0, r.levels.length - 1)
  if (fromIndex.value > last) fromIndex.value = 0
  if (toIndex.value > last) toIndex.value = last
  if (fromIndex.value === toIndex.value && last > 0) toIndex.value = last
})

const options = computed(() => levelOptionsOf(props.result))
const canSwap = computed(() => fromIndex.value !== toIndex.value)

/** 用当前切片的系列（带显隐过滤）覆盖 result.series，保证表格与图例一致 */
const scoped = computed<LevelDeltaSource>(() => ({ levels: props.result.levels, series: [...props.series] }))
const rows = computed<LevelDeltaRow[]>(() => levelDeltaRowsOf(scoped.value, fromIndex.value, toIndex.value))

const columns = [
  { key: 'name', label: '系列' },
  { key: 'from', label: '起点' },
  { key: 'to', label: '终点' },
  { key: 'delta', label: '差值' },
  { key: 'pct', label: '提升%' },
]

const hint = computed(() => {
  const a = options.value[fromIndex.value]?.label ?? '—'
  const b = options.value[toIndex.value]?.label ?? '—'
  if (!canSwap.value) return '选两个不同的档位（起点 ≠ 终点）才出数'
  return `${a} → ${b}：提升% = (终点 − 起点) ÷ |起点|`
})

function fmtValue(v: number | null): string {
  return v === null ? '—' : formatMetric(props.def, v)
}
function signed(v: number | null): string {
  if (v === null) return '—'
  const body = props.def.unit === '%' ? (v * 100).toFixed(props.def.digits) + '%' : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.round(v).toLocaleString()
  return (v >= 0 ? '+' : '−') + body.replace(/^-/, '')
}
function pctText(v: number | null): string {
  return v === null ? '—' : (v >= 0 ? '+' : '') + formatDeltaPercent(v)
}
/** 涨绿跌红（与汇总结论同色系；null 不着色） */
function deltaClass(v: number | null): string {
  if (v === null || Math.abs(v) < 1e-9) return ''
  return v > 0 ? 'fc-up' : 'fc-down'
}

function swap(): void {
  const a = fromIndex.value
  fromIndex.value = toIndex.value
  toIndex.value = a
}
</script>

<style scoped>
.fc-step-ctl {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 6px 0 8px;
}
.fc-step-hint {
  font-size: 12px;
  color: var(--fg-3);
}
.fc-step-name {
  text-align: left;
  white-space: nowrap;
}
.fc-step-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
}
.fc-up {
  color: var(--c-success);
}
.fc-down {
  color: var(--c-danger);
}
</style>
