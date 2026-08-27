<template>
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
          左侧点「部署」后，这里显示：玩家实战（分数/击杀/用时）vs 计算器理论理想（伤害 / 当期 Boss 血量）。
        </div>

        <template v-else>
          <!-- 实战 -->
          <div class="section">
            <div class="section-title">玩家实战</div>
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
            <div class="section-title">计算器（理论理想配装）</div>
            <div class="kv-grid">
              <div class="kv"><span class="k">总伤害</span><span class="v big">{{ fmt(totalDamage) }}</span></div>
              <div class="kv"><span class="k">Boss 血量</span><span class="v">{{ fmt(enemyHp) }}</span></div>
              <div class="kv"><span class="k">伤害/血量</span><span class="v big" :class="ratioClass">{{ hpRatio.toFixed(1) }}%</span></div>
              <div class="kv">
                <span class="k">预计</span>
                <n-tag :type="predictedKill ? 'success' : 'warning'" size="small" :bordered="false">{{ predictedKill ? '预计击杀' : '预计未击杀' }}</n-tag>
              </div>
            </div>
            <div class="verdict">{{ verdictText }}</div>
          </div>
        </template>
      </n-card>

      <div class="hint muted">
        口径：配装 = 计算器默认理想（推荐驱动盘 + 最优副词条 + 技能全满）；交互 = 弹刀 6 / 闪反 10 / 快支 3 / 连携 1。
        当期可选牌（3 选 1）不自动应用（归档未记录玩家选择）。差异 = 配装差 + 建模误差，需用理想配装作上界夹逼。
      </div>
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
import { applyDeployConfig } from '@/composables/runArchiveDeploy'
import type { BossPreset, BossPresetFile, PhaseView } from '@/types/bossPreset'

interface ArchiveFile {
  totalRuns: number
  generatedAt: string
  seasons: Record<string, { start: string; end: string }>
  rooms: Record<string, ArchiveRoom & { seasonStart?: string }>
  runs: ArchiveRun[]
}

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
const calc = useResourceCalc()

const loading = ref(true)
const error = ref('')
const file = ref<ArchiveFile | null>(null)
const presets = ref<BossPreset[]>([])
const phaseViews = ref<PhaseView[]>([])

const seasonId = ref('')
const bossKey = ref<string | null>(null)
const onlyKilled = ref(false)
const selected = ref<ArchiveRun | null>(null)
const lastWarnings = ref<string[]>([])

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
  return f.runs
    .filter((r) => (seasonId.value ? r.seasonId === seasonId.value : true))
    .filter((r) => {
      if (!bossKey.value) return true
      return f.rooms[r.targetId]?.bossNameZh === bossKey.value
    })
    .filter((r) => (onlyKilled.value ? r.bossKilled : true))
    .slice()
    .sort((a, b) => b.score - a.score)
})

function agentName(id: string): string {
  const a = catalogStore.getAgent(id)
  return a?.name?.zhCN ?? a?.name?.en ?? id
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

const totalDamage = computed(() => calc.teamTotalDamage.value ?? 0)
const enemyHp = computed(() => configStore.enemy.hp ?? 0)
const hpRatio = computed(() => (enemyHp.value > 0 ? (totalDamage.value / enemyHp.value) * 100 : 0))
const predictedKill = computed(() => totalDamage.value >= enemyHp.value)
const ratioClass = computed(() => (hpRatio.value >= 100 ? 'green' : hpRatio.value >= 90 ? 'amber' : 'red'))
const verdictText = computed(() => {
  if (!selected.value) return ''
  const actualKill = selected.value.bossKilled
  if (predictedKill.value === actualKill) return '✓ 计算器击杀判定与实战一致'
  if (predictedKill.value && !actualKill) return '：计算器预测击杀但实战未击杀 → 理想配装被高估（配装差 + 建模误差）'
  return '：实战击杀但计算器未达击杀线 → 计算器口径偏保守（可能漏拐/漏机制）'
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
@media (max-width: 960px) {
  .run-archive-page { grid-template-columns: 1fr; }
}
.card-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
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
</style>