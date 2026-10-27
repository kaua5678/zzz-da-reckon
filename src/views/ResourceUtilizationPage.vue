<template>
  <div class="resource-util-page">
    <div v-if="!hasTeam" class="placeholder">
      <div class="placeholder-title">请先配置队伍</div>
      <div class="placeholder-desc">选择角色后，这里会列出可调的招式 ID 和事件 ID。</div>
    </div>

    <template v-else>
      <n-card size="small" class="intro-card" :bordered="true">
        <template #header>资源利用率</template>
        <div class="intro-text">
          资源池先计算理论上限，再用本页的释放率和次数上限折算最终进入失衡、积蓄和事件表的次数。默认 100% 且不封顶，表示“回复多少资源都能用完”。
        </div>
        <div class="intro-actions">
          <n-button size="small" type="warning" secondary @click="configStore.resetResourceUtilization()">清空全部覆盖</n-button>
        </div>
      </n-card>

      <n-card v-for="setting in mechanicSettings" :key="setting.id" size="small" class="mechanic-card" :bordered="true">
        <template #header>{{ setting.label }}</template>
        <div class="mechanic-row">
          <div class="mechanic-copy">
            <div class="field-desc">{{ setting.description }}</div>
          </div>
          <n-input-number
            :value="settingDisplayValue(setting)"
            size="small"
            :min="settingMin(setting)"
            :max="settingMax(setting)"
            :step="settingStep(setting)"
            :suffix="setting.suffix"
            @update:value="v => updateMechanicSetting(setting, v)"
          />
        </div>
      </n-card>

      <n-card v-if="remielleDropSetting" size="small" class="mechanic-card" :bordered="true">
        <template #header>{{ remielleDropSetting.drop.title }}</template>
        <div class="field-desc" style="margin-bottom: 8px">
          {{ remielleDropSetting.drop.note }}
        </div>
        <div v-for="tm in remielleDropSetting.teammates" :key="tm.slot" class="mechanic-row">
          <div class="mechanic-copy">
            <div class="field-title">{{ tm.name }} · 共 {{ tm.total }} 次异常</div>
            <div class="field-desc">
              丢弃 {{ tm.dropped }} 次 ⇒ 参与 {{ Math.max(0, tm.total - tm.dropped) }} 次
            </div>
          </div>
          <n-input-number
            :value="tm.dropped"
            size="small"
            :min="0"
            :max="tm.total"
            :step="1"
            :suffix="remielleDropSetting.drop.suffix"
            @update:value="v => remielleDropSetting && configStore.setTeamMechanicSetting(`${remielleDropSetting.drop.settingPrefix}:${tm.slot}`, Math.max(0, Math.min(tm.total, Math.floor(v ?? 0))))"
          />
        </div>
      </n-card>

      <n-card v-if="burniceReleaseElements" size="small" class="mechanic-card" :bordered="true">
        <template #header>{{ burniceReleaseElements.label }}元素分配</template>
        <div v-if="burniceReleaseElements.elements.length === 0" class="field-desc">
          当前没有异常覆盖，异放按火属性兜底。
        </div>
        <div v-else class="release-share-block">
          <div v-for="item in burniceReleaseElements.elements" :key="item.element" class="release-share-row">
            <div class="mechanic-copy">
              <div class="field-title">{{ item.label }} · 覆盖 {{ (item.autoRatio * 100).toFixed(1) }}%</div>
              <div class="field-desc">默认按异常覆盖时间占比分配异放次数；可手动调整。</div>
            </div>
            <n-input-number
              :value="Math.round(item.userValue * 100)"
              size="small"
              :min="0"
              :max="100"
              :step="5"
              suffix="%"
              @update:value="v => configStore.setMechanicSetting(`${burniceReleaseElements!.namespace}.releaseShare:${item.element}`, (v ?? 0) / 100)"
            />
          </div>
        </div>
      </n-card>

      <n-card v-if="windInfectionConfig" size="small" class="mechanic-card" :bordered="true">
        <template #header>风化浸染（侵染区）</template>
        <div class="mechanic-row">
          <div class="mechanic-copy">
            <div class="field-desc">风化状态下，风属性与被染队友属性的直伤吃独立乘区；默认按风化覆盖率折算，可手动调整。</div>
          </div>
          <n-input-number
            :value="Math.round((windInfectionConfig?.coverage ?? 0) * 100)"
            size="small"
            :min="0"
            :max="100"
            :step="5"
            suffix="%"
            @update:value="(v: number | null) => configStore.setMechanicSetting('wind.infectionCoverage', (v ?? Math.round((windInfectionConfig?.autoRate ?? 0) * 100)) / 100)"
          />
        </div>
        <div class="mechanic-row">
          <div class="mechanic-copy">
            <div class="field-desc">选择被浸染强化的队友属性；默认优先非支援/防护、非蕾米埃尔。</div>
          </div>
          <n-select
            :value="windInfectionConfig?.targetSlot ?? -1"
            size="small"
            style="width:170px"
            :options="[
              { label: '自动', value: -1 },
              ...(windInfectionConfig?.candidates ?? [])
                .filter(x => x.slot !== windInfectionConfig?.windSlot)
                .map(x => ({ label: `${x.name}（${elementLabel(x.element)}）`, value: x.slot })),
            ]"
            @update:value="(v: number | null) => configStore.setMechanicSetting('wind.infectionTargetSlot', v ?? -1)"
          />
        </div>
      </n-card>

      <n-card v-if="anomalyVirtualPanels.length > 0" size="small" class="mechanic-card" :bordered="true">
        <template #header>异常结算角色占比</template>
        <div v-for="vp in anomalyVirtualPanels" :key="vp.element" class="settlement-block">
          <div class="settlement-title">{{ elementLabel(vp.element) }}异常结算</div>
          <div class="settlement-note">只有同属性角色会进入结算配比；异属性角色即使通过赋彩等机制贡献积蓄，也只计入虚拟面板，不作为结算者。</div>
          <div v-for="row in settlementRows(vp)" :key="row.slot" class="settlement-row">
            <div class="settlement-copy">
              <span class="field-title">{{ row.name }} · {{ row.triggerCount ?? '?' }}/{{ vpTotalTriggers(vp) }}次 · {{ row.displayShare }}</span>
              <span class="field-desc">
                异常增伤 {{ fmt(row.anomalyDmgBonus, 1) }}% · 异常暴击 {{ fmt(row.anomalyCritRate, 1) }}%/{{ fmt(row.anomalyCritDmg, 1) }}%
                · 强击暴击 {{ fmt(row.assaultCritRate, 1) }}%/{{ fmt(row.assaultCritDmg, 1) }}%
                · 减防 {{ fmt(row.enemyAnomalyDefReduction, 1) }}%+{{ fmt(row.enemyAssaultDefReduction, 1) }}%
                · 减抗 {{ fmt(row.enemyResReduction, 1) }}%+{{ fmt(row.elementResReduction, 1) }}%
              </span>
            </div>
            <n-input-number
              v-if="settlementRows(vp).length > 1"
              :value="(configStore.getAnomalySettlementShare(vp.element, row.slot) ?? row.weight) * 100"
              size="small"
              :min="0"
              :max="100"
              :step="5"
              suffix="%"
              @update:value="v => configStore.setAnomalySettlementShare(vp.element, row.slot, (v ?? 0) / 100)"
            />
          </div>
        </div>
      </n-card>


      <n-card v-for="group in rowGroups" :key="group.slot" size="small" class="char-card" :bordered="true">
        <template #header>
          <div class="card-header">
            <span>{{ group.name }}</span>
            <n-button size="tiny" quaternary type="warning" @click="configStore.resetResourceUtilization(group.slot)">重置本角色</n-button>
          </div>
        </template>

        <div class="anomaly-util-row">
          <span>异常积蓄利用率</span>
          <n-input-number
            :value="configStore.getAnomalyUtilizationRate(group.slot) * 100"
            size="small"
            :min="0"
            :max="100"
            :step="5"
            suffix="%"
            @update:value="v => configStore.setAnomalyUtilizationRate(group.slot, (v ?? 100) / 100)"
          />
        </div>

        <div v-if="group.rows.length === 0" class="empty-note">当前没有可调招式或事件。</div>
        <div v-else class="util-table">
          <div class="util-row util-head">
            <span>类型</span>
            <span>名称</span>
            <span>ID</span>
            <span>当前次数</span>
            <span>释放率</span>
            <span>次数上限</span>
            <span>操作</span>
          </div>
          <div v-for="row in group.rows" :key="row.kind + row.id" class="util-row">
            <span class="kind-chip">{{ row.kindLabel }}</span>
            <span class="name-cell">{{ row.name }}</span>
            <code class="id-cell">{{ row.id }}</code>
            <span>{{ fmt(row.count, 2) }}</span>
            <n-input-number
              class="num-input"
              :value="getRate(group.slot, row.id) * 100"
              size="small"
              :min="0"
              :max="100"
              :step="5"
              suffix="%"
              @update:value="v => setRate(group.slot, row.id, v)"
            />
            <n-input-number
              class="num-input"
              :value="getCap(group.slot, row.id)"
              size="small"
              :min="0"
              :step="1"
              placeholder="不封顶"
              clearable
              @update:value="v => setCap(group.slot, row.id, v)"
            />
            <n-button size="tiny" quaternary @click="configStore.resetResourceUtilization(group.slot, row.id)">重置</n-button>
          </div>
        </div>
      </n-card>

    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NCard, NInputNumber, NSelect } from 'naive-ui'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import type { AnomalyVirtualPanelBuild, AnomalyVirtualPanelRow } from '@/composables/resourceCalc/anomalyPanels'
import type { AnomalyProgress } from '@/types/resource'
import { fmt } from '@/utils/format'
import { panelElementStat } from '@/utils/elementStatKeys'
import { damageElementLabel as elementLabel } from '@/utils/agentLabelMaps'
import { teamMechanicSettings, teamReleaseShares, teamTeammateDrop } from '@/composables/agentMechanicView'
import { resolveWindInfectionPick, getWindInfectionCoverage, buildAnomalySettlementEntries } from '@/composables/resourceCalc/anomalyPanels'
import type { TeammateDropDecl } from '@/composables/agentMechanicView'
import type { MechanicSetting } from '@/types/resource'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
const { resourceResult, anomalyVirtualPanels, anomalyPoolResult, panels } = useResourceCalc()
// 按需计算的分析卡（命座提升率 / 伤害影响与响应面 / 副词条收益曲线 / 副词条评分 / 边际效用）
// 2026-10-28 移到「收益分析」页（UpliftAnalysisPage.vue）——它们不写计算输入，不是利用率调整。

// 元素减抗 key 映射（从 useResourceCalc 复制）



const hasTeam = computed(() => configStore.team.some(c => !!c.agentId))

// CC-47：经编排层门面读模块声明（判据 7：展示层不直接 import '@/mechanics'）
const mechanicSettings = computed<MechanicSetting[]>(() => teamMechanicSettings(configStore.team))

// 2026-10-18 用户口径：Q 分配滑块（只控制大招那 3 个）改成「每个队友可丢弃 N 次异常」——
// 丢弃后的剩余次数进模块的细致分配算法，轮数/子弹归属/浪费量全部自动跟着算。
const remielleDropSetting = computed<{
  slot: number
  drop: TeammateDropDecl
  teammates: { slot: number; name: string; total: number; dropped: number }[]
} | null>(() => {
  const found = teamTeammateDrop(configStore.team, id => catalogStore.getAgent(id))
  if (!found) return null
  const { slot: remielleSlot, drop } = found
  const triggers = anomalyPoolResult.value?.perSlotAnomalyTriggers ?? []
  const teammates = [0, 1, 2]
    .filter(slot => slot !== remielleSlot)
    .map(slot => {
      const char = configStore.team[slot]
      const id = char?.agentId ?? ''
      return {
        slot,
        name: id ? (catalogStore.getAgent(id)?.name?.zhCN || id) : `槽${slot + 1}`,
        total: Math.max(0, Math.floor(triggers[slot] ?? 0)),
        dropped: Math.max(0, Math.floor(configStore.getTeamMechanicSetting(`${drop.settingPrefix}:${slot}`, 0))),
      }
    })
  return { slot: remielleSlot, drop, teammates }
})

// CC-55：原按写死的柏妮思 ID 1171 查找，改为查模块声明 releaseShare（agentMechanicView#teamReleaseShares）。
// 只取第一个声明（现唯一声明 = 柏妮思），卡片形态不变；多声明时如何展示见 census §5.62 未决项。
const burniceReleaseElements = computed<{
  namespace: string
  label: string
  elements: { element: string; label: string; autoRatio: number; userValue: number }[]
} | null>(() => {
  const decl = teamReleaseShares(configStore.team, id => catalogStore.getAgent(id))[0]
  if (!decl) return null
  const coverage = anomalyPoolResult.value?.coverage?.perElementCoverageRate ?? {}
  const elements = Object.entries(coverage)
    .filter(([, rate]) => rate > 0)
    .map(([element, autoRatio]) => ({
      element,
      label: elementLabel(element),
      autoRatio,
      userValue: configStore.getMechanicSetting(`${decl.namespace}.releaseShare:${element}`, autoRatio),
    }))
  return { namespace: decl.namespace, label: decl.label, elements }
})

// ⚠ `janePassionSlot` 手写卡片已删（2026-09-20 round 51，用户裁决）：`jane.passionCoverage`
// 已注册成 MechanicSetting（`jane.ts#settings`）⇒ 上面的 `mechanicSettings` 泛型渲染器
// 会自动为它出控件。手写卡片 + 泛型控件会**双滑块**（同一 setting 两个入口），故删卡片。

// CC-304：挑槽（风角色 / 自动 / 生效）与覆盖率（含 [0,1] 夹取）读引擎同一实现 `anomalyPanels#resolveWindInfectionPick` /
// `getWindInfectionCoverage`；原在此逐字复制挑槽规则（排除名单还按 teammateBuffId 别名判，与引擎按 agentId 判不同源）。
const windInfectionConfig = computed<{
  autoRate: number
  coverage: number
  candidates: { slot: number; name: string; element: string }[]
  windSlot: number
  autoSlot: number
  targetSlot: number
} | null>(() => {
  const pick = resolveWindInfectionPick(configStore, catalogStore)
  if (!pick) return null
  const autoRate = anomalyPoolResult.value?.coverage?.windCoverageRate ?? 0
  const coverage = getWindInfectionCoverage(configStore, autoRate)
  // 下拉候选（纯展示）：有属性的队友
  const candidates = configStore.team
    .map((char, slot) => {
      const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
      return {
        slot,
        name: agent?.name?.zhCN || char.agentId || `槽${slot + 1}`,
        element: agent?.damageElement ?? '',
      }
    })
    .filter(x => !!x.element)
  return { autoRate, coverage, candidates, windSlot: pick.windSlot, autoSlot: pick.autoSlot, targetSlot: pick.targetSlot }
})

function settlementRows(vp: AnomalyVirtualPanelBuild) {
  // CC-428：份额 / 次数直读引擎 buildAnomalySettlementEntries（同属性筛选、单人 100%、用户覆盖、归一化、余数补正全在那一处）。
  // 此前页面按 row.weight 自算 round(share × total)：用户改了份额后显示不变、也不归一，与实际结算分叉。
  // 分母用积蓄池的触发总数（伤害侧另按风化阻断折成 effectiveTriggerCount，那是伤害口径，这里展示配比）。
  const entries = buildAnomalySettlementEntries(vp, panels.value, vpTotalTriggers(vp), configStore, catalogStore, { keepZero: true })
  const isSingle = entries.length === 1
  return entries.map(e => {
    const row = vp.rows.find((r: AnomalyVirtualPanelRow) => r.slot === e.slot)
    const panel = e.panel
    return {
      slot: e.slot,
      name: e.name,
      /** 份额输入框的缺省值（无用户覆盖时 = 引擎展示权重） */
      weight: row?.weight ?? e.share,
      displayShare: isSingle ? '100%' : `${(e.share * 100).toFixed(1)}%`,
      triggerCount: e.triggerCount,
      anomalyDmgBonus: panel.anomalyDmgBonus ?? 0,
      anomalyCritRate: panel.anomalyCritRate ?? 0,
      anomalyCritDmg: panel.anomalyCritDmg ?? 0,
      assaultCritRate: panel.assaultCritRate ?? 0,
      assaultCritDmg: panel.assaultCritDmg ?? 0,
      enemyAnomalyDefReduction: panel.enemyAnomalyDefReduction ?? 0,
      enemyAssaultDefReduction: panel.enemyAssaultDefReduction ?? 0,
      enemyResReduction: panel.enemyResReduction ?? 0,
      elementResReduction: panelElementStat(panel, 'enemyRes', vp.element),
    }
  })
}

function vpTotalTriggers(vp: AnomalyVirtualPanelBuild): number {
  const prog = anomalyPoolResult.value?.perElement?.find((p: AnomalyProgress) => p.element === vp.element)
  return prog?.triggerCount ?? 0
}


function settingDisplayValue(setting: MechanicSetting): number {
  const raw = configStore.getMechanicSetting(setting.id, setting.default)
  return setting.suffix === '%' ? raw * 100 : raw
}

function updateMechanicSetting(setting: MechanicSetting, value: number | null): void {
  const next = value ?? setting.default
  configStore.setMechanicSetting(setting.id, setting.suffix === '%' ? next / 100 : next)
}

function settingMin(setting: MechanicSetting): number {
  return setting.suffix === '%' ? (setting.min ?? 0) * 100 : (setting.min ?? 0)
}

function settingMax(setting: MechanicSetting): number {
  return setting.suffix === '%' ? (setting.max ?? 100) * 100 : (setting.max ?? 100)
}

function settingStep(setting: MechanicSetting): number {
  return setting.suffix === '%' ? (setting.step ?? 1) * 100 : (setting.step ?? 1)
}

const rowGroups = computed(() => {
  return configStore.team
    .map((char, slot) => {
      const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
      const result = resourceResult.value?.characters.find(c => c.slot === slot)
      const actionRows = (result?.executions ?? [])
        .filter(exec => exec.moveId && exec.moveId !== 'basic_attack')
        .map(exec => ({
          kind: 'action',
          kindLabel: '招式',
          id: exec.moveId,
          name: exec.moveName,
          count: exec.count,
        }))
      const eventRows = (result?.anomalyEventExecutions ?? [])
        .filter(event => !!event.eventId)
        .map(event => ({
          kind: 'event',
          kindLabel: '事件',
          id: event.eventId,
          name: event.eventName,
          count: event.count,
        }))
      return {
        slot,
        name: agent?.name?.zhCN || agent?.name?.en || `槽位 ${slot + 1}`,
        rows: [...actionRows, ...eventRows],
      }
    })
    .filter(group => !!configStore.team[group.slot]?.agentId)
})

function getRule(slot: number, id: string) {
  return configStore.getResourceUtilization(slot, id)
}

function getRate(slot: number, id: string): number {
  return getRule(slot, id).rate ?? 1
}

function getCap(slot: number, id: string): number | null {
  return getRule(slot, id).cap ?? null
}

function setRate(slot: number, id: string, value: number | null) {
  configStore.setResourceUtilization(slot, id, { rate: (value ?? 100) / 100 })
}

function setCap(slot: number, id: string, value: number | null) {
  configStore.setResourceUtilization(slot, id, { cap: value })
}
</script>

<style scoped>
.resource-util-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.placeholder {
  padding: 80px 0;
  text-align: center;
  color: var(--wa-550);
}

.placeholder-title {
  font-size: 18px;
  color: var(--wa-820);
  margin-bottom: 8px;
}

.intro-card,
.mechanic-card,
.char-card {
  background: var(--wa-30);
}

.intro-text,
.field-desc,
.empty-note {
  color: var(--wa-620);
  font-size: 13px;
  line-height: 1.7;
}

.intro-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.mechanic-row,
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.field-title {
  color: var(--wa-900);
  font-weight: 600;
  margin-bottom: 4px;
}

.anomaly-util-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  margin-bottom: 10px;
  border-radius: 6px;
  background: var(--wa-35);
  color: var(--wa-780);
  font-size: 13px;
}

.settlement-block {
  margin-top: 10px;
}

.settlement-title {
  margin-bottom: 8px;
  color: var(--wa-850);
  font-weight: 600;
}

.settlement-note {
  margin-bottom: 8px;
  color: rgba(251, 191, 36, 0.75);
  font-size: 12px;
}

.settlement-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  margin-bottom: 6px;
  border-radius: 6px;
  background: var(--wa-35);
}

.settlement-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.release-share-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.release-share-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--wa-35);
}

.util-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.util-row {
  display: grid;
  grid-template-columns: 64px minmax(180px, 1.3fr) minmax(160px, 1fr) 88px 132px 132px 64px;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--wa-35);
  color: var(--wa-780);
  font-size: 12px;
}

.util-head {
  background: var(--wa-70);
  color: var(--fg-2);
  font-weight: 600;
}

.kind-chip {
  color: var(--c-info);
}

.name-cell {
  color: var(--wa-880);
}

.id-cell {
  color: #c4b5fd;
  font-size: 11px;
  word-break: break-all;
}

.num-input {
  width: 124px;
}
</style>
