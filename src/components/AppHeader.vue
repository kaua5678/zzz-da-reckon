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
        </n-tabs>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NTabs, NTabPane } from 'naive-ui'
import { useConfigStore } from '@/stores/config'

const configStore = useConfigStore()

const calculatorTabs = ['team', 'attribute', 'resource', 'result', 'resourceUtilization', 'stunAxis', 'teamCompare', 'breakerCompare']
const developerTabs = ['debug', 'wengineFields', 'logic', 'mechanic']
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
  background: rgba(10, 10, 14, 0.72);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
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
  background: linear-gradient(135deg, #4c8bf5, #7c5cf5);
  color: #fff;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 2px;
  line-height: 1;
  box-shadow: 0 2px 10px rgba(76, 139, 245, 0.35);
}

.brand-title {
  font-size: 17px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 1px;
  white-space: nowrap;
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
  color: rgba(255, 255, 255, 0.42);
  font-size: 12px;
  white-space: nowrap;
}

.tab-divider {
  flex: 0 0 auto;
  width: 1px;
  height: 24px;
  background: rgba(255, 255, 255, 0.12);
}

.header-tabs {
  --n-tab-text-color: rgba(255, 255, 255, 0.6);
  --n-tab-text-color-active: #fff;
  --n-tab-text-color-hover: rgba(255, 255, 255, 0.85);
  --n-tab-bar-color: #3b82f6;
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
