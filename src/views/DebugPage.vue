<template>
  <div class="debug-page">
    <n-space vertical :size="16">
      <n-card size="small" :bordered="true">
        <template #header>
          <n-space align="center" justify="space-between" style="width: 100%">
            <span>字段与公式调试</span>
            <n-select
              :value="selectedSlot"
              :options="slotOptions"
              size="small"
              style="width: 180px"
              @update:value="v => configStore.selectSlot(v)"
            />
          </n-space>
        </template>
        <n-alert type="info" :bordered="false" style="margin-bottom: 12px">
          这个页面不改变计算结果，只把当前角色的角色白值、音擎、驱动盘、队友 Buff、全局 Buff 逐条拆出来，方便核对字段是否进了正确乘区。
        </n-alert>
        <n-grid :cols="4" :x-gap="12" :y-gap="12">
          <n-gi v-for="item in panelSummary" :key="item.label">
            <div class="summary-card">
              <div class="summary-label">{{ item.label }}</div>
              <div class="summary-value">{{ item.value }}</div>
            </div>
          </n-gi>
        </n-grid>
      </n-card>

      <n-card title="加成来源明细" size="small" :bordered="true">
        <div class="debug-table-wrap">
          <table class="debug-table">
            <thead>
              <tr>
                <th>来源</th>
                <th>项目</th>
                <th>字段</th>
                <th>乘区</th>
                <th>模式</th>
                <th>数值</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in debugRows" :key="row.id">
                <td>{{ row.source }}</td>
                <td>{{ row.item }}</td>
                <td>
                  <n-tag size="small" :bordered="false">{{ row.label }}</n-tag>
                  <div class="stat-id">{{ row.stat }}</div>
                </td>
                <td><span class="zone-pill">{{ row.zone }}</span></td>
                <td>{{ row.mode }}</td>
                <td class="value-cell">{{ row.value }}</td>
                <td class="note-cell">{{ row.note }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="debugRows.length === 0" class="empty-state">请选择角色以查看字段明细</div>
      </n-card>

      <n-card title="当前公式乘区拆解" size="small" :bordered="true">
        <n-grid :cols="2" :x-gap="12" :y-gap="12">
          <n-gi v-for="section in formulaSections" :key="section.title">
            <div class="formula-card">
              <div class="formula-title">{{ section.title }}</div>
              <div class="formula-main">{{ section.formula }}</div>
              <div v-for="line in section.lines" :key="line" class="formula-line">{{ line }}</div>
            </div>
          </n-gi>
        </n-grid>
      </n-card>

      <n-card title="属性构成公式" size="small" :bordered="true">
        <n-grid :cols="2" :x-gap="12" :y-gap="12">
          <n-gi v-for="section in attributeFormulaSections" :key="section.title">
            <div class="formula-card attribute-formula-card">
              <div class="formula-title">{{ section.title }}</div>
              <div class="formula-main">{{ section.formula }}</div>
              <div v-for="line in section.lines" :key="line" class="formula-line">{{ line }}</div>
            </div>
          </n-gi>
        </n-grid>
      </n-card>

      <n-card title="已确认的实现口径" size="small" :bordered="true">
        <ul class="check-list">
          <li>涉及局外与局内两段的属性，先按局外汇总，再在局内继续叠加；没有局外/局内区分的字段直接在对应乘区汇总。</li>
          <li>覆盖率不是时间轴模拟，而是修改 Buff 数值后进入静态面板；最终伤害仍用当前静态属性表计算。</li>
          <li>`decibelGainEfficiency` 已接入开局、招式、奖励与队友伴随等喧响获得来源。</li>
          <li>`skillDmgBonus` 与 `stunBuildUpBonus` 支持按目标招式类型生效；复杂状态、特定段数仍建议用字段或资源轴单独建模。</li>
        </ul>
      </n-card>
    </n-space>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { NAlert, NCard, NGi, NGrid, NSelect, NSpace, NTag } from 'naive-ui'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { computePanel } from '@/composables/resourceCalc/helpers'
import { SKILL_DMG_TARGET_LABELS, normalizeSkillDamageTarget } from '@/core/buff'
import { fmt, pct } from '@/utils/format'
import { getStatMeta, isPctStat, phaseStatLabel } from '@/utils/statMeta'
import type { BuffEffect, BuffGroup, PanelValues, StatMode, TeammateBuff } from '@/types/catalog'

interface DebugRow {
  id: string
  source: string
  item: string
  stat: string
  label: string
  zone: string
  mode: string
  value: string
  note: string
}

const configStore = useConfigStore()
const catalogStore = useCatalogStore()

onMounted(async () => {
  await catalogStore.loadTeammateBuffs()
})

const selectedSlot = computed(() => configStore.selectedSlot)
const selectedChar = computed(() => configStore.team[selectedSlot.value])
const selectedAgent = computed(() => selectedChar.value?.agentId ? catalogStore.getAgent(selectedChar.value.agentId) : undefined)
const selectedWEngine = computed(() => selectedChar.value?.wEngineId ? catalogStore.getWEngine(selectedChar.value.wEngineId) : undefined)

const slotOptions = computed(() => configStore.team.map((char, index) => {
  const agent = char.agentId ? catalogStore.getAgent(char.agentId) : undefined
  return {
    label: `槽位 ${index + 1} · ${agent?.name.zhCN ?? agent?.name.en ?? '未选择'}`,
    value: index,
  }
}))

const enabledTeammateBuffs = computed<TeammateBuff[]>(() => {
  const result: TeammateBuff[] = []
  for (const group of catalogStore.teammateBuffGroups) {
    for (const buff of group.buffs ?? []) {
      if (configStore.isTeammateBuffEnabled(buff.id)) result.push(buff)
    }
  }
  return result
})

const currentPanel = computed<PanelValues | null>(() => {
  return computePanel(configStore.selectedSlot, configStore, catalogStore)
})

const panelSummary = computed(() => {
  const p = currentPanel.value
  if (!p) return []
  return [
    { label: '攻击力', value: fmt(p.atk, 0) },
    { label: '暴击', value: `${pct(p.critRate)} / ${pct(p.critDmg)}` },
    { label: '异常', value: `精通 ${fmt(p.anomalyProficiency, 0)} · 掌控 ${fmt(p.anomalyMastery, 0)}` },
    { label: '能量回复', value: `${fmt(p.energyRegen, 2)}/秒` },
  ]
})

function localized(obj: any): string {
  if (!obj) return ''
  if (typeof obj === 'string') return obj
  return obj.zhCN ?? obj.en ?? ''
}

function row(source: string, item: string, stat: string, value: number | string, mode: string, note?: string, labelOverride?: string): DebugRow {
  const meta = getStatMeta(stat)
  const displayMode = meta.mode
  const display = typeof value === 'number'
    ? (displayMode === 'pct' ? pct(value) : fmt(value, 2))
    : value
  return {
    id: `${source}-${item}-${stat}-${Math.random()}`,
    source,
    item,
    stat,
    label: labelOverride ?? meta.label,
    zone: meta.zone,
    mode,
    value: display,
    note: note ?? meta.description,
  }
}

function effectValue(effect: BuffEffect, modLevel?: number): number | string {
  const mod = (effect as any).modificationValues?.value
  if (mod && modLevel && mod[modLevel - 1] != null) return mod[modLevel - 1]
  if (effect.type === 'fixed') return effect.value
  if (effect.type === 'derived') {
    const source = localized((effect as any).sourceLabel) || effect.basis || '来源属性'
    return `${source} × ${effect.ratio ?? 0}%${effect.cap ? `，上限 ${effect.cap}` : ''}`
  }
  if (effect.type === 'stacked') {
    const perStack = effect.valuePerStack ?? effect.value
    const stacks = effect.defaultStacks ?? effect.maxStacks ?? 1
    return `${perStack} × ${stacks}层`
  }
  return effect.value
}

function addEffectRows(rows: DebugRow[], source: string, item: string, group: BuffGroup | null | undefined, modLevel?: number, extraNote = '') {
  const phase = group?.scope ?? 'outOfCombat'
  for (const effect of group?.effects ?? []) {
    if (!effect?.stat) continue
    rows.push(row(
      source,
      item,
      effect.stat,
      effectValue(effect, modLevel),
      effect.mode,
      `${localized(group?.name) || localized(group?.description) || getStatMeta(effect.stat).description}${extraNote ? `；${extraNote}` : ''}`,
      phaseStatLabel(effect.stat, phase),
    ))
  }
}

function addFlatRows(rows: DebugRow[]) {
  const agent = selectedAgent.value
  if (!agent) return
  const s = agent.level60
  rows.push(row('角色', '60级基础生命', 'hpFlat', s.hpBase, 'flat'))
  rows.push(row('角色', '60级基础攻击', 'atkFlat', s.atkBase, 'flat'))
  rows.push(row('角色', '60级基础防御', 'defFlat', s.defBase, 'flat'))
  rows.push(row('角色', '基础暴击率', 'critRate', s.critRate, 'pct'))
  rows.push(row('角色', '基础暴击伤害', 'critDmg', s.critDmg, 'pct'))
  rows.push(row('角色', '冲击力', 'impact', s.impact, 'pct'))
  rows.push(row('角色', '异常精通', 'anomalyProficiency', s.anomalyProficiency, 'flat'))
  rows.push(row('角色', '异常掌控', 'anomalyMastery', s.anomalyMastery, 'flat'))
  rows.push(row('角色', '基础能量回复', 'energyRegen', s.energyRegen, 'flat'))
  if (s.flashEnergyRegen) rows.push(row('角色', '基础闪能回复', 'flashEnergyRegen', s.flashEnergyRegen, 'flat'))
  rows.push(row('角色', '穿透率', 'penRatio', s.penRatio, 'pct'))
}

function addWEngineRows(rows: DebugRow[]) {
  const w = selectedWEngine.value
  const agent = selectedAgent.value
  const char = selectedChar.value
  if (!w || !agent || !char) return
  const wBaseStat = w.level60.baseStat ?? 'atk'
  const baseLabel = wBaseStat === 'def' ? '基础防御' : '基础攻击'
  const baseStatId = wBaseStat === 'def' ? 'defFlat' : 'atkFlat'
  rows.push(row('音擎', `${localized(w.name)} ${baseLabel}`, baseStatId, w.level60.atkBase, 'flat', `音擎白值直接加到${baseLabel}`, `${baseLabel}白值`))
  if (w.level60.advancedStat) {
    const adv = w.level60.advancedStat
    rows.push(row('音擎', `${localized(w.name)} 进阶属性`, adv.stat, adv.value, adv.mode, '音擎 60 级高级词条，属于局外属性', phaseStatLabel(adv.stat, 'outOfCombat')))
  }
  const match = w.specialty === agent.specialty
  addEffectRows(rows, '音擎', `${localized(w.name)} 自身效果`, w.effect?.selfBuff, char.wEngineModLevel, match ? '职业匹配，当前会生效' : '职业不匹配，当前计算不会生效')
  addEffectRows(rows, '音擎', `${localized(w.name)} 团队效果`, w.effect?.teamBuff, char.wEngineModLevel, match ? '职业匹配，当前会生效' : '职业不匹配，当前计算不会生效')
}

function addDriveRows(rows: DebugRow[]) {
  const char = selectedChar.value
  if (!char?.driveDisc) return
  const maxMain = catalogStore.statRules?.driveDisc.sRankMaxMainStat ?? {}
  for (const slot of [4, 5, 6] as const) {
    const stat = char.driveDisc.mainStats?.[slot]
    if (!stat) continue
    rows.push(row('驱动盘', `${slot}号位主词条`, stat, maxMain[stat] ?? 0, getStatMeta(stat).mode, 'S级驱动盘满级主词条，属于局外属性', phaseStatLabel(stat, 'outOfCombat')))
  }
  const subStep = catalogStore.statRules?.driveDisc.sRankSubStatBaseStep ?? {}
  for (const [stat, count] of Object.entries(char.driveDisc.subStatAllocation ?? {})) {
    if (!count) continue
    rows.push(row('驱动盘', `副词条 ${count} 步`, stat, (subStep as any)[stat] * count || 0, getStatMeta(stat).mode, `副词条步长 × 步数：${(subStep as any)[stat] ?? 0} × ${count}；驱动盘副词条属于局外属性`, phaseStatLabel(stat, 'outOfCombat')))
  }
  const four = char.driveDisc.fourPieceSetId ? catalogStore.getDriveDiscSet(char.driveDisc.fourPieceSetId) : undefined
  const two = char.driveDisc.twoPieceSetId ? catalogStore.getDriveDiscSet(char.driveDisc.twoPieceSetId) : undefined
  addEffectRows(rows, '驱动盘', `${localized(four?.name)} 2件套`, four?.twoPiece as any)
  addEffectRows(rows, '驱动盘', `${localized(four?.name)} 4件套自身`, four?.fourPiece?.selfBuff)
  addEffectRows(rows, '驱动盘', `${localized(four?.name)} 4件套团队`, four?.fourPiece?.teamBuff)
  if (two && two.id !== four?.id) addEffectRows(rows, '驱动盘', `${localized(two.name)} 2件套`, two.twoPiece as any)
}

function addTeamBuffRows(rows: DebugRow[]) {
  for (const buff of enabledTeammateBuffs.value) {
    const coverage = configStore.getTeammateBuffCoverage(buff.id)
    addEffectRows(
      rows,
      '队友 Buff',
      `${localized(buff.ownerName)} · ${localized(buff.sourceLabel) || buff.id}`,
      buff,
      undefined,
      `配置页滑块为 ${coverage}%；请注意现有面板计算主要读取 Buff 数据自身的默认 coverage`,
    )
  }
}

function addGlobalRows(rows: DebugRow[]) {
  for (const buff of configStore.globalBuffs) {
    if (!buff.enabled) continue
    const targetNote = buff.stat === 'skillDmgBonus' ? `；目标招式：${SKILL_DMG_TARGET_LABELS[normalizeSkillDamageTarget(buff.targetSkillType)]}` : ''
    rows.push(row('全局 Buff', buff.name, buff.stat, buff.value, isPctStat(buff.stat) ? 'pct' : 'flat', `属性配置页手动添加，直接应用到局内面板${targetNote}`, phaseStatLabel(buff.stat, 'inCombat')))
  }
}

const debugRows = computed<DebugRow[]>(() => {
  const rows: DebugRow[] = []
  if (!selectedAgent.value) return rows
  addFlatRows(rows)
  addEffectRows(rows, '角色 Buff', '核心被动', selectedAgent.value.combatBuffs?.corePassive)
  addEffectRows(rows, '角色 Buff', '额外能力', selectedAgent.value.combatBuffs?.additionalAbility)
  for (const cinema of selectedAgent.value.combatBuffs?.cinemaBuffs ?? []) {
    if (cinema.cinemaLevel <= selectedChar.value.cinemaLevel) {
      addEffectRows(rows, '角色 Buff', `影画${cinema.cinemaLevel} · ${localized(cinema.cinemaName)}`, cinema.buff)
    }
  }
  addWEngineRows(rows)
  addDriveRows(rows)
  addTeamBuffRows(rows)
  addGlobalRows(rows)
  return rows
})


function lineValue(stat: string): string {
  const p = currentPanel.value
  if (!p) return '-'
  const value = p[stat] ?? 0
  return isPctStat(stat) ? pct(value) : fmt(value, 2)
}

function elementDmgKey(): string {
  const element = selectedAgent.value?.damageElement
  const map: Record<string, string> = {
    physical: 'physicalDmg',
    fire: 'fireDmg',
    ice: 'iceDmg',
    electric: 'electricDmg',
    ether: 'etherDmg',
    wind: 'windDmg',
    lumiflux: 'lumifluxDmg',
  }
  return element ? map[element] ?? 'dmgBonus' : 'dmgBonus'
}

function elementSheerDmgBonus(): number {
  const p = currentPanel.value
  const element = selectedAgent.value?.damageElement
  if (!p || !element) return 0
  return p[`${element}SheerDmg`] ?? 0
}

const attributeFormulaSections = computed(() => {
  const p = currentPanel.value
  if (!p) return []
  const elementKey = elementDmgKey()
  const penetrationPower = p.atk * 0.3 + p.hp * 0.1 + (p.sheerForceFlat ?? 0)
  const penDmg = (p.penDmgBonus ?? 0) + (p.sheerDmgBonus ?? 0) + elementSheerDmgBonus()
  const skillTargeted = Object.entries(p)
    .filter(([key, value]) => key.startsWith('skillDmgBonus__') && value)
    .map(([key, value]) => `${key.replace('skillDmgBonus__', '')}:${pct(value as number)}`)
    .join('，') || '无定向招式增伤'
  const stunTargeted = Object.entries(p)
    .filter(([key, value]) => key.startsWith('stunBuildUpBonus__') && value)
    .map(([key, value]) => `${key.replace('stunBuildUpBonus__', '')}:${pct(value as number)}`)
    .join('，') || '无定向失衡提升'
  return [
    {
      title: '攻击 / 生命 / 防御 / 冲击力',
      formula: '局内数据 = (基础数据 × (1 + Σ局外百分比加成) + Σ局外固定值) × (1 + Σ局内百分比加成) + Σ局内固定值加成',
      lines: [
        `atk = ${lineValue('atk')}；hp = ${lineValue('hp')}；def = ${lineValue('def')}；impact = ${lineValue('impact')}`,
        '大词条=百分比加成，小词条=固定值加成；攻击/生命/防御/冲击力字段必须归入局外或局内其中一个阶段。',
        '局外百分比以基础白值为基数；局内百分比以局外总属性为基数；局内固定值在最终末尾追加。',
      ],
    },
    {
      title: '贯穿力',
      formula: 'sheerForce = 局内 atk × 0.3 + 局内 hp × 0.1 + sheerForceFlat',
      lines: [
        `= ${fmt(p.atk, 0)} × 0.3 + ${fmt(p.hp, 0)} × 0.1 + ${fmt(p.sheerForceFlat ?? 0, 0)} = ${fmt(penetrationPower, 0)}`,
        'sheerForceFlat 是固定贯穿力提升，只进入贯穿力本体，不进入贯穿增伤乘区。',
      ],
    },
    {
      title: '贯穿增伤',
      formula: 'penSheerMult = 1 + (penDmgBonus + sheerDmgBonus + 对应元素贯穿增伤) / 100',
      lines: [
        `贯穿增伤合计 = ${pct(p.penDmgBonus ?? 0)} + ${pct(p.sheerDmgBonus ?? 0)} + ${pct(elementSheerDmgBonus())} = ${pct(penDmg)}`,
        '这是命破/贯穿伤害独立乘区，和贯穿力本体、普通增伤区分开。',
      ],
    },
    {
      title: '增伤区',
      formula: 'dmgBonusZone = dmgBonus + elementDmg + skillDmgBonus(target)',
      lines: [
        `通用增伤 ${pct(p.dmgBonus ?? 0)}；当前元素字段 ${elementKey} = ${pct(p[elementKey] ?? 0)}`,
        `定向招式增伤：${skillTargeted}`,
      ],
    },
    {
      title: '失衡值',
      formula: 'stun = baseDaze × impact/100 × (1 + stunBuildUpBonus(target)/100) × taken × res',
      lines: [
        `impact = ${fmt(p.impact, 2)}；通用失衡提升 = ${pct(p.stunBuildUpBonus ?? 0)}`,
        `定向失衡提升：${stunTargeted}`,
      ],
    },
    {
      title: '异常积蓄 / 异常伤害',
      formula: 'buildUp = base × floor(anomalyMastery)/100 × (1 + (anomalyBuildUpEfficiency + elementAnomalyBuildUpEfficiency)/100)',
      lines: [
        `异常掌控 ${fmt(p.anomalyMastery, 2)}；积蓄效率 ${pct(p.anomalyBuildUpEfficiency ?? 0)}`,
        `异常精通 ${fmt(p.anomalyProficiency, 2)}；异常增伤 ${pct(p.anomalyDmgBonus ?? 0)}；异放增伤 ${pct(p.anomalyReleaseDmgBonus ?? 0)}`,
      ],
    },
  ]
})

const formulaSections = [
  {
    title: '直伤',
    formula: 'damage = basis × damageMultiplier × dmgBonus × def × res × taken × stun × crit × count',
    lines: [
      'basis：非命破 atk；命破贯穿力 = 局内 atk × 0.3 + 局内 hp × 0.1 + sheerForceFlat',
      'damageMultiplier 只读取倍率表直伤行；luminizeMultiplier 已单独派生为耀变直伤展示行',
      '命破角色防御区固定为 1；贯穿增伤 = penDmgBonus + sheerDmgBonus + 对应元素贯穿增伤，是独立额外乘区',
      'crit = 1 + min(critRate, 100%) × critDmg（期望）',
    ],
  },
  {
    title: '异常事件',
    formula: 'event = {type, source, count, formula, fields}；事件先记录次数，再由对应结算函数消费',
    lines: [
      '异常条触发：由 anomaly_buildup 推进积蓄条产生 anomaly_trigger',
      '覆盖事件：不同属性异常覆盖产生 disorder；有风角色时改为 turbulence',
      '动作跟随事件：如蕾米特殊虚耀跟随「普通攻击：垂虹」，count 来自资源池动作，不走直伤倍率',
      '后续薇薇安异放、惊鸿相关虚耀都应写成事件，而不是塞进 damageMultiplier 行',
    ],
  },
  {
    title: '异常积蓄',
    formula: 'perHitBuildUp = baseBuildUp × floor(anomalyMastery)/100 × (1 + (anomalyBuildUpEfficiency + elementAnomalyBuildUpEfficiency)/100) × (1 - effectiveAnomalyRes/100)',
    lines: [
      'effectiveAnomalyRes = enemyAnomalyResistances[element] - enemyAnomalyResReduction - enemy{Element}AnomalyResReduction',
      'triggerCount 不是 totalBuildUp / 固定3000；而是比较 BUILDUP_THRESHOLD_TABLE × bossCoeff × anomalyCoeff',
      '物理上限 ×1.2；风第1管50%、第2管90%、第3管起正常；第10管后沿用第10管上限',
    ],
  },
  {
    title: '紊乱',
    formula: 'count = min(sum - 1, 2 × (sum - max))；damage = anomalyMass(applier) × settlement(trigger) × events',
    lines: [
      'multiplier = base + disorderBaseMultiplierBonus + floor(T / tickInterval) × tickMultiplier',
      'anomalyMass = atk × multiplier × (1 + dmgBonus + elementDmg) × anomalyProficiency/100 × defense × levelMult(2)',
      'settlement = res × taken × stun × (1 + disorderDamageBonus)；当前不继承 anomalyDmgBonus 和异常暴击',
    ],
  },
  {
    title: '乱流',
    formula: 'count = min(Σ nonWindTriggerCount, 10)；damage = anomalyMass(nonWindApplier) × settlement(windPanel) × events',
    lines: [
      'T 使用非风异常持续时间；乱流3秒CD，多次风化窗口合并不封顶',
      'turbulenceMultiplier = base + floor(T / tickInterval) × tickMultiplier',
      'settlement 读取风角色抗性/易伤/失衡，并继承 anomalyDmgBonus 与 anomalyCrit；物理乱流额外继承 assaultCrit',
    ],
  },
  {
    title: '耀变与特殊虚耀',
    formula: 'luminizeMultiplier = base × (1 + remielleLuminizeMultiplierBonus/100) × (1 + remielleCinema4LuminizeMultiplierBonus/100) × triggerMultiplier',
    lines: [
      '耀变展示行读取 luminizeMultiplier，不使用 damageMultiplier；特殊虚耀 damageMultiplier = 0，只记异常事件次数',
      '特殊虚耀次数 = (remielleCinema1SpecialVoidflareCount + remielleCinema4SpecialVoidflareRefillCount) × remielleCinema6SpecialVoidflareTriggerMultiplier',
      '6命还保留 remielleCinema6FleetingGraceVoidflareTriggerMultiplier，后续接「惊鸿」事件时读取',
    ],
  },
  {
    title: '异放占位',
    formula: 'releaseDamage = virtualAnomalyMass × releaseMultiplier × releaseZones；当前未接入函数',
    lines: [
      '文档结论：异放继承原异常虚拟人面板，仅改写倍率区，不消耗原异常',
      '需要字段：releaseMultiplier、anomalyReleaseDmgBonus、releaseCritRate、releaseCritDmg、releaseDefShred',
      '接入时应作为 release 事件消费异常状态快照，而不是混入普通直伤或积蓄触发次数',
    ],
  },
]
</script>

<style scoped>
.debug-page {
  width: 100%;
}

.summary-card {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.summary-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 4px;
}

.summary-value {
  font-size: 16px;
  font-weight: 700;
  color: #facc15;
}

.debug-table-wrap {
  max-height: 560px;
  overflow: auto;
}

.debug-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.debug-table th,
.debug-table td {
  padding: 8px 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  vertical-align: top;
}

.debug-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  text-align: left;
  background: #15151a;
  color: rgba(255, 255, 255, 0.65);
  font-weight: 600;
}

.stat-id {
  margin-top: 3px;
  color: rgba(255, 255, 255, 0.35);
  font-family: Consolas, monospace;
  font-size: 11px;
}

.zone-pill {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.14);
  color: #93c5fd;
  white-space: nowrap;
}

.value-cell {
  color: #facc15;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.note-cell {
  min-width: 220px;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.5;
}

.empty-state {
  padding: 30px 0;
  text-align: center;
  color: rgba(255, 255, 255, 0.35);
}

.formula-card {
  min-height: 132px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.24);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.formula-title {
  font-size: 13px;
  font-weight: 700;
  color: #facc15;
  margin-bottom: 8px;
}

.formula-main,
.formula-line {
  font-family: Consolas, monospace;
  line-height: 1.7;
}

.formula-main {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.82);
}

.formula-line {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.52);
}

.check-list {
  margin: 0;
  padding-left: 18px;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.8;
  font-size: 12px;
}
.attribute-formula-card {
  min-height: 132px;
}
</style>
