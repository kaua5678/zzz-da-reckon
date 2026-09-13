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
          <span v-if="preset && (preset.defaults.shieldCount || preset.defaults.energyShield || preset.defaults.invincibleTime || preset.defaults.parryTotal || preset.defaults.parryNoFollowUpTotal || preset.defaults.parryDecibelOnlyTotal || controlSkillGroups.length)">
            秽盾 {{ preset.defaults.shieldCount }} / 能量盾 {{ preset.defaults.energyShield }}<template v-if="preset.defaults.invincibleTime"> / 无敌 {{ preset.defaults.invincibleTime }}s</template><template v-if="preset.defaults.parryTotal"> / 弹刀 {{ preset.defaults.parryTotal }}</template><template v-if="preset.defaults.parryNoFollowUpTotal"> / 无突击 {{ preset.defaults.parryNoFollowUpTotal }}</template><template v-if="preset.defaults.parryDecibelOnlyTotal"> / 只喧响 {{ preset.defaults.parryDecibelOnlyTotal }}</template><template v-if="controlSkillGroups.length"> / 控制技 {{ controlSkillGroups.length }}组（{{ controlSkillGroups.join('+') }}段）</template>
          </span>
        </div>
      </div>
    </div>

    <!-- 控制技（紫光技）× 反制支援：整组化解开关 + 逐组招架段数可编辑（用户对导入默认值不满意可调；
         编辑只活在 appliedBoss，重新应用 Boss 回落预设默认；引擎/折算/难度曲线全读同一活引用） -->
    <div v-if="controlSkillGroups.length > 0 || applied" class="counter-assist-row">
      <div v-if="controlSkillGroups.length > 0" class="ca-toggle">
        <n-checkbox
          :checked="counterAssistReplaceOn"
          :disabled="!teamHasCounterAssist || !applied"
          @update:checked="v => configStore.setMechanicSetting('boss.counterAssistReplace', v ? 1 : 0)"
        >
          反制支援整组替换
        </n-checkbox>
        <span>{{ counterAssistSummary }}</span>
        <n-select
          v-if="counterAssistReplaceOn && teamHasCounterAssist"
          :value="configStore.getMechanicSetting('boss.counterAssistSlot', -1)"
          :options="counterAssistSlotOptions"
          size="tiny"
          style="width: 150px"
          @update:value="v => configStore.setMechanicSetting('boss.counterAssistSlot', Number(v))"
        />
        <span v-if="foldReadout" class="ca-fold">{{ foldReadout }}</span>
      </div>
      <span v-else class="ca-label">控制技：未录入</span>
      <div v-if="applied" class="ca-editor">
        <span class="ca-label">招架段数</span>
        <span v-for="(g, i) in controlSkillGroups" :key="i" class="ca-group">
          <span class="ca-idx">组{{ i + 1 }}</span>
          <n-input-number
            :value="g"
            :min="1"
            :max="12"
            :step="1"
            size="tiny"
            :show-button="false"
            style="width: 56px"
            @update:value="v => onSegs(i, Number(v))"
          />
          <n-button size="tiny" text type="error" @click="onRemoveGroup(i)">✕</n-button>
        </span>
        <n-button size="tiny" :disabled="controlSkillGroups.length >= 8" @click="onAddGroup">＋组</n-button>
        <n-button v-if="groupsEdited" size="tiny" text type="primary" @click="onResetGroups">恢复默认</n-button>
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
import { NTag, NButton, NCheckbox, NSelect, NInputNumber } from 'naive-ui'
import { fmt, compact } from '@/utils/format'
import type { BossPreset, PhaseBossBrief, PhaseBuffEffect } from '@/types/bossPreset'
import { useConfigStore } from '@/stores/config'
import { counterAssistOf } from '@/data/counterAssists'

const props = defineProps<{
  brief: PhaseBossBrief
  preset: BossPreset | null
  applied: boolean
  compact?: boolean
}>()
const emit = defineEmits<{ apply: [] }>()

const iconFailed = ref(false)
const configStore = useConfigStore()

/**
 * 该 Boss 的控制技（紫光技）组（逐组招架段数）——**生效值**：
 * 已应用 = appliedBoss 上的活值（可被用户编辑，与引擎/折算/难度曲线同源）；
 * 未应用 = 预设默认值（展示用）。
 */
const controlSkillGroups = computed<number[]>(() =>
  props.applied
    ? (configStore.appliedBoss?.counterAssistGroups ?? [])
    : (props.preset?.defaults?.counterAssistGroups ?? []))
/** 编辑是否偏离预设默认（决定「恢复默认」按钮显隐） */
const groupsEdited = computed(() => {
  if (!props.applied) return false
  const live = configStore.appliedBoss?.counterAssistGroups ?? []
  const def = props.preset?.defaults?.counterAssistGroups ?? []
  return live.length !== def.length || live.some((v, i) => v !== def[i])
})
function commitGroups(groups: number[]) {
  configStore.setCounterAssistGroups(groups)
}
function onSegs(i: number, v: number) {
  const cur = [...(configStore.appliedBoss?.counterAssistGroups ?? [])]
  if (!Number.isFinite(v) || v <= 0) return
  cur[i] = v
  commitGroups(cur)
}
function onAddGroup() {
  commitGroups([...(configStore.appliedBoss?.counterAssistGroups ?? []), 4])
}
function onRemoveGroup(i: number) {
  const cur = [...(configStore.appliedBoss?.counterAssistGroups ?? [])]
  cur.splice(i, 1)
  commitGroups(cur)
}
function onResetGroups() {
  commitGroups([...(props.preset?.defaults?.counterAssistGroups ?? [])])
}
/** 折算读数：编辑段数/开关翻转后，弹刀侧与反制侧各得到什么（一眼核对，不用开控制台） */
const foldReadout = computed(() => {
  const applied = props.applied ? configStore.appliedBoss : null
  if (!applied) return ''
  if (counterAssistSlot.value >= 0) {
    const segs = (applied.counterAssistGroups ?? []).reduce((a, b) => a + Math.max(1, Math.floor(b)), 0)
    return `本局反制支援 ×${(applied.counterAssistGroups ?? []).length}（化解 ${segs} 段，不产弹刀）`
  }
  return `按弹刀计：正常 ${applied.parryTotal ?? 0} / 无突击 ${applied.parryNoFollowUpTotal ?? 0}`
})
/** 队内是否有带反制支援招式的角色（判据 = 数据层登记表，与引擎同源） */
const teamHasCounterAssist = computed(() => configStore.team.some(c => !!counterAssistOf(c?.agentId)))
const counterAssistReplaceOn = computed(() => configStore.getMechanicSetting('boss.counterAssistReplace', 1) !== 0)
/** 承接槽位（store 折算结果，-1 = 不替换） */
const counterAssistSlot = computed(() => configStore.counterAssistSlot)
const counterAssistSlotOptions = computed(() => [
  { label: '承接：自动', value: -1 },
  ...configStore.team
    .filter(c => !!counterAssistOf(c?.agentId))
    .map(c => ({ label: `承接：${(c.slot ?? 0) + 1}号位`, value: c.slot ?? 0 })),
])
const counterAssistSummary = computed(() => {
  const groups = controlSkillGroups.value
  if (groups.length === 0) return ''
  if (!props.applied) return '应用此 Boss 后按当前队伍折算（有反制支援角色在场 = 整组替换）'
  if (!teamHasCounterAssist.value) return `队内无反制支援角色 → ${groups.length} 组按弹刀计（每组 1 次带支援突击 + 其余无突击）`
  if (!counterAssistReplaceOn.value) return '已关 → 整组按弹刀计（并入 boss 强制弹刀总数）'
  if (counterAssistSlot.value < 0) return '开关已开但当前队伍无承接槽位'
  const name = counterAssistOf(configStore.team[counterAssistSlot.value]?.agentId)?.label ?? '反制支援'
  return `${(counterAssistSlot.value + 1)}号位以「${name}」整组化解 ${groups.length} 组（不产弹刀、不拿 215 喧响）`
})

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
  if (e.cond?.countTier) cond.push(`${e.cond.countTier.specialty}${e.cond.countTier.thresholds[0]}/${e.cond.countTier.thresholds[1]}名`)
  if (e.cond?.specialty) cond.push(`${e.cond.specialty}限定`)
  const unit = e.stat === 'anomalyProficiency' ? '点' : '%'
  const parts = [statLabelOf(e.stat), `+${e.value}${unit}`]
  if (e.targetSkillType) parts.push(`→${e.targetSkillType}`)
  if (cond.length) parts.push(`[${cond.join('，')}]`)
  return parts.join(' ')
}

const STAT_LABELS: Record<string, string> = {
  critDmg: '暴伤', critRate: '暴击率', atkPct: '攻击%', anomalyProficiency: '精通',
  anomalyDmgBonus: '异常伤', anomalyBuildUpEfficiency: '积蓄效率',
  disorderDamageBonus: '紊乱伤', anomalyReleaseDmgBonus: '异放伤', turbulenceDamageBonus: '乱流伤',
  enemyResReduction: '全减抗', enemyDefReduction: '减防',
  stunDmgMultiplierBonus: '失衡易伤', enemyDamageTakenBonus: '易伤', enemyCritDmgTakenBonus: '受暴伤',
  sheerDmgBonus: '贯穿伤', sharpDmgBonus: '锐化伤', sharpCritDmg: '锐暴', penRatio: '穿透率',
  defPct: '防御%', hpPct: '生命%', stunBuildUpBonus: '失衡值', skillDmgBonus: '招式伤', dmgBonus: '伤害',
  decibelGainEfficiency: '喧响效率', energyGainEfficiency: '能量效率', flashEnergyGainEfficiency: '闪能效率',
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

.counter-assist-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  font-size: 11px;
  flex-direction: column;
  align-items: flex-start;
}

.ca-toggle {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.ca-editor {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}

.ca-group {
  display: inline-flex;
  gap: 2px;
  align-items: center;
}

.ca-idx {
  color: var(--fg-3);
}

.ca-label {
  color: var(--fg-2);
}

.ca-fold {
  color: var(--fg-3);
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
