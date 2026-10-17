<template>
  <div class="chart-table-wrap" :style="maxHeight ? { maxHeight, overflowY: 'auto' } : undefined">
    <table
      class="chart-table"
      :class="[tableClass, { 'chart-table-num-right': align === 'right', 'chart-table-dense': dense }]"
    >
      <thead>
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            scope="col"
            :style="col.width ? { width: col.width } : undefined"
          >{{ col.label }}</th>
        </tr>
      </thead>
      <tbody><slot /></tbody>
    </table>
    <div v-if="empty" class="chart-table-empty">{{ empty }}</div>
  </div>
</template>

<script setup lang="ts">
/**
 * 共享表格基座（外观 + thead；单元格由调用方 slot 提供）。
 *
 * 为什么 slot 而不是 columns/rows 数据 API：现有明细表有大量富单元格（角色色点、击杀时间、
 * 逐槽影画、悬浮行、行级 class），压成字符串会丢信息；这里只统一最容易漂移的
 * 「外层滚动、表头、边框、粘头、首列左对齐」。
 * 基座样式在全局 chart-table.css（slot 内容属于父组件 scope，子组件 scoped 样式够不到）。
 */
interface ChartTableColumn {
  key: string
  label: string
  /** 列宽（如 '120px'）；缺省按内容 */
  width?: string
}

defineProps<{
  columns: ReadonlyArray<ChartTableColumn>
  /** 额外表类（保留页面既有的行级 scoped 样式：如 tl-table） */
  tableClass?: string
  /** 数值列右对齐（首列仍左对齐）；默认全左 */
  align?: 'left' | 'right'
  /** 无行时的占位文案（空串/缺省 = 不显示） */
  empty?: string
  /** 纵向滚动上限（如 '440px'）；长表必须传，否则 1000+ 行会把整页撑到几万像素 */
  maxHeight?: string
  /** 紧凑行距（4px 8px；队伍对比的 6 张明细表用，保持原密度） */
  dense?: boolean
}>()
</script>
