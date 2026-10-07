<template>
  <n-card size="small" class="final-panel-card" :bordered="true">
    <template #header>
      <span>最终面板与乘区（局外 → 局内，与计算引擎同源）</span>
    </template>
    <div class="fp-hint">
      数据来自 <code>computePanelPhases</code>：局外 = 白值+音擎+驱动盘+角色自身局外 buff；局内 = 局外 + 队友/全局 buff + 角色机制修正（与伤害计算完全一致）。
      乘区按公式位置分组：<b>锐化增伤 / 贯穿增伤 / 异常增伤 / 紊乱增伤是独立乘区</b>，不是"增伤区"。
      调命座/装备后这里即刷新，可用于核对"某加成是否真的进了最终属性"。
    </div>

    <n-tabs v-model:value="activeSlot" type="line" size="small">
      <n-tab-pane v-for="(item, slot) in panels" :key="slot" :name="slot" :tab="item?.name ?? `槽位 ${slot + 1}`">
        <template v-if="item">
          <!-- 关键摘要 -->
          <n-grid :cols="6" :x-gap="8" :y-gap="8" style="margin-bottom: 10px">
            <n-gi v-for="s in item.summary" :key="s.label" class="fp-summary">
              <div class="fp-summary-label">{{ s.label }}</div>
              <div class="fp-summary-value">{{ s.value }}</div>
            </n-gi>
          </n-grid>

          <!-- 乘区数值汇总（按公式位置） -->
          <div class="fp-zones">
            <div class="fp-zone" v-for="z in item.zoneSummaries" :key="z.title">
              <div class="fp-zone-title">{{ z.title }}</div>
              <div class="fp-zone-main">{{ z.main }}</div>
              <div v-for="line in z.lines" :key="line" class="fp-zone-line">{{ line }}</div>
            </div>
          </div>

          <!-- 最终属性表（按乘区分组） -->
          <n-collapse :default-expanded-names="['basic', 'hp-sources']" size="small" style="margin-top: 10px">
            <n-collapse-item v-for="group in item.groups" :key="group.title" :title="group.title" :name="group.name">
              <template v-if="group.name === 'hp-sources'">
                <!-- 局内生命构成：来源明细 -->
                <div class="fp-hp-formula">
                  局外 hp {{ fmt(item.outHp, 0) }} × (1 + Σ局内生命% {{ pct(item.inHpPctTotal) }}) + Σ局内生命固定 {{ fmt(item.inHpFlatTotal, 0) }}<template v-if="Math.abs(item.residualHp) >= 0.5"> + 未逐条列出 {{ fmt(item.residualHp, 0) }}</template>
                  = 局内 hp <b class="fp-in">{{ fmt(item.inHp, 0) }}</b>
                </div>
                <table class="fp-table">
                  <thead>
                    <tr><th>来源</th><th>条目</th><th>字段</th><th>数值</th><th>阶段</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in item.hpSources" :key="r.key">
                      <td><span class="fp-stat-label">{{ r.source }}</span></td>
                      <td class="fp-note-cell">{{ r.item }}</td>
                      <td><span class="fp-stat-id">{{ r.stat }}</span></td>
                      <td class="fp-num fp-in">{{ r.value }}</td>
                      <td><span class="zone-pill" :class="r.phase === 'in' ? 'fp-phase-in' : ''">{{ r.phase === 'in' ? '局内' : '局外' }}</span></td>
                    </tr>
                    <tr v-if="Math.abs(item.residualHp) >= 0.5">
                      <td><span class="fp-stat-label">未逐条列出</span></td>
                      <td class="fp-note-cell">模块直写 / 转模 / 公式条目（引擎局内 hp − 按上表重建值）</td>
                      <td><span class="fp-stat-id">hp</span></td>
                      <td class="fp-num fp-in">{{ fmt(item.residualHp, 0) }}</td>
                      <td><span class="zone-pill fp-phase-in">局内</span></td>
                    </tr>
                    <tr v-if="item.hpSources.length === 0 && Math.abs(item.residualHp) < 0.5">
                      <td colspan="5" class="fp-empty-cell">无生命类 buff 来源</td>
                    </tr>
                  </tbody>
                </table>
              </template>
              <template v-else>
                <table class="fp-table">
                  <thead>
                    <tr>
                      <th>字段</th>
                      <th>局外</th>
                      <th>局内</th>
                      <th>Δ（局内-局外）</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in group.rows" :key="r.stat">
                      <td>
                        <span class="fp-stat-label">{{ r.label }}</span>
                        <div class="fp-stat-id">{{ r.stat }}</div>
                      </td>
                      <td class="fp-num">{{ r.out }}</td>
                      <td class="fp-num fp-in">{{ r.in }}</td>
                      <td class="fp-num" :class="r.delta === 0 ? 'fp-delta-zero' : 'fp-delta'">{{ r.deltaText }}</td>
                    </tr>
                  </tbody>
                </table>
              </template>
            </n-collapse-item>
          </n-collapse>
        </template>
        <div v-else class="fp-empty">该槽位未配置角色</div>
      </n-tab-pane>
    </n-tabs>
  </n-card>
</template>

<script setup lang="ts">
import { getPanelStat } from '@/utils/panelStat'
import { computed, onMounted, ref } from 'vue'
import { NCard, NCollapse, NCollapseItem, NGi, NGrid, NTabPane, NTabs } from 'naive-ui'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { collectHpSources, hpBreakdownTotals } from '@/composables/hpSourceBreakdown'
import { sharpCritMultiplier } from '@/data/sharpCritMultiplier'
import { clampCritRatePct, expectedCritMultiplier } from '@/data/critMultiplier'
import { calcPenetrationPower, penetrationPowerFormulaLabel, penetrationPowerFormulaText } from '@/data/penetrationPower'
import { isPctStat } from '@/utils/statMeta'
import { elementStatKey } from '@/utils/elementStatKeys'
import { fmt, pct } from '@/utils/format'
import type { PanelValues } from '@/types/catalog'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
/** 音擎效果覆盖率有效表（手调 ⊕ 自动折算，与伤害同口径）：由所在页面的 calc 实例传入（r706 起 store 无展示缓存） */
const props = defineProps<{ effectCoverages: Record<string, number> }>()
const activeSlot = ref(0)

onMounted(async () => {
  await catalogStore.loadTeammateBuffs()
})

/** 元素 → 面板增伤字段 */

interface FinalRow { stat: string; label: string; out: string; in: string; delta: number; deltaText: string }
interface ZoneSummary { title: string; main: string; lines: string[] }

function num(p: PanelValues | null, stat: string): number {
  return p ? (getPanelStat(p, stat) ?? 0) : 0
}
function disp(stat: string, v: number): string {
  return isPctStat(stat) ? pct(v) : fmt(v, 2)
}
function makeRow(pOut: PanelValues, pIn: PanelValues, stat: string, label: string): FinalRow {
  const out = num(pOut, stat)
  const inn = num(pIn, stat)
  const delta = inn - out
  return {
    stat, label,
    out: disp(stat, out),
    in: disp(stat, inn),
    delta,
    deltaText: Math.abs(delta) < 1e-9 ? '0' : `${delta > 0 ? '+' : ''}${disp(stat, delta)}`,
  }
}

function targetedRows(pIn: PanelValues, prefix: string, labelOf: (t: string) => string): { stat: string; label: string; value: number }[] {
  return Object.entries(pIn)
    .filter(([key, v]) => key.startsWith(`${prefix}__`) && v)
    .map(([key, v]) => ({ stat: key, label: `${labelOf(key.replace(`${prefix}__`, ''))}（定向）`, value: v as number }))
}

const panels = computed(() => {
  return [0, 1, 2].map(slot => {
    const char = configStore.team[slot]
    if (!char?.agentId) return null
    const phases = computePanelPhases(slot, configStore, catalogStore, props.effectCoverages)
    if (!phases) return null
    const pOut = phases.outOfCombat
    const pIn = phases.inCombat
    const agent = catalogStore.getAgent(char.agentId)
    const name = agent?.name?.zhCN || char.agentId
    const element = agent?.damageElement ?? ''
    // CC-224：单一来源 utils/elementStatKeys（经 resolveStatElement）。无元素 ⇒ undefined，不再回落通用字段（旧 `?? 'dmgBonus'` 会把通用增伤算两遍）
    const elementDmgKey = elementStatKey('dmg', element)
    const elementResKey = elementStatKey('enemyRes', element)
    const elementSheerKey = elementStatKey('sheerDmg', element) ?? ''
    const elementSharpKey = elementStatKey('sharpDmg', element) ?? ''
    const isRupture = agent?.specialty === 'rupture'
    const isSharpen = agent?.specialty === 'sharpen'
    const penPower = calcPenetrationPower(pIn)

    const skillTargeted = targetedRows(pIn, 'skillDmgBonus', t => t)
    const stunTargeted = targetedRows(pIn, 'stunBuildUpBonus', t => t)

    // ---- 生命构成（局内大生命来源） ----
    // CC-209：拆解逻辑迁至 composables/hpSourceBreakdown.ts（覆盖率与引擎同表 + 差额行）
    const hpSources = collectHpSources(slot, configStore, catalogStore, props.effectCoverages)
    const { inHpPctTotal, inHpFlatTotal, residualHp } = hpBreakdownTotals(hpSources, pOut.hp ?? 0, pIn.hp ?? 0)

    // ---- 属性表分组 ----
    const baseRows: FinalRow[] = [
      makeRow(pOut, pIn, 'hp', '生命值'),
      makeRow(pOut, pIn, 'atk', '攻击力'),
      makeRow(pOut, pIn, 'def', '防御力'),
      makeRow(pOut, pIn, 'impact', '冲击力'),
      makeRow(pOut, pIn, 'penRatio', '穿透率'),
      makeRow(pOut, pIn, 'penFlat', '穿透值'),
      makeRow(pOut, pIn, 'sheerForceFlat', '贯穿力固定提升'),
    ]
    if (isRupture) {
      baseRows.push({
        stat: 'penPower', label: `贯穿力合计（${penetrationPowerFormulaLabel('atk', 'hp', '固定')}）`, out: disp('penPower', 0), in: disp('penPower', penPower),
        delta: penPower, deltaText: fmt(penPower, 0),
      })
    }

    // 直伤增伤区：只有通用/元素/招式三类（锐化/贯穿/异常/紊乱是独立乘区）
    const dmgRows: FinalRow[] = [
      makeRow(pOut, pIn, 'dmgBonus', '通用增伤'),
      ...(elementDmgKey ? [makeRow(pOut, pIn, elementDmgKey, `元素增伤（${element}）`)] : []),
      makeRow(pOut, pIn, 'skillDmgBonus', '全招式增伤'),
    ]
    for (const r of skillTargeted) {
      dmgRows.push({
        stat: r.stat, label: r.label, out: disp(r.stat, 0), in: disp(r.stat, r.value),
        delta: r.value, deltaText: `+${disp(r.stat, r.value)}`,
      })
    }

    // 锐化增伤区（锋御独立乘区，直伤公式 3.5）
    const sharpRows: FinalRow[] = [makeRow(pOut, pIn, 'sharpDmgBonus', '锐化增伤（通用）')]
    if (elementSharpKey) sharpRows.push(makeRow(pOut, pIn, elementSharpKey, `元素锐化增伤（${element}）`))

    // 贯穿增伤区（命破独立乘区，直伤公式 4）
    const sheerRows: FinalRow[] = [
      makeRow(pOut, pIn, 'penDmgBonus', '贯穿增伤'),
      makeRow(pOut, pIn, 'sheerDmgBonus', '贯穿伤害提升'),
    ]
    if (elementSheerKey) sheerRows.push(makeRow(pOut, pIn, elementSheerKey, `元素贯穿增伤（${element}）`))

    // 暴击区（直伤暴击；异常暴击在异常区）
    const critRows = [
      makeRow(pOut, pIn, 'critRate', '暴击率'),
      makeRow(pOut, pIn, 'critDmg', '暴击伤害'),
      makeRow(pOut, pIn, 'sharpCritDmg', '锐暴伤害'),
      makeRow(pOut, pIn, 'assaultCritRate', '强击暴击率'),
      makeRow(pOut, pIn, 'assaultCritDmg', '强击暴击伤害'),
    ]

    const debuffRows = [
      makeRow(pOut, pIn, 'enemyResReduction', '全属性减抗'),
      ...(elementResKey ? [makeRow(pOut, pIn, elementResKey, `元素减抗（${element}）`)] : []),
      makeRow(pOut, pIn, 'enemyDefReduction', '减防（%）'),
      makeRow(pOut, pIn, 'enemyDefFlatReduction', '减防（固定）'),
      makeRow(pOut, pIn, 'enemyDamageTakenBonus', '敌人受伤害提升（易伤）'),
      makeRow(pOut, pIn, 'enemyCritDmgTakenBonus', '敌人受暴伤提升'),
      makeRow(pOut, pIn, 'enemyStunTakenBonus', '敌人受失衡提升'),
      makeRow(pOut, pIn, 'stunDmgMultiplierBonus', '失衡易伤'),
      makeRow(pOut, pIn, 'stunDmgMultiplierBonusAlways', '失衡易伤（常驻）'),
      makeRow(pOut, pIn, 'stunBuildUpBonus', '失衡值提升'),
    ]
    for (const r of stunTargeted) {
      debuffRows.push({
        stat: r.stat, label: r.label, out: disp(r.stat, 0), in: disp(r.stat, r.value),
        delta: r.value, deltaText: `+${disp(r.stat, r.value)}`,
      })
    }

    // 异常区：积蓄 + 异常增伤/异放/乱流/紊乱（各自独立乘区位置）+ 异常暴击
    const anomalyRows = [
      makeRow(pOut, pIn, 'anomalyProficiency', '异常精通'),
      makeRow(pOut, pIn, 'anomalyMastery', '异常掌控'),
      makeRow(pOut, pIn, 'anomalyBuildUpEfficiency', '异常积蓄效率'),
      makeRow(pOut, pIn, 'physicalAnomalyBuildUpEfficiency', '物理积蓄效率'),
      makeRow(pOut, pIn, 'electricAnomalyBuildUpEfficiency', '电积蓄效率'),
      makeRow(pOut, pIn, 'anomalyDmgBonus', '异常增伤（异常公式）'),
      makeRow(pOut, pIn, 'windAnomalyDmgBonus', '风化异常增伤'),
      makeRow(pOut, pIn, 'anomalyReleaseDmgBonus', '异放增伤（独立区）'),
      makeRow(pOut, pIn, 'turbulenceDamageBonus', '乱流增伤'),
      makeRow(pOut, pIn, 'disorderDamageBonus', '紊乱增伤（结算区）'),
      makeRow(pOut, pIn, 'anomalyCritRate', '异常暴击率'),
      makeRow(pOut, pIn, 'anomalyCritDmg', '异常暴击伤害'),
    ]

    const resourceRows = [
      makeRow(pOut, pIn, 'energyRegen', '能量回复'),
      makeRow(pOut, pIn, 'energyRegenBonusPct', '回能百分比'),
      makeRow(pOut, pIn, 'energyRegenBonusFlat', '回能固定'),
      makeRow(pOut, pIn, 'energyGainEfficiency', '能量获得效率'),
      makeRow(pOut, pIn, 'flashEnergyRegen', '闪能回复'),
      makeRow(pOut, pIn, 'flashEnergyRegenBonusFlat', '闪能回复固定'),
      makeRow(pOut, pIn, 'flashEnergyGainEfficiency', '闪能获得效率'),
      makeRow(pOut, pIn, 'decibelGainEfficiency', '喧响获得效率'),
      makeRow(pOut, pIn, 'energyMax', '能量上限'),
      makeRow(pOut, pIn, 'flashEnergyMax', '闪能上限'),
      makeRow(pOut, pIn, 'skillLevelBonus', '技能等级提升（3/5命）'),
      makeRow(pOut, pIn, 'stunDurationBonusSeconds', '失衡持续时间延长（秒）'),
    ]

    // ---- 乘区数值汇总（直伤链 / 异常链，按公式位置） ----
    const elementDmg = elementDmgKey ? getPanelStat(pIn, elementDmgKey) ?? 0 : 0
    const elementRes = elementResKey ? getPanelStat(pIn, elementResKey) ?? 0 : 0
    const skillDmg = pIn.skillDmgBonus ?? 0
    const dmgTotal = (pIn.dmgBonus ?? 0) + elementDmg + skillDmg
    const critRateRaw = pIn.critRate ?? 0
    const critRate = clampCritRatePct(critRateRaw)
    // 锋御：锐暴 200% 封顶 + 额外锐暴乘算（用户口径 2026-09-09）
    const critMult = isSharpen
      ? sharpCritMultiplier(critRateRaw, pIn.sharpCritDmg ?? 0)
      : expectedCritMultiplier(critRateRaw, pIn.critDmg ?? 0)
    const sharpTotal = (pIn.sharpDmgBonus ?? 0) + (elementSharpKey ? (getPanelStat(pIn, elementSharpKey) ?? 0) : 0)
    const penDmgTotal = (pIn.penDmgBonus ?? 0) + (pIn.sheerDmgBonus ?? 0) + (elementSheerKey ? (getPanelStat(pIn, elementSheerKey) ?? 0) : 0)
    const resTotal = (pIn.enemyResReduction ?? 0) + elementRes
    const stunMultTotal = (pIn.stunDmgMultiplierBonus ?? 0) + (pIn.stunDmgMultiplierBonusAlways ?? 0)
    // CC-223：风异常增伤只对风属性异常生效（引擎按异常元素判定：damage.ts / anomalyPool helpers），不并入通用异常增伤，单列
    const anomalyDmgTotal = pIn.anomalyDmgBonus ?? 0
    const windAnomalyDmg = pIn.windAnomalyDmgBonus ?? 0
    // CC-222：与引擎同源（此前只钳上限、负暴击率不按 0，且运算顺序与引擎不同）
    const anomalyCritRate = clampCritRatePct(pIn.anomalyCritRate ?? 0)
    const anomalyCritMult = expectedCritMultiplier(pIn.anomalyCritRate ?? 0, pIn.anomalyCritDmg ?? 0)

    const zoneSummaries: ZoneSummary[] = [
      {
        title: '基础区',
        main: isRupture
          ? `贯穿力 ${fmt(penPower, 0)} = ${penetrationPowerFormulaText(pIn, n => fmt(n, 0))}`
          : `攻击力 ${fmt(pIn.atk, 0)}${isSharpen ? ` · 防御力基底 ${fmt(pIn.def, 0)}（锋御）` : ''}`,
        lines: isRupture ? ['命破伤害基底，无视防御'] : isSharpen ? ['锋御伤害基底，防御力区'] : ['非命破伤害基底'],
      },
      {
        title: '直伤增伤乘区（仅 通用+元素+招式）',
        main: `1 + ${pct(dmgTotal)} = ${fmt(1 + dmgTotal / 100, 4)}`,
        lines: [
          `通用 ${pct(pIn.dmgBonus ?? 0)} + 元素 ${pct(elementDmg)} + 全招式 ${pct(skillDmg)}`,
          ...skillTargeted.map(r => `定向 ${r.label} ${pct(r.value)}`),
          '锐化/贯穿/异常/紊乱增伤不在本区，见对应乘区',
        ],
      },
      {
        title: '锐化增伤乘区（锋御独立，公式3.5）',
        main: `1 + ${pct(sharpTotal)} = ${fmt(1 + sharpTotal / 100, 4)}`,
        lines: [`锐化增伤 ${pct(pIn.sharpDmgBonus ?? 0)}${elementSharpKey ? ` + 元素锐化 ${pct(getPanelStat(pIn, elementSharpKey) ?? 0)}` : ''}`, '仅锋御（防御力基底）角色生效'],
      },
      {
        title: '贯穿增伤乘区（命破独立，公式4）',
        main: `1 + ${pct(penDmgTotal)} = ${fmt(1 + penDmgTotal / 100, 4)}`,
        lines: [`贯穿增伤 ${pct(pIn.penDmgBonus ?? 0)} + 贯穿伤害 ${pct(pIn.sheerDmgBonus ?? 0)}${elementSheerKey ? ` + 元素贯穿 ${pct(getPanelStat(pIn, elementSheerKey) ?? 0)}` : ''}`, '仅命破（贯穿力基底）角色生效'],
      },
      isSharpen
        ? {
            title: '锐暴乘区（期望）',
            main: `锐暴伤害 ${pct(pIn.sharpCritDmg ?? 0)} · 暴击率 ${pct(critRateRaw)} → ${fmt(critMult, 4)}`,
            lines: ['锐暴 200% 封顶：100% 以上每 1% 是一次额外锐暴判定，锐暴乘算（爆两次 = 平方）'],
          }
        : {
            title: '暴击乘区（期望）',
            main: `1 + ${pct(critRate)} × ${pct(pIn.critDmg ?? 0)} = ${fmt(critMult, 4)}`,
            lines: ['暴击率按 100% 封顶；锐暴/强击暴击走各自字段'],
          },
      {
        title: '抗性削减 / 易伤 / 失衡',
        main: `全 ${pct(pIn.enemyResReduction ?? 0)} + ${element} ${pct(elementRes)} = ${pct(resTotal)}`,
        lines: [
          `敌人受伤害 +${pct(pIn.enemyDamageTakenBonus ?? 0)} · 失衡易伤 +${pct(stunMultTotal)} · 暴击易伤 +${pct(pIn.enemyCritDmgTakenBonus ?? 0)}`,
          `冲击力 ${fmt(pIn.impact, 0)} · 失衡值提升 ${pct(pIn.stunBuildUpBonus ?? 0)}${stunTargeted.map(r => ` + ${r.label} ${pct(r.value)}`).join('')} · 失衡时长 +${fmt(pIn.stunDurationBonusSeconds ?? 0, 1)}s`,
        ],
      },
      {
        title: '异常链（异常公式/紊乱/异放/乱流）',
        main: `异常增伤 ${pct(anomalyDmgTotal)}${windAnomalyDmg ? `（风属性异常另 +${pct(windAnomalyDmg)}）` : ''} · 紊乱增伤 ${pct(pIn.disorderDamageBonus ?? 0)}（结算区）`,
        lines: [
          `异放增伤 ${pct(pIn.anomalyReleaseDmgBonus ?? 0)} · 乱流增伤 ${pct(pIn.turbulenceDamageBonus ?? 0)}`,
          `异常暴击期望 1 + ${pct(anomalyCritRate)} × ${pct(pIn.anomalyCritDmg ?? 0)} = ${fmt(anomalyCritMult, 4)}`,
          '异常增伤/紊乱/异放/乱流各在异常公式的不同位置，互不混入直伤增伤区',
        ],
      },
    ]

    return {
      name,
      outHp: pOut.hp ?? 0,
      inHp: pIn.hp ?? 0,
      inHpPctTotal,
      inHpFlatTotal,
      residualHp,
      hpSources,
      summary: [
        { label: '攻击', value: fmt(pIn.atk, 0) },
        { label: '生命', value: fmt(pIn.hp, 0) },
        { label: '暴击', value: `${pct(pIn.critRate)} / ${pct(pIn.critDmg)}` },
        { label: isRupture ? '贯穿力' : '冲击力', value: fmt(isRupture ? penPower : pIn.impact, 0) },
        { label: '精通', value: fmt(pIn.anomalyProficiency, 0) },
        { label: '喧响效率', value: pct(pIn.decibelGainEfficiency) },
      ],
      zoneSummaries,
      groups: [
        { title: '基础属性', name: 'basic', rows: baseRows },
        { title: '局内生命构成（来源明细）', name: 'hp-sources', rows: [] as FinalRow[] },
        { title: '直伤增伤区（通用+元素+招式）', name: 'dmg', rows: dmgRows },
        { title: '锐化增伤区（锋御独立乘区）', name: 'sharp', rows: sharpRows },
        { title: '贯穿增伤区（命破独立乘区）', name: 'sheer', rows: sheerRows },
        { title: '暴击区（直伤）', name: 'crit', rows: critRows },
        { title: '减益区（对敌）', name: 'debuff', rows: debuffRows },
        { title: '异常区（积蓄/异常增伤/紊乱/异放/乱流）', name: 'anomaly', rows: anomalyRows },
        { title: '资源区', name: 'resource', rows: resourceRows },
      ],
    }
  })
})
</script>

<style scoped>
.final-panel-card {
  margin-top: 10px;
}
.fp-hint {
  font-size: 11px;
  color: var(--wa-450);
  margin-bottom: 10px;
  line-height: 1.6;
}
.fp-hint code {
  font-family: Consolas, monospace;
  color: var(--wa-700);
}
.fp-summary {
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--wa-40);
  border: 1px solid var(--wa-60);
}
.fp-summary-label {
  font-size: 10px;
  color: var(--wa-450);
}
.fp-summary-value {
  font-size: 13px;
  font-weight: 700;
  color: var(--c-warning);
  font-variant-numeric: tabular-nums;
}
.fp-zones {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 8px;
}
.fp-zone {
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--app-inset);
  border: 1px solid var(--wa-60);
}
.fp-zone-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--c-info);
  margin-bottom: 4px;
}
.fp-zone-main {
  font-size: 12px;
  color: var(--c-warning);
  font-family: Consolas, monospace;
  margin-bottom: 4px;
}
.fp-zone-line {
  font-size: 10.5px;
  color: var(--wa-500);
  font-family: Consolas, monospace;
  line-height: 1.6;
}
.fp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
}
.fp-table th, .fp-table td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--wa-50);
  text-align: left;
}
.fp-table th {
  color: var(--wa-500);
  font-weight: 600;
  font-size: 10.5px;
}
.fp-stat-label {
  color: var(--wa-750);
}
.fp-stat-id {
  font-family: Consolas, monospace;
  font-size: 9.5px;
  color: var(--wa-300);
}
.fp-num {
  font-variant-numeric: tabular-nums;
  color: var(--wa-650);
  white-space: nowrap;
}
.fp-in {
  color: var(--c-warning);
}
.fp-delta {
  color: #6ee7b7;
}
.fp-delta-zero {
  color: var(--wa-300);
}
.fp-empty {
  padding: 24px 0;
  text-align: center;
  color: var(--wa-350);
}
.fp-hp-formula {
  font-size: 11px;
  color: var(--wa-600);
  font-family: Consolas, monospace;
  margin-bottom: 6px;
  line-height: 1.7;
}
.fp-note-cell {
  color: var(--wa-550);
  font-size: 11px;
}
.fp-phase-in {
  background: rgba(250, 204, 21, 0.16);
  color: var(--c-warning);
}
.fp-empty-cell {
  text-align: center;
  color: var(--wa-300);
  padding: 12px 0;
}
.zone-pill {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.14);
  color: var(--c-info);
  font-size: 10px;
  white-space: nowrap;
}
</style>
