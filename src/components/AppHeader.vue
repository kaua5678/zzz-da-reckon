<template>
  <div class="app-header">
    <div class="header-left">
      <div class="brand">
        <span class="brand-badge">ZZZ</span>
        <span class="brand-title">伤害计算器</span>
      </div>
    </div>
    <div class="header-center">
      <div class="tab-section">
        <div class="tab-section-label">计算器</div>
        <n-tabs
          :value="calculatorTabValue"
          type="line"
          size="large"
          class="header-tabs"
          @update:value="onTabChange"
        >
          <n-tab-pane name="team" tab="队伍配置" />
          <n-tab-pane name="attribute" tab="属性配置" />
          <n-tab-pane name="resource" tab="倍率表" />
          <n-tab-pane name="result" tab="资源池" />
          <n-tab-pane name="resourceUtilization" tab="资源利用率" />
          <n-tab-pane name="stunAxis" tab="失衡轴" />
          <n-tab-pane name="teamCompare" tab="队伍对比" />
          <n-tab-pane name="breakerCompare" tab="击破手对比" />
          <n-tab-pane name="timeline" tab="时间图表" />
        </n-tabs>
      </div>
      <div class="tab-divider"></div>
      <div class="tab-section dev-section">
        <div class="tab-section-label">开发</div>
        <n-tabs
          :value="developerTabValue"
          type="line"
          size="large"
          class="header-tabs dev-tabs"
          @update:value="onTabChange"
        >
          <n-tab-pane name="debug" tab="公式/字段" />
          <n-tab-pane name="wengineFields" tab="音擎字段" />
          <n-tab-pane name="logic" tab="逻辑编辑" />
          <n-tab-pane name="mechanic" tab="机制表" />
          <n-tab-pane name="multiplierCoeff" tab="倍率系数记录" />
        </n-tabs>
      </div>
    </div>
    <div class="header-right">
      <n-tooltip trigger="hover">
        <template #trigger>
          <n-button quaternary circle size="small" class="theme-toggle" @click="themeStore.toggle()">
            <template #icon>
              <n-icon>
                <SunnyOutline v-if="themeStore.mode === 'dark'" />
                <MoonOutline v-else />
              </n-icon>
            </template>
          </n-button>
        </template>
        {{ themeStore.mode === 'dark' ? '切换到明亮模式' : '切换到夜间模式' }}
      </n-tooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NIcon, NTabs, NTabPane, NTooltip } from 'naive-ui'
import { MoonOutline, SunnyOutline } from '@vicons/ionicons5'
import { useConfigStore } from '@/stores/config'
import { useThemeStore } from '@/stores/theme'

const configStore = useConfigStore()
const themeStore = useThemeStore()

const calculatorTabs = ['team', 'attribute', 'resource', 'result', 'resourceUtilization', 'stunAxis', 'teamCompare', 'breakerCompare', 'timeline']
const developerTabs = ['debug', 'wengineFields', 'logic', 'mechanic', 'multiplierCoeff']
const calculatorTabValue = computed(() => calculatorTabs.includes(configStore.activeTab) ? configStore.activeTab : '')
const developerTabValue = computed(() => developerTabs.includes(configStore.activeTab) ? configStore.activeTab : '')

function onTabChange(tab: string) {
  configStore.activeTab = tab
}
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 24px;
  height: 60px;
  background: var(--app-header-bg);
  border-bottom: 1px solid var(--wa-80);
  position: sticky;
  top: 0;
  z-index: 100;
  backdrop-filter: blur(10px);
}

.header-left {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 7px;
  border-radius: 7px;
  /* ZZZ S级金（#FFB500，游戏 S 抽卡金）：品牌锚点，亮暗两模式同值 */
  background: linear-gradient(135deg, var(--app-accent-gold), var(--app-accent-gold-soft));
  color: #241a03;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 2px;
  line-height: 1;
  box-shadow: 0 2px 10px rgba(255, 181, 0, 0.35);
}

.brand-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--app-text-solid);
  letter-spacing: 1px;
  white-space: nowrap;
}

.header-right {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
}

.theme-toggle {
  color: var(--wa-600);
}

.header-center {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  overflow-x: auto;
  scrollbar-width: none;
}

.header-center::-webkit-scrollbar {
  display: none;
}

.tab-section {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.tab-section-label {
  color: var(--wa-420);
  font-size: 12px;
  white-space: nowrap;
}

.tab-divider {
  flex: 0 0 auto;
  width: 1px;
  height: 24px;
  background: var(--wa-120);
}

.header-tabs {
  --n-tab-text-color: var(--wa-600);
  --n-tab-text-color-active: var(--app-text-solid);
  --n-tab-text-color-hover: var(--wa-850);
  --n-tab-bar-color: var(--app-primary);
  --n-tab-font-size: 14px;
  white-space: nowrap;
}

.dev-tabs {
  --n-tab-bar-color: #a855f7;
}

@media (max-width: 900px) {
  .app-header {
    padding: 0 12px;
    gap: 10px;
  }

  .brand-title {
    display: none;
  }

  .tab-section-label {
    display: none;
  }

  .tab-divider {
    display: none;
  }
}
</style>
