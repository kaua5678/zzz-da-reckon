<template>
  <n-card size="small" :bordered="true">
    <div class="chart-controls">
      <div class="ctl-field">
        <span class="ctl-label">主C角色（S级）</span>
        <n-select
          :value="mainAgentId"
          :options="mainAgentOptions"
          size="small"
          filterable
          style="width: 200px"
          @update:value="emit('update:mainAgentId', $event)"
        />
      </div>
      <div class="ctl-field">
        <span class="ctl-label">Boss</span>
        <n-select
          :value="selectedBossId"
          :options="bossOptions"
          size="small"
          filterable
          style="width: 240px"
          placeholder="选择 Boss（必选，默认最新危局）"
          @update:value="emit('update:selectedBossId', $event)"
        />
      </div>
      <div class="ctl-field">
        <span class="ctl-label">限定金预算</span>
        <n-input-number
          :value="budget"
          :min="0"
          :max="24"
          size="small"
          style="width: 110px"
          @update:value="emit('update:budget', $event ?? 0)"
        />
      </div>
      <div class="ctl-field">
        <span class="ctl-label">候选队友（策展池）</span>
        <n-select
          :value="candidatePool"
          :options="candidateOptions"
          multiple
          size="small"
          filterable
          style="width: 340px"
          placeholder="至少 2 名；默认 青衣/潘引壶/橘福福/卢西娅/琉音"
          @update:value="emit('update:candidatePool', $event)"
        />
      </div>
      <div class="ctl-field">
        <label class="ctl-check">
          <input
            :checked="autoBuild"
            type="checkbox"
            @change="emit('update:autoBuild', ($event.target as HTMLInputElement).checked)"
          />
          自动配装（推荐+词条优化，慢）
        </label>
        <label class="ctl-check">
          <input
            :checked="optimalGold"
            type="checkbox"
            @change="emit('update:optimalGold', ($event.target as HTMLInputElement).checked)"
          />
          最优加金分配（逐金贪婪，慢）
        </label>
      </div>
      <div class="ctl-field">
        <n-button type="primary" size="small" :loading="computing" @click="emit('run')">
          {{ result ? '重新计算' : '计算' }}
        </n-button>
      </div>
      <div class="ctl-field ctl-hint">
        <span class="ctl-label">说明：只枚举候选池内组合（C(n,2)，每队只算一次——同队跨期面对同一 Boss 数值不变，
          当期 Buff 不参与），默认轻量速算 = 兜底配装 + 主C优先确定性加金；
          勾选「自动配装 / 最优加金」切换全量档（慢）。横轴 = 所选 Boss 登场的危局期数（期号如「45」代表 69045；一版约 3 期、每期 ~14 天，只看普通模式），从其首次登场起算到最新——只对抗这一个 Boss 看队伍成长；角色期数中途实装也算该期可用。</span>
      </div>
    </div>

    <!-- Boss 数据（所选 Boss 最新危局期的数值；换 Boss 即切换） -->
    <div v-if="selectedBoss && selectedPhase" class="boss-data-strip">
      <span class="boss-data-title">Boss 数据 · {{ selectedBoss.name }}</span>
      <span class="boss-data-item">期 {{ selectedPhase.label }}</span>
      <span class="boss-data-item">血量 {{ compact(selectedPhase.hp) }}</span>
      <span class="boss-data-item">失衡值 {{ fmt(selectedPhase.stunValue, 0) }}</span>
      <span class="boss-data-item">防御 {{ selectedPhase.defense }}</span>
      <span class="boss-data-item">Lv{{ selectedPhase.level }}</span>
      <span class="boss-data-item">异常系数 ×{{ selectedPhase.bossAnomalyCoeff }}</span>
      <span class="boss-data-item">失衡倍率 ×{{ selectedBoss.monster.stunVuln }}</span>
      <span class="boss-data-item">失衡时间 {{ fmt(selectedBoss.monster.stunTime, 1) }}s</span>
      <span class="boss-data-item">战斗 {{ selectedBoss.defaults.battleTime }}s</span>
      <span class="boss-data-item">弱点 {{ selectedPhase.weakness.join('/') || '—' }}</span>
      <span class="boss-data-item">抗性 {{ selectedPhase.resistance.join('/') || '—' }}</span>
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
</template>

<script setup lang="ts">
/**
 * 时间图表页 · 顶部控制面板（2026-09-14 第三片，模板 3–97 整块搬迁）。
 *
 * ## 为什么 T11 当年判「不做」，以及本轮为何能做
 * T11 报告：「控制面板（模板 3–97，95 行）——本轮实测判定同样被 scoped 挡住……抽走后这些样式
 * 要么留在页面（scoped 失效 ⇒ 子组件元素掉样式）要么全局化（跨块观感风险）⇒ 不是零 delta，不做。」
 * 那个二难的前提是「全局化 = 跨块观感变化」。本轮先做了**图表样式收敛**（`src/styles/charts.css`），
 * 把共享控件基元（chart-controls / ctl-field / ctl-label / ctl-check / ctl-hint /
 * chart-progress / progress-text / ctl-note）放进**全局表**——前提随之消失：
 *   · 这些类在各页**本来同名同值**（实测 ctl-field / ctl-label 三页逐字相同），全局化是**去重**；
 *   · 唯一值不同的是 `ImpactChart.vue` 的 ctl-label（12px/--wa-500），它靠 **scoped 特异性更高**
 *     （`.x[data-v-…]` > `.x`）自然胜出，不受全局规则影响。
 * 实证：收敛后 DOM 指纹 2634 节点**逐位一致**。
 *
 * ## 双向绑定
 * 用 props + emits('update:*)（仓库既有组件范式；defineModel 在本仓零先例，不引入新写法）。
 * 事件与文案逐字保留：按钮 `result ? '重新计算' : '计算'`、进度条双条件 `computing || progress`、
 * `progress?.pct ?? 0` 空值兜底、Boss 数据条 12 个字段与格式。
 *
 * ## 样式归属
 * 共享基元在 styles/charts.css；boss-data 三兄弟是本组件**独占**，随组件走（scoped）。
 */
import { NButton, NCard, NInputNumber, NProgress, NSelect } from 'naive-ui'
import { compact, fmt } from '@/utils/format'
import type { BossPreset } from '@/types/bossPreset'

/** Boss 预设的期相 —— selectedPhase 的真实类型（页面 computed 在 BossPreset.phases 里挑） */
type BossPhase = BossPreset['phases'][number]

defineProps<{
  mainAgentId: string
  mainAgentOptions: { label: string; value: string }[]
  selectedBossId: string
  bossOptions: { label: string; value: string }[]
  budget: number
  candidatePool: string[]
  candidateOptions: { label: string; value: string }[]
  autoBuild: boolean
  optimalGold: boolean
  computing: boolean
  progress: { pct: number; text: string } | null
  /** 仅用于按钮文案（result ? 重新计算 : 计算），组件不读其内部结构 */
  result: unknown
  selectedBoss: BossPreset | null
  selectedPhase: BossPhase | null
}>()

const emit = defineEmits<{
  'update:mainAgentId': [value: string]
  'update:selectedBossId': [value: string]
  'update:budget': [value: number]
  'update:candidatePool': [value: string[]]
  'update:autoBuild': [value: boolean]
  'update:optimalGold': [value: boolean]
  run: []
}>()
</script>

<style scoped>
/* 本组件独占：Boss 数据条。共享控件基元在 src/styles/charts.css 全局表里。
   逐字复制自 views/timeCharts/TimeChartsPage.css 的同名规则（搬迁前它们在页面 scoped 里）。 */
.boss-data-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  align-items: center;
  margin-top: 10px;
  padding: 8px 12px;
  border: 1px solid var(--wa-70);
  border-radius: 8px;
  background: var(--wa-20);
}
.boss-data-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--c-warning);
  white-space: nowrap;
}
.boss-data-item {
  font-size: 11.5px;
  color: var(--wa-720);
  white-space: nowrap;
}
</style>
