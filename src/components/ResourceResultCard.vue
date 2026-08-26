<template>
  <n-card size="small" :bordered="true" class="resource-card">
    <template #header>
      <div class="card-header">
        <span class="char-name">{{ agentName }}</span>
        <n-tag v-if="result.isFlashUser" size="tiny" type="warning" round>命破</n-tag>
        <n-tag v-if="specialtyInfo.label" size="tiny" :type="specialtyInfo.type as any" round>{{ specialtyInfo.label }}</n-tag>
      </div>
    </template>

    <!-- 时间分配 -->
    <div class="section">
      <div class="section-title">时间分配</div>
      <div class="time-bar action-chart">
        <div
          v-for="row in timeChartRows"
          :key="row.key"
          class="time-seg"
          :style="{ width: pct(row.time), background: row.color }"
          :title="`${row.name} ${fmt(row.time, 1)}s`"
        >
          <span v-if="row.time > 8">{{ row.name }} {{ fmt(row.time, 1) }}s</span>
        </div>
      </div>
      <div class="time-legend action-chart-legend">
        <span v-for="row in timeChartRows" :key="row.key" class="legend-item">
          <i class="dot" :style="{ background: row.color }"></i>{{ row.name }} {{ fmt(row.time, 1) }}s
        </span>
        <span class="legend-item total">总计 {{ fmt(chartTotalTime, 1) }}s</span>
      </div>
      <div class="action-time-list">
        <div class="action-time-row action-time-head">
          <span>动作</span>
          <span>占用操作</span>
          <span>计算</span>
        </div>
        <div v-for="row in actionOperationRows" :key="row.key" class="action-time-row">
          <span class="action-time-name">{{ row.name }}</span>
          <span class="action-time-value">{{ fmt(row.operationTime, 1) }}s</span>
          <span v-if="row.comboAlignTime > 0" class="action-time-detail">
            {{ fmt(row.frontlineTime, 1) }}s - {{ fmt(row.comboAlignTime, 1) }}s 合轴
          </span>
        </div>
      </div>
      <div class="time-note">
        上方动作行显示占用操作时间，即该动作前台时间扣除合轴时间后的结果；原始动作前台与合轴扣除仍在招式执行计划中保留。
      </div>
    </div>

    <!-- 能量 -->
    <div class="section">
      <div class="section-title">
        {{ result.isFlashUser ? '闪能' : '能量' }}
        <span class="section-total">{{ fmt(result.energySource.total) }} 点</span>
      </div>
      <div class="breakdown-list">
        <div class="breakdown-row">
          <span class="bd-label">基础自动</span>
          <span class="bd-value">{{ fmt(result.energySource.autoRegen) }}</span>
          <span class="bd-detail">基础回能 × 战斗时间</span>
        </div>
        <div v-if="result.energySource.pctRegenBonus > 0" class="breakdown-row">
          <span class="bd-label">百分比回能</span>
          <span class="bd-value">{{ fmt(result.energySource.pctRegenBonus) }}</span>
          <span class="bd-detail">基础回能 × 战斗时间 × 百分比加成</span>
        </div>
        <div v-if="result.energySource.flatRegenBonus > 0" class="breakdown-row">
          <span class="bd-label">固定回能</span>
          <span class="bd-value">{{ fmt(result.energySource.flatRegenBonus) }}</span>
          <span class="bd-detail">固定加成 × 战斗时间</span>
        </div>
        <div v-if="result.energySource.backstageBonus > 0" class="breakdown-row">
          <span class="bd-label">后台固定</span>
          <span class="bd-value">{{ fmt(result.energySource.backstageBonus) }}</span>
          <span class="bd-detail">后台时间 × 固定回能</span>
        </div>
        <div v-if="result.energySource.comboAlignBonus > 0" class="breakdown-row">
          <span class="bd-label">非操作固定</span>
          <span class="bd-value">{{ fmt(result.energySource.comboAlignBonus) }}</span>
          <span class="bd-detail">非操作/合轴时间 × 固定回能</span>
        </div>
        <div v-if="result.energySource.gainEfficiencyBonus > 0" class="breakdown-row">
          <span class="bd-label">获得效率</span>
          <span class="bd-value">{{ fmt(result.energySource.gainEfficiencyBonus) }}</span>
          <span class="bd-detail">含德玛拉 {{ fmt(result.energySource.demaraCoverageSeconds, 1) }}s / {{ fmt(result.energySource.demaraCoverageRate * 100, 1) }}%</span>
        </div>
        <div class="breakdown-row">
          <span class="bd-label">平A回复</span>
          <span class="bd-value">{{ fmt(result.energySource.basicAttackRegen) }}</span>
          <span class="bd-detail">平A时间 × 秒均回能</span>
        </div>
        <div v-if="result.energySource.timeSliceEnergy > 0" class="breakdown-row">
          <span class="bd-label">时光切片</span>
          <span class="bd-value">{{ fmt(result.energySource.timeSliceEnergy) }}</span>
          <span class="bd-detail">闪反/强特/支援/连携触发</span>
        </div>
        <div v-if="result.energySource.zhenyuanEnergy > 0" class="breakdown-row">
          <span class="bd-label">真元奇枢</span>
          <span class="bd-value">{{ fmt(result.energySource.zhenyuanEnergy) }}</span>
          <span class="bd-detail">受伤/回血触发</span>
        </div>
        <div v-if="result.energySource.hatTrickEnergy > 0" class="breakdown-row">
          <span class="bd-label">帽子把戏</span>
          <span class="bd-value">{{ fmt(result.energySource.hatTrickEnergy) }}</span>
          <span class="bd-detail">影画2：25/次 × 20s 冷却（按战斗时间触发）</span>
        </div>
        <div v-if="result.energySource.qingyiC4Energy > 0" class="breakdown-row">
          <span class="bd-label">稳态电弧屏障</span>
          <span class="bd-value">{{ fmt(result.energySource.qingyiC4Energy) }}</span>
          <span class="bd-detail">青衣影画4：5/次 × 10s 冷却（护盾刷新回能）</span>
        </div>
        <div v-if="result.energySource.supportUltimateRegen > 0" class="breakdown-row">
          <span class="bd-label">辅助大招</span>
          <span class="bd-value">{{ fmt(result.energySource.supportUltimateRegen) }}</span>
        </div>
        <div v-if="(result.energySource.crossAgent?.teamUltimateFlash ?? 0) > 0" class="breakdown-row">
          <span class="bd-label">队友终结技回能</span>
          <span class="bd-value">{{ fmt(result.energySource.crossAgent.teamUltimateFlash) }}</span>
          <span class="bd-detail">额外能力：队友每次终结技回能（队友终结次数 × 单次量）</span>
        </div>
        <div v-if="(result.energySource.crossAgent?.rinaUltEnergy ?? 0) > 0" class="breakdown-row">
          <span class="bd-label">丽娜终结邻位</span>
          <span class="bd-value">{{ fmt(result.energySource.crossAgent.rinaUltEnergy) }}</span>
        </div>
        <div v-if="(result.energySource.crossAgent?.soukakuUltEnergy ?? 0) > 0" class="breakdown-row">
          <span class="bd-label">苍角终结邻位</span>
          <span class="bd-value">{{ fmt(result.energySource.crossAgent.soukakuUltEnergy) }}</span>
        </div>
        <div v-if="(result.energySource.crossAgent?.lucyEnergy ?? 0) > 0" class="breakdown-row">
          <span class="bd-label">露西回能</span>
          <span class="bd-value">{{ fmt(result.energySource.crossAgent.lucyEnergy) }}</span>
          <span class="bd-detail">终结邻位 + 影画1 回旋全队</span>
        </div>
        <div v-if="(result.energySource.crossAgent?.lighterC4Energy ?? 0) > 0" class="breakdown-row">
          <span class="bd-label">莱特影画4 喷发</span>
          <span class="bd-value">{{ fmt(result.energySource.crossAgent.lighterC4Energy) }}</span>
          <span class="bd-detail">后场 +4/次 × 18s 冷却</span>
        </div>
        <div class="breakdown-row">
          <span class="bd-label">开局赠送</span>
          <span class="bd-value">{{ fmt(result.energySource.initialGift) }}</span>
        </div>
        <div v-if="result.energySource.shieldBreakGift > 0" class="breakdown-row">
          <span class="bd-label">破秽盾</span>
          <span class="bd-value">{{ fmt(result.energySource.shieldBreakGift) }}</span>
          <span class="bd-detail">60/个</span>
        </div>
        <div v-if="result.energySource.energyShieldBreakGift > 0" class="breakdown-row">
          <span class="bd-label">破能量盾</span>
          <span class="bd-value">{{ fmt(result.energySource.energyShieldBreakGift) }}</span>
          <span class="bd-detail">30/个</span>
        </div>
      </div>
      <div class="usage-bar">
        <span>强特 {{ result.exSpecialCount }} 次</span>
        <span class="usage-detail">耗能 {{ result.exSpecialEnergyConsume }}/次 × {{ result.exSpecialCount }} = {{ result.exSpecialEnergyConsume * result.exSpecialCount }} 点</span>
      </div>
    </div>

    <!-- 喧响 -->
    <div class="section">
      <div class="section-title">
        喧响
        <span class="section-total">{{ fmt(decibelGrandTotal) }} 点</span>
      </div>
      <div class="breakdown-list">
        <div class="breakdown-row">
          <span class="bd-label">开局赠送</span>
          <span class="bd-value">{{ fmt(result.decibelSource.initialGift) }}</span>
        </div>
        <div class="breakdown-row">
          <span class="bd-label">招式回复</span>
          <span class="bd-value">{{ fmt(result.decibelSource.skillRegen) }}</span>
          <span class="bd-detail">平A + 强特</span>
        </div>
        <div v-if="result.decibelSource.bonusRegen > 0" class="breakdown-row">
          <span class="bd-label">奖励回复</span>
          <span class="bd-value">{{ fmt(result.decibelSource.bonusRegen) }}</span>
          <span class="bd-detail">时光切片等池内效果</span>
        </div>
        <div v-if="result.decibelSource.timeSliceDecibel > 0" class="breakdown-row">
          <span class="bd-label">时光切片</span>
          <span class="bd-value">{{ fmt(result.decibelSource.timeSliceDecibel) }}</span>
          <span class="bd-detail">已计入奖励回复</span>
        </div>
        <div class="breakdown-row">
          <span class="bd-label">队友伴随</span>
          <span class="bd-value">{{ fmt(result.decibelSource.teammateShare) }}</span>
          <span class="bd-detail">50% 分享</span>
        </div>
        <div v-if="(result.decibelSource.anomalyBonus ?? 0) > 0" class="breakdown-row">
          <span class="bd-label">异常/紊乱/乱流</span>
          <span class="bd-value">{{ fmt(result.decibelSource.anomalyBonus) }}</span>
          <span class="bd-detail">含队友伴随50% · 已计入次数</span>
        </div>
        <div v-if="(result.decibelSource.specialActionBonus ?? 0) > 0" class="breakdown-row">
          <span class="bd-label">特殊动作</span>
          <span class="bd-value">{{ fmt(result.decibelSource.specialActionBonus) }}</span>
          <span class="bd-detail">弹刀/闪避/快支 · 含队友伴随50% · 已计入次数</span>
        </div>
      </div>
      <div class="usage-bar">
        <span>终结技 {{ result.ultimateCount }} 次</span>
        <span class="usage-detail">消耗 {{ result.ultimateCost }}/次 × {{ result.ultimateCount }} = {{ result.ultimateCost * result.ultimateCount }} 点</span>
      </div>
    </div>

    <!-- 角色机制模块专属资源 -->
    <div v-for="section in specialResourceSections" :key="section.id" class="section">
      <div class="section-title">
        {{ section.title }}
        <span class="section-total">{{ section.summary }}</span>
      </div>
      <div class="breakdown-list">
        <div v-for="row in section.rows" :key="row.label" class="breakdown-row">
          <span class="bd-label">{{ row.label }}</span>
          <span class="bd-value">{{ row.value }}</span>
          <span v-if="row.detail" class="bd-detail">{{ row.detail }}</span>
        </div>
      </div>
      <div v-if="section.footer" class="usage-bar">
        <span>{{ section.footer }}</span>
      </div>
    </div>

    <!-- 招式执行计划 -->
    <div class="section">
      <div class="section-title">招式执行计划</div>
      <n-data-table
        :columns="executionColumns"
        :data="executionsData"
        size="small"
        :bordered="false"
        :single-line="false"
        dense
      />
    </div>

    <!-- 异常事件执行计划 -->
    <div v-if="anomalyEventExecutionsData.length > 0" class="section">
      <div class="section-title">异常事件执行计划</div>
      <n-data-table
        :columns="anomalyEventColumns"
        :data="anomalyEventExecutionsData"
        size="small"
        :bordered="false"
        :single-line="false"
        dense
      />
    </div>

    <!-- 失衡池 -->
    <div v-if="stunContributions.length > 0" class="section">
      <div class="section-title">
        失衡池
        <span class="section-total">{{ fmt(stunTotal) }} 失衡值</span>
      </div>
      <div class="breakdown-list">
        <div v-for="contrib in stunContributions" :key="contrib.moveId + contrib.slot" class="breakdown-row">
          <span class="bd-label">{{ contrib.moveName }}</span>
          <span class="bd-value">{{ fmt(contrib.totalStun, 1) }}</span>
          <span class="bd-detail">{{ contrib.count }}次 × {{ fmt(contrib.perHitStun, 1) }}/次</span>
        </div>
      </div>
      <div class="usage-bar">
        <span>占全队 {{ stunPct }}%</span>
        <span class="usage-detail">全队失衡 {{ fmt(stunPoolTotal) }} → {{ stunCount }} 次</span>
      </div>
    </div>

    <!-- 积蓄池 -->
    <div v-if="anomalyProgress.length > 0" class="section">
      <div class="section-title">
        积蓄池
        <span class="section-total">{{ anomalyMyTotal }} 积蓄值</span>
      </div>
      <div class="breakdown-list">
        <div v-for="prog in anomalyProgress" :key="prog.element" class="breakdown-row">
          <span class="bd-label">{{ elementLabel(prog.element) }}</span>
          <span class="bd-value">{{ fmt(prog.totalBuildUp, 1) }}</span>
          <span class="bd-detail">单条上限{{ fmt(prog.buildUpCap, 0) }} → {{ prog.triggerCount }}次</span>
        </div>
      </div>
      <div class="usage-bar">
        <span>本角色异常 {{ myAnomalyTriggerCount }} 次 + 紊乱 {{ myDisorderCount }} 次 + 乱流 {{ myTurbulenceCount }} 次</span>
        <span v-if="anomalyBonusBreakdown" class="usage-detail">
          个人获得 {{ fmt(result.decibelSource.anomalyBonus ?? 0) }} 点
          （自己 {{ fmt(anomalyBonusBreakdown.own) }} + 队友伴随 {{ fmt(anomalyBonusBreakdown.companion) }}）
        </span>
        <span v-else class="usage-detail">个人获得 {{ fmt(result.decibelSource.anomalyBonus ?? 0) }} 点</span>
      </div>
    </div>

    <!-- 特殊动作喧响（个人） -->
    <div v-if="(result.decibelSource.specialActionBonus ?? 0) > 0" class="section">
      <div class="section-title">
        特殊动作喧响
        <span class="section-total">+{{ fmt(result.decibelSource.specialActionBonus) }} 点</span>
      </div>
      <div class="usage-bar">
        <span>弹刀/闪避/快支 奖励</span>
        <span class="usage-detail">含队友伴随50%</span>
      </div>
    </div>
  </n-card>
</template>

<script setup lang="ts">
import { computed, h } from 'vue'
import { NCard, NTag, NDataTable } from 'naive-ui'
import type { CharacterResourceResult, StunPoolResult, AnomalyPoolResult } from '@/types/resource'
import { fmt } from '@/utils/format'
import { getAgentMechanic } from '@/mechanics'
import { ANOMALY_DECIBEL_BONUS, DISORDER_DECIBEL_BONUS, TURBULENCE_DECIBEL_BONUS } from '@/core/anomalyPool/helpers'

const props = defineProps<{
  result: CharacterResourceResult
  agentName: string
  specialty?: string
  /** 队伍失衡池结果（团队级，用于提取本角色的贡献和团队失衡次数） */
  stunPoolResult?: StunPoolResult | null
  /** 队伍积蓄池结果（团队级，用于提取本角色的贡献和团队触发次数） */
  anomalyPoolResult?: AnomalyPoolResult | null
}>()

// 特性标签
const SPECIALTY_MAP: Record<string, { label: string; type: string }> = {
  attack: { label: '强攻', type: 'error' },
  stun: { label: '击破', type: 'warning' },
  anomaly: { label: '异常', type: 'info' },
  support: { label: '支援', type: 'success' },
  defense: { label: '防护', type: 'default' },
}

const specialtyInfo = computed(() => {
  return SPECIALTY_MAP[props.specialty ?? ''] ?? { label: '', type: 'default' }
})

/** 喧响总览 = decibelSource.total（异常/特殊动作奖励已并入，含效率乘数），与终结技次数推导同口径 */
const decibelGrandTotal = computed(() => props.result.decibelSource?.total ?? 0)

const specialResourceSections = computed(() =>
  getAgentMechanic(props.result.agentId)?.resourceSections?.({
    result: props.result,
    anomalyPoolResult: props.anomalyPoolResult,
  }) ?? [],
)

// 时间占比百分比
function pct(time: number): string {
  const total = 180 // totalTime
  return `${(time / total * 100).toFixed(1)}%`
}


type ActionOperationRow = {
  key: string
  name: string
  color: string
  match: (moveName: string, category: string) => boolean
  frontlineTime: number
  comboAlignTime: number
  operationTime: number
}

const ACTION_ROW_DEFS: Array<Pick<ActionOperationRow, 'key' | 'name' | 'color' | 'match'>> = [
  { key: 'basic', name: '普通攻击', color: '#61afef', match: (_moveName, category) => category === 'basic' },
  { key: 'exSpecial', name: '强化特殊技', color: '#e06c75', match: (moveName, category) => category === 'special' || moveName.includes('强化特殊技') || moveName.toLowerCase().includes('ex special') },
  { key: 'ultimate', name: '终结技', color: '#c678dd', match: (moveName, category) => category === 'chain' && (moveName.includes('终结技') || moveName.toLowerCase().includes('ultimate')) },
  { key: 'chain', name: '连携技', color: '#d19a66', match: (moveName, category) => category === 'chain' && (moveName.includes('连携技') || moveName.toLowerCase().includes('chain attack') || moveName.toLowerCase().includes('chain') || moveName.toLowerCase().includes('连携')) && !moveName.toLowerCase().includes('ultimate') },
  { key: 'dodgeCounter', name: '闪避反击', color: '#7fdbca', match: (moveName, category) => category === 'dodge' || moveName.includes('闪避反击') || moveName.toLowerCase().includes('dodge counter') },
  { key: 'defensiveAssist', name: '轻弹刀', color: '#56b6c2', match: (moveName, category) => (category === 'assist' && moveName.toLowerCase().includes('defensive assist')) || moveName.includes('轻弹刀') || moveName.toLowerCase().includes('defensive assist') },
  { key: 'assistFollowUp', name: '支援突击', color: '#98c379', match: (moveName, category) => (category === 'assist' && moveName.toLowerCase().includes('assist follow-up')) || moveName.includes('支援突击') || moveName.toLowerCase().includes('assist follow-up') },
]

const actionOperationRows = computed<ActionOperationRow[]>(() => {
  const rows: ActionOperationRow[] = []
  let colorIdx = 0
  for (const exec of props.result.executions) {
    const frontlineTime = exec.totalTime ?? 0
    if (frontlineTime <= 0) continue
    const comboAlignTime = exec.totalComboAlignTime ?? 0
    const matched = ACTION_ROW_DEFS.find(def => def.match(exec.moveName, exec.category))
    const color = matched?.color ?? ACTION_ROW_DEFS[colorIdx % ACTION_ROW_DEFS.length].color
    colorIdx++
    // 名字：basic_attack 行优先用机制改写的 moveName（如伊德海莉「蓄力（烧血）」），
    // 未被改写时显示通用名「普通攻击」
    const name = exec.moveId === 'basic_attack'
      ? (exec.moveName && exec.moveName !== 'basic_attack' ? exec.moveName : '普通攻击')
      : `${exec.moveName} (${exec.moveId})`
    rows.push({
      key: exec.moveId || name,
      name,
      color,
      match: () => true,
      frontlineTime,
      comboAlignTime,
      operationTime: Math.max(0, frontlineTime - comboAlignTime),
    })
  }

  // 柏妮思的搅拌式/流火招式按倍率表动作展示动作时长（不依赖通用分类）
  const burniceSource = (props.result as any).burniceMechanicSource
  if (burniceSource) {
    const stirringTime = (burniceSource.stirringCount ?? 0) * (burniceSource.stirringActionTimeSeconds ?? 0)
    if (stirringTime > 0) {
      rows.push({
        key: 'burniceStirring',
        name: '搅拌式·炽焰搅拌式 (1171007 融合)',
        color: '#ff7b72',
        match: () => true,
        frontlineTime: stirringTime,
        comboAlignTime: 0,
        operationTime: stirringTime,
      })
    }
    const tossingTime = (burniceSource.tossingCount ?? 0) * (burniceSource.tossingActionTimeSeconds ?? 0)
    if (tossingTime > 0) {
      rows.push({
        key: 'burniceTossing',
        name: '流火·灼热抛接法 (1171026)',
        color: '#f47067',
        match: () => true,
        frontlineTime: tossingTime,
        comboAlignTime: 0,
        operationTime: tossingTime,
      })
    }
  }
  return rows
})

const actionOperationTime = computed(() => {
  return actionOperationRows.value
    .filter(row => row.key !== 'basic')
    .reduce((sum, row) => sum + row.operationTime, 0)
})

const timeChartRows = computed(() => {
  const rows = actionOperationRows.value.map(row => ({
    key: row.key,
    name: row.name,
    time: row.operationTime,
    color: row.color,
  }))

  rows.push({
    key: 'comboAlign',
    name: '合轴',
    time: resultComboAlignTime.value,
    color: 'var(--wa-280)',
  })
  rows.push({
    key: 'backstage',
    name: '后台',
    time: props.result.timeAllocation.backstageTime,
    color: 'var(--wa-120)',
  })

  return rows
})

const resultComboAlignTime = computed(() => {
  return actionOperationRows.value.reduce((sum, row) => sum + row.comboAlignTime, 0)
})

const chartTotalTime = computed(() => {
  return timeChartRows.value.reduce((sum, row) => sum + row.time, 0)
})

// ============ 失衡池（本角色贡献） ============

/** 本角色的失衡贡献明细 */
const stunContributions = computed(() => {
  if (!props.stunPoolResult) return []
  return props.stunPoolResult.contributions.filter(c => c.slot === props.result.slot)
})

/** 本角色总失衡值 */
const stunTotal = computed(() => {
  return stunContributions.value.reduce((sum, c) => sum + c.totalStun, 0)
})

/** 团队失衡次数 */
const stunCount = computed(() => props.stunPoolResult?.stunCount ?? 0)

/** 全队总失衡值 */
const stunPoolTotal = computed(() => props.stunPoolResult?.totalStunBuildUp ?? 0)

/** 本角色占全队失衡百分比 */
const stunPct = computed(() => {
  if (stunPoolTotal.value <= 0) return '0'
  return ((stunTotal.value / stunPoolTotal.value) * 100).toFixed(1)
})

// ============ 积蓄池（本角色贡献） ============

/** 元素中文标签 */
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

/** 本角色各元素的积蓄进度（从团队结果中过滤本角色贡献） */
const anomalyProgress = computed(() => {
  if (!props.anomalyPoolResult) return []
  const slot = props.result.slot
  const result: Array<{
    element: string
    totalBuildUp: number
    buildUpCap: number
    triggerCount: number
  }> = []

  for (const prog of props.anomalyPoolResult.perElement) {
    const myContribs = prog.contributions.filter(c => c.slot === slot)
    if (myContribs.length === 0) continue
    const myTotal = myContribs.reduce((sum, c) => sum + c.totalBuildUp, 0)
    result.push({
      element: prog.element,
      totalBuildUp: myTotal,
      buildUpCap: prog.buildUpCap,
      triggerCount: prog.perSlotTriggerCounts?.[slot] ?? 0,
    })
  }
  return result
})

/** 本角色归属的异常触发次数 */
const myAnomalyTriggerCount = computed(() => props.anomalyPoolResult?.perSlotAnomalyTriggers?.[props.result.slot] ?? 0)

/** 本角色总积蓄值 */
const anomalyMyTotal = computed(() => {
  return anomalyProgress.value.reduce((sum, p) => sum + p.totalBuildUp, 0)
})

/** 本角色归属的紊乱次数 */
const myDisorderCount = computed(() => props.anomalyPoolResult?.perSlotDisorderTriggers?.[props.result.slot] ?? 0)

/** 本角色归属的乱流次数 */
const myTurbulenceCount = computed(() => props.anomalyPoolResult?.perSlotTurbulenceTriggers?.[props.result.slot] ?? 0)

/** 喧响个人获得拆解：自己完整奖励 + 其他队友奖励的 50% 伴随（异常/紊乱/乱流常量见 anomalyPool/helpers） */
const anomalyBonusBreakdown = computed(() => {
  const pool = props.anomalyPoolResult
  if (!pool) return null
  const slot = props.result.slot
  const slotCount = Math.max(3, pool.perSlotAnomalyTriggers?.length ?? 3)
  const own = (pool.perSlotAnomalyTriggers?.[slot] ?? 0) * ANOMALY_DECIBEL_BONUS
    + (pool.perSlotDisorderTriggers?.[slot] ?? 0) * DISORDER_DECIBEL_BONUS
    + (pool.perSlotTurbulenceTriggers?.[slot] ?? 0) * TURBULENCE_DECIBEL_BONUS
  let companion = 0
  for (let j = 0; j < slotCount; j++) {
    if (j === slot) continue
    companion += (
      (pool.perSlotAnomalyTriggers?.[j] ?? 0) * ANOMALY_DECIBEL_BONUS
      + (pool.perSlotDisorderTriggers?.[j] ?? 0) * DISORDER_DECIBEL_BONUS
      + (pool.perSlotTurbulenceTriggers?.[j] ?? 0) * TURBULENCE_DECIBEL_BONUS
    ) * 0.5
  }
  return { own, companion }
})

// ============ 招式执行计划表格 ============

function fmtCell(value: number | undefined, digits = 1): string {
  return value && value > 0 ? fmt(value, digits) : '-'
}

function executionValue(row: any, key: string, totalKey?: string): string {
  const single = row[key] ?? 0
  const total = totalKey ? row[totalKey] ?? 0 : 0
  if (single <= 0 && total <= 0) return '-'
  if (totalKey && row.count > 0) return `${fmt(single, 1)} × ${row.count} = ${fmt(total, 1)}`
  return fmt(single, 1)
}

/** 次数列：Sweeping Cyclone #1 附加风蚀替换广域次数（微域升级广域） */
function renderCount(row: any): any {
  const base = row.count ?? 0
  const corrosion = props.anomalyPoolResult?.velinaCorrosionSource as any
  if (row.moveId === '1561007' && corrosion?.broadCycloneCount) {
    const extra = corrosion.broadCycloneCount * 10
    return h('span', { title: `${base}（风华触发） + ${extra}（风蚀替换广域）` }, `${base + extra}`)
  }
  return String(base)
}

// 执行计划表格数据
const executionColumns = [
  {
    title: '招式',
    key: 'moveName',
    width: 128,
    render(row: any) {
      return h('div', [
        h('span', { class: 'exec-name' }, row.moveName),
        h('div', { class: 'exec-note' }, `${row.actionCode || row.moveId} · ${row.category}`),
        row.skillTableNote ? h('div', { class: 'exec-note' }, row.skillTableNote) : null,
      ])
    },
  },
  { title: '次数', key: 'count', width: 62, align: 'center' as const, render: renderCount },
  {
    title: '伤害倍率',
    key: 'damageMultiplier',
    width: 78,
    align: 'right' as const,
    render(row: any) { return fmtCell(row.damageMultiplier, 1) },
  },
  {
    title: '失衡倍率',
    key: 'dazeMultiplier',
    width: 78,
    align: 'right' as const,
    render(row: any) { return fmtCell(row.dazeMultiplier, 1) },
  },
  {
    title: '能量回复',
    key: 'energyRecovery',
    width: 92,
    align: 'right' as const,
    render(row: any) { return executionValue(row, 'energyRecovery', 'totalEnergyRecovery') },
  },
  {
    title: '喧响回复',
    key: 'decibelRecovery',
    width: 92,
    align: 'right' as const,
    render(row: any) { return executionValue(row, 'decibelRecovery', 'totalDecibelRecovery') },
  },
  {
    title: '异常积蓄',
    key: 'anomalyBuildUp',
    width: 120,
    align: 'right' as const,
    render(row: any) { return executionValue(row, 'anomalyBuildUp', 'totalAnomalyBuildUp') },
  },
  {
    title: '特殊资源',
    key: 'specialResourceRecovery',
    width: 86,
    align: 'right' as const,
    render(row: any) { return executionValue(row, 'specialResourceRecovery', 'totalSpecialResourceRecovery') },
  },
  {
    title: '回血量',
    key: 'healingAmount',
    width: 78,
    align: 'right' as const,
    render(row: any) { return executionValue(row, 'healingAmount', 'totalHealingAmount') },
  },
  {
    title: '动作/合轴',
    key: 'actionTime',
    width: 96,
    align: 'right' as const,
    render(row: any) {
      const action = row.totalTime > 0 ? `${row.totalTime.toFixed(1)}s` : '-'
      const align = row.totalComboAlignTime > 0 ? ` / -${row.totalComboAlignTime.toFixed(1)}s` : ''
      return `${action}${align}`
    },
  },
]

const executionsData = computed(() => {
  const rows = props.result.executions.map(e => ({
    ...e,
    actionCode: e.actionCode || e.moveId,
  }))

  const actualChainCount = (props.stunPoolResult?.stunCount ?? 0) * (props.result.chainCountPerStun ?? 0)
  const hasChainRow = rows.some(row => row.category === 'chain' && String(row.moveName).includes('连携'))
  if (actualChainCount > 0 && !hasChainRow) {
    rows.push({
      moveId: 'chain_attack_pending_display',
      actionCode: 'chain_attack_pending_display',
      moveName: '连携技（按失衡次数补出）',
      category: 'chain',
      count: actualChainCount,
      actionTime: 0,
      comboAlignRatio: 0,
      totalTime: 0,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      skillTableResolved: false,
      skillTableNote: '资源池先于失衡池计算；这里用失衡池结果补出次数，后续应把连携纳入二阶段动作计划。',
    })
  }
  return rows
})

const anomalyEventColumns = [
  { title: '事件', key: 'eventName', width: 110 },
  { title: '类型', key: 'eventType', width: 80 },
  { title: '载体动作', key: 'carrierMoveName', width: 120 },
  { title: '次数', key: 'count', width: 54, align: 'center' as const },
  {
    title: '公式/字段',
    key: 'formula',
    render(row: any) {
      return h('div', [
        h('div', { class: 'exec-formula' }, row.formula),
        h('div', { class: 'exec-note' }, row.fields?.join(' · ') ?? ''),
        row.note ? h('div', { class: 'exec-note' }, row.note) : null,
      ])
    },
  },
]

const anomalyEventExecutionsData = computed(() => {
  const base = props.result.anomalyEventExecutions ?? []
  // 维琳娜专属：腐蚀状态机的微域/风蚀替换广域异放事件由异常池后算（资源层拿不到），从 anomalyPoolResult 补入执行计划
  if (props.result.agentId === '1561') {
    const poolReleases = (props.anomalyPoolResult?.anomalyEvents ?? [])
      .filter(e => e.count > 0 && e.type === 'release' && e.id.includes('velina-corrosion'))
      .map(e => ({
        eventId: e.id,
        eventName: e.label,
        eventType: e.type,
        count: e.count,
        formula: e.formula ?? '',
        fields: e.fields ?? [],
        note: e.note,
      }))
    if (poolReleases.length > 0) return [...base, ...poolReleases]
  }
  return base
})
</script>

<style scoped>
.resource-card {
  background: var(--wa-30);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.char-name {
  font-size: 16px;
  font-weight: 600;
  color: #fff;
}

.exec-note {
  margin-top: 2px;
  font-size: 10px;
  color: var(--wa-360);
  line-height: 1.35;
}

.exec-formula {
  font-family: Consolas, monospace;
  font-size: 11px;
  color: var(--wa-680);
  line-height: 1.45;
}

.section {
  margin-bottom: 16px;
}

.section:last-child {
  margin-bottom: 0;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--wa-700);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-total {
  font-size: 14px;
  color: #63e2b7;
  font-weight: 700;
}

/* 时间分配条 */
.time-bar {
  display: flex;
  height: 28px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--app-inset);
  margin-bottom: 6px;
}

.time-seg {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--wa-900);
  white-space: nowrap;
  overflow: hidden;
  transition: width 0.3s;
}

.time-seg.necessary {
  background: #e06c75;
}

.time-seg.basic {
  background: #61afef;
}

.time-seg.backstage {
  background: var(--wa-100);
  color: var(--wa-500);
}

.time-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: var(--wa-500);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.legend-item.total {
  margin-left: auto;
  color: var(--wa-700);
  font-weight: 600;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  display: inline-block;
}

.dot.necessary { background: #e06c75; }
.dot.basic { background: #61afef; }
.dot.backstage { background: var(--wa-150); }

.action-time-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--wa-25);
}

.action-time-row {
  display: grid;
  grid-template-columns: 82px 56px 1fr;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.action-time-head {
  color: var(--wa-320);
  font-size: 11px;
}

.action-time-head span:nth-child(2) {
  text-align: right;
}

.action-time-name {
  color: var(--wa-580);
}

.action-time-value {
  color: var(--wa-900);
  font-weight: 600;
  text-align: right;
}

.action-time-detail {
  color: var(--wa-320);
  font-size: 11px;
}

.time-note {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--wa-350);
}

/* 能量/喧响明细 */
.breakdown-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.breakdown-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 3px 0;
}

.bd-label {
  color: var(--wa-500);
  min-width: 70px;
}

.bd-value {
  color: var(--wa-900);
  font-weight: 600;
  min-width: 50px;
  text-align: right;
}

.bd-detail {
  color: var(--wa-300);
  font-size: 11px;
  margin-left: auto;
}

.usage-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(99, 226, 183, 0.08);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
  color: #63e2b7;
  font-weight: 600;
}

.usage-detail {
  color: var(--wa-400);
  font-weight: 400;
  font-size: 11px;
}

/* 执行计划表格 */
:deep(.n-data-table) {
  font-size: 12px;
}

:deep(.n-data-th) {
  padding: 4px 8px !important;
}

:deep(.n-data-td) {
  padding: 4px 8px !important;
}

.exec-name {
  font-size: 11px;
  color: var(--wa-700);
}
</style>
