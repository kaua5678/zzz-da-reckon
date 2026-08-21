<template>
  <div class="calc-root">
    <!-- 顶部导航 -->
    <AppHeader />

    <!-- 内容区域 -->
    <div class="calc-content">
      <n-spin :show="catalogStore.loading">
        <template v-if="catalogStore.error">
          <n-alert type="error" title="数据加载失败" style="margin: 20px">
            {{ catalogStore.error }}（请确认 /static/catalog.json 可访问）
          </n-alert>
        </template>

        <template v-else-if="catalogStore.ready">
          <component :is="currentPage" />
        </template>

        <template v-else>
          <div class="loading-placeholder">
            <n-spin size="small" />
            <span>正在加载目录数据…</span>
          </div>
        </template>
      </n-spin>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { NSpin, NAlert } from 'naive-ui'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import AppHeader from '@/components/AppHeader.vue'
import TeamConfigPage from '@/views/TeamConfigPage.vue'
import AttributeConfigPage from '@/views/AttributeConfigPage.vue'
import ResourcePage from '@/views/ResourcePage.vue'
import ResultPage from '@/views/ResultPage.vue'
import DebugPage from '@/views/DebugPage.vue'
import WEngineFieldPage from '@/views/WEngineFieldPage.vue'
import ResourceUtilizationPage from '@/views/ResourceUtilizationPage.vue'
import StunAxisPage from '@/views/StunAxisPage.vue'
import LogicEditorPage from '@/views/LogicEditorPage.vue'
import MechanicsTablePage from '@/views/MechanicsTablePage.vue'
import TeamComparePage from '@/views/TeamComparePage.vue'
import StunBreakerComparePage from '@/views/StunBreakerComparePage.vue'
import TimeChartsPage from '@/views/TimeChartsPage.vue'

const catalogStore = useCatalogStore()
const configStore = useConfigStore()

const pageMap: Record<string, any> = {
  team: TeamConfigPage,
  attribute: AttributeConfigPage,
  resource: ResourcePage,
  result: ResultPage,
  resourceUtilization: ResourceUtilizationPage,
  stunAxis: StunAxisPage,
  teamCompare: TeamComparePage,
  breakerCompare: StunBreakerComparePage,
  timeline: TimeChartsPage,
  debug: DebugPage,
  wengineFields: WEngineFieldPage,
  logic: LogicEditorPage,
  mechanic: MechanicsTablePage,
}

const currentPage = computed(() => pageMap[configStore.activeTab] ?? TeamConfigPage)

// ============ 初始化 ============
onMounted(async () => {
  try {
    await catalogStore.load()
  } catch {
    // 错误已存入 catalogStore.error
    return
  }

  // 先加载配装推荐，再初始化默认队伍，这样角色会直接带推荐配置
  await catalogStore.loadBuildRecommendations()

  // 数据加载完成后自动初始化默认队伍
  configStore.initDefaultTeam()
})
</script>

<style scoped>
.calc-root {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--app-bg, #0f0f12);
}

.calc-content {
  flex: 1;
  max-width: 1400px;
  width: 100%;
  margin: 0 auto;
  padding: 18px 24px 32px;
}

.loading-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 80px 0;
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
}

@media (max-width: 768px) {
  .calc-content {
    padding: 12px 10px 24px;
  }
}
</style>
