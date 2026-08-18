<template>
  <div class="attribute-config-page">
    <n-grid :cols="2" :x-gap="16">
      <!-- 左侧：Boss 选择 + 敌人配置 + 队友 Buff 配置 -->
      <n-gi>
        <n-space vertical :size="16">
          <BossSelectCard />
          <n-card title="敌人配置" size="small" :bordered="true">
            <n-space vertical :size="10">
              <n-grid cols="2" :x-gap="8" :y-gap="8">
                <n-gi>
                  <div class="field">
                    <span class="field-label">Boss 血量</span>
                    <n-input-number
                      :value="configStore.enemy.hp"
                      :min="0"
                      size="small"
                      style="width: 100%"
                      @update:value="v => configStore.setEnemy({ hp: v ?? 0 })"
                    />
                  </div>
                </n-gi>
                <n-gi>
                  <div class="field">
                    <span class="field-label">失衡值</span>
                    <n-input-number
                      :value="configStore.enemy.stunValue"
                      :min="0"
                      size="small"
                      style="width: 100%"
                      @update:value="v => configStore.setEnemy({ stunValue: v ?? 0 })"
                    />
                  </div>
                </n-gi>
                <n-gi>
                  <div class="field">
                    <span class="field-label">失衡时间 (秒)</span>
                    <n-input-number
                      :value="configStore.enemy.stunTime"
                      :min="0"
                      :step="0.5"
                      size="small"
                      style="width: 100%"
                      @update:value="v => configStore.setEnemy({ stunTime: v ?? 0 })"
                    />
                  </div>
                </n-gi>
                <n-gi>
                  <div class="field">
                    <span class="field-label">失衡易伤倍率</span>
                    <n-input-number
                      :value="configStore.enemy.stunVuln"
                      :min="0"
                      :step="0.1"
                      size="small"
                      style="width: 100%"
                      @update:value="v => configStore.setEnemy({ stunVuln: v ?? 1 })"
                    />
                  </div>
                </n-gi>
                <n-gi>
                  <div class="field">
                    <span class="field-label">怪物防御</span>
                    <n-input-number
                      :value="configStore.enemy.defense"
                      :min="0"
                      :step="50"
                      size="small"
                      style="width: 100%"
                      @update:value="v => configStore.setEnemy({ defense: v ?? 0 })"
                    />
                  </div>
                </n-gi>
                <n-gi>
                  <div class="field">
                    <span class="field-label">快速支援（队伍页配置）</span>
                    <n-input-number
                      :value="configStore.team.reduce((sum, c) => sum + (c.quickAssistCount ?? 0), 0)"
                      :min="0"
                      size="small"
                      style="width: 100%"
                      disabled
                    />
                  </div>
                </n-gi>
                <n-gi>
                  <div class="field">
                    <span class="field-label">异常条系数</span>
                    <n-input-number
                      :value="configStore.enemy.anomalyCoeff"
                      :min="0"
                      :step="0.1"
                      size="small"
                      style="width: 100%"
                      @update:value="v => configStore.setEnemy({ anomalyCoeff: v ?? 1 })"
                    />
                  </div>
                </n-gi>
                <n-gi>
                  <div class="field">
                    <span class="field-label">危局异常系数</span>
                    <n-input-number
                      :value="configStore.enemy.bossAnomalyCoeff"
                      :min="0"
                      :step="0.1"
                      size="small"
                      style="width: 100%"
                      @update:value="v => configStore.setEnemy({ bossAnomalyCoeff: v ?? 1 })"
                    />
                  </div>
                </n-gi>
                <n-gi>
                  <div class="field">
                    <span class="field-label">Boss 赠送失衡</span>
                    <n-input-number
                      :value="configStore.enemy.bossStunGift"
                      :min="0"
                      size="small"
                      style="width: 100%"
                      @update:value="v => configStore.setEnemy({ bossStunGift: v ?? 0 })"
                    />
                  </div>
                </n-gi>
                <n-gi>
                  <div class="field">
                    <span class="field-label">秽盾数量</span>
                    <n-input-number
                      :value="configStore.enemy.shieldCount"
                      :min="0"
                      size="small"
                      style="width: 100%"
                      @update:value="v => configStore.setEnemy({ shieldCount: v ?? 0 })"
                    />
                  </div>
                </n-gi>
                <n-gi>
                  <div class="field">
                    <span class="field-label">能量盾数量</span>
                    <n-input-number
                      :value="configStore.enemy.energyShield"
                      :min="0"
                      size="small"
                      style="width: 100%"
                      @update:value="v => configStore.setEnemy({ energyShield: v ?? 0 })"
                    />
                  </div>
                </n-gi>
                <n-gi>
                  <div class="field">
                    <span class="field-label">Boss 无敌时间 (秒)</span>
                    <n-input-number
                      :value="configStore.enemy.invincibleTime"
                      :min="0"
                      :max="180"
                      size="small"
                      style="width: 100%"
                      @update:value="v => configStore.setEnemy({ invincibleTime: v ?? 0 })"
                    />
                  </div>
                </n-gi>
              </n-grid>

              <div class="field">
                <span class="field-label">有效时间 (秒) = 180 - 无敌时间</span>
                <n-input-number
                  :value="configStore.effectiveTime"
                  disabled
                  size="small"
                  style="width: 100%"
                />
              </div>

              <n-divider style="margin: 4px 0" />

              <n-text depth="3" style="font-size: 12px; font-weight: 600">元素抗性 (%)</n-text>
              <div class="formula-note">
                仅 6 个常规元素有抗性区；辉光/流明不配置抗性。抗性乘区不设上限，弱点可填负数。
              </div>
              <div v-for="group in resistanceGroups" :key="group.key" class="resistance-group">
                <n-text depth="3" class="resistance-title">{{ group.label }}</n-text>
                <n-grid cols="3" :x-gap="8" :y-gap="8">
                  <n-gi v-for="el in resistanceElements" :key="`${group.key}-${el.key}`">
                    <div class="field">
                      <span class="field-label">{{ el.label }}</span>
                      <n-input-number
                        :value="getResistance(group.key, el.key)"
                        :min="-999"
                        :max="999"
                        :step="5"
                        size="small"
                        style="width: 100%"
                        @update:value="v => configStore.setResistance(group.key, el.key, v ?? 0)"
                      />
                    </div>
                  </n-gi>
                </n-grid>
              </div>
            </n-space>
          </n-card>

          <!-- 队友 Buff 配置 -->
          <n-card size="small" :bordered="true">
            <template #header>
              <n-space align="center" justify="space-between" style="width: 100%">
                <span>队友 Buff 配置</span>
                <n-input
                  v-model:value="teammateBuffSearch"
                  size="tiny"
                  placeholder="搜索 buff..."
                  clearable
                  style="width: 160px"
                />
              </n-space>
            </template>

            <div v-if="catalogStore.teammateBuffsLoading" class="teammate-loading">
              加载中...
            </div>

            <div v-else-if="teammateBuffGroups.length === 0" class="teammate-empty">
              暂无队友 Buff 数据
            </div>

            <div v-else class="teammate-buff-list">
              <n-collapse v-for="group in filteredGroups" :key="group.id">
                <n-collapse-item :title="groupName(group)" :name="group.id">
                  <div class="buff-item-list">
                    <div
                      v-for="buff in group.buffs"
                      :key="buff.id"
                      class="buff-item"
                      :class="{ enabled: configStore.isTeammateBuffEnabled(buff.id) }"
                    >
                      <div class="buff-item-header">
                        <n-checkbox
                          :checked="configStore.isTeammateBuffEnabled(buff.id)"
                          size="small"
                          @update:checked="v => configStore.toggleTeammateBuff(buff.id, v)"
                        />
                        <span class="buff-item-name">{{ buffName(buff) }}</span>
                      </div>
                      <div class="buff-item-effects">
                        <span
                          v-for="(effect, idx) in buff.effects"
                          :key="effect.id"
                          class="effect-tag"
                        >
                          {{ effectLabel(effect) }}
                        </span>
                      </div>
                      <div v-if="buff.description" class="buff-item-desc">
                        {{ buffDesc(buff) }}
                      </div>
                      <div
                        v-if="configStore.isTeammateBuffEnabled(buff.id) && hasCoverage(buff)"
                        class="buff-item-coverage"
                      >
                        <span class="coverage-label">覆盖率</span>
                        <n-slider
                          :value="configStore.getTeammateBuffCoverage(buff.id)"
                          :min="0"
                          :max="100"
                          :step="5"
                          size="small"
                          style="flex: 1"
                          @update:value="v => configStore.setTeammateBuffCoverage(buff.id, v)"
                        />
                        <span class="coverage-value">
                          {{ configStore.getTeammateBuffCoverage(buff.id) }}%
                        </span>
                      </div>
                    </div>
                  </div>
                </n-collapse-item>
              </n-collapse>
            </div>
          </n-card>
        </n-space>
      </n-gi>

      <!-- 右侧：全局 Buff 表 -->
      <n-gi>
        <n-card size="small" :bordered="true">
          <template #header>
            <n-space align="center" justify="space-between" style="width: 100%">
              <span>全局 Buff</span>
              <n-button size="tiny" type="primary" @click="configStore.addGlobalBuff()">
                添加 Buff
              </n-button>
            </n-space>
          </template>

          <div class="buff-table-wrapper">
            <table class="buff-table">
              <thead>
                <tr>
                  <th style="width: 36px">启用</th>
                  <th style="min-width: 80px">名称</th>
                  <th style="min-width: 110px">属性</th>
                  <th style="width: 110px">目标招式</th>
                  <th style="width: 80px">数值</th>
                  <th style="width: 36px"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="buff in configStore.globalBuffs" :key="buff.id">
                  <td class="col-center">
                    <n-switch
                      :value="buff.enabled"
                      size="small"
                      @update:value="v => configStore.updateGlobalBuff(buff.id, { enabled: v })"
                    />
                  </td>
                  <td>
                    <n-input
                      :value="buff.name"
                      size="tiny"
                      placeholder="名称"
                      @update:value="v => configStore.updateGlobalBuff(buff.id, { name: v })"
                    />
                  </td>
                  <td>
                    <n-select
                      :value="buff.stat"
                      :options="statOptions"
                      size="tiny"
                      filterable
                      @update:value="v => configStore.updateGlobalBuff(buff.id, { stat: v })"
                    />
                  </td>
                  <td>
                    <n-select
                      v-if="buff.stat === 'skillDmgBonus'"
                      :value="buff.targetSkillType ?? 'all'"
                      :options="skillDmgTargetOptions"
                      size="tiny"
                      @update:value="v => configStore.updateGlobalBuff(buff.id, { targetSkillType: v })"
                    />
                    <span v-else class="target-muted">全局</span>
                  </td>
                  <td>
                    <n-input-number
                      :value="buff.value"
                      size="tiny"
                      :min="-9999"
                      style="width: 100%"
                      @update:value="v => configStore.updateGlobalBuff(buff.id, { value: v ?? 0 })"
                    />
                  </td>
                  <td class="col-center">
                    <n-button
                      size="tiny"
                      text
                      type="error"
                      @click="configStore.removeGlobalBuff(buff.id)"
                    >
                      删除
                    </n-button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="configStore.globalBuffs.length === 0" class="empty-buffs">
            暂无 Buff，点击上方按钮添加
          </div>
        </n-card>
      </n-gi>
    </n-grid>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import {
  NCard, NSpace, NGrid, NGi, NInputNumber, NText, NDivider,
  NButton, NSwitch, NInput, NSelect, NCheckbox, NCollapse, NCollapseItem,
  NSlider,
} from 'naive-ui'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { useStatLabel } from '@/composables/useStatLabel'
import { getGlobalBuffStatOptions } from '@/utils/statMeta'
import { SKILL_DMG_TARGETS, SKILL_DMG_TARGET_LABELS } from '@/core/buff'
import BossSelectCard from '@/components/BossSelectCard.vue'
import type { TeammateBuffGroup, TeammateBuff, BuffEffect } from '@/types/catalog'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
const { statLabel, formatStatValue } = useStatLabel()

const teammateBuffSearch = ref('')

onMounted(async () => {
  await catalogStore.loadTeammateBuffs()
})

const resistanceElements = [
  { key: 'physical', label: '物理' },
  { key: 'fire', label: '火' },
  { key: 'ice', label: '冰' },
  { key: 'electric', label: '电' },
  { key: 'ether', label: '以太' },
  { key: 'wind', label: '风' },
]

const resistanceGroups = [
  { key: 'damage' as const, label: '伤害抗性' },
  { key: 'stun' as const, label: '失衡抗性' },
  { key: 'anomaly' as const, label: '积蓄抗性' },
]

function getResistance(kind: 'damage' | 'stun' | 'anomaly', element: string): number {
  const enemy = configStore.enemy
  if (kind === 'damage') return enemy.damageResistances?.[element] ?? enemy.resistances?.[element] ?? 0
  if (kind === 'stun') return enemy.stunResistances?.[element] ?? enemy.resistances?.[element] ?? 0
  return enemy.anomalyResistances?.[element] ?? enemy.resistances?.[element] ?? 0
}

// 常用属性列表（中文名映射）
const COMMON_STATS: { value: string; label: string }[] = [
  { value: 'atkFlat', label: '攻击力' },
  { value: 'atkPct', label: '攻击力%' },
  { value: 'defFlat', label: '防御力' },
  { value: 'defPct', label: '防御力%' },
  { value: 'hpFlat', label: '生命值' },
  { value: 'hpPct', label: '生命值%' },
  { value: 'critRate', label: '暴击率' },
  { value: 'critDmg', label: '暴击伤害' },
  { value: 'sharpCritDmg', label: '锐暴伤害' },
  { value: 'impact', label: '击破特攻' },
  { value: 'anomalyProficiency', label: '异常精通' },
  { value: 'anomalyMastery', label: '异常掌控' },
  { value: 'energyRegen', label: '能量回复' },
  { value: 'penRatio', label: '穿透率' },
  { value: 'penFlat', label: '穿透值' },
  { value: 'dmgBonus', label: '伤害加成' },
  { value: 'physicalDmg', label: '物理伤害加成' },
  { value: 'fireDmg', label: '火属性伤害加成' },
  { value: 'iceDmg', label: '冰属性伤害加成' },
  { value: 'electricDmg', label: '电属性伤害加成' },
  { value: 'etherDmg', label: '以太伤害加成' },
  { value: 'windDmg', label: '风属性伤害加成' },
  { value: 'lumifluxDmg', label: '辉光伤害加成' },
  { value: 'enemyDefReduction', label: '敌方防御降低/无视防御（通用）' },
  { value: 'enemyAnomalyDefReduction', label: '异常伤害防御降低/无视防御' },
  { value: 'enemyElectricDefReduction', label: '电属性防御降低/无视防御' },
  { value: 'enemyResReduction', label: '敌方抗性降低/无视抗性（全元素）' },
  { value: 'enemyElectricResReduction', label: '电属性抗性降低/无视抗性' },
  { value: 'enemyLumifluxResReduction', label: '辉光/耀变抗性降低/无视抗性' },
  { value: 'enemyDamageTakenBonus', label: '敌方受到伤害加成' },
  { value: 'stunDmgMultiplierBonus', label: '失衡伤害倍率加成' },
  { value: 'anomalyReleaseDmgBonus', label: '异放伤害提升' },
  { value: 'remielleRefringeCoefficient', label: '蕾米异化度' },
  { value: 'remielleRefringeCoefficientBonusPct', label: '蕾米异化度提升' },
  { value: 'remielleLuminizeMultiplierBonus', label: '蕾米被动耀变倍率提升' },
  { value: 'remielleCinema4LuminizeMultiplierBonus', label: '蕾米4命耀变倍率提升' },
]

const statOptions = computed(() => getGlobalBuffStatOptions(catalogStore.statRules?.statDisplay as any))

const skillDmgTargetOptions = SKILL_DMG_TARGETS.map(value => ({
  value,
  label: SKILL_DMG_TARGET_LABELS[value],
}))

// ========== 队友 Buff ==========

const teammateBuffGroups = computed<TeammateBuffGroup[]>(() =>
  catalogStore.teammateBuffGroups ?? []
)

// 按搜索词过滤分组
const filteredGroups = computed(() => {
  const search = teammateBuffSearch.value.trim().toLowerCase()
  if (!search) return teammateBuffGroups.value
  return teammateBuffGroups.value
    .map(group => {
      const matchedBuffs = group.buffs.filter(buff => {
        const name = (buff as any).name?.zhCN ?? (buff as any).name?.en ?? (buff as any).sourceLabel?.zhCN ?? ''
        const desc = (buff as any).description?.zhCN ?? (buff as any).description?.en ?? ''
        const groupName = group.name?.zhCN ?? group.name?.en ?? ''
        return name.toLowerCase().includes(search) ||
          desc.toLowerCase().includes(search) ||
          groupName.toLowerCase().includes(search)
      })
      if (matchedBuffs.length === 0) return null
      return { ...group, buffs: matchedBuffs }
    })
    .filter((g): g is TeammateBuffGroup => g !== null)
})

// 辅助：获取分组显示名
function groupName(group: TeammateBuffGroup): string {
  return group.name?.zhCN ?? group.name?.en ?? group.id
}

// 辅助：获取 buff 显示名
function buffName(buff: TeammateBuff): string {
  const b = buff as any
  if (b.name?.zhCN) return b.name.zhCN
  if (b.name?.en) return b.name.en
  if (b.sourceLabel?.zhCN) return b.sourceLabel.zhCN
  if (b.sourceLabel?.en) return b.sourceLabel.en
  return buff.id
}

// 辅助：获取 buff 描述
function buffDesc(buff: TeammateBuff): string {
  const b = buff as any
  if (b.description?.zhCN) return b.description.zhCN
  if (b.description?.en) return b.description.en
  if (b.conditionLabel?.zhCN) return b.conditionLabel.zhCN
  if (b.conditionLabel?.en) return b.conditionLabel.en
  return ''
}

function formulaDefaultValue(effect: BuffEffect): string {
  const source = (effect as any).source
  const expression = effect.formula?.expression ?? '公式'
  const sourceLabel = source?.label?.zhCN ?? source?.label?.en ?? 'x'
  const defaultValue = source?.defaultValue
  return `${expression}${defaultValue != null ? `，${sourceLabel}=${defaultValue}` : ''}`
}

// 辅助：获取效果显示名
function effectLabel(effect: BuffEffect): string {
  const stat = `${statLabel(effect.stat)} (${effect.stat})`
  let valueStr = ''
  if (effect.type === 'fixed') {
    valueStr = formatStatValue(effect.stat, effect.value, effect.mode)
  } else if (effect.type === 'derived') {
    const source = (effect as any).sourceLabel?.zhCN ?? (effect as any).sourceLabel?.en ?? '某属性'
    const ratio = effect.ratio ?? 0
    const cap = effect.cap
    valueStr = `${source}的${ratio}%` + (cap ? ` (上限${cap})` : '')
  } else if (effect.type === 'stacked') {
    const perStack = effect.valuePerStack ?? effect.value
    const maxStacks = effect.maxStacks ?? effect.defaultStacks ?? 1
    valueStr = `每层${perStack}，最多${maxStacks}层`
  } else if (effect.type === 'formula') {
    valueStr = formulaDefaultValue(effect)
  }
  return `${stat} +${valueStr}`
}

// 辅助：判断 buff 是否有覆盖率设置
function hasCoverage(buff: TeammateBuff): boolean {
  return buff.effects.some(e => e.coverage && e.coverage.default !== undefined)
}
</script>

<style scoped>
.attribute-config-page {
  width: 100%;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}

.buff-table-wrapper {
  overflow-x: auto;
}

.buff-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.buff-table th {
  text-align: left;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
  padding: 8px 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 11px;
}

.buff-table td {
  padding: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  vertical-align: middle;
}

.buff-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.02);
}

.col-center {
  text-align: center;
}

.formula-note {
  font-size: 11px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.45);
  margin-top: -2px;
}

.resistance-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.resistance-title {
  font-size: 12px;
  font-weight: 600;
}

.target-muted {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
}

.empty-buffs {
  text-align: center;
  padding: 30px 0;
  color: rgba(255, 255, 255, 0.3);
  font-size: 13px;
}

/* 队友 Buff 列表 */
.teammate-loading,
.teammate-empty {
  text-align: center;
  padding: 30px 0;
  color: rgba(255, 255, 255, 0.3);
  font-size: 13px;
}

.teammate-buff-list {
  max-height: 500px;
  overflow-y: auto;
  margin: -8px -12px;
  padding: 0 4px;
}

.buff-item-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0 8px;
}

.buff-item {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  padding: 8px 10px;
  transition: all 0.2s ease;
}

.buff-item.enabled {
  background: rgba(59, 130, 246, 0.06);
  border-color: rgba(59, 130, 246, 0.2);
}

.buff-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.buff-item-name {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  flex: 1;
}

.buff-item-effects {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}

.effect-tag {
  font-size: 11px;
  padding: 2px 6px;
  background: rgba(34, 197, 94, 0.12);
  color: rgba(74, 222, 128, 0.9);
  border-radius: 4px;
  line-height: 1.4;
}

.buff-item-desc {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  line-height: 1.5;
  margin-top: 2px;
}

.buff-item-coverage {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.coverage-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  width: 40px;
  flex-shrink: 0;
}

.coverage-value {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.7);
  width: 36px;
  text-align: right;
  flex-shrink: 0;
}
</style>
