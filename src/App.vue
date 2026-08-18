<template>
  <n-config-provider
    :theme="darkTheme"
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

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#4c8bf5',
    primaryColorHover: '#6ba1f7',
    primaryColorPressed: '#3a76d8',
    primaryColorSuppl: '#4c8bf5',
    bodyColor: '#0f0f12',
    cardColor: 'rgba(255, 255, 255, 0.04)',
    modalColor: '#191920',
    popoverColor: '#191920',
    inputColor: 'rgba(255, 255, 255, 0.06)',
    dividerColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.10)',
    borderRadius: '10px',
    borderRadiusSmall: '8px',
    fontSize: '13px',
    fontFamily:
      '"Inter", "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  Card: {
    borderRadius: '12px',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    color: 'rgba(255, 255, 255, 0.03)',
    titleTextColor: 'rgba(255, 255, 255, 0.88)',
    paddingMedium: '14px 18px',
  },
  Tabs: {
    tabTextColorLine: 'rgba(255, 255, 255, 0.55)',
    tabTextColorActiveLine: '#ffffff',
    tabTextColorHoverLine: 'rgba(255, 255, 255, 0.85)',
    barColor: '#4c8bf5',
  },
}
</script>
