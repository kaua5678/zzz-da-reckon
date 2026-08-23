<template>
  <div class="breaker-compare">
    <n-card title="击破手对比" class="compare-card">
      <p class="intro">
        本页用于回答「击破手这个位置选谁」：同一支队伍只换击破手（如诺姆 ↔ 琉音），
        按各自的预设轴跑完整局计算，把总伤拆成四块对比——
        ① 击破手自身直伤；② 送连携/赠送（诺姆膛温换连携、琉音好评转大等白送动作）；
        ③ 拐力提升（差分重算：关掉该击破手的 teammate-buffs 后重算总伤，差值即拐力贡献，
        含失衡易伤/增伤/减抗及其带来的失衡次数变化）；④ 其他（队友伤害等）。
        每支队伍自动匹配各自的预设轴（如琉音队用琉音转大轴）；失衡能力不单拆，
        效果已体现在失衡次数与总伤里。勾选多个预设队伍即可横向对比。
      </p>
      <div class="controls">
        <div class="control">
          <span class="label">Boss</span>
          <n-select v-model:value="selectedBossId" :options="bossOptions" size="small" style="width: 200px" />
        </div>
        <div class="control">
          <span class="label">期数</span>
          <n-select v-model:value="selectedPhaseId" :options="phaseOptions" size="small" style="width: 220px" />
        </div>
        <div class="control">
          <span class="label">预设队伍（各自自动轴）</span>
          <n-select v-model:value="selectedPresetIds" :options="presetOptions" multiple size="small" style="width: 320px" />
          <n-select
            v-model:value="quickPickMainC"
            :options="mainCQuickOptions"
            size="small"
            style="width: 130px"
            placeholder="按主C快选"
            title="选择主C → 勾选替换为仅含该主C的队伍（其他主C的队伍移除）"
            clearable
          />
        </div>
        <div class="control">
          <span class="label">限定金</span>
          <n-input-number v-model:value="gold" :min="0" :max="20" size="small" style="width: 90px" />
        </div>
        <n-button type="primary" size="small" :loading="computing" :disabled="!canRun" @click="run">
          对比
        </n-button>
      </div>
    </n-card>

    <n-card v-if="results.length > 0" class="result-card" title="总伤构成（击破手视角）">
      <n-table :bordered="true" size="small">
        <thead>
          <tr>
            <th>队伍</th>
            <th>击破手</th>
            <th>失衡次数</th>
            <th>失衡值</th>
            <th>失衡占比</th>
            <th>总伤</th>
            <th>击破手自身</th>
            <th>送连携/赠送</th>
            <th>拐力提升(差分)</th>
            <th>其他</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in results" :key="r.presetId">
            <td>{{ r.presetName }}</td>
            <td>{{ r.breakerName }}</td>
            <td>{{ r.stunCount }}</td>
            <td class="num">{{ fmt(r.breakerDaze) }}</td>
            <td class="num">{{ r.dazeShare.toFixed(1) }}%</td>
            <td class="num">{{ fmt(r.totalDamage) }}</td>
            <td class="num">{{ fmt(r.selfDamage) }} <span class="pct">{{ pct(r.selfDamage, r.totalDamage) }}</span></td>
            <td class="num">{{ fmt(r.giftDamage) }} <span class="pct">{{ pct(r.giftDamage, r.totalDamage) }}</span></td>
            <td class="num">{{ fmt(r.buffContribution) }} <span class="pct">{{ pct(r.buffContribution, r.totalDamage) }}</span></td>
            <td class="num">{{ fmt(r.otherDamage) }} <span class="pct">{{ pct(r.otherDamage, r.totalDamage) }}</span></td>
          </tr>
        </tbody>
      </n-table>
      <p class="hint">
        同款限定金数：所有参比队伍先按同一金档应用各自预设 goldSteps 再比较（公平换人边际）。
        失衡值/占比来自失衡池逐槽统计，后台自动招式（莱卡恩围猎闪反、橘福福虎威、露西、丽娜邦布、仪玄合轴等）的失衡贡献已计入。
        拐力提升 = 关掉该击破手 teammate-buffs（失衡易伤/增伤/减抗等）重算的总伤差值（含拐力带来的失衡次数变化）。
        各自队伍自动匹配各自预设轴（琉音队用琉音转大轴等）。送连携 = source='gift' 行（诺姆膛温换连携/琉音好评转大等）。
      </p>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NCard, NSelect, NButton, NTable, NInputNumber } from 'naive-ui'
import { teamPresets, teamPresetGroupOptions } from '@/data/teamPresets'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computeBreakerCompare, type BreakerBreakdown } from '@/composables/breakerCompare'
import type { BossPreset } from '@/types/bossPreset'
import type { TeamPreset } from '@/types/teamPreset'

interface BossPresetFile {
  bosses: BossPreset[]
  phaseViews: unknown[]
}

const bossPresets = ref<BossPreset[]>([])
const catalogStore = useCatalogStore()
const selectedBossId = ref('')
const selectedPhaseId = ref('')
const selectedPresetIds = ref<string[]>([])
const results = ref<BreakerBreakdown[]>([])
const computing = ref(false)
/** 同款限定金数：所有参比队伍按同一金档应用各自预设 goldSteps */
const gold = ref(6)

onMounted(async () => {
  try {
    const res = await fetch('/static/boss-presets.json')
    if (res.ok) {
      const data = (await res.json()) as BossPresetFile
      bossPresets.value = data.bosses ?? []
      if (bossPresets.value.length > 0) selectedBossId.value = bossPresets.value[0].id
    }
  } catch { /* 忽略 */ }
})

const selectedBoss = computed(() => bossPresets.value.find(b => b.id === selectedBossId.value) ?? null)
const bossOptions = computed(() => bossPresets.value.map(b => ({ value: b.id, label: b.name })))
const phaseOptions = computed(() =>
  (selectedBoss.value?.phases ?? []).map(p => ({ value: p.phaseId, label: `${p.label} · ${p.stageName}` })),
)
const selectedPhase = computed(() =>
  selectedBoss.value?.phases.find(p => p.phaseId === selectedPhaseId.value)
  ?? selectedBoss.value?.phases[0] ?? null,
)
/** 两级下拉：一级分类（如 命破队）→ 二级队伍 */
const presetOptions = teamPresetGroupOptions
const canRun = computed(() => selectedPresetIds.value.length >= 1 && selectedBoss.value && selectedPhase.value)
/** 按主C快选 */
const quickPickMainC = ref<string | null>(null)
const mainCQuickOptions = computed(() => {
  const seen = new Map<string, string>()
  for (const t of teamPresets) {
    const main = t.team[0]
    if (!seen.has(main)) seen.set(main, catalogStore.getAgent(main)?.name.zhCN ?? main)
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label }))
})
watch(quickPickMainC, main => {
  if (!main) return
  selectedPresetIds.value = teamPresets.filter(t => t.team[0] === main).map(t => t.id)
})

async function run() {
  if (!canRun.value) return
  const presets = teamPresets.filter(p => selectedPresetIds.value.includes(p.id))
  const boss = selectedBoss.value!
  const phase = selectedPhase.value!
  computing.value = true
  try {
    // useResourceCalc 的 load 是 fire-and-forget：先显式等 catalog/teammateBuffs 就绪，
    // 否则 teammateBuffGroups 为空 → 面板缺拐力 → 差分恒 0（此前页面显示拐力 0 的根因）
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const calc = useResourceCalc()
    results.value = computeBreakerCompare(calc, presets, boss, phase, { gold: gold.value })
  } finally {
    computing.value = false
  }
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString()
}
function pct(part: number, total: number): string {
  if (total <= 0) return ''
  return `(${((part / total) * 100).toFixed(1)}%)`
}
</script>

<style scoped>
.breaker-compare {
  padding: 16px;
  max-width: 1100px;
  margin: 0 auto;
}
.controls {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}
.intro {
  font-size: 13px;
  color: #666;
  line-height: 1.8;
  margin: 0 0 12px;
  padding: 10px 12px;
  background: rgba(128, 128, 128, 0.06);
  border-radius: 6px;
}
.control {
  display: flex;
  align-items: center;
  gap: 6px;
}
.label {
  font-size: 13px;
  color: #888;
  white-space: nowrap;
}
.result-card {
  margin-top: 16px;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.pct {
  color: #888;
  font-size: 12px;
  margin-left: 4px;
}
.hint {
  font-size: 12px;
  color: #888;
  margin-top: 12px;
  line-height: 1.6;
}
</style>
