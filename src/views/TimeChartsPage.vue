<template>
  <div class="time-charts-page">
    <!-- ============ 控制面板 ============ -->
    <n-card size="small" :bordered="true">
      <div class="chart-controls">
        <div class="ctl-field">
          <span class="ctl-label">主C角色（S级）</span>
          <n-select
            v-model:value="mainAgentId"
            :options="mainAgentOptions"
            size="small"
            filterable
            style="width: 200px"
          />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">期数</span>
          <n-select
            v-model:value="selectedPeriodId"
            :options="periodOptions"
            size="small"
            filterable
            style="width: 220px"
            placeholder="先选期数"
          />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">Boss</span>
          <n-select
            v-model:value="selectedBossId"
            :options="bossOptionsForPeriod"
            size="small"
            filterable
            style="width: 240px"
            placeholder="再选该期 Boss"
          />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">限定金预算</span>
          <n-input-number
            v-model:value="budget"
            :min="0"
            :max="24"
            size="small"
            style="width: 110px"
          />
        </div>
        <div class="ctl-field">
          <label class="ctl-check">
            <input v-model="includeTestServer" type="checkbox" />
            包含测试服角色（3.2 未实装）
          </label>
        </div>
        <div class="ctl-field">
          <n-button type="primary" size="small" :loading="computing" @click="runCompute">
            {{ result ? '重新计算' : '计算' }}
          </n-button>
        </div>
        <div class="ctl-field ctl-hint">
          <span class="ctl-label">说明：按版本节点增量搜索最强 S 级配队（队伤与节点无关 → 每组合只算一次），
            再对每个节点最强队伍按所选金数做最优加金分配。当期可选 Buff 不参与（沿用当前全局 Buff 表）。</span>
        </div>
      </div>

      <!-- 进度条 -->
      <div v-if="computing || progress" class="chart-progress">
        <n-progress
          type="line"
          :percentage="Math.round((progress?.pct ?? 0) * 100)"
          :show-indicator="false"
          :height="6"
        />
        <span class="progress-text">{{ progress?.text ?? '' }}</span>
      </div>
    </n-card>

    <!-- ============ Chart 1：队伍强度随版本演变 ============ -->
    <n-card v-if="result" size="small" :bordered="true" title="队伍强度随版本演变">
      <template #header-extra>
        <span class="chart-subtitle">
          {{ result.mainName }} · {{ result.bossName }}（{{ result.phaseLabel }}）· {{ result.budget }} 金预算
          ｜ {{ result.nodes.length }} 节点 · {{ result.swapEvents.length }} 次换人
          <template v-if="result.stats.nonConverged > 0"> · {{ result.stats.nonConverged }} 队未收敛已排除</template>
          · 耗时 {{ (result.stats.durationMs / 1000).toFixed(1) }}s
        </span>
      </template>

      <!-- SVG：折线 + 换人标记 + 泳道 -->
      <div class="timeline-wrap">
      <svg
        :viewBox="`0 0 ${svgW} ${svgH}`"
        class="timeline-svg"
        @mousemove="onSvgMove"
        @mouseleave="hoverNode = -1"
      >
        <!-- 折线图网格 -->
        <g v-for="(y, i) in yTicks" :key="'g' + i">
          <line :x1="padL" :x2="svgW - padR" :y1="y" :y2="y" class="grid-line" />
          <text :x="padL - 8" :y="y + 3" class="axis-label" text-anchor="end">{{ yLabel(i) }}%</text>
        </g>

        <!-- 折线 -->
        <polyline :points="linePoints" class="trend-line" />

        <!-- 换人垂直参考线 -->
        <g v-for="(ev, i) in swapGuides" :key="'s' + i">
          <line
            :x1="ev.x" :y1="padT" :x2="ev.x"
            :y2="padT + plotH + laneTotalH"
            class="swap-line"
          />
        </g>

        <!-- 数据点 -->
        <g v-for="(pt, i) in chartPts" :key="'p' + i">
          <circle
            :cx="pt.x" :cy="pt.y"
            :r="pt.isSwap ? 6 : 4"
            :fill="pt.color"
            :stroke="hoverNode === i ? '#fff' : 'rgba(255,255,255,0.25)'"
            :stroke-width="hoverNode === i ? 2 : 1"
            class="trend-point"
          />
        </g>

        <!-- 泳道：主C / 队友1 / 队友2 -->
        <g v-for="lane in laneDefs" :key="lane.key">
          <text :x="padL - 8" :y="lane.y + laneH / 2 + 3" class="lane-label" text-anchor="end">{{ lane.label }}</text>
          <rect
            v-for="(cell, i) in lane.cells"
            :key="lane.key + i"
            :x="cell.x"
            :y="lane.y"
            :width="cellW + 0.5"
            :height="laneH"
            :fill="cell.color"
            class="lane-cell"
          >
            <title>{{ cell.name }}</title>
          </rect>
          <text
            v-for="(label, i) in lane.labels"
            :key="'l' + lane.key + i"
            :x="label.x"
            :y="lane.y + laneH / 2 + 3"
            class="lane-text"
          >{{ label.text }}</text>
        </g>

        <!-- X 轴节点标签 -->
        <g v-for="(t, i) in xTicks" :key="'x' + i">
          <text
            :x="t.x"
            :y="svgH - 8"
            class="axis-label x-label"
            text-anchor="middle"
          >{{ t.label }}</text>
        </g>

        <!-- 悬浮提示 -->
        <g v-if="hoverNode >= 0">
          <line
            :x1="chartPts[hoverNode].x" :y1="padT"
            :x2="chartPts[hoverNode].x" :y2="padT + plotH"
            class="hover-line"
          />
        </g>
      </svg>

      <!-- 悬浮卡片 -->
      <div
        v-if="hoverNode >= 0 && hoverInfo"
        class="hover-card"
        :style="{ left: hoverCardX + 'px', top: hoverCardY + 'px' }"
      >
        <div class="hc-title">{{ hoverInfo.nodeLabel }}</div>
        <div class="hc-row">队伍：{{ hoverInfo.teamNames.join(' + ') }}</div>
        <div class="hc-row">伤害 {{ compact(hoverInfo.damage) }}（{{ fmt(hoverInfo.hpRatio, 1) }}%）</div>
        <div class="hc-row">{{ hoverInfo.goldLabel }}</div>
        <div v-if="hoverInfo.swap" class="hc-row hc-swap">{{ hoverInfo.swap }}</div>
      </div>
      </div>

      <!-- 换人事件列表 -->
      <div v-if="result.swapEvents.length > 0" class="swap-events">
        <span class="swap-events-title">换人事件：</span>
        <span
          v-for="(ev, i) in result.swapEvents"
          :key="i"
          class="swap-chip"
        >
          {{ ev.nodeLabel }}：换上 {{ agentName(ev.swappedIn) }}（换下 {{ agentName(ev.swappedOut) }}）
        </span>
      </div>
    </n-card>

    <!-- ============ 明细表 ============ -->
    <n-card v-if="result" size="small" :bordered="true" title="各版本节点明细">
      <div class="table-wrap">
        <table class="tl-table">
          <thead>
            <tr>
              <th>版本</th>
              <th>队伍（{{ result.mainName }} + 队友）</th>
              <th>伤害</th>
              <th>伤害/血量%</th>
              <th>金数明细</th>
              <th>变化</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, i) in result.nodes"
              :key="r.nodeId"
              :class="{ 'swap-row': !!r.swappedIn }"
              @mouseenter="hoverNode = i"
              @mouseleave="hoverNode = -1"
            >
              <td>
                {{ r.nodeLabel }}
                <span v-if="r.nodeNote" class="node-note" :title="r.nodeNote">{{ r.nodeNote }}</span>
              </td>
              <td>
                <span class="team-cell">
                  <span class="dot" :style="{ background: colorOf(r.team[0]) }"></span>{{ agentName(r.team[0]) }}
                  <span class="dot" :style="{ background: colorOf(r.team[1]) }"></span>{{ agentName(r.team[1]) }}
                  <span class="dot" :style="{ background: colorOf(r.team[2]) }"></span>{{ agentName(r.team[2]) }}
                </span>
              </td>
              <td>{{ compact(r.damage) }}</td>
              <td :class="{ 'kill-line': r.hpRatio >= 100 }">{{ fmt(r.hpRatio, 1) }}%</td>
              <td class="gold-cell">{{ r.goldLabel }}</td>
              <td>
                <span v-if="r.swappedIn" class="swap-badge">
                  换入 {{ agentName(r.swappedIn) }} ⬅ 换出 {{ agentName(r.swappedOut ?? '') }}
                </span>
                <span v-else class="no-change">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </n-card>

    <!-- 未计算时的引导 -->
    <n-card v-else size="small" :bordered="true">
      <div class="empty-hint">
        选择主C、期数/Boss 与限定金预算后点击「计算」。<br />
        示例：仪玄（2.0 上半实装）→ 可见橘福福（2.0 下半）、卢西娅（2.3）、琉音（2.4）、诺姆（3.0）等节点换人带来的队伍强度变化。
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { NCard, NSelect, NInputNumber, NButton, NProgress } from 'naive-ui'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computeTeamTimeline, type TeamTimelineResult } from '@/composables/teamTimeline'
import { AGENT_RELEASE_NODE, VERSION_NODES, releaseNodeOf, nodeIndexOf } from '@/data/versionTimeline'
import { fmt, compact } from '@/utils/format'
import type { BossPreset, BossPresetFile, PhaseView } from '@/types/bossPreset'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
const calc = useResourceCalc()

// ========== 主C 选择（只列 S 级：AGENT_RELEASE_NODE 收录即 S 级） ==========
const mainAgentId = ref('1371') // 默认仪玄（用户指定先做仪玄验证）
const mainAgentOptions = computed(() =>
  Object.keys(AGENT_RELEASE_NODE)
    .sort((a, b) => nodeIndexOf(AGENT_RELEASE_NODE[a]) - nodeIndexOf(AGENT_RELEASE_NODE[b]))
    .map(id => ({
      value: id,
      label: `${catalogStore.getAgent(id)?.name.zhCN ?? id}（${AGENT_RELEASE_NODE[id]}）`,
    })),
)

// ========== Boss / 期数 ==========
const bossPresets = ref<BossPreset[]>([])
const phaseViews = ref<PhaseView[]>([])
const selectedPeriodId = ref('')
const selectedBossId = ref('')

onMounted(async () => {
  try {
    const res = await fetch('/static/boss-presets.json')
    if (res.ok) {
      const data = (await res.json()) as BossPresetFile
      bossPresets.value = data.bosses ?? []
      phaseViews.value = data.phaseViews ?? []
      const first = allPeriods.value[0]
      if (first) selectedPeriodId.value = first.phaseId
    }
  } catch { /* boss 数据缺失时页面显示引导 */ }
})

const allPeriods = computed(() => {
  const map = new Map<string, { phaseId: string; label: string; begin: string; hasCA: boolean }>()
  for (const b of bossPresets.value) {
    for (const ph of b.phases) {
      const cur = map.get(ph.phaseId)
      if (cur) {
        if (ph.modeType === 'critical_assault') cur.hasCA = true
      } else {
        map.set(ph.phaseId, {
          phaseId: ph.phaseId,
          label: ph.label,
          begin: ph.begin,
          hasCA: ph.modeType === 'critical_assault',
        })
      }
    }
  }
  return [...map.values()].sort((a, b) => (b.begin || b.phaseId).localeCompare(a.begin || a.phaseId))
})
const periodOptions = computed(() =>
  allPeriods.value.map(p => ({ value: p.phaseId, label: `${p.label}${p.hasCA ? '（危局）' : ''}` })),
)
const bossOptionsForPeriod = computed(() => {
  if (!selectedPeriodId.value) return []
  const out: { value: string; label: string }[] = []
  const seen = new Set<string>()
  for (const b of bossPresets.value) {
    if (seen.has(b.id)) continue
    const phases = b.phases.filter(p => p.phaseId === selectedPeriodId.value)
    if (phases.length === 0) continue
    seen.add(b.id)
    const ph = phases.find(p => p.modeType === 'critical_assault') ?? phases[0]
    out.push({ value: b.id, label: `${b.name}${ph.modeType === 'critical_assault' ? '（困难）' : '（普通）'}` })
  }
  return out
})
watch(selectedPeriodId, () => {
  const opts = bossOptionsForPeriod.value
  if (!opts.some(o => o.value === selectedBossId.value)) {
    selectedBossId.value = opts[0]?.value ?? ''
  }
})
const selectedBoss = computed(() => bossPresets.value.find(b => b.id === selectedBossId.value) ?? null)
const selectedPhase = computed(() => {
  const b = selectedBoss.value
  if (!b) return null
  const phases = b.phases.filter(p => p.phaseId === selectedPeriodId.value)
  return phases.find(p => p.modeType === 'critical_assault') ?? phases[0] ?? b.phases[0] ?? null
})

// ========== 金数 ==========
const budget = ref(6)
const includeTestServer = ref(false)

// ========== 计算 ==========
const computing = ref(false)
const progress = ref<{ pct: number; text: string } | null>(null)
const result = ref<TeamTimelineResult | null>(null)

async function runCompute() {
  const boss = selectedBoss.value
  const phase = selectedPhase.value
  if (!boss || !phase) return
  if (!releaseNodeOf(mainAgentId.value)) return
  computing.value = true
  progress.value = { pct: 0, text: '准备…' }
  await nextTick()
  try {
    result.value = await computeTeamTimeline(calc, {
      mainAgentId: mainAgentId.value,
      boss,
      phase,
      budget: budget.value ?? 6,
      includeTestServer: includeTestServer.value,
      onProgress: p => { progress.value = p },
    })
  } finally {
    computing.value = false
    progress.value = null
  }
}

// ========== 颜色 ==========
const PALETTE = ['#63e2b7', '#63b3ed', '#f6ad55', '#f687b3', '#b794f4', '#f6e05e', '#4fd1c5', '#fc8181', '#68d391', '#90cdf4', '#fbd38d', '#fbb6ce', '#d6bcfa', '#fefcbf', '#81e6d9', '#feb2b2']
function colorOf(agentId: string): string {
  let h = 0
  for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}
function agentName(id: string): string {
  return catalogStore.getAgent(id)?.name.zhCN ?? id
}

// ========== SVG 布局 ==========
const svgW = computed(() => Math.max(480, Math.min(1180, typeof window !== 'undefined' ? window.innerWidth - 120 : 960)))
const padL = 54
const padR = 14
const padT = 26
const plotH = 300
const laneH = 22
const laneGap = 6
const laneTotalH = laneH * 3 + laneGap * 2
const xLabelH = 26
const svgH = computed(() => padT + plotH + 12 + laneTotalH + xLabelH)

const nodeCount = computed(() => result.value?.nodes.length ?? 0)
const plotW = computed(() => svgW.value - padL - padR)
const cellW = computed(() => (nodeCount.value > 1 ? plotW.value / nodeCount.value : plotW.value))
function xOf(i: number): number {
  if (nodeCount.value <= 1) return padL + plotW.value / 2
  return padL + (i / (nodeCount.value - 1)) * plotW.value
}

const yMax = computed(() => {
  const maxR = Math.max(...(result.value?.nodes.map(n => n.hpRatio) ?? [0]), 0)
  const target = Math.max(100, maxR * 1.05)
  const step = target <= 200 ? 50 : 100
  return Math.ceil(target / step) * step
})
function yOf(v: number): number {
  return padT + plotH - (v / yMax.value) * plotH
}
const yTicks = computed(() => {
  const step = yMax.value <= 200 ? 50 : 100
  const out: number[] = []
  for (let v = 0; v <= yMax.value; v += step) out.push(yOf(v))
  return out
})
function yLabel(i: number): number {
  const step = yMax.value <= 200 ? 50 : 100
  return i * step
}

const chartPts = computed(() =>
  (result.value?.nodes ?? []).map((n, i) => ({
    x: xOf(i),
    y: yOf(Math.min(n.hpRatio, yMax.value)),
    color: colorOf(n.team[0]),
    isSwap: !!n.swappedIn,
  })),
)
const linePoints = computed(() => chartPts.value.map(p => `${p.x},${p.y}`).join(' '))

const swapGuides = computed(() =>
  (result.value?.nodes ?? [])
    .map((n, i) => (n.swappedIn ? { x: xOf(i) } : null))
    .filter((x): x is { x: number } => x !== null),
)

// 泳道
const laneDefs = computed(() => {
  const nodes = result.value?.nodes ?? []
  const makeLane = (key: string, label: string, slotOf: (n: typeof nodes[number]) => string) => {
    const cells = nodes.map((n, i) => ({
      x: i === 0 ? padL : padL + i * cellW.value,
      color: colorOf(slotOf(n)),
      name: agentName(slotOf(n)),
    }))
    // 换人标签：每段连续同色块首格显示角色名
    const labels: { x: number; text: string }[] = []
    let prev: string | null = null
    nodes.forEach((n, i) => {
      const id = slotOf(n)
      if (id !== prev) {
        labels.push({ x: padL + i * cellW.value + 4, text: agentName(id) })
        prev = id
      }
    })
    return { key, label, cells, labels }
  }
  const laneY = (idx: number) => padT + plotH + 12 + idx * (laneH + laneGap)
  return [
    { ...makeLane('main', '主C', n => n.team[0]), y: laneY(0) },
    { ...makeLane('t1', '队友1', n => n.team[1]), y: laneY(1) },
    { ...makeLane('t2', '队友2', n => n.team[2]), y: laneY(2) },
  ]
})

// X 轴标签：节点多时抽稀
const xTicks = computed(() => {
  const nodes = result.value?.nodes ?? []
  if (nodes.length === 0) return []
  const step = Math.max(1, Math.ceil(nodes.length / 14))
  const out: { x: number; label: string }[] = []
  for (let i = 0; i < nodes.length; i += step) {
    out.push({ x: xOf(i), label: nodes[i].nodeLabel })
  }
  if ((nodes.length - 1) % step !== 0) {
    out.push({ x: xOf(nodes.length - 1), label: nodes[nodes.length - 1].nodeLabel })
  }
  return out
})

// 悬浮
const hoverNode = ref(-1)
const hoverInfo = computed(() => {
  const n = result.value?.nodes[hoverNode.value]
  if (!n) return null
  return {
    nodeLabel: n.nodeLabel,
    teamNames: n.team.map(agentName),
    damage: n.damage,
    hpRatio: n.hpRatio,
    goldLabel: n.goldLabel,
    swap: n.swappedIn ? `换上 ${agentName(n.swappedIn)}，换下 ${agentName(n.swappedOut!)}` : '',
  }
})
const hoverCardX = ref(0)
const hoverCardY = ref(0)
function onSvgMove(e: MouseEvent) {
  const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
  const relX = e.clientX - rect.left
  const scale = svgW.value / rect.width
  const svgX = relX * scale
  if (nodeCount.value <= 0) return
  let best = -1
  let bestDist = Infinity
  chartPts.value.forEach((p, i) => {
    const d = Math.abs(p.x - svgX)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  if (best >= 0 && bestDist < plotW.value / Math.max(1, nodeCount.value)) {
    hoverNode.value = best
    hoverCardX.value = Math.min(rect.width - 240, relX + 12)
    hoverCardY.value = e.clientY - rect.top + 8
  } else {
    hoverNode.value = -1
  }
}
</script>

<style scoped>
.time-charts-page {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.chart-controls {
  display: flex;
  gap: 14px;
  align-items: flex-end;
  flex-wrap: wrap;
}
.ctl-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ctl-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
}
.ctl-check {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.65);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding-bottom: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.ctl-hint {
  flex: 1 1 280px;
  min-width: 280px;
}
.chart-progress {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.chart-progress .n-progress {
  flex: 1;
}
.progress-text {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  white-space: nowrap;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chart-subtitle {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
}
.timeline-svg {
  width: 100%;
  display: block;
  user-select: none;
}
.timeline-wrap {
  position: relative;
}
.grid-line {
  stroke: rgba(255, 255, 255, 0.08);
  stroke-width: 1;
}
.axis-label {
  fill: rgba(255, 255, 255, 0.45);
  font-size: 10px;
}
.x-label {
  font-size: 9.5px;
}
.trend-line {
  fill: none;
  stroke: #4c8bf5;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.trend-point {
  cursor: pointer;
}
.swap-line {
  stroke: rgba(246, 173, 85, 0.45);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}
.lane-label {
  fill: rgba(255, 255, 255, 0.5);
  font-size: 10px;
}
.lane-cell {
  stroke: rgba(15, 15, 18, 0.9);
  stroke-width: 0.5;
  opacity: 0.92;
}
.lane-text {
  fill: rgba(10, 10, 14, 0.85);
  font-size: 9px;
  font-weight: 700;
  pointer-events: none;
}
.hover-line {
  stroke: rgba(255, 255, 255, 0.35);
  stroke-width: 1;
  stroke-dasharray: 2 2;
}
.hover-card {
  position: absolute;
  z-index: 10;
  background: rgba(24, 24, 32, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 11.5px;
  pointer-events: none;
  max-width: 260px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
.hc-title {
  font-weight: 700;
  margin-bottom: 3px;
  color: #fff;
}
.hc-row {
  color: rgba(255, 255, 255, 0.78);
  line-height: 1.5;
}
.hc-swap {
  color: #f6ad55;
  font-weight: 600;
}
.swap-events {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.swap-events-title {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
}
.swap-chip {
  font-size: 11px;
  background: rgba(246, 173, 85, 0.12);
  color: #f6ad55;
  border: 1px solid rgba(246, 173, 85, 0.3);
  border-radius: 6px;
  padding: 2px 8px;
}
.table-wrap {
  overflow-x: auto;
}
.tl-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.tl-table th,
.tl-table td {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  white-space: nowrap;
}
.tl-table th {
  color: rgba(255, 255, 255, 0.5);
  font-weight: 600;
  font-size: 11px;
}
.tl-table tr:hover td {
  background: rgba(255, 255, 255, 0.03);
}
.tl-table tr.swap-row td {
  background: rgba(246, 173, 85, 0.05);
}
.team-cell {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: 4px;
}
.kill-line {
  color: #63e2b7;
  font-weight: 700;
}
.gold-cell {
  color: rgba(255, 255, 255, 0.7);
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.swap-badge {
  color: #f6ad55;
  font-weight: 600;
}
.no-change {
  color: rgba(255, 255, 255, 0.3);
}
.node-note {
  font-size: 10px;
  color: #f6ad55;
  border: 1px solid rgba(246, 173, 85, 0.35);
  border-radius: 4px;
  padding: 0 4px;
  margin-left: 4px;
}
.empty-hint {
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
  line-height: 1.8;
  padding: 12px 4px;
}
</style>
