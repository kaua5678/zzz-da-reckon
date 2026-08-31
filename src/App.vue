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

/** 两模式共享的形态 overrides（品牌色梯子按模式分开放在下面，保证按钮白字对比度） */
const sharedCommon: CommonOverrides = {
  borderRadius: '10px',
  borderRadiusSmall: '8px',
  fontSize: '13px',
  // 必须与 global.css 的 --app-font-sans 逐字一致：n-global-style 会用这里的值覆盖 body 的
  // font-family，两处分叉就会出现「Naive 组件一套字体、自定义组件另一套」。
  // 原栈首位的 "Inter" 从未引入（零 @font-face / 零 CDN），已移除。
  // 一致性由 check-tokens 的 font-stack-parity 判据机器校验（规则 11）。
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif',
}

/** 夜间专属：slate-900 海军蓝底 + 亮电蓝主色（与 global.css 的 app/wa 系列变量同口径） */
const darkCommon: CommonOverrides = {
  primaryColor: '#4493f8',
  primaryColorHover: '#62a7ff',
  primaryColorPressed: '#3377dd',
  primaryColorSuppl: '#62a7ff',
  bodyColor: '#0f172a',
  cardColor: 'rgba(255, 255, 255, 0.04)',
  modalColor: '#1e293b',
  popoverColor: '#1e293b',
  inputColor: 'rgba(255, 255, 255, 0.06)',
  dividerColor: 'rgba(148, 163, 184, 0.16)',
  borderColor: 'rgba(148, 163, 184, 0.20)',
}

/** 明亮专属：冷灰蓝画布 + 压深主色（白字对比度 ≥4.5:1），卡片保持纯白 */
const lightCommon: CommonOverrides = {
  primaryColor: '#2f6ee0',
  primaryColorHover: '#4a85ea',
  primaryColorPressed: '#2857b8',
  primaryColorSuppl: '#2f6ee0',
  bodyColor: '#edf1f7',
  cardColor: '#ffffff',
  modalColor: '#ffffff',
  popoverColor: '#ffffff',
  dividerColor: 'rgba(51, 65, 85, 0.14)',
  borderColor: 'rgba(51, 65, 85, 0.16)',
}

const darkOverrides: GlobalThemeOverrides = {
  common: { ...sharedCommon, ...darkCommon },
  Card: {
    borderRadius: '12px',
    borderColor: 'rgba(148, 163, 184, 0.14)',
    color: 'rgba(255, 255, 255, 0.03)',
    titleTextColor: 'rgba(255, 255, 255, 0.9)',
    paddingMedium: '14px 18px',
  },
  Tabs: {
    tabTextColorLine: 'rgba(255, 255, 255, 0.55)',
    tabTextColorActiveLine: '#ffffff',
    tabTextColorHoverLine: 'rgba(255, 255, 255, 0.85)',
    barColor: '#4493f8',
  },
}

const lightOverrides: GlobalThemeOverrides = {
  common: { ...sharedCommon, ...lightCommon },
  Card: {
    borderRadius: '12px',
    borderColor: 'rgba(51, 65, 85, 0.10)',
    paddingMedium: '14px 18px',
  },
  Tabs: {
    barColor: '#2f6ee0',
  },
}

const themeOverrides = computed<GlobalThemeOverrides>(() =>
  themeStore.mode === 'dark' ? darkOverrides : lightOverrides,
)
</script>
