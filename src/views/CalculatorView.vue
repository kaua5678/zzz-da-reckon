<template>
  <div class="calc-root">
    <!-- 顶部导航 -->
    <AppHeader />

    <!-- 内容区域 -->
    <div class="calc-content" :data-startup-status="startupStatus">
      <n-spin :show="startupStatus === 'loading'">
        <template v-if="startupStatus === 'error'">
          <n-alert type="error" title="启动数据加载失败" style="margin: 20px">
            <p>{{ startupError }}</p>
            <p>依赖未就绪，暂不开放编辑和完整计算。重试不会覆盖已有配置。</p>
            <n-button type="primary" size="small" @click="start">重试加载</n-button>
          </n-alert>
        </template>

        <template v-else-if="startupStatus === 'ready'">
          <component :is="currentPage" />
        </template>

        <template v-else>
          <div class="loading-placeholder">
            <n-spin size="small" />
            <span>正在加载目录、队友 Buff 和配装推荐…</span>
          </div>
        </template>
      </n-spin>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, defineAsyncComponent, h, type AsyncComponentLoader, type Component } from 'vue'
import { NSpin, NAlert, NButton } from 'naive-ui'
import { useUiStore } from '@/stores/ui'
import { useTimeWeightAutoAllocation } from '@/composables/timeWeightAllocation'
import { useCalculatorStartup } from '@/composables/calculatorStartup'
import AppHeader from '@/components/AppHeader.vue'
// 默认页保持 eager（首屏即时渲染）；其余 13 页懒加载按需拆 chunk，降低首包 JS（原全量打进 index ~1.6MB）。
import TeamConfigPage from '@/views/TeamConfigPage.vue'

const uiStore = useUiStore()
const { status: startupStatus, error: startupError, start } = useCalculatorStartup()

// 平A池权重·分配策略**三态**（用户裁决）：'static' 不跑（静态/手填权重）/ 'balanced' 默认＝边际均衡（B，
// ≈3 倍求值）/ 'joint' ＝多杠杆联合（C，更慢）。必须在「计算外侧」——策略要读伤害做有限差分，
// 放进响应式计算会递归（见 timeWeightAllocation.ts）。
useTimeWeightAutoAllocation()

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
  breakerCompare: lazyPage(() => import('@/views/PositionComparePage.vue')),
  freeCompare: lazyPage(() => import('@/views/FreeComparePage.vue')),
  timeline: lazyPage(() => import('@/views/TimeChartsPage.vue')),
  debug: lazyPage(() => import('@/views/DebugPage.vue')),
  wengineFields: lazyPage(() => import('@/views/WEngineFieldPage.vue')),
  logic: lazyPage(() => import('@/views/LogicEditorPage.vue')),
  mechanic: lazyPage(() => import('@/views/MechanicsTablePage.vue')),
  multiplierCoeff: lazyPage(() => import('@/views/MultiplierCoeffPage.vue')),
  runArchive: lazyPage(() => import('@/views/RunArchivePage.vue')),
  charIncrement: lazyPage(() => import('@/views/CharIncrementPage.vue')),
  bossHp: lazyPage(() => import('@/views/BossHpInflationPage.vue')),
}

const currentPage = computed(() => pageMap[uiStore.activeTab] ?? TeamConfigPage)

// 完整依赖成功前不挂编辑页；重试复用同一入口，默认队伍的防覆写由 config store 自身保证。
onMounted(() => { void start() })
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
