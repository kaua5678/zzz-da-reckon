<template>
  <div class="attribute-ledger-page">
    <n-card size="small" :bordered="true">
      <template #header>
        <div class="card-header">
          <span>属性贡献账</span>
          <span class="muted">
            三张表：<b>基础</b>（角色+音擎白值）→ <b>加成</b>（驱动盘词条 / buff / 队友面板效果，按提供者分行）
            → <b>最终</b>（引擎真实面板）。行=提供者，列=属性，逐格可回溯。
          </span>
        </div>
      </template>

      <div class="controls">
        <div class="ctl-field">
          <span class="ctl-label">角色</span>
          <n-select v-model:value="slot" :options="agentOptions" size="small" style="width: 200px" />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">层</span>
          <n-radio-group v-model:value="layer" size="small">
            <n-radio-button value="base">基础</n-radio-button>
            <n-radio-button value="inCombat">加成</n-radio-button>
            <n-radio-button value="final">最终</n-radio-button>
          </n-radio-group>
        </div>
        <div class="ctl-field">
          <n-checkbox v-model:checked="groupByZone" size="small">按属性区分组</n-checkbox>
        </div>
        <div class="ctl-field">
          <n-checkbox v-model:checked="hideEmpty" size="small">隐藏全空属性</n-checkbox>
        </div>
        <div class="ctl-field">
          <n-button size="small" @click="copyMarkdown">复制为 Markdown</n-button>
        </div>
      </div>

      <!-- 视图模式：矩阵（行×列）/ 下钻（B：三维筛选）/ 分面（C：按内容拆表） -->
      <div class="view-mode-bar">
        <n-radio-group v-model:value="viewMode" size="small">
          <n-radio-button value="matrix">矩阵</n-radio-button>
          <n-radio-button value="drill">下钻筛选</n-radio-button>
          <n-radio-button value="facet">按内容分面</n-radio-button>
        </n-radio-group>
        <span class="muted">
          第三维＝<b>具体内容</b>（主词条 / 副词条 / 套装 / 音擎 / 被动…）：行×列×内容唯一落位，不重不漏
        </span>
      </div>

      <!-- B：三维筛选条 -->
      <div v-if="viewMode === 'drill'" class="drill-bar">
        <div class="ctl-field">
          <span class="ctl-label">提供者</span>
          <n-select v-model:value="filterProvider" multiple size="small" :options="allProviders.map(p => ({ label: p, value: p }))" style="min-width: 200px" placeholder="全部" clearable />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">内容</span>
          <n-select v-model:value="filterContent" multiple size="small" :options="allContents.map(c => ({ label: c, value: c }))" style="min-width: 180px" placeholder="全部" clearable />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">属性</span>
          <n-select v-model:value="filterKey" multiple size="small" :options="columns.map(c => ({ label: statLabel(c), value: c }))" style="min-width: 200px" placeholder="全部" clearable />
        </div>
        <span class="muted">{{ drilled.length }} 条贡献</span>
      </div>

      <n-alert v-if="!table" type="info" style="margin-top: 8px">该槽位没有角色</n-alert>

      <!-- 公式分解：白值 → 局外 → 局内，大/小词条各多少，可直接手算核对 -->
      <div v-if="formulas.length && viewMode === 'matrix'" class="formula-block">
        <div class="formula-title">公式分解（与引擎 recalcAccumStat 同一算式）</div>
        <table class="formula-table">
          <thead>
            <tr>
              <th class="fl">属性</th>
              <th>基础（白值）</th>
              <th>局外大词条</th>
              <th>局外小词条</th>
              <th class="fl-total">局外总值</th>
              <th>局内大词条</th>
              <th>局内小词条</th>
              <th class="fl-total">局内总值</th>
              <th class="fl">算式</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="f in formulas" :key="f.stat">
            <!-- 乘算型：基础 ×(1+大%)+小值，有大小词条 -->
            <tr v-if="f.kind === 'mult'">
              <td class="fl">{{ f.label }}</td>
              <td>{{ fmtNum(f.base) }}</td>
              <td>+{{ fmtNum(f.outPct) }}%</td>
              <td>+{{ fmtNum(f.outFlat) }}</td>
              <td class="fl-total">{{ fmtNum(f.outTotal) }}</td>
              <td>+{{ fmtNum(f.inPct) }}%</td>
              <td>+{{ fmtNum(f.inFlat) }}</td>
              <td class="fl-total">{{ fmtNum(f.inTotal) }}</td>
              <td class="fl formula-expr">{{ formulaText(f) }}</td>
            </tr>
            <!-- 加法型：没有白值/大小词条之分，只给总量 -->
            <tr v-else>
              <td class="fl">{{ f.label }}</td>
              <td class="fl-empty">—</td>
              <td class="fl-empty">—</td>
              <td class="fl-empty">—</td>
              <td class="fl-total">{{ fmtNum(f.outTotal) }}</td>
              <td class="fl-empty">—</td>
              <td class="fl-empty">—</td>
              <td class="fl-total">{{ fmtNum(f.inTotal) }}</td>
              <td class="fl formula-expr">面板直接累加（无大/小词条区分）</td>
            </tr>
            <!-- 来源拆解：把「大/小词条」逐条列出，避免把累乘结果误读成某一条固定值 -->
            <tr v-if="f.sources.length" class="src-row">
              <td class="fl" />
              <td colspan="8" class="fl">
                <span v-for="(s, i) in f.sources" :key="i" class="src-chip"
                  :class="s.phase === 'outOfCombat' ? 'src-out' : 'src-in'">
                  {{ s.phase === 'outOfCombat' ? '局外' : '局内' }} · {{ s.label }}
                  <template v-if="s.slotKey && s.slotKey !== s.label">［{{ s.slotKey }}］</template>
                  +{{ fmtNum(s.value) }}{{ s.kind === 'pct' ? '%' : '' }}
                </span>
              </td>
            </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- C：按内容大类分面，每个分面一张 提供者×属性 的二维表 -->
      <div v-if="viewMode === 'facet'" class="facet-block">
        <div v-for="f in facets" :key="f.kind" class="facet-card">
          <div class="facet-title">
            {{ f.kind }}
            <span class="muted">（{{ f.rows.length }} 条）</span>
          </div>
          <div class="table-wrap facet-table-wrap">
            <table class="ledger-table">
              <thead>
                <tr>
                  <th class="th-provider">提供者</th>
                  <th v-for="stat in f.table.columns" :key="stat" class="th-stat">{{ statLabel(stat) }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="[provider, cells] in [...f.table.byProvider.entries()]" :key="provider">
                  <td class="td-provider">{{ provider }}</td>
                  <td v-for="stat in f.table.columns" :key="stat" class="td-value">
                    <span v-if="cells.get(stat) !== undefined" class="cell-value">{{ formatCell({ amount: cells.get(stat)! }, stat) }}</span>
                    <span v-else class="cell-empty">—</span>
                  </td>
                </tr>
                <tr class="row-sum">
                  <td class="td-provider">合计</td>
                  <td v-for="stat in f.table.columns" :key="stat" class="td-value">
                    <span class="sum-value">{{ formatCell({ amount: f.table.totals.get(stat) ?? 0 }, stat) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ⚠ 必须是独立的 v-if（不能 v-else-if）：上面第 38/41 行是两个各自独立的 v-if，
           v-else-if 要求紧邻 v-if，中间插了公式块就断链 ⇒ 整块矩阵表永远不渲染（实测页面只剩公式表） -->
      <template v-if="table && viewMode !== 'facet'">
        <div class="table-wrap">
          <table class="ledger-table">
            <thead>
              <tr>
                <th class="th-provider">提供者</th>
                <template v-if="groupByZone">
                  <th v-for="group in zoneGroups" :key="group.zone" :colspan="group.stats.length" class="th-zone">
                    {{ group.zone }}
                  </th>
                </template>
                <template v-else>
                  <th v-for="stat in table.columns" :key="stat" class="th-stat">{{ statLabel(stat) }}</th>
                </template>
              </tr>
              <tr v-if="groupByZone">
                <th class="th-provider" />
                <th v-for="stat in columns" :key="stat" class="th-stat">{{ statLabel(stat) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in matrixRows" :key="row.origin.key">
                <td class="td-provider">
                  <span class="provider-label">{{ row.origin.label }}</span>
                  <n-tag v-if="layer === 'inCombat'" size="tiny" :bordered="false" class="kind-tag">
                    {{ kindLabel(row.origin.kind) }}
                  </n-tag>
                </td>
                <td v-for="stat in columns" :key="stat" class="td-value">
                  <template v-if="row.cells.get(stat)">
                    <span class="cell-value">{{ formatCell(row.cells.get(stat)!, stat) }}</span>
                    <span v-if="row.cells.get(stat)!.entries.length > 1" class="entry-count">
                      ×{{ row.cells.get(stat)!.entries.length }}
                    </span>
                  </template>
                  <span v-else class="cell-empty">—</span>
                </td>
              </tr>
              <!-- 加成层：列出该列的总加成，便于与最终层对照 -->
              <tr v-if="layer === 'inCombat'" class="row-sum">
                <td class="td-provider">加成合计</td>
                <td v-for="stat in columns" :key="stat" class="td-value">
                  <span class="sum-value">{{ formatCell({ amount: table.totals.get(stat) ?? 0 }, stat) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <n-collapse class="detail-collapse">
          <n-collapse-item title="格内明细（每条效果的来源与数值）" name="detail">
            <div v-for="row in rowsWithCells" :key="row.origin.key" class="detail-row">
              <div class="detail-provider">{{ row.origin.label }}</div>
              <div v-for="cell in row.cellsWithValue" :key="cell.key" class="detail-cell">
                <span class="detail-stat">{{ statLabel(cell.key) }}</span>
                <span class="detail-amount">{{ formatCell({ amount: cell.amount }, cell.key) }}</span>
                <span class="detail-entries">
                  <span v-for="(entry, i) in cell.entries" :key="i">
                    {{ entry.detail }}<template v-if="entry.slotKey && entry.slotKey !== entry.detail">［{{ entry.slotKey }}］</template>
                    {{ formatCell({ amount: entry.amount }, cell.key) }}
                  </span>
                </span>
              </div>
            </div>
          </n-collapse-item>
        </n-collapse>
      </template>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
// naive-ui 是逐页显式 import（无全局注册）：漏一个组件，模板里那条标签就保持未渲染的自定义元素。
import { NAlert, NButton, NCard, NCheckbox, NCollapse, NCollapseItem, NRadioButton, NRadioGroup, NSelect, NTag } from 'naive-ui'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import {
  buildAttributeLedger, zoneOfStat, flattenLedger, filterContributions, facetByContent, CONTENT_KIND_ORDER,
  type LedgerCell, type FlatContribution, type ContentKind,
} from '@/composables/agentMechanicView'
import { STAT_META, type FormulaZone } from '@/utils/statMeta'

/** 属性区展示顺序（与 statMeta 同源，只用于分面小表的列排序） */
const ZONE_ORDER_UI: FormulaZone[] = [
  '基础属性', '暴击区', '增伤区', '防御/穿透区', '贯穿力区', '贯穿增伤区',
  '锐化增伤区', '最终伤害区', '抗性/易伤区', '失衡区', '异常积蓄区', '异常伤害区', '能量/喧响区', '其他',
]
import { localized } from '@/utils/format'

type Layer = 'base' | 'inCombat' | 'final'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()

const slot = ref(0)
const layer = ref<Layer>('inCombat')
const groupByZone = ref(true)
const hideEmpty = ref(true)

const agentOptions = computed(() =>
  configStore.team
    .map((char, index) => ({ index, agentId: char.agentId }))
    .filter(x => !!x.agentId)
    .map(x => ({
      label: `${x.index + 1}号 · ${localized(catalogStore.agentsMap.get(x.agentId)?.name, x.agentId)}`,
      value: x.index,
    })),
)

const phases = computed(() => computePanelPhases(slot.value, configStore, catalogStore))
const ledger = computed(() => {
  const p = phases.value
  if (!p) return null
  return buildAttributeLedger(p.buffs, p, p.effectCoverageMap, p.teamPanelContributions, p.discContributions)
})

const formulas = computed(() => ledger.value?.formulas ?? [])

/**
 * 三维下钻（B）+ 内容分面（C）。
 *
 * 用户 2026-10-20：「主要还是 BC，有时候客观调研数据组成需要」——
 * 两者都只是对**同一份** `FlatContribution[]` 做 filter/groupBy，
 * 不另建账本（否则又回到「多套实现互相漂移」）。
 */
const viewMode = ref<'matrix' | 'drill' | 'facet'>('matrix')

/** B：三维筛选（空 = 不限制） */
const filterProvider = ref<string[]>([])
const filterContent = ref<ContentKind[]>([])
const filterKey = ref<string[]>([])

const flatRows = computed(() => {
  const l = ledger.value
  if (!l) return []
  const t = layer.value === 'base' ? l.base : layer.value === 'final' ? l.final : l.inCombat
  return flattenLedger(t)
})

const allProviders = computed(() => [...new Set(flatRows.value.map(r => r.provider))].sort())
const allContents = computed(() =>
  CONTENT_KIND_ORDER.filter(k => flatRows.value.some(r => r.content === k)),
)

/** B 的结果：三维筛选后的扁平行 */
const drilled = computed(() => filterContributions(flatRows.value, {
  providers: filterProvider.value,
  keys: filterKey.value,
  contents: filterContent.value,
}))

/**
 * C 的结果：按内容大类分面。
 *
 * ⚠ 表格在这里**预算好**（`table` 字段），模板只读不算——
 * 模板里写 `facetTable(f.rows)` 会让每个单元格渲染都重算一遍聚合（O(行×列×格)）。
 */
const facets = computed(() => {
  const map = facetByContent(drilled.value)
  return CONTENT_KIND_ORDER
    .filter(k => map.has(k))
    .map(k => ({ kind: k, rows: map.get(k) ?? [], table: facetTable(map.get(k) ?? []) }))
})

/** 分面内按 提供者 × 属性 聚合成二维小表（复用同一份数据，不重建账本） */
function facetTable(rows: FlatContribution[]) {
  const totals = new Map<string, number>()
  const byProvider = new Map<string, Map<string, number>>()
  for (const r of rows) {
    totals.set(r.key, (totals.get(r.key) ?? 0) + r.amount)
    const m = byProvider.get(r.provider) ?? new Map<string, number>()
    m.set(r.key, (m.get(r.key) ?? 0) + r.amount)
    byProvider.set(r.provider, m)
  }
  const columns = [...totals.keys()].sort(
    (a, b) => ZONE_ORDER_UI.indexOf(zoneOfStat(a)) - ZONE_ORDER_UI.indexOf(zoneOfStat(b)) || a.localeCompare(b),
  )
  return { columns, totals, byProvider }
}

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '—'
  return Number(v.toFixed(Math.abs(v) >= 100 ? 1 : 2)).toLocaleString()
}

/** 把一行公式拼成可手算的式子 */
function formulaText(f: { base: number; outPct: number; outFlat: number; outTotal: number; inPct: number; inFlat: number; inTotal: number }): string {
  const out = `${fmtNum(f.base)}×(1+${fmtNum(f.outPct)}%)+${fmtNum(f.outFlat)}=${fmtNum(f.outTotal)}`
  const inn = `${fmtNum(f.outTotal)}×(1+${fmtNum(f.inPct)}%)+${fmtNum(f.inFlat)}=${fmtNum(f.inTotal)}`
  return `${out}  →  ${inn}`
}

/** 当前层对应的账本表（矩阵视图的原始来源；下钻视图另用 `drilled` 过滤） */
const sourceTable = computed(() => {
  const l = ledger.value
  if (!l) return null
  if (layer.value === 'base') return l.base
  if (layer.value === 'final') return l.final
  return l.inCombat
})

const table = computed(() => sourceTable.value)

const STAT_LABEL = new Map(STAT_META.map(m => [m.value, m.label]))
function statLabel(stat: string): string {
  return STAT_LABEL.get(stat) ?? stat
}
function modeOf(stat: string): 'flat' | 'pct' {
  return table.value?.columnMode.get(stat) ?? 'flat'
}

/**
 * 矩阵视图的行数据：`drill` 模式下只保留通过三维筛选的条目
 * （矩阵与下钻共用同一张表，筛选只影响「保留哪些 entry」，不重建账本）。
 */
const matrixRows = computed(() => {
  const t = sourceTable.value
  if (!t) return []
  if (viewMode.value !== 'drill') return t.rows
  const keep = new Set(drilled.value.map(r => `${r.provider}|${r.key}|${r.slotKey}`))
  return t.rows
    .map(row => {
      const cells = new Map<string, LedgerCell<string>>()
      for (const [key, cell] of row.cells) {
        const entries = cell.entries.filter(e =>
          keep.has(`${row.origin.label}|${key}|${e.slotKey ?? ''}`))
        if (!entries.length) continue
        cells.set(key, { ...cell, amount: entries.reduce((a, e) => a + e.amount, 0), entries })
      }
      return { ...row, cells }
    })
    .filter(row => row.cells.size > 0)
})

/** 隐藏全空属性：所有行都取不到值的列不显示（几十列里多数是 0，不折叠没法读） */
const columns = computed(() => {
  const t = table.value
  if (!t) return []
  // 列集合跟随**实际显示的行**（下钻筛选后可能整列都没了）
  const rows = matrixRows.value
  if (!hideEmpty.value) return t.columns
  return t.columns.filter(stat => rows.some(r => r.cells.get(stat)))
})

/** 按属性区归组（与属性配置页 / statMeta 同一套分区） */
const zoneGroups = computed(() => {
  const groups = new Map<string, string[]>()
  for (const stat of columns.value) {
    const zone = zoneOfStat(stat)
    const list = groups.get(zone) ?? []
    list.push(stat)
    groups.set(zone, list)
  }
  return [...groups.entries()].map(([zone, stats]) => ({ zone, stats }))
})

function formatCell(cell: { amount: number }, stat: string): string {
  const v = cell.amount
  if (!Number.isFinite(v)) return '—'
  const decimals = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2
  const text = Number(v.toFixed(decimals)).toLocaleString()
  return modeOf(stat) === 'pct' ? `${text}%` : text
}

const KIND_LABELS: Record<string, string> = {
  agent: '角色',
  wEngine: '音擎',
  driveDisc: '驱动盘',
  teammate: '队友',
  teamEffect: '队友面板效果',
  team: '环境',
  global: '环境',
  other: '未标注',
}
function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind
}

const rowsWithCells = computed(() => {
  const t = table.value
  if (!t) return []
  return t.rows
    .map(row => ({
      origin: row.origin,
      cellsWithValue: columns.value
        .map(stat => row.cells.get(stat))
        .filter((c): c is LedgerCell<string> => !!c),
    }))
    .filter(row => row.cellsWithValue.length > 0)
})

async function copyMarkdown() {
  const t = table.value
  if (!t) return
  const head = ['提供者', ...columns.value.map(statLabel)]
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`]
  for (const row of t.rows) {
    lines.push(`| ${row.origin.label} | ` + columns.value
      .map(stat => {
        const cell = row.cells.get(stat)
        return cell ? formatCell(cell, stat) : ''
      })
      .join(' | ') + ' |')
  }
  try {
    await navigator.clipboard.writeText(lines.join('\n'))
  } catch {
    // 剪贴板不可用（无权限/非安全上下文）时静默降级
  }
}
</script>

<style scoped>
.attribute-ledger-page { display: flex; flex-direction: column; gap: 12px; }
.card-header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.muted { color: var(--app-text-dim); font-size: 12px; }
.controls { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; }
.ctl-field { display: flex; align-items: center; gap: 6px; }
.ctl-label { color: var(--app-text-dim); font-size: 12px; }
/*
 * 横向溢出（用户 2026-10-20：「蕾米的攻击力都放不下了，溢出到右边去了」）。
 *
 * 根因：`width: 100%` + `white-space: nowrap` ⇒ 列宽由内容撑开，总宽超过容器时
 * `overflow: auto` 只让外层滚动条接管，但**首列 sticky 的层叠上下文**会把
 * 紧邻的第一数据列压到它下面（视觉上就是「攻击力不见了/跑到右边」）。
 *
 * 修法：① 表格用 `min-width: max-content` + `width: auto`（该多宽就多宽，不挤）；
 * ② sticky 列显式给宽度与不透明底色（避免半透明叠字）；
 * ③ 数值列右对齐并锁定 tabular-nums，滚动时不会因字体宽度抖动。
 */
.table-wrap {
  overflow: auto;
  max-height: 64vh;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  /* 独立层叠上下文：sticky 首列不会溢出到容器外 */
  isolation: isolate;
}
.ledger-table {
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
  /* 内容决定宽度，容器只负责滚动 —— 不再用 100% 挤压列 */
  width: max-content;
  min-width: 100%;
}
.ledger-table th, .ledger-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--app-border);
  white-space: nowrap;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.th-provider, .td-provider {
  position: sticky;
  left: 0;
  z-index: 3;
  text-align: left;
  background: var(--app-tablehead-bg);
  /* sticky 列必须有实底，否则下一列滚过来会「透出来」叠字 */
  box-shadow: 1px 0 0 var(--app-border);
}
.td-provider { background: var(--app-panel); font-weight: 500; }
.ledger-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--app-tablehead-bg);
  /* 贴片的墨按**贴片底**选（不是页面底）：tablehead 底上 --app-text-dim 只有 3.18:1 */
  color: var(--app-text);
  font-weight: 500;
}
.th-zone { text-align: center; border-left: 1px solid var(--app-border); }
.th-stat { font-size: 11px; }
.provider-label { margin-right: 6px; }
.kind-tag { font-size: 10px; opacity: 0.75; }
.cell-value { font-variant-numeric: tabular-nums; }
.entry-count { margin-left: 3px; font-size: 10px; color: var(--app-text-dim); }
.cell-empty { color: var(--app-text-dim); opacity: 0.4; }
.row-sum .sum-value { font-weight: 600; color: var(--app-primary); }
.row-sum td { border-top: 1px solid var(--app-border); background: var(--app-inset); }
.formula-block { margin: 12px 0; }
.formula-title { font-size: 12px; color: var(--app-text-dim); margin-bottom: 6px; }
.formula-block { overflow-x: auto; }
.formula-table { border-collapse: collapse; font-size: 12px; width: max-content; min-width: 100%; }
.formula-table th, .formula-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--app-border);
  text-align: right;
  white-space: nowrap;
}
.formula-table th { background: var(--app-tablehead-bg); color: var(--app-text); font-weight: 500; }
.formula-table .fl { text-align: left; }
.formula-table .fl-total { font-weight: 600; color: var(--app-primary); }
.formula-expr { font-size: 11px; color: var(--app-text-dim); }
.fl-empty { color: var(--app-text-dim); opacity: 0.4; }
.src-row td { border-bottom: none; padding-top: 0; padding-bottom: 6px; }
.src-chip {
  display: inline-block;
  margin: 0 6px 2px 0;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  /* 贴片的墨按**贴片底**（--app-inset）选：--app-text-dim 在浅色主题只有 3.25:1，用 --app-text 才够 4.5 */
  background: var(--app-inset);
  color: var(--app-text);
}
.src-out { border-left: 2px solid var(--app-primary); }
.src-in { border-left: 2px solid var(--app-accent-gold); }
.detail-cell-inline { text-align: left; max-width: 420px; white-space: normal; }
.seg-chip { display: inline-block; margin-right: 8px; font-size: 11px; color: var(--app-text-dim); }
.decibel-block { display: flex; flex-direction: column; gap: 10px; }
.decibel-summary { font-size: 13px; }
.decibel-gap { color: var(--app-accent-gold); }
.detail-collapse { margin-top: 12px; }
.detail-row { padding: 6px 0; border-bottom: 1px dashed var(--app-border); }
.detail-provider { font-weight: 500; margin-bottom: 4px; }
.detail-cell { display: flex; gap: 8px; font-size: 11px; color: var(--app-text-dim); padding-left: 12px; }
.detail-stat { min-width: 140px; }
.detail-amount { min-width: 70px; color: var(--app-text-solid); }
.detail-entries { display: flex; gap: 12px; flex-wrap: wrap; }
</style>
