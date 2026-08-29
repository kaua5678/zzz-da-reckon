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
import { computed, onMounted, defineAsyncComponent, h, type AsyncComponentLoader, type Component } from 'vue'
import { NSpin, NAlert } from 'naive-ui'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import AppHeader from '@/components/AppHeader.vue'
// 默认页保持 eager（首屏即时渲染）；其余 13 页懒加载按需拆 chunk，降低首包 JS（原全量打进 index ~1.6MB）。
import TeamConfigPage from '@/views/TeamConfigPage.vue'

const catalogStore = useCatalogStore()
const configStore = useConfigStore()

/** 懒加载占位：快页面（<120ms）不闪 loading，慢页面显示小圈 */
const PageLoading = {
  render: () =>
    h('div', { style: 'display:flex;align-items:center;justify-content:center;padding:40px;min-height:200px' }, [
      h(NSpin, { size: 'small' }),
    ]),
}

const lazyPage = (loader: AsyncComponentLoader<Component>) =>
  defineAsyncComponent({ loader, loadingComponent: PageLoading, delay: 120 })

const pageMap: Record<string, any> = {
  team: TeamConfigPage,
  attribute: lazyPage(() => import('@/views/AttributeConfigPage.vue')),
  resource: lazyPage(() => import('@/views/ResourcePage.vue')),
  result: lazyPage(() => import('@/views/ResultPage.vue')),
  resourceUtilization: lazyPage(() => import('@/views/ResourceUtilizationPage.vue')),
  stunAxis: lazyPage(() => import('@/views/StunAxisPage.vue')),
  teamCompare: lazyPage(() => import('@/views/TeamComparePage.vue')),
  breakerCompare: lazyPage(() => import('@/views/StunBreakerComparePage.vue')),
  timeline: lazyPage(() => import('@/views/TimeChartsPage.vue')),
  debug: lazyPage(() => import('@/views/DebugPage.vue')),
  wengineFields: lazyPage(() => import('@/views/WEngineFieldPage.vue')),
  logic: lazyPage(() => import('@/views/LogicEditorPage.vue')),
  mechanic: lazyPage(() => import('@/views/MechanicsTablePage.vue')),
  multiplierCoeff: lazyPage(() => import('@/views/MultiplierCoeffPage.vue')),
  runArchive: lazyPage(() => import('@/views/RunArchivePage.vue')),
  bossHp: lazyPage(() => import('@/views/BossHpInflationPage.vue')),
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
  color: var(--wa-500);
  font-size: 14px;
}

@media (max-width: 768px) {
  .calc-content {
    padding: 12px 10px 24px;
  }
}
</style>
