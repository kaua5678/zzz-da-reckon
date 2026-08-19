<template>
  <div class="resource-page">
    <!-- 角色选择 + 头像 -->
    <div class="agent-selector">
      <n-select
        :value="selectedAgentId"
        :options="agentOptions"
        @update:value="onAgentChange"
        placeholder="选择角色"
        style="width: 240px"
      />
      <div v-if="currentAgent" class="agent-info-bar">
        <div v-if="agentImageUrl" class="agent-portrait-wrapper">
          <img :src="agentImageUrl" :alt="agentName" class="agent-portrait" @error="onImageError" />
        </div>
        <div class="agent-meta">
          <span class="agent-meta-name">{{ agentName }}</span>
          <n-tag :type="rarityTagType" size="tiny" round>{{ currentAgent.rarity }}</n-tag>
          <n-tag size="tiny" :color="specialtyTagColor">{{ specialtyLabel }}</n-tag>
          <n-tag size="tiny" :color="attributeTagColor" round>{{ attributeLabel }}</n-tag>
        </div>
      </div>
    </div>

    <!-- 倍率表 -->
    <div v-if="currentSkills" class="skill-tables">
      <div v-for="category in currentSkills.categories" :key="category.id" class="skill-category">
        <div class="category-title">{{ category.name.zhCN || category.name.en }}</div>
        <n-data-table
          :columns="buildColumns(category)"
          :data="buildRows(category)"
          :bordered="true"
          :single-line="false"
          size="small"
          :scroll-x="900"
        />
      </div>
    </div>
    <div v-else class="no-data">该角色无技能数据</div>

    <!-- 时间公式说明 -->
    <div class="formula-legend">
      <div class="legend-title">动作时间公式</div>
      <div class="legend-item"><n-tag size="small" type="default">normal</n-tag> 一般招式：秽盾/100</div>
      <div class="legend-item"><n-tag size="small" type="warning">dodgeCounter</n-tag> 闪避反击：秽盾/100 - 1.5</div>
      <div class="legend-item"><n-tag size="small" type="info">parry</n-tag> 弹刀：秽盾/100 - 2.5</div>
      <div class="legend-item"><n-tag size="small" type="error">ultimate</n-tag> 终结技：秽盾/100 - 5</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { NSelect, NDataTable, NTag } from 'naive-ui'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { getImageUrl } from '@/utils/image'
import type { SkillCategory, SkillMove, Agent } from '@/types/catalog'

const catalogStore = useCatalogStore()
const configStore = useConfigStore()

// 图片加载失败时隐藏
const imgError = ref(false)

// 默认选队伍第一个角色
const selectedAgentId = ref<string>(configStore.team[0]?.agentId || '')

watch(() => configStore.team[0]?.agentId, (newId) => {
  if (newId && !selectedAgentId.value) selectedAgentId.value = newId
})

// 切换角色时重置图片错误状态
watch(selectedAgentId, () => { imgError.value = false })

const agentOptions = computed(() => {
  return catalogStore.displayAgents.map(a => ({
    label: a.name.zhCN || a.name.en,
    value: a.id,
  }))
})

function onAgentChange(id: string) {
  selectedAgentId.value = id
}

const currentAgent = computed<Agent | null>(() => {
  if (!selectedAgentId.value) return null
  return catalogStore.getAgent(selectedAgentId.value) ?? null
})

const agentName = computed(() => {
  if (!currentAgent.value) return ''
  return currentAgent.value.name.zhCN ?? currentAgent.value.name.en ?? currentAgent.value.id
})

const agentImageUrl = computed(() => {
  if (!currentAgent.value?.images || imgError.value) return null
  return getImageUrl(currentAgent.value.images)
})

function onImageError() {
  imgError.value = true
}

const currentSkills = computed(() => {
  if (!selectedAgentId.value) return null
  return catalogStore.getAgentSkills(selectedAgentId.value)
})

const rarityTagType = computed(() => {
  const r = currentAgent.value?.rarity
  return r === 'S' ? 'warning' : r === 'A' ? 'success' : 'default'
})

const SPECIALTY_LABEL: Record<string, string> = {
  attack: '强攻',
  stun: '击破',
  anomaly: '异常',
  support: '支援',
  defense: '防护',
  rupture: '命破',
  edgeguard: '锋御',
  sharpen: '锋御',
}
const specialtyLabel = computed(() => {
  if (!currentAgent.value) return ''
  return SPECIALTY_LABEL[currentAgent.value.specialty] ?? currentAgent.value.specialty
})
const specialtyTagColor = computed(() => {
  const map: Record<string, { color: string; textColor: string }> = {
    attack: { color: '#c0392b', textColor: '#fff' },
    stun: { color: '#d97706', textColor: '#fff' },
    anomaly: { color: '#7c3aed', textColor: '#fff' },
    support: { color: '#2563eb', textColor: '#fff' },
    defense: { color: '#047857', textColor: '#fff' },
    rupture: { color: '#db2777', textColor: '#fff' },
    edgeguard: { color: '#0f766e', textColor: '#fff' },
    sharpen: { color: '#0f766e', textColor: '#fff' },
  }
  return map[currentAgent.value?.specialty ?? ''] ?? { color: '#555', textColor: '#fff' }
})

const ATTRIBUTE_LABEL: Record<string, string> = {
  physical: '物理',
  fire: '火',
  ice: '冰',
  electric: '电',
  ether: '以太',
  wind: '风',
  frost: '霜',
  honed_edge: '利刃',
  xuanmo: '玄墨',
}
const attributeLabel = computed(() => {
  if (!currentAgent.value) return ''
  return ATTRIBUTE_LABEL[currentAgent.value.attribute] ?? currentAgent.value.attribute
})
const attributeTagColor = computed(() => {
  const map: Record<string, { color: string; textColor: string }> = {
    physical: { color: '#9ca3af', textColor: '#fff' },
    fire: { color: '#ef4444', textColor: '#fff' },
    ice: { color: '#38bdf8', textColor: '#fff' },
    electric: { color: '#facc15', textColor: '#fff' },
    ether: { color: '#a78bfa', textColor: '#fff' },
    wind: { color: '#34d399', textColor: '#fff' },
    frost: { color: '#60a5fa', textColor: '#fff' },
    honed_edge: { color: '#f472b6', textColor: '#fff' },
    xuanmo: { color: '#6366f1', textColor: '#fff' },
  }
  return map[currentAgent.value?.attribute ?? ''] ?? { color: '#555', textColor: '#fff' }
})

// 构建列定义
function buildColumns(category: SkillCategory) {
  const cols: any[] = [
    { title: '招式', key: 'name', fixed: 'left', width: 200 },
    { title: '类型', key: 'skillType', width: 80 },
    { title: '时间类型', key: 'timeType', width: 110 },
    { title: '动作时间', key: 'actionTime', width: 90 },
    { title: '合轴率', key: 'comboAlignRatio', width: 80 },
  ]

  // 动态列：从第一个 move 的 rows 推断
  const firstMove = category.moves[0]
  if (firstMove?.rows) {
    for (const row of firstMove.rows) {
      const label = row.label?.zhCN || row.label?.en || row.id
      cols.push({
        title: label,
        key: row.id,
        width: 100,
        align: 'right',
      })
    }
  }

  return cols
}

// 构建行数据
function buildRows(category: SkillCategory) {
  return category.moves.map((move: SkillMove) => {
    const row: Record<string, any> = {
      name: move.name.zhCN || move.name.en,
      skillType: move.skillType || '-',
      timeType: move.timeType || '-',
      actionTime: move.actionTime != null ? `${move.actionTime}s` : '-',
      comboAlignRatio: move.comboAlignRatio != null ? `${(move.comboAlignRatio * 100).toFixed(0)}%` : '0%',
    }
    if (move.rows) {
      for (const r of move.rows) {
        const val = Array.isArray(r.values) ? r.values[0] : r.values
        row[r.id] = val != null ? val : '-'
      }
    }
    return row
  })
}
</script>

<style scoped>
.resource-page {
  width: 100%;
  padding: 16px 24px;
}

.agent-selector {
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.agent-info-bar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.agent-portrait-wrapper {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  display: flex;
  align-items: center;
  justify-content: center;
}

.agent-portrait {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.agent-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.agent-meta-name {
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  margin-right: 4px;
}

.skill-tables {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.skill-category {
  background: rgba(255, 255, 255, 0.02);
  border-radius: 8px;
  padding: 12px 16px;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.category-title {
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  margin-bottom: 10px;
}

.no-data {
  text-align: center;
  padding: 40px;
  color: rgba(255, 255, 255, 0.3);
}

.formula-legend {
  margin-top: 24px;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.legend-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 8px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 4px;
}

/* 覆盖 Naive UI 表格暗色主题 */
:deep(.n-data-table) {
  --n-merged-th-color: rgba(255, 255, 255, 0.06);
  --n-merged-td-color: transparent;
  --n-merged-td-color-hover: rgba(255, 255, 255, 0.04);
  --n-border-color: rgba(255, 255, 255, 0.08);
}
</style>
