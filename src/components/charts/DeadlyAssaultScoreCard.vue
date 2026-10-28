<template>
  <n-card size="small" class="das-card" :bordered="true">
    <template #header>
      <div class="das-header">
        <span>伤害 → 分数（危局 / 木桩）</span>
        <span class="das-hp">当前敌方血量 {{ fmt(hp, 0) }}</span>
      </div>
    </template>
    <div class="das-intro">
      算出伤害后按当前敌方血量换算分数。<b>三条曲线互不相同</b>：普通 / 绝境是分段线性（每管血换的分不同），
      默认 33.47 亿血木桩是<b>正比</b>且<b>没有操作分</b>；危局总分 = 伤害分（≤ {{ fmt(DEADLY_ASSAULT_SCORE_CAP, 0) }}）+ 操作分。
    </div>
    <div class="das-row">
      <span class="das-label">曲线</span>
      <n-radio-group v-model:value="mode" size="small">
        <n-radio-button v-for="opt in SCORE_MODE_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</n-radio-button>
      </n-radio-group>
      <span class="das-hint">{{ SCORE_MODE_HINT[mode] }}</span>
    </div>
    <div class="das-row">
      <span class="das-label">伤害</span>
      <n-input-number v-model:value="damageInput" :min="0" :step="1000000" size="small" style="width: 170px" :placeholder="fmt(teamDamage, 0)" />
      <n-button size="tiny" secondary @click="damageInput = teamDamage">用当前全队总伤</n-button>
      <span class="das-hint">全队总伤 {{ fmt(teamDamage, 0) }}（结果页「伤害池」那一份）</span>
    </div>
    <div class="das-row">
      <span class="das-label">操作分</span>
      <n-input-number
        v-if="operationCap > 0"
        v-model:value="operationScore"
        :min="0"
        :max="operationCap"
        :step="500"
        size="small"
        style="width: 120px"
      />
      <span v-else class="das-hint">木桩没有操作分（该项恒 0）</span>
      <span v-if="operationCap > 0" class="das-hint">危局单房上限 {{ fmt(operationCap, 0) }}；总分 = 伤害分 + 操作分</span>
    </div>

    <div class="das-result">
      <div class="das-score">
        <span class="das-score-value">{{ fmt(result.score, 0) }}</span>
        <span class="das-score-label">{{ SCORE_MODE_LABEL[mode] }} · {{ operationCap > 0 ? '总分' : '分数' }}</span>
      </div>
      <div class="das-facts">
        <div>伤害/血量 {{ fmt(result.ratio * 100, 2) }}%<span v-if="mode === 'training_dummy'">（木桩正比：1% 血 = 600 分）</span><span v-else>（分段线性：每管血换的分不同）</span></div>
        <div v-if="operationCap > 0">伤害分 {{ fmt(result.damageScore, 0) }} + 操作分 {{ fmt(result.operation, 0) }} = 总分 {{ fmt(result.score, 0) }}</div>
        <div v-else>伤害分 {{ fmt(result.damageScore, 0) }}（木桩无操作分）= 分数 {{ fmt(result.score, 0) }}</div>
      </div>
    </div>
    <div v-if="result.killed" class="das-kill">
      ⚠ 伤害已够击杀（伤害分封顶 {{ fmt(DEADLY_ASSAULT_SCORE_CAP, 0) }}），超出部分不再加分{{ operationCap > 0 ? '；总分上限 ' + fmt(result.totalCap, 0) : '' }}。
    </div>
    <div v-else-if="!hpOk" class="das-warn">
      ⚠ 当前敌方血量为 0（没有应用 Boss 也没有默认木桩）⇒ 比例无意义，先在上方「资源池全局参数」或属性配置页填血量。
    </div>
    <div class="das-note">
      曲线单一来源 <code>data/deadlyAssaultScore.ts#SCORE_CURVES</code>；木桩 = 属性配置页默认敌人
      「自由训练模式」（33.47 亿血，线性点数、无操作分）。换曲线只重算展示，不重新求值。
    </div>
  </n-card>
</template>

<script setup lang="ts">
/**
 * 伤害 → 分数卡（结果页 · 伤害池页签，用户 2026-10-28：「算出伤害后需要换算危局分数，
 * 绝境和普通换算不一样」＋「默认33亿血的其实是一个木桩本，他的曲线和绝境普通都不一样，
 * 是和分数成正比的，没有操作分」）。
 *
 * 三条曲线全在 `data/deadlyAssaultScore.ts`（单一事实源）：
 * - 普通 defense / 绝境 critical_assault：分段线性，操作分 ≤5000；
 * - 木桩 training_dummy：线性正比，**无操作分**。
 *
 * 本卡是**纯展示**：伤害由父组件传入（`useResourceCalc#teamTotalDamage`），血量读 `configStore.enemy.hp`，
 * 切换曲线只重算 `scoreFromDamage`（纯函数），**不触发任何引擎求值**（坑 53：不给页面加隐形重算）。
 */
import { computed, ref } from 'vue'
import { NCard, NInputNumber, NRadioButton, NRadioGroup, NButton } from 'naive-ui'
import { useConfigStore } from '@/stores/config'
import {
  DEADLY_ASSAULT_SCORE_CAP,
  SCORE_MODE_HINT,
  SCORE_MODE_LABEL,
  SCORE_MODE_OPTIONS,
  operationScoreCapOf,
  scoreFromDamage,
  type ScoreCurveMode,
} from '@/data/deadlyAssaultScore'
import { clampOperationScore } from '@/composables/substatScoreConvert'
import { fmt } from '@/utils/format'

const props = defineProps<{
  /** 当前全队总伤害（引擎读数，父组件传入；本卡不自己求值） */
  teamDamage: number
}>()

const configStore = useConfigStore()

/** 曲线选择：默认普通（危局最常见）——木桩是第三种，不是默认 */
const mode = ref<ScoreCurveMode>('defense')
/** 该模式的操作分上限（危局 5000 / 木桩 0）——单一来源 operationScoreCapOf，组件不写 5000 */
const operationCap = computed(() => operationScoreCapOf(mode.value))
/** 用户填的操作分（原样存；读时按当前模式钳：木桩上限 0 ⇒ 恒 0，切回危局恢复原值） */
const storedOperation = ref(operationScoreCapOf('defense'))
const operationScore = computed({
  get: () => clampOperationScore(storedOperation.value, mode.value),
  set: v => { storedOperation.value = v ?? 0 },
})
/** 伤害输入：默认空 ⇒ 用当前总伤；填了就用填的（用户想试「如果打这么多」） */
const damageInput = ref<number | null>(null)

const hp = computed(() => configStore.enemy.hp)
const hpOk = computed(() => hp.value > 0)
const teamDamage = computed(() => props.teamDamage)
const effectiveDamage = computed(() => damageInput.value ?? props.teamDamage)

const result = computed(() => {
  const base = scoreFromDamage(effectiveDamage.value, hp.value, mode.value)
  const operation = clampOperationScore(storedOperation.value, mode.value)
  return {
    ratio: base.ratio,
    damageScore: base.damageScore,
    operation,
    /** 总分 = 伤害分 + 操作分（危局 ≤ 65000 / 木桩 ≤ 60000）——**不要对总和钳到 60000**，操作分是加在封顶之上的 */
    score: base.damageScore + operation,
    totalCap: DEADLY_ASSAULT_SCORE_CAP + operation,
    killed: base.ratio >= 1,
  }
})
</script>

<style scoped>
.das-card { background: var(--app-panel); }
.das-header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.das-hp { font-size: 12px; color: var(--fg-2); }
.das-intro { font-size: 12px; color: var(--fg-2); line-height: 1.7; margin-bottom: 10px; }
.das-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--fg-2); margin-bottom: 8px; }
.das-label { color: var(--fg-3); min-width: 48px; }
.das-hint { font-size: 11px; color: var(--fg-3); }
.das-result { display: flex; align-items: center; gap: 26px; margin: 10px 0 6px; }
.das-score { display: flex; flex-direction: column; }
.das-score-value { font-size: 24px; font-weight: 700; color: var(--app-accent-gold); line-height: 1.2; }
.das-score-label { font-size: 11px; color: var(--fg-3); }
.das-facts { font-size: 12px; color: var(--fg-2); line-height: 1.7; }
.das-kill { font-size: 11px; color: var(--c-warning-strong); line-height: 1.6; }
.das-warn { font-size: 11px; color: var(--c-warning-strong); line-height: 1.6; }
.das-note { font-size: 11px; color: var(--fg-3); line-height: 1.6; margin-top: 4px; }
</style>
