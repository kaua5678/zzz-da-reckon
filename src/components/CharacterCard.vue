<template>
  <div
    class="character-card"
    :class="{ selected: isSelected, empty: !agent }"
    @click="handleCardClick"
  >
    <div class="card-header">
      <span class="slot-label">槽位 {{ slot + 1 }}</span>
      <span v-if="agent" class="cinema-level">影画 {{ cinemaLevel }}</span>
    </div>

    <div v-if="agent" class="card-body">
      <div class="char-portrait-row">
        <div v-if="agentImageUrl" class="char-portrait-wrapper">
          <img :src="agentImageUrl" :alt="agentName" class="char-portrait" @error="imgError = true" />
        </div>
        <div class="char-info">
          <div class="char-name-row">
            <div class="char-name">{{ agentName }}</div>
            <n-dropdown
              :options="dropdownOptions"
              trigger="click"
              placement="bottom-end"
              @select="onDropdownSelect"
            >
              <n-button text size="tiny" @click.stop>
                <n-icon size="14"><chevron-down-outline /></n-icon>
              </n-button>
            </n-dropdown>
          </div>
          <div class="char-tags">
            <n-tag :type="rarityTagType" size="tiny" round>
              {{ agent.rarity }}
            </n-tag>
            <n-tag size="tiny" :color="specialtyTagColor">
              {{ specialtyLabel }}
            </n-tag>
            <n-tag size="tiny" :color="attributeTagColor" round>
              {{ attributeLabel }}
            </n-tag>
          </div>
          <div class="wengine-name">
            <n-icon size="12" style="margin-right: 4px">
              <musical-notes-outline />
            </n-icon>
            {{ wengineName }}
          </div>
        </div>
      </div>
    </div>

    <div v-else class="card-empty">
      <n-select
        :value="null"
        :options="availableOptions"
        size="small"
        filterable
        placeholder="选择角色"
        style="width: 100%"
        @click.stop
        @update:value="onSelectAgent"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NTag, NIcon, NSelect, NButton, NDropdown } from 'naive-ui'
import { MusicalNotesOutline, ChevronDownOutline } from '@vicons/ionicons5'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { getImageUrl } from '@/utils/image'
import type { Agent } from '@/types/catalog'

const props = defineProps<{
  slot: number
  isSelected: boolean
}>()

const emit = defineEmits<{
  (e: 'select', slot: number): void
}>()

const configStore = useConfigStore()
const catalogStore = useCatalogStore()

const char = computed(() => configStore.team[props.slot])
const agent = computed<Agent | null>(() => {
  const id = char.value?.agentId
  if (!id) return null
  return catalogStore.getAgent(id) ?? null
})

const cinemaLevel = computed(() => char.value?.cinemaLevel ?? 0)

/** 图片加载失败时隐藏 */
const imgError = ref(false)
watch(() => char.value?.agentId, () => { imgError.value = false })

/** 角色头像URL（source为直接图片链接时可用） */
const agentImageUrl = computed(() => {
  if (!agent.value?.images || imgError.value) return null
  return getImageUrl(agent.value.images)
})

const agentName = computed(() => {
  if (!agent.value) return ''
  return agent.value.name.zhCN ?? agent.value.name.en ?? agent.value.id
})

const wengineName = computed(() => {
  const wengineId = char.value?.wEngineId
  if (!wengineId) return '无音擎'
  const w = catalogStore.getWEngine(wengineId)
  if (!w) return '无音擎'
  return w.name.zhCN ?? w.name.en ?? w.id
})

// 可选角色列表（过滤掉已选的，保留当前槽位的角色）
const availableOptions = computed(() => {
  const used = configStore.usedAgentIds
  const currentId = char.value?.agentId
  return catalogStore.displayAgents
    .filter(a => !used.includes(a.id) || a.id === currentId)
    .map(a => {
      const rarity = a.rarity
      const specialty = SPECIALTY_LABEL[a.specialty] ?? a.specialty
      const attr = ATTRIBUTE_LABEL[a.attribute] ?? a.attribute
      const name = a.name.zhCN ?? a.name.en ?? a.id
      return {
        label: `${name} · ${rarity} · ${specialty} · ${attr}`,
        value: a.id,
      }
    })
})

// Dropdown 选项（与 availableOptions 结构一致但适配 NDropdown）
const dropdownOptions = computed(() => {
  const used = configStore.usedAgentIds
  const currentId = char.value?.agentId
  return catalogStore.displayAgents
    .filter(a => !used.includes(a.id) || a.id === currentId)
    .map(a => {
      const rarity = a.rarity
      const specialty = SPECIALTY_LABEL[a.specialty] ?? a.specialty
      const attr = ATTRIBUTE_LABEL[a.attribute] ?? a.attribute
      const name = a.name.zhCN ?? a.name.en ?? a.id
      return {
        label: `${name} · ${rarity} · ${specialty} · ${attr}`,
        key: a.id,
      }
    })
})

function onSelectAgent(id: string | null) {
  if (id) {
    configStore.setAgent(props.slot, id)
  }
}

function onDropdownSelect(key: string | number) {
  configStore.setAgent(props.slot, String(key))
}

const rarityTagType = computed(() => {
  const r = agent.value?.rarity
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
  if (!agent.value) return ''
  return SPECIALTY_LABEL[agent.value.specialty] ?? agent.value.specialty
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
  const s = agent.value?.specialty ?? ''
  return map[s] ?? { color: '#555', textColor: '#fff' }
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
  if (!agent.value) return ''
  return ATTRIBUTE_LABEL[agent.value.attribute] ?? agent.value.attribute
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
  const a = agent.value?.attribute ?? ''
  return map[a] ?? { color: '#555', textColor: '#fff' }
})

function handleCardClick() {
  emit('select', props.slot)
}
</script>

<style scoped>
.character-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  min-height: 120px;
  display: flex;
  flex-direction: column;
}

.character-card:hover {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.15);
}

.character-card.selected {
  background: rgba(59, 130, 246, 0.12);
  border-color: #3b82f6;
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.3);
}

.character-card.empty {
  justify-content: center;
  align-items: center;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.slot-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  font-weight: 500;
}

.cinema-level {
  font-size: 11px;
  color: rgba(255, 215, 0, 0.8);
  font-weight: 600;
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.char-portrait-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.char-portrait-wrapper {
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  display: flex;
  align-items: center;
  justify-content: center;
}

.char-portrait {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.char-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.char-name {
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  line-height: 1.3;
  flex: 1;
}

.char-name-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.char-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.wengine-name {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  display: flex;
  align-items: center;
  margin-top: 2px;
}

.card-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1;
}

.empty-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.3);
}
</style>
