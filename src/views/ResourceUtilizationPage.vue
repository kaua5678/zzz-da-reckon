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
          <n-button size="small" type="primary" secondary @click="configStore.triggerRefresh">刷新当前列表</n-button>
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

      <n-card v-if="remielleQSetting" size="small" class="mechanic-card" :bordered="true">
        <template #header>蕾米 Q 耀变分配</template>
        <div class="mechanic-row">
          <div class="mechanic-copy">
            <div class="field-title">{{ remielleQSetting?.firstName }} 提供虚耀</div>
            <div class="field-desc">
              Q 每次固定打 3 个耀变；剩余 {{ 3 - (remielleQSetting?.firstCount ?? 1) }} 个由 {{ remielleQSetting?.secondName }} 提供。
            </div>
          </div>
          <n-input-number
            :value="remielleQSetting?.firstCount ?? 1"
            size="small"
            :min="0"
            :max="3"
            :step="1"
            @update:value="v => remielleQSetting && configStore.setTeamMechanicSetting(`remielle.q:${remielleQSetting.slot}`, v ?? 1)"
          />
        </div>
      </n-card>

      <n-card v-if="burniceReleaseElements" size="small" class="mechanic-card" :bordered="true">
        <template #header>柏妮思异放元素分配</template>
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
              @update:value="v => configStore.setMechanicSetting(`burnice.releaseShare:${item.element}`, (v ?? 0) / 100)"
            />
          </div>
        </div>
      </n-card>

      <n-card v-if="janePassionSlot >= 0" size="small" class="mechanic-card" :bordered="true">
        <template #header>简·狂热覆盖率</template>
        <div class="mechanic-row">
          <div class="mechanic-copy">
            <div class="field-desc">默认 90%。狂热状态下物理积蓄效率+25%、精通转攻击、1命增伤按该覆盖率折算。</div>
          </div>
          <n-input-number
            :value="configStore.getMechanicSetting('jane.passionCoverage', 0.9) * 100"
            size="small"
            :min="0"
            :max="100"
            :step="5"
            suffix="%"
            @update:value="v => configStore.setMechanicSetting('jane.passionCoverage', (v ?? 90) / 100)"
          />
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
                .filter(x => x.slot !== windCharSlot)
                .map(x => ({ label: `${x.name}（${elementLabel(x.element)}）`, value: x.slot })),
            ]"
            @update:value="(v: number | null) => configStore.setMechanicSetting('wind.infectionTargetSlot', v ?? -1)"
          />
        </div>
      </n-card>

      <n-card size="small" class="mechanic-card" :bordered="true">
        <template #header>副词条单属性上限</template>
        <div class="mechanic-row">
          <div class="mechanic-copy">
            <div class="field-desc">融合贪心优化器每个副词条最多分配的步数。默认 20 步，运气不好副产物少可调低到 15 或 10。</div>
          </div>
          <n-input-number
            :value="configStore.getMechanicSetting('optimizer.substatCap', 20)"
            size="small"
            :min="5"
            :max="39"
            :step="1"
            suffix="步"
            @update:value="v => configStore.setMechanicSetting('optimizer.substatCap', Math.round(v ?? 20))"
          />
        </div>
      </n-card>

      <n-card size="small" class="mechanic-card" :bordered="true">
        <template #header>副词条总步数（按有效词条数）</template>
        <div class="mechanic-row" style="display:flex;flex-direction:column;gap:8px">
          <div class="mechanic-copy" style="width:100%">
            <div class="field-desc">修改后自动重算当前配装推荐。0=使用该档默认值（2词条→32、3词条→39、4词条→43）。</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:12px;color:rgba(255,255,255,0.6);min-width:70px">2 词条档</span>
            <n-input-number :value="configStore.getMechanicSetting('optimizer.totalSteps2', 0)" size="tiny" :min="0" :max="60" :step="1" suffix="步" @update:value="v => configStore.setMechanicSetting('optimizer.totalSteps2', Math.round(v ?? 0))" />
            <span style="font-size:12px;color:rgba(255,255,255,0.6);min-width:70px">3 词条档</span>
            <n-input-number :value="configStore.getMechanicSetting('optimizer.totalSteps3', 0)" size="tiny" :min="0" :max="60" :step="1" suffix="步" @update:value="v => configStore.setMechanicSetting('optimizer.totalSteps3', Math.round(v ?? 0))" />
            <span style="font-size:12px;color:rgba(255,255,255,0.6);min-width:70px">4 词条档</span>
            <n-input-number :value="configStore.getMechanicSetting('optimizer.totalSteps4', 0)" size="tiny" :min="0" :max="60" :step="1" suffix="步" @update:value="v => configStore.setMechanicSetting('optimizer.totalSteps4', Math.round(v ?? 0))" />
          </div>
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

      <n-card v-if="inStunAnomalyState" size="small" class="mechanic-card" :bordered="true">
        <template #header>
          失衡内异常状态
          <n-tag size="tiny" type="info" :bordered="false" style="margin-left:8px;vertical-align:middle">
            失衡轴 {{ inStunAnomalyState.windows }} 窗
          </n-tag>
        </template>
        <div style="display:flex;flex-direction:column;gap:4px">
          <div v-for="el in inStunAnomalyState.elements" :key="el.element" class="field-title">
            {{ elementLabel(el.element) }} · 触发 {{ el.triggerCount }} 次 · 覆盖 {{ fmt(el.avgCoverage * 100, 1) }}%
          </div>
          <div v-if="inStunAnomalyState.elements.length === 0" class="field-desc">轴内招式未产生积蓄触发。</div>
        </div>
        <div class="field-desc" style="margin-top:6px">{{ inStunAnomalyState.note }} 异放按该时间线的实际活跃元素归因。</div>
        <div v-if="bossAnomalyState" style="margin-top:8px;border-top:1px solid rgba(255,255,255,0.08);padding-top:6px">
          <div class="mechanic-row">
            <div class="mechanic-copy">
              <div class="field-title">Boss 异常状态轴（紊乱替换状态 · 风化保持不变 · 极性紊乱/异放按触发时刻状态归因）</div>
              <div class="field-desc">指定进窗时目标已带的异常状态与异常条进度；不同属性异常触发即替换（归因取原状态）。积蓄超第一管即触发对应异常。</div>
            </div>
            <n-select
              :value="configStore.getMechanicSetting('boss.entryAnomaly', 0)"
              size="small"
              style="width:110px"
              :options="bossEntryOptions"
              @update:value="(v: number | null) => configStore.setMechanicSetting('boss.entryAnomaly', v ?? 0)"
            />
            <n-input-number
              v-if="(configStore.getMechanicSetting('boss.entryAnomaly', 0) ?? 0) > 0"
              :value="configStore.getMechanicSetting('boss.entryGauge', 0)"
              size="small"
              style="width:120px"
              :min="0"
              :max="100"
              :step="10"
              suffix="%"
              @update:value="(v: number | null) => configStore.setMechanicSetting('boss.entryGauge', v ?? 0)"
            />
          </div>
          <div
            v-for="(chain, w) in bossAnomalyState.stateChainsPerWindow"
            :key="w"
            class="field-desc"
          >
            窗{{ w + 1 }}：{{ formatBossStateChain(chain, bossAnomalyState.windOverlayPerWindow[w]) }}
          </div>
        </div>
      </n-card>

      <n-card v-if="marginalGainsBySlot.length > 0" size="small" class="mechanic-card" :bordered="true">
        <template #header>全队边际收益（各词条再 +1 步的伤害期望增量）</template>
        <div style="font-size:11px;color:rgba(255,255,255,0.45);padding:0 0 8px;line-height:1.5">
          量纲说明：数值是优化器内部 fast 评分的<b>相对量纲</b>（非真实伤害），含义 = 该词条再分配 1 步（如攻击 +3%、精通 +9）带来的期望伤害增量；蕾米等转模角色的攻击词条含全队拐力收益。<b>只用于比较词条优先级</b>：各词条边际接近 → 已接近最优；差距大 → 优先堆高的词条（直到单词条上限）。
        </div>
        <div v-for="mg in marginalGainsBySlot" :key="mg.slot" style="margin-bottom:6px">
          <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:2px">{{ mg.name }}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">
            <span v-for="(gain, stat) in mg.sortedGains" :key="stat" style="font-size:11px;color:rgba(255,255,255,0.55);background:rgba(255,255,255,0.04);padding:2px 6px;border-radius:3px">
              {{ statLabel(String(stat)) }} +{{ fmt(Number(gain), 1) }}/步
            </span>
            <span v-if="Object.keys(mg.sortedGains).length === 0" style="font-size:11px;color:rgba(255,255,255,0.3)">（未计算）</span>
          </div>
        </div>
      </n-card>

      <n-card size="small" class="mechanic-card" :bordered="true">
        <template #header>
          命座提升率（当前配队与滑块下，逐级影画带来的伤害增量）
          <n-tag v-if="!axisActiveForUplift" size="tiny" type="warning" :bordered="false" style="margin-left:8px;vertical-align:middle">
            非轴模式：本页命座提升率仅供参考，失衡轴模式才可信
          </n-tag>
        </template>
        <div class="intro-actions">
          <n-button size="small" type="primary" secondary :loading="cinemaComputing" @click="computeCinemaGains">
            {{ cinemaComputing ? '计算中' : (cinemaGains.length > 0 ? '重新计算' : '计算') }}
          </n-button>
        </div>
        <div v-if="cinemaGains.length > 0" style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
          <div v-for="g in cinemaGains" :key="g.slot">
            <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:2px">{{ g.name }}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px">
              <span
                v-for="e in g.entries"
                :key="e.to"
                :style="entryBadgeStyle(e)"
              >
                影画{{ e.to - 1 }}→{{ e.to }} {{ e.gainPct >= 0 ? '+' : '' }}{{ fmt(e.gainPct, 1) }}%<template v-if="e.gainPct < 0">（预算权衡：该命座资源侧收益被时间成本抵消）</template><template v-if="e.ultAfter !== e.ultBefore">（全队大招 {{ e.ultBefore }}→{{ e.ultAfter }}）</template><template v-if="e.warn === 'execLevel'"> · 执行级</template><template v-if="e.warn === 'unimplemented'"> · ⚠无变化</template>
                <template v-if="e.warn === 'unimplemented' && e.changedFields.length === 0">（该命座无面板字段与伤害变化，效果可能未接进计算）</template>
              </span>
            </div>
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

      <ImpactChart />
      <MarginalUtilityCard />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import ImpactChart from '@/components/ImpactChart.vue'
import MarginalUtilityCard from '@/components/MarginalUtilityCard.vue'
import { NButton, NCard, NInputNumber, NSelect } from 'naive-ui'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { analyzeCinemaUplift, type CinemaUpliftRow } from '@/composables/cinemaUplift'
import { fmt } from '@/utils/format'
import { getAgentMechanic } from '@/mechanics'
import { BOSS_ENTRY_ANOMALY_OPTIONS } from '@/core/stunAxis/inStunAnomaly'
import type { MechanicSetting } from '@/types/resource'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
const { resourceResult, anomalyVirtualPanels, anomalyPoolResult, panels, agentNames, teamTotalDamage, stunPoolResult, autoActive, effectiveStunAxes, inStunAnomalyState, bossAnomalyState } = useResourceCalc()
/** 命座提升率可信度：轴模式（用户开轴或自动命中预设轴）才可信；非轴是退化兜底，仅提示用途 */
const axisActiveForUplift = computed(() =>
  (configStore.useStunAxis || autoActive.value) && (effectiveStunAxes.value?.length ?? 0) > 0,
)

// 元素减抗 key 映射（从 useResourceCalc 复制）
const ELEMENT_RES_REDUCTION_KEYS: Record<string, string> = {
  physical: 'enemyPhysicalResReduction', fire: 'enemyFireResReduction',
  ice: 'enemyIceResReduction', electric: 'enemyElectricResReduction',
  ether: 'enemyEtherResReduction', wind: 'enemyWindResReduction',
  lumiflux: 'enemyLumifluxResReduction',
}

const ELEMENT_LABELS: Record<string, string> = {
  physical: '物理',
  fire: '火',
  ice: '冰',
  electric: '电',
  ether: '以太',
  wind: '风',
  lumiflux: '辉光',
}

function elementLabel(element: string): string {
  return ELEMENT_LABELS[element] ?? element
}

interface BossStateChainSegment {
  start: number
  end: number
  element: string
}

/** Boss 异常状态轴逐窗链格式化：标准状态段 + 风化覆盖层（括注，不参与替换） */
function formatBossStateChain(chain: BossStateChainSegment[], wind?: BossStateChainSegment[]): string {
  const fmt = (s: BossStateChainSegment) => `${elementLabel(s.element)} ${s.start.toFixed(1)}~${s.end.toFixed(1)}s`
  const segs = chain.map(fmt)
  if (wind?.length) segs.push(`（风化层 ${wind.map(fmt).join('、')}）`)
  return segs.length > 0 ? segs.join(' → ') : '无异常状态'
}

/** 进窗初始异常状态选择项（0=无；机制设置 boss.entryAnomaly） */
const bossEntryOptions = BOSS_ENTRY_ANOMALY_OPTIONS.map(o => ({
  label: o.element ? elementLabel(o.element) : '无',
  value: o.value,
}))

const hasTeam = computed(() => configStore.team.some(c => !!c.agentId))

const mechanicSettings = computed<MechanicSetting[]>(() => {
  const seen = new Set<string>()
  return configStore.team.flatMap(char => {
    const module = char.agentId ? getAgentMechanic(char.agentId) : undefined
    return (module?.settings ?? []).filter(setting => {
      if (seen.has(setting.id)) return false
      seen.add(setting.id)
      return true
    })
  })
})

const remielleQSetting = computed<{
  slot: number
  firstSlot: number
  secondSlot: number
  firstName: string
  secondName: string
  firstCount: number
} | null>(() => {
  const remielleSlot = configStore.team.findIndex(char => {
    const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
    return agent?.id === '1581' || agent?.teammateBuffId === '1581'
  })
  if (remielleSlot < 0) return null
  const otherSlots = [0, 1, 2].filter(slot => slot !== remielleSlot)
  if (otherSlots.length < 2) return null
  const [firstSlot, secondSlot] = otherSlots
  const firstChar = configStore.team[firstSlot]
  const secondChar = configStore.team[secondSlot]
  const firstName = firstChar?.agentId
    ? catalogStore.getAgent(firstChar.agentId)?.name?.zhCN || firstChar.agentId
    : `槽${firstSlot + 1}`
  const secondName = secondChar?.agentId
    ? catalogStore.getAgent(secondChar.agentId)?.name?.zhCN || secondChar.agentId
    : `槽${secondSlot + 1}`
  const firstCount = Math.max(0, Math.min(3, Math.floor(configStore.getTeamMechanicSetting(`remielle.q:${remielleSlot}`, 1))))
  return { slot: remielleSlot, firstSlot, secondSlot, firstName, secondName, firstCount }
})

const burniceReleaseElements = computed<{
  elements: { element: string; label: string; autoRatio: number; userValue: number }[]
} | null>(() => {
  const burniceSlot = configStore.team.findIndex(char => {
    const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
    return agent?.id === '1171' || agent?.teammateBuffId === '1171'
  })
  if (burniceSlot < 0) return null
  const coverage = anomalyPoolResult.value?.coverage?.perElementCoverageRate ?? {}
  const elements = Object.entries(coverage)
    .filter(([, rate]) => rate > 0)
    .map(([element, autoRatio]) => ({
      element,
      label: ELEMENT_LABELS[element] ?? element,
      autoRatio,
      userValue: configStore.getMechanicSetting(`burnice.releaseShare:${element}`, autoRatio),
    }))
  return { elements }
})

const janePassionSlot = computed<number>(() => {
  const slot = configStore.team.findIndex(char => {
    const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
    return agent?.id === '1261' || agent?.teammateBuffId === '1261'
  })
  return slot
})

const windCharSlot = computed<number>(() => {
  return configStore.team.findIndex(char => {
    const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
    return agent?.damageElement === 'wind'
  })
})

const windInfectionConfig = computed<{
  autoRate: number
  coverage: number
  candidates: { slot: number; name: string; element: string; specialty: string; isRemielle: boolean }[]
  autoSlot: number
  targetSlot: number
} | null>(() => {
  const windSlot = windCharSlot.value
  if (windSlot < 0) return null
  const autoRate = anomalyPoolResult.value?.coverage?.windCoverageRate ?? 0
  const coverage = configStore.getMechanicSetting('wind.infectionCoverage', autoRate)
  const candidates = configStore.team
    .map((char, slot) => {
      const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
      return {
        slot,
        name: agent?.name?.zhCN || char.agentId || `槽${slot + 1}`,
        element: agent?.damageElement ?? '',
        specialty: agent?.specialty ?? '',
        isRemielle: agent?.id === '1581' || agent?.teammateBuffId === '1581',
      }
    })
    .filter(x => !!x.element)
  const autoSlot = candidates.find(x =>
    x.slot !== windSlot && x.element !== 'wind'
    && x.specialty !== 'support' && x.specialty !== 'defense' && !x.isRemielle,
  )?.slot
    ?? candidates.find(x => x.slot !== windSlot && x.element !== 'wind')?.slot
    ?? windSlot
  const userSlot = Math.floor(configStore.getMechanicSetting('wind.infectionTargetSlot', -1))
  const targetSlot = userSlot >= 0 && userSlot !== windSlot && candidates.some(x => x.slot === userSlot)
    ? userSlot
    : autoSlot
  return { autoRate, coverage, candidates, autoSlot, targetSlot }
})

function settlementRows(vp: any): any[] {
  const sameElement = vp.rows.filter((row: any) => row.settlementEligible !== false)
  const rows = sameElement.length > 0 ? sameElement : vp.rows
  const isSingle = rows.length === 1

  // 从 anomalyPoolResult 取触发总数
  const prog = anomalyPoolResult.value?.perElement?.find((p: any) => p.element === vp.element)
  const totalTriggers = prog?.triggerCount ?? 0

  return rows.map((row: any) => {
    // 单人强制 100%；多人按 weight
    const share = isSingle ? 1 : row.weight
    const triggerCount = Math.round(share * totalTriggers)
    // 从该角色的真实面板取结算属性
    const panel = panels.value[row.slot] ?? null
    return {
      ...row,
      displayShare: isSingle ? '100%' : `${(share * 100).toFixed(1)}%`,
      triggerCount: isSingle ? totalTriggers : triggerCount,
      anomalyDmgBonus: panel?.anomalyDmgBonus ?? 0,
      anomalyCritRate: panel?.anomalyCritRate ?? 0,
      anomalyCritDmg: panel?.anomalyCritDmg ?? 0,
      assaultCritRate: panel?.assaultCritRate ?? 0,
      assaultCritDmg: panel?.assaultCritDmg ?? 0,
      enemyAnomalyDefReduction: panel?.enemyAnomalyDefReduction ?? 0,
      enemyAssaultDefReduction: panel?.enemyAssaultDefReduction ?? 0,
      enemyResReduction: panel?.enemyResReduction ?? 0,
      elementResReduction: panel?.[ELEMENT_RES_REDUCTION_KEYS[vp.element]] ?? 0,
    }
  })
}

function vpTotalTriggers(vp: any): number {
  const prog = anomalyPoolResult.value?.perElement?.find((p: any) => p.element === vp.element)
  return prog?.triggerCount ?? 0
}

const STAT_LABELS: Record<string, string> = {
  anomalyProficiency: '精通', atkPct: '攻击%', critRate: '暴击率', critDmg: '暴伤',
  penFlat: '穿透值', hpPct: '生命%', defPct: '防御%',
}
function statLabel(stat: string): string { return STAT_LABELS[stat] ?? stat }

const marginalGainsBySlot = computed(() => {
  const gains = configStore.perSlotMarginalGains
  return configStore.team
    .map((char, slot) => {
      if (!char?.agentId) return null
      const raw = gains[slot] ?? {}
      const sorted = Object.entries(raw as Record<string, number>)
        .filter(([_, v]) => v > 0)
        .sort(([_, a], [__, b]) => b - a)
      return {
        slot,
        name: agentNames.value[char.agentId] || catalogStore.getAgent(char.agentId)?.name?.zhCN || `槽${slot + 1}`,
        sortedGains: Object.fromEntries(sorted),
      }
    })
    .filter((x): x is { slot: number; name: string; sortedGains: Record<string, number> } => !!x)
})

// 类型与算法同源于 composables/cinemaUplift.ts（勿在此另抄一份）
const cinemaGains = ref<CinemaUpliftRow[]>([])
const cinemaComputing = ref(false)

function teamUltimateTotal(): number {
  return (resourceResult.value?.characters ?? []).reduce((sum, c) => sum + (c.ultimateCount ?? 0), 0)
}

/** 命座自检角标样式：ok 正常灰、execLevel 蓝色提示、unimplemented 橙色警示 */
function entryBadgeStyle(e: { warn: 'ok' | 'execLevel' | 'unimplemented' }): Record<string, string> {
  if (e.warn === 'unimplemented') {
    return { fontSize: '11px', padding: '2px 6px', borderRadius: '3px', color: '#ffd08a', background: 'rgba(255,160,60,0.12)', border: '1px solid rgba(255,160,60,0.4)' }
  }
  if (e.warn === 'execLevel') {
    return { fontSize: '11px', padding: '2px 6px', borderRadius: '3px', color: '#8ac6ff', background: 'rgba(80,150,255,0.10)', border: '1px solid rgba(80,150,255,0.3)' }
  }
  return { fontSize: '11px', padding: '2px 6px', borderRadius: '3px', color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.04)' }
}

async function computeCinemaGains() {
  cinemaComputing.value = true
  try {
    // 算法已抽到 composables/cinemaUplift.ts（同一份实现同时服务页面与测试：
    // 「命座必须有效果」的红灯断言见 composables/__tests__/cinemaUplift.test.ts 与 allAgentsSweep）
    cinemaGains.value = await analyzeCinemaUplift({
      configStore,
      catalogStore,
      readDamage: () => teamTotalDamage.value,
      readUltimateTotal: teamUltimateTotal,
      targetStunCount: stunPoolResult.value?.stunCount ?? 4, // 固定场景：以当前配置收敛的失衡次数为准
      resolveName: agentId => agentNames.value[agentId] || '',
    })
  } finally {
    cinemaComputing.value = false
  }
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
  color: rgba(255, 255, 255, 0.55);
}

.placeholder-title {
  font-size: 18px;
  color: rgba(255, 255, 255, 0.82);
  margin-bottom: 8px;
}

.intro-card,
.mechanic-card,
.char-card {
  background: rgba(255, 255, 255, 0.03);
}

.intro-text,
.field-desc,
.empty-note {
  color: rgba(255, 255, 255, 0.62);
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
  color: rgba(255, 255, 255, 0.9);
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
  background: rgba(255, 255, 255, 0.035);
  color: rgba(255, 255, 255, 0.78);
  font-size: 13px;
}

.settlement-block {
  margin-top: 10px;
}

.settlement-title {
  margin-bottom: 8px;
  color: rgba(255, 255, 255, 0.85);
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
  background: rgba(255, 255, 255, 0.035);
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
  background: rgba(255, 255, 255, 0.035);
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
  background: rgba(255, 255, 255, 0.035);
  color: rgba(255, 255, 255, 0.78);
  font-size: 12px;
}

.util-head {
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.55);
  font-weight: 600;
}

.kind-chip {
  color: #93c5fd;
}

.name-cell {
  color: rgba(255, 255, 255, 0.88);
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
