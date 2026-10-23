<template>
  <n-card size="small" :bordered="true">
    <template #header>
      <div class="ssc-title">
        <span>副词条评分（相对 0 副词条的全队伤害增益）</span>
        <n-button size="small" type="primary" :loading="computing" @click="run">
          {{ result ? '重算' : '计算评分' }}
        </n-button>
      </div>
    </template>

    <div class="ssc-caption">
      评分的分母 = <b>0 副词条</b>时（三个槽位的副词条全部清空）的队伍总伤，分子 = 当前配装。
      逐条贡献用 <b>Shapley 分摊</b>（把所有词条一起考虑后，每一项"公平分到"的那一份）——
      它的和**严格等于**评分，因此可以直接相加看账；而"单项边际"（只删这一条）在这类互相放大的
      乘区上会加起来超过总增益。求值较贵（每点 20~30ms，全子集 2^n 次 ≈ 数秒），故只在点按钮时算；
      采样跑在独立场景里，不动你的配装。
    </div>

    <div v-if="computing || progressText" class="ssc-progress">
      <n-progress type="line" :percentage="Math.round(progressPct * 100)" :show-indicator="false" :height="6" />
      <span class="ssc-progress-text">{{ progressText }}</span>
    </div>
    <div v-if="errorMsg" class="ssc-error">{{ errorMsg }}</div>

    <template v-if="result && !result.reason">
      <div class="ssc-summary">
        <div class="ssc-score">
          <span class="ssc-score-value">+{{ fmt(result.gainPct, 2) }}%</span>
          <span class="ssc-score-label">全队伤害增益</span>
        </div>
        <div class="ssc-facts">
          <div>0 词条总伤 <b>{{ compact(result.zeroDamage) }}</b> → 当前 <b>{{ compact(result.currentDamage) }}</b></div>
          <div>求值 {{ result.evals }} 次 · 拆到 {{ result.coarse ? '槽位（词条过多，已合并）' : '单条词条' }}</div>
        </div>
      </div>

      <div v-if="result.axisChanged" class="ssc-axis-note">
        轴态跳变：失衡次数 {{ result.zeroAxis.stunCount }} → {{ result.currentAxis.stunCount }}、
        易伤覆盖 {{ fmt(result.zeroAxis.coverage * 100, 1) }}% → {{ fmt(result.currentAxis.coverage * 100, 1) }}%。
        本次评分跨了轴态——那部分不是词条本身的价值，而是"多了这一次失衡"的整窗易伤差。
      </div>

      <ChartTable :columns="columns" align="right" dense max-height="340px" empty="没有可显示的贡献">
        <tr v-for="row in rows" :key="row.key">
          <td><span class="ssc-dot" :style="{ background: row.color }"></span>{{ row.label }}</td>
          <td>{{ row.slotLabel }}</td>
          <td>{{ row.steps }}</td>
          <td :style="{ color: row.pct >= 0 ? 'var(--fg-3)' : 'var(--c-warning-strong)' }">
            {{ row.pct >= 0 ? '+' : '' }}{{ fmt(row.pct, 2) }}%
          </td>
          <td>{{ fmt(row.sharePct, 1) }}%</td>
        </tr>
      </ChartTable>
      <div class="ssc-foot">
        合计 {{ fmt(totalPct, 2) }}%（= 评分，逐位相等）· 占比 = 该条 / 合计
      </div>
    </template>
    <div v-else-if="result && result.reason" class="ssc-empty">{{ result.reason }}</div>
    <div v-else-if="!computing" class="ssc-empty">
      点「计算评分」：以 0 副词条为基线，算出当前副词条值多少伤害，并把每一条词条的贡献摊开。
    </div>
  </n-card>
</template>

<script setup lang="ts">
/**
 * 副词条评分卡（2026-10-23）。
 *
 * 数据/口径全在 `composables/substatScore.ts`（Shapley 分摊 + 基线与轴态），本组件只负责；
 * ① 起批任务（`useBatchOwner`：重算吊销上一次、离开页面即停）；
 * ② 跑在独立场景上（`withAnalysisScenario`，不动 UI store）；
 * ③ 画总分 + 逐条贡献表（表格基座走共享 `ChartTable`）。
 *
 * 成本口径（决定"要不要显式按钮"）：实测单点 20~30ms，全子集 2^n 次 ⇒ n=6 约 1.2s、n=9 约 10s。
 * ⇒ 不在进页面时自动跑（与「副词条收益曲线」同一处置）。
 */
import { computed, ref } from 'vue'
import { NButton, NCard, NProgress } from 'naive-ui'
import ChartTable from '@/components/charts/ChartTable.vue'
import { useBatchOwner } from '@/composables/batchTask'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { scoreSubstats, type SubstatScoreResult } from '@/composables/substatScore'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { substatShortLabel } from '@/data/substatLabels'
import { compact, fmt, localized } from '@/utils/format'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
const owner = useBatchOwner()
const computing = ref(false)
const result = ref<SubstatScoreResult | null>(null)
const errorMsg = ref('')
const progressPct = ref(0)
const progressText = ref('')

const columns = [
  { key: 'stat', label: '词条' },
  { key: 'slot', label: '槽位' },
  { key: 'steps', label: '步数', width: '64px' },
  { key: 'pct', label: '贡献（百分点）', width: '110px' },
  { key: 'share', label: '占比', width: '80px' },
]

/** 同一条词条在图表里保持固定色（沿用副词条收益曲线的配色，跨图同色） */
const STAT_COLORS: Record<string, string> = {
  anomalyProficiency: '#63e2b7', atkPct: '#f0a020', penFlat: '#38bdf8',
  critRate: '#f472b6', critDmg: '#a78bfa', atkFlat: '#facc15',
  defPct: '#34d399', hpPct: '#fb923c', defFlat: '#94a3b8', hpFlat: '#c084fc',
}

const slotLabelOf = (slot: number): string => {
  const id = configStore.team[slot]?.agentId
  if (!id) return `槽${slot + 1}`
  const agent = catalogStore.getAgent(id)
  return agent ? localized(agent.name) : `槽${slot + 1}`
};

const rows = computed(() => {
  const r = result.value
  if (!r) return []
  return r.contributions.map(c => ({
    key: `${c.slot}:${c.stat}`,
    label: c.stat === '*' ? '整槽词条' : substatShortLabel(c.stat),
    slotLabel: slotLabelOf(c.slot),
    steps: c.steps,
    pct: c.pct,
    sharePct: c.sharePct,
    color: STAT_COLORS[c.stat] ?? '#8b8b8b',
  }))
});

const totalPct = computed(() => (result.value?.contributions ?? []).reduce((a, c) => a + c.pct, 0));

async function run() {
  const task = owner.start()
  computing.value = true
  errorMsg.value = ''
  progressPct.value = 0
  progressText.value = ''
  const t0 = performance.now()
  try {
    const res = await withAnalysisScenario(s => scoreSubstats(s, { control: { signal: task.signal } }), configStore)
    task.commit(() => {
      result.value = res;
    });
  } catch (e) {
    task.commit(() => { errorMsg.value = `评分失败：${(e as Error).message}` });
  } finally {
    task.commit(() => {
      computing.value = false;
      progressText.value = result.value ? `耗时 ${((performance.now() - t0) / 1000).toFixed(1)}s` : '';
    });
  }
}
</script>

<style scoped>
.ssc-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ssc-caption { font-size: 12px; color: var(--fg-3); line-height: 1.6; margin-bottom: 10px; }
.ssc-progress { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.ssc-progress-text { font-size: 11px; color: var(--fg-3); white-space: nowrap; }
.ssc-error { font-size: 12px; color: var(--c-warning-strong); margin-bottom: 8px; }
.ssc-summary { display: flex; align-items: center; gap: 24px; margin: 8px 0 12px; }
.ssc-score { display: flex; flex-direction: column; }
.ssc-score-value { font-size: 24px; font-weight: 700; color: var(--app-accent-gold); line-height: 1.2; }
.ssc-score-label { font-size: 11px; color: var(--fg-3); }
.ssc-facts { font-size: 12px; color: var(--fg-2); line-height: 1.7; }
.ssc-axis-note { font-size: 12px; color: var(--c-warning-strong); line-height: 1.6; margin-bottom: 10px; }
.ssc-foot { margin-top: 6px; font-size: 11px; color: var(--fg-3); }
.ssc-empty { font-size: 12px; color: var(--fg-3); padding: 8px 0; }
.ssc-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
</style>
