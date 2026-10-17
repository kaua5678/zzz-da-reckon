<template>
  <div class="position-compare">
    <n-card title="位置对比" class="compare-card">
      <p class="intro">
        本页用于回答「某个位置选谁」：同一支队伍只换该位置的角色（如击破手 诺姆 ↔ 琉音、辅助 卢西娅 ↔ 丽娜），
        按各自的预设轴跑完整局计算，横向对比该位置的贡献构成——
        ① <b>主C</b>：自身总伤拆成 直伤 / 异放 / 紊乱 / 其他异常 四块，另给 失衡值/占比 与 积蓄量/占比；
        ② <b>击破手 / 辅助</b>：总伤拆成 自身直伤 / 送连携·赠送 / 拐力(差分) / 其他 四块，另给 失衡值/占比。
        每支队伍自动匹配各自的预设轴（如琉音队用琉音转大轴）；失衡能力不单拆，效果已体现在失衡次数与总伤里。
        拐力提升 = 关掉该角色 teammate-buffs（失衡易伤/增伤/减抗等）重算的总伤差值（含拐力带来的失衡次数变化）。
        勾选多个预设队伍即可横向对比。
      </p>
      <div class="controls">
        <div class="control">
          <span class="label">位置</span>
          <n-select v-model:value="position" :options="positionOptions" size="small" style="width: 130px" />
        </div>
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
          <n-select
            v-model:value="presetGroupSel"
            :options="presetGroupOptionsC"
            size="small"
            style="width: 100px"
            placeholder="职业"
            title="一级分类：先选职业，再选属性，最后出队伍（2026-09-03 三级筛选）"
          />
          <n-select
            v-model:value="presetSubSel"
            :options="presetSubOptions"
            size="small"
            style="width: 100px"
            placeholder="属性"
            title="二级分类：该职业下的属性/体系"
          />
          <n-select
            v-model:value="selectedPresetIds"
            :options="presetFilteredOptions"
            multiple
            size="small"
            filterable
            max-tag-count="responsive"
            :fallback-option="presetLabelOf"
            style="width: 220px"
            title="筛选只决定下拉列出什么，不影响已经选中的队伍（可跨职业/属性勾选）"
          />
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
        <CustomTeamsEditor v-model:selected-ids="selectedPresetIds" />
        <div class="control">
          <span class="label">限定金</span>
          <n-input-number v-model:value="gold" :min="0" :max="20" size="small" style="width: 90px" />
        </div>
        <n-button type="primary" size="small" :loading="computing" :disabled="!canRun" @click="run">
          对比
        </n-button>
      </div>
    </n-card>

    <n-card v-if="results.length > 0" class="result-card">
      <template #header>
        <div class="result-head">
          <span>贡献构成（{{ positionLabel }}视角）</span>
          <div class="sort-control">
            <span class="label">排序</span>
            <n-select v-model:value="sortKey" :options="sortOptions" size="tiny" style="width: 120px" />
          </div>
        </div>
      </template>
      <PositionCompareChart :rows="displayRows" :is-main="isMain" :position-label="positionLabel" />
      <h4 class="detail-title">明细</h4>
      <ChartTable :columns="tableColumns" table-class="position-table chart-table-nowrap" align="right" dense>
          <tr v-for="r in displayRows" :key="r.presetId">
            <td>{{ r.presetName }}</td>
            <td>{{ r.agentName }}</td>
            <td>{{ r.stunCount }}</td>
            <td class="num">{{ fmt(r.daze) }}</td>
            <td class="num">{{ r.dazeShare.toFixed(1) }}%</td>
            <template v-if="isMain">
              <td class="num">{{ fmt(r.buildUp) }}</td>
              <td class="num">{{ r.buildUpShare.toFixed(1) }}%</td>
              <td class="num">{{ fmt(r.totalDamage) }}</td>
              <td class="num">{{ fmt(r.selfDamage) }} <span class="pct">{{ pct(r.selfDamage, r.totalDamage) }}</span></td>
              <td class="num">{{ fmt(r.directDamage) }} <span class="pct">{{ pct(r.directDamage, r.totalDamage) }}</span></td>
              <td class="num">{{ fmt(r.releaseDamage) }} <span class="pct">{{ pct(r.releaseDamage, r.totalDamage) }}</span></td>
              <td class="num">{{ fmt(r.disorderDamage) }} <span class="pct">{{ pct(r.disorderDamage, r.totalDamage) }}</span></td>
              <td class="num">{{ fmt(r.anomalyOtherDamage) }} <span class="pct">{{ pct(r.anomalyOtherDamage, r.totalDamage) }}</span></td>
            </template>
            <template v-else>
              <td class="num">{{ fmt(r.totalDamage) }}</td>
              <td class="num">{{ fmt(r.selfDamage) }} <span class="pct">{{ pct(r.selfDamage, r.totalDamage) }}</span></td>
              <td class="num">{{ fmt(r.giftDamage) }} <span class="pct">{{ pct(r.giftDamage, r.totalDamage) }}</span></td>
              <td class="num">{{ fmt(r.buffContribution) }} <span class="pct">{{ pct(r.buffContribution, r.totalDamage) }}</span></td>
              <td class="num">{{ fmt(r.otherDamage) }} <span class="pct">{{ pct(r.otherDamage, r.totalDamage) }}</span></td>
            </template>
          </tr>
      </ChartTable>
      <p class="hint">
        同款限定金数：所有参比队伍先按同一金档应用各自预设 goldSteps 再比较（公平换人边际）。
        失衡值/占比来自失衡池逐槽统计，后台自动招式（莱卡恩围猎闪反、橘福福虎威、露西、丽娜邦布、仪玄合轴等）的失衡贡献已计入。
        积蓄量/占比按「异属性赠送归接收人」口径逐槽归因（与资源池页同口径）。
        拐力提升 = 关掉该位置角色 teammate-buffs（失衡易伤/增伤/减抗等）重算的总伤差值（含拐力带来的失衡次数变化）。
        各自队伍自动匹配各自预设轴（琉音队用琉音转大轴等）。送连携 = source='gift' 行（诺姆膛温换连携/琉音好评转大等）。
      </p>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NCard, NSelect, NButton, NInputNumber } from 'naive-ui'
import { usePresetTeamPicker } from '@/composables/usePresetTeamPicker'
import { useCustomTeamsStore, resolveSelectedPresets } from '@/composables/customTeams'
import CustomTeamsEditor from '@/components/CustomTeamsEditor.vue'
import { useCatalogStore } from '@/stores/catalog'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { useBatchOwner } from '@/composables/batchTask'
import { computePositionCompare, MAIN_SPECIALTIES, type ComparePosition, type PositionCompareRow } from '@/composables/positionCompare'
import PositionCompareChart from '@/components/charts/PositionCompareChart.vue'
import ChartTable from '@/components/charts/ChartTable.vue'
import type { BossPreset } from '@/types/bossPreset'

const bossPresets = ref<BossPreset[]>([])
const selectedBossId = ref('')
const selectedPhaseId = ref('')
const { selectedPresetIds, presetGroupSel, presetSubSel, presetGroupOptionsC, presetSubOptions, presetFilteredOptions, presetLabelOf, quickPickMainC, mainCQuickOptions } = usePresetTeamPicker()  // CC-482：两级筛选 + 主C快选的状态簇，与另一比较页共用
const customTeams = useCustomTeamsStore()
/** 已选 id → 队伍（预设库 + 自定义队合并解析；同 TeamComparePage，见 customTeams#resolveSelectedPresets） */
const selectedPresets = computed(() =>
  resolveSelectedPresets(selectedPresetIds.value, customTeams.defs, customTeams.toCustomPreset),
)
const results = ref<PositionCompareRow[]>([])
const computing = ref(false)
/** 对比位置：主C / 击破手 / 辅助 */
const position = ref<ComparePosition>(1)
/** 同款限定金数：所有参比队伍按同一金档应用各自预设 goldSteps */
const gold = ref(6)

/**
 * 位置选项 = **槽位号**（T180，用户口径 2026-10-16）。
 *
 * > 「位置对比中，分的职业，但是如果**多个同职业角色在同队就不能分辨了，不智能**，
 * >   希望改成**几号位的自由对比**。」
 *
 * 原按职业（主C/击破手/辅助）+ `findPositionSlot` 取**第一个**匹配槽位
 * ⇒ 全库 **28+ 支预设队含同职业重复**（如 `auto-1541-1561-1581` 三人全是 `anomaly`）时无法选后者。
 */
const positionOptions: { value: ComparePosition; label: string }[] = [
  { value: 0, label: '1 号位' },
  { value: 1, label: '2 号位' },
  { value: 2, label: '3 号位' },
]
/**
 * 展示名 = **该号位实际是谁**（动态，不再是职业名）。
 *
 * ⚠ 各队的同一号位可能是**不同角色**（本页正是「同一号位换人对比」）⇒ 取**首行**的角色名做标题；
 * 无结果时回落号位名。
 */
const positionLabel = computed(() => {
  const opts = positionOptions.find(p => p.value === position.value)?.label ?? '号位'
  const who = results.value[0]?.agentName
  return who ? `${opts}·${who}` : opts
})
/** 该号位是否本队主C（决定是否显示伤害构成列）——按**该槽角色职业**判，与号位顺序无关 */
const isMain = computed(() => {
  const r = results.value[0]
  return !!r && MAIN_SPECIALTIES.has(useCatalogStore().getAgent(r.agentId)?.specialty ?? '')
})

type SortKey = 'order' | 'damage' | 'daze' | 'buildUp'
const sortKey = ref<SortKey>('order')
const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: 'order', label: '选择顺序' },
  { value: 'damage', label: '总伤' },
  { value: 'daze', label: '失衡占比' },
  { value: 'buildUp', label: '积蓄占比' },
]
/** 显示顺序（图与表共用；不改 results 本身，切换排序不重算） */
const displayRows = computed(() => {
  const rows = [...results.value]
  if (sortKey.value === 'order') return rows
  const field = sortKey.value === 'damage' ? 'totalDamage' : sortKey.value === 'daze' ? 'dazeShare' : 'buildUpShare'
  return rows.sort((a, b) => b[field] - a[field])
})

/** 明细表列：主C/非主C两套；表头从 markup 移到数据，单元格仍由 slot 给 */
const tableColumns = computed(() => {
  const cols = [
    { key: 'preset', label: '队伍' },
    { key: 'agent', label: positionLabel.value },
    { key: 'stun', label: '失衡次数' },
    { key: 'daze', label: '失衡值' },
    { key: 'dazeShare', label: '失衡占比' },
  ]
  if (isMain.value) {
    cols.push(
      { key: 'buildUp', label: '积蓄量' },
      { key: 'buildUpShare', label: '积蓄占比' },
      { key: 'total', label: '总伤' },
      { key: 'self', label: '主C自身' },
      { key: 'direct', label: '直伤' },
      { key: 'release', label: '异放' },
      { key: 'disorder', label: '紊乱' },
      { key: 'anomaly', label: '其他异常' },
    )
  } else {
    cols.push(
      { key: 'total', label: '总伤' },
      { key: 'self', label: '自身' },
      { key: 'gift', label: '送连携/赠送' },
      { key: 'buff', label: '拐力提升(差分)' },
      { key: 'other', label: '其他' },
    )
  }
  return cols
})

onMounted(async () => {
  try {
    const data = await useCatalogStore().loadBossPresets()
    bossPresets.value = data.bosses ?? []
    if (bossPresets.value.length > 0) selectedBossId.value = bossPresets.value[0].id
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
const canRun = computed(() => selectedPresetIds.value.length >= 1 && selectedBoss.value && selectedPhase.value)

/** 批任务归属（S4，CC-343）：重算吊销上一次，离开页面也吊销 */
const owner = useBatchOwner()

async function run() {
  if (!canRun.value) return
  const presets = selectedPresets.value
  const boss = selectedBoss.value!
  const phase = selectedPhase.value!
  const run = owner.start()
  computing.value = true
  try {
    // useResourceCalc 的 load 是 fire-and-forget：先显式等 catalog/teammateBuffs 就绪，
    // 否则 teammateBuffGroups 为空 → 面板缺拐力 → 差分恒 0（此前页面显示拐力 0 的根因）
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const res = await withAnalysisScenario(scenario => computePositionCompare(scenario, presets, boss, phase, { gold: gold.value, position: position.value }))
    run.commit(() => { results.value = res })
  } finally {
    run.commit(() => { computing.value = false })
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
.position-compare {
  padding: 16px;
  max-width: 1200px;
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
  color: var(--fg-2);
  line-height: 1.8;
  margin: 0 0 12px;
  padding: 10px 12px;
  background: var(--wa-40);
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
.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.sort-control {
  display: flex;
  align-items: center;
  gap: 6px;
}
.detail-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-2);
  margin: 0 0 8px;
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
