<template>
  <div class="boss-card" :class="{ applied, compact }">
    <div class="bc-head">
      <div class="boss-icon">
        <img v-if="preset?.icon && !iconFailed" :src="preset.icon" alt="" class="boss-img" @error="iconFailed = true" />
        <span v-else class="boss-fallback">{{ brief.name.slice(0, 1) }}</span>
      </div>
      <div class="bc-info">
        <div class="boss-name">
          {{ brief.name }}
          <n-tag v-if="applied" size="tiny" type="success" :bordered="false">已应用</n-tag>
        </div>
        <div class="boss-tags">
          <n-tag v-for="w in brief.weakness" :key="'w-' + w" size="tiny" type="success" :bordered="false">弱 {{ w }}</n-tag>
          <n-tag v-for="r in brief.resistance" :key="'r-' + r" size="tiny" type="error" :bordered="false">抗 {{ r }}</n-tag>
          <span v-if="brief.weakness.length === 0 && brief.resistance.length === 0" class="boss-neutral">无弱抗</span>
        </div>
        <div class="bc-stats">
          <span>血量 {{ compact(brief.hp) }}</span>
          <span>失衡 {{ fmt(brief.stunValue, 0) }}</span>
          <span>防 {{ brief.defense }} / Lv{{ brief.level }}</span>
          <span v-if="preset">倍率 {{ fmt(preset.monster.stunVuln, 2) }} / {{ fmt(preset.monster.stunTime, 1) }}s</span>
          <span v-if="preset && (preset.defaults.shieldCount || preset.defaults.energyShield)">
            秽盾 {{ preset.defaults.shieldCount }} / 能量盾 {{ preset.defaults.energyShield }}
          </span>
        </div>
      </div>
    </div>

    <!-- 关卡固有 buff（layer_buff 数值效果） -->
    <div v-if="layerEffects.length > 0" class="layer-buffs">
      <span class="layer-label">关卡 buff</span>
      <span v-for="(e, i) in layerEffects" :key="i" class="effect-tag">{{ e }}</span>
    </div>

    <n-button
      type="primary"
      size="small"
      :disabled="applied"
      style="align-self: flex-end"
      @click="emit('apply')"
    >
      {{ applied ? '已填充' : '应用此 Boss' }}
    </n-button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { NTag, NButton } from 'naive-ui'
import { fmt, compact } from '@/utils/format'
import type { BossPreset, PhaseBossBrief, PhaseBuffEffect } from '@/types/bossPreset'

const props = defineProps<{
  brief: PhaseBossBrief
  preset: BossPreset | null
  applied: boolean
  compact?: boolean
}>()
const emit = defineEmits<{ apply: [] }>()

const iconFailed = ref(false)

/** 关卡固有 buff 的解析效果标签 */
const layerEffects = computed<string[]>(() => {
  const out: string[] = []
  for (const card of props.brief.bossBuffs ?? []) {
    for (const e of card.effects) out.push(effectLabel(e))
  }
  return out
})

function effectLabel(e: PhaseBuffEffect): string {
  const cond: string[] = []
  if (e.cond?.anomalyCount) cond.push('异常2/3名')
  if (e.cond?.specialty) cond.push(`${e.cond.specialty}限定`)
  const unit = e.stat === 'anomalyProficiency' ? '点' : '%'
  const parts = [statLabelOf(e.stat), `+${e.value}${unit}`]
  if (e.targetSkillType) parts.push(`→${e.targetSkillType}`)
  if (cond.length) parts.push(`[${cond.join('，')}]`)
  return parts.join(' ')
}

const STAT_LABELS: Record<string, string> = {
  critDmg: '暴伤', atkPct: '攻击%', anomalyProficiency: '精通',
  anomalyDmgBonus: '异常伤', anomalyBuildUpEfficiency: '积蓄效率',
  enemyResReduction: '全减抗', enemyDefReduction: '减防',
  stunDmgMultiplierBonus: '失衡易伤', enemyDamageTakenBonus: '易伤',
  sheerDmgBonus: '贯穿伤', sharpDmgBonus: '锐化伤', sharpCritDmg: '锐暴', penRatio: '穿透率',
  defPct: '防御%', hpPct: '生命%', stunBuildUpBonus: '失衡值', skillDmgBonus: '招式伤',
}
const EL_ZH: Record<string, string> = { physical: '物理', fire: '火', ice: '冰', electric: '电', ether: '以太', wind: '风' }
function statLabelOf(stat: string): string {
  if (STAT_LABELS[stat]) return STAT_LABELS[stat]
  const el = stat.match(/^(physical|fire|ice|electric|ether|wind)Dmg$/)
  if (el) return `${EL_ZH[el[1]]}伤`
  const res = stat.match(/^enemy(Physical|Fire|Ice|Electric|Ether|Wind)ResReduction$/)
  if (res) return `${EL_ZH[res[1].toLowerCase()]}减抗`
  return stat
}
</script>

<style scoped>
.boss-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--wa-100);
  border-radius: 8px;
  padding: 10px 14px;
  background: var(--wa-20);
  transition: border-color 0.2s;
}

.boss-card.applied {
  border-color: #18a058;
  background: rgba(24, 160, 88, 0.06);
}

.boss-card.compact {
  padding: 8px 10px;
}

.bc-head {
  display: flex;
  gap: 10px;
  align-items: center;
  min-width: 0;
}

.boss-icon {
  width: 52px;
  height: 52px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #2b2f45, #1a1c2c);
}

.boss-card.compact .boss-icon {
  width: 44px;
  height: 44px;
}

.boss-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.boss-fallback {
  font-size: 22px;
  font-weight: 700;
  color: #c9b8ff;
}

.bc-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.boss-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
}

.boss-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.boss-neutral {
  font-size: 11px;
  color: var(--wa-400);
}

.bc-stats {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--wa-550);
}

.layer-buffs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  align-items: center;
}

.layer-label {
  font-size: 11px;
  color: rgba(230, 180, 100, 0.8);
}

.effect-tag {
  font-size: 11px;
  background: rgba(230, 180, 100, 0.1);
  color: #e6b464;
  border-radius: 3px;
  padding: 1px 5px;
}
</style>
