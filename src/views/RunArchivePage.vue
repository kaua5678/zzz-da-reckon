<template>
  <div>
    <div class="run-archive-page">
      <div class="archive-column">
        <n-card size="small" :bordered="true">
          <template #header>
            <div class="card-header">
              <span>实战归档（危局强袭）</span>
              <span v-if="file" class="muted">共 {{ file.totalRuns }} 条 · {{ file.generatedAt.slice(0, 10) }} 快照</span>
            </div>
          </template>

          <div v-if="loading" class="muted">数据加载中…</div>
          <n-alert v-else-if="error" type="error" title="加载失败">{{ error }}</n-alert>

          <template v-else>
            <n-space :size="8" style="margin-bottom: 10px" :wrap="true">
              <n-select v-model:value="seasonId" :options="seasonOptions" size="small" style="width: 210px" placeholder="期数" />
              <n-select v-model:value="bossKey" :options="bossOptions" size="small" style="width: 200px" placeholder="Boss（全部）" clearable />
              <n-switch v-model:value="onlyKilled" size="small"><template #checked>仅看击杀</template><template #unchecked>全部</template></n-switch>
              <n-switch v-model:value="lowGoldOnly" size="small"><template #checked>仅看低金顶分</template><template #unchecked>全部</template></n-switch>
              <template v-if="lowGoldOnly">
                <span class="muted">金数窗口</span>
                <n-select v-model:value="goldWindow" :options="goldWindowOptions" size="small" style="width: 118px" />
                <span class="muted">击杀顶分里限定金数最低的投稿（角色上限）</span>
              </template>
            </n-space>

            <n-data-table
              :columns="columns"
              :data="filteredRuns"
              :pagination="{ pageSize: 20 }"
              :row-key="(r: any) => r.id"
              size="small"
              :bordered="false"
            />
          </template>
        </n-card>
      </div>

      <div class="compare-column">
        <n-card size="small" :bordered="true">
          <template #header><span>对比</span></template>

          <div v-if="!selected" class="muted" style="padding: 20px 8px">
            左侧点「部署」后，这里显示：玩家实战（分数/击杀/用时）vs 计算器理论理想（伤害 / 当期 Boss 血量），下方铺开资源池明细。
          </div>

          <template v-else>
            <!-- 实战 -->
            <div class="section">
              <div class="section-title">玩家实战<span v-if="isAdversity" class="muted"> · 困难</span></div>
              <div class="kv-grid">
                <div class="kv"><span class="k">分数</span><span class="v big">{{ selected.score }}</span></div>
                <div class="kv"><span class="k">用时</span><span class="v">{{ selected.timeSeconds }}s</span></div>
                <div class="kv">
                  <span class="k">结果</span>
                  <n-tag :type="selected.bossKilled ? 'success' : 'warning'" size="small" :bordered="false">
                    {{ selected.bossKilled ? '击杀' : '未击杀' }}
                  </n-tag>
                </div>
                <div class="kv"><span class="k">投稿</span><span class="v">{{ selected.authorName }}</span></div>
              </div>
              <div class="team-line">{{ teamLine(selected) }}</div>
              <a v-if="selected.videoUrl" :href="selected.videoUrl" target="_blank" rel="noreferrer" class="video-link">查看原视频 ↗</a>
              <div class="deploy-warnings" v-if="lastWarnings.length">
                <div v-for="w in lastWarnings" :key="w" class="warn">⚠ {{ w }}</div>
              </div>
            </div>

            <n-divider />

            <!-- 计算器 -->
            <div class="section">
              <div class="section-title">计算器（理论理想配装）<span v-if="isAdversity" class="muted"> · 困难</span></div>
              <div class="kv-grid">
                <div class="kv"><span class="k">总伤害</span><span class="v big">{{ fmt(totalDamage) }}</span></div>
                <div class="kv"><span class="k">Boss 血量</span><span class="v">{{ fmt(enemyHp) }}</span></div>
                <div class="kv"><span class="k">伤害/血量</span><span class="v big" :class="ratioClass">{{ hpRatio.toFixed(1) }}%<template v-if="hpRatio > 100"> <span class="muted" style="font-size:12px">≈{{ killTimeText }}s 击杀</span></template></span></div>
                <div class="kv"><span class="k">伤害分</span><span class="v big">{{ Math.round(predictedScore) }} / 60000</span></div>
                <div class="kv">
                  <span class="k">预计</span>
                  <n-tag :type="predictedKill ? 'success' : 'warning'" size="small" :bordered="false">{{ predictedKill ? '预计击杀' : '预计未击杀' }}</n-tag>
                </div>
              </div>
              <div class="verdict">{{ verdictText }}</div>

              <!-- 当期 Buff 快捷选择（归档未记录玩家选择；点选写入全局 Buff 表参与计算） -->
              <div v-if="deployPhaseView && deployPhaseView.buffs.length > 0" class="period-buff-row">
                <span class="pb-label">当期 Buff</span>
                <n-button size="tiny" :type="selectedBuffTitle === 'none' ? 'primary' : 'default'" @click="pickPeriodBuff(null)">不用</n-button>
                <n-button
                  v-for="b in deployPhaseView.buffs"
                  :key="b.title"
                  size="tiny"
                  :type="selectedBuffTitle === b.title ? 'primary' : 'default'"
                  :disabled="b.testOnly"
                  :title="(b.effects ?? []).map(e => `${e.stat} +${e.value}`).join('；') || (b.unparsed ?? []).join('；')"
                  @click="pickPeriodBuff(b)"
                >
                  {{ b.title || '(未命名)' }}{{ b.testOnly ? '（测试）' : '' }}
                </n-button>
              </div>
              <div v-else-if="deployPhaseView" class="period-buff-row muted">当期 Buff：无可选牌（未解析/测试服占位）</div>
            </div>
          </template>
        </n-card>

        <div class="hint muted">
          口径：配装 = 计算器默认理想（推荐驱动盘 + 最优副词条 + 技能全满）；交互 = 轴模式自动推导（连携从轴读、弹刀按「保底4失衡 + 保底4喧响缺口÷215」反推，闪反按职业基准（支援/防护 0，其余 10）/ 快支3 为固定基准）。
          当期可选牌（3 选 1）不自动应用（归档未记录玩家选择）。伤害分 = 分段线性伤害分（普通/困难两套曲线，操作分已剔除）；归档 65000 = 60000 伤害分 + 5000 操作分，击杀即伤害分 60000。差异 = 配装差 + 建模误差，需用理想配装作上界夹逼。
        </div>
      </div>
    </div>

    <!-- 资源池（部署后全宽铺开，用于定位「伤害偏了还是资源循环偏了」） -->
    <div v-if="selected && resourceResult && resourceResult.characters.length" class="resource-pool-section">
      <n-card size="small" :bordered="true">
        <template #header>
          <div class="card-header">
            <span>资源池（理论理想循环）</span>
            <span class="muted">
              迭代 {{ resourceResult.iterations }} 次{{ resourceResult.converged ? '·已收敛' : '·未收敛' }}
              · 失衡 {{ stunPoolResult?.stunCount ?? 0 }} 次
              · 连携 {{ stunPoolResult?.chainCountTotal ?? 0 }} 次
              · 喧响奖励 +{{ fmt(stunPoolResult?.decibelBonus ?? 0) }}
            </span>
          </div>
        </template>
        <div class="resource-cards">
          <ResourceResultCard
            v-for="c in resourceResult.characters"
            :key="c.slot"
            :result="c"
            :agent-name="agentNames[c.agentId] || c.agentName || c.agentId"
            :specialty="getSpecialty(c.agentId)"
            :stun-pool-result="stunPoolResult"
            :anomaly-pool-result="anomalyPoolResult"
          />
        </div>
        <div class="pool-hint muted">
          能量/喧响/失衡/积蓄 + 招式执行计划：与实战视频里的出招数、终结技/强特次数对照，可区分「资源循环估算偏差」与「伤害倍率估算偏差」。
        </div>
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { NCard, NSelect, NSwitch, NDataTable, NTag, NButton, NSpace, NDivider, NAlert } from 'naive-ui'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { submissionToDeploy, type ArchiveRun, type ArchiveRoom } from '@/composables/runArchiveImport'
import { applyDeployConfig, applyPeriodBuff } from '@/composables/runArchiveDeploy'
import type { DeployConfig } from '@/composables/runArchiveImport'
import { runLimitedGold, lowGoldFrontier } from '@/composables/limitedGold'
import { scoreForDamageRatio } from '@/core/deadlyAssaultScore'
import ResourceResultCard from '@/components/ResourceResultCard.vue'
import type { BossPreset, BossPresetFile, PhaseView, PhaseBuffCard } from '@/types/bossPreset'

interface ArchiveFile {
  totalRuns: number
  generatedAt: string
  seasons: Record<string, { start: string; end: string }>
  rooms: Record<string, ArchiveRoom & { seasonStart?: string }>
  runs: ArchiveRun[]
}

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
const { teamTotalDamage, resourceResult, stunPoolResult, anomalyPoolResult, agentNames } = useResourceCalc()

const loading = ref(true)
const error = ref('')
const file = ref<ArchiveFile | null>(null)
const presets = ref<BossPreset[]>([])
const phaseViews = ref<PhaseView[]>([])

const seasonId = ref('')
const bossKey = ref<string | null>(null)
const onlyKilled = ref(false)
const lowGoldOnly = ref(false)
const goldWindow = ref(0)
const selected = ref<ArchiveRun | null>(null)
const lastWarnings = ref<string[]>([])

/** 金数窗口（低金顶分：取最低金 + 该窗口内的投稿） */
const goldWindowOptions = [
  { label: '最低金', value: 0 },
  { label: '最低金 +1', value: 1 },
  { label: '最低金 +2', value: 2 },
  { label: '最低金 +3', value: 3 },
  { label: '最低金 +4', value: 4 },
]

onMounted(async () => {
  try {
    const [ra, bp] = (await Promise.all([
      fetch('/static/run-archive.json').then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
      fetch('/static/boss-presets.json').then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }),
    ])) as [ArchiveFile, BossPresetFile]
    file.value = ra
    presets.value = bp.bosses ?? []
    phaseViews.value = bp.phaseViews ?? []
    const ids = [...new Set(ra.runs.map((r) => r.seasonId))].sort(
      (a, b) => (ra.seasons[b]?.start ?? '').localeCompare(ra.seasons[a]?.start ?? ''),
    )
    if (ids.length) seasonId.value = ids[0]
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

const seasonOptions = computed(() => {
  const f = file.value
  if (!f) return []
  const ids = [...new Set(f.runs.map((r) => r.seasonId))].sort((a, b) => (f.seasons[b]?.start ?? '').localeCompare(f.seasons[a]?.start ?? ''))
  return ids.map((id) => ({ value: id, label: `${id} ${(f.seasons[id]?.start ?? '').slice(0, 10)}` }))
})

const bossOptions = computed(() => {
  const f = file.value
  if (!f || !seasonId.value) return []
  const names = new Map<string, string>()
  for (const r of f.runs) {
    if (r.seasonId !== seasonId.value) continue
    const room = f.rooms[r.targetId]
    if (room?.bossNameZh) names.set(room.bossNameZh, room.bossNameZh)
  }
  return [...names.keys()].map((n) => ({ value: n, label: n })).sort((a, b) => a.label.localeCompare(b.label))
})

const filteredRuns = computed(() => {
  const f = file.value
  if (!f) return []
  const base = f.runs
    .filter((r) => (seasonId.value ? r.seasonId === seasonId.value : true))
    .filter((r) => {
      if (!bossKey.value) return true
      return f.rooms[r.targetId]?.bossNameZh === bossKey.value
    })
    .filter((r) => (onlyKilled.value ? r.bossKilled : true))
  if (lowGoldOnly.value) {
    // 低金顶分前沿：每房间击杀顶分里限定金数最低（+窗口）的一批，按金数升序（最少金在前）
    return lowGoldFrontier(base, { killedOnly: true, goldWindow: goldWindow.value }).sort(
      (a, b) => runLimitedGold(a.team) - runLimitedGold(b.team) || b.score - a.score,
    )
  }
  return base.slice().sort((a, b) => b.score - a.score)
})

function agentName(id: string): string {
  const a = catalogStore.getAgent(id)
  return a?.name?.zhCN ?? a?.name?.en ?? id
}

function getSpecialty(id: string): string {
  return catalogStore.getAgent(id)?.specialty ?? ''
}

function teamLine(run: ArchiveRun): string {
  return run.team
    .map((m) => `${agentName(m.agentId)} M${m.mindscape}`)
    .join(' · ')
}

function onDeploy(run: ArchiveRun) {
  const f = file.value
  if (!f) return
  const room = f.rooms[run.targetId]
  const deploy = submissionToDeploy(run, room, presets.value, room?.seasonStart)
  applyDeployConfig(configStore, deploy, presets.value, phaseViews.value)
  selected.value = run
  lastWarnings.value = deploy.warnings
  lastDeploy.value = deploy
  // 换部署时清掉上一期的当期 buff 选择（过期选择不跨 Boss 生效）
  if (selectedBuffTitle.value !== 'none' && deployPhaseView.value?.buffs.some(b => b.title === selectedBuffTitle.value) !== true) {
    pickPeriodBuff(null)
  }
}

// ========== 当期 Buff 快捷选择 ==========
/** 最近一次部署（用于取部署 Boss 的期相位 → 当期 buff 牌） */
const lastDeploy = ref<DeployConfig | null>(null)
const deployPhaseView = computed(() =>
  lastDeploy.value?.boss ? phaseViews.value.find(v => v.phaseId === lastDeploy.value!.boss!.phaseId) ?? null : null,
)
/** 当前选中牌标题：'none' = 不用；牌名 = 手动选中的那张 */
const selectedBuffTitle = ref<string>('none')
/** 击杀时间（秒）：伤害/血量 > 100% 时 = 战斗时长 × 100/hpRatio（2 倍伤害 → 90s 击杀，按 180s 基准） */
const killTimeText = computed(() => {
  const ratio = hpRatio.value
  if (ratio <= 100) return ''
  const battle = configStore.enemy.battleTime ?? 180
  return Math.round(battle * 100 / ratio)
})
function pickPeriodBuff(card: PhaseBuffCard | null) {
  const phaseId = deployPhaseView.value?.phaseId ?? ''
  const applied = applyPeriodBuff(configStore, phaseId, card)
  selectedBuffTitle.value = card && applied ? card.title : 'none'
  configStore.triggerRefresh?.()
}

const columns = computed(() => [
  {
    title: 'Boss',
    key: 'boss',
    width: 150,
    render: (r: ArchiveRun) => file.value?.rooms[r.targetId]?.bossNameZh ?? r.targetId,
  },
  {
    title: '队伍',
    key: 'team',
    minWidth: 200,
    render: (r: ArchiveRun) => r.team.map((m) => `${agentName(m.agentId)}M${m.mindscape}`).join(' / '),
  },
  { title: '金', key: 'gold', width: 50, render: (r: ArchiveRun) => String(runLimitedGold(r.team)) },
  { title: '分数', key: 'score', width: 70, render: (r: ArchiveRun) => String(r.score) },
  {
    title: '结果',
    key: 'killed',
    width: 70,
    render: (r: ArchiveRun) => h(NTag, { type: r.bossKilled ? 'success' : 'warning', size: 'small', bordered: false }, { default: () => (r.bossKilled ? '击杀' : '未击杀') }),
  },
  { title: '用时', key: 'time', width: 60, render: (r: ArchiveRun) => `${r.timeSeconds}s` },
  { title: '投稿', key: 'author', width: 110, render: (r: ArchiveRun) => r.authorName ?? '' },
  {
    title: '',
    key: 'deploy',
    width: 70,
    render: (r: ArchiveRun) => h(NButton, { size: 'tiny', type: 'primary', secondary: true, onClick: () => onDeploy(r) }, { default: () => '部署' }),
  },
])

const totalDamage = computed(() => teamTotalDamage.value ?? 0)
const enemyHp = computed(() => configStore.enemy.hp ?? 0)
const hpRatio = computed(() => (enemyHp.value > 0 ? (totalDamage.value / enemyHp.value) * 100 : 0))
const predictedKill = computed(() => totalDamage.value >= enemyHp.value)
const ratioClass = computed(() => (hpRatio.value >= 100 ? 'green' : hpRatio.value >= 90 ? 'amber' : 'red'))
/** 当前部署 run 是否困难（Adversity）；决定伤害分走普通/困难哪条分段曲线 */
const isAdversity = computed(() => (selected.value?.mode ?? '').includes('Adversity'))
const predictedScore = computed(() =>
  scoreForDamageRatio(enemyHp.value > 0 ? totalDamage.value / enemyHp.value : 0, isAdversity.value ? 'critical_assault' : 'defense'),
)
const verdictText = computed(() => {
  if (!selected.value) return ''
  const actualKill = selected.value.bossKilled
  const ps = Math.round(predictedScore.value)
  if (predictedKill.value && actualKill) return `✓ 击杀判定一致（计算器伤害分 ${ps} / 60000）`
  if (!predictedKill.value && !actualKill) return '✓ 双方均未击杀'
  if (predictedKill.value && !actualKill) return `：计算器预测击杀但实战未击杀（伤害分 ${ps} / 60000）→ 理想配装被高估（配装差 + 建模误差）`
  return `：实战击杀但计算器未达击杀线（伤害分 ${ps} / 60000）→ 口径偏保守（漏拐/漏机制）`
})

function fmt(n: number): string {
  return n >= 1e8 ? `${(n / 1e8).toFixed(2)}亿` : n >= 1e4 ? `${(n / 1e4).toFixed(1)}万` : String(Math.round(n))
}
</script>

<style scoped>
.run-archive-page {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(320px, 1fr);
  gap: 14px;
  align-items: start;
}
.period-buff-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--line-strong);
}
.period-buff-row .pb-label {
  font-size: 12px;
  opacity: 0.75;
  margin-right: 2px;
}
@media (max-width: 960px) {
  .run-archive-page { grid-template-columns: 1fr; }
}
.resource-pool-section {
  margin-top: 16px;
}
.resource-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
@media (max-width: 1200px) {
  .resource-cards { grid-template-columns: 1fr; }
}
.card-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
.muted { color: var(--wa-500); font-size: 12px; }
.section { margin-bottom: 8px; }
.section-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--wa-800); }
.kv-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 14px; }
.kv { display: flex; align-items: baseline; gap: 8px; }
.k { color: var(--wa-500); font-size: 12px; }
.v { font-size: 14px; font-weight: 600; }
.v.big { font-size: 20px; }
.green { color: #63e2b7; }
.amber { color: #e6b464; }
.red { color: #e88080; }
.team-line { margin: 8px 0 4px; font-size: 13px; color: var(--wa-750); }
.video-link { font-size: 12px; color: #63b3ed; text-decoration: none; }
.deploy-warnings { margin-top: 8px; }
.warn { font-size: 11px; color: #e6b464; line-height: 1.6; }
.verdict { margin-top: 10px; font-size: 13px; color: var(--wa-750); }
.hint { margin-top: 10px; line-height: 1.7; }
.pool-hint { margin-top: 12px; line-height: 1.7; }
</style>