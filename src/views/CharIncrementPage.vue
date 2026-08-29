<template>
  <div class="char-increment-page">
    <n-card size="small" :bordered="true">
      <template #header>
        <div class="card-header">
          <span>角色兑现曲线（危局 · 每期分数增量）</span>
          <span v-if="passResult" class="muted">
            {{ passResult.periods.length }} 期 · {{ passResult.stats.baseTeams }} 支基底队 ·
            引擎求值 {{ passResult.stats.evaluations }} 次 · 耗时 {{ (passResult.stats.durationMs / 1000).toFixed(1) }}s
          </span>
        </div>
      </template>

      <!-- 控制区 -->
      <div class="controls">
        <div class="ctl-field">
          <span class="ctl-label">角色</span>
          <n-select
            v-model:value="selectedAgentId"
            :options="agentOptions"
            size="small"
            filterable
            style="width: 220px"
            placeholder="选一张卡看它的兑现曲线"
          />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">每 Boss 基底队上限（{{ maxPerBoss }} 队 × 强度降序）</span>
          <n-input-number v-model:value="maxPerBoss" :min="1" :max="8" size="small" style="width: 90px" :disabled="!!passResult" />
        </div>
        <div class="ctl-field">
          <n-button type="primary" size="small" :loading="computing" @click="runPass">
            {{ passResult ? '重算基底' : '计算基底' }}
          </n-button>
        </div>
        <div class="ctl-field ctl-hint">
          <span class="ctl-label">队伍基底 = 归档每期危局「最低限金 ~ 最低限金+4」的强队（分数 ≥ 该 Boss 顶分 90%），
            其他全部无视——引擎只对这几十支队求值（全量秒级，不会卡）。
            每期增量 = 账号分（全基底）− 账号分（禁用含该卡的队）：卢西娅被禁 → 命破房被迫退潘引壶队的分差，就是她的抽取价值。</span>
        </div>
      </div>

      <!-- 进度 -->
      <div v-if="computing || progress" class="progress-row">
        <n-progress type="line" :percentage="Math.round((progress?.pct ?? 0) * 100)" :show-indicator="false" :height="6" />
        <span class="progress-text">{{ progress?.text ?? '' }}</span>
      </div>
      <n-alert v-if="error" type="error" title="加载失败" style="margin-top: 8px">{{ error }}</n-alert>
    </n-card>

    <!-- ============ 逐期增量（选中卡） ============ -->
    <n-card v-if="cardData" size="small" :bordered="true">
      <template #header>
        <div class="card-header">
          <span>{{ agentName(selectedAgentId) }} · 兑现曲线</span>
          <span class="muted">
            实装 {{ cardData.releaseDate ?? '—' }} · 累计增量 {{ fmt(cardData.total, 0) }} 分 ·
            有效期数 {{ cardData.perPeriod.filter(x => x != null && x.increment > 0).length }}/{{ cardData.perPeriod.length }}
          </span>
        </div>
      </template>

      <!-- 柱状图：每期一根柱（增量），叠加账号分参照线 -->
      <div class="bar-wrap">
        <div
          v-for="(x, i) in barData"
          :key="i"
          class="bar-col"
          :class="{ empty: !x.inc }"
          @mouseenter="hoverIdx = i"
          @mouseleave="hoverIdx = -1"
        >
          <div class="bar-stack">
            <div class="bar-val" v-if="x.inc">{{ compact(x.inc.increment) }}</div>
            <div
              class="bar-fill"
              :style="{ height: x.h + '%' }"
              :class="x.inc && x.inc.increment > 0 ? 'pos' : 'zero'"
            ></div>
          </div>
          <div class="bar-label" :title="x.label">{{ x.label }}</div>
          <!-- 悬浮详情 -->
          <div v-if="hoverIdx === i && x.inc" class="bar-tip">
            <div class="tip-title">{{ x.inc.label }}（{{ x.inc.date }}）</div>
            <div class="tip-row">账号分（全基底）：{{ fmt(x.inc.accountScore, 0) }}</div>
            <div class="tip-row">禁卡后：{{ fmt(x.inc.bannedScore, 0) }}</div>
            <div class="tip-row strong">本期增量：+{{ fmt(x.inc.increment, 0) }}</div>
            <div
              v-for="(pk, pi) in x.inc.picks"
              :key="'p' + pi"
              class="tip-row"
              :class="{ sub: x.inc.bannedPicks[pi]?.team && pk.team && teamsDiffer(pk.team, x.inc.bannedPicks[pi]!.team) }"
            >
              房{{ pi + 1 }} {{ pk.bossName }}：{{ pk.team ? teamLabel(pk.team) : '—' }}（{{ fmt(pk.score, 0) }}）
              <template v-if="x.inc.bannedPicks[pi]?.team && pk.team && teamsDiffer(pk.team, x.inc.bannedPicks[pi]!.team)">
                → 禁后 {{ teamLabel(x.inc.bannedPicks[pi]!.team!) }}（{{ fmt(x.inc.bannedPicks[pi]!.score, 0) }}）
              </template>
            </div>
          </div>
        </div>
      </div>
    </n-card>
    <!-- ============ 全卡排名 ============ -->
    <n-card v-if="passResult" size="small" :bordered="true">
      <template #header>
        <div class="card-header">
          <span>全卡累计增量排名</span>
          <span class="muted">点击行查看兑现曲线；「有效期数」= 增量 &gt; 0 的期数（禁了会掉分的期）</span>
        </div>
      </template>
      <div class="table-wrap">
        <table class="rank-table">
          <thead>
            <tr>
              <th>#</th>
              <th>卡</th>
              <th>累计增量</th>
              <th>有效期数</th>
              <th>实装</th>
              <th>均值/有效期</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, i) in rankRows"
              :key="r.agentId"
              :class="{ sel: r.agentId === selectedAgentId }"
              @click="selectedAgentId = r.agentId"
            >
              <td>{{ i + 1 }}</td>
              <td>{{ agentName(r.agentId) }}</td>
              <td :class="{ hot: r.total > 0 }">{{ fmt(r.total, 0) }}</td>
              <td>{{ r.periodsActive }}</td>
              <td>{{ pvReleaseDateOf(r.agentId) ?? '—' }}</td>
              <td>{{ r.periodsActive > 0 ? fmt(r.total / r.periodsActive, 0) : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NAlert, NButton, NCard, NInputNumber, NProgress, NSelect } from 'naive-ui'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computeIncrementPass, computeCardIncrements, computeAllCardTotals, type IncrementPassResult, type CardIncrementSummary, type BaseTeam } from '@/composables/charIncrement'
import { pvReleaseDateOf } from '@/composables/pullValue'
import { AGENT_RELEASE_NODE as RELEASE_NODE } from '@/data/versionTimeline'
import { fmt, compact } from '@/utils/format'
import type { BossPreset, BossPresetFile } from '@/types/bossPreset'
import type { ArchiveRoom } from '@/composables/runArchiveImport'

const catalogStore = useCatalogStore()
const calc = useResourceCalc()

// ========== 数据加载（归档 + Boss 预设，页面挂载即取） ==========
interface ArchiveFile {
  runs: never[]
  rooms: Record<string, ArchiveRoom & { seasonStart?: string }>
}
const archive = ref<ArchiveFile | null>(null)
const bosses = ref<BossPreset[]>([])
const phaseViews = ref<BossPresetFile['phaseViews']>([])
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    const [ra, bp] = (await Promise.all([
      fetch('/static/run-archive.json').then(r => { if (!r.ok) throw new Error(`归档 HTTP ${r.status}`); return r.json() }),
      fetch('/static/boss-presets.json').then(r => { if (!r.ok) throw new Error(`Boss 预设 HTTP ${r.status}`); return r.json() }),
    ])) as [ArchiveFile, BossPresetFile]
    archive.value = ra
    bosses.value = bp.bosses ?? []
    phaseViews.value = bp.phaseViews ?? []
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

// ========== 基底计算 ==========
const maxPerBoss = ref(3)
const computing = ref(false)
const progress = ref<{ pct: number; text: string } | null>(null)
const passResult = ref<IncrementPassResult | null>(null)

async function runPass() {
  const a = archive.value
  if (!a || bosses.value.length === 0) {
    error.value = '归档/Boss 数据未加载'
    return
  }
  computing.value = true
  error.value = ''
  progress.value = { pct: 0, text: '提取队伍基底…' }
  try {
    passResult.value = await computeIncrementPass({
      calc,
      bosses: bosses.value,
      periodViews: phaseViews.value ?? [],
      runs: a.runs,
      rooms: a.rooms,
      onProgress: p => { progress.value = p },
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    computing.value = false
    setTimeout(() => { progress.value = null }, 1500)
  }
}

// ========== 角色选择（全部收录角色：S 级为主，名字可检索） ==========
const selectedAgentId = ref('1451') // 默认卢西娅（用户例子）
const agentOptions = computed(() =>
  Object.keys(RELEASE_NODE)
    .map(id => ({ value: id, label: catalogStore.getAgent(id)?.name?.zhCN ?? id }))
    .filter(o => o.label !== o.value),
)

// ========== 选中卡的兑现曲线（纯集合运算，切卡即算） ==========
const cardData = computed<CardIncrementSummary | null>(() => {
  if (!passResult.value || !selectedAgentId.value) return null
  return computeCardIncrements(
    passResult.value.periods,
    selectedAgentId.value,
    pvReleaseDateOf(selectedAgentId.value),
  )
})
const hoverIdx = ref(-1)
const barData = computed(() => {
  const cd = cardData.value
  if (!cd) return []
  const maxInc = Math.max(1, ...cd.perPeriod.map(x => x?.increment ?? 0))
  return cd.perPeriod.map(x => ({
    inc: x,
    label: x ? x.date.slice(5) : '—',
    h: x ? Math.max(2, (x.increment / maxInc) * 100) : 0,
  }))
})
function agentName(id: string): string {
  return catalogStore.getAgent(id)?.name?.zhCN ?? id
}
function teamLabel(t: BaseTeam): string {
  return t.members.map(m => `${agentName(m.agentId)}${m.mindscape ? ' M' + m.mindscape : ''}`).join('+')
}
function teamsDiffer(a: BaseTeam, b: BaseTeam): boolean {
  return a.members.map(m => m.agentId).join() !== b.members.map(m => m.agentId).join()
}

// ========== 全卡排名（缓存分数上的集合运算，毫秒级） ==========
const rankRows = computed(() => {
  const pr = passResult.value
  if (!pr) return []
  const cards = Object.keys(RELEASE_NODE)
    .map(id => ({ agentId: id, releaseDate: pvReleaseDateOf(id) }))
  return computeAllCardTotals(pr.periods, cards)
})
</script>

<style scoped>
.char-increment-page {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.muted {
  color: var(--wa-500);
  font-size: 12px;
}
.controls {
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
  color: var(--wa-550);
}
.ctl-hint {
  flex: 1 1 300px;
  min-width: 300px;
}
.progress-row {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.progress-row .n-progress {
  flex: 1;
}
.progress-text {
  font-size: 11px;
  color: var(--wa-600);
  white-space: nowrap;
}

/* ========== 逐期增量柱状图 ========== */
.bar-wrap {
  display: flex;
  align-items: stretch;
  gap: 6px;
  height: 230px; /* 定高：百分比柱高需要确定父级高度 */
  padding: 26px 4px 0; /* 顶部留 tip 溢出空间 */
  overflow: visible;
}
.bar-col {
  position: relative;
  flex: 1 1 42px;
  min-width: 42px;
  max-width: 90px;
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: default;
}
.bar-col.empty {
  opacity: 0.45;
}
.bar-stack {
  /* 柱体区占柱列高的固定 160px（百分比 height 的确定父级） */
  height: 160px;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
}
.bar-fill {
  width: 62%;
  border-radius: 4px 4px 0 0;
  transition: height 0.2s ease;
}
.bar-fill.pos {
  background: linear-gradient(180deg, #f6ad55, #e8954a);
}
.bar-fill.zero {
  background: var(--wa-120);
  min-height: 3px;
}
.bar-val {
  font-size: 10px;
  color: var(--wa-700);
  margin-bottom: 3px;
  white-space: nowrap;
}
.bar-label {
  font-size: 9.5px;
  color: var(--wa-500);
  margin-top: 4px;
  white-space: nowrap;
}
.bar-tip {
  position: absolute;
  bottom: calc(100% - 18px); /* 悬在柱列上方（容器顶部已留 padding） */
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  background: var(--app-tooltip-bg);
  border: 1px solid var(--wa-140);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 11px;
  min-width: 220px;
  max-width: 340px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  white-space: normal;
}
/* 首尾柱的 tip 防溢出（贴近边缘时贴齐侧边） */
.bar-col:first-child .bar-tip {
  left: 0;
  transform: none;
}
.bar-col:last-child .bar-tip {
  left: auto;
  right: 0;
  transform: none;
}
.tip-title {
  font-weight: 700;
  color: #fff;
  margin-bottom: 4px;
}
.tip-row {
  color: var(--wa-780);
  line-height: 1.6;
}
.tip-row.strong {
  color: #f6ad55;
  font-weight: 700;
}
.tip-row.sub {
  color: var(--wa-550);
  font-size: 10.5px;
}

/* ========== 全卡排名表 ========== */
.table-wrap {
  overflow-x: auto;
  max-height: 420px;
  overflow-y: auto;
}
.rank-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.rank-table th,
.rank-table td {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--wa-60);
  white-space: nowrap;
}
.rank-table th {
  color: var(--wa-500);
  font-weight: 600;
  font-size: 11px;
  position: sticky;
  top: 0;
  background: var(--app-card-bg, var(--wa-20));
  z-index: 1;
}
.rank-table tr {
  cursor: pointer;
}
.rank-table tbody tr:hover td {
  background: var(--wa-30);
}
.rank-table tr.sel td {
  background: rgba(246, 173, 85, 0.1);
}
.rank-table td.hot {
  color: #f6ad55;
  font-weight: 700;
}
</style>
