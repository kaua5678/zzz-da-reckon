<template>
  <div v-if="hasTeam" class="marginal-card">
    <n-card size="small" :bordered="true">
      <template #header>
        <span>边际效用（替换候选）</span>
      </template>

      <div class="marginal-controls">
        <n-button size="small" type="primary" :loading="computing" @click="run">计算候选</n-button>
        <span style="font-size:11px;color:var(--wa-400);margin-left:8px">对当前驱动盘主词条生成替换候选，估算替换后的伤害增量。</span>
      </div>

      <div v-if="results.length > 0" class="marginal-table-wrap">
        <table class="marginal-table">
          <thead>
            <tr><th>候选</th><th>替换后伤害</th><th>相对增量</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in results" :key="r.label" :class="{ 'current-row': r.isCurrent }">
              <td>{{ r.label }}{{ r.isCurrent ? '（当前）' : '' }}</td>
              <td>{{ fmt(r.damage, 0) }}</td>
              <td :style="{ color: r.pct >= 0 ? '#63e2b7' : '#ef4444' }">{{ r.pct >= 0 ? '+' : '' }}{{ r.pct.toFixed(2) }}%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
// CC-346：候选生成与试换在 composables/mainStatMarginal.ts，跑在独立场景上（不改写 UI store；每个候选单项替换）
import { ref, computed } from 'vue'
import { NCard, NButton } from 'naive-ui'
import { useConfigStore } from '@/stores/config'
import { fmt } from '@/utils/format'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { useBatchOwner } from '@/composables/batchTask'
import { computeMainStatMarginals } from '@/composables/mainStatMarginal'

const configStore = useConfigStore()

const hasTeam = computed(() => configStore.team.some(c => !!c.agentId))
const computing = ref(false)
const results = ref<{ label: string; damage: number; pct: number; isCurrent: boolean }[]>([])

/** 批任务归属（同 CC-343 S4）：重算吊销上一次，离开页面也吊销 */
const owner = useBatchOwner()

async function run() {
  const task = owner.start()
  computing.value = true
  results.value = []
  try {
    const { baseDamage, rows } = await withAnalysisScenario(s => computeMainStatMarginals(s, { control: { signal: task.signal } }))
    // 按收益降序，当前配置置顶
    task.commit(() => {
      results.value = [
        { label: '当前配置', damage: baseDamage, pct: 0, isCurrent: true },
        ...rows.map(r => ({ label: r.label, damage: r.damage, pct: r.pct, isCurrent: false })).sort((x, y) => y.pct - x.pct),
      ]
    })
  } finally {
    task.commit(() => { computing.value = false })
  }
}

</script>

<style scoped>
.marginal-card { margin-top: 16px; }
.marginal-controls { margin-bottom: 10px; display: flex; align-items: center; }
.marginal-table-wrap { max-height: 400px; overflow-y: auto; }
.marginal-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.marginal-table th, .marginal-table td { padding: 4px 8px; border-bottom: 1px solid var(--wa-60); text-align: left; color: var(--wa-700); }
.marginal-table th { color: var(--wa-500); font-weight: 600; }
.current-row td { color: #f0a020; font-weight: 600; }
</style>
