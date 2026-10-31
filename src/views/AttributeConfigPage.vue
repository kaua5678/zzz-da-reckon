<template>
  <div class="attribute-config-page">
    <n-grid :cols="2" :x-gap="16">
      <!-- 左侧：Boss 选择 + 敌人配置 + 队友 Buff 配置 -->
      <n-gi>
        <n-space vertical :size="16">
          <BossSelectCard />
          <n-card title="敌人配置" size="small" :bordered="true">
            <div class="formula-note" style="margin-bottom: 8px">
              默认值 = <b>自由训练模式木桩</b>（Dead End Butcher 改版）：血量 33.47 亿 / 失衡 17582.7 / 防御 952.8 /
              异常条系数 1.25 / <b>无抗性、无弱点、无关卡与 Boss buff</b> —— 中性测试场，不携带任何一期危局环境。
              要打具体 Boss 请用上方「Boss 选择」的「应用此 Boss」。
            </div>
            <n-space vertical :size="10">
              <n-grid cols="2" :x-gap="8" :y-gap="8">
                <n-gi v-for="f in ENEMY_FIELDS_HEAD" :key="f.key">
                  <div class="field">
                    <span class="field-label">{{ f.label }}</span>
                    <n-input-number
                      :value="configStore.enemy[f.key]"
                      :min="0"
                      :max="f.maxKey ? configStore.enemy[f.maxKey] : undefined"
                      :step="f.step ?? 1"
                      size="small"
                      style="width: 100%"
                      @update:value="v => setEnemyNumber(f, v)"
                    />
                  </div>
                </n-gi>
                <n-gi>
                  <div class="field">
                    <span class="field-label">敌方体型</span>
                    <n-select
                      :value="configStore.enemy.bodySize"
                      :options="[
                        { label: '大型（剑气6段）', value: 'large' },
                        { label: '中型（剑气3段）', value: 'medium' },
                        { label: '小型（剑气0段）', value: 'small' },
                      ]"
                      size="small"
                      style="width: 100%"
                      @update:value="v => configStore.setEnemy({ bodySize: v ?? 'large' })"
                    />
                  </div>
                </n-gi>
                <n-gi v-for="f in ENEMY_FIELDS_TAIL" :key="f.key">
                  <div class="field">
                    <span class="field-label">{{ f.label }}</span>
                    <n-input-number
                      :value="configStore.enemy[f.key]"
                      :min="0"
                      :max="f.maxKey ? configStore.enemy[f.maxKey] : undefined"
                      :step="f.step ?? 1"
                      size="small"
                      style="width: 100%"
                      @update:value="v => setEnemyNumber(f, v)"
                    />
                  </div>
                </n-gi>
              </n-grid>

              <div class="field">
                <span class="field-label">有效时间 (秒) = 战斗时间 − 无敌时间</span>
                <n-input-number
                  :value="configStore.effectiveTime"
                  disabled
                  size="small"
                  style="width: 100%"
                />
              </div>

              <n-divider style="margin: 4px 0" />

              <n-text depth="3" style="font-size: 12px; font-weight: 600">元素抗性 (%)</n-text>
              <div class="formula-note">
                仅 6 个常规元素有抗性区；辉光/流明不配置抗性。抗性乘区不设上限，弱点可填负数。
              </div>
              <div v-for="group in resistanceGroups" :key="group.key" class="resistance-group">
                <n-text depth="3" class="resistance-title">{{ group.label }}</n-text>
                <n-grid cols="3" :x-gap="8" :y-gap="8">
                  <n-gi v-for="el in resistanceElements" :key="`${group.key}-${el.key}`">
                    <div class="field">
                      <span class="field-label">{{ el.label }}</span>
                      <n-input-number
                        :value="getResistance(group.key, el.key)"
                        :min="-999"
                        :max="999"
                        :step="5"
                        size="small"
                        style="width: 100%"
                        @update:value="v => configStore.setResistance(group.key, el.key, v ?? 0)"
                      />
                    </div>
                  </n-gi>
                </n-grid>
              </div>
            </n-space>
          </n-card>

          <!-- 队友 Buff 配置 -->
          <n-card size="small" :bordered="true">
            <template #header>
              <n-space align="center" justify="space-between" style="width: 100%">
                <span>队友 Buff 配置</span>
                <n-input
                  v-model:value="teammateBuffSearch"
                  size="tiny"
                  placeholder="搜索 buff..."
                  clearable
                  style="width: 160px"
                />
              </n-space>
            </template>

            <div v-if="catalogStore.teammateBuffsLoading" class="teammate-loading">
              加载中...
            </div>

            <n-alert v-else-if="catalogStore.teammateBuffsStatus === 'error'" type="error" title="队友 Buff 加载失败">
              <p>{{ catalogStore.teammateBuffsError }}。完整计算已暂停，不使用缺失 Buff 的结果。</p>
              <n-button size="small" @click="catalogStore.loadTeammateBuffs()">重试加载</n-button>
            </n-alert>

            <div v-else-if="!catalogStore.teammateBuffsReady" class="teammate-empty">
              队友 Buff 数据尚未加载。
              <n-button size="small" @click="catalogStore.loadTeammateBuffs()">加载数据</n-button>
            </div>

            <div v-else-if="teammateBuffGroups.length === 0" class="teammate-empty">
              暂无队友 Buff 数据
            </div>

            <n-collapse v-else :default-expanded-names="[]">
              <n-collapse-item :title="teammateBuffSummary" name="teammate-buffs">
                <div class="teammate-buff-list">
              <n-collapse v-for="group in filteredGroups" :key="group.id">
                <n-collapse-item :title="groupName(group)" :name="group.id">
                  <div class="buff-item-list">
                    <div
                      v-for="buff in group.buffs"
                      :key="buff.id"
                      class="buff-item"
                      :class="{
                        enabled: isInteractive(buff) && configStore.isTeammateBuffEnabled(buff.id),
                        'declared-only': !isInteractive(buff),
                      }"
                    >
                      <div class="buff-item-header">
                        <n-checkbox
                          v-if="isInteractive(buff)"
                          :checked="configStore.isTeammateBuffEnabled(buff.id)"
                          size="small"
                          @update:checked="v => configStore.toggleTeammateBuff(buff.id, v)"
                        />
                        <span class="buff-item-name">{{ buffName(buff) }}</span>
                        <!-- 仅声明行：数值已由角色模块/helpers 单通道接入，本条不产生独立数值
                             ⇒ 不给拨不动的 checkbox/滑块（R65 §R64-J1：可点但无任何数值效果 = 缺陷） -->
                        <n-tag v-if="!isInteractive(buff)" size="tiny" :bordered="false" class="declared-only-tag">
                          数值已接入
                        </n-tag>
                      </div>
                      <div class="buff-item-effects">
                        <span
                          v-for="effect in buff.effects"
                          :key="effect.id"
                          class="effect-tag"
                        >
                          {{ effectLabel(effect) }}
                        </span>
                      </div>
                      <div v-if="buff.description" class="buff-item-desc">
                        {{ buffDesc(buff) }}
                      </div>
                      <div v-if="!isInteractive(buff)" class="buff-item-desc declared-only-note">
                        {{ declaredOnlyReason(buff) }}
                      </div>
                      <div
                        v-if="isInteractive(buff) && configStore.isTeammateBuffEnabled(buff.id) && hasCoverage(buff)"
                        class="buff-item-coverage"
                      >
                        <span class="coverage-label">覆盖率</span>
                        <n-slider
                          :value="configStore.getTeammateBuffCoverage(buff.id)"
                          :min="0"
                          :max="100"
                          :step="5"
                          size="small"
                          style="flex: 1"
                          @update:value="v => configStore.setTeammateBuffCoverage(buff.id, v)"
                        />
                        <span class="coverage-value">
                          {{ configStore.getTeammateBuffCoverage(buff.id) }}%
                        </span>
                      </div>
                    </div>
                  </div>
                </n-collapse-item>
              </n-collapse>
                </div>
              </n-collapse-item>
            </n-collapse>
          </n-card>
        </n-space>
      </n-gi>

      <!-- 右侧：危局环境 Buff（按期数）→ 全局 Buff 表 -->
      <n-gi>
        <!-- 危局期数的环境 buff（用户 2026-10-26：「右边是自创buff，没看到危局期数的环境buff」）：
             期数 → 当期可选牌（selectable_buff，3 选 1）+ 已应用 Boss 的关卡固有 buff（layer_buff，只读状态）。
             牌 → 行的唯一映射 = utils/phaseBuff#phaseBuffRows，写入唯一入口 = runArchiveDeploy#applyPeriodBuff
             （与实战对比部署页同一条通道 ⇒ 两个页面写出来的行逐位相同，cond 随行由管线按当前队伍解析）。 -->
        <n-card size="small" :bordered="true" class="env-card">
          <template #header>
            <n-space align="center" justify="space-between" style="width: 100%">
              <span>危局环境 Buff</span>
              <n-select
                :value="envPhaseId"
                :options="envPhaseOptions"
                size="tiny"
                filterable
                style="width: 210px"
                placeholder="选期数"
                @update:value="envPhase.pick"
              />
            </n-space>
          </template>

          <div v-if="environment === null" class="env-empty">
            该期没有环境 buff 数据（期视图缺失）—— 换一期，或先跑 <code>npm run import</code> 补期视图。
          </div>

          <template v-else>
            <!-- 当期可选牌（3 选 1） -->
            <div class="env-section">
              <div class="env-section-head">
                <span class="env-section-title">当期可选牌（{{ environment.selectable.length }} 选 1）</span>
                <n-button
                  size="tiny"
                  :type="selectedPeriodTitle === NONE_CARD ? 'primary' : 'default'"
                  @click="pickEnvironmentCard(null)"
                >
                  不用
                </n-button>
                <span v-if="periodRowCount > 0 && selectedPeriodTitle === null" class="env-warn">
                  表里有 {{ periodRowCount }} 行当期牌，但不对应下面任何一张（可能来自别的页面的旧口径）
                </span>
              </div>
              <div v-if="environment.selectable.length === 0" class="env-empty">
                该期没有可选牌（未解析 / 测试服占位）
              </div>
              <div v-else class="env-grid">
                <button
                  v-for="card in environment.selectable"
                  :key="card.title"
                  type="button"
                  class="env-card-btn"
                  :class="{ active: selectedPeriodTitle === card.title }"
                  :title="card.effects.map(phaseEffectLabel).join('；') || card.unparsed.join('；')"
                  @click="pickEnvironmentCard(card)"
                >
                  <span class="env-card-title">{{ phaseBuffCardLabel(card) }}</span>
                  <span class="env-card-effects">
                    <span v-for="e in card.effects" :key="e.stat + ':' + e.value" class="effect-tag">{{ phaseEffectLabel(e) }}</span>
                    <span v-for="(u, i) in card.unparsed" :key="'u' + i" class="effect-tag unparsed" :title="u">未解析：{{ u.slice(0, 20) }}…</span>
                  </span>
                </button>
              </div>
              <div class="env-hint">
                选牌 = 写入全局 Buff 表（前缀 <code>period-buff:</code>，先清旧再写）；条件效果按**当前队伍**判定，
                换人自动换档（与「队伍对比 / 实战对比」同一条通道）。
              </div>
            </div>

            <!-- 已应用 Boss 的关卡固有 buff（只读：由「应用 Boss」写入，不在这里重复写） -->
            <div class="env-section">
              <div class="env-section-head">
                <span class="env-section-title">关卡固有 Buff（layer_buff）</span>
                <n-tag v-if="environment.layer" size="tiny" :bordered="false" :type="layerApplied ? 'success' : 'default'">
                  {{ environment.layer.bossName }} · {{ layerApplied ? '已写入全局 Buff 表' : '尚未写入（点上方 Boss 卡的「应用此 Boss」）' }}
                </n-tag>
              </div>
              <div v-if="!environment.layer" class="env-empty">
                本期还没有应用 Boss —— 在左上「Boss 选择」里点「应用此 Boss」，关卡固有 buff 会自动进全局 Buff 表。
              </div>
              <div v-else-if="environment.layer.cards.length === 0" class="env-empty">
                该 Boss 本期没有关卡固有 buff。
              </div>
              <div v-else class="env-grid">
                <div v-for="(card, i) in environment.layer.cards" :key="i" class="env-card-btn static">
                  <span class="env-card-title">{{ card.title || '(未命名)' }}</span>
                  <span class="env-card-effects">
                    <span v-for="e in card.effects" :key="e.stat + ':' + e.value" class="effect-tag">{{ phaseEffectLabel(e) }}</span>
                    <span v-for="(u, j) in card.unparsed" :key="'lu' + j" class="effect-tag unparsed" :title="u">未解析：{{ u.slice(0, 20) }}…</span>
                  </span>
                </div>
              </div>
            </div>
          </template>
        </n-card>

        <n-card size="small" :bordered="true" style="margin-top: 16px" class="global-card">
          <template #header>
            <n-space align="center" justify="space-between" style="width: 100%">
              <span>全局 Buff（自创）</span>
              <n-button size="tiny" type="primary" @click="configStore.addGlobalBuff()">
                添加 Buff
              </n-button>
            </n-space>
          </template>

          <div class="buff-table-wrapper">
            <table class="buff-table">
              <thead>
                <tr>
                  <th style="width: 36px">启用</th>
                  <th style="min-width: 80px">名称</th>
                  <th style="min-width: 110px">属性</th>
                  <th style="width: 110px">目标招式</th>
                  <th style="width: 80px">数值</th>
                  <th style="width: 36px"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="buff in configStore.globalBuffs" :key="buff.id">
                  <td class="col-center">
                    <n-switch
                      :value="buff.enabled"
                      size="small"
                      @update:value="v => configStore.updateGlobalBuff(buff.id, { enabled: v })"
                    />
                  </td>
                  <td>
                    <n-input
                      :value="buff.name"
                      size="tiny"
                      placeholder="名称"
                      @update:value="v => configStore.updateGlobalBuff(buff.id, { name: v })"
                    />
                    <div v-if="buff.cond" class="target-muted" title="危局 buff 牌条件：按当前队伍判定，不满足时本行不生效">{{ phaseBuffCondLabel(buff.cond) }}</div>
                  </td>
                  <td>
                    <n-select
                      :value="buff.stat"
                      :options="statOptions"
                      size="tiny"
                      filterable
                      @update:value="v => configStore.updateGlobalBuff(buff.id, { stat: v })"
                    />
                  </td>
                  <td>
                    <n-select
                      v-if="buff.stat === 'skillDmgBonus'"
                      :value="buff.targetSkillType ?? 'all'"
                      :options="skillDmgTargetOptions"
                      size="tiny"
                      @update:value="v => configStore.updateGlobalBuff(buff.id, { targetSkillType: v })"
                    />
                    <span v-else class="target-muted">全局</span>
                  </td>
                  <td>
                    <n-input-number
                      :value="buff.value"
                      size="tiny"
                      :min="-9999"
                      style="width: 100%"
                      @update:value="v => configStore.updateGlobalBuff(buff.id, { value: v ?? 0 })"
                    />
                  </td>
                  <td class="col-center">
                    <n-button
                      size="tiny"
                      text
                      type="error"
                      @click="configStore.removeGlobalBuff(buff.id)"
                    >
                      删除
                    </n-button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="configStore.globalBuffs.length === 0" class="empty-buffs">
            暂无 Buff，点击上方按钮添加
          </div>
        </n-card>
      </n-gi>
    </n-grid>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import {
  NCard, NSpace, NGrid, NGi, NInputNumber, NText, NDivider,
  NButton, NSwitch, NInput, NSelect, NCheckbox, NCollapse, NCollapseItem,
  NSlider, NTag, NAlert,
} from 'naive-ui'
import { useConfigStore, type EnemyConfig } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { useStatLabel } from '@/composables/useStatLabel'
import { getGlobalBuffStatOptions } from '@/utils/statMeta'
import { localized } from '@/utils/format'
import { damageElementLabel } from '@/utils/agentLabelMaps'
import { STANDARD_ENEMY_DEBUFF_ELEMENTS, type StandardEnemyDebuffElement } from '@/utils/enemyDebuffStats'
import { SKILL_DMG_TARGETS, SKILL_DMG_TARGET_LABELS } from '@/data/skillDamageTargets'
import { isTeammateBuffInteractive, declaredOnlyReason } from '@/utils/teammateBuffRows'
import {
  phaseBuffCondLabel, resolvePhaseEnvironment, sortedPhaseViews,
  selectedPeriodBuffCard, periodBuffRowsOf, layerBuffRowsOf, phaseBuffCardLabel,
} from '@/utils/phaseBuff'
import { applyPeriodBuff } from '@/composables/runArchiveDeploy'
import { usePhaseSelection } from '@/composables/phaseSelection'
import { bossBuffEffectLabel } from '@/utils/bossEffectLabel'
import BossSelectCard from '@/components/BossSelectCard.vue'
import type { TeammateBuffGroup, TeammateBuff, BuffEffect } from '@/types/catalog'
import type { BossPresetFile, PhaseBuffCard } from '@/types/bossPreset'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
const { statLabel, formatStatValue } = useStatLabel()

const teammateBuffSearch = ref('')

onMounted(() => {
  if (catalogStore.teammateBuffsStatus === 'idle') void catalogStore.loadTeammateBuffs()
  // 环境 buff 卡的数据源（期视图 = boss-presets.json 的 phaseViews）。
  // 与 BossSelectCard 共用 catalogStore#loadBossPresets（同一份缓存，不各 fetch 一份）。
  void catalogStore.loadBossPresets().catch(() => { /* 失败由卡片显示空态，不阻断本页其余输入 */ })
})

/**
 * 敌人配置的数值输入框：按显示顺序列出（体型下拉在 HEAD 与 TAIL 之间）。
 * fallback = 清空输入框时写回的值（系数类为 1，其余为 0）；step 缺省 1；maxKey = 上限取另一个敌人字段的当前值，缺省不限。
 * 新增一个敌人数值字段 = 在这里加一行（CC-282 前每个字段是一段 11 行的手写模板）。
 */
type EnemyNumberKey = { [K in keyof EnemyConfig]-?: EnemyConfig[K] extends number ? K : never }[keyof EnemyConfig]
interface EnemyNumberField { key: EnemyNumberKey; label: string; step?: number; maxKey?: EnemyNumberKey; fallback: number }
const ENEMY_FIELDS_HEAD: EnemyNumberField[] = [
  { key: 'hp', label: 'Boss 血量', fallback: 0 },
  { key: 'stunValue', label: '失衡值', fallback: 0 },
  { key: 'stunTime', label: '失衡时间 (秒)', step: 0.5, fallback: 0 },
  { key: 'stunVuln', label: '失衡易伤倍率', step: 0.1, fallback: 1 },
  { key: 'defense', label: '怪物防御', step: 50, fallback: 0 },
]
const ENEMY_FIELDS_TAIL: EnemyNumberField[] = [
  { key: 'anomalyCoeff', label: '异常条系数', step: 0.1, fallback: 1 },
  { key: 'bossAnomalyCoeff', label: '危局异常系数', step: 0.1, fallback: 1 },
  { key: 'bossStunGift', label: 'Boss 赠送失衡', fallback: 0 },
  { key: 'shieldCount', label: '秽盾数量', fallback: 0 },
  { key: 'energyShield', label: '能量盾数量', fallback: 0 },
  { key: 'invincibleTime', label: 'Boss 无敌时间 (秒)', maxKey: 'battleTime', fallback: 0 }, // 不超过战斗时间（与结果页同口径）
]
function setEnemyNumber(f: EnemyNumberField, v: number | null) {
  configStore.setEnemy({ [f.key]: v ?? f.fallback } as Partial<EnemyConfig>)
}

// CC-447：抗性格子的元素列表 = 引擎减抗所认的标准 6 元素（`STANDARD_ENEMY_DEBUFF_ELEMENTS`），中文名走 CC-214 单一来源；
// 原为页面手写 6 行 `{ key, label }`（CC-214 的源码锁正则 `physical:\s*'物理'` 匹配不到这种写法，本轮补洞）
const resistanceElements = STANDARD_ENEMY_DEBUFF_ELEMENTS.map(key => ({ key, label: damageElementLabel(key) }))

const resistanceGroups = [
  { key: 'damage' as const, label: '伤害抗性' },
  { key: 'stun' as const, label: '失衡抗性' },
  { key: 'anomaly' as const, label: '积蓄抗性' },
]

// 三张表都是 ResistanceTable（六键齐全，r756 CC-539），按 6 元素读不兜底
function getResistance(kind: 'damage' | 'stun' | 'anomaly', element: StandardEnemyDebuffElement): number {
  const enemy = configStore.enemy
  if (kind === 'damage') return enemy.damageResistances[element]
  if (kind === 'stun') return enemy.stunResistances[element]
  return enemy.anomalyResistances[element]
}

const statOptions = computed(() => getGlobalBuffStatOptions(catalogStore.statRules?.statDisplay))

const skillDmgTargetOptions = SKILL_DMG_TARGETS.map(value => ({
  value,
  label: SKILL_DMG_TARGET_LABELS[value],
}))

// ========== 危局环境 Buff（按期数） ==========
/**
 * 期数选择：缺省 = 最新一期；用户换期后保持。
 * "不用" 选项的哨兵 = NONE_CARD（naive 的 Select 不收 null，统一用字符串值）。
 */
const NONE_CARD = '__none__'
/**
 * 环境卡的期数：用户手选 ＞ **已应用 Boss 的房间相位** ＞ 最新一期（唯一实现 = composables/phaseSelection.ts）。
 *
 * 修前恒为「最新一期」⇒ 实战对比页部署哪一季都看不见：归档快照最新一季 = 690481，期视图最新一期 = 690501
 * （归档里一条 run 都没有）⇒ 本卡停在 690501，明明 store 里已写好 Boss 房间与 layer-buff 行，卡片却报
 * 「本期还没有应用 Boss」（用户 2026-10-29 实报「切到属性配置，部署的 Boss 和 buff 没有自动勾选」）。
 * 用响应式派生而非 onMounted 赋值：期视图与 appliedBoss 都是异步/随时可变的，派生自动跟上。
 */
const envPhase = usePhaseSelection(
  () => sortedPhaseViews(catalogStore.bossPresetFile as BossPresetFile | null).map(v => v.phaseId),
  () => configStore.appliedBoss?.phaseId,
)
const envPhaseId = envPhase.selected
const envPhaseOptions = computed(() => sortedPhaseViews(catalogStore.bossPresetFile as BossPresetFile | null)
  .map(v => ({ value: v.phaseId, label: `${v.label}（${v.phaseId}）` })))
const environment = computed(() => resolvePhaseEnvironment(
  catalogStore.bossPresetFile as BossPresetFile | null,
  configStore.appliedBoss,
  envPhaseId.value,
))
/** 表里某期当期牌的行（「当前选中」由全局 Buff 表派生，不另存一份状态） */
const periodRowCount = computed(() => periodBuffRowsOf(configStore.globalBuffs, envPhaseId.value).length)
const selectedPeriodTitle = computed<string | null>(() => {
  const cards = environment.value?.selectable ?? []
  const hit = selectedPeriodBuffCard(configStore.globalBuffs, envPhaseId.value, cards)
  if (hit) return hit.title
  return periodRowCount.value > 0 ? null : NONE_CARD
})
/** 关卡固有 buff 是否真的写进了表（判据 = 该 Boss 该期前缀的行存在；不猜「应用过就算」） */
const layerApplied = computed(() => {
  const layer = environment.value?.layer
  if (!layer) return false
  return layerBuffRowsOf(configStore.globalBuffs, layer.presetId, layer.phaseId).length > 0
})

/**
 * 选牌 / 不用：**唯一写入入口** = runArchiveDeploy#applyPeriodBuff（与实战对比部署页同一条通道）。
 * 传 null 或 `testOnly` 牌 = 清掉本期当期牌行（回到「不用」口径）。
 * ⚠ 这里**不做试算**（不读伤害）——「自动选最优」是 C 档用户口径（坑 53），页面只给明确写入动作。
 */
function pickEnvironmentCard(card: PhaseBuffCard | null) {
  applyPeriodBuff(configStore, envPhaseId.value, card)
}

/** 环境卡的效果标签：与 Boss 卡 / 期视图同一份（CC-214 单一来源；与队友 buff 的 effectLabel 不同域） */
function phaseEffectLabel(e: PhaseBuffCard['effects'][number]): string {
  return bossBuffEffectLabel(e)
}

/** 队友 Buff 卡折叠标题里的摘要（收起状态也要说清「有哪些、哪几条开着」） */
const teammateBuffSummary = computed(() => {
  const groups = filteredGroups.value
  const total = groups.reduce((n, g) => n + g.buffs.length, 0)
  const on = groups.reduce((n, g) => n + g.buffs.filter(b => isInteractive(b) && configStore.isTeammateBuffEnabled(b.id)).length, 0)
  const who = groups.map(g => groupName(g)).join('、')
  if (teammateBuffSearch.value.trim()) return `队友 Buff（搜索「${teammateBuffSearch.value}」：${total} 条 / 启用 ${on}）`
  return `队友 Buff（按队伍自动派生，通常不用看：${groups.length} 名角色 / ${total} 条，启用 ${on}）${who ? ' —— ' + who : ''}`
})

// ========== 队友 Buff ==========

const teammateBuffGroups = computed<TeammateBuffGroup[]>(() =>
  catalogStore.teammateBuffGroups ?? []
)

// 按搜索词过滤分组
const filteredGroups = computed(() => {
  const search = teammateBuffSearch.value.trim().toLowerCase()
  if (!search) return teammateBuffGroups.value
  return teammateBuffGroups.value
    .map(group => {
      const matchedBuffs = group.buffs.filter(buff => {
        const name = localized(buff.name, buff.sourceLabel?.zhCN ?? '')
        const desc = localized(buff.description)
        const groupName = localized(group.name)
        return name.toLowerCase().includes(search) ||
          desc.toLowerCase().includes(search) ||
          groupName.toLowerCase().includes(search)
      })
      if (matchedBuffs.length === 0) return null
      return { ...group, buffs: matchedBuffs }
    })
    .filter((g): g is TeammateBuffGroup => g !== null)
})

// 辅助：获取分组显示名
function groupName(group: TeammateBuffGroup): string {
  return localized(group.name, group.id)
}

// 辅助：获取 buff 显示名
function buffName(buff: TeammateBuff): string {
  if (buff.name?.zhCN) return buff.name.zhCN
  if (buff.name?.en) return buff.name.en
  if (buff.sourceLabel?.zhCN) return buff.sourceLabel.zhCN
  if (buff.sourceLabel?.en) return buff.sourceLabel.en
  return buff.id
}

// 辅助：获取 buff 描述
function buffDesc(buff: TeammateBuff): string {
  if (buff.description?.zhCN) return buff.description.zhCN
  if (buff.description?.en) return buff.description.en
  if (buff.conditionLabel?.zhCN) return buff.conditionLabel.zhCN
  if (buff.conditionLabel?.en) return buff.conditionLabel.en
  return ''
}

function formulaDefaultValue(effect: BuffEffect): string {
  const source = effect.source
  const expression = effect.formula?.expression ?? '公式'
  const sourceLabel = localized(source?.label, 'x')
  const defaultValue = source?.defaultValue
  return `${expression}${defaultValue != null ? `，${sourceLabel}=${defaultValue}` : ''}`
}

// 辅助：获取效果显示名
function effectLabel(effect: BuffEffect): string {
  const stat = `${statLabel(effect.stat)} (${effect.stat})`
  let valueStr = ''
  if (effect.type === 'fixed') {
    valueStr = formatStatValue(effect.stat, effect.value, effect.mode)
  } else if (effect.type === 'derived') {
    const source = localized(effect.sourceLabel, '某属性')
    const ratio = effect.ratio ?? 0
    const cap = effect.cap
    valueStr = `${source}的${ratio}%` + (cap ? ` (上限${cap})` : '')
  } else if (effect.type === 'stacked') {
    const perStack = effect.valuePerStack ?? effect.value
    const maxStacks = effect.maxStacks ?? effect.defaultStacks ?? 1
    valueStr = `每层${perStack}，最多${maxStacks}层`
  } else if (effect.type === 'formula') {
    valueStr = formulaDefaultValue(effect)
  }
  return `${stat} +${valueStr}`
}

// 辅助：判断 buff 是否有覆盖率设置
function hasCoverage(buff: TeammateBuff): boolean {
  return buff.effects.some(e => e.coverage && e.coverage.default !== undefined)
}

/**
 * 该条是否渲染为**可交互行**（checkbox + 覆盖率滑块）。
 * 单一事实源 = `src/utils/teammateBuffRows.ts`（纯函数，页面与判据同源）。
 *
 * 为什么不再无条件渲染控件：R65 §R64-J1 实测，`hidden`（现 `singleSourced`）条与
 * `effects: []` 的声明条在页面上都是「可点但拨了没反应」的控件（三态读数逐位相同）
 * —— 与「机制没做」同形，是面向用户的缺陷。数值既不在这里产生，就不该在这里给控件。
 */
function isInteractive(buff: TeammateBuff): boolean {
  return isTeammateBuffInteractive(buff)
}
</script>

<style scoped>
.attribute-config-page {
  width: 100%;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 11px;
  color: var(--wa-500);
}

.buff-table-wrapper {
  overflow-x: auto;
}

.buff-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.buff-table th {
  text-align: left;
  font-weight: 600;
  color: var(--wa-600);
  padding: 8px 6px;
  border-bottom: 1px solid var(--wa-80);
  font-size: 11px;
}

.buff-table td {
  padding: 6px;
  border-bottom: 1px solid var(--wa-40);
  vertical-align: middle;
}

.buff-table tbody tr:hover {
  background: var(--wa-20);
}

.col-center {
  text-align: center;
}

.formula-note {
  font-size: 11px;
  line-height: 1.5;
  color: var(--wa-450);
  margin-top: -2px;
}

.resistance-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.resistance-title {
  font-size: 12px;
  font-weight: 600;
}

.env-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.env-section + .env-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.env-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.env-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--app-text);
}

.env-warn {
  font-size: 11px;
  color: var(--c-warning);
}

.env-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

/* 可选牌 = 按钮（可点）；关卡固有 buff = 静态块（只读，不给控件） */
.env-card-btn {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--fill-active);
  color: var(--app-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease;
}

.env-card-btn:hover:not(.static):not(:disabled) {
  border-color: var(--line-strong);
  background: var(--fill-hover);
}

.env-card-btn.active {
  border-color: var(--app-primary);
  background: var(--c-success-soft);
}

.env-card-btn.static {
  cursor: default;
}

.env-card-btn.disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.env-card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--app-text);
}

.env-tag {
  font-size: 10px;
  color: var(--c-warning);
}

.env-card-effects {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.env-card-effects .effect-tag {
  font-size: 11px;
  padding: 1px 6px;
  line-height: 1.4;
}

/* 语义底用 --c-*-strong（UI_THEME_GUIDE §5 口诀）：贴片墨按贴片底选，不借页面底口径的 --fg-3 */
.env-card-effects .effect-tag.unparsed {
  background: var(--c-warning-soft);
  color: var(--c-warning-strong);
}

.env-hint,
.env-empty {
  font-size: 11px;
  line-height: 1.5;
  color: var(--fg-3);
}

.env-empty {
  padding: 8px 0;
}

.target-muted {
  font-size: 11px;
  color: var(--wa-350);
}

.empty-buffs {
  text-align: center;
  padding: 30px 0;
  color: var(--wa-300);
  font-size: 13px;
}

/* 队友 Buff 列表 */
.teammate-loading,
.teammate-empty {
  text-align: center;
  padding: 30px 0;
  color: var(--wa-300);
  font-size: 13px;
}

.teammate-buff-list {
  max-height: 500px;
  overflow-y: auto;
  margin: -8px -12px;
  padding: 0 4px;
}

.buff-item-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0 8px;
}

.buff-item {
  background: var(--wa-20);
  border: 1px solid var(--wa-60);
  border-radius: 6px;
  padding: 8px 10px;
  transition: all 0.2s ease;
}

.buff-item.enabled {
  background: rgba(59, 130, 246, 0.06);
  border-color: rgba(59, 130, 246, 0.2);
}

/* 仅声明行（数值由模块单通道接入）：不给控件，样式弱化以示「不可拨」 */
.buff-item.declared-only {
  border-style: dashed;
  background: transparent;
}

.declared-only-tag {
  flex-shrink: 0;
  font-size: 10px;
}

/* 颜色继承自 .buff-item-desc（避免新增 --wa-* 直接引用 —— 令牌棘轮要求新代码优先语义别名） */
.declared-only-note {
  font-style: italic;
}

.buff-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.buff-item-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--wa-900);
  flex: 1;
}

.buff-item-effects {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}

.effect-tag {
  font-size: 11px;
  padding: 2px 6px;
  background: var(--c-success-soft);
  color: var(--c-success);
  border-radius: 4px;
  line-height: 1.4;
}

.buff-item-desc {
  font-size: 11px;
  color: var(--wa-400);
  line-height: 1.5;
  margin-top: 2px;
}

.buff-item-coverage {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--wa-50);
}

.coverage-label {
  font-size: 11px;
  color: var(--wa-500);
  width: 40px;
  flex-shrink: 0;
}

.coverage-value {
  font-size: 11px;
  color: var(--wa-700);
  width: 36px;
  text-align: right;
  flex-shrink: 0;
}
</style>
