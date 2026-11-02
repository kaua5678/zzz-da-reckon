<template>
  <div class="result-page">
    <!-- 无队伍数据时的占位 -->
    <div v-if="!hasTeam" class="placeholder">
      <n-icon size="64" color="var(--wa-150)">
        <people-outline />
      </n-icon>
      <div class="placeholder-title">请先配置队伍</div>
      <div class="placeholder-desc">在"队伍配置"页选择角色后，资源池分析将自动计算</div>
    </div>

    <template v-else>
      <!-- 全局参数栏（所有 tab 共用） -->
      <n-card size="small" class="global-config-card" :bordered="true">
        <template #header>
          <span>资源池全局参数</span>
        </template>
        <n-grid :cols="6" :x-gap="12" responsive="screen">
          <n-gi>
            <div class="param-item">
              <div class="param-label">总时间</div>
              <n-input-number
                :value="configStore.effectiveTime"
                size="small"
                :min="0"
                :max="configStore.enemy.battleTime"
                @update:value="v => configStore.setEnemy({ invincibleTime: configStore.enemy.battleTime - (v ?? configStore.enemy.battleTime) })"
              />
            </div>
          </n-gi>
          <n-gi>
            <div class="param-item">
              <div class="param-label">秽盾数量</div>
              <n-input-number
                :value="configStore.enemy.shieldCount"
                size="small"
                :min="0"
                :max="20"
                @update:value="v => configStore.setEnemy({ shieldCount: v ?? 0 })"
              />
            </div>
          </n-gi>
          <n-gi>
            <div class="param-item">
              <div class="param-label">能量盾数量</div>
              <n-input-number
                :value="configStore.enemy.energyShield"
                size="small"
                :min="0"
                :max="20"
                @update:value="v => configStore.setEnemy({ energyShield: v ?? 0 })"
              />
            </div>
          </n-gi>
          <n-gi>
            <div class="param-item">
              <div class="param-label">Boss失衡值</div>
              <n-input-number
                :value="configStore.enemy.stunValue"
                size="small"
                :min="0"
                @update:value="v => configStore.setEnemy({ stunValue: v ?? 0 })"
              />
            </div>
          </n-gi>
          <n-gi>
            <div class="param-item">
              <div class="param-label">弹刀（全队）</div>
              <n-input-number
                :value="totalParryCount"
                size="small"
                :min="0"
                :max="99"
                disabled
                :placeholder="String(totalParryCount)"
              />
            </div>
          </n-gi>
          <n-gi>
            <div class="param-item">
              <div class="param-label">闪避反击（全队）</div>
              <n-input-number
                :value="totalDodgeCount"
                size="small"
                :min="0"
                :max="99"
                disabled
                :placeholder="String(totalDodgeCount)"
              />
            </div>
          </n-gi>
        </n-grid>
      </n-card>

      <!-- 计算状态（所有 tab 共用）：三层不动点都要可见，别只报内层 -->
      <div v-if="resourceResult" class="result-summary">
        <n-alert :type="convergenceOk ? 'success' : 'warning'" size="small">
          <template #header>
            迭代 {{ resourceResult.iterations }} 次
            {{ resourceResult.converged ? '已收敛' : '未收敛（已达最大迭代次数）' }}
            · 失衡次数: {{ stunPoolResult ? stunPoolResult.stunCount : '（失衡池未产出）' }}
          </template>
          <div v-if="!convergenceOk" style="font-size:12px;line-height:1.6">
            <div v-if="!resourceResult.convergence.timeBudgetConverged">
              时间预算外层未收敛（{{ resourceResult.convergence.timeBudgetPasses }} 轮）：仍有
              {{ fmt(resourceResult.convergence.timeBudgetResidualSeconds, 2) }}s 执行行前台时间超出战斗时间
              —— 通常是某模块 buildExecutions 推了占前台的行但没计入 estimateExSpecialTime。
            </div>
            <div v-if="resourceResult.convergence.outerExit === 'maxIter'">
              失衡外层耗尽迭代上限（{{ resourceResult.convergence.outerRounds }} 轮）：失衡次数/异常喧响奖励仍在变，
              结果可能停在非稳定点。
            </div>
            <div v-else-if="resourceResult.convergence.outerExit === 'cycle'">
              失衡外层检测到离散循环（{{ resourceResult.convergence.outerRounds }} 轮）后停止：
              结果取循环中的一支，属离散场景的正常兜底。
            </div>
          </div>
        </n-alert>
        <div class="combo-align-btn-row">
          <n-button size="small" type="primary" secondary @click="showComboAlignModal = true">
            合轴率调节
          </n-button>
        </div>
      </div>

      <!-- 最终面板与乘区（局外→局内，调命座/装备后用于核对最终属性是否生效） -->
      <FinalPanel v-if="hasTeam" :effect-coverages="effectiveWEngineCoverages" :disc-coverages="effectiveDiscEffectCoverages" :teammate-coverages="effectiveTeammateBuffCoverages" />

      <!-- ====== 资源池（共享视图）====== -->
      <!-- 用户 2026-11-03 口径：资源页那一整套 = **一个共享组件**（`components/ResourcePoolView.vue`），
           ResultPage 与各比较入口都喂「一个档位快照」进来 ⇒ 以后加一块资源展示只改这一处
           （本仓最怕「两处漂移」）。缺读数（非轴队 / 弃轴 / 未采）⇒ 该块**如实写「无/未采 + 原因」**，
           不补造、不编 0。
           ⚠ 原先这里的三个子页签（资源/异常/伤害）已去掉：**完整 = 默认全含**，不再靠点页签才看得见。
           ⚠ 弃轴提示也随资源块一起进了共享视图（它回答的是「下面这些数是怎么算出来的」）——
           `@adjust-combo-align` 把「去调合轴率」按钮接回本页的弹窗（比较入口没接 ⇒ 只陈述、不给死按钮）。 -->
      <ResourcePoolView
        v-if="poolSnapshot"
        :snapshot="poolSnapshot"
        @adjust-combo-align="showComboAlignModal = true"
      />
      <!-- 无计算结果（快照建不出来：队伍无角色 / 技能数据不完整） -->
      <div v-else class="placeholder">
        <div class="placeholder-title">无法计算</div>
        <div class="placeholder-desc">请确保队伍中至少有1名角色且技能数据完整</div>
      </div>

    </template>

    <!-- 合轴率调节弹窗 -->
    <n-modal v-model:show="showComboAlignModal" preset="card" title="合轴率调节" style="width: 900px; max-width: 95vw;">
      <div class="combo-align-modal-body">
        <n-text depth="3" style="font-size: 12px; display: block; margin-bottom: 12px">
          合轴率表示该招式动作时间中可与其他操作并行的比例。合轴时间内角色处于"非操作中"状态，触发非操作回能加成；
          合轴段不占三人共享时间轴 → 该部分时间回流平A池（全队必做动作因此可超出战斗总时长）。
          查看各招式的总时间和执行次数后，输入合适的合轴率（0-100%）。标「固定」的行由角色模块 / 引擎直写比例，这里不可改。
        </n-text>

        <n-tabs type="line" animated>
          <n-tab-pane
            v-for="charResult in resourceResult?.characters ?? []"
            :key="charResult.slot"
            :name="String(charResult.slot)"
            :tab="agentNames[charResult.agentId] || `槽${charResult.slot + 1}`"
          >
            <div class="combo-align-exec-list">
              <div
                v-for="exec in charResult.executions.filter(e => e.actionTime > 0)"
                :key="exec.moveId"
                class="combo-align-exec-row"
              >
                <div class="combo-align-exec-info">
                  <span class="combo-align-exec-name">{{ exec.moveName.replace(/（.*）/g, '').trim() }}</span>
                  <n-text depth="3" style="font-size: 11px">
                    {{ exec.count > 0 ? `${exec.count}次` : '平A' }} · 单次{{ exec.actionTime.toFixed(2) }}s · 总{{ exec.totalTime.toFixed(1) }}s
                  </n-text>
                </div>
                <div class="combo-align-exec-control">
                  <n-slider
                    :value="exec.comboAlignRatio * 100"
                    :disabled="!comboAlignEditable(exec)"
                    :min="0"
                    :max="100"
                    :step="5"
                    style="width: 200px"
                    @update:value="v => setComboAlignRatio(charResult.slot, exec.moveId, v / 100)"
                  />
                  <n-input-number
                    :value="Math.round(exec.comboAlignRatio * 100)"
                    :disabled="!comboAlignEditable(exec)"
                    :min="0"
                    :max="100"
                    size="small"
                    style="width: 80px"
                    @update:value="v => setComboAlignRatio(charResult.slot, exec.moveId, (v ?? 0) / 100)"
                  >
                    <template #suffix>%</template>
                  </n-input-number>
                  <span class="combo-align-time-display">
                    合轴{{ exec.totalComboAlignTime.toFixed(1) }}s
                  </span>
                  <!-- 「固定」分三种原因（用户口径 2026-10-16「很多是固定的不让调，我不知道为什么」）：
                       引擎记账行 / 赠送行 / 机制行——理由不同故分别显示，不再统一一个「固定」。 -->
                  <n-text
                    v-if="comboAlignFixedReasonOf(exec)"
                    depth="3" style="font-size: 11px"
                    :title="comboAlignFixedHintOf(exec)"
                  >{{ comboAlignFixedLabelOf(exec) }}</n-text>
                </div>
              </div>
            </div>

            <div class="combo-align-summary">
              <n-text depth="2" style="font-size: 12px">
                总合轴时间: {{ totalComboAlignTimeOf(charResult).toFixed(1) }}s
              </n-text>
            </div>
          </n-tab-pane>
        </n-tabs>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
/**
 * **结果页 = 资源池视图的参照面**（T188，2026-11-03）。
 *
 * 本页只负责「页面级」的东西：全局参数栏 · 计算状态（三层不动点）· 最终面板 · 合轴率调节弹窗。
 * **资源页那一整套**（池摘要 / 失衡池 / 轴窗卡 / 异常池 / 虚拟面板 / 异常事件 / 特殊动作 /
 * 队伍总览 / 伤害占比 / 伤害来源 / 伤害池 / 三角色资源卡）已抽成共享组件
 * `components/ResourcePoolView.vue`，本页与各比较入口**喂同一个档位快照**进来——单一事实源。
 *
 * 判据：`src/composables/__tests__/resourcePoolView.test.ts`（快照构造 + 三态 + 派生的确定性）。
 */
import { computed, ref } from 'vue'
import {
  NCard, NGrid, NGi, NInputNumber, NAlert, NIcon,
  NButton, NModal, NTabs, NTabPane, NSlider, NText,
} from 'naive-ui'
import { PeopleOutline } from '@vicons/ionicons5'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { fmt } from '@/utils/format'
import ResourcePoolView from '@/components/ResourcePoolView.vue'
import FinalPanel from '@/components/FinalPanel.vue'
import { resourcePoolSnapshotFromCalc } from '@/composables/resourcePoolView'
import { comboAlignEditable, comboAlignFixedHint, comboAlignFixedLabel, comboAlignFixedReason, totalComboAlignTimeOf } from '@/composables/resourceCalc/comboAlignDisplay'

const configStore = useConfigStore()
const calc = useResourceCalc()
/**
 * 页面级读数（**只剩页面自己用的那几个**）：状态卡的失衡次数、合轴率弹窗的角色名单、
 * 最终面板的三张覆盖率表。资源块的读数一律由快照进共享视图，不再在这里解构。
 */
const {
  resourceResult,
  stunPoolResult,
  agentNames,
  effectiveWEngineCoverages,
  effectiveDiscEffectCoverages,
  effectiveTeammateBuffCoverages,
} = calc

/**
 * **资源池共享视图的入参**：一个档位快照 = **当前 UI 现场**这一档的读数。
 *
 * 构造走唯一入口 `resourcePoolSnapshotFromCalc`（读 `useResourceCalc` 的既有 .value 读数，
 * 与原先逐块渲染读的是**同一批 computed** ⇒ 零重算）；比较入口在它们自己的**重放场景**里调同一个函数
 * ⇒ 两个入口喂进视图的是同一种东西。
 */
const poolSnapshot = computed(() => resourcePoolSnapshotFromCalc(calc, configStore))

/** 是否有队伍数据 */
const hasTeam = computed(() => configStore.team.some(c => c.agentId))

/**
 * 三层不动点是否都健康落地（只报内层「已收敛」会掩盖外层耗尽上限的情况）。
 * `cycle` 视为正常兜底（离散场景取循环中一支），只有真·未收敛才转黄。
 */
const convergenceOk = computed(() => {
  const r = resourceResult.value
  if (!r) return true
  const c = r.convergence
  return r.converged
    && c.timeBudgetConverged
    && (c.outerExit === undefined || c.outerExit !== 'maxIter')
})

/** 全队弹刀/闪避反击总次数（per-character 求和）——**输入侧**配置值，只给参数区只读框用 */
const totalParryCount = computed(() =>
  configStore.team.reduce((sum, c) => sum + (c.parryCount ?? 0), 0),
)
const totalDodgeCount = computed(() =>
  configStore.team.reduce((sum, c) => sum + (c.dodgeCounterCount ?? 0), 0),
)

// ============ 合轴率调节弹窗 ============

const showComboAlignModal = ref(false)
/** 「固定」行的原因（三种：引擎记账 / 赠送 / 机制）——弹窗里按原因给标签与 hover 说明 */
const comboAlignFixedReasonOf = (exec: Parameters<typeof comboAlignFixedReason>[0]) => comboAlignFixedReason(exec)
const comboAlignFixedLabelOf = (exec: Parameters<typeof comboAlignFixedReason>[0]) => {
  const r = comboAlignFixedReason(exec)
  return r ? comboAlignFixedLabel(r) : ''
}
const comboAlignFixedHintOf = (exec: Parameters<typeof comboAlignFixedReason>[0]) => {
  const r = comboAlignFixedReason(exec)
  return r ? comboAlignFixedHint(r) : ''
}

/** 设置某角色某招式的合轴率（写侧：用户覆盖；模块行直写的比例不受覆盖影响） */
function setComboAlignRatio(slot: number, moveId: string, ratio: number) {
  configStore.setComboAlignOverride(slot, moveId, ratio)
}
</script>

<style scoped src="./resultPage/result-page.css"></style>
