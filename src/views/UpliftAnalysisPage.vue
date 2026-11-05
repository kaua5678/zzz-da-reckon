<template>
  <div class="uplift-analysis-page">
    <div v-if="!hasTeam" class="placeholder">
      <div class="placeholder-title">请先配置队伍</div>
      <div class="placeholder-desc">选择角色后，这里可以按需计算命座提升率、伤害响应面与副词条收益。</div>
    </div>

    <template v-else>
      <!--
        本页 = 按需计算的分析卡合集（2026-10-28 从资源利用率页拆出，用户口径
        「资源利用率只留局内调整，伤害影响/响应面/副词条收益不是利用率」）。
        共同点：都不写计算输入、都要显式点按钮才跑（B 档估算，见 ENGINE_PIPELINE_GUIDE §4 坑 53）。
      -->
      <n-card size="small" class="analysis-card" :bordered="true">
        <template #header>
          命座提升率（当前配队与滑块下，逐级影画带来的伤害与失衡值/积蓄/喧响/能量增量）
          <n-tag v-if="!axisActiveForUplift" size="tiny" type="warning" :bordered="false" style="margin-left:8px;vertical-align:middle">
            非轴模式：本页命座提升率仅供参考，失衡轴模式才可信
          </n-tag>
        </template>
        <div class="intro-actions">
          <n-button size="small" type="primary" secondary :loading="cinemaComputing" @click="computeCinemaGains">
            {{ cinemaComputing ? '计算中' : (cinemaGains.length > 0 ? '重新计算' : '计算') }}
          </n-button>
        </div>
        <!--
          R1（docs/REQUIREMENTS.md）：由「一排角标」改为「一档一行、一指标一栏」的表格。
          列顺序与中文列名不在这里写死，一律取 cinemaUplift.ts 的 CINEMA_METRICS（单一事实源，规则 11）。
        -->
        <div v-if="cinemaGains.length > 0" class="cinema-uplift-wrap">
          <div v-for="g in cinemaGains" :key="g.slot" class="cinema-uplift-block">
            <div class="cinema-uplift-name">{{ g.name }}</div>
            <div class="cinema-uplift-scroll">
              <table class="cinema-uplift-table">
                <thead>
                  <tr>
                    <th>影画</th>
                    <th>伤害</th>
                    <!--
                      通道分解（用户 2026-11-05 裁决「涉及资源的需要重算新资源的净增益，在此基础上乘面板属性增益」）：
                      三块分开印、**不合成一个百分比**——可解释性就是这张卡的目的。数字全部来自
                      cinemaUplift#breakdown（引擎三反事实算出来的），页面不重算（规则 11）。
                    -->
                    <th>通道分解</th>
                    <th v-for="m in upliftMetricDefs" :key="m.key">{{ m.label }}</th>
                    <th>大招</th>
                    <th>自检</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="e in g.entries" :key="e.to">
                    <td>{{ e.to - 1 }}→{{ e.to }}</td>
                    <td
                      :class="upliftCellClass(e.gainPct)"
                      :title="`伤害提升率 ${fmt(e.gainPct, 2)}%${e.gainPct < 0 ? '（预算权衡：该命座资源侧收益被时间成本抵消）' : ''}`"
                    >{{ signed1(e.gainPct) }}%</td>
                    <td class="cinema-uplift-split" :title="breakdownTitle(e)">
                      <span v-if="e.breakdown.tier === 'NONE'">—</span>
                      <template v-else>
                        <span v-for="p in breakdownParts(e)" :key="p.key" class="split-part">{{ p.label }} {{ p.text }}</span>
                      </template>
                    </td>
                    <td
                      v-for="m in upliftMetricDefs"
                      :key="m.key"
                      :class="upliftCellClass(displayDelta(metricOf(e, m.key)))"
                      :title="metricTitle(metricOf(e, m.key))"
                    >
                      {{ upliftDeltaText(metricOf(e, m.key)) }}<small v-if="upliftPctText(metricOf(e, m.key))" class="uplift-pct">{{ upliftPctText(metricOf(e, m.key)) }}</small>
                    </td>
                    <td
                      :class="e.ultAfter === e.ultBefore ? 'uplift-flat' : upliftCellClass(e.ultAfter - e.ultBefore)"
                      title="全队终结技总次数（与伤害同场景读数）"
                    >{{ e.ultAfter === e.ultBefore ? '—' : `${e.ultBefore}→${e.ultAfter}` }}</td>
                    <td class="cinema-uplift-warn"><span :style="entryBadgeStyle(e)">{{ upliftWarnLabel(e) }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="g.entries.some(e => e.warn === 'unimplemented')" class="cinema-uplift-note">
              ⚠无变化 = 该命座无面板字段与伤害变化，效果可能未接进计算（AGENTS 规则 5 的肉眼自检面）。
            </div>
          </div>
          <div class="cinema-uplift-note">
            口径：伤害与各栏同在「失衡次数锁定{{ cinemaStunLock > 0 ? `（${cinemaStunLock} 次）` : '' }}」场景下逐级对比，保证同场景同固定条件；
            <b>失衡栏是失衡值总量</b>——失衡次数正是被锁的量，用它当栏会恒为 0（探针证据见 docs/mcp-cinema-uplift-multi-metric.md §2）。
            负值 = 该命座的资源侧收益被时间预算抵消（预算权衡），不是错误。`—` = 本级该量无变化。
            <br>
            <b>⚠ 本页锁值取自「当前配置自己的收敛结果」</b>，所以换配置再算出来的两个数<b>不可直接比</b>
            （实测同队全01 锁 6 窗、全65 锁 3 窗，累计提升率 71.0% vs 68.8%，差值全部来自锁值）。
            要看<b>跨环境可比</b>的命座提升率（Boss × 环境 buff 的 N×M 网格，含「不锁失衡次数」通道），
            去「队伍对比 → 命座提升率」。
          </div>
        </div>
      </n-card>

      <ImpactChart :team-total-damage="teamTotalDamage" :coverage-rate="anomalyPoolResult?.coverage?.perElementCoverageRate" />
      <SubstatCurveChart />
      <SubstatScoreCard />
      <MarginalUtilityCard />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ImpactChart from '@/components/ImpactChart.vue'
import SubstatCurveChart from '@/components/charts/SubstatCurveChart.vue'
import SubstatScoreCard from '@/components/charts/SubstatScoreCard.vue'
import MarginalUtilityCard from '@/components/MarginalUtilityCard.vue'
import { NButton, NCard, NTag } from 'naive-ui'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { useBatchOwner } from '@/composables/batchTask'
import {
  analyzeCinemaUplift,
  CINEMA_METRICS,
  UPLIFT_EPSILON_PCT,
  type CinemaUpliftEntry,
  type CinemaUpliftMetric,
  type CinemaUpliftRow,
} from '@/composables/cinemaUplift'
import { fmt } from '@/utils/format'

const configStore = useConfigStore()
const { anomalyPoolResult, agentNames, stunPoolResult, autoActive, effectiveStunAxes, teamTotalDamage } = useResourceCalc()

const hasTeam = computed(() => configStore.team.some(c => !!c.agentId))
/** 命座提升率可信度：轴模式（用户开轴或自动命中预设轴）才可信；非轴是退化兜底，仅提示用途 */
const axisActiveForUplift = computed(() =>
  (configStore.useStunAxis || autoActive.value) && (effectiveStunAxes.value?.length ?? 0) > 0,
)

// 类型与算法同源于 composables/cinemaUplift.ts（勿在此另抄一份）
const cinemaGains = ref<CinemaUpliftRow[]>([])
const cinemaComputing = ref(false)
/** 本次分析锁定的失衡次数（只用于页面口径说明文案） */
const cinemaStunLock = ref(0)
/** 栏位定义（顺序 + 中文列名）单源在 cinemaUplift.ts，页面不另抄 */
const upliftMetricDefs = CINEMA_METRICS

/** 命座提升率的任务所有者：重复点「重新计算」顶掉旧运行，离开页面后旧运行不再提交 */
const cinemaOwner = useBatchOwner()

/** 命座自检角标样式：ok 正常灰、execLevel 蓝色提示、unimplemented 橙色警示 */
function entryBadgeStyle(e: { warn: 'ok' | 'execLevel' | 'unimplemented' }): Record<string, string> {
  if (e.warn === 'unimplemented') {
    return { fontSize: '11px', padding: '2px 6px', borderRadius: '3px', color: '#ffd08a', background: 'rgba(255,160,60,0.12)', border: '1px solid rgba(255,160,60,0.4)' }
  }
  if (e.warn === 'execLevel') {
    return { fontSize: '11px', padding: '2px 6px', borderRadius: '3px', color: '#8ac6ff', background: 'rgba(80,150,255,0.10)', border: '1px solid rgba(80,150,255,0.3)' }
  }
  return { fontSize: '11px', padding: '2px 6px', borderRadius: '3px', color: 'var(--wa-600)', background: 'var(--wa-40)' }
}

/** 三态角标的中文文案（原先散在模板的 <template v-if> 里，改成表格后集中一处） */
/**
 * 通道分解格要印哪几段（**判据与 tier 同源**：tier 里有的通道必须出现）。
 *
 * 为什么不能只按「`|pct| ≥ 0.05`」筛：tier 还会因为**面板字段变了**（如 `skillLevelBonus`、
 * 能量效率）而带上该通道，而它的百分比读数可能恰好舍入到 0.0 —— 只按读数筛会印出一个**空白格**，
 * 读者以为是渲染坏了（实机 DOM 读回抓到过空 cell）。⇒ 两种证据取并集，任何非 NONE 的级至少印一段。
 */
function breakdownParts(e: CinemaUpliftEntry): Array<{ key: string; label: string; text: string }> {
  const zones = e.breakdown.tier.split('+')
  const defs: Array<{ key: string; zone: string; label: string; pct: number }> = [
    { key: 'resource', zone: 'RESOURCE', label: '资源', pct: e.breakdown.resourcePct },
    { key: 'exec', zone: 'EXEC', label: '执行', pct: e.breakdown.execPct },
    { key: 'attr', zone: 'ATTR', label: '面板', pct: e.breakdown.attrPct },
  ]
  return defs
    .filter(d => zones.includes(d.zone) || Math.abs(d.pct) >= UPLIFT_EPSILON_PCT)
    // 一位小数舍入到 0 的段不能印 `+0%`——那读起来像「完全没变」，而它可能是 0.04%，
    // 且 tier 已判定这条通道**确实动了**。印 `±<0.1%` 把「动过但极小」这层意思说清楚；
    // 精确值仍在悬浮提示里（`breakdownTitle` 打全精度）。
    .map(d => ({
      key: d.key,
      label: d.label,
      text: Math.abs(d.pct) < 0.05 ? '±<0.1%' : `${d.pct >= 0 ? '+' : ''}${fmt(d.pct, 1)}%`,
    }))
}

/**
 * 通道分解的悬浮说明：三段各自的含义 + 连乘对账 + 耦合提示。
 *
 * 「三段连乘 = 总提升」是**定义式**（`cinemaUpliftBreakdown#computeCinemaBreakdown`），
 * 但读数四舍五入后会有零点几个 pp 的缝，所以这里直接印出连乘结果供读者自己对。
 */
function breakdownTitle(e: CinemaUpliftEntry): string {
  const b = e.breakdown
  const recomposed = ((1 + b.resourcePct / 100) * (1 + b.execPct / 100) * (1 + b.attrPct / 100) - 1) * 100
  const lines = [
    `资源 ${signed1(b.resourcePct)}%：次数/能量/喧响/失衡次数换来的净增益（单次伤害冻结在旧值）`,
    `执行 ${signed1(b.execPct)}%：同样招式单次伤害变了（技能等级/倍率/附伤/新招式行）${b.newRowCount > 0 ? `，含 ${b.newRowCount} 条新招式行` : ''}`,
    `面板 ${signed1(b.attrPct)}%：在**新资源基线**上乘的面板属性增益`,
    `三段连乘 = ${signed1(recomposed)}%（实算总提升 ${signed1(e.gainPct)}%）`,
  ]
  if (b.coupled) lines.push('⚠ 该级的旧池某种伤害整体消失，三段商无法逐段解读，只能看总提升。')
  return lines.join('\n')
}

function upliftWarnLabel(e: CinemaUpliftEntry): string {
  if (e.warn === 'unimplemented') return '⚠无变化'
  return e.warn === 'execLevel' ? '执行级' : 'ok'
}

function metricOf(e: CinemaUpliftEntry, key: string): CinemaUpliftMetric | undefined {
  return e.metrics.find(m => m.key === key)
}

/** 涨跌着色走令牌（--c-success/--c-danger 明暗双主题都有定义），不写死色值 */
function upliftCellClass(delta: number): string {
  return delta > 0 ? 'uplift-up' : delta < 0 ? 'uplift-down' : 'uplift-flat'
}

function signed1(v: number): string {
  return `${v >= 0 ? '+' : ''}${fmt(v, 1)}`
}

/**
 * 「显示用 delta」= 单元格文案与着色的**共同**判据（两者必须同源，否则会出现「绿色的 —」这种自相矛盾的格子）。
 *
 * 口径：**按本栏的显示位数四舍五入后为 0 的变化，一律当无变化**（显示 `—`、不着色）。
 * 为什么这么定（2026-09-26 实机 DOM 读回抓到的两个缺陷，见 docs/mcp-cinema-uplift-multi-metric.md §4）：
 *   ① rate 栏曾抢在「零变化 → —」之前返回，导致 异常覆盖 每行都印 `+0pp`，与其它栏不一致；
 *   ② 维琳娜 1→2 命失衡值 Δ=-18.2、基数约 4.5 万 ⇒ 提升率 -0.04%，格子印成 `-18.2 -0%`——`-0%` 是纯噪声。
 * 精确值不丢：`metricTitle` 的悬浮提示里仍是 before → after 全精度。
 */
function displayDelta(m: CinemaUpliftMetric | undefined): number {
  if (!m) return 0
  const shown = m.kind === 'rate' ? m.delta * 100 : m.delta
  const digits = m.kind === 'count' ? 0 : 1
  return Number(Math.abs(shown).toFixed(digits)) === 0 ? 0 : m.delta
}

/** 单元格主文：比率栏按百分点（pp）、次数栏取整、数量栏 1 位小数；显示位上为 0 的一律 `—` */
function upliftDeltaText(m: CinemaUpliftMetric | undefined): string {
  if (!m || displayDelta(m) === 0) return '—'
  if (m.kind === 'rate') return `${m.delta >= 0 ? '+' : ''}${fmt(m.delta * 100, 1)}pp`
  return m.kind === 'count' ? `${m.delta >= 0 ? '+' : ''}${fmt(m.delta, 0)}` : signed1(m.delta)
}

/**
 * 单元格副文：提升率%（只对数量栏显示；次数/比率栏的百分比没有意义）。
 * 阈值复用本模块的 `UPLIFT_EPSILON_PCT`（= 「零移动」判据同一个数），避免又立一把尺。
 */
function upliftPctText(m: CinemaUpliftMetric | undefined): string {
  if (!m || m.kind !== 'value' || Math.abs(m.pct) < UPLIFT_EPSILON_PCT) return ''
  return `${m.pct >= 0 ? '+' : ''}${fmt(m.pct, 1)}%`
}

function metricTitle(m: CinemaUpliftMetric | undefined): string {
  if (!m) return '（本栏无读数）'
  return `${m.label}：${fmt(m.before, 1)} → ${fmt(m.after, 1)}（Δ ${signed1(m.delta)}，${signed1(m.pct)}%）`
}

async function computeCinemaGains() {
  const task = cinemaOwner.start()
  cinemaComputing.value = true
  try {
    // 算法在 composables/cinemaUplift.ts（同一份实现同时服务页面与测试：
    // 「命座必须有效果」的红灯断言见 composables/__tests__/cinemaUplift.test.ts 与 allAgentsSweep）。
    // CC-347：在 UI 现场的独立拷贝里改命座 / 失衡锁并读数，UI store 全程不动（无需恢复现场）。
    const targetStun = stunPoolResult.value?.stunCount ?? 4 // 固定场景：以当前配置收敛的失衡次数为准
    const rows = await withAnalysisScenario(s => analyzeCinemaUplift(s, {
      targetStunCount: targetStun,
      resolveName: agentId => agentNames.value[agentId] || '',
      control: { signal: task.signal },
    }))
    task.commit(() => {
      cinemaStunLock.value = targetStun
      cinemaGains.value = rows
    })
  } finally {
    task.commit(() => { cinemaComputing.value = false })
  }
}
</script>

<style scoped>
.uplift-analysis-page {
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

.analysis-card {
  /* 同款「略浮起」参数/分析卡面：棘轮要求新代码走语义别名（--app-panel），不直引 --wa-30 */
  background: var(--app-panel);
}

.intro-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

/* R1：命座提升率多指标表（列名与顺序单源在 cinemaUplift.ts 的 CINEMA_METRICS）
   房型照 CharIncrementPage 的 .rank-table：裸 table + border-collapse + --line 分隔线 */
.cinema-uplift-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
}

.cinema-uplift-block {
  min-width: 0;
}

.cinema-uplift-name {
  font-size: 12px;
  color: var(--wa-700);
  margin-bottom: 2px;
}

.cinema-uplift-scroll {
  overflow-x: auto;
}

.cinema-uplift-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.cinema-uplift-table th,
.cinema-uplift-table td {
  text-align: right;
  padding: 4px 8px;
  /* 分隔线走语义别名 --line（= --wa-120）而不是裸 --wa-*：check-tokens 的 alias 棘轮要求新代码用别名。
     ⚠ --wa-60 的语义是 --fill-hover（行/按钮 hover 底），拿它当分隔线是用错令牌。 */
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}

.cinema-uplift-table th {
  color: var(--fg-2);
  font-weight: 500;
}

.cinema-uplift-table th:first-child,
.cinema-uplift-table td:first-child {
  text-align: left;
}

/* 特异性要压过上面的 `.cinema-uplift-table td`（0,1,1 > 0,1,0），否则居中不生效 */
.cinema-uplift-table td.cinema-uplift-warn {
  text-align: center;
}

/* 通道分解格：三段并排、每段自动换行，不挤成一行长字符串（列宽有限，横滚条已经在外面了） */
.cinema-uplift-table td.cinema-uplift-split {
  text-align: left;
  white-space: normal;
  min-width: 118px;
  line-height: 1.5;
}

.split-part {
  display: block;
  font-size: 10px;
  color: var(--fg-2);
}

.uplift-pct {
  margin-left: 3px;
  font-size: 10px;
  color: var(--fg-2);
}

.uplift-up {
  color: var(--c-success);
}

.uplift-down {
  color: var(--c-danger);
}

.uplift-flat {
  color: var(--fg-2);
}

.cinema-uplift-note {
  font-size: 11px;
  line-height: 1.7;
  color: var(--fg-2);
}
</style>
