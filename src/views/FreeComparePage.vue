<template>
  <div class="free-compare-page">
    <n-card size="small" :bordered="true">
      <template #header>
        <div class="card-header">
          <span>自由对比工作台</span>
          <span class="muted">
            系列 = 自选实体 × 自选配置码 · x = 自选维度 · y = 自选指标 · 其余（Boss/队友/锁定角色/配装）都是条件
          </span>
        </div>
      </template>

      <!-- ===== 系列（被比的东西）===== -->
      <div class="ctl-block">
        <div class="ctl-block-title">
          系列（被比的东西）
          <span class="ctl-hint">配置码 = 两位数字：<b>左 = 影画 0-6，右 = 专武精炼 1-5</b>（21 = 2命+精1，01 = 0命+本体，<b>右位 0 = 无专武</b>）</span>
        </div>
        <div v-for="(s, i) in series" :key="s.key" class="series-row">
          <n-select
            v-model:value="s.agentId"
            :options="agentOptions"
            size="small"
            filterable
            style="width: 190px"
            placeholder="选角色"
          />
          <span class="code-label">配置码</span>
          <n-input
            v-model:value="s.code"
            size="small"
            style="width: 74px"
            placeholder="21"
            :status="parseSetupCode(s.code) ? undefined : 'error'"
          />
          <span class="code-read">{{ codeReadable(s.code) }}</span>
          <n-button size="small" quaternary :disabled="series.length <= 1" @click="removeSeries(i)">移除</n-button>
        </div>
        <n-button size="small" dashed style="margin-top: 6px" @click="addSeries">+ 加一个系列</n-button>
      </div>

      <!-- ===== x / y ===== -->
      <div class="ctl-block">
        <div class="ctl-block-title">轴与指标</div>
        <div class="ctl-row">
          <div class="ctl-field">
            <span class="ctl-label">x 轴维度</span>
            <n-select v-model:value="axisId" :options="axisOptions" size="small" style="width: 150px" />
          </div>
          <div class="ctl-field">
            <span class="ctl-label">y 轴指标</span>
            <n-select v-model:value="metricId" :options="metricOpts" size="small" style="width: 170px" />
          </div>
          <div class="ctl-field">
            <span class="ctl-label">影画上限</span>
            <n-input-number v-model:value="cinemaMax" :min="0" :max="6" size="small" style="width: 84px" />
          </div>
          <div v-if="axisId === 'setupCode'" class="ctl-field">
            <span class="ctl-label">配置码序列</span>
            <n-input
              v-model:value="setupCodesText"
              size="small"
              style="width: 190px"
              placeholder="01,11,21,20"
            />
          </div>
          <div class="ctl-field ctl-hint">
            <span class="ctl-label">{{ axisHint }}</span>
          </div>
        </div>
      </div>

      <!-- ===== 条件（约束）===== -->
      <div class="ctl-block">
        <div class="ctl-block-title">
          条件（约束 · 改它不动系列与 x）
          <span class="ctl-hint">例：「维琳娜 0命/1命/2命」就是条件——维琳娜是被锁的场景，柏妮思 vs 菲欧妮才是被比的系列</span>
        </div>
        <div class="ctl-row">
          <div class="ctl-field">
            <span class="ctl-label">Boss</span>
            <n-select
              v-model:value="bossId"
              :options="bossOptions"
              size="small"
              filterable
              clearable
              style="width: 200px"
              placeholder="（沿用当前页面 Boss）"
            />
          </div>
          <div class="ctl-field">
            <span class="ctl-label">当期 Buff</span>
            <n-select
              v-model:value="buffChoice"
              :options="buffOptions"
              size="small"
              style="width: 300px"
              :disabled="!bossId"
            />
          </div>
          <div class="ctl-field">
            <span class="ctl-label">队友（单人系列用）</span>
            <n-select v-model:value="mateA" :options="agentOptions" size="small" filterable clearable style="width: 150px" placeholder="队友1" />
            <n-select v-model:value="mateB" :options="agentOptions" size="small" filterable clearable style="width: 150px" placeholder="队友2" />
          </div>
          <div class="ctl-field">
            <n-checkbox v-model:checked="autoBuild" size="small">推荐配装（慢很多，数值更接近实战）</n-checkbox>
          </div>
        </div>
        <div class="ctl-row">
          <div class="ctl-field">
            <span class="ctl-label">锁定条件</span>
            <n-select v-model:value="condAgentId" :options="agentOptions" size="small" filterable clearable style="width: 150px" placeholder="条件角色（如维琳娜）" />
            <n-input-number v-model:value="condCinema" :min="0" :max="6" size="small" style="width: 84px" />
            <n-button size="small" :disabled="!condAgentId" @click="addCondition">锁定</n-button>
          </div>
          <div class="ctl-field">
            <n-tag v-for="(c, i) in conditions" :key="c.agentId" size="small" closable @close="conditions.splice(i, 1)">
              {{ agentName(c.agentId) }} {{ c.cinema }}命
            </n-tag>
          </div>
        </div>
      </div>

      <!-- ===== 跑 ===== -->
      <div class="ctl-row run-row">
        <n-button type="primary" size="small" :loading="computing" @click="runCompare">对比</n-button>
        <n-button v-if="computing" size="small" quaternary @click="abort">取消</n-button>
        <span class="cost-hint">{{ costHint }}</span>
      </div>
      <div v-if="computing || progress" class="progress-row">
        <n-progress type="line" :percentage="Math.round((progress?.pct ?? 0) * 100)" :show-indicator="false" :height="6" />
        <span class="progress-text">{{ progress?.text ?? '' }}</span>
      </div>
      <n-alert v-if="error" type="error" title="跑批失败" style="margin-top: 8px">{{ error }}</n-alert>
    </n-card>

    <!-- ===== 图 ===== -->
    <n-card v-if="result && result.series.length > 0" size="small" :bordered="true">
      <template #header>
        <div class="card-header">
          <span>{{ result.metricLabel }} · x = {{ result.axisLabel }}</span>
          <span class="muted">
            {{ result.evaluations }} 次求值<template v-if="result.pickEvaluations > 0"> + {{ result.pickEvaluations }} 次下位择优</template>
            · 耗时 {{ (result.durationMs / 1000).toFixed(1) }}s
            <template v-if="result.skipped > 0"> · {{ result.skipped }} 档无读数</template>
          </span>
        </div>
      </template>

      <div class="fc-legend">
        <span
          v-for="s in result.series"
          :key="s.id"
          class="fc-legend-item fc-legend-click"
          :class="{ off: !legend.isVisible(s.id) }"
          @click="legend.toggle(s.id)"
        >
          <span class="fc-dot" :style="{ background: colorOf(s.id) }"></span>{{ s.label }}
        </span>
        <span class="legend-hint">点系列名显隐（纵轴按剩下的线缩放）<template v-if="hasBuffSplit"> · 实线 = 本体（无 buff），虚线 = 吃当期牌</template></span>
      </div>

      <!-- 环境声明（用户裁决 2026-10-02：环境条件是数据质量关键，不能掐头去尾 ⇒ 每张图自带完整口径） -->
      <div class="fc-note fc-env">
        <span class="fc-note-label">环境：</span>
        <span>{{ result.environmentSummary }}</span>
      </div>

      <!-- 无专武档实际穿的下位件：按伤害择优挑的（实测同职业三把 A 级差 3~8pp），不显示就没法核对 -->
      <div v-if="downgradeNotes.length > 0" class="fc-note">
        <span class="fc-note-label">无专武档实际穿的下位（按伤害择优）：</span>
        <span v-for="n in downgradeNotes" :key="n" class="fc-note-item">{{ n }}</span>
      </div>

      <div class="fc-plot-wrap">
        <svg :viewBox="`0 0 ${svgW} ${svgH}`" class="fc-svg">
          <g v-for="(y, i) in yGrid" :key="'g' + i">
            <line :x1="padL" :x2="svgW - padR" :y1="y" :y2="y" class="grid-line" />
            <text :x="padL - 8" :y="y + 3" class="axis-label" text-anchor="end">{{ yLabel(i) }}</text>
          </g>
          <g v-for="(lv, i) in result.levels" :key="'x' + i">
            <text :x="levelX(i)" :y="svgH - 8" class="axis-label x-label" text-anchor="middle">{{ lv.label }}</text>
          </g>
          <polyline
            v-for="s in visibleLines" :key="s.id" :points="s.points" class="fc-line"
            :style="{ stroke: colorOf(s.id) }"
            :stroke-dasharray="s.buffTitle ? '6 4' : undefined"
          />
          <template v-for="s in visibleLines" :key="'p' + s.id">
            <circle
              v-for="(p, i) in s.pts"
              :key="i"
              :cx="p.x" :cy="p.y" r="4"
              :fill="colorOf(s.id)"
              class="trend-point"
            >
              <title>{{ s.label }} · {{ result.levels[i]?.label }}：{{ p.text }}</title>
            </circle>
          </template>
        </svg>
      </div>

      <!-- 汇总表（CC-204：每档最优系列绿底标出，方向按指标 higherBetter；单系列 / 全员并列不着色） -->
      <div v-if="result.series.length > 1" class="legend-hint fc-best-hint">
        绿底 = 该档最优（{{ resultDef?.higherBetter === false ? '本指标越小越好' : '越大越好' }}）
      </div>
      <div class="table-wrap">
        <table class="tl-table">
          <thead>
            <tr>
              <th>x</th>
              <th v-for="s in result.series" :key="s.id">{{ s.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(lv, i) in result.levels" :key="i">
              <td>{{ lv.label }}</td>
              <td v-for="(s, si) in result.series" :key="s.id" :class="{ 'fc-best': bestByLevel[i]?.has(si) }">{{ cellText(s.values[i]) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </n-card>

    <div v-else class="empty-hint">
      选好系列（谁跟谁比）与 x/y，点「对比」。
      默认就是用户要的那个场景：柏妮思 vs 菲欧妮，配置码 01/11/21/20，y = 队伍总伤；
      「维琳娜几命」放进下面的<b>条件</b>里锁定。
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 自由对比工作台（2026-09-15）
 *
 * 用户原话（2026-09-14 深夜，逐字）：
 *   「做一个自由选择元素的对比，比如我要比较维琳娜0命1命2命的情况下，柏妮思21对比菲欧尼21，
 *     11对比11，20对比11，01对比01的伤害曲线」
 *   「这就是个自由的对比图表，可以比单人也能比全队，各项数据也能比」「x轴可以自选」
 *   「维琳娜这个是条件」「总之我的要求不明确，就是强大的自由对比功能」
 *
 * 因此本页是**通用工作台**（系列 × x × y × 条件），不是第 N 张专用图。
 * 判据：① 改任一维不动其余；② 加指标/加 x 维度 = 往注册表加一行（`metrics.ts` / `axes.ts`），
 * 本文件不感知具体有哪些指标 —— 下拉是 `METRICS` 直接渲染的。
 *
 * 复用（规则 12，逐个真查过再引用）：
 * - `seriesFilter.ts#useSeriesFilter`：图例点选显隐（隐藏必须同时退出派生量 —— 纵轴按可见线缩放）
 * - `versionChartGeometry#scYRangeOf / scYStepOf / scYOf / scYGridOf / scGridStartOf`：纵轴几何直接复用（CC-427；
 *   此前本页手抄了一份，理由写的是「x 维度动态」——但纵轴几何只吃 y 值与 PlotBox，与 x 无关）
 * - `agentPresentation.ts#colorOf`：系列配色（与全仓图表同一套）
 * - `composables/analysisScenario.ts#withAnalysisScenario`：求值跑在独立场景上（r372，求值器内部已封装，本页不碰）
 */
import { computed, onMounted, ref, watch } from 'vue'
import { FREE_COMPARE_AGENTS } from '@/data/viewAgentDefaults'
import { NAlert, NButton, NCard, NCheckbox, NInput, NInputNumber, NProgress, NSelect, NTag } from 'naive-ui'
import { useCatalogStore } from '@/stores/catalog'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { useBatchOwner } from '@/composables/batchTask'
import { useSeriesFilter } from '@/composables/seriesFilter'
import { colorOf } from '@/composables/charts/agentPresentation'
import { computeFreeCompare } from '@/composables/freeCompare/engine'
import {
  AXIS_BY_ID,
  DEFAULT_AXIS_ID,
  type AxisId,
  type SeriesSpec,
  axisOptions as buildAxisOptions,
  formatSetupCode,
  parseSetupCode,
  setupCodeLabel,
} from '@/composables/freeCompare/axes'
import { bestSeriesIndexByLevel, formatMetric, metricDef, metricOptions } from '@/composables/freeCompare/metrics'
import { scGridStartOf, scYGridOf, scYOf, scYRangeOf, scYStepOf } from '@/composables/versionChartGeometry'
import type { BossPreset, PhaseView } from '@/types/bossPreset'

const catalog = useCatalogStore()

// ---------- 数据 ----------
const bossPresets = ref<BossPreset[]>([])
const phaseViews = ref<PhaseView[]>([])
const error = ref('')

/** 用户原话的三个实体，id 见 data/viewAgentDefaults（CC-431） */
const BURNICE = FREE_COMPARE_AGENTS.burnice
const PHOENIX = FREE_COMPARE_AGENTS.phoenix
const VELINA = FREE_COMPARE_AGENTS.velina

interface SeriesRow {
  key: number
  agentId: string
  code: string
}
let keySeq = 0
const series = ref<SeriesRow[]>([
  { key: keySeq++, agentId: BURNICE, code: '21' },
  { key: keySeq++, agentId: PHOENIX, code: '21' },
])
function addSeries() {
  series.value.push({ key: keySeq++, agentId: '', code: '01' })
}
function removeSeries(i: number) {
  series.value.splice(i, 1)
}

const axisId = ref<AxisId>(DEFAULT_AXIS_ID)
const metricId = ref('teamTotalDamage')
const cinemaMax = ref(6)
/** 配置码维度的档位序列（用户原话「21/11/20/01」）—— 逗号分隔，非法码在跑批前被拦下 */
const setupCodesText = ref('01,11,21,20')
const autoBuild = ref(false)

const bossId = ref('')
// ---------- 当期 Buff（用户裁决 2026-10-02：可以带也可以不带；全状态 = 本体 vs 吃拐并排）----------
/**
 * buff 三态：'none' = 不使用 / 'all' = 全状态对比（每系列拆 本体+每张牌 多条线）/ 牌名 = 手动指定一张。
 * 与队伍对比页同口径，但把「自动推荐」换成「全状态对比」——推荐只给赢家，全状态给归因
 * （用户裁决：「自带的结论不智能，不如直接呈现原数据，人类自会分析归因」）。
 */
const buffChoice = ref<string>('none')
/** 当前 Boss 所选期的 buff 牌（期视图按 phaseId 对齐；未选 Boss = 空） */
const currentBuffs = computed(() => {
  const boss = bossPresets.value.find(b => b.id === bossId.value)
  if (!boss) return []
  const phaseId = boss.phases[0]?.phaseId
  return phaseViews.value.find(v => v.phaseId === phaseId)?.buffs ?? []
})
const buffOptions = computed(() => [
  { value: 'none', label: '不使用（默认，快）' },
  { value: 'all', label: `全状态对比（本体 + 每张牌各一条线，慢 ${currentBuffs.value.filter(b => !b.testOnly).length + 1} 倍）` },
  ...currentBuffs.value.map(b => ({
    value: `card:${b.title}`,
    label: `${b.title || '(未命名)'}${b.testOnly ? '（测试服）' : ''}`,
    disabled: b.testOnly,
  })),
])
watch(currentBuffs, () => {
  // 换 Boss 后若手动选的牌不在当期，回到不使用（防「嘴上 A 期牌、身上 B 期」的静默错配）
  const cur = buffChoice.value
  if (cur.startsWith('card:') && !currentBuffs.value.some(b => `card:${b.title}` === cur)) buffChoice.value = 'none'
})
const mateA = ref(VELINA) // 默认把维琳娜当基底队友（对上用户原话的场景）
const mateB = ref('')
const condAgentId = ref('')
const condCinema = ref(0)
const conditions = ref<Array<{ agentId: string; cinema: number }>>([])
function addCondition() {
  if (!condAgentId.value) return
  const i = conditions.value.findIndex(c => c.agentId === condAgentId.value)
  if (i >= 0) conditions.value[i] = { agentId: condAgentId.value, cinema: condCinema.value }
  else conditions.value.push({ agentId: condAgentId.value, cinema: condCinema.value })
  condAgentId.value = ''
}

const agentOptions = computed(() =>
  catalog.displayAgents.map(a => ({ value: a.id, label: `${a.name.zhCN ?? a.id}（${a.rarity}）` })))
const bossOptions = computed(() => bossPresets.value.map(b => ({ value: b.id, label: b.name })))
/** period 维度的档位：所选 Boss 的各期危局，按时间从旧到新（数据里是新→旧） */
const periodOptions = computed(() => [...(bossPresets.value.find(b => b.id === bossId.value)?.phases ?? [])]
  .reverse()
  .map(p => ({ id: p.phaseId, label: p.label })))
const metricOpts = metricOptions()
const axisOptions = buildAxisOptions()
const axisHint = computed(() => AXIS_BY_ID.get(axisId.value)?.hint ?? '')

function agentName(id: string): string {
  return catalog.getAgent(id)?.name.zhCN ?? id
}
function codeReadable(code: string): string {
  const c = parseSetupCode(code)
  return c ? setupCodeLabel(c) : '（两位数字）'
}

// ---------- 跑批 ----------
const computing = ref(false)
const progress = ref<{ pct: number; text: string } | null>(null)
const result = ref<Awaited<ReturnType<typeof computeFreeCompare>> | null>(null)
/** 批任务归属（S4，CC-343）：新一次对比吊销前任，离开页面也吊销；进度/结果只归当前运行 */
const batchOwner = useBatchOwner()

/** 解析配置码序列（逗号/空格/顿号分隔；非法码返回 null 让调用方拦下并提示） */
function parseSetupCodesText(): string[] | null {
  const raw = setupCodesText.value.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean)
  const out: string[] = []
  for (const c of raw) {
    if (!parseSetupCode(c)) return null
    out.push(c)
  }
  return out
}
const setupCodes = computed(() => parseSetupCodesText())

/** 代价预告：单次全量求值 ~0.3-0.4s（由 TeamComparePage 注释「每队 ~10 次 ≈ 3~4 秒」推算） */
const costHint = computed(() => {
  const levels = AXIS_BY_ID.get(axisId.value)?.levels(
    { id: '', kind: 'agent', members: [], code: { cinema: 0, wengine: 1 } },
    { cinemaMax: cinemaMax.value, setupCodes: setupCodes.value ?? [], periods: periodOptions.value },
  ).length ?? 0
  const nSeries = series.value.filter(s => s.agentId).length
  // 全状态对比：每个主系列拆 本体+每张可用牌 条输出系列（求值量 ×(牌数+1)）
  const buffMult = buffChoice.value === 'all' ? currentBuffs.value.filter(b => !b.testOnly).length + 1 : 1
  const n = levels * nSeries * buffMult
  if (n === 0) return ''
  // 含「无专武」档时每系列多 ~(池大小−1) 次择优试算（同 (队友,角色,命座) 键后续档位走缓存；择优结果跨 buff 态复用同缓存）
  const hasNoWengine = (setupCodes.value ?? []).some(c => c[1] === '0')
  const picks = hasNoWengine ? nSeries * buffMult * 2 : 0
  const sec = Math.round((n + picks) * 0.35)
  return `预计 ${n + picks} 次求值 ≈ ${sec}s${autoBuild.value ? '（开了推荐配装，会更慢）' : ''}${buffMult > 1 ? `（全状态对比 ×${buffMult}）` : ''}`
})

async function runCompare() {
  error.value = ''
  const specs: SeriesSpec[] = []
  for (const s of series.value) {
    if (!s.agentId) continue
    const code = parseSetupCode(s.code)
    if (!code) { error.value = `配置码「${s.code}」不合法：要两位数字（左=影画 0-6，右=精炼 1-5）`; return }
    specs.push({ id: `${s.agentId}-${formatSetupCode(code)}`, kind: 'agent', members: [s.agentId], code })
  }
  if (specs.length === 0) { error.value = '至少选一个系列（选角色 + 填配置码）'; return }
  // x = 配置码时档位来自用户输入，非法就在这里拦下（别让非法码静默变成空轴）
  if (axisId.value === 'setupCode') {
    if (setupCodes.value === null) { error.value = '配置码序列里有非法码：每位都要两位数字（左=影画 0-6，右=精炼 1-5）'; return }
    if (setupCodes.value.length === 0) { error.value = '配置码序列是空的'; return }
  }

  if (axisId.value === 'period' && periodOptions.value.length === 0) { error.value = 'x = Boss 期数时，先在「条件」里选一个 Boss（期数 = 该 Boss 的各期危局）'; return }

  const run = batchOwner.start()
  computing.value = true
  progress.value = null
  try {
    // r372：对比在独立场景上求值（逐档位 yield，UI store 全程看不到中间态）
    const res = await withAnalysisScenario(scenario => computeFreeCompare(scenario, {
      series: specs,
      axisId: axisId.value,
      axisOptions: { cinemaMax: cinemaMax.value, setupCodes: setupCodes.value ?? [], periods: periodOptions.value },
      metricId: metricId.value,
      constraints: {
        boss: bossPresets.value.find(b => b.id === bossId.value),
        baseTeammates: [mateA.value, mateB.value],
        conditions: conditions.value,
        autoBuild: autoBuild.value,
        buffs: currentBuffs.value,
        buffChoice: buffChoice.value === 'all'
          ? 'all'
          : buffChoice.value === 'none'
            ? 'none'
            : currentBuffs.value.find(b => `card:${b.title}` === buffChoice.value) ?? 'none',
      },
      control: { signal: run.signal },
      onProgress: p => run.commit(() => { progress.value = p }),
    }))
    run.commit(() => { result.value = res })
  } catch (e) {
    run.commit(() => { error.value = e instanceof Error ? e.message : String(e) })
  } finally {
    run.commit(() => { computing.value = false; progress.value = null })
  }
}
/** 「取消」按钮：停掉当前运行；已算档位由该运行自己发布（求值器中止时保留已算部分） */
function abort() {
  batchOwner.cancel()
  computing.value = false
  progress.value = null
}

// ---------- 图 ----------
const svgW = 900
const svgH = 340
const padL = 74
const padR = 24
const padT = 18
const plotH = 250

const legend = useSeriesFilter(() => (result.value?.series ?? []).map(s => ({ id: s.id, name: s.label })))
const visibleSeries = computed(() => legend.filter(result.value?.series ?? []))

/** 纵轴范围：只看可见系列（隐藏必须退出派生量，否则筛选看着没生效）；几何复用 versionChartGeometry（CC-427） */
const yRange = computed(() =>
  scYRangeOf(
    visibleSeries.value
      .flatMap(s => s.values)
      .filter((v): v is number => v !== null && Number.isFinite(v)),
  ),
)
const plotBox = { padT, plotH }
const yGrid = computed(() => scYGridOf(yRange.value, plotBox))
function yOf(v: number): number {
  return scYOf(v, yRange.value, plotBox)
}
function yLabel(i: number): string {
  const step = scYStepOf(yRange.value)
  const v = scGridStartOf(yRange.value, step) + i * step
  const def = resultDef.value
  return def ? formatMetric(def, v) : String(Math.round(v))
}
function levelX(i: number): number {
  const n = result.value?.levels.length ?? 0
  if (n <= 1) return padL + (svgW - padL - padR) / 2
  return padL + (i / (n - 1)) * (svgW - padL - padR)
}

/**
 * 结果所属指标的定义。CC-204：表格 / 折线 / 纵轴的格式化此前读下拉框当前值 `metricId`——对比完再切指标，
 * 旧结果会按新指标的单位与小数位显示（百分比指标 ×100 等）。一律改读结果自带的 `result.metricId`。
 */
const resultDef = computed(() => metricDef(result.value?.metricId ?? metricId.value))
/** 每个 x 档的最优系列下标（汇总表着色） */
const bestByLevel = computed(() => {
  const def = resultDef.value
  const r = result.value
  return def && r ? bestSeriesIndexByLevel(def, r.series) : []
})

const visibleLines = computed(() => {
  const def = resultDef.value
  return visibleSeries.value.map(s => {
    const pts = s.values.map((v, i) => ({
      x: levelX(i),
      y: v === null ? yOf(yRange.value.min) : yOf(v),
      text: v === null ? '—' : def ? formatMetric(def, v) : String(v),
    }))
    return { id: s.id, label: s.label, buffTitle: s.buffTitle, pts, points: pts.map(p => `${p.x},${p.y}`).join(' ') }
  })
})

/** 本次结果是否含 buff 拆分（全状态对比 ⇒ 图例提示线型口径） */
const hasBuffSplit = computed(() => (result.value?.series ?? []).some(s => s.buffTitle !== null))

/** 无专武档实际穿的下位件（去重；空 = 本次没跑无专武档） */
const downgradeNotes = computed(() => {
  const out: string[] = []
  for (const s of result.value?.series ?? []) {
    for (const d of s.downgrades ?? []) if (!out.includes(d)) out.push(d)
  }
  return out
})

function cellText(v: number | null): string {
  const def = resultDef.value
  if (v === null) return '—'
  return def ? formatMetric(def, v) : String(Math.round(v))
}

onMounted(async () => {
  try {
    const data = await useCatalogStore().loadBossPresets()
    bossPresets.value = data.bosses ?? []
    phaseViews.value = data.phaseViews ?? []
  } catch (e) {
    error.value = `Boss 预设加载失败：${e instanceof Error ? e.message : String(e)}`
  }
})
</script>

<style scoped>
.free-compare-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}
.card-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.muted {
  font-size: 12px;
  color: var(--fg-3);
}
.ctl-block {
  border-top: 1px solid var(--app-border);
  padding-top: 10px;
  margin-top: 10px;
}
.ctl-block:first-of-type {
  border-top: none;
  margin-top: 0;
}
.ctl-block-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--app-text);
}
.ctl-hint {
  font-size: 12px;
  color: var(--fg-3);
  font-weight: 400;
}
.ctl-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.ctl-field {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ctl-label {
  font-size: 12px;
  color: var(--fg-2);
  white-space: nowrap;
}
.series-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.code-label {
  font-size: 12px;
  color: var(--fg-2);
}
.code-read {
  font-size: 12px;
  color: var(--fg-3);
  min-width: 84px;
}
.run-row {
  margin-top: 12px;
  border-top: 1px solid var(--app-border);
  padding-top: 12px;
}
.cost-hint {
  font-size: 12px;
  color: var(--fg-3);
}
.progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.progress-text {
  font-size: 12px;
  color: var(--fg-3);
}
.fc-legend {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.fc-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--app-text);
}
.fc-legend-click {
  cursor: pointer;
}
.fc-legend-item.off {
  opacity: 0.35;
}
.fc-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
.legend-hint {
  font-size: 12px;
  color: var(--fg-3);
}
.fc-note {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--fg-3);
}
.fc-note-label {
  color: var(--fg-2);
}
.fc-note-item {
  padding: 1px 7px;
  border: 1px solid var(--line);
  border-radius: 3px;
}
.fc-plot-wrap {
  width: 100%;
  overflow-x: auto;
}
.fc-svg {
  width: 100%;
  min-width: 620px;
  display: block;
}
.grid-line {
  stroke: var(--line);
  stroke-width: 1;
}
.axis-label {
  font-size: 11px;
  fill: var(--fg-3);
}
.fc-line {
  fill: none;
  stroke-width: 2;
}
.trend-point {
  stroke: var(--line-strong);
  stroke-width: 1;
}
.table-wrap {
  overflow-x: auto;
  margin-top: 10px;
}
.tl-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.tl-table th,
.tl-table td {
  padding: 5px 8px;
  text-align: right;
  border-bottom: 1px solid var(--app-border);
  color: var(--app-text);
}
.tl-table th:first-child,
.tl-table td:first-child {
  text-align: left;
}
.tl-table td.fc-best {
  color: var(--c-success);
  background: var(--c-success-soft);
  font-weight: 600;
}
.fc-best-hint {
  margin: 4px 0;
}
.tl-table th {
  background: var(--app-tablehead-bg);
  position: sticky;
  top: 0;
}
.empty-hint {
  font-size: 13px;
  color: var(--fg-3);
  padding: 16px;
  text-align: center;
}
</style>
