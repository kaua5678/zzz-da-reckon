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
          <span class="ctl-label">Boss</span>
          <n-select
            v-model:value="selectedBossId"
            :options="bossOptions"
            size="small"
            filterable
            style="width: 240px"
            placeholder="选择 Boss（必选，默认最新危局）"
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
          <span class="ctl-label">候选队友（策展池）</span>
          <n-select
            v-model:value="candidatePool"
            :options="candidateOptions"
            multiple
            size="small"
            filterable
            style="width: 340px"
            placeholder="至少 2 名；默认 青衣/潘引壶/橘福福/卢西娅/琉音"
          />
        </div>
        <div class="ctl-field">
          <label class="ctl-check">
            <input v-model="includeTestServer" type="checkbox" />
            包含测试服角色（3.2 未实装）
          </label>
          <label class="ctl-check">
            <input v-model="autoBuild" type="checkbox" />
            自动配装（推荐+词条优化，慢）
          </label>
          <label class="ctl-check">
            <input v-model="optimalGold" type="checkbox" />
            最优加金分配（逐金贪婪，慢）
          </label>
        </div>
        <div class="ctl-field">
          <n-button type="primary" size="small" :loading="computing" @click="runCompute">
            {{ result ? '重新计算' : '计算' }}
          </n-button>
        </div>
        <div class="ctl-field ctl-hint">
          <span class="ctl-label">说明：只枚举候选池内组合（C(n,2)，每队只算一次——同队跨期面对同一 Boss 数值不变，
            当期 Buff 不参与），默认轻量速算 = 兜底配装 + 主C优先确定性加金；
            勾选「自动配装 / 最优加金」切换全量档（慢）。横轴 = 主C实装起到最新的全部期数。</span>
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

        <!-- 泳道：当期 Boss 排期（选中 Boss 命中的节点高亮） -->
        <g>
          <text :x="padL - 8" :y="bossLaneY + laneH / 2 + 3" class="lane-label" text-anchor="end">当期Boss</text>
          <template v-for="(n, i) in result?.nodes ?? []" :key="'b' + n.nodeId">
            <rect
              :x="i === 0 ? padL : padL + i * cellW"
              :y="bossLaneY"
              :width="cellW + 0.5"
              :height="laneH"
              :fill="selectedBossAppearances.has(n.nodeId) ? 'rgba(246,173,85,0.22)' : 'rgba(255,255,255,0.04)'"
              :stroke="selectedBossAppearances.has(n.nodeId) ? '#f6ad55' : 'none'"
              stroke-width="1"
              class="lane-cell"
            >
              <title>{{ bossCellTitle(n.nodeId) }}</title>
            </rect>
            <text
              :x="padL + i * cellW + 4"
              :y="bossLaneY + laneH / 2 + 3"
              class="lane-text"
              :class="{ 'boss-hit': selectedBossAppearances.has(n.nodeId) }"
            >{{ bossCellText(n.nodeId) || '—' }}</text>
          </template>
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
        <div v-if="hoverInfo.schedule" class="hc-row">{{ hoverInfo.schedule }}</div>
        <div v-if="hoverInfo.swap" class="hc-row hc-swap">{{ hoverInfo.swap }}</div>
        <div v-if="hoverInfo.bench" class="hc-row hc-bench">{{ hoverInfo.bench }}</div>
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
          <span v-if="ev.swapKind" class="swap-kind" :class="ev.swapKind">{{ swapKindLabel(ev.swapKind, ev.swapUpliftPct) }}</span>
        </span>
      </div>

      <!-- 选中 Boss 的出场节点摘要 -->
      <div v-if="selectedBossName && selectedBossAppearances.size > 0" class="boss-appearance">
        {{ selectedBossName }} 出场节点（{{ selectedBossAppearances.size }}）：{{ appearanceLabels.join(' · ') || '不在当前主C时间范围内' }}
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
              <th>当期Boss</th>
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
                <span
                  v-if="bossCellText(r.nodeId)"
                  :class="{ 'boss-hit': selectedBossAppearances.has(r.nodeId) }"
                >{{ bossCellText(r.nodeId) }}</span>
                <span v-else class="no-change">—</span>
              </td>
              <td>
                <span v-if="r.swappedIn" class="swap-badge">
                  换入 {{ agentName(r.swappedIn) }} ⬅ 换出 {{ agentName(r.swappedOut ?? '') }}
                  <span v-if="r.swapKind" class="swap-kind" :class="r.swapKind">{{ swapKindLabel(r.swapKind, r.swapUpliftPct) }}</span>
                </span>
                <span v-else-if="r.newAgentBench" class="bench-note">{{ benchText(r.newAgentBench) }}</span>
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
        选择主C、Boss（必选，默认最新危局）与限定金预算后点击「计算」；横轴自动覆盖主C实装起到最新的全部期数，所选 Boss 的历次出场会在「当期Boss」车道高亮。<br />
        示例：仪玄（2.0 上半实装）→ 可见橘福福（2.0 下半）、卢西娅（2.3）、琉音（2.4）、诺姆（3.0）等节点换人带来的队伍强度变化。
      </div>
    </n-card>

    <!-- ============ 限定S首次UP × 版本直伤系数（倍率演算引擎静态推导，无需点计算） ============ -->
    <n-card
      size="small"
      :bordered="true"
      title="限定S首次UP · 版本直伤系数（中心系数 = 支援突击伤害 / 标准值；支援突击通常不随角色改版，偏离即历代直伤膨胀档位）"
    >
      <svg :width="svgW" :height="ddSvgH" class="dd-svg">
        <!-- 测试服节点阴影 -->
        <rect
          v-for="r in ddTestServerRects"
          :key="`ddts${r.x}`"
          :x="r.x"
          :y="ddPadT"
          :width="r.w"
          :height="ddPlotBottom - ddPadT"
          fill="rgba(246, 173, 85, 0.06)"
        />
        <!-- 版本分隔网格 + 版本号刻度 -->
        <g v-for="t in ddXTicks" :key="`ddx${t.index}`">
          <line :x1="ddX(t.index)" :y1="ddPadT" :x2="ddX(t.index)" :y2="ddPlotBottom" stroke="rgba(255,255,255,0.06)" />
          <text :x="ddX(t.index)" :y="ddPlotBottom + 14" text-anchor="middle" class="dd-tick">{{ t.label }}</text>
        </g>
        <!-- y 刻度 -->
        <text v-for="t in ddYTicks" :key="`ddy${t}`" :x="ddPadL - 6" :y="ddY(t) + 4" text-anchor="end" class="dd-tick">
          {{ Math.round(t * 100) }}%
        </text>
        <!-- 100% 基准线 -->
        <line
          :x1="ddPadL"
          :y1="ddY(1)"
          :x2="svgW - ddPadR"
          :y2="ddY(1)"
          stroke="rgba(255,255,255,0.28)"
          stroke-dasharray="4 4"
        />
        <text :x="svgW - ddPadR - 2" :y="ddY(1) - 5" text-anchor="end" class="dd-baseline">100% 标准</text>
        <!-- 散点 -->
        <g v-for="p in ddPoints" :key="`ddp${p.agentId}`">
          <circle
            v-if="p.value != null"
            :cx="ddX(p.nodeIndex) + ddJitter(p.agentId)"
            :cy="ddY(p.value)"
            r="4"
            :fill="ddColor(p.value)"
          >
            <title>{{ p.agentName }}（{{ p.nodeLabel }}{{ p.nodeNote ? '，' + p.nodeNote : '' }}）：{{ (p.value * 100).toFixed(1) }}%</title>
          </circle>
          <text
            v-if="p.value != null && ddNeedLabel(p.value)"
            :x="ddX(p.nodeIndex) + ddJitter(p.agentId)"
            :y="ddLabelY(p)"
            text-anchor="middle"
            class="dd-label"
          >{{ ddShortName(p.agentName) }}</text>
        </g>
      </svg>
      <div class="dd-caption">
        每点 = 一位限定S在其首次 UP 节点的支援突击伤害比值。灰 ≈100%（无直伤特调）、蓝 &gt;105%（当期加强档）、橙 &lt;95%；悬停看数值。3.2 阴影为测试服数据；常驻 S 与 A 级不参与。演算口径见「倍率系数记录」页。
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
import { computeTeamTimeline, type NewAgentBench, type SwapKind, type TeamTimelineResult } from '@/composables/teamTimeline'
import { buildBossSchedule, scheduleByNode, type BossScheduleEntry } from '@/composables/bossSchedule'
import { AGENT_RELEASE_NODE, VERSION_NODES, releaseNodeOf, nodeIndexOf } from '@/data/versionTimeline'
import { buildDirectDamageTimeline, type DirectDamagePoint } from '@/composables/multiplierCoefficients'
import { fmt, compact } from '@/utils/format'
import type { BossPreset, BossPresetFile } from '@/types/bossPreset'

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

// ========== Boss（必选直选；期数概念已移除——横轴固定为主C实装起到最新） ==========
const bossPresets = ref<BossPreset[]>([])
const selectedBossId = ref('')

/** Boss 最近一次出场开打时间（倒序排列用） */
function latestBeginOf(b: BossPreset): string {
  let latest = ''
  for (const ph of b.phases) {
    if (ph.begin > latest) latest = ph.begin
  }
  return latest
}
const bossOptions = computed(() =>
  [...bossPresets.value]
    .sort((a, b) => latestBeginOf(b).localeCompare(latestBeginOf(a)))
    .map(b => ({ value: b.id, label: b.name })),
)

onMounted(async () => {
  try {
    const res = await fetch('/static/boss-presets.json')
    if (res.ok) {
      const data = (await res.json()) as BossPresetFile
      bossPresets.value = data.bosses ?? []
      // 默认选最新危局 Boss（无危局期数的 Boss 不作默认）
      const withCA = bossOptions.value.filter(o => {
        const b = bossPresets.value.find(x => x.id === o.value)
        return b?.phases.some(p => p.modeType === 'critical_assault')
      })
      selectedBossId.value = withCA[0]?.value ?? bossOptions.value[0]?.value ?? ''
    }
  } catch { /* boss 数据缺失时页面显示引导 */ }
})

const selectedBoss = computed(() => bossPresets.value.find(b => b.id === selectedBossId.value) ?? null)
/** 数值取该 Boss 最新一期：优先危局，否则最新期（结果标题会显示所用期数） */
const selectedPhase = computed(() => {
  const b = selectedBoss.value
  if (!b) return null
  const sorted = [...b.phases].filter(p => p.begin).sort((x, y) => y.begin.localeCompare(x.begin))
  return sorted.find(p => p.modeType === 'critical_assault') ?? sorted[0] ?? b.phases[0] ?? null
})

// ========== Boss 排期 × 版本节点（危局/试炼期数按开打时间归入节点；选中 Boss 高亮历次出场） ==========
const bossSchedule = computed(() => scheduleByNode(buildBossSchedule(VERSION_NODES, bossPresets.value)))
function scheduleOf(nodeId: string): BossScheduleEntry[] {
  return bossSchedule.value.get(nodeId) ?? []
}
/** 节点车道文案：优先危局 Boss；仅试炼时显示首个试炼 Boss（标注试炼） */
function bossCellText(nodeId: string): string {
  const sched = scheduleOf(nodeId)
  const ca = sched.find(e => e.modeType === 'critical_assault')
  if (ca) return ca.bossName
  const def = sched[0]
  return def ? `${def.bossName}（试炼）` : ''
}
function bossCellTitle(nodeId: string): string {
  const sched = scheduleOf(nodeId)
  if (sched.length === 0) return '当期无排期数据'
  return sched.map(e => `${e.modeType === 'critical_assault' ? '危局' : '试炼'}：${e.bossName}（${e.phaseLabel}）`).join('\n')
}
const selectedBossAppearances = computed(() => {
  const out = new Set<string>()
  if (!selectedBossId.value) return out
  for (const [nodeId, entries] of bossSchedule.value) {
    if (entries.some(e => e.bossId === selectedBossId.value)) out.add(nodeId)
  }
  return out
})
const selectedBossName = computed(() => bossPresets.value.find(b => b.id === selectedBossId.value)?.name ?? '')
const appearanceLabels = computed(() =>
  (result.value?.nodes ?? []).filter(n => selectedBossAppearances.value.has(n.nodeId)).map(n => n.nodeLabel),
)

// ========== 金数 ==========
const budget = ref(6)
const includeTestServer = ref(false)

// ========== 候选队友策展池（localStorage 持久化；轻量速算 = 只枚举池内 C(n,2) 组合） ==========
const CANDIDATE_POOL_KEY = 'zzz-timeline-candidate-pool'
/** 用户口径种子：仪玄演变路径的队友（青衣/潘引壶/橘福福/卢西娅/琉音） */
const DEFAULT_CANDIDATE_POOL = ['1251', '1421', '1391', '1451', '1481']
const candidatePool = ref<string[]>(loadCandidatePool())
function loadCandidatePool(): string[] {
  try {
    const raw = localStorage.getItem(CANDIDATE_POOL_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        const valid = arr.filter((id: unknown) => typeof id === 'string' && id !== '1371' && AGENT_RELEASE_NODE[id as string])
        if (valid.length >= 2) return valid as string[]
      }
    }
  } catch { /* 损坏回落默认 */ }
  return [...DEFAULT_CANDIDATE_POOL]
}
watch(candidatePool, v => {
  try { localStorage.setItem(CANDIDATE_POOL_KEY, JSON.stringify(v)) } catch { /* 忽略 */ }
}, { deep: true })
const autoBuild = ref(false)
const optimalGold = ref(false)
const candidateOptions = Object.keys(AGENT_RELEASE_NODE)
  .sort((x, y) => nodeIndexOf(AGENT_RELEASE_NODE[x]) - nodeIndexOf(AGENT_RELEASE_NODE[y]))
  .map(id => ({ value: id, label: `${catalogStore.getAgent(id)?.name.zhCN ?? id}（${AGENT_RELEASE_NODE[id]}）` }))

// ========== 计算 ==========
const computing = ref(false)
const progress = ref<{ pct: number; text: string } | null>(null)
const result = ref<TeamTimelineResult | null>(null)

async function runCompute() {
  const boss = selectedBoss.value
  const phase = selectedPhase.value
  if (!boss || !phase) return
  if (!releaseNodeOf(mainAgentId.value)) return
  const pool = candidatePool.value.filter(id => id !== mainAgentId.value)
  if (pool.length < 2) {
    progress.value = { pct: 1, text: '候选队友至少需要 2 名（不含主C）' }
    setTimeout(() => { progress.value = null }, 2500)
    return
  }
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
      candidatePool: candidatePool.value,
      autoBuild: autoBuild.value,
      optimalGold: optimalGold.value,
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
// 第 4 条车道：当期 Boss 排期（危局/试炼）
const bossLaneY = padT + plotH + 12 + laneTotalH + laneGap
const xLabelH = 26
const svgH = computed(() => padT + plotH + 12 + laneTotalH + laneGap + laneH + xLabelH)

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
/** 换人判定徽标文案：上位 +12.4% / 平替 +0.8% */
function swapKindLabel(kind: SwapKind, pct?: number): string {
  const label = kind === 'upgrade' ? '上位' : '平替'
  return pct == null ? label : `${label} ${pct > 0 ? '+' : ''}${fmt(pct, 1)}%`
}
/** 实装未进队标注：X 实装未进队 · 平替（差 y%，可不抽）/ 未上位（差 y%） */
function benchText(b: NewAgentBench): string {
  const names = b.agents.map(agentName).join('/')
  const gap = fmt(Math.abs(b.gapPct), 1)
  return b.kind === 'lateral'
    ? `${names} 实装未进队 · 平替（差 ${gap}%，可不抽）`
    : `${names} 实装未进队 · 未上位（差 ${gap}%）`
}
const hoverInfo = computed(() => {
  const n = result.value?.nodes[hoverNode.value]
  if (!n) return null
  return {
    nodeLabel: n.nodeLabel,
    teamNames: n.team.map(agentName),
    damage: n.damage,
    hpRatio: n.hpRatio,
    goldLabel: n.goldLabel,
    swap: n.swappedIn
      ? `换上 ${agentName(n.swappedIn)}，换下 ${agentName(n.swappedOut!)}` +
        (n.swapKind ? `（${swapKindLabel(n.swapKind, n.swapUpliftPct)}）` : '')
      : '',
    bench: n.newAgentBench ? benchText(n.newAgentBench) : '',
    schedule: (() => {
      const sched = scheduleOf(n.nodeId)
      const ca = sched.find(e => e.modeType === 'critical_assault')
      const dfd = [...new Set(sched.filter(e => e.modeType !== 'critical_assault').map(e => e.bossName))]
      return [ca ? `危局：${ca.bossName}` : '', dfd.length > 0 ? `试炼：${dfd.join('/')}` : ''].filter(Boolean).join(' · ')
    })(),
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
// ============ 限定S首次UP × 版本直伤系数（倍率演算引擎静态推导，见 composables/multiplierCoefficients.ts） ============

const ddPoints = computed(() =>
  buildDirectDamageTimeline(catalogStore.catalog?.agents ?? [], catalogStore.catalog?.agentSkills ?? []),
)

const ddPadL = 46
const ddPadR = 18
const ddPadT = 18
const ddPadB = 32
const ddSvgH = 268
const ddPlotBottom = ddSvgH - ddPadB
const ddNodeMaxIndex = VERSION_NODES.length - 1

function ddX(nodeIndex: number): number {
  return ddPadL + (nodeIndex / ddNodeMaxIndex) * (svgW.value - ddPadL - ddPadR)
}

const ddVMin = computed(() => {
  const vs = ddPoints.value.map((p) => p.value).filter((v): v is number => v != null)
  return Math.min(0.7, ...(vs.length ? vs : [0.7])) - 0.03
})
const ddVMax = computed(() => {
  const vs = ddPoints.value.map((p) => p.value).filter((v): v is number => v != null)
  return Math.max(1.3, ...(vs.length ? vs : [1.3])) + 0.03
})

function ddY(v: number): number {
  const span = ddVMax.value - ddVMin.value
  return ddPadT + (1 - (v - ddVMin.value) / span) * (ddPlotBottom - ddPadT)
}

const ddYTicks = [0.75, 0.9, 1.0, 1.1, 1.25]

/** 每个版本只标首个节点的版本号 */
const ddXTicks = (() => {
  const seen = new Set<string>()
  return VERSION_NODES.map((n, index) => ({ index, label: n.version })).filter(({ label }) => {
    if (seen.has(label)) return false
    seen.add(label)
    return true
  })
})()

/** 测试服节点阴影（note 含「测试服」），随 svgW 响应式 */
const ddTestServerRects = computed(() => {
  const rects: Array<{ x: number; w: number }> = []
  VERSION_NODES.forEach((n, index) => {
    if (!(n.note ?? '').includes('测试服')) return
    const left = index > 0 ? ddX(index - 0.5) : ddPadL
    const right = index < ddNodeMaxIndex ? ddX(index + 0.5) : svgW.value - ddPadR
    rects.push({ x: left, w: Math.max(8, right - left) })
  })
  return rects
})

function ddJitter(agentId: string): number {
  let h = 0
  for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) | 0
  return ((h % 7) - 3) * 4
}

function ddColor(v: number): string {
  if (v > 1.05) return '#7dd3fc'
  if (v < 0.95) return '#fdba74'
  return 'rgba(255,255,255,0.55)'
}

function ddNeedLabel(v: number): boolean {
  return Math.abs(v - 1) > 0.05
}

function ddShortName(name: string): string {
  const cleaned = name.replace(/「|」/g, '')
  return cleaned.length > 6 ? `${cleaned.slice(0, 6)}…` : cleaned
}

/** 同节点多个带标签点纵向错开；≥1 标在点上方、<1 标在下方 */
const ddLabelSlots = computed(() => {
  const groups = new Map<number, string[]>()
  for (const p of ddPoints.value) {
    if (p.value == null || !ddNeedLabel(p.value)) continue
    const arr = groups.get(p.nodeIndex) ?? []
    arr.push(p.agentId)
    groups.set(p.nodeIndex, arr)
  }
  const m = new Map<string, number>()
  for (const [, ids] of groups) ids.forEach((id, i) => m.set(id, i))
  return m
})

function ddLabelY(p: DirectDamagePoint): number {
  const v = p.value ?? 1
  const slot = ddLabelSlots.value.get(p.agentId) ?? 0
  return v >= 1 ? ddY(v) - (9 + slot * 13) : ddY(v) + 16 + slot * 13
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
.swap-kind {
  font-weight: 700;
  margin-left: 4px;
}
.swap-kind.upgrade {
  color: #ff8f5a;
}
.swap-kind.lateral {
  color: rgba(255, 255, 255, 0.55);
  font-weight: 500;
}
.bench-note {
  color: rgba(255, 255, 255, 0.45);
  font-size: 11px;
}
.boss-hit {
  color: #f6ad55;
  font-weight: 700;
}
.boss-appearance {
  margin-top: 6px;
  font-size: 11px;
  color: #f6ad55;
}
.hc-bench {
  color: rgba(255, 255, 255, 0.55);
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
.dd-svg {
  display: block;
  max-width: 100%;
}
.dd-tick {
  fill: rgba(255, 255, 255, 0.45);
  font-size: 10px;
}
.dd-baseline {
  fill: rgba(255, 255, 255, 0.6);
  font-size: 10px;
}
.dd-label {
  fill: rgba(255, 255, 255, 0.82);
  font-size: 10px;
  paint-order: stroke;
  stroke: rgba(10, 10, 14, 0.85);
  stroke-width: 3px;
}
.dd-caption {
  margin-top: 6px;
  color: rgba(255, 255, 255, 0.5);
  font-size: 11.5px;
  line-height: 1.7;
}
</style>
