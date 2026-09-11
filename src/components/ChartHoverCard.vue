<!--
  图内悬浮卡外壳（2026-09-12 评审 #14 第十刀）。

  为什么抽成组件：时间图表页有 4 张图各写了一份同构的悬浮卡
  （`hover-card` 外壳 + `.hc-title` + 若干 `.hc-row`），连样式规则都重复。
  抽成一个外壳后：卡片样式只有一处（改观感不必改四处），行内容仍由各图以 `rows` 传入。

  ⚠ **样式必须留在本组件内**：父页面的 `<style scoped>` 不会作用到子组件元素
  （scoped 只给本模板元素加 data 属性），故这 7 条规则整体从 TimeChartsPage 搬来。
  搬迁时用「改动前后计算样式比对」验证（getComputedStyle 的 position/background/
  fontSize/zIndex/padding/box-shadow/color 逐项一致），因为纯 CSS 改动在本仓库没有自动化 verifier。
-->
<template>
  <div class="hover-card" :style="{ left: x + 'px', top: y + 'px' }">
    <div class="hc-title">{{ title }}</div>
    <div v-for="(row, i) in rows" :key="i" class="hc-row" :class="row.cls">{{ row.text }}</div>
  </div>
</template>

<script setup lang="ts">
/** 一行文本；cls 用于 `hc-swap` / `hc-bench` / `sc-diff-a` 等强调样式 */
export interface HoverCardRow {
  text: string
  cls?: string
}

defineProps<{
  /** 卡片左上角（相对图表容器，px）——由各图的卡片定位逻辑算出，本组件不做钳制 */
  x: number
  y: number
  title: string
  rows: HoverCardRow[]
}>()
</script>

<style scoped>
.hover-card {
  position: absolute;
  z-index: 10;
  background: var(--app-tooltip-bg);
  border: 1px solid var(--wa-140);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 11.5px;
  pointer-events: none;
  max-width: 260px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.hc-title {
  font-weight: 700;
  margin-bottom: 3px;
  /* 原 #fff：明亮模式 .hover-card 底是 rgba(255,255,255,0.97)，白字不可见 */
  color: var(--app-text-solid);
}

.hc-row {
  color: var(--wa-780);
  line-height: 1.5;
}

.hc-swap {
  color: #f6ad55;
  font-weight: 600;
}

.hc-bench {
  color: var(--wa-550);
}

.sc-diff-a {
  color: var(--c-info);
  font-weight: 700;
}

.sc-diff-b {
  color: var(--c-warning);
  font-weight: 700;
}
</style>
