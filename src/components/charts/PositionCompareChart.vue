<template>
  <div class="pcc-root">
    <div class="pcc-head">
      <div class="pcc-hint">
        {{ positionLabel }} · {{ mode === 'absolute' ? '条长 = 全队总伤' : '每队归一 = 100%' }} · 条内 = 贡献构成
      </div>
      <div class="pcc-mode" role="group" aria-label="堆叠口径">
        <button
          class="pcc-mode-btn"
          :class="{ active: mode === 'absolute' }"
          :aria-pressed="mode === 'absolute'"
          title="按总伤绝对长度比较：能同时看出谁总伤高、构成差在哪"
          @click="mode = 'absolute'"
        >按总伤</button>
        <button
          class="pcc-mode-btn"
          :class="{ active: mode === 'share' }"
          :aria-pressed="mode === 'share'"
          title="每队归一 100%：只看构成比例，不受总伤高低影响"
          @click="mode = 'share'"
        >按占比</button>
      </div>
    </div>

    <div class="pcc-legend">
      <span v-for="item in legend" :key="item.key" class="pcc-legend-item">
        <i class="pcc-dot" :class="item.cls"></i>{{ item.label }}
      </span>
    </div>

    <div class="pcc-rows">
      <div v-for="r in rows" :key="r.presetId" class="pcc-row">
        <div class="pcc-name" :title="r.presetName + ' · ' + r.agentName">
          <b>{{ r.presetName }}</b>
          <span>{{ r.agentName }}</span>
        </div>

        <div class="pcc-bars">
          <div
            class="pcc-stack"
            role="img"
            :aria-label="r.presetName + ' 贡献构成'"
          >
            <span
              v-for="seg in visibleSegments(r)"
              :key="seg.key"
              class="pcc-seg"
              :class="seg.cls"
              :style="{ width: widthOf(seg, r) + '%' }"
              :title="seg.label + ' ' + fmt(seg.value, 0) + '（' + shareText(seg.value, r.totalDamage) + '）'"
            />
          </div>

          <div class="pcc-mini-row">
            <span class="pcc-mini-label">失衡</span>
            <span class="pcc-mini-track" :title="'该号位失衡占比 ' + r.dazeShare.toFixed(1) + '%'">
              <i class="pcc-mini-fill pcc-daze" :style="{ width: clampPct(r.dazeShare) + '%' }" />
            </span>
            <span class="pcc-mini-val">{{ r.dazeShare.toFixed(1) }}%</span>
            <span class="pcc-mini-label">积蓄</span>
            <span class="pcc-mini-track" :title="'该号位积蓄占比 ' + r.buildUpShare.toFixed(1) + '%'">
              <i class="pcc-mini-fill pcc-build" :style="{ width: clampPct(r.buildUpShare) + '%' }" />
            </span>
            <span class="pcc-mini-val">{{ r.buildUpShare.toFixed(1) }}%</span>
          </div>
        </div>

        <div class="pcc-total">
          <b>{{ fmt(r.totalDamage, 0) }}</b>
          <span>总伤</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 位置对比 · 贡献构成条（纯展示）。
 *
 * 为什么不是柱状图：本页要同时回答「谁总伤高」和「贡献差在哪」——绝对长度的堆叠条
 * 把两者压进同一行；切「按占比」则去掉总伤影响，只看构成。
 * 颜色只走主题令牌；组件不读 store、不算数值（数值口径留在 positionCompare.ts）。
 */
import { computed, ref } from 'vue'
import { fmt } from '@/utils/format'
import type { PositionCompareRow } from '@/composables/positionCompare'

const props = defineProps<{
  rows: ReadonlyArray<PositionCompareRow>
  isMain: boolean
  positionLabel: string
}>()

type StackMode = 'absolute' | 'share'
const mode = ref<StackMode>('absolute')

interface Segment {
  key: string
  label: string
  cls: string
}

/** 主C：自身四块 + 队友/其他；非主C：自身/赠送/拐力/其他（四项按定义加总 = 总伤） */
const legend = computed<Segment[]>(() => props.isMain
  ? [
      { key: 'direct', label: '直伤', cls: 'pcc-seg-direct' },
      { key: 'release', label: '异放', cls: 'pcc-seg-release' },
      { key: 'disorder', label: '紊乱', cls: 'pcc-seg-disorder' },
      { key: 'anomaly', label: '其他异常', cls: 'pcc-seg-anomaly' },
      { key: 'team', label: '队友/其他', cls: 'pcc-seg-other' },
    ]
  : [
      { key: 'self', label: '自身直伤', cls: 'pcc-seg-direct' },
      { key: 'gift', label: '送连携/赠送', cls: 'pcc-seg-release' },
      { key: 'buff', label: '拐力提升', cls: 'pcc-seg-disorder' },
      { key: 'other', label: '其他', cls: 'pcc-seg-other' },
    ])

function segmentsOf(r: PositionCompareRow): Array<Segment & { value: number }> {
  if (props.isMain) {
    return [
      { ...legend.value[0], value: r.directDamage },
      { ...legend.value[1], value: r.releaseDamage },
      { ...legend.value[2], value: r.disorderDamage },
      { ...legend.value[3], value: r.anomalyOtherDamage },
      { ...legend.value[4], value: Math.max(0, r.totalDamage - r.selfDamage) },
    ]
  }
  return [
    { ...legend.value[0], value: r.selfDamage },
    { ...legend.value[1], value: r.giftDamage },
    { ...legend.value[2], value: r.buffContribution },
    { ...legend.value[3], value: r.otherDamage },
  ]
}

function visibleSegments(r: PositionCompareRow): Array<Segment & { value: number }> {
  return segmentsOf(r).filter(s => s.value > 0)
}

const maxTotal = computed(() => Math.max(1, ...props.rows.map(r => r.totalDamage)))

function widthOf(seg: Segment & { value: number }, r: PositionCompareRow): number {
  const base = mode.value === 'absolute' ? maxTotal.value : r.totalDamage
  if (base <= 0) return 0
  return Math.min(100, Math.max(0, (seg.value / base) * 100))
}

function shareText(value: number, total: number): string {
  if (total <= 0) return '0.0%'
  return ((value / total) * 100).toFixed(1) + '%'
}

function clampPct(v: number): number {
  return Math.min(100, Math.max(0, v))
}
</script>

<style scoped>
.pcc-root {
  border-bottom: 1px solid var(--app-border);
  padding-bottom: 10px;
  margin-bottom: 12px;
}
.pcc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.pcc-hint {
  font-size: 12px;
  color: var(--fg-3);
}
.pcc-mode {
  display: flex;
  gap: 4px;
}
.pcc-mode-btn {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--app-border);
  background: transparent;
  color: var(--fg-2);
  cursor: pointer;
}
.pcc-mode-btn.active {
  border-color: var(--app-primary);
  color: var(--app-primary);
}
.pcc-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 8px 0 4px;
  font-size: 12px;
  color: var(--fg-2);
}
.pcc-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.pcc-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  display: inline-block;
}
.pcc-row {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr) 90px;
  gap: 12px;
  align-items: center;
  padding: 7px 0;
  border-bottom: 1px solid var(--line);
}
.pcc-row:last-child {
  border-bottom: none;
}
.pcc-name {
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.pcc-name b {
  font-size: 12px;
  font-weight: 600;
  color: var(--app-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pcc-name span {
  font-size: 11px;
  color: var(--fg-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pcc-stack {
  height: 20px;
  display: flex;
  overflow: hidden;
  border-radius: 3px;
  background: var(--fill-hover);
}
.pcc-seg {
  height: 100%;
  min-width: 0;
  transition: width 0.18s ease;
}
.pcc-seg-direct { background: var(--c-info); }
.pcc-seg-release { background: var(--c-success); }
.pcc-seg-disorder { background: var(--c-warning); }
.pcc-seg-anomaly { background: var(--c-danger); }
.pcc-seg-other { background: var(--fg-3); }
.pcc-mini-row {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--fg-3);
}
.pcc-mini-label {
  flex: 0 0 auto;
}
.pcc-mini-track {
  flex: 1 1 60px;
  height: 5px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--fill-hover);
}
.pcc-mini-fill {
  display: block;
  height: 100%;
}
.pcc-daze { background: var(--c-warning); }
.pcc-build { background: var(--c-info); }
.pcc-mini-val {
  flex: 0 0 38px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.pcc-total {
  text-align: right;
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.pcc-total b {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.pcc-total span {
  font-size: 11px;
  color: var(--fg-3);
}
@media (max-width: 760px) {
  .pcc-row {
    grid-template-columns: 150px minmax(0, 1fr) 70px;
    gap: 8px;
  }
}
</style>
