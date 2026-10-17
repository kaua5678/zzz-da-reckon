<template>
  <div class="cl-legend">
    <span v-if="hint" class="cl-hint">{{ hint }}</span>
    <span
      v-for="item in items"
      :key="item.id"
      class="cl-item"
      :class="{ off: !isVisible(item.id) }"
      role="button"
      tabindex="0"
      :aria-pressed="isVisible(item.id)"
      :title="item.title"
      @click="emit('toggle', item.id)"
      @keydown.enter="emit('toggle', item.id)"
    >
      <span class="cl-dot" :style="{ background: colorFor(item) }"></span>{{ item.label }}
    </span>
    <span v-if="showAll" class="cl-action" role="button" tabindex="0" @click="emit('showAll')" @keydown.enter="emit('showAll')">全显示</span>
    <slot />
  </div>
</template>

<script setup lang="ts">
/**
 * 共享图例（图表系列筛选的唯一外观）。
 *
 * 为什么抽出来：全仓至少 8 个图表各自写了一遍「点系列名显隐」的 markup 与样式，
 * 有的带计数/全显示、有的没有；筛选**状态**早已统一在 `useSeriesFilter`，只有外观重复。
 * 本组件只负责「画图例 + 抛事件」，不持有筛选状态——隐藏必须同时退出派生量，那个状态必须留在页面。
 */
const props = defineProps<{
  items: ReadonlyArray<{
    id: string
    label: string
    /** 悬浮说明（通常是「点击隐藏/显示」+ 隐藏后的影响） */
    title?: string
    /** 覆盖 colorOf(id) 的系列色（页面有现成配色表时用，避免再解析一次） */
    color?: string
  }>
  /** 系列取色；item.color 优先（本页有现成配色表时不必再解析） */
  colorOf?: (id: string) => string
  isVisible: (id: string) => boolean
  /** 一行提示（通常写「点系列名显隐 + 纵轴口径」） */
  hint?: string
  /** 是否显示「全显示」动作（页面有 `showAll` 时传） */
  showAll?: boolean
}>()

const emit = defineEmits<{
  toggle: [id: string]
  showAll: []
}>()

function colorFor(item: { id: string; color?: string }): string {
  return item.color ?? (props.colorOf ? props.colorOf(item.id) : 'var(--fg-3)')
}
</script>

<style scoped>
.cl-legend {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.cl-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--app-text);
  cursor: pointer;
}
.cl-item.off {
  opacity: 0.35;
}
.cl-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
.cl-hint {
  font-size: 12px;
  color: var(--fg-3);
}
.cl-action {
  font-size: 12px;
  color: var(--link-color);
  cursor: pointer;
}
</style>
