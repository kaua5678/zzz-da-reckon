<template>
  <div>
    <div class="run-archive-page">
      <div class="archive-column">
        <n-card size="small" :bordered="true">
          <template #header>
            <div class="card-header">
              <span>实战归档（危局强袭 · 每队最低金满分 ＋ 高手全部投稿）</span>
              <span v-if="file" class="muted">共 {{ file.totalRuns }} 条 · {{ file.generatedAt.slice(0, 10) }} 快照</span>
            </div>
          </template>

          <div v-if="loading" class="muted">数据加载中…</div>
          <n-alert v-else-if="error" type="error" title="加载失败">{{ error }}</n-alert>

          <template v-else>
            <div class="filter-rows">
              <div class="filter-row">
                <n-select v-model:value="seasonId" :options="seasonOptions" size="small" style="width: 190px" placeholder="期数" />
                <n-select v-model:value="bossKey" :options="bossOptions" size="small" style="width: 190px" placeholder="Boss（全部）" clearable />
                <span class="switch-label muted">
                  <n-switch v-model:value="frontierOnly" size="small" />
                  <span>只看顶分战斗</span>
                </span>
                <span class="muted">顶分窗口</span>
                <n-select v-model:value="goldWindow" :options="goldWindowOptions" size="small" style="width: 116px" :disabled="!scoreWindowActive" />
              </div>
              <div class="filter-row">
                <n-select v-model:value="playerName" :options="playerOptions" size="small" style="width: 250px" placeholder="玩家（全部）" clearable filterable />
                <span class="switch-label muted">
                  <n-switch v-model:value="topPlayersOnly" size="small" />
                  <span>只看顶级玩家</span>
                </span>
                <span class="switch-label muted">
                  <n-switch v-model:value="expertsOnly" size="small" />
                  <span>只看高手</span>
                </span>
                <n-select v-model:value="agentFilter" :options="agentOptions" size="small" style="width: 230px" placeholder="角色（全部）" clearable filterable />
                <n-button size="tiny" quaternary @click="resetFilters">清空筛选</n-button>
              </div>
              <div class="archive-summary muted" v-if="file">
                命中 {{ filteredRuns.length }} 条 · 本范围顶分 {{ archiveQuery.frontierCount }} 条 / {{ archiveQuery.roomCount }} 房
                · 玩家 {{ archiveQuery.players.length }} · 角色 {{ archiveQuery.agents.length }}
                ｜ 全库 {{ file.totalRuns }} 条<template v-if="expertsFile?.totalRuns"> + 补录 {{ expertsFile.totalRuns }} 条</template>
                · {{ coverage.rooms }} 房 · {{ coverage.players }} 位投稿人 · {{ coverage.agents }} 个角色 · {{ file.generatedAt.slice(0, 10) }} 快照
                <template v-if="expertsFile?.totalRuns">
                  ｜ 高手 {{ expertCount }} 位 · 补录 {{ expertsFile.totalRuns }} 条（给某角色出过该房最低金记录的人，含非满分 / 未击杀）
                </template>
              </div>
              <div v-if="selectionNote" class="archive-note muted">{{ selectionNote }}</div>
              <div class="archive-empty muted" v-if="!filteredRuns.length">
                当前筛选无结果：该玩家 / 角色可能只出现在其它期数或 Boss；切「全部期数」或点「清空筛选」。
              </div>
            </div>

            <n-data-table
              :columns="columns"
              :data="filteredRuns"
              :pagination="{ pageSize: 20 }"
              :row-key="r => r.id"
              :scroll-x="816"
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
                <div class="kv">
                  <span class="k">分数</span><span class="v big">{{ selected.score }}</span>
                  <n-tag v-if="selectedIsFrontier" type="warning" size="tiny" :bordered="false">该房顶分</n-tag>
                </div>
                <div class="kv"><span class="k">用时</span><span class="v">{{ selected.timeSeconds }}s</span></div>
                <div class="kv">
                  <span class="k">结果</span>
                  <n-tag :type="selected.bossKilled ? 'success' : 'warning'" size="small" :bordered="false">
                    {{ selected.bossKilled ? '击杀' : '未击杀' }}
                  </n-tag>
                </div>
                <div class="kv"><span class="k">投稿</span><span class="v">{{ selected.authorName || '未署名' }}</span></div>
                <div class="kv">
                  <span class="k">期数</span>
                  <span class="v">{{ selected.seasonId }} · {{ file?.seasons[selected.seasonId]?.start?.slice(0, 10) ?? '—' }}</span>
                </div>
                <div class="kv"><span class="k">投稿时间</span><span class="v">{{ selected.submittedAt?.slice(0, 10) ?? '—' }}</span></div>
              </div>
              <div class="team-line">{{ teamLine(selected) }}</div>
              <a v-if="selected.videoUrl" :href="selected.videoUrl" target="_blank" rel="noreferrer" class="video-link">查看原视频 ↗</a>
              <div class="deploy-warnings" v-if="lastWarnings.length">
                <div v-for="w in lastWarnings" :key="w" class="warn">⚠ {{ w }}</div>
              </div>
              <div v-if="modelingGapHints.length" class="modeling-gaps">
                <div class="muted" style="margin-bottom: 4px">
                  建模缺口（理论值未含以下贡献，偏低属预期；共 {{ modelingGapHints.length }} 条）：
                </div>
                <template v-for="(g, i) in modelingGapHints" :key="i">
                  <div v-if="showAllGaps || i < GAPS_COLLAPSE_AT" class="gap muted">
                    <n-tag size="tiny" :bordered="false" :type="g.kind === 'system' ? 'warning' : 'info'">
                      {{ g.kind === 'cinema' ? '命座' : g.kind === 'mechanic' ? '机制' : '系统' }}
                    </n-tag>
                    <span>{{ g.agentName }} · {{ g.text }}</span>
                  </div>
                </template>
                <a
                  v-if="modelingGapHints.length > GAPS_COLLAPSE_AT"
                  class="gap-toggle"
                  href="javascript:void(0)"
                  @click="showAllGaps = !showAllGaps"
                >
                  {{ showAllGaps ? '收起' : `展开其余 ${modelingGapHints.length - GAPS_COLLAPSE_AT} 条` }}
                </a>
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
                <n-button size="tiny" :loading="buffPicking" @click="autoPickPeriodBuff">自动（最高伤）</n-button>
                <n-button size="tiny" :type="selectedBuffTitle === NONE_CARD ? 'primary' : 'default'" @click="pickPeriodBuff(null)">不用</n-button>
                <n-button
                  v-for="b in deployPhaseView.buffs"
                  :key="b.title"
                  size="tiny"
                  :type="selectedBuffTitle === b.title ? 'primary' : 'default'"
                  :title="b.effects.map(e => `${e.stat} +${e.value}`).join('；') || (b.unparsed ?? []).join('；')"
                  @click="pickPeriodBuff(b)"
                >
                  {{ phaseBuffCardLabel(b) }}
                </n-button>
              </div>
              <div v-else-if="deployPhaseView" class="period-buff-row muted">当期 Buff：该期没有可解析的牌</div>

              <!-- 配装最优（坑 53 B 档：显式按钮、缺省不跑；4/5/6 主词条单换扫描 + 双爆配平 + 副词条真实伤害精修） -->
              <div class="loadout-opt-row">
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <n-button size="tiny" :loading="loadoutOptimizing" @click="runLoadoutOptimize">配装最优</n-button>
                  </template>
                  <span>
                    对当前队伍：4/5/6 号位主词条逐项试换 + 双爆配平（4 号位暴击率↔爆伤、2 件套换双爆） + 副词条真实伤害精修（逐槽爬山 = 近似最优，不保证全局最优）。
                    实测 2 人队约 2s / 3 人队约 20s（约 100 次求值）；期间可切页取消。写入后该槽副词条转「手动」，换部署会重置。
                  </span>
                </n-tooltip>
                <span class="muted">默认配装 = 推荐主词条 + 模板副词条；这里才是按这支队算的近似最优</span>
                <span v-if="loadoutResult" class="loadout-opt-result">
                  {{ loadoutResult.changed }} 处主词条 · {{ loadoutResult.evals }} 次求值 / {{ loadoutResult.ms }}ms
                  · {{ loadoutResult.pct >= 0 ? '+' : '' }}{{ loadoutResult.pct.toFixed(2) }}%
                  （{{ compact(loadoutResult.before) }} → {{ compact(loadoutResult.after) }}）
                </span>
                <span v-if="loadoutNote" class="loadout-opt-result">{{ loadoutNote }}</span>
              </div>
            </div>
          </template>
        </n-card>

        <div class="hint muted">
          <b>收录口径</b>（用户裁决 2026-10-08）：只收危局强袭里<b>每个队伍限定金数最低的满分（65000）投稿</b>——每（房间 × 队伍构成）取金数最低那一批，
          同（房间 × 构成 × 金数 × 精确配置）去重。它们 = 该队在该 Boss「实际能打到的上界」，与计算器理论理想值直接对照最合适；重复投稿与低水平投稿（未打满）不收录。
          <br />
          <b>高手补录</b>（用户 2026-11-07：「高手定义为给任意角色出过最低金就行」）：在某个（房间 × 角色）上握着<b>该角色的最低限定金记录</b>的投稿人 = 高手，
          他的<b>其余全部危局投稿</b>（含非满分、未击杀）也收进来（标「补录」）——只看满分会把这些人的真实打法丢掉。
          <br />
          <b>筛选口径</b>（用户 2026-10-26）：「顶分战斗」= 该房（赛季 × 关卡）内限定金数 ≤「该房最低金 + 顶分窗口」的满分 run（lowGoldFrontier 单一实现）；
          「顶级玩家」= 至少有一条顶分战斗的投稿人——<b>窗口 +N 金就是「稍微宽松」的唯一旋钮</b>（不按分数百分比放宽：顶分只在满分组里选，按分数放等于全放行）。
          「高手」= 补录名单里的人（逐角色最低金记录，见上）；「只看高手」与「只看顶级玩家」可叠加。列表排序 = 分数降序、同分按金数升序。
          选中玩家 = 看他的<b>全部</b>投稿，再配「只看顶分战斗」即他的顶分场次；角色筛选按<b>队伍任一槽位</b>命中，与「只看顶分战斗」叠加 = 该角色的所有顶分战斗。
          <br />
          口径：配装 = 计算器默认理想（推荐驱动盘 + 推荐主词条 + 模板默认副词条 + 技能全满；模板副词条≠最优，要按本队算近似最优请点上方「配装最优」）；交互 = 轴模式自动推导（连携从轴读、弹刀按「失衡次数四舍五入 + 喧响四舍五入：缺口÷215」反推，闪反按职业基准（支援/防护 0，其余 10）/ 快支3 为固定基准）。
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
            :stun-discrete-label="archiveStunDiscrete?.label ?? null"
            :anomaly-pool-result="anomalyPoolResult"
            :total-time="resourceResult.totalTime"
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
import { NCard, NSelect, NDataTable, NTag, NButton, NSwitch, NDivider, NAlert, NTooltip, type DataTableColumn } from 'naive-ui'
import { useConfigStore } from '@/stores/config'
import { useUiStore } from '@/stores/ui'
import { useStunDiscreteDisplay } from '@/composables/stunDiscreteDisplay'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  submissionToDeploy,
  type ArchiveRun,
  type RunArchiveExpertsFile,
  type RunArchiveFile,
} from '@/composables/runArchiveImport'
import { applyDeployConfig, applyPeriodBuff, pickBestPeriodBuff } from '@/composables/runArchiveDeploy'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { useBatchOwner } from '@/composables/batchTask'
import { optimizeLoadout, writeLoadoutToStore } from '@/composables/loadoutOptimizer'
import { runLimitedGold } from '@/composables/limitedGold'
import { authorOf, queryArchiveRuns, type AgentFacet, type PlayerFacet } from '@/composables/runArchiveFilter'
import { selectedPeriodBuffCard, NONE_PERIOD_CARD, phaseBuffCardLabel } from '@/utils/phaseBuff'
import { scoreForDamageRatio } from '@/data/deadlyAssaultScore'
import ResourceResultCard from '@/components/ResourceResultCard.vue'
import { compact, localized } from '@/utils/format'
import { withBase } from '@/utils/staticUrl'
import type { BossPreset, PhaseView, PhaseBuffCard } from '@/types/bossPreset'
import {
  BANGBOO_GAP_HINT,
  collectCinemaGaps,
  collectMechanicGaps,
  type CinemaLedgerEntry,
  type MechanicLedgerEntry,
  type ModelingGapHint,
} from '@/utils/modelingGaps'


/** 列表行 = 归档 run + 「是否只出现在高手补录集」（补录集里的那一批不是「每队最低金满分」，要区别对待） */
type ScopeRun = ArchiveRun & { expertOnly: boolean }

const configStore = useConfigStore()

const catalogStore = useCatalogStore()
const { teamTotalDamage, resourceResult, stunPoolResult, anomalyPoolResult, agentNames, windowDuration, stunEffectiveTime } = useResourceCalc()

/**
 * 残疾失衡载荷（逻辑在 composables/stunDiscreteDisplay.ts；展示层不 import @/core）。
 *
 * ⚠ 必须传 **ref** 给模板、**不许**在 setup 顶层写 `.value`：
 * ① 旧写法 `useStunDiscreteDisplay(() => stunPoolResult.value)…value` 在 `stunPoolResult` 声明之前执行
 *    ⇒ TDZ「Cannot access 'stunPoolResult' before initialization」，切到这个页签 setup 直接中断、整页不渲染（2026-10-22 实测）；
 * ② 就算顺序对，`.value` 也把文案冻在首帧，部署新 run 后不再更新。
 */
const archiveStunDiscrete = useStunDiscreteDisplay({
  pool: () => stunPoolResult.value,
  windowDuration: () => windowDuration.value,
  effectiveTime: () => stunEffectiveTime.value,
})

const loading = ref(true)
const error = ref('')
const file = ref<RunArchiveFile | null>(null)
/**
 * 高手补录（单独文件 = `run-archive-experts.json`，与主集分开加载：探针 / 角色兑现 / 预设生成只读主集）。
 * 缺文件 = 空补录（旧部署），页面照样工作，只是没有「高手 / 补录」标与开关效果。
 */
const expertsFile = ref<RunArchiveExpertsFile | null>(null)
const presets = ref<BossPreset[]>([])
const phaseViews = ref<PhaseView[]>([])

const seasonId = ref('')
const bossKey = ref<string | null>(null)
/** 顶分窗口：0 = 只认该房最低金（最严），+N = 放宽 N 金（「稍微宽松」的唯一旋钮） */
const goldWindow = ref(0)
/** 只看顶分战斗（该房最低金 + 窗口内的满分 run） */
const frontierOnly = ref(false)
/** 只看顶级玩家（窗口内出过顶分的投稿人） */
const topPlayersOnly = ref(false)
/** 只看高手（握着某个角色最低金记录的人；名单由归档导入烘焙，页面只读） */
const expertsOnly = ref(false)
/** 玩家筛选（null = 全部；选中后列出他的**全部**投稿，顶分筛选另由 frontierOnly 控制） */
const playerName = ref<string | null>(null)
/** 角色筛选（null = 全部；按队伍任一槽位命中） */
const agentFilter = ref<string | null>(null)

/**
 * 部署态（选中的 run + 部署配置）**住 ui store，不是页面局部 ref**：
 * 页面由 CalculatorView 的 `<component :is="currentPage" />` 渲染，切页签 = 卸载重挂 ⇒ 局部 ref 一切页就没了，
 * 切回来只剩空态（用户 2026-10-29 实报「点了部署，切页再回来他就消失了」），而 config store 里部署写下的
 * 队伍 / Boss 房间 / layer-buff 行**都还在**。归属与理由见 stores/ui.ts#archiveDeploy。
 */
const uiStore = useUiStore()
const deployed = computed(() => uiStore.archiveDeploy)
const selected = computed(() => deployed.value?.run ?? null)
const lastDeploy = computed(() => deployed.value?.deploy ?? null)
/** 部署告警 = 部署配置自带的那一份（不再另存页面态，免得两边不同步） */
const lastWarnings = computed(() => lastDeploy.value?.warnings ?? [])

// ========== 建模缺口提示（信息展示，不做拦截——归档不作误差判据的用户裁决不变） ==========
const modelingLedgers = ref<{
  constellations: Record<string, CinemaLedgerEntry>
  mechanics: Record<string, MechanicLedgerEntry>
} | null>(null)
const modelingLedgersLoaded = ref(false)
/** 缺口清单折叠（账本 Open #3：pending 非空即列后可达 100+ 条，默认只展开前若干条） */
const GAPS_COLLAPSE_AT = 8
const showAllGaps = ref(false)

async function readLedger<T>(url: string): Promise<{ characters?: Record<string, T> }> {
  const r = await fetch(url)
  return r.ok ? await r.json() : {}
}

async function ensureModelingLedgers(): Promise<void> {
  if (modelingLedgersLoaded.value) return
  modelingLedgersLoaded.value = true
  try {
    const [cin, mec] = await Promise.all([
      readLedger<CinemaLedgerEntry>(withBase('/static/character-constellations.json')),
      readLedger<MechanicLedgerEntry>(withBase('/static/character-mechanics.json')),
    ])
    modelingLedgers.value = { constellations: cin.characters ?? {}, mechanics: mec.characters ?? {} }
  } catch {
    modelingLedgers.value = null
  }
}

const modelingGapHints = computed<ModelingGapHint[]>(() => {
  if (!lastDeploy.value) return []
  const agentIds = lastDeploy.value.team.map(t => t.agentId).filter(Boolean)
  if (!agentIds.length) return []
  return [
    BANGBOO_GAP_HINT,
    ...collectCinemaGaps(modelingLedgers.value?.constellations, agentIds),
    ...collectMechanicGaps(modelingLedgers.value?.mechanics, agentIds),
  ]
})

/**
 * 顶分窗口（数据集 = 每队最低金满分；窗口 = 再按**房间内**最低金放宽几金）：
 * 「顶分战斗」与「顶级玩家」都读它，只在「只看顶分 / 只看顶级玩家」开启时影响列表。
 */
const goldWindowOptions = [
  { label: '该房最低金', value: 0 },
  { label: '+1 金', value: 1 },
  { label: '+2 金', value: 2 },
  { label: '+3 金', value: 3 },
  { label: '+4 金', value: 4 },
]

onMounted(async () => {
  try {
    const [ra, bp, ex] = (await Promise.all([
      useCatalogStore().loadRunArchive(),
      useCatalogStore().loadBossPresets(),
      // 补录加载**内部吞错**（缺文件/坏响应都退化成空补录），不会让整页进 error 态
      useCatalogStore().loadRunArchiveExperts(),
    ]))
    file.value = ra
    expertsFile.value = ex
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
  // 赛季集合从候选行取（= 主集 + 补录；两者房间相同，补录将来若出现新房间也不会漏选项）
  const ids = [...new Set(candidateRuns.value.map((r) => r.seasonId))].sort(
    (a, b) => (f.seasons[b]?.start ?? '').localeCompare(f.seasons[a]?.start ?? ''),
  )
  // '' = 全部期数（看某个玩家的全部投稿 / 某角色跨期表现时用）
  return [{ value: '', label: '全部期数' }, ...ids.map((id) => ({ value: id, label: `${id} ${(f.seasons[id]?.start ?? '').slice(0, 10)}` }))]
})

const bossOptions = computed(() => {
  const f = file.value
  if (!f) return []
  const names = new Map<string, string>()
  for (const r of f.runs) {
    if (seasonId.value && r.seasonId !== seasonId.value) continue
    const room = f.rooms[r.targetId]
    if (room?.bossNameZh) names.set(room.bossNameZh, room.bossNameZh)
  }
  return [...names.keys()].map((n) => ({ value: n, label: n })).sort((a, b) => a.label.localeCompare(b.label))
})

/**
 * 候选行 = 主集（每队最低金满分）+ 高手补录（其余投稿）。两组口径不同但都要在页面上可见：
 * 行里带 `expertOnly` 标记（只在补录集里 = 非「每队最低金满分」那一批），列表给灰标区分。
 */
const candidateRuns = computed<ScopeRun[]>(() => {
  const f = file.value
  if (!f) return []
  const main: ScopeRun[] = f.runs.map((r) => ({ ...r, expertOnly: false }))
  const extra: ScopeRun[] = (expertsFile.value?.runs ?? []).map((r) => ({ ...r, expertOnly: true }))
  return [...main, ...extra]
})

/** 候选范围 = 期数 × Boss（玩家 / 角色筛选**不能**在这一层收窄，否则顶分判定会退化成本地最低金） */
const scopeRuns = computed(() => {
  const f = file.value
  if (!f) return []
  return candidateRuns.value
    .filter((r) => (seasonId.value ? r.seasonId === seasonId.value : true))
    .filter((r) => (bossKey.value ? f.rooms[r.targetId]?.bossNameZh === bossKey.value : true))
})

/**
 * 高手名单（数据集烘焙 = `run-archive-experts.json#authors`，判据在导入期算过，见
 * `runArchiveFilter.ts#lowGoldExpertAuthors`）。页面只读——判据要看未入库的低金投稿，这里看不全。
 */
const expertAuthors = computed<ReadonlySet<string>>(() => new Set(expertsFile.value?.authors ?? []))

/**
 * 筛选 + 分面（单一实现 = `composables/runArchiveFilter.ts`）：
 * 顶分集合在玩家 / 角色筛选**之前**于候选范围上算，顶分窗口只决定「多宽松」，不改变候选范围。
 *
 * ⚠ 候选范围含高手补录，所以**顶分集合比只看主集时更大**（实测窗口 0：101 → 170 条，多出来的都是补录里的
 * 65000 满分 run；窗口 +4：640 → 1302）。这不是缺陷：顶分的定义（`limitedGold.lowGoldFrontier`）本来就是
 * 「**该房**（赛季 × 关卡）最高分里、限定金 ≤ 该房最低金 + 窗口的那批」，主集是**按队伍构成**筛过的子集，
 * 只是它的一个下界。现在候选范围里有了全量高手投稿，就把定义按原样用全，别改回「只认主集」（那会把
 * 「这个房里谁用最少金打满过」的真实答案裁掉一半）。
 */
const archiveQuery = computed(() =>
  queryArchiveRuns(scopeRuns.value, {
    goldWindow: goldWindow.value,
    expertAuthors: expertAuthors.value,
    player: playerName.value,
    agentId: agentFilter.value,
    topPlayersOnly: topPlayersOnly.value,
    expertsOnly: expertsOnly.value,
    frontierOnly: frontierOnly.value,
  }),
)

/** 本范围（期数 × Boss）里的高手人数：名单是全库的，摘要要按当前范围收窄，否则切期数不变 */
const expertCount = computed(() => archiveQuery.value.players.filter((p) => p.expert).length)

/**
 * 排序 = **分数降序，同分按金数升序**（2026-11-07 改）：主集全 65000 时等价于旧的「金数升序」，
 * 但混进高手补录（低分 / 未击杀）后，按金数优先会把 0 金的两万分行顶到最前——那是补录噪声，不是上限数据点。
 */
const filteredRuns = computed(() =>
  archiveQuery.value.rows
    .slice()
    .sort((a, b) => b.score - a.score || runLimitedGold(a.team) - runLimitedGold(b.team)),
)

/** 顶分窗口只在「只看顶分 / 只看顶级玩家」开启时参与行筛选，否则下拉是无意义的旋钮 */
const scoreWindowActive = computed(() => frontierOnly.value || topPlayersOnly.value)

/** 全库覆盖（快照信息，不随筛选变化；走同一套分面，避免页面另写一份去重口径） */
const coverage = computed(() => {
  const q = queryArchiveRuns(candidateRuns.value, { goldWindow: goldWindow.value, expertAuthors: expertAuthors.value })
  return { rooms: q.roomCount, players: q.players.length, agents: q.agents.length }
})

/** 玩家下拉文案（工数 / 顶分数 / 高手标让「谁是高手」一眼可见，不用逐个点开） */
function playerLabel(p: PlayerFacet): string {
  return `${p.name} · ${p.runs} 场${p.frontierRuns ? ` · 顶 ${p.frontierRuns}` : ''}${p.expert ? ' · 高手' : ''}`
}

function agentLabel(a: AgentFacet): string {
  return `${agentName(a.agentId)} · ${a.runs} 场${a.frontierRuns ? ` · 顶 ${a.frontierRuns}` : ''}`
}

const playerOptions = computed(() => {
  const list = topPlayersOnly.value
    ? archiveQuery.value.players.filter((p) => p.frontierRuns > 0)
    : archiveQuery.value.players
  return list.map((p) => ({ value: p.name, label: playerLabel(p) }))
})

const agentOptions = computed(() => archiveQuery.value.agents.map((a) => ({ value: a.agentId, label: agentLabel(a) })))

/** 选中玩家 / 角色后的摘要：本范围几场、其中顶分几场、最低几金（另标出范围外的投稿数） */
const selectionNote = computed(() => {
  const parts: string[] = []
  if (playerName.value) {
    const p = archiveQuery.value.players.find((x) => x.name === playerName.value)
    const total = candidateRuns.value.filter((r) => authorOf(r) === playerName.value).length
    if (p) {
      const extra = total - p.runs
      parts.push(
        `玩家 ${p.name}${p.expert ? '（高手）' : ''}：本范围 ${p.runs} 场 · 顶分 ${p.frontierRuns} 场 · 最低 ${p.minGold} 金` +
          (extra > 0 ? `（另有 ${extra} 场在其它期数 / Boss，期数切「全部期数」可看）` : ''),
      )
    } else {
      parts.push(`玩家「${playerName.value}」：本范围无投稿` + (total ? `（共 ${total} 场在其它期数 / Boss）` : ''))
    }
  }
  if (agentFilter.value) {
    const a = archiveQuery.value.agents.find((x) => x.agentId === agentFilter.value)
    parts.push(
      a
        ? `${agentName(a.agentId)}：本范围 ${a.runs} 场 · 顶分 ${a.frontierRuns} 场 · 最低 ${a.minGold} 金`
        : `${agentName(agentFilter.value)}：本范围无投稿`,
    )
  }
  return parts.join('　｜　')
})

/** 当前部署的 run 是否本范围顶层（右侧「该房顶分」标；换筛选后可能不再在范围内，属预期） */
const selectedIsFrontier = computed(() =>
  selected.value ? archiveQuery.value.frontierIds.has(selected.value.id) : false,
)

function resetFilters() {
  playerName.value = null
  agentFilter.value = null
  topPlayersOnly.value = false
  expertsOnly.value = false
  frontierOnly.value = false
  goldWindow.value = 0
}

function agentName(id: string): string {
  const a = catalogStore.getAgent(id)
  return localized(a?.name, id)
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
  void ensureModelingLedgers()
  const room = f.rooms[run.targetId]
  const deploy = submissionToDeploy(run, room, presets.value, room?.seasonStart)
  // 换部署 = 换配装：上一次「配装最优」的结果作废（进行中的也停掉，别把旧队的分配写到新队上）
  loadoutOwner.cancel()
  loadoutResult.value = null
  loadoutNote.value = ''
  applyDeployConfig(configStore, deploy, presets.value)
  // 先记部署（下面 deployPhaseView / selectedPeriodCard 都读它），再判过期牌
  uiStore.setArchiveDeploy(run, deploy)
  // 换部署 = 换房间：表里那批当期牌行若**不是本次相位上的某张牌**（上一期选的 / 别处按旧口径写的）一律清掉
  // （口径：过期选择不跨 Boss 生效）。判定与展示同源 = selectedPeriodCard（由全局 Buff 表派生，不看页面态）。
  if (selectedPeriodCard.value === null) pickPeriodBuff(null)
}

// ========== 当期 Buff 快捷选择 ==========
/**
 * 部署 Boss 的期相位 → 当期 buff 牌视图（数据源 = 期视图；部署态本身见 stores/ui.ts#archiveDeploy）。
 */
const deployPhaseView = computed(() =>
  lastDeploy.value?.boss ? phaseViews.value.find(v => v.phaseId === lastDeploy.value!.boss!.phaseId) ?? null : null,
)
/** 「不用」的哨兵（单一来源 = utils/phaseBuff#NONE_PERIOD_CARD；属性配置页同一常量） */
const NONE_CARD = NONE_PERIOD_CARD
/**
 * 当前选中的牌**由全局 Buff 表派生**（单一事实源 = utils/phaseBuff#selectedPeriodBuffCard，与属性配置页同一函数）：
 * 修前它是页面局部 ref（初值 'none'）⇒ ① 切页签重挂后明明表里有行、按钮却全不高亮；② 属性配置页选了牌再回本页，
 * 两页各说各话。派生之后「谁选中」只有一个答案：表里的行。
 */
const selectedPeriodCard = computed(() => {
  const view = deployPhaseView.value
  return view ? selectedPeriodBuffCard(configStore.globalBuffs, view.phaseId, view.buffs) : null
})
/** 按钮态用的标题：NONE_CARD = 不用；牌名 = 选中的那张 */
const selectedBuffTitle = computed(() => selectedPeriodCard.value?.title ?? NONE_CARD)
/** 击杀时间（秒）：伤害/血量 > 100% 时 = 战斗时长 × 100/hpRatio（2 倍伤害 → 90s 击杀，按 180s 基准） */
const killTimeText = computed(() => {
  const ratio = hpRatio.value
  if (ratio <= 100) return ''
  const battle = configStore.enemy.battleTime
  return Math.round(battle * 100 / ratio)
})
/** 唯一的选牌写入口 = applyPeriodBuff（本页不存选中态，写完由 selectedPeriodCard 从表里读回来） */
function pickPeriodBuff(card: PhaseBuffCard | null) {
  applyPeriodBuff(configStore, deployPhaseView.value?.phaseId ?? '', card)
}

/** 自动选择：评估「不用」+ 每张可用牌的总伤害，应用最高者（CC-352：在独立场景里试，UI store 只写最终结果一次） */
const buffPicking = ref(false)
async function autoPickPeriodBuff() {
  const view = deployPhaseView.value
  if (!view || buffPicking.value) return
  buffPicking.value = true
  try {
    const best = await withAnalysisScenario(s => pickBestPeriodBuff(s, view.phaseId, view.buffs))
    pickPeriodBuff(best)
  } finally {
    buffPicking.value = false
  }
}

/**
 * 「配装最优」（ENGINE_PIPELINE_GUIDE §4 坑 53 的 **B 档**）：显式一次性把当前队伍的 4/5/6 主词条 +
 * 2 件套（双爆配平）+ 副词条对齐到近似最优（composables/loadoutOptimizer.ts）。缺省不跑——实战对比的
 * 默认配装仍是「推荐主词条 + 模板副词条」。
 * 在独立场景上算（withAnalysisScenario），只把最终结果写回 UI store 一次（CC-343 口径：不在 UI store 上试算）。
 */
const loadoutOwner = useBatchOwner()
const loadoutOptimizing = ref(false)
/** 取消 / 失败等一次性提示（**不用 useMessage**：本页要被 SSR setup 判据 renderToString，不能依赖 n-message-provider） */
const loadoutNote = ref('')
const loadoutResult = ref<{ before: number; after: number; pct: number; evals: number; ms: number; changed: number } | null>(null)
async function runLoadoutOptimize() {
  if (loadoutOptimizing.value) return
  const task = loadoutOwner.start()
  loadoutOptimizing.value = true
  loadoutNote.value = ''
  const started = performance.now()
  try {
    const res = await withAnalysisScenario(s => optimizeLoadout(s, catalogStore, { control: { signal: task.signal } }))
    if (!res.complete) {
      task.commit(() => { loadoutNote.value = '已取消，未写入' })
      return
    }
    const changed = res.slots.reduce((n, r) => n + r.mainChanges.length, 0)
    const pct = res.before > 0 ? (res.after / res.before - 1) * 100 : 0
    const ms = Math.round(performance.now() - started)
    task.commit(() => {
      writeLoadoutToStore(configStore, res)
      loadoutResult.value = { before: res.before, after: res.after, pct, evals: res.evals, ms, changed }
    })
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e)
    task.commit(() => { loadoutNote.value = `失败：${text}` })
  } finally {
    task.commit(() => { loadoutOptimizing.value = false })
  }
}

const columns = computed<DataTableColumn<ScopeRun>[]>(() => {
  // 「顶」标与「只看顶分」同源：同一份 frontierIds（窗口 = 顶分窗口），不另算一份前沿。
  const frontierIds = archiveQuery.value.frontierIds
  const experts = expertAuthors.value
  const cols: DataTableColumn<ScopeRun>[] = []
  // 期数列只在看「全部期数」时出现（单选某期时整列恒等，纯占宽）
  if (!seasonId.value) {
    cols.push({ title: '期数', key: 'season', width: 72, ellipsis: { tooltip: true }, render: (r) => r.seasonId })
  }
  cols.push(
    {
      title: 'Boss',
      key: 'boss',
      width: 132,
      render: (r) => file.value?.rooms[r.targetId]?.bossNameZh ?? r.targetId,
    },
    {
      title: '队伍',
      key: 'team',
      minWidth: 204,
      render: (r) => r.team.map((m) => `${agentName(m.agentId)}M${m.mindscape}`).join(' / '),
    },
    {
      title: '金',
      key: 'gold',
      width: 70,
      render: (r) =>
        h('span', [
          String(runLimitedGold(r.team)),
          frontierIds.has(r.id)
            ? h(NTag, { type: 'warning', size: 'tiny', bordered: false, style: 'margin-left:3px' }, { default: () => '顶' })
            : null,
        ]),
    },
    {
      // 分数与击杀合并一格（主集恒 65000；高手补录行会有更低分 / 未击杀，所以这一列现在真的在读数）
      title: '分数',
      key: 'score',
      width: 104,
      render: (r) =>
        h('span', [
          String(r.score),
          h(
            NTag,
            { type: r.bossKilled ? 'success' : 'warning', size: 'tiny', bordered: false, style: 'margin-left:3px' },
            { default: () => (r.bossKilled ? '击杀' : '未击杀') },
          ),
        ]),
    },
    { title: '用时', key: 'time', width: 58, ellipsis: { tooltip: true }, render: (r) => `${r.timeSeconds}s` },
    {
      // 投稿人 + 投稿日叠两行：省一列宽（横向滚动会把「部署」挤出视口）。
      // 「高手」标 = 该投稿人在数据集的高手名单里（在某房握过某角色的最低金记录，全库口径，不是这一条）；
      // 「补录」标 = 这条来自高手补录集（非「每队最低金满分」那一批）。
      title: '投稿',
      key: 'author',
      width: 132,
      render: (r) =>
        h('div', [
          h('div', { style: 'display:flex;align-items:center;gap:3px' }, [
            h('span', (r.authorName ?? '') || '未署名'),
            experts.has(authorOf(r))
              ? h(NTag, { type: 'info', size: 'tiny', bordered: false }, { default: () => '高手' })
              : null,
            r.expertOnly ? h(NTag, { size: 'tiny', bordered: false }, { default: () => '补录' }) : null,
          ]),
          h('small', r.submittedAt?.slice(0, 10) ?? ''),
        ]),
    },
    {
      title: '',
      key: 'deploy',
      width: 60,
      render: (r) =>
        h(NButton, { size: 'tiny', type: 'primary', secondary: true, onClick: () => onDeploy(r) }, { default: () => '部署' }),
    },
  )
  return cols
})

const totalDamage = computed(() => teamTotalDamage.value ?? 0)
const enemyHp = computed(() => configStore.enemy.hp)
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
  grid-template-columns: minmax(0, 1.75fr) minmax(340px, 1fr);
  gap: 14px;
  align-items: start;
}
.filter-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}
.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.filter-row .switch-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.archive-summary {
  line-height: 1.7;
}
.archive-note {
  line-height: 1.7;
  padding-left: 8px;
}
.archive-empty {
  line-height: 1.7;
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
.loadout-opt-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--line-strong);
}
.loadout-opt-result {
  font-size: 12px;
  color: var(--fg-2);
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
.green { color: var(--c-success); }
.amber { color: #e6b464; }
.red { color: #e88080; }
.team-line { margin: 8px 0 4px; font-size: 13px; color: var(--wa-750); }
.video-link { font-size: 12px; color: #63b3ed; text-decoration: none; }
.deploy-warnings { margin-top: 8px; }
.warn { font-size: 11px; color: #e6b464; line-height: 1.6; }
.modeling-gaps { margin-top: 8px; font-size: 12px; line-height: 1.7; }
.modeling-gaps .gap { display: flex; align-items: center; gap: 6px; }
.modeling-gaps .gap-toggle { display: inline-block; margin-top: 4px; font-size: 12px; color: var(--link-color); text-decoration: none; }
.verdict { margin-top: 10px; font-size: 13px; color: var(--wa-750); }
.hint { margin-top: 10px; line-height: 1.7; }
.pool-hint { margin-top: 12px; line-height: 1.7; }
</style>