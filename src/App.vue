<template>
  <n-config-provider
    :theme="naiveTheme"
    :locale="zhCN"
    :date-locale="dateZhCN"
    :theme-overrides="themeOverrides"
  >
    <n-global-style />
    <n-message-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <CalculatorView />
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  NConfigProvider,
  NGlobalStyle,
  NMessageProvider,
  NDialogProvider,
  NNotificationProvider,
  darkTheme,
  zhCN,
  dateZhCN,
  type GlobalThemeOverrides,
} from 'naive-ui'
import CalculatorView from './views/CalculatorView.vue'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()

/** common 段的 overrides 类型（naive-ui 未单独导出，从 GlobalThemeOverrides 提取） */
type CommonOverrides = NonNullable<GlobalThemeOverrides['common']>

/** 夜间=darkTheme，明亮=null（naive-ui 内置亮色默认主题） */
const naiveTheme = computed(() => (themeStore.mode === 'dark' ? darkTheme : null))

/**
 * 两模式共享的形态 overrides（品牌色梯子按模式分开放在下面，保证按钮白字对比度）。
 *
 * 取值纪律：这里的每个值都应能在 global.css 的尺度令牌里找到出处，禁止现场拍数字。
 *   borderRadius      8px = --radius-lg（容器/输入的默认圆角）
 *   borderRadiusSmall 6px = --radius-md
 *   fontSize         13px = --text-lg
 * 卡片/按钮/标签的圆角在下面的组件段里各自收紧，形成 12/8/6/4 的层次。
 */
const sharedCommon: CommonOverrides = {
  borderRadius: '8px',
  borderRadiusSmall: '6px',
  fontSize: '13px',
  cubicBezierEaseInOut: 'cubic-bezier(0.4, 0, 0.2, 1)', // = --ease-out，让 Naive 组件与自绘组件同一动效曲线
  // 必须与 global.css 的 --app-font-sans 逐字一致：n-global-style 会用这里的值覆盖 body 的
  // font-family，两处分叉就会出现「Naive 组件一套字体、自定义组件另一套」。
  // 原栈首位的 "Inter" 从未引入（零 @font-face / 零 CDN），已移除。
  // 一致性由 check-tokens 的 font-stack-parity 判据机器校验（规则 11）。
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif',
}

/**
 * 表面色：一一对应 global.css 的令牌（注释里标了出处）。
 * 由 check-tokens 的 naive-token-reuse 判据机器校验——这里出现任何「令牌表里找不到出处」
 * 的色值都会红，防止 Naive 组件与自定义组件各用一套灰（历史问题：26 个 .vue 里
 * 0 个有 html.light 覆盖，两套主题各说各话）。
 *
 * 品牌色梯子（primaryColor*）按模式分开定义，明亮必须压深保按钮白字 ≥4.5:1
 * （该约束也由 check-tokens 的 contrast 判据机器校验，见 CONTRAST_TEXT_MIN）。
 */
const darkCommon: CommonOverrides = {
  primaryColor: '#4493f8',
  primaryColorHover: '#62a7ff',
  primaryColorPressed: '#3377dd',
  primaryColorSuppl: '#62a7ff',
  bodyColor: '#0f172a', // --app-bg
  cardColor: 'rgba(255, 255, 255, 0.035)', // --app-panel
  modalColor: '#1e293b',
  popoverColor: '#1e293b',
  inputColor: 'rgba(255, 255, 255, 0.06)', // --wa-60
  inputColorDisabled: 'rgba(255, 255, 255, 0.03)', // --wa-30
  dividerColor: 'rgba(148, 163, 184, 0.16)', // --app-border
  borderColor: 'rgba(148, 163, 184, 0.16)', // --app-border（原 0.20，与通用描边对齐）
  // 表格：表头沿用 slate-800，行底/斑马纹/hover 全部走色阶，别再造新灰
  tableHeaderColor: '#1e293b', // --app-tablehead-bg
  tableColor: 'rgba(255, 255, 255, 0.035)', // --app-panel
  tableColorHover: 'rgba(255, 255, 255, 0.06)', // --fill-hover
  tableColorStriped: 'rgba(255, 255, 255, 0.015)', // --wa-15
  tagColor: 'rgba(255, 255, 255, 0.06)', // --wa-60
  textColorBase: 'rgba(255, 255, 255, 0.9)', // --app-text
  textColorDisabled: 'rgba(255, 255, 255, 0.3)', // --wa-300
  placeholderColor: 'rgba(255, 255, 255, 0.4)', // --fg-placeholder（暗底 3.75:1）
  scrollbarColor: 'rgba(148, 163, 184, 0.28)', // --scrollbar-thumb
  scrollbarColorHover: 'rgba(148, 163, 184, 0.42)', // --scrollbar-thumb-hover
  scrollbarBorderRadius: '6px', // --radius-md
}

/** 明亮专属：冷灰蓝画布 + 压深主色（白字对比度 ≥4.5:1），卡片保持纯白 */
const lightCommon: CommonOverrides = {
  primaryColor: '#2f6ee0',
  primaryColorHover: '#4a85ea',
  primaryColorPressed: '#2857b8',
  primaryColorSuppl: '#2f6ee0',
  bodyColor: '#edf1f7', // --app-bg
  cardColor: '#ffffff', // --app-panel
  modalColor: '#ffffff',
  popoverColor: '#ffffff',
  // 明亮模式输入框给一层极浅底：纯白输入框在白卡上没有边界，「哪里可以填」看不出来
  inputColor: 'rgba(15, 23, 42, 0.06)', // --app-inset
  inputColorDisabled: 'rgba(23, 26, 31, 0.03)', // --wa-30
  dividerColor: 'rgba(51, 65, 85, 0.14)', // --app-border
  borderColor: 'rgba(51, 65, 85, 0.14)', // --app-border（原 0.16，与通用描边对齐）
  tableHeaderColor: '#e3e8f0', // --app-tablehead-bg
  tableColor: '#ffffff', // --app-panel
  tableColorHover: 'rgba(23, 26, 31, 0.06)', // --fill-hover
  tableColorStriped: 'rgba(23, 26, 31, 0.015)', // --wa-15
  tagColor: 'rgba(23, 26, 31, 0.06)', // --wa-60
  textColorBase: 'rgba(23, 26, 31, 0.9)', // --app-text
  textColorDisabled: 'rgba(23, 26, 31, 0.3)', // --wa-300
  placeholderColor: 'rgba(23, 26, 31, 0.48)', // --fg-placeholder（白底 3.15:1，比暗底用更浓的墨）
  scrollbarColor: 'rgba(51, 65, 85, 0.22)', // --scrollbar-thumb
  scrollbarColorHover: 'rgba(51, 65, 85, 0.34)', // --scrollbar-thumb-hover
  scrollbarBorderRadius: '6px', // --radius-md
}

/**
 * 圆角层次（来自 --radius-*）：卡片 12 > 容器/输入 8 > 按钮 6 > 标签 4。
 * common.borderRadius 已经给了 8 的默认值，这里只覆盖需要偏离的组件。
 */
const RADIUS = {
  card: '12px', // --radius-xl
  control: '8px', // --radius-lg（Input / Select / Tooltip）
  button: '6px', // --radius-md
  tag: '4px', // --radius-sm
  tab: '6px', // --radius-md
}

/**
 * 组件级 overrides：只覆盖两样东西
 *   ① 形态（圆角/内边距，与 --radius-* 同口径）
 *   ② 表面色（tooltip / divider 等 common 里没有的）
 * **不覆盖交互态色**（hover/pressed/suppl）——那些由 common.primaryColor 梯子派生，
 * 逐个写只会制造新的不一致，也躲过了对比度校验。
 *
 * 每显式写一个新的「前景/背景对」，都要在 check-tokens.mjs 的 CONTRAST_EXTRA_PAIRS
 * 里同步加一行断言（纪律：覆盖数可以增长，但断言数必须跟着长）。
 */
const darkOverrides: GlobalThemeOverrides = {
  common: { ...sharedCommon, ...darkCommon },
  Card: {
    borderRadius: RADIUS.card,
    borderColor: 'rgba(148, 163, 184, 0.16)', // --app-border
    titleTextColor: '#ffffff', // --app-text-solid（标题与正文拉开层级）
    paddingMedium: '14px 18px',
  },
  Tabs: {
    barColor: '#4493f8', // --app-primary
    tabTextColorLine: 'rgba(255, 255, 255, 0.55)', // --wa-550
    tabTextColorActiveLine: '#ffffff', // --app-text-solid
    tabTextColorHoverLine: 'rgba(255, 255, 255, 0.85)', // --wa-850
    tabBorderRadius: RADIUS.tab,
  },
  // Tooltip 必须与自绘 SVG tooltip（.hover-card / .bar-tip / .chart-tooltip-box）
  // 用同一套 --app-tooltip-bg/text，否则 Naive 提示与图表提示是两张皮
  Tooltip: {
    color: 'rgba(30, 41, 59, 0.96)', // --app-tooltip-bg
    textColor: 'rgba(255, 255, 255, 0.92)', // --app-tooltip-text
    borderRadius: RADIUS.control,
    fontSize: '12px', // --text-md
    padding: '8px 10px',
    boxShadow: '0 8px 24px rgba(2, 6, 23, 0.55)', // --shadow-3
  },
  Divider: {
    color: 'rgba(148, 163, 184, 0.16)', // --app-border
    textColor: 'rgba(255, 255, 255, 0.55)', // --wa-550
  },
  Input: { borderRadius: RADIUS.control },
  Select: { borderRadius: RADIUS.control },
  Button: { borderRadius: RADIUS.button },
  Tag: { borderRadius: RADIUS.tag },
}

const lightOverrides: GlobalThemeOverrides = {
  common: { ...sharedCommon, ...lightCommon },
  Card: {
    borderRadius: RADIUS.card,
    borderColor: 'rgba(51, 65, 85, 0.14)', // --app-border
    titleTextColor: '#1f2329', // --app-text-solid
    paddingMedium: '14px 18px',
  },
  Tabs: {
    barColor: '#2f6ee0', // --app-primary
    // 明亮模式原本没设这三个文字色，会落在 Naive 内置值上——与 --app-text 不是一套
    tabTextColorLine: 'rgba(23, 26, 31, 0.55)', // --wa-550
    tabTextColorActiveLine: '#1f2329', // --app-text-solid
    tabTextColorHoverLine: 'rgba(23, 26, 31, 0.85)', // --wa-850
    tabBorderRadius: RADIUS.tab,
  },
  Tooltip: {
    color: 'rgba(255, 255, 255, 0.97)', // --app-tooltip-bg
    textColor: 'rgba(23, 26, 31, 0.92)', // --app-tooltip-text
    borderRadius: RADIUS.control,
    fontSize: '12px',
    padding: '8px 10px',
    // 明亮模式 tooltip 底是近白，没有投影就完全贴在页面上看不出边界
    boxShadow: '0 8px 24px rgba(16, 24, 40, 0.12)', // --shadow-3
  },
  Divider: {
    color: 'rgba(51, 65, 85, 0.14)', // --app-border
    textColor: 'rgba(23, 26, 31, 0.55)', // --wa-550
  },
  Input: { borderRadius: RADIUS.control },
  Select: { borderRadius: RADIUS.control },
  Button: { borderRadius: RADIUS.button },
  Tag: { borderRadius: RADIUS.tag },
}

const themeOverrides = computed<GlobalThemeOverrides>(() =>
  themeStore.mode === 'dark' ? darkOverrides : lightOverrides,
)
</script>
