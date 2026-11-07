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
                    <th>本队伤害 / 同条件对照</th>
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
                    <!--
                      主读数三行（用户 2026-11-06 口径「用户可能想要的是当前情况的一个确切值」）：
                       ① 本队伤害 X→Y（Δ%）= 两级**交付点**（前沿点）之间的比；
                       ② 同窗数对照 Δ% = 两级钉在同一个 K 上比（不改操作强度）；
                       ③ 归因一行 = 所用 K + 两个前沿值 + 窗长/有效时间（字符串在 cinemaUplift#buildFrontierAttribution 拼好，页面只印）
                      未跑前沿（`frontier` 关闭）时退回单行「收敛停点口径的提升率」，与改动前逐位相同。
                    -->
                    <td
                      :class="upliftCellClass(frontierOf(e)?.pct ?? e.gainPct)"
                      :title="frontierTitle(e)"
                    >
                      <template v-if="frontierOf(e)">
                        <div class="uplift-main-line">{{ damageRangeText(e) }}</div>
                        <!--
                          **同 K 分布条**（用户 2026-11-07 口径：「正确的显示不是挑选好看或者不好看的交付点
                          数字展示，而是在整个面板显示完整的提升分布」）。每个 chip = 一个操作强度 K 上
                          这一级的提升率；断掉的那个 K 用 ✕ 如实标出，不藏。
                        -->
                        <div class="uplift-band" :title="bandTitle(e)">
                          <span
                            v-for="c in bandCells(e)"
                            :key="c.k"
                            :class="['uplift-band-cell', c.cls]"
                          >{{ c.text }}</span>
                        </div>
                        <div class="uplift-main-line uplift-sub">{{ sameKText(e) }}</div>
                        <!--
                          **逐槽 Δ%**（用户 2026-11-07：「−0.03% 这种如果他是主c就不合理」）。
                          本槽 = 这一行被升命的那个角色（块标题）；队友 = 其余槽位**合计**后的增量。
                          数字来自 cinemaUplift#computeSlotDeltas（两个交付帧的 damagePoolRows 按 slot 求和），
                          页面只印；悬浮里给逐槽明细与「Σ槽增量 == 全队增量」的核对值。
                        -->
                        <div
                          v-if="frontierOf(e)!.slotSummary"
                          class="uplift-main-line uplift-sub uplift-slots"
                          :title="frontierOf(e)!.slotDetail"
                        >逐槽 Δ：{{ frontierOf(e)!.slotSummary }}</div>
                        <div class="uplift-main-line uplift-sub uplift-attr">{{ frontierOf(e)!.attribution }}</div>
                      </template>
                      <template v-else>{{ signed1(e.gainPct) }}%</template>
                    </td>
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
            <b>主读数三行</b>（用户 2026-11-06 口径「当前情况的一个确切值 + 同条件对照」）：
            <br>
            ① <b>本队伤害 X→Y（Δ%）</b> = 两级各自的<b>交付点</b>（= 该级在「失衡窗数」这根轴上的<b>前沿点</b>；
            若某个钉住的窗数比自由收敛更值钱，引擎就交付那个）。<b>不是</b>「取两点看端点」——
            交付点由逐 K 钉窗扫描（每个 K 一次完整重解）取伤害最大者，装不下/窗攒不出的 K 一律不参与竞选。
            <br>
            ② <b>同窗数对照</b> = 把两级钉在<b>同一个窗数</b>上比，即「不改操作强度，加这一级能多打多少」。
            首选窗数 = 前一级的交付 K；后一级在该 K 装不下时<b>下探</b>到两级都可行的最大 K，并标注「已下探」
            （高命座更吃预算是最常见的形态，返回「不可比」等于什么都没说）。
            <br>
            ②′ <b>逐槽 Δ%</b> = 同一交付帧上「本槽（这一行被升命的角色）/ 队友合计」各自的涨跌。
            全队一个数会把方向读反——仪玄 C1→C2 本槽 <b>+1.46%</b>、队友 <b>−6.2%</b>、合计 <b>−0.03%</b>
            （新招式抢走 7.9s 平A 池）。悬浮里给逐槽明细与「Σ槽增量 == 全队增量」的核对值。
            <br>
            ③ <b>归因行</b> = 所用 K + 两个前沿值 + 交付点来源（收敛停点已最优 / 前沿扩展）+ 窗长与有效时间。
            <b>交付点掉窗时第①行会当场标出</b>（如「掉窗 K3→K2（同 K2 仍 +9.4%）」）——那说明这一级的负号来自
            <b>操作强度少了一个窗</b>，不是同 K 收益变负；分布条上的断点同时印出<b>差多少窗</b>（如 <code>K3 ✕攒不出 2.96/3</code>）。
            <br>
            ⇒ ①与②差距大的时候，说明这一级的提升<b>有一部分来自引擎把它交付到了更值钱的 K</b>——那正是
            「取两点会看出负提升」的副作用的载体，现在能当场看见、且能下钻到归因行。
            口径全文与实测见 <code>docs/mcp-cinema-interval-uplift.md</code> §5.7。
            <br><br>
            各栏口径：伤害与各栏同在「失衡次数锁定{{ cinemaStunLock > 0 ? `（${cinemaStunLock} 次）` : '' }}」场景下逐级对比，保证同场景同固定条件；
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
  signed1,
  UPLIFT_EPSILON_PCT,
  type CinemaUpliftEntry,
  type CinemaUpliftFrontierEntry,
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

/** 前沿读数（未跑前沿时 undefined ⇒ 页面退回单行提升率，与改动前逐位相同） */
function frontierOf(e: CinemaUpliftEntry): CinemaUpliftFrontierEntry | undefined {
  return e.frontier
}

/**
 * **同 K 分布条**的单元格（用户 2026-11-07 口径：显示完整分布，不挑一个数）。
 *
 * 逐 K 一个 chip：能打的操作强度印提升率，打不了的那个 K 印 ✕ 并说明原因（`窗+3s` / `超预算`）。
 * 只印**前 `BAND_MAX_CHIPS` 个**——再长的可行域对「这一级值多少」没有新信息，全铺会把表格撑爆
 * （用户：「显示太多也不好看」），完整列表在悬浮提示 `bandTitle` 里。
 */
const BAND_MAX_CHIPS = 5

interface BandCell { k: number; text: string; cls: string }

function bandCells(e: CinemaUpliftEntry): BandCell[] {
  const band = frontierOf(e)?.band
  if (!band) return []
  const out: BandCell[] = []
  for (const p of band.points) {
    if (p.bothFeasible) {
      if (out.length >= BAND_MAX_CHIPS) break
      out.push({
        k: p.k,
        text: `K${p.k} ${signed1(p.pct ?? 0)}%`,
        cls: (p.pct ?? 0) > 0 ? 'band-up' : (p.pct ?? 0) < 0 ? 'band-down' : 'band-flat',
      })
      continue
    }
    // 第一个断点：如实标原因，然后停（后面的 K 只会在更差的域里）
    const why = p.afterReject === 'budget' ? '超预算'
      : p.afterReject === 'contiguous' ? '攒不出'
        : p.afterReject === 'unscanned' ? '未扫'
          : p.afterReject === 'both' ? '超预算且攒不出'
            : '不可行'
    // 「攒不出」必须带上**差多少**：整数门槛下差 0.002 窗与差 2 窗印出来是同一个 ✕，
    // 但前者是门槛抖动、后者是真墙。读数来自 sameKBand 的 afterContiguous / afterGap（引擎原值）。
    const gap = p.afterGap === null ? '' : ` ${p.afterContiguous!.toFixed(2)}/${p.k}`
    out.push({ k: p.k, text: `K${p.k} ✕${why}${gap}`, cls: 'band-break' })
    break
  }
  return out
}

/** 悬浮说明：完整分布 + 断点原因 + 窗长是否变了（仪玄 C2 的「失衡持续 +3s」） */
function bandTitle(e: CinemaUpliftEntry): string {
  const band = frontierOf(e)?.band
  if (!band) return ''
  const lines = band.points
    .filter(p => p.bothFeasible)
    .map(p => `K${p.k}：${signed1(p.pct ?? 0)}%`)
  const head = band.medianPct === null
    ? '同 K 提升：两级没有公共可行操作点'
    : `同 K 提升中位 ${signed1(band.medianPct)}%（${band.feasibleKs.length} 个操作强度可行）`
  const tail: string[] = []
  if (band.breaksAt !== null) {
    const brk = band.points.find(p => p.k === band.breaksAt)
    const gapText = brk?.afterGap === null || brk?.afterGap === undefined
      ? ''
      : `（该 K 上攒出 ${brk.afterContiguous!.toFixed(3)} 窗，需要 ${brk.k} 窗，差 ${Math.abs(brk.afterGap).toFixed(3)} 窗）`
    tail.push(`K${band.breaksAt} 起高命座不可行（窗 ${fmt(band.beforeWindow, 1)}s→${fmt(band.afterWindow, 1)}s）${gapText}`)
  }
  if (band.windowChanged) {
    tail.push(`⚠ 窗长变了：${fmt(band.beforeWindow, 1)}s→${fmt(band.afterWindow, 1)}s —— 少而长的窗，这是本级的副作用`)
  }
  return [head, ...lines, ...tail].join('\n')
}

/** 伤害读数：百万级两位小数（与页面其它伤害读数同精度；数字本身来自引擎，页面不重算） */
function millions(v: number): string {
  return `${(v / 1e6).toFixed(2)}M`
}

/** 第①行：`本队伤害 X→Y (Δ%)` —— 两级**交付点**之间的比 */
function damageRangeText(e: CinemaUpliftEntry): string {
  const f = frontierOf(e)
  if (!f) return signed1(e.gainPct) + '%'
  // 交付点掉窗时把原因挂在**同一个数上**（字符串由 cinemaUplift 拼，页面只印）：
  // 一个光秃秃的 −10.1% 让人读成「命座变弱」，而它常常是「操作强度从 3 窗掉到 2 窗」。
  const note = f.deliveryNote ? ` · ${f.deliveryNote}` : ''
  return `${millions(f.beforeDmg)}→${millions(f.afterDmg)}（${signed1(f.pct)}%）${note}`
}

/**
 * 第②行：`同窗数对照 Δ%`（把两级钉在同一个 K 上比）。
 *
 * 为什么这一行必须与第①行并排：第①行是「两级各自的最优」，第②行是「同一个操作强度」。
 * 两者差距大的时候，说明这一级的提升**有一部分来自引擎把它交付到了更值钱的 K**——
 * 那正是「取两点会看出负提升」的那个副作用的载体，必须能当场看见。
 * 没有公共可行 K 时印原因（数字为 null 是「不可比」，不是 0）。
 */
function sameKText(e: CinemaUpliftEntry): string {
  const f = frontierOf(e)
  if (!f) return ''
  const { sameK } = f
  if (sameK.pct === null || sameK.k === null) {
    return `同窗数对照：不可比（首选 K${sameK.preferredK} 后一级${sameKReasonText(sameK.preferredReason)}）`
  }
  return `同窗数对照 K${sameK.k}：${signed1(sameK.pct)}%${sameK.atPreferred ? '' : `（首选 K${sameK.preferredK} ${sameKReasonText(sameK.preferredReason)}，已下探）`}`
}

const SAME_K_REASON: Record<string, string> = {
  budget: '超出时间预算',
  contiguous: '窗攒不出',
  both: '超预算且窗攒不出',
  'out-of-range': '超出扫描域',
}

function sameKReasonText(reason: string | null): string {
  return reason ? (SAME_K_REASON[reason] ?? reason) : '不可行'
}

/** 主读数格的悬浮说明：两条口径的完整含义 + 交付点来源（谁是前沿扩展来的） */
function frontierTitle(e: CinemaUpliftEntry): string {
  const f = frontierOf(e)
  const base = `伤害提升率 ${fmt(e.gainPct, 2)}%（口径 = 自由收敛停点）`
  if (!f) return base + (e.gainPct < 0 ? '（预算权衡：该命座资源侧收益被时间成本抵消）' : '')
  const src = (s: 'converged' | 'pinned', drift: number): string =>
    s === 'pinned' ? `前沿扩展（比收敛停点高 ${fmt(drift, 2)}%）` : '收敛停点即前沿'
  return [
    `本队伤害 ${millions(f.beforeDmg)}→${millions(f.afterDmg)}（${signed1(f.pct)}%）= 两级**交付点**之间的比`,
    `前一级 C${e.to - 1}：交付 K${f.beforeK}，${src(f.beforeSource, f.beforeDriftPct)}`,
    `后一级 C${e.to}：交付 K${f.afterK}，${src(f.afterSource, f.afterDriftPct)}`,
    `收敛停点口径的提升率 ${fmt(e.gainPct, 2)}%（与上面相差 ${fmt(f.pct - e.gainPct, 2)}pp = 交付点漂移）`,
    `窗 ${fmt(f.windowDuration, 1)}s／有效 ${fmt(f.effectiveTime, 0)}s；可行点 ${f.beforeFeasibleCount}/${f.afterFeasibleCount} 个`,
  ].join('\n')
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

// `signed1` 已迁到 composables/cinemaUplift.ts：逐槽读数与页面读数必须同一舍入口径（规则 11）

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
    // `frontier: true` ⇒ 每级多跑一条钉 K 前沿，主读数给出「确切值 + 同条件对照」（用户 2026-11-06 口径）。
    // 成本实测：3 槽 × 6 级 2.8s → 12~20s（每个 K 一次完整外层求值）；这是**显式点按钮才会付**的钱。
    const rows = await withAnalysisScenario(s => analyzeCinemaUplift(s, {
      targetStunCount: targetStun,
      frontier: true,
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

/* 主读数三行（本队伤害 / 同窗数对照 / 归因）：同一格里上下排，行距压紧、副行用弱色
   ——三行必须读起来是「一个读数 + 两条注脚」，不是三列（列宽有限，横滚条已在外层） */
.uplift-main-line {
  line-height: 1.45;
  white-space: nowrap;
}

.uplift-main-line.uplift-sub {
  font-size: 10px;
  color: var(--fg-2);
}

.uplift-main-line.uplift-slots {
  color: var(--fg-2);
}

.uplift-main-line.uplift-attr {
  white-space: normal;
  color: var(--fg-3);
}

/* 同 K 分布条（用户 2026-11-07）：每个 chip = 一个操作强度 K 上的提升率；
   断掉的那个 K 印 ✕ 并标原因 —— 副作用必须能看见，不许只挑一个好看的点。 */
.uplift-band {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin: 2px 0 1px;
}

.uplift-band-cell {
  font-size: 10px;
  line-height: 1.3;
  padding: 0 3px;
  border-radius: 3px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.uplift-band-cell.band-up {
  color: var(--c-success);
}

.uplift-band-cell.band-down {
  color: var(--c-danger);
}

.uplift-band-cell.band-flat {
  color: var(--fg-2);
}

.uplift-band-cell.band-break {
  color: var(--c-danger);
  border: 1px dashed currentColor;
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
