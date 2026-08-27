<template>
  <div class="wengine-field-page">
    <n-space vertical :size="16">
      <n-card size="small" :bordered="true">
        <template #header>
          <n-space align="center" justify="space-between" style="width: 100%">
            <span>音擎字段总览</span>
            <span class="summary-text">S级 {{ summary.s }} 个 · A级 {{ summary.a }} 个 · 已实现字段 {{ summary.effectCount }} 条</span>
          </n-space>
        </template>
        <n-alert type="info" :bordered="false" style="margin-bottom: 12px">
          把所有 S级 / A级音擎按列表展开，展示当前 catalog 中已接入的基础字段、副词条、效果字段、精炼取值、叠层与覆盖率，不需要再下拉逐个切换。
        </n-alert>
        <n-space align="center" :size="12" wrap>
          <n-input v-model:value="keyword" clearable size="small" placeholder="搜索音擎名称 / ID / 字段" style="width: 260px" />
          <n-button v-for="item in rarityFilters" :key="item.value" size="small" :type="rarityFilter === item.value ? 'primary' : 'default'" @click="rarityFilter = item.value">{{ item.label }}</n-button>
          <n-button v-for="item in specialtyFilters" :key="item.value" size="small" :type="specialtyFilter === item.value ? 'primary' : 'default'" @click="specialtyFilter = item.value">{{ item.label }}</n-button>
        </n-space>
      </n-card>

      <n-grid :cols="1" :x-gap="12" :y-gap="12">
        <n-gi v-for="engine in filteredEngines" :key="engine.id">
          <n-card size="small" :bordered="true" class="engine-card">
            <template #header>
              <div class="engine-header">
                <div><span class="engine-name">{{ localized(engine.name) }}</span><span class="engine-id">#{{ engine.id }}</span></div>
                <n-space :size="6">
                  <n-tag size="small" :type="engine.rarity === 'S' ? 'warning' : 'info'" :bordered="false">{{ engine.rarity }}级</n-tag>
                  <n-tag size="small" :bordered="false">{{ specialtyLabel(engine.specialty) }}</n-tag>
                </n-space>
              </div>
            </template>

            <n-grid :cols="3" :x-gap="12" :y-gap="12" responsive="screen">
              <n-gi>
                <div class="section-box">
                  <div class="section-title">基础字段</div>
                  <div class="field-line"><span class="field-label">{{ engine.level60.baseStat === 'def' ? '基础防御' : '基础攻击' }}</span><span class="field-value">{{ engine.level60.atkBase }}</span></div>
                  <div v-if="engine.level60.advancedStat" class="field-line"><span class="field-label">{{ statLabel(engine.level60.advancedStat.stat) }}</span><span class="field-value">{{ formatAdvancedStat(engine.level60.advancedStat) }}</span></div>
                  <div v-if="engine.effect?.requirement" class="requirement-line">生效要求：{{ localized(engine.effect.requirement.label) }}</div>
                </div>
              </n-gi>
              <n-gi>
                <div class="section-box">
                  <div class="section-title">效果文本</div>
                  <div class="effect-name">{{ localized(engine.effect?.name) || '未命名效果' }}</div>
                  <div class="effect-desc">{{ localized(engine.effect?.description) || '暂无描述' }}</div>
                </div>
              </n-gi>
              <n-gi>
                <div class="section-box">
                  <div class="section-title">实现概况</div>
                  <div class="field-line"><span class="field-label">自身字段</span><span class="field-value">{{ collectRows(engine, 'self').length }}</span></div>
                  <div class="field-line"><span class="field-label">团队字段</span><span class="field-value">{{ collectRows(engine, 'team').length }}</span></div>
                </div>
              </n-gi>
            </n-grid>

            <div class="implemented-block">
              <div class="section-title">已实现字段</div>
              <div v-if="collectRows(engine).length > 0" class="field-table-wrap">
                <table class="field-table">
                  <thead><tr><th>来源</th><th>字段</th><th>乘区</th><th>模式</th><th>类型</th><th>数值 / 精炼</th><th>叠层 / 覆盖</th><th>说明</th></tr></thead>
                  <tbody>
                    <tr v-for="row in collectRows(engine)" :key="row.id">
                      <td><n-tag size="tiny" :bordered="false">{{ row.source }}</n-tag></td>
                      <td><n-tag size="small" :bordered="false">{{ row.label }}</n-tag><div class="stat-id">{{ row.stat }}</div></td>
                      <td><span class="zone-pill">{{ row.zone }}</span></td>
                      <td>{{ row.mode }}</td>
                      <td>{{ row.type }}</td>
                      <td class="value-cell">{{ row.valueText }}</td>
                      <td class="note-cell">{{ row.stackCoverageText }}</td>
                      <td class="note-cell">{{ row.note }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-else class="empty-state">当前仅接入基础攻击与副词条，音擎效果尚未实现为 buff 字段。</div>
            </div>
          </n-card>
        </n-gi>
      </n-grid>
      <n-empty v-if="filteredEngines.length === 0" description="没有匹配的 S/A 音擎" />
    </n-space>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { NAlert, NButton, NCard, NEmpty, NGi, NGrid, NInput, NSpace, NTag } from 'naive-ui'
import { useCatalogStore } from '@/stores/catalog'
import { getStatMeta, phaseStatLabel } from '@/utils/statMeta'
import type { BuffEffect, BuffGroup, Specialty, WEngine, WEngineAdvancedStat } from '@/types/catalog'

interface FieldRow { id: string; source: string; stat: string; label: string; zone: string; mode: string; type: string; valueText: string; stackCoverageText: string; note: string }

const catalogStore = useCatalogStore()
const keyword = ref('')
const rarityFilter = ref<'all' | 'S' | 'A'>('all')
const specialtyFilter = ref<'all' | Specialty>('all')
const rarityFilters = [{ label: '全部稀有度', value: 'all' as const }, { label: 'S级', value: 'S' as const }, { label: 'A级', value: 'A' as const }]
const specialtyFilters = [
  { label: '全部职业', value: 'all' as const }, { label: '强攻', value: 'attack' as const }, { label: '击破', value: 'stun' as const },
  { label: '异常', value: 'anomaly' as const }, { label: '支援', value: 'support' as const }, { label: '防护', value: 'defense' as const }, { label: '命破', value: 'rupture' as const },
]

const engines = computed(() => catalogStore.displayWEngines.filter(e => e.rarity === 'S' || e.rarity === 'A').slice().sort((a, b) => {
  const rarityOrder = a.rarity === b.rarity ? 0 : a.rarity === 'S' ? -1 : 1
  if (rarityOrder !== 0) return rarityOrder
  return specialtyLabel(a.specialty).localeCompare(specialtyLabel(b.specialty), 'zh-Hans-CN') || localized(a.name).localeCompare(localized(b.name), 'zh-Hans-CN')
}))

const filteredEngines = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return engines.value.filter(engine => {
    if (rarityFilter.value !== 'all' && engine.rarity !== rarityFilter.value) return false
    if (specialtyFilter.value !== 'all' && engine.specialty !== specialtyFilter.value) return false
    if (!q) return true
    const fields = collectRows(engine).map(row => `${row.stat} ${row.label} ${row.note}`).join(' ')
    return [engine.id, localized(engine.name), localized(engine.effect?.name), localized(engine.effect?.description), specialtyLabel(engine.specialty), fields].join(' ').toLowerCase().includes(q)
  })
})

const summary = computed(() => ({
  s: engines.value.filter(e => e.rarity === 'S').length,
  a: engines.value.filter(e => e.rarity === 'A').length,
  effectCount: engines.value.reduce((sum, engine) => sum + collectRows(engine).length, 0),
}))

function localized(obj: any): string { if (!obj) return ''; if (typeof obj === 'string') return obj; return obj.zhCN ?? obj.en ?? '' }
function specialtyLabel(specialty: string): string { return ({ attack: '强攻', stun: '击破', anomaly: '异常', support: '支援', defense: '防护', rupture: '命破', edgeguard: '戍卫', sharpen: '锐化' } as Record<string, string>)[specialty] ?? specialty }
function statLabel(stat: string): string {
  const mode = stat === 'impact' ? 'impactPct' : stat
  return phaseStatLabel(mode, 'outOfCombat')
}

function phaseStatId(stat: string, scope?: 'outOfCombat' | 'inCombat'): string {
  const map: Record<string, Record<'outOfCombat' | 'inCombat', string>> = {
    hpPct: { outOfCombat: 'outOfCombatHpPct', inCombat: 'inCombatHpPct' },
    hpFlat: { outOfCombat: 'outOfCombatHpFlat', inCombat: 'inCombatHpFlat' },
    atkPct: { outOfCombat: 'outOfCombatAtkPct', inCombat: 'inCombatAtkPct' },
    atkFlat: { outOfCombat: 'outOfCombatAtkFlat', inCombat: 'inCombatAtkFlat' },
    defPct: { outOfCombat: 'outOfCombatDefPct', inCombat: 'inCombatDefPct' },
    defFlat: { outOfCombat: 'outOfCombatDefFlat', inCombat: 'inCombatDefFlat' },
    impactPct: { outOfCombat: 'outOfCombatImpactPct', inCombat: 'inCombatImpactPct' },
    impactFlat: { outOfCombat: 'outOfCombatImpactFlat', inCombat: 'inCombatImpactFlat' },
  }
  const phase = scope ?? 'inCombat'
  return map[stat]?.[phase] ?? stat
}
function formatAdvancedStat(stat: WEngineAdvancedStat): string { return stat.mode === 'pct' || stat.mode === 'decimal' ? `${stat.value}%` : String(stat.value) }
function modificationSeries(effect: BuffEffect, key: 'value' | 'valuePerStack'): number[] | null { const raw = (effect as any).modificationValues?.[key]; return Array.isArray(raw) ? raw : null }
function valueText(effect: BuffEffect): string {
  const values = modificationSeries(effect, 'value')
  const perStackValues = modificationSeries(effect, 'valuePerStack')
  if (perStackValues) return perStackValues.map((v, i) => `${i + 1}精:${v}×${effect.defaultStacks ?? effect.maxStacks ?? 1}层`).join(' / ')
  if (values) return values.map((v, i) => `${i + 1}精:${v}`).join(' / ')
  if (effect.type === 'stacked') return `${effect.valuePerStack ?? effect.value} × ${effect.defaultStacks ?? effect.maxStacks ?? 1}层`
  if (effect.type === 'derived') return `${localized((effect as any).sourceLabel) || effect.basis || effect.sourceStat || '来源属性'} × ${effect.ratio ?? 0}%${effect.cap ? `，上限 ${effect.cap}` : ''}`
  if (effect.type === 'formula') return effect.formula?.expression ?? '公式'
  return `${effect.value ?? 0}`
}
function stackCoverageText(effect: BuffEffect): string {
  const parts: string[] = []
  if (effect.type === 'stacked') parts.push(`${localized((effect as any).stackLabel) || '叠层'} ${effect.defaultStacks ?? effect.maxStacks ?? 1}/${effect.maxStacks ?? effect.defaultStacks ?? 1}`)
  if (effect.coverage) parts.push(`覆盖 ${effect.coverage.default}%（${effect.coverage.min}-${effect.coverage.max}，步进${effect.coverage.step}）`)
  else if (effect.type === 'stacked') parts.push('覆盖默认 100%')
  if (effect.targetSkillType) parts.push(`招式目标 ${effect.targetSkillType}`)
  return parts.join('；') || '-'
}
function groupRows(engine: WEngine, group: BuffGroup | null | undefined, source: string): FieldRow[] {
  return (group?.effects ?? []).filter(effect => !!effect?.stat).map(effect => {
    const meta = getStatMeta(effect.stat)
    return { id: `${engine.id}-${source}-${effect.id}`, source, stat: phaseStatId(effect.stat, group?.scope), label: phaseStatLabel(effect.stat, group?.scope), zone: meta.zone, mode: effect.mode, type: effect.type, valueText: valueText(effect), stackCoverageText: stackCoverageText(effect), note: localized(group?.name) || localized(group?.description) || meta.description }
  })
}
function collectRows(engine: WEngine, scope?: 'self' | 'team'): FieldRow[] {
  const rows: FieldRow[] = []
  if (!scope || scope === 'self') rows.push(...groupRows(engine, engine.effect?.selfBuff, '自身'))
  if (!scope || scope === 'team') rows.push(...groupRows(engine, engine.effect?.teamBuff, '团队'))
  return rows
}
</script>

<style scoped>
.wengine-field-page { color: var(--wa-880); }
.summary-text { color: var(--wa-550); font-size: 13px; font-weight: 400; }
.engine-card { background: var(--wa-30); }
.engine-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.engine-name { font-size: 16px; font-weight: 700; color: var(--app-text-solid); }
.engine-id { margin-left: 8px; color: var(--wa-380); font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.section-box { min-height: 130px; padding: 12px; border: 1px solid var(--wa-80); border-radius: 10px; background: var(--app-inset); }
.section-title { margin-bottom: 8px; color: var(--wa-700); font-size: 12px; font-weight: 700; }
.field-line { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 0; font-size: 13px; }
.field-label, .requirement-line, .effect-desc { color: var(--wa-620); }
.field-value { color: var(--app-text-solid); font-weight: 700; }
.requirement-line { margin-top: 8px; font-size: 12px; }
.effect-name { margin-bottom: 6px; color: var(--app-text-solid); font-weight: 700; }
.effect-desc { line-height: 1.6; white-space: pre-wrap; font-size: 13px; }
.implemented-block { margin-top: 12px; }
.field-table-wrap { overflow-x: auto; border: 1px solid var(--wa-80); border-radius: 10px; }
.field-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 1080px; }
.field-table th, .field-table td { padding: 8px 10px; border-bottom: 1px solid var(--wa-60); text-align: left; vertical-align: top; }
.field-table th { color: var(--wa-550); background: var(--wa-40); font-weight: 600; }
.field-table tr:last-child td { border-bottom: none; }
.stat-id { margin-top: 3px; color: var(--wa-420); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.zone-pill { display: inline-flex; padding: 2px 8px; border-radius: 999px; background: rgba(59,130,246,.16); color: #9cc1ff; }
.value-cell { color: #d6f7a3; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.note-cell { color: var(--wa-640); line-height: 1.5; }
.empty-state { padding: 16px; color: var(--wa-460); text-align: center; border: 1px dashed var(--wa-120); border-radius: 10px; background: var(--wa-20); }
</style>
