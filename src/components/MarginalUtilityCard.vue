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
import { ref, computed } from 'vue'
import { NCard, NButton } from 'naive-ui'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { fmt } from '@/utils/format'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
const { teamTotalDamage } = useResourceCalc()

const hasTeam = computed(() => configStore.team.some(c => !!c.agentId))
const computing = ref(false)
const results = ref<{ label: string; damage: number; pct: number; isCurrent: boolean }[]>([])

/** 主词条候选列表 */
const SLOT_CANDIDATES: Record<number, string[]> = {
  4: ['anomalyProficiency', 'atkPct', 'critRate', 'critDmg'],
  5: ['penRatio', 'atkPct', 'physicalDmg', 'fireDmg', 'iceDmg', 'electricDmg', 'etherDmg', 'windDmg'],
  6: ['atkPct', 'anomalyMastery', 'energyRegen', 'impact'],
}

const STAT_LABELS: Record<string, string> = {
  anomalyProficiency: '精通', atkPct: '攻击%', critRate: '暴击率', critDmg: '暴伤',
  penRatio: '穿透率', physicalDmg: '物理增伤', fireDmg: '火增伤', iceDmg: '冰增伤',
  electricDmg: '电增伤', etherDmg: '以太增伤', windDmg: '风增伤',
  anomalyMastery: '异常掌控', energyRegen: '能量回复', impact: '冲击力',
}
function statLabel(s: string) { return STAT_LABELS[s] ?? s }

/** 元素增伤 statId → agent damageElement 映射（5号位筛选用） */
const ELEMENT_DMG_TO_AGENT: Record<string, string> = {
  physicalDmg: 'physical', fireDmg: 'fire', iceDmg: 'ice',
  electricDmg: 'electric', etherDmg: 'ether', windDmg: 'wind', lumifluxDmg: 'lumiflux',
}

async function run() {
  computing.value = true
  results.value = []

  // 收集所有需要测试的候选
  interface Candidate { slot: number; statId: string; label: string }
  const candidates: Candidate[] = []

  for (let slot = 0; slot < 3; slot++) {
    const char = configStore.team[slot]
    if (!char?.agentId) continue
    const disc = char.driveDisc
    if (!disc?.mainStats) continue
    const agent = catalogStore.getAgent(char.agentId)
    const agentElement = agent?.damageElement

    for (const [slotNum, opts] of Object.entries(SLOT_CANDIDATES)) {
      const sn = Number(slotNum)
      const current = disc.mainStats[sn as 4 | 5 | 6] as string
      for (const statId of opts) {
        if (statId === current) continue
        // 5号位元素增伤：只保留与该角色 damageElement 匹配的
        if (sn === 5 && ELEMENT_DMG_TO_AGENT[statId] && agentElement && ELEMENT_DMG_TO_AGENT[statId] !== agentElement) continue
        candidates.push({ slot, statId, label: `槽${slot+1} #${slotNum} → ${statLabel(statId)}` })
      }
    }
  }

  // 记录当前各 slot 原值，用于恢复
  const originals: { slot: number; slotNum: number; stat: string }[] = []
  for (let slot = 0; slot < 3; slot++) {
    const disc = configStore.team[slot]?.driveDisc
    if (!disc?.mainStats) continue
    for (const sn of [4, 5, 6] as const) {
      originals.push({ slot, slotNum: sn, stat: disc.mainStats[sn] as string || '' })
    }
  }

  // 当前伤害基准
  await new Promise(r => setTimeout(r, 0))
  const baseDamage = teamTotalDamage.value

  const allResults = [...candidates.map(c => ({ ...c, damage: 0, pct: 0, isCurrent: false }))]

  try {
    for (const c of allResults) {
      const disc = configStore.team[c.slot]?.driveDisc
      if (!disc?.mainStats) continue
      const slotNum = Number(c.label.match(/#(\d)/)?.[1]) as 4 | 5 | 6
      if (!slotNum) continue
      disc.mainStats[slotNum] = c.statId as any
      await new Promise(r => setTimeout(r, 0))
      c.damage = teamTotalDamage.value
      c.pct = baseDamage > 0 ? ((c.damage - baseDamage) / baseDamage) * 100 : 0
    }
  } finally {
    // 恢复原值
    for (const o of originals) {
      const disc = configStore.team[o.slot]?.driveDisc
      if (disc?.mainStats) disc.mainStats[o.slotNum as 4 | 5 | 6] = o.stat as any
    }
    await new Promise(r => setTimeout(r, 0))
    computing.value = false
  }

  // 按收益降序，当前配置标出
  results.value = [
    { label: '当前配置', damage: baseDamage, pct: 0, isCurrent: true },
    ...allResults.sort((a, b) => b.pct - a.pct),
  ]
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
