<template>
  <n-card size="small" :bordered="true">
    <template #header>
      <div class="ssc-title">
        <span>副词条评分（相对 0 副词条）</span>
        <div class="ssc-controls">
          <n-select
            v-model:value="slot"
            :options="slotOptions"
            size="small"
            style="width:160px"
            placeholder="角色"
          />
          <n-button size="small" type="primary" :loading="computing" @click="run">
            {{ result ? '重算' : '计算评分' }}
          </n-button>
        </div>
      </div>
    </template>

    <div class="ssc-caption">
      基线 = <b>该角色 0 副词条</b>（队友的词条一个都不动）。
      逐条贡献用 <b>Shapley 分摊</b>：它的和严格等于评分，可以直接相加看账。
      主口径是<b>全队伤害</b>；另一个数是<b>当前配置下的个人伤害</b>——它是「在这支队里、按这套配装的出招次数」
      算出来的，<b>换队友会变</b>（队友决定你的招式能打几次），所以只作参考，不要当成「这个角色自己变强了多少」。
      有转模的角色（如诺姆的暴击率→暴伤/定向失衡），「转模」列会标出这条词条**顺带转出**了多少——
      那部分收益**已经算在评分里**，这一列只是解释「为什么暴击率词条比爆伤词条值钱」。
      跑在独立场景里，不动你的配装；一个角色只有 2~4 个词条 ⇒ 几毫秒级。
      主评分<b>锁定失衡次数</b>（与「命座提升率」同口径）——词条碰巧把失衡从 3 次推到 4 次时，
      多出来的是「多一次失衡」的整窗易伤，不计入词条本身的价值，而是单列在下面的「击破」区。
    </div>

    <div v-if="errorMsg" class="ssc-error">{{ errorMsg }}</div>

    <template v-if="result && !result.reason">
      <div class="ssc-summary">
        <div class="ssc-score">
          <span class="ssc-score-value">+{{ fmt(result.gainPct, 2) }}%</span>
          <span class="ssc-score-label">全队伤害</span>
        </div>
        <div class="ssc-score ssc-score-secondary">
          <span class="ssc-score-value-sm">+{{ fmt(result.ownGainPct, 2) }}%</span>
          <span class="ssc-score-label">当前配置下的个人伤害</span>
        </div>
        <div class="ssc-facts">
          <div>全队 {{ compact(result.zeroTeam) }} → <b>{{ compact(result.currentTeam) }}</b></div>
          <div>个人 {{ compact(result.zeroOwn) }} → <b>{{ compact(result.currentOwn) }}</b></div>
          <div>求值 {{ result.evals }} 次 · {{ result.contributions.length }} 条词条</div>
        </div>
      </div>

      <div v-if="result.conversions.length > 0" class="ssc-conv-note">
        该角色有 {{ result.conversions.length }} 条属性转化（{{ result.conversions.map(c => discStatLabel(c.sourceStat) + '→' + discStatLabel(c.targetStat)).join('、') }}），
        已计入评分；下表「转模」列说明每条词条各自转出了多少。
      </div>
      <!-- 击破侧：额外增幅单列（用户口径 2026-10-23「除了说总伤提升外，还可以说失衡总量增加了多少」） -->
      <div v-if="hasStunOutput" class="ssc-stun">
        <div class="ssc-stun-title">击破（失衡）侧的额外增幅 —— 不计入上面的评分</div>
        <div class="ssc-stun-rows">
          <div class="ssc-stun-row">
            <span class="ssc-stun-label">失衡次数</span>
            <span>{{ stunBase.freeStun }} → <b>{{ stunBase.freeStun + result.stunOutput.stunCountDelta }}</b> 次</span>
            <span class="ssc-stun-delta" :style="{ color: result.stunOutput.stunCountDelta > 0 ? 'var(--app-accent-gold)' : 'var(--fg-3)' }">
              {{ result.stunOutput.stunCountDelta > 0 ? '+' : '' }}{{ result.stunOutput.stunCountDelta }}
            </span>
          </div>
          <div class="ssc-stun-row">
            <span class="ssc-stun-label">失衡总量</span>
            <span>{{ compact(stunBase.zeroBuildUp) }} → <b>{{ compact(result.stunOutput.currentTotalStunBuildUp) }}</b></span>
            <span class="ssc-stun-delta">+{{ fmt(result.stunOutput.totalStunBuildUpPct, 2) }}%</span>
          </div>
          <div class="ssc-stun-row">
            <span class="ssc-stun-label">易伤覆盖</span>
            <span>{{ fmt(stunBase.zeroCoverage * 100, 1) }}% → <b>{{ fmt((stunBase.zeroCoverage + result.stunOutput.coverageDeltaPct / 100) * 100, 1) }}%</b></span>
            <span class="ssc-stun-delta">{{ result.stunOutput.coverageDeltaPct >= 0 ? '+' : '' }}{{ fmt(result.stunOutput.coverageDeltaPct, 1) }}pp</span>
          </div>
          <div class="ssc-stun-row ssc-stun-highlight">
            <span class="ssc-stun-label">折算伤害</span>
            <span>这部分的贡献</span>
            <span class="ssc-stun-delta">全队 +{{ fmt(result.stunOutput.jumpGainPct, 2) }}% · 个人 +{{ fmt(result.stunOutput.jumpOwnGainPct, 2) }}%</span>
          </div>
        </div>
        <div class="ssc-stun-note">
          若不锁失衡次数，这套词条的全队增益会是 +{{ fmt(result.stunOutput.freeformGainPct, 2) }}%
          （个人 +{{ fmt(result.stunOutput.freeformOwnGainPct, 2) }}%）——差额就是上面这一行。
          它是「词条恰好越过击破阈值」的离散产物，不是词条的固有价值，所以不并入评分。
        </div>
      </div>

      <div v-if="result.axisChanged" class="ssc-axis-note">
        轴态跳变：失衡 {{ result.zeroAxis.stunCount }} → {{ result.currentAxis.stunCount }} 次、
        易伤覆盖 {{ fmt(result.zeroAxis.coverage * 100, 1) }}% → {{ fmt(result.currentAxis.coverage * 100, 1) }}%。
        那部分不是词条本身的价值，而是「多了这一次失衡」的整窗易伤差。
      </div>

      <ChartTable :columns="columns" align="right" dense max-height="300px" empty="没有可显示的贡献">
        <tr v-for="row in rows" :key="row.key">
          <td><span class="ssc-dot" :style="{ background: row.color }"></span>{{ row.label }}</td>
          <td>{{ row.steps }}</td>
          <td :style="{ color: row.pct >= 0 ? 'var(--fg-3)' : 'var(--c-warning-strong)' }">
            {{ row.pct >= 0 ? '+' : '' }}{{ fmt(row.pct, 2) }}%
          </td>
          <td>{{ fmt(row.ownPct, 2) }}%</td>
          <td :title="row.convText">{{ row.convText }}</td>
          <td>{{ fmt(row.sharePct, 1) }}%</td>
        </tr>
      </ChartTable>
      <div class="ssc-foot">
        合计 全队 {{ fmt(totalPct, 2) }}% / 个人 {{ fmt(totalOwnPct, 2) }}%（两者都与上面的评分逐位相等）
      </div>
    </template>
    <div v-else-if="result && result.reason" class="ssc-empty">{{ result.reason }}</div>

    <!-- ===== 快速改词条（不翻页） ===== -->
    <n-divider style="margin: 12px 0" />
    <div class="ssc-subhead">
      <span>快速改词条 · {{ selectedLabel }}</span>
      <n-button size="tiny" quaternary @click="showQuickEdit = !showQuickEdit">
        {{ showQuickEdit ? '收起' : '展开' }}
      </n-button>
    </div>
    <div v-if="showQuickEdit" class="ssc-quick">
      <div class="ssc-quick-grid">
        <div v-for="stat in subStatPool" :key="stat" class="ssc-quick-row">
          <span class="ssc-quick-name">{{ discStatLabel(stat) }}</span>
          <n-input-number
            :value="subStatCount(stat)"
            :min="0"
            :max="54"
            size="small"
            style="width: 104px"
            @update:value="v => setSubStat(stat, v ?? 0)"
          />
        </div>
      </div>
      <div class="ssc-quick-engine">
        <span class="ssc-quick-name">音擎</span>
        <n-select
          :value="currentWEngineId || null"
          :options="wEngineOptions"
          size="small"
          filterable
          clearable
          placeholder="不戴音擎"
          style="width: 260px"
          @update:value="v => setWEngine(v ?? '')"
        />
        <span class="ssc-quick-name">精炼</span>
        <n-input-number
          :value="currentWEngineModLevel"
          :min="1"
          :max="5"
          size="small"
          style="width: 104px"
          @update:value="v => setWEngineMod(v ?? 1)"
        />
      </div>
      <div class="ssc-quick-foot">
        改动直接写进当前的 {{ selectedLabel }}（和队伍配置页是同一份数据，无需跳页）。
      音擎 / 精炼也在这里改——A/B 快照记的是**整套配装**（盘子 + 音擎），所以能直接比「换武器」「换精炼」。
        改完点上面的「重算」即可；「存 A / 存 B」记的就是此刻这套。
      </div>
    </div>

    <!-- ===== 两套盘子 A/B 对比 ===== -->
    <n-divider style="margin: 12px 0" />
    <div class="ssc-subhead">
      <span>两套盘子对比 · {{ selectedLabel }}</span>
      <div class="ssc-controls">
        <n-button size="tiny" secondary @click="snap('a')">存 A</n-button>
        <n-button size="tiny" secondary @click="snap('b')">存 B</n-button>
        <n-button size="tiny" secondary :disabled="!planA" @click="applyPlan('a')">用 A</n-button>
        <n-button size="tiny" secondary :disabled="!planB" @click="applyPlan('b')">用 B</n-button>
        <n-button size="tiny" type="primary" :loading="comparing" :disabled="!planA || !planB" @click="runCompare">
          对比 A / B
        </n-button>
      </div>
    </div>
    <div class="ssc-caption">
      A / B 各是一份**完整**驱动盘（4件套 + 2件套 + 4/5/6 主词条 + 副词条），分别装到
      <b>{{ selectedLabel }}</b> 上求值，其它角色一字不动 ⇒ 差异只来自这一槽。
      存 A = 记住此刻这套；改完再点「存 B」⇒「对比」。记录**按角色分别保存**，切页/刷新都不丢。
    </div>
    <div class="ssc-snaps">
      <span>A：{{ planA ? planSummary(planA) : '（未存）' }}</span>
      <span>B：{{ planB ? planSummary(planB) : '（未存）' }}</span>
    </div>
    <div v-if="compareResult && !compareResult.reason" class="ssc-compare">
      <div class="ssc-compare-row">
        <span class="ssc-compare-label">全队伤害</span>
        <span>{{ compact(compareResult.aTeam) }} → {{ compact(compareResult.bTeam) }}</span>
        <span class="ssc-compare-delta" :style="{ color: compareResult.deltaTeamPct >= 0 ? 'var(--app-accent-gold)' : 'var(--c-warning-strong)' }">
          {{ compareResult.deltaTeamPct >= 0 ? '+' : '' }}{{ fmt(compareResult.deltaTeamPct, 2) }}%
        </span>
      </div>
      <div class="ssc-compare-row">
        <span class="ssc-compare-label">个人伤害</span>
        <span>{{ compact(compareResult.aOwn) }} → {{ compact(compareResult.bOwn) }}</span>
        <span class="ssc-compare-delta" :style="{ color: compareResult.deltaOwnPct >= 0 ? 'var(--app-accent-gold)' : 'var(--c-warning-strong)' }">
          {{ compareResult.deltaOwnPct >= 0 ? '+' : '' }}{{ fmt(compareResult.deltaOwnPct, 2) }}%
        </span>
      </div>
      <div v-if="compareResult.stunCountDelta !== 0 || compareResult.freeformDeltaTeamPct !== compareResult.deltaTeamPct" class="ssc-caption">
        口径：两套配装装在<b>同一失衡次数</b>上比（A 的收敛次数 {{ compareResult.stunLock }} 次）
        <template v-if="compareResult.stunCountDelta !== 0">
          ；B 自由收敛会多打 <b>{{ compareResult.stunCountDelta }}</b> 次失衡
          ⇒ 自由口径是 全队 {{ fmt(compareResult.freeformDeltaTeamPct, 2) }}% / 个人 {{ fmt(compareResult.freeformDeltaOwnPct, 2) }}%，
          那部分差额是「多打一次失衡」的离散跳变，不属于这套配装本身
        </template>
      </div>
      <div class="ssc-compare-row">
        <span class="ssc-compare-label">副词条步数</span>
        <span>{{ compareResult.stepsA }} → {{ compareResult.stepsB }}</span>
      </div>

      <ChartTable :columns="diffColumns" align="left" dense max-height="240px" empty="两套配装完全一致">
        <tr v-for="d in compareResult.diff" :key="d.kind + d.label">
          <td>{{ d.kind }}</td>
          <td>{{ d.label }}</td>
          <td>{{ d.a }}</td>
          <td>{{ d.b }}</td>
        </tr>
      </ChartTable>

      <!-- ===== 分数换算（用户 2026-10-27：A 打了 x 分，换成 B 的伤害会打多少） ===== -->
      <div class="ssc-conv">
        <div class="ssc-conv-title">
          换成另一套配装会打多少分
          <span class="ssc-conv-hint">同一场景、同一套操作 ⇒ 伤害/血量随伤害同比缩放</span>
        </div>
        <div class="ssc-conv-row">
          <span class="ssc-conv-label">曲线</span>
          <n-radio-group v-model:value="scoreMode" size="small">
            <n-radio-button v-for="opt in SCORE_MODE_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</n-radio-button>
          </n-radio-group>
          <span class="ssc-conv-mode-hint">{{ SCORE_MODE_HINT[scoreMode] }}</span>
        </div>
        <div class="ssc-conv-row">
          <span class="ssc-conv-label">伤害口径</span>
          <n-select v-model:value="scoreReadout" :options="readoutOptions" size="small" style="width: 140px" />
          <span class="ssc-conv-label">已知</span>
          <n-select v-model:value="scoreKnownSide" :options="scoreSideOptions" size="small" style="width: 190px" />
          <span class="ssc-conv-label">{{ operationCap > 0 ? '总分' : '分数' }}</span>
          <n-input-number
            v-model:value="scoreInput"
            :min="0"
            :max="scoreTotalCap"
            :step="500"
            size="small"
            style="width: 130px"
            :placeholder="operationCap > 0 ? '例如 65000' : '例如 30000'"
          />
          <template v-if="operationCap > 0">
            <span class="ssc-conv-label">其中操作分</span>
            <n-input-number
              v-model:value="operationScore"
              :min="0"
              :max="operationCap"
              :step="500"
              size="small"
              style="width: 110px"
            />
          </template>
        </div>
        <div class="ssc-conv-split">
          <!-- 木桩没有操作分（用户 2026-10-28）：不摆一个恒 0 的输入框，直说「总分 = 伤害分」 -->
          <template v-if="operationCap === 0">
            木桩没有操作分 ⇒ 填的分数就是伤害分，直接按伤害比换算。
          </template>
          <template v-else-if="scoreInput != null && Number.isFinite(scoreInput)">
            总分 {{ fmt(scoreInput, 0) }} − 操作分 {{ fmt(operationScore, 0) }}
            = <b>伤害分 {{ fmt(knownDamageScore, 0) }}</b>
            <span v-if="totalBelowOperation" class="ssc-conv-warn-inline">（总分低于操作分，已按 0 伤害分算）</span>
          </template>
          <template v-else>
            填<b>总分</b>就行：默认操作分 {{ fmt(operationScore, 0) }}（可改），系统自动扣掉它得到伤害分，再按伤害比换算。
          </template>
        </div>
        <template v-if="scoreConversion">
          <div class="ssc-conv-result">
            <div class="ssc-score">
              <span class="ssc-score-value">{{ fmt(scoreConversion.scoreTo, 0) }}</span>
              <span class="ssc-score-label">{{ scoreConversion.toLabel }} 配置（{{ SCORE_MODE_LABEL[scoreMode] }}）</span>
            </div>
            <div class="ssc-score ssc-score-secondary">
              <span
                class="ssc-score-value-sm"
                :style="{ color: scoreConversion.delta >= 0 ? 'var(--app-accent-gold)' : 'var(--c-warning-strong)' }"
              >{{ scoreConversion.delta >= 0 ? '+' : '' }}{{ fmt(scoreConversion.delta, 0) }}</span>
              <span class="ssc-score-label">相对 {{ scoreConversion.fromLabel }}</span>
            </div>
            <div class="ssc-facts">
              <div>{{ scoreConversion.fromLabel }} {{ fmt(scoreConversion.scoreFrom, 0) }} 分 ≈ 伤害/血量 {{ fmt(scoreConversion.ratioFrom * 100, 2) }}%</div>
              <div>伤害 ×{{ fmt(scoreConversion.damageRatio, 4) }} ⇒ {{ fmt(scoreConversion.ratioTo * 100, 2) }}%</div>
              <div v-if="scoreConversion.operationCap > 0">伤害分 {{ fmt(scoreConversion.damageScoreTo, 0) }} + 操作分 {{ fmt(scoreConversion.operationScore, 0) }} = 总分 {{ fmt(scoreConversion.scoreTo, 0) }}</div>
              <div v-else>伤害分 {{ fmt(scoreConversion.damageScoreTo, 0) }}（木桩无操作分）= 分数 {{ fmt(scoreConversion.scoreTo, 0) }}</div>
            </div>
          </div>
          <div v-if="scoreConversion.clamped" class="ssc-conv-warn">
            ⚠ 结果被曲线端点钳住（{{ scoreConversion.ratioTo >= 1 ? '已击杀，伤害分封顶 60000' : '伤害占比 0' }}），实际比例不再线性可信。
          </div>
          <!-- 曲线性质不同，换算路径的解释也必须不同：木桩是正比，别再对它说「分段线性」 -->
          <div v-else-if="scoreMode === 'training_dummy'" class="ssc-conv-note">
            木桩曲线<b>正比</b>（每 1% 血量 = 600 分）⇒ 这里的换算与「分数 × 伤害比」等价；
            危局（普通 / 绝境）是分段线性，必须走反解 → 缩放 → 正算。
          </div>
          <div v-else class="ssc-conv-note">
            分数曲线<b>分段线性</b>（同样 +1% 血在不同段换的分不同）⇒ 先由已知分数反解血量、再乘伤害之比、正算回分数，
            <b>不是</b>拿分数直接乘百分比。
          </div>
        </template>
        <div v-else class="ssc-conv-note">
          先点上方「对比 A / B」拿到两个配置的伤害，再在这里填分数。
          <span class="ssc-conv-dim">分数口径 = {{ SCORE_MODE_HINT[scoreMode] }}（{{ operationCap > 0 ? '总分 = 伤害分 ≤ 60000 + 操作分 ≤ 5000' : '没有操作分，上限 60000' }}）。</span>
        </div>
      </div>
    </div>
    <div v-else-if="compareResult && compareResult.reason" class="ssc-empty">{{ compareResult.reason }}</div>
  </n-card>
</template>

<script setup lang="ts">
/**
 * 副词条评分卡（2026-10-23）。
 *
 * 两个入口（用户口径「该算单人的」+「也有人要比较两套盘子」）：
 *  ① 单人评分（选角色 → 算）：**全队**（主口径）/ 当前配置下的个人伤害（参考）+ 逐词条 Shapley 贡献；
 *  ② 两套盘子 A/B：把当前存成 A / 存成 B → 对比（差值 + 逐项差异）。
 *
 * 数据/口径全在 `composables/substatScore.ts`（含为什么用 Shapley、单人为什么是主用法、成本）。
 * 本组件只负责：起批任务（`useBatchOwner`）、跑独立场景（`withAnalysisScenario`）、画表。
 *
 * 成本：单人 n=2~4 ⇒ 3~15 次求值（0.1~0.4s），所以**选完角色可以自动算**；
 * A/B 对比固定 2 次求值（瞬时）。全队模式（`slot = null`）不在此卡暴露——
 * 用户口径是「算单人的」，全队口径只是 derive 时的副产品（`gainPct` 仍在结果里）。
 */
import { computed, ref, watch } from 'vue'
import { NButton, NCard, NDivider, NInputNumber, NRadioButton, NRadioGroup, NSelect } from 'naive-ui'
import ChartTable from '@/components/charts/ChartTable.vue'
import { useBatchOwner } from '@/composables/batchTask'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import {
  compareDiscPlans,
  discStatLabel,
  readDiscPlan,
  scoreSubstats,
  type DiscCompareResult,
  type DiscPlan,
  type SubstatScoreResult,
} from '@/composables/substatScore'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { compact, fmt, localized } from '@/utils/format'
import { groupEnginesForAgent } from '@/composables/enginePicker'
import { persistedRef } from '@/composables/persistedRef'
import {
  DEADLY_ASSAULT_SCORE_CAP,
  SCORE_MODE_HINT,
  SCORE_MODE_LABEL,
  SCORE_MODE_OPTIONS,
  operationScoreCapOf,
  type ScoreCurveMode,
} from '@/data/deadlyAssaultScore'
import {
  SCORE_READOUT_LABEL,
  buildScoreConversion,
  clampOperationScore,
  splitTotalScore,
  type ScoreReadout,
  type ScoreSide,
} from '@/composables/substatScoreConvert'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
const owner = useBatchOwner()
const computing = ref(false)
const comparing = ref(false)
const result = ref<SubstatScoreResult | null>(null)
const compareResult = ref<DiscCompareResult | null>(null)
const errorMsg = ref('')
const showQuickEdit = ref(false)
/**
 * A/B 快照**按角色分别持久化**（用户 2026-10-23：「我去主页改词条后再回来，你的记录都没了」）。
 *
 * key 带 agentId 而不是槽位号：换队/换槽不该串台；未知角色仍可存（用 agentId 兜底）。
 * 存的是完整 `DriveDiscConfig`（套装 + 主词条 + 副词条）——与「两套盘子」的语义一致。
 */
interface PlanStore { [agentId: string]: { a?: DiscPlan; b?: DiscPlan } }
const planStore = persistedRef<PlanStore>('zzz-substat-ab', v => {
  if (!v || typeof v !== 'object') return undefined
  return v as PlanStore
}, () => ({}))
const selectedAgentId = computed(() => configStore.team[slot.value]?.agentId ?? '')
const planA = computed<DiscPlan | null>(() => planStore.value[selectedAgentId.value]?.a ?? null)
const planB = computed<DiscPlan | null>(() => planStore.value[selectedAgentId.value]?.b ?? null)

const slotOptions = computed(() => [0, 1, 2].map(i => {
  const id = configStore.team[i]?.agentId
  const name = id ? localized(catalogStore.getAgent(id)?.name) : '空槽';
  return { label: '槽' + (i + 1) + ' · ' + name, value: i, disabled: !id }
}))

/** 默认选中第一个有角色的槽位（进页面就有东西可算） */
const defaultSlot = computed(() => {
  const i = configStore.team.findIndex(c => !!c.agentId)
  return i >= 0 ? i : 0
})
const slot = ref<number>(defaultSlot.value)
watch(defaultSlot, v => { if (!configStore.team[slot.value]?.agentId) slot.value = v })

/** 当前选中的角色（用于「两套对比 / 快速改词条」标题——用户 2026-10-23：「我选的三个角色哪一个？」） */
const selectedLabel = computed(() => {
  const opt = slotOptions.value.find(o => o.value === slot.value)
  return opt?.label ?? `槽${slot.value + 1}`
})

const columns = [
  { key: 'stat', label: '词条' },
  { key: 'steps', label: '步数', width: '56px' },
  { key: 'team', label: '全队贡献', width: '96px' },
  { key: 'own', label: '个人贡献', width: '96px' },
  { key: 'conv', label: '转模', width: '132px' },
  { key: 'share', label: '占比', width: '68px' },
]

const diffColumns = [
  { key: 'kind', label: '类型', width: '76px' },
  { key: 'label', label: '位置' },
  { key: 'a', label: 'A' },
  { key: 'b', label: 'B' },
]

/** 同一条词条在图里保持固定色（沿用副词条收益曲线的配色） */
const STAT_COLORS: Record<string, string> = {
  anomalyProficiency: '#63e2b7', atkPct: '#f0a020', penFlat: '#38bdf8',
  critRate: '#f472b6', critDmg: '#a78bfa', atkFlat: '#facc15',
  defPct: '#34d399', hpPct: '#fb923c', defFlat: '#94a3b8', hpFlat: '#c084fc',
}

const rows = computed(() => (result.value?.contributions ?? []).map(c => ({
  key: c.slot + ':' + c.stat,
  label: c.stat === '*' ? '整槽词条' : discStatLabel(c.stat),
  steps: c.steps,
  pct: c.pct,
  ownPct: c.ownPct,
  sharePct: c.sharePct,
  convText: c.conversions.length
    ? c.conversions.map(x => discStatLabel(x.targetStat) + ' +' + fmt(x.amount, 2)).join(' / ')
    : '—',
  color: STAT_COLORS[c.stat] ?? '#8b8b8b',
})))

/** 击破侧是否有内容可展示（失衡次数变了或失衡总量变了） */
const hasStunOutput = computed(() => {
  const st = result.value?.stunOutput
  if (!st) return false
  return st.stunCountDelta !== 0 || Math.abs(st.totalStunBuildUpDelta) > 1e-9
})

/** 自由收敛时的失衡次数（= 锁定值 + delta）与基线读数 */
const stunBase = computed(() => {
  const st = result.value?.stunOutput
  const zeroAxis = result.value?.zeroAxis
  return {
    freeStun: zeroAxis?.stunCount ?? 0,
    zeroBuildUp: st?.zeroTotalStunBuildUp ?? 0,
    zeroCoverage: zeroAxis?.coverage ?? 0,
  }
})

const totalPct = computed(() => (result.value?.contributions ?? []).reduce((a, c) => a + c.pct, 0))
const totalOwnPct = computed(() => (result.value?.contributions ?? []).reduce((a, c) => a + c.ownPct, 0))

function planSummary(plan: DiscPlan): string {
  const steps = Object.values(plan.subStatAllocation).reduce((a, b) => a + b, 0)
  const sets = [plan.fourPieceSetId, plan.twoPieceSetId].filter(Boolean).length
  const engine = plan.wEngineId
    ? (localized(catalogStore.getWEngine(plan.wEngineId)?.name) || plan.wEngineId) + ' R' + plan.wEngineModLevel
    : '不戴音擎'
  return sets + ' 套 · ' + steps + ' 步 · ' + engine
}

async function run() {
  const task = owner.start()
  computing.value = true
  errorMsg.value = ''
  try {
    const res = await withAnalysisScenario(
      s => scoreSubstats(s, { slot: slot.value, control: { signal: task.signal } }),
      configStore,
    )
    task.commit(() => { result.value = res })
  } catch (e) {
    task.commit(() => { errorMsg.value = '评分失败：' + (e as Error).message })
  } finally {
    task.commit(() => { computing.value = false })
  }
}

/** 换角色 ⇒ 清结果（旧结果属于别的角色，留着会误读） */
watch(slot, () => { result.value = null; errorMsg.value = ''; scoreInput.value = null })
/** 配装变了（快速改词条 / 用 A / 用 B / 主页改）⇒ 结果与对比都过期 */
watch(() => JSON.stringify(configStore.team.map(c => c.driveDisc)), () => {
  result.value = null
  compareResult.value = null
})

function snap(which: 'a' | 'b') {
  const id = selectedAgentId.value
  if (!id) return
  const plan = readDiscPlan(slot.value, configStore.team)
  planStore.value = { ...planStore.value, [id]: { ...planStore.value[id], [which]: plan } }
}

/** 把 A/B 装回当前角色（快速切换，不必去队伍配置页手改） */
function applyPlan(which: 'a' | 'b') {
  const plan = which === 'a' ? planA.value : planB.value
  if (!plan) return
  const char = configStore.team[slot.value]
  const disc = char.driveDisc
  disc.fourPieceSetId = plan.fourPieceSetId
  disc.twoPieceSetId = plan.twoPieceSetId
  disc.mainStats = { ...plan.mainStats }
  disc.subStatAllocation = { ...plan.subStatAllocation }
  char.wEngineId = plan.wEngineId
  char.wEngineModLevel = plan.wEngineModLevel
  result.value = null
  compareResult.value = null
}

// ===== 快速改词条（用户 2026-10-23：「这里应该给个快速修改啊，不该翻页」） =====
/**
 * 音擎下拉：与队伍配置页同一个来源 `displayWEngines`（不另建白名单 / 不自己过滤稀有度），
 * 并且**同职业排前面**（用户 2026-10-26：「同职业才能触发武器效果」）——
 * 排序口径只有一份，在 `composables/enginePicker.ts`。
 */
const wEngineOptions = computed(() => groupEnginesForAgent(
  catalogStore.displayWEngines,
  catalogStore.getAgent(selectedAgentId.value)?.specialty,
  selectedAgentId.value,
))
const currentWEngineId = computed(() => configStore.team[slot.value]?.wEngineId ?? '')
const currentWEngineModLevel = computed(() => configStore.team[slot.value]?.wEngineModLevel ?? 1)
function setWEngine(id: string) {
  configStore.team[slot.value].wEngineId = id
  result.value = null
  compareResult.value = null
}
function setWEngineMod(n: number) {
  configStore.setWEngineModLevel(slot.value, n)
  result.value = null
  compareResult.value = null
}

const subStatPool = computed<string[]>(() => catalogStore.statRules?.driveDisc.subStatPool ?? [])
function subStatCount(stat: string): number {
  return configStore.team[slot.value]?.driveDisc.subStatAllocation?.[stat] ?? 0
}
function setSubStat(stat: string, n: number) {
  configStore.setSubStatCount(slot.value, stat, n)
  result.value = null
  compareResult.value = null
}

// ===== 分数换算（用户 2026-10-27：「A 配置打了 x 分，换成 B 配置的伤害，其他都不变，会打多少分」） =====
/**
 * 难度（普通 / 绝境）与「已知哪一套的分数」是用户输入，**按卡持久化**——
 * 同一支队反复调配装时不用每次重选；分数本身不存（避免下次打开看到过期数字）。
 */
type ScoreConvertPrefs = { mode: ScoreCurveMode; knownSide: ScoreSide; readout: ScoreReadout; operationScore: number }
const scorePrefs = persistedRef<ScoreConvertPrefs>('zzz-substat-score-conv', v => {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Partial<ScoreConvertPrefs>
  const mode = o.mode === 'critical_assault' || o.mode === 'training_dummy' ? o.mode : 'defense'
  const knownSide = o.knownSide === 'b' ? 'b' : 'a'
  const readout = o.readout === 'own' ? 'own' : 'team'
  // 操作分：用户 2026-10-28「操作分默认 5000，让用户少填一次」；改过的值下次沿用
  // （按模式钳：木桩没有操作分 ⇒ 存着 5000 也只解析成 0，切回危局仍是 5000）
  const operationScore = o.operationScore == null ? operationScoreCapOf(mode) : clampOperationScore(o.operationScore, mode)
  return { mode, knownSide, readout, operationScore }
}, () => ({ mode: 'defense', knownSide: 'a', readout: 'team', operationScore: operationScoreCapOf('defense') }))
const scoreMode = computed({
  get: () => scorePrefs.value.mode,
  set: v => { scorePrefs.value = { ...scorePrefs.value, mode: v } },
})
const scoreKnownSide = computed({
  get: () => scorePrefs.value.knownSide,
  set: v => { scorePrefs.value = { ...scorePrefs.value, knownSide: v } },
})
const scoreReadout = computed({
  get: () => scorePrefs.value.readout,
  set: v => { scorePrefs.value = { ...scorePrefs.value, readout: v } },
})
/**
 * **已知配置的总分**（用户 2026-10-28：「用户看到的分数就是总分，他来填总分」）——
 * 危局单房 65000 = 伤害分 60000 + 操作分 5000，玩家在游戏里见到的就是总分，所以只填这一个。
 * 不持久化——过期数字比空着更误导。
 */
const scoreInput = ref<number | null>(null)
/** 当前模式的操作分上限（危局 5000 / 木桩 0）——单一来源 `operationScoreCapOf`，页面不写 5000 */
const operationCap = computed(() => operationScoreCapOf(scoreMode.value))
/** 操作分（危局默认 5000 = 满分档，木桩恒 0；可改，随偏好在 localStorage 里沿用） */
const operationScore = computed({
  get: () => clampOperationScore(scorePrefs.value.operationScore, scoreMode.value),
  set: v => { scorePrefs.value = { ...scorePrefs.value, operationScore: clampOperationScore(v, scoreMode.value) } },
})
/** 分数输入上限 = 伤害分 60000 + 该模式操作分上限（木桩 = 60000） */
const scoreTotalCap = computed(() => DEADLY_ASSAULT_SCORE_CAP + operationCap.value)
/** 用户填的总分 − 操作分 = 真正进曲线的那部分（伤害分）；钳制口径与换算模块同一份实现 */
const knownDamageScore = computed(() =>
  splitTotalScore(scoreInput.value, operationScore.value, scoreMode.value).damageScore)
/** 总分比操作分还低 ⇒ 伤害分被钳成 0（如实提示，不静默；木桩没有操作分，这提示不该出现） */
const totalBelowOperation = computed(() =>
  operationCap.value > 0 && scoreInput.value != null && scoreInput.value < operationScore.value)

const readoutOptions = [
  { value: 'team' as ScoreReadout, label: SCORE_READOUT_LABEL.team },
  { value: 'own' as ScoreReadout, label: SCORE_READOUT_LABEL.own },
]

/** 「已知」下拉：A / B 各带自己的伤害读数，避免选错边 */
const scoreSideOptions = computed(() => {
  const rd = SCORE_READOUT_LABEL[scoreReadout.value]
  const of = (side: 'a' | 'b') => {
    const v = side === 'a' ? compareResult.value?.aTeam : compareResult.value?.bTeam
    const own = side === 'a' ? compareResult.value?.aOwn : compareResult.value?.bOwn
    const dmg = scoreReadout.value === 'own' ? own : v
    return {
      value: side,
      label: side.toUpperCase() + '（' + rd + ' ' + (dmg == null ? '—' : compact(dmg)) + '）',
    }
  }
  return [of('a'), of('b')]
})

/**
 * 换算结果：伤害之比取 **锁失衡** 的那一份读数（与上面「全队伤害 / 个人伤害」两行同源），
 * 不含「多打一次失衡」的离散跳变——否则「换个配置能打多少分」会被一次失衡跳变带偏。
 */
const scoreConversion = computed(() => {
  const cmp = compareResult.value
  if (!cmp || cmp.reason) return null
  return buildScoreConversion({
    mode: scoreMode.value,
    knownSide: scoreKnownSide.value,
    score: scoreInput.value,
    operationScore: operationScore.value,
    aDamage: scoreReadout.value === 'own' ? cmp.aOwn : cmp.aTeam,
    bDamage: scoreReadout.value === 'own' ? cmp.bOwn : cmp.bTeam,
  })
})

/** 对比结果换了 ⇒ 分数输入保留（同一支队换配装重算时通常想沿用同一个分） */

async function runCompare() {
  if (!planA.value || !planB.value) return
  const task = owner.start()
  comparing.value = true
  errorMsg.value = ''
  try {
    const res = await withAnalysisScenario(
      s => compareDiscPlans(s, { slot: slot.value, a: planA.value!, b: planB.value!, control: { signal: task.signal } }),
      configStore,
    )
    task.commit(() => { compareResult.value = res })
  } catch (e) {
    task.commit(() => { errorMsg.value = '对比失败：' + (e as Error).message })
  } finally {
    task.commit(() => { comparing.value = false })
  }
}
</script>

<style scoped>
.ssc-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ssc-controls { display: flex; align-items: center; gap: 8px; }
.ssc-caption { font-size: 12px; color: var(--fg-3); line-height: 1.6; margin-bottom: 10px; }
.ssc-error { font-size: 12px; color: var(--c-warning-strong); margin-bottom: 8px; }
.ssc-summary { display: flex; align-items: center; gap: 22px; margin: 8px 0 12px; }
.ssc-score { display: flex; flex-direction: column; }
.ssc-score-value { font-size: 24px; font-weight: 700; color: var(--app-accent-gold); line-height: 1.2; }
.ssc-score-value-sm { font-size: 16px; font-weight: 600; color: var(--fg-2); line-height: 1.4; }
.ssc-score-label { font-size: 11px; color: var(--fg-3); }
.ssc-facts { font-size: 12px; color: var(--fg-2); line-height: 1.7; }
.ssc-quick { margin-bottom: 10px; }
/* 列宽固定 + 从左侧排：minmax(190px, 1fr) 会把每列拉伸到整卡宽度的 1/N，
   再配 space-between 就变成「名字贴左、输入框贴右」，看着像输入框属于右邻那一列（用户 2026-10-23 报）。 */
.ssc-quick-grid { display: grid; grid-template-columns: repeat(auto-fill, 200px); gap: 4px 20px; justify-content: start; }
.ssc-quick-row { display: flex; align-items: center; gap: 8px; }
/* 标签定宽 ⇒ 所有输入框左边缘对齐，且与自己的标签紧邻 */
.ssc-quick-name { flex: none; width: 64px; font-size: 12px; color: var(--fg-2); }
.ssc-quick-engine { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.ssc-quick-foot { margin-top: 8px; font-size: 11px; color: var(--fg-3); line-height: 1.6; }
.ssc-stun { margin: 10px 0 12px; padding: 8px 10px; border-left: 2px solid var(--app-accent-gold); background: var(--app-inset); border-radius: 2px; }
.ssc-stun-title { font-size: 12px; color: var(--fg-2); font-weight: 600; margin-bottom: 6px; }
.ssc-stun-rows { display: flex; flex-direction: column; gap: 2px; }
.ssc-stun-row { display: flex; align-items: baseline; gap: 10px; font-size: 12px; color: var(--fg-2); }
.ssc-stun-label { width: 72px; color: var(--fg-3); }
.ssc-stun-delta { font-weight: 600; margin-left: auto; }
.ssc-stun-highlight .ssc-stun-delta { color: var(--app-accent-gold); }
.ssc-stun-note { margin-top: 6px; font-size: 11px; color: var(--fg-3); line-height: 1.6; }
.ssc-conv-note { font-size: 12px; color: var(--fg-3); line-height: 1.6; margin-bottom: 8px; }
.ssc-axis-note { font-size: 12px; color: var(--c-warning-strong); line-height: 1.6; margin-bottom: 10px; }
.ssc-foot { margin-top: 6px; font-size: 11px; color: var(--fg-3); }
.ssc-empty { font-size: 12px; color: var(--fg-3); padding: 8px 0; }
.ssc-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
.ssc-subhead { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; font-size: 13px; color: var(--fg-2); }
.ssc-snaps { display: flex; gap: 20px; font-size: 12px; color: var(--fg-3); margin-bottom: 8px; }
.ssc-compare { margin-top: 6px; }
.ssc-compare-row { display: flex; align-items: baseline; gap: 12px; font-size: 12px; color: var(--fg-2); line-height: 1.9; }
.ssc-compare-label { width: 84px; color: var(--fg-3); }
.ssc-compare-delta { font-weight: 600; }
.ssc-conv { margin-top: 10px; padding: 8px 10px; border-left: 2px solid var(--app-primary); background: var(--app-inset); border-radius: 2px; }
.ssc-conv-title { display: flex; align-items: baseline; gap: 10px; font-size: 13px; color: var(--fg-2); font-weight: 600; margin-bottom: 6px; }
.ssc-conv-hint { font-size: 11px; font-weight: 400; color: var(--fg-3); }
.ssc-conv-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--fg-2); }
.ssc-conv-label { color: var(--fg-3); }
.ssc-conv-result { display: flex; align-items: center; gap: 22px; margin: 8px 0 4px; }
.ssc-conv-split { margin-top: 6px; font-size: 11px; color: var(--fg-3); line-height: 1.6; }
.ssc-conv-note { font-size: 11px; color: var(--fg-3); line-height: 1.6; }
.ssc-conv-warn-inline { color: var(--c-warning-strong); }
.ssc-conv-dim { color: var(--fg-3); }
.ssc-conv-warn { font-size: 11px; color: var(--c-warning-strong); line-height: 1.6; }
</style>
