<template>
  <n-card size="small" class="descent-card" :bordered="true">
    <template #header>
      <div class="descent-header">
        <span>难度曲线（从最优逐级一般化）</span>
        <span class="descent-sub">降杠杆 → 引擎自然算出连锁（大招/轮数掉落）</span>
      </div>
    </template>

    <!-- 控制条：勾选 + 计算次数 + 运行 -->
    <div class="descent-controls">
      <n-checkbox v-model:checked="enabled" size="small">启用难度曲线</n-checkbox>
      <span class="descent-label">计算次数</span>
      <n-input-number
        v-model:value="maxSteps"
        size="small"
        :min="2"
        :max="13"
        :disabled="!enabled"
        class="descent-steps"
      />
      <n-checkbox v-model:checked="monotoneGate" size="small" :disabled="!enabled">
        正向因子单调（合轴↓ ⇒ 交互档不回升）
      </n-checkbox>
      <n-checkbox v-model:checked="measureDifficulty" size="small" :disabled="!enabled">
        测操作难度（标注非单调点）
      </n-checkbox>
      <n-button size="small" :disabled="!enabled || running" :loading="running" @click="run">
        {{ running ? `计算中 ${points.length}/${maxSteps}` : '开始计算' }}
      </n-button>
      <span v-if="summary" class="descent-summary">
        最优 {{ fmt(summary.best, 0) }} → 末档 {{ fmt(summary.worst, 0) }}
        <span class="descent-loss">（−{{ fmt(summary.lossPct, 1) }}%）</span>
        · {{ summary.steps }} 档
        <!-- 非单调档不是错误：多因素下不强求正相关（用户口径 2026-09-20），只是值得看归因 -->
        <span v-if="summary.nonMonotonic > 0" class="descent-nm-hint">
          · {{ summary.nonMonotonic }} 档伤害回升（见归因列）
        </span>
      </span>
    </div>

    <!-- 曲线（增量：每算完一档就长出来） -->
    <div v-if="points.length" class="descent-chart-wrap">
      <svg :viewBox="`0 0 ${svgW} ${svgH}`" class="descent-svg" preserveAspectRatio="none">
        <!-- 网格 + y 轴刻度 -->
        <g v-for="t in yTicks" :key="`y${t.v}`">
          <line :x1="pad.l" :x2="svgW - pad.r" :y1="t.y" :y2="t.y" class="descent-grid" />
          <text :x="pad.l - 4" :y="t.y + 3" class="descent-tick" text-anchor="end">{{ t.label }}</text>
        </g>
        <!-- 折线 -->
        <polyline :points="linePoints" class="descent-line" />
        <!-- 数据点：TopN 高亮，可点选套用 -->
        <g v-for="(p, i) in points" :key="`p${i}`">
          <circle
            :cx="xOf(i)"
            :cy="yOf(p.dmg)"
            :r="hoverIdx === i ? 5 : (isTop(p) ? 4 : 3)"
            :class="['descent-dot', { 'is-top': isTop(p), 'is-hover': hoverIdx === i }]"
            @mouseenter="hoverIdx = i"
            @mouseleave="hoverIdx = -1"
            @click="applyPoint(p, i)"
          />
          <text
            v-if="isTop(p)"
            :x="xOf(i)"
            :y="yOf(p.dmg) - 8"
            class="descent-dot-label"
            text-anchor="middle"
          >Top{{ topRank(p) }}</text>
        </g>
      </svg>
      <!-- x 轴：档位 + 降了哪个杠杆 -->
      <div class="descent-xaxis">
        <div v-for="(p, i) in points" :key="`x${i}`" class="descent-xcell">
          <span class="descent-xstep">{{ p.step }}</span>
          <span class="descent-xlabel">{{ p.degraded ?? '最优' }}</span>
        </div>
      </div>
    </div>

    <!-- 悬停详情 -->
    <div v-if="hoverPoint" class="descent-hover">
      <span class="descent-hover-title">第 {{ hoverPoint.step }} 档 · {{ hoverPoint.degraded ?? '最优配置' }}</span>
      <span>伤害 {{ fmt(hoverPoint.dmg, 0) }}</span>
      <span v-if="hoverPoint.step > 0">损失 {{ fmt(hoverPoint.lossPct, 2) }}%</span>
      <span v-if="hoverPoint.plateaued" class="descent-plateau">收益已趋平（后续档位伤害不再明显下降）</span>
      <span v-if="hoverDelta" class="descent-hover-delta">{{ hoverDelta }}</span>
      <span class="descent-hover-tip">点击该点可套用此档配置</span>
    </div>

    <!-- 档位表（TopN 高亮） -->
    <n-table v-if="points.length" size="small" :bordered="false" class="descent-table">
      <thead>
        <tr>
          <th>排序</th>
          <th>档</th>
          <th>本档降低</th>
          <th>伤害</th>
          <th>损失</th>
          <th>关键次数变化</th>
          <th>归因</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in tableRows"
          :key="row.i"
          :class="{ 'is-top': isTop(points[row.i]!) }"
          @click="applyPoint(points[row.i]!, row.i)"
        >
          <td>{{ row.rank <= topN ? `Top${row.rank}` : row.rank }}</td>
          <td>{{ row.i }}</td>
          <td>{{ points[row.i]!.degraded ?? '—（最优）' }}</td>
          <td>{{ fmt(points[row.i]!.dmg, 0) }}</td>
          <td>{{ points[row.i]!.step === 0 ? '0%' : `−${fmt(points[row.i]!.lossPct, 2)}%` }}</td>
          <td class="descent-deltas">{{ row.deltas || '—' }}</td>
          <td class="descent-nm">{{ points[row.i]!.nonMonotonic?.reason ?? '—' }}</td>
        </tr>
      </tbody>
    </n-table>

    <div v-if="message" class="descent-msg">{{ message }}</div>
  </n-card>
</template>

<script setup lang="ts">
/**
 * 难度曲线面板（降序一般化）——主计算页勾选后运行。
 *
 * 用户口径 2026-09-20：「勾选后填入对应计算次数，计算会进行多次计算」「从最优到一般化的变化」
 * 「要考虑计算成本，不能太卡顿」。
 *
 * 成本设计：档位数 = 杠杆级数展开数（非线性笛卡尔积），默认 ≤6 档 ≈ 3s；
 * 且**增量出结果**——每算完一档 push 一个点、立即重画，不是等全部完成才显示。
 *
 * 交互：曲线点/表格行**可点击套用**该档配置（写回用户的合轴率/弹刀/轴），点完用户能直接看到
 * 结果页其它 tab 的数字随之变化。
 */
import { computed, ref } from 'vue'
// ⚠ 组件必须**显式 import**：本仓没有全局注册 naive-ui（`main.ts` 只 `use(createPinia)`）。
// 漏 import 时 Vue 会把 `<n-card>` 当未知元素原样渲染成惰性 HTML——**不报错、样式全丢**，
// 只有实机点通（`scripts/ui-check.mjs`）能发现（单测/类型检查都看不见）。
import { NCard, NCheckbox, NInputNumber, NButton, NTable, useMessage } from 'naive-ui'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { descendDifficultyCurve, summarizeDescent, applyDescentLevels, type DescentPoint, type DescentResult } from '@/composables/difficultyDescent'
import { fmt } from '@/utils/format'

const props = withDefaults(defineProps<{
  /** 队伍三槽（用于 config 复位口径；缺省从 store 取） */
  team?: [string, string, string]
  /** TopN 高亮个数（缺省 3） */
  topN?: number
}>(), { topN: 3 })

const configStore = useConfigStore()
const calc = useResourceCalc()
const message = useMessage()

const enabled = ref(false)
/** 降配档单调闸门（缺省开；见 `DescentOpts.monotoneGate`） */
const monotoneGate = ref(true)
/** 测操作难度（缺省开；x 轴 + 非单调归因都靠它，见 `DescentOpts.measureDifficulty`） */
const measureDifficulty = ref(true)
const maxSteps = ref(6)
const running = ref(false)
const points = ref<DescentPoint[]>([])
const result = ref<DescentResult | null>(null)
const hoverIdx = ref(-1)

const teamOf = (): [string, string, string] => props.team
  ?? ([0, 1, 2].map(s => configStore.team[s]?.agentId ?? '') as [string, string, string])

const summary = computed(() => (result.value ? summarizeDescent(result.value) : null))
const hoverPoint = computed(() => (hoverIdx.value >= 0 ? points.value[hoverIdx.value] ?? null : null))

/** TopN = 伤害最高的 N 档（用户口径「只挑选最高伤害的几次」） */
const topIdx = computed(() => {
  const order = points.value.map((p, i) => ({ i, d: p.dmg })).sort((a, b) => b.d - a.d)
  return new Set(order.slice(0, props.topN).map(o => o.i))
})
const isTop = (p: DescentPoint) => topIdx.value.has(points.value.indexOf(p))
const topRank = (p: DescentPoint) => {
  const order = points.value.map((q, i) => ({ i, d: q.dmg })).sort((a, b) => b.d - a.d)
  return order.findIndex(o => o.i === points.value.indexOf(p)) + 1
}

const tableRows = computed(() => {
  const order = points.value.map((p, i) => ({ i, d: p.dmg })).sort((a, b) => b.d - a.d)
  return order.map((o, rank) => ({ ...o, rank: rank + 1, deltas: deltaText(o.i) }))
})

/** 关键次数变化（相对最优档，只列 Δ≥1 的跃迁——用户口径「多了一次」这类才算） */
function deltaText(i: number): string {
  const base = points.value[0]?.counts
  const cur = points.value[i]?.counts
  if (!base || !cur) return ''
  const out: string[] = []
  for (const k of Object.keys(base)) {
    const d = (cur[k] ?? 0) - (base[k] ?? 0)
    if (Math.abs(d) >= 1) out.push(`${k} ${d > 0 ? '+' : ''}${Math.round(d)}`)
  }
  return out.slice(0, 3).join('，')
}

/** 悬停点相对上一档的连锁变化 */
const hoverDelta = computed(() => {
  const i = hoverIdx.value
  if (i <= 0) return ''
  return deltaText(i)
})

// —— 图表几何 ——
const svgW = 720
const svgH = 200
const pad = { l: 56, r: 12, t: 14, b: 10 }
const xOf = (i: number) => pad.l + (points.value.length <= 1 ? 0 : (i / (points.value.length - 1)) * (svgW - pad.l - pad.r))
const dmgRange = computed(() => {
  const ds = points.value.map(p => p.dmg)
  const min = Math.min(...ds); const max = Math.max(...ds)
  const padY = (max - min) * 0.15 || max * 0.01 || 1
  return { min: Math.max(0, min - padY), max: max + padY }
})
const yOf = (d: number) => {
  const { min, max } = dmgRange.value
  return pad.t + (1 - (d - min) / Math.max(1e-9, max - min)) * (svgH - pad.t - pad.b)
}
const linePoints = computed(() => points.value.map((p, i) => `${xOf(i)},${yOf(p.dmg)}`).join(' '))
const yTicks = computed(() => {
  const { min, max } = dmgRange.value
  return [0, 0.5, 1].map(f => {
    const v = min + (max - min) * f
    return { v: f, y: yOf(v), label: `${(v / 1e6).toFixed(1)}M` }
  })
})

/** 运行：增量出结果（onPoint 每档 push + 重画） */
function run() {
  if (running.value) return
  const team = teamOf()
  if (!team[0]) { message.warning('请先配置队伍'); return }
  running.value = true
  points.value = []
  result.value = null
  // 让出一帧让 loading 状态先渲染（单次计算 ≈450ms，同步跑会卡住首帧）
  setTimeout(() => {
    try {
      const r = descendDifficultyCurve(
        { config: configStore, calc },
        team,
        {
          maxSteps: maxSteps.value,
          // 降配档单调闸门（缺省开；用户口径 2026-09-20「正向因子可以单调」）——
          // 关掉可复现历史反转（合轴率↓ 但交互档回升 ⇒ 伤害反而涨），仅供对照
          monotoneGate: monotoneGate.value,
          // 难度测量（缺省开）：x 轴与「非单调归因」都靠它；关掉则只出伤害档位（省一次测量）
          measureDifficulty: measureDifficulty.value,
          onPoint: (_p, all) => { points.value = [...all] },
        },
      )
      result.value = r
      message.success(`难度曲线完成：${r.steps} 档（最优 ${fmt(r.best, 0)}）`)
    } catch (e) {
      message.error(`难度曲线计算失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      running.value = false
    }
  }, 30)
}

/** 套用某一档配置（写回合轴率/弹刀/轴；公式与搜索器同源，见 `applyDescentLevels`） */
function applyPoint(p: DescentPoint, i: number) {
  applyDescentLevels({ config: configStore, calc }, p.levels, result.value?.parryBase)
  hoverIdx.value = i
  message.info(`已套用第 ${p.step} 档（${p.degraded ?? '最优'}）`)
}

defineExpose({ run, points, result })
</script>

<style scoped>
.descent-card { margin-top: 12px; }
.descent-header { display: flex; align-items: baseline; gap: 8px; }
.descent-sub { font-size: 12px; color: var(--app-text-dim); }
.descent-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.descent-label { font-size: 12px; color: var(--app-text-dim); }
.descent-steps { width: 88px; }
.descent-summary { font-size: 12px; color: var(--app-text-dim); }
.descent-loss { color: var(--app-accent-gold); }
.descent-chart-wrap { margin: 4px 0 8px; }
.descent-svg { width: 100%; height: 200px; display: block; }
.descent-grid { stroke: var(--app-border); stroke-width: 1; stroke-dasharray: 3 3; }
.descent-tick { fill: var(--app-text-dim); font-size: 10px; }
.descent-line { fill: none; stroke: var(--app-primary); stroke-width: 2; }
.descent-dot { fill: var(--app-primary); cursor: pointer; transition: r .1s; }
.descent-dot.is-top { fill: var(--app-accent-gold); }
.descent-dot.is-hover { fill: var(--app-text-solid); }
.descent-dot-label { fill: var(--app-accent-gold); font-size: 10px; }
.descent-xaxis { display: flex; justify-content: space-between; padding: 0 12px 0 56px; }
.descent-xcell { display: flex; flex-direction: column; align-items: center; min-width: 0; }
.descent-xstep { font-size: 11px; color: var(--app-text-dim); }
.descent-xlabel { font-size: 10px; color: var(--fg-placeholder); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 72px; }
.descent-hover { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--app-text-dim); padding: 6px 0; }
.descent-hover-title { color: var(--app-text); font-weight: 600; }
.descent-plateau { color: var(--app-accent-gold); }
.descent-hover-delta { color: var(--app-primary); }
.descent-hover-tip { color: var(--fg-3); }
.descent-table { margin-top: 6px; cursor: pointer; }
.descent-table tr.is-top td { color: var(--app-accent-gold); }
.descent-deltas { font-size: 11px; color: var(--app-text-dim); }
.descent-nm { font-size: 11px; color: var(--app-accent-gold); max-width: 320px; }
.descent-nm-hint { color: var(--app-accent-gold); }
.descent-msg { font-size: 12px; color: var(--app-text-dim); margin-top: 6px; }
</style>
