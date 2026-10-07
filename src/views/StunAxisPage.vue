<template>
  <div class="sap-root">
    <div v-if="!hasTeam" class="placeholder">请先配置队伍</div>
    <template v-else>
      <div class="sap-topbar">
        <n-switch v-model:value="useAxes" /> <span class="sap-top-label">启用失衡轴</span>
        <n-switch v-model:value="configStore.autoYidhariAxis" size="small" style="margin-left:12px" />
        <span class="sap-top-label">自动轴（预设队伍匹配到预设失衡轴即自动选用）</span>
        <n-button size="small" @click="addAxis" style="margin-left:12px">+ 新建轴</n-button>
        <n-button size="small" type="info" ghost @click="exportPreset" style="margin-left:8px">导出预设</n-button>
      </div>

      <!-- 通用自动轴状态（队伍匹配到预设失衡轴即自动选用） -->
      <div class="sap-plan-banner" v-if="autoPreset || hasChapterOwner">
        <template v-if="autoActive && autoPreset">
          <span class="sap-plan-label">自动轴</span>
          <span class="sap-plan-name">{{ autoPreset.name }}</span>
          <span class="sap-plan-note">{{ autoPresetNote }}；手动应用预设/捏轴后自动让路</span>
        </template>
        <template v-else-if="configStore.autoYidhariAxis && !hasManualAxes">
          <span class="sap-plan-label">自动轴</span>
          <span class="sap-plan-name">未命中预设</span>
          <span class="sap-plan-note">当前队伍没有匹配的预设失衡轴{{ hasChapterOwner ? `（${autoChapterLabel}·${autoLiuyinLabel}）` : '' }}；给队伍捏轴并导出预设后自动生效</span>
        </template>
        <template v-else-if="!configStore.autoYidhariAxis">
          <span class="sap-plan-label">自动轴</span>
          <span class="sap-plan-name">已关闭</span>
          <span class="sap-plan-note">可重新开启上方开关；手动轴不受影响</span>
        </template>
      </div>

      <!-- 条件轴方案命中提示 -->
      <div class="sap-plan-banner" v-if="hasPlans && useAxes">
        <span class="sap-plan-label">条件轴方案</span>
        <span class="sap-plan-name">{{ matchedPlanName || '解析中…' }}</span>
        <span class="sap-plan-note">按失衡次数 + 好评（摇人值）自动选择，下方为命中方案的轴</span>
      </div>

      <!-- 预设轴 -->
      <div class="sap-presets" v-if="matchedPresets.length > 0">
        <div class="sap-section-title">预设轴（当前队伍命中，一键应用）</div>
        <div v-for="p in matchedPresets" :key="p.id" class="sap-preset-row">
          <n-button size="tiny" type="primary" ghost @click="applyPreset(p)">应用</n-button>
          <span class="sap-preset-name">{{ p.name }}</span>
          <span v-if="p.note" class="sap-preset-note">{{ p.note }}</span>
        </div>
      </div>

      <!-- 动作池 -->
      <div class="sap-pool" v-if="useAxes">
        <div class="sap-section-title">动作池（点击追加到当前轴，按槽位进对应平行道）</div>
        <div v-for="s in [0,1,2]" :key="s" class="sap-slot-row">
          <span class="sap-slot-name">{{ agentName(s) }}</span>
          <span v-for="act in slotMoves(s)" :key="act.key" class="sap-chip" :class="{ dim: act.remaining<=0 }"
            @click="addToCurrentAxis(s, act.moveId, act.promoteVariant, act.sourceTag)" :title="act.label+' 剩'+fmt(act.remaining, 1)">
            {{ act.label }} ×{{ fmt(Math.max(0, act.remaining), 1) }}
          </span>
        </div>
      </div>

      <!-- 轴列表 -->

      <!-- CC-448：专属窗口 lane 说明条（模块声明 axisWindowLane.banner；原般岳 / 仪玄各一段写死文案） -->
      <div v-for="lane in windowLanes" :key="'banner-' + lane.decl.kind" class="sap-mw-banner">{{ lane.decl.banner(lane.ctx) }}</div>
      <div class="sap-axes" v-if="useAxes">
        <div v-for="(axis, ai) in axes" :key="ai" class="sap-axis">
          <div class="sap-axis-head">
            <n-input :value="axis.name" @update:value="v => editAxis(ai, a => { a.name = v })" size="small" style="width:130px" placeholder="轴名" />
            <span class="sap-label">×</span>
            <n-input-number :value="axis.count" @update:value="v => editAxis(ai, a => { a.count = v ?? undefined })" size="small" :min="0" :max="20" style="width:60px" :placeholder="'兜底'" />
            <span class="sap-label">次（空=兜底）</span>
            <span class="sap-label">兜底平A</span>
            <n-select :value="fillerValue(ai)" @update:value="v => setFiller(ai, v)" size="small" style="width:110px" :options="fillerOptions" />
            <span class="sap-label">初始状态</span>
            <n-select :value="axis.entryAnomaly ?? 0" size="small" style="width:96px" :options="entryAnomalyOptions"
              :disabled="hasPlans" :title="hasPlans ? '条件轴方案模式下只读' : undefined"
              @update:value="v => setEntryAnomaly(ai, v ?? 0)" />
            <span class="sap-label">异常条</span>
            <template v-for="el in entryBarList(axis)" :key="el">
              <span class="sap-label">{{ entryBarLabel(el) }}</span>
              <n-input-number :value="axis.entryBars?.[el] ?? 0" size="small" style="width:92px"
                :min="0" :max="100" :step="10" suffix="%" :disabled="hasPlans"
                @update:value="v => setEntryBar(ai, el, v)" />
            </template>
            <n-select
              v-if="!hasPlans && entryBarCandidates(axis).length > 0"
              size="small" style="width:86px" placeholder="+异常条"
              :options="entryBarCandidates(axis).map(el => ({ label: entryBarLabel(el), value: el }))"
              @update:value="v => v && addEntryBar(ai, String(v))"
            />
            <n-button size="tiny" quaternary type="warning" @click="removeAxis(ai)">删除</n-button>
            <span class="sap-stat">实际 ×{{ fmt(axisResult?.axisDetails?.[ai]?.times, 1) }} 次 · 单轮 {{ (axisResult?.axisDetails?.[ai]?.axisDuration ?? 0).toFixed(1) }}s · 窗口 {{ fmt(maxDur, 1) }}s</span>
          </div>

          <!-- 三槽平行时间轴（合轴：各角色独立道，可拖拽 startTime） -->
          <div class="sap-timeline"
            @pointermove="onTimelineMove($event, ai)" @pointerup="endDrag" @pointerleave="endDrag">
            <div class="sap-ticks">
              <div v-for="t in ticks" :key="t" class="sap-tick" :style="{ left: pct(t) }">
                <span class="sap-tick-label">{{ t }}s</span>
              </div>
            </div>
            <div class="sap-window-bar">
              <span class="sap-win-label">失衡窗口 {{ fmt(maxDur, 1) }}s</span>
            </div>
            <div v-for="s in [0,1,2]" :key="s" class="sap-lane" :style="{ top: laneTop(s) }">
              <span class="sap-lane-name">{{ agentName(s) }}</span>
            </div>
            <!-- CC-448：专属窗口平行道（限时 buff 可视化）：模块声明 axisWindowLane 驱动的泛型渲染；触发块处画 windowSeconds 窗口条，满覆盖铺满 -->
            <div v-for="lane in windowLanes" :key="'lane-' + lane.decl.kind" class="sap-lane sap-mw-lane" :style="{ top: lane.top }">
              <span class="sap-lane-name">{{ lane.decl.name }}</span>
              <div v-if="lane.full" class="sap-mw-window mw-full" style="left:0;width:100%">{{ lane.full }}</div>
              <template v-else>
                <div v-for="w in laneWindowsFor(lane, ai)" :key="w.key" class="sap-mw-window" :class="w.cls"
                  :style="{ left: w.leftPct + '%', width: w.widthPct + '%' }">
                  <span v-if="w.widthPct > 7">{{ w.label }}</span>
                </div>
              </template>
            </div>
            <div v-for="(act, aii) in axis.actions" :key="aii"
              class="sap-block"
              :class="{ stale: isStaleAct(act) }"
              :title="isStaleAct(act) ? STALE_TITLE : undefined"
              :style="blockStyle(act, aii === dragging?.aii)"
              @pointerdown.prevent="startDrag($event, ai, aii)">
              <span class="sap-block-text">{{ act.label || moveLabel(act.moveId) }}×{{ act.count }}{{ act.promoteVariant ? '·' + act.promoteVariant : '' }}{{ act.sourceTag === 'gift' ? '·赠' : '' }}<span v-if="actDuration(act) > 0" style="opacity:0.7"> {{ actDuration(act).toFixed(1) }}s</span></span>
              <template v-for="lane in windowLanes" :key="'tag-' + lane.decl.kind">
                <span v-if="laneBlockTag(lane, ai, aii)" class="sap-mw" :class="laneBlockTag(lane, ai, aii)!.cls">{{ laneBlockTag(lane, ai, aii)!.text }}</span>
              </template>
              <span v-if="moveBadgeFor(act)" class="sap-mw mw-trigger">{{ moveBadgeFor(act) }}</span>
              <span v-for="(tg, ti) in anomalyTagsFor(ai, aii)" :key="'at'+ti" class="sap-mw" :class="tg.cls">{{ tg.text }}</span>
            </div>
          </div>

          <!-- 动作列表（优先级栈：从上到下=优先级；改次数/转大变体/排序/删除） -->
          <div class="sap-stack" v-if="axis.actions.length > 0">
            <div v-for="(act, aii) in axis.actions" :key="aii" class="sap-stack-row">
              <span class="sap-prio" :class="{ top: aii === 0 }">{{ aii + 1 }}</span>
              <span v-if="isStaleAct(act)" class="sap-warn" :title="STALE_TITLE">已失效</span>
              <n-select :value="act.slot" @update:value="v => editAction(ai, aii, a => { a.slot = v })" :options="slotOptions" size="tiny" style="width:92px" />
              <n-select :value="act.moveId" :options="moveOptions(act.slot)" size="tiny" style="width:168px" @update:value="v => editAction(ai, aii, a => { a.moveId = v; a.sourceTag = undefined })" />
              <span>×</span>
              <n-input-number :value="act.count" @update:value="v => editAction(ai, aii, a => { a.count = v ?? 1 })" size="tiny" :min="1" :max="99" style="width:52px" />
              <n-select v-if="isPromotable(act)" :value="act.promoteVariant ?? ''" @update:value="v => editAction(ai, aii, a => { a.promoteVariant = v || undefined })" size="tiny" style="width:82px"
                :options="[{label:'常规',value:''},{label:'60转大',value:'60'},{label:'90转大',value:'90'}]" />
              <template v-if="durationInputFor(act)">
                <span class="sap-t" :title="durationInputFor(act)!.title">
                  {{ durationInputFor(act)!.label }}<n-input-number :value="act.duration ?? durationInputFor(act)!.default" :min="durationInputFor(act)!.min" :max="durationInputFor(act)!.max" :step="durationInputFor(act)!.step" size="tiny" style="width:62px"
                    @update:value="v => editAction(ai, aii, a => { a.duration = v ?? durationInputFor(a)!.default })" />s
                </span>
              </template>
              <span class="sap-t">
                <span class="sap-t-time">{{ actDurationText(act) }}</span>s · 起点 <span class="sap-t-time">{{ (act.startTime ?? 0).toFixed(1) }}</span>s
              </span>
              <span class="sap-ops">
                <n-button size="tiny" quaternary :disabled="aii===0" @click="moveAction(ai, aii, -1)">↑</n-button>
                <n-button size="tiny" quaternary :disabled="aii===axis.actions.length-1" @click="moveAction(ai, aii, 1)">↓</n-button>
                <n-button size="tiny" quaternary type="error" @click="editAxis(ai, a => { a.actions.splice(aii, 1) })">×</n-button>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 失衡内异常状态（逐窗积蓄模拟，从资源利用率页迁入）：说明 + 每元素摘要 + 逐窗状态链 + 逐条目事件 -->
      <n-collapse v-if="inStunAnomalyState && useAxes" style="margin-top:10px">
        <n-collapse-item title="失衡内异常状态（状态链 / 触发标注 / 状态判定事件）" name="board">
      <div v-if="inStunAnomalyState && useAxes" style="font-weight:600;margin-bottom:6px;font-size:12px">
        失衡内异常状态（窗口独立模拟：每次失衡都是中间态——跨出窗口是非失衡期且未建模，每窗按条目声明的初始状态/异常条初始化；满槽经触发块清空并触发，下一波重新积蓄；✕ 抑制=满槽保持不触发（施加者后台/CD 无法判断时用），恢复即重新生效）
      </div>
      <div v-if="inStunAnomalyState" style="font-size:12px;color:var(--wa-750);display:flex;flex-direction:column;gap:4px;margin-bottom:8px">
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          <span v-for="el in inStunAnomalyState.elements" :key="el.element"
            style="background:var(--wa-60);padding:2px 8px;border-radius:3px">
            {{ entryBarLabel(el.element) }} · 每窗均 {{ (el.triggerCount / Math.max(1, inStunAnomalyState.windows)).toFixed(1) }} 次 · 共 {{ fmt(el.triggerCount, 1) }} 次 · 窗均覆盖 {{ (el.avgCoverage * 100).toFixed(1) }}%
          </span>
          <span v-if="inStunAnomalyState.elements.length === 0" style="color:var(--wa-350)">轴内动作未产生积蓄触发。</span>
        </div>
        <div v-for="row in chainRows" :key="'w'+row.wi"
          style="color:var(--wa-550)">
          第{{ row.wi + 1 }}次失衡：{{ row.text }}
        </div>
        <div v-if="chainRows.length === 0 && (bossAnomalyState?.stateChainsPerWindow.length ?? 0) > 1"
          style="color:var(--wa-400)">各次失衡状态链完全相同（多轮重复段逐窗重演同一序列），不重复展示。</div>
        <div v-for="(axis, ai) in axes" :key="'ev'+ai" style="color:var(--wa-650);display:flex;flex-wrap:wrap;gap:4px;align-items:center">
          <span v-if="entryEventLine(ai)" style="margin-right:4px">「{{ axis.name }}」{{ entryEventLine(ai) }}</span>
          <span v-for="chip in entryTriggerChips(ai)" :key="chip.id"
            style="display:inline-flex;align-items:center;gap:2px;background:var(--wa-60);padding:1px 6px;border-radius:3px"
            :style="chip.suppressed ? 'opacity:0.45;text-decoration:line-through' : ''">
            {{ chip.label }}
            <n-button size="tiny" quaternary type="warning" @click="toggleTriggerSuppressed(ai, chip.id)">
              {{ chip.suppressed ? '恢复' : '✕' }}
            </n-button>
          </span>
        </div>
        <div style="color:var(--wa-400);margin-top:2px">动作块上的「触X」标签 = 该招式在此段首窗触发的异常；带·紊乱 = 触发时替换了原状态。极性紊乱/异放的归因与基数都按触发时刻的当前状态结算。</div>
        <div style="border-top:1px dashed var(--wa-100);margin-top:4px;padding-top:4px;max-height:180px;overflow:auto">
          <span style="font-size:12px;font-weight:600">状态判定事件（异放/极性紊乱：元素与失衡易伤按触发时刻当前状态结算）</span>
          <div v-for="row in stateJudgedRows" :key="row.key" style="font-size:12px;color:var(--wa-650)">
            [{{ row.type }}] {{ row.agentName }} · {{ row.name }} → {{ entryBarLabel(row.element) }} ×{{ fmt(row.count, 1) }}（{{ fmt(row.totalDamage, 0) }} 伤害）
          </div>
          <div v-if="stateJudgedRows.length === 0" style="font-size:12px;color:var(--wa-350)">
            当前配置没有状态判定类事件产出（异放需要命中异常目标；极性紊乱需要跨元素替换）。
          </div>
        </div>
      </div>

        </n-collapse-item>
      </n-collapse>

      <div v-if="useAxes && staleActCount > 0" class="sap-warn" style="margin-top:6px">
        有 {{ staleActCount }} 个轴块属于已不在对应槽位的角色，已不参与计算（换回原角色后恢复生效）
      </div>
      <!-- 统计 -->
      <div v-if="axisResult && useAxes" class="sap-stats">
        <div class="sap-stat-row">
          <span>轴内失衡 {{ fmt(axisResult.totalInAxisStun,1) }}</span>
          <span>失衡次数 {{ axisResult.stunCount }} 次</span>
          <span>轴轮数 {{ fmt(axisResult.totalAxisRounds, 1) }} 轮</span>
          <span>覆盖率 {{ (stunCoverage*100).toFixed(1) }}%</span>
        </div>
        <div v-if="axisResult.globalWarnings.length" style="margin-top:6px">
          <div v-for="(w,i) in axisResult.globalWarnings" :key="i" class="sap-warn">{{ w }}</div>
        </div>
        <div v-if="stack" style="margin-top:8px; border-top:1px dashed var(--wa-80); padding-top:6px">
          <div class="sap-stat-row">
            <span>轴内闪能消耗 {{ fmt(stack.energyUsed, 1) }} / {{ fmt(stack.totalEnergy, 1) }}</span>
            <span>喧响消耗 {{ fmt(stack.decibelUsed, 1) }} / {{ fmt(stack.totalDecibel, 1) }}</span>
            <span>实际窗口 {{ stack.windowsUsed }} / {{ stack.windowsUsed + stack.skipped.filter(s=>s.reason==='time').length }}</span>
          </div>
          <div v-for="(w,i) in stackWarnings" :key="i" class="sap-warn">{{ w }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, type DeepReadonly } from 'vue'
import { NCollapse, NCollapseItem, NButton, NInput, NInputNumber, NSelect, NSwitch, useMessage } from 'naive-ui'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { agentCombos, agentAxisBlockMarks, agentAxisMoveMeta, agentAxisHiddenMoves, agentAxisMoveSuffix, agentAxisMoveBadge, agentAxisDurationInput, agentOwnsPromoteVariantAxisBlocks, teamPromoteVariantOwnerSlot, agentAxisRageCombos, agentAxisExtraBlocks, teamAxisWindowLanes, agentAxisNonDecibelUltimates, teamAxisPresetChapterOwnerSlot, axisPresetPreferredLabel } from '@/composables/agentMechanicView'
import type { AxisEditorBlockMark } from '@/mechanics/types'
import type { TeamAxisWindowLane } from '@/composables/agentMechanicView'
import { matchStunAxisPresets, cloneStunAxes, normalizeAxesForExport, prefillPresetGuarantee } from '@/data/stunAxisPresets'
import { axisWindowCounts } from '@/composables/stunAxisView'
import { isStaleAxisActionFor } from '@/composables/resourceCalc/roundInputs'
import { axisTableDirectCandidates } from '@/composables/resourceCalc/axisTableDirect'
import type { StunAxisPreset } from '@/data/stunAxisPresets'
import { fmt } from '@/utils/format'
import { damageElementLabel } from '@/utils/agentLabelMaps'
import type { StunAxisAction, StunAxis } from '@/types/resource'
import { BOSS_ENTRY_ANOMALY_OPTIONS } from '@/data/bossEntryAnomalyOptions'
import { findMoveById as findMove } from '@/data/moveTableQueries'
import { findUltimateMove, chainMoveKind } from '@/data/chainMoveKind'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
/**
 * CC-389 残留块：换人后留在本槽、属于别的角色的动作。引擎已在 `roundInputs#resolveAxes` 出口丢弃（不执行），
 * 但手动轴（configStore.stunAxes）原样保留——换回原角色时恢复生效。这里标灰提示，免得用户以为它还在起作用。
 */
function isStaleAct(act: DeepReadonly<StunAxisAction>): boolean {
  return isStaleAxisActionFor(act, configStore.team, catalogStore)
}
const STALE_TITLE = '该块属于已不在此槽的角色，不参与计算（换回原角色后恢复生效）'
const message = useMessage()
const { resourceResult, stunAxisResult: axisResult, stunPoolResult, stackTraversalResult: stack, matchedPlanName, effectiveStunAxes, autoPreset, autoActive, windowDuration, stunCoverage, inStunAnomalyState, bossAnomalyState, damagePoolRows } = useResourceCalc()

const hasTeam = computed(() => configStore.team.some(c => !!c.agentId))
// 通用自动轴：队伍匹配到预设失衡轴即自动选用（手动配置过轴时让路）
// CC-60：「章」档位归属 / 「预设优先」角色经模块声明（原写死伊德海莉 / 琉音 id）
const chapterOwnerSlot = computed(() => teamAxisPresetChapterOwnerSlot(configStore.team))
const hasChapterOwner = computed(() => chapterOwnerSlot.value >= 0)
const hasManualAxes = computed(() => configStore.stunAxisPlans.length > 0 || configStore.stunAxes.length > 0)
const chapterOwnerCinema = computed(() => (chapterOwnerSlot.value >= 0 ? configStore.team[chapterOwnerSlot.value]?.cinemaLevel ?? 0 : 0))
const autoChapterLabel = computed(() => (chapterOwnerCinema.value >= 1 ? '1章（≥1命）' : '0章（0命）'))
// CC-79：「有琉/无琉」文案由声明者简称拼出（多声明者时列全）
const autoLiuyinLabel = computed(() => axisPresetPreferredLabel(configStore.team))
// 自动轴 banner 备注：章鱼体系显示 章×有琉，其余显示预设 note
const autoPresetNote = computed(() => {
  if (!autoPreset.value) return ''
  if (hasChapterOwner.value) return `${autoChapterLabel.value}·${autoLiuyinLabel.value}`
  return autoPreset.value.note || '队伍匹配预设失衡轴自动选用'
})
// 条件轴方案激活时，编辑器展示命中方案解析出的轴（只读展示，改动不写回方案本体）
const hasPlans = computed(() => configStore.stunAxisPlans.length > 0)
// 展示用轴 = **只读视图**（DeepReadonly：模板/脚本里任何直接写入都是 vue-tsc 红）。
// 条件方案/自动命中模式下它是 calcOutput 缓存里的解析副本——原地改会污染记忆化结果
// （下次命中拿到「改过的轴 + 按旧轴算的结果」），且不触发重算。所有写入走下方 editAxis 单一入口。
// ⚠ vue-tsc 查不到组件 `v-model` 的赋值（只查显式 `x = …`）⇒ 本页禁用 v-model 绑轴字段，一律 :value + editAxis。
const axes = computed<DeepReadonly<StunAxis[]>>(() =>
  hasPlans.value || autoActive.value ? effectiveStunAxes.value : configStore.stunAxes)
const staleActCount = computed(() => axes.value.reduce((n, ax) => n + ax.actions.filter(isStaleAct).length, 0))
const useAxes = computed({
  get: () => configStore.useStunAxis || autoActive.value,
  set: (v) => {
    // 手动关闭：同时关掉章鱼自动轴，避免自动又把开关顶回来
    if (!v) configStore.autoYidhariAxis = false
    configStore.useStunAxis = v
  },
})
const matchedPresets = computed(() => matchStunAxisPresets(configStore.team.map(c => c.agentId)))
// 失衡窗口时长 = stunTime + 连携窗口(4) + 全队失衡延时（琉音+2、般岳C1+2 等），与引擎同口径
const maxDur = computed(() => windowDuration.value)
const ticks = computed(() => { const t: number[] = []; for (let i = 0; i <= maxDur.value; i += 2) t.push(i); return t })
const slotOptions = computed(() => [0, 1, 2].map(s => ({ label: agentName(s), value: s })))
// 专属窗口平行道（般岳明王 8s / 仪玄凝神 15s 等限时 buff 可视化）
// CC-62：lane 拥有者经模块声明 axisWindowLane（原写死 findIndex agentId === 1471 / 1371）
// CC-48：块级标注经模块能力 axisEditorBlockMarks（门面 agentAxisBlockMarks）
// CC-448：banner / 窗长 / 触发判定 / 文案 / 满覆盖全部来自声明对象，页面只跑一份泛型渲染（原般岳 / 仪玄各一份 slot/blocks/tag/windowsFor）
interface WindowLaneView extends TeamAxisWindowLane {
  ctx: { cinemaLevel: number }
  top: string
  full: string | null
  marks: Map<string, AxisEditorBlockMark>
}
const windowLanes = computed<WindowLaneView[]>(() => teamAxisWindowLanes(configStore.team).map((lane, idx) => {
  const ctx = { cinemaLevel: configStore.team[lane.slot]?.cinemaLevel ?? 0 }
  return {
    ...lane,
    ctx,
    top: laneTop(3 + idx),
    full: lane.decl.fullCoverage?.(ctx) ?? null,
    marks: agentAxisBlockMarks(lane.agentId, { axes: axes.value, slot: lane.slot, cinemaLevel: ctx.cinemaLevel }),
  }
}))
function laneBlockTag(lane: WindowLaneView, ai: number, aii: number): { text: string; cls: string } | null {
  if (lane.full) return null
  const mark = lane.marks.get(`${ai}:${aii}`)
  return mark ? lane.decl.blockTag(mark) : null
}
// 窗口条：该轴内拥有者槽位的触发块处画 windowSeconds 窗口（文字 / 样式由声明按块级扫描结果给）
function laneWindowsFor(lane: WindowLaneView, ai: number): { key: string; label: string; cls: string; leftPct: number; widthPct: number }[] {
  const axis = axes.value[ai]
  if (!axis || lane.full) return []
  const win: { key: string; label: string; cls: string; leftPct: number; widthPct: number }[] = []
  for (const [aii, act] of axis.actions.entries()) {
    if (act.slot !== lane.slot || !lane.decl.isTriggerBlock(act, lane.ctx)) continue
    const key = `${ai}:${aii}`
    win.push({
      key,
      ...lane.decl.window(lane.marks.get(key)),
      leftPct: ((act.startTime ?? 0) / maxDur.value * 100),
      widthPct: Math.max(2, (lane.decl.windowSeconds / maxDur.value * 100)),
    })
  }
  return win
}
// 60/90 转大（好评把队友连携升级为终结技）：只有「转大块拥有者」（现唯一 = 琉音）在队时才给其他队友发转大块。
// CC-58：经模块声明 ownsPromoteVariantAxisBlocks（与编排层 roundInputs#buildStackAxes 同源；原写死 findIndex agentId === 1481）
const promoteOwnerSlot = computed(() => teamPromoteVariantOwnerSlot(configStore.team))
// CC-446：已放置块的徽标 / 时长输入框均按「块所属槽位的角色模块」声明取（原按仪玄槽位 + 1371022/1371026 字面量写死）
function moveBadgeFor(act: Pick<StunAxisAction, 'slot' | 'moveId'>): string {
  return agentAxisMoveBadge(configStore.team[act.slot]?.agentId, act.moveId)
}
function durationInputFor(act: Pick<StunAxisAction, 'slot' | 'moveId'>) {
  return agentAxisDurationInput(configStore.team[act.slot]?.agentId, act.moveId)
}
const fillerOptions = computed(() => [{ label: '不填充', value: -1 }, ...slotOptions.value])
function fillerValue(ai: number): number { return axes.value[ai]?.basicFillerSlot ?? -1 }
function setFiller(ai: number, v: number) {
  editAxis(ai, axis => {
    if (v < 0) delete axis.basicFillerSlot
    else axis.basicFillerSlot = v
  })
}

// 进窗初始异常状态/异常条（随预设导出；引擎取首个生效轴条目上的显式设置，未填回落全局 boss.*）
// CC-447：进窗异常元素中文名走 CC-214 单一来源 `damageElementLabel`（原页面私有 6 键表，CC-214 登记为「有意的子集」，但子集不需要自己的文案）
const entryAnomalyOptions = [
  { label: '无', value: 0 },
  ...BOSS_ENTRY_ANOMALY_OPTIONS.filter(o => o.value > 0).map(o => ({ label: damageElementLabel(o.element), value: o.value })),
]
// ===== 轴编辑的**唯一写入口** =====
// 自动命中/条件方案模式下展示的是解析副本，直接改不落盘（且会污染计算缓存）——
// 自动模式下首次编辑把展示的轴物化为手动轴（自动轴让路）；条件方案无法写回，提示后拒绝。
const editingEphemeral = computed(() => hasPlans.value || autoActive.value)
/** 写前准备：条件方案 ⇒ 拒绝；自动命中 ⇒ 先把展示的轴物化为手动轴。返回 false = 不可写。 */
function beginEdit(): boolean {
  if (hasPlans.value) { message.warning('条件轴方案为只读，请在 JSON 预设里修改方案'); return false }
  if (editingEphemeral.value) {
    configStore.stunAxes.splice(0, configStore.stunAxes.length, ...cloneStunAxes(axes.value as StunAxis[]))
    message.info('已从自动命中的预设轴派生为手动轴，后续编辑直接生效')
  }
  return true
}
function writableAxisAt(ai: number): StunAxis | null {
  if (!axes.value[ai] || !beginEdit()) return null
  return configStore.stunAxes[ai] ?? null
}
function editAxis(ai: number, fn: (axis: StunAxis) => void) {
  const axis = writableAxisAt(ai); if (axis) fn(axis)
}
function editAction(ai: number, aii: number, fn: (act: StunAxisAction) => void) {
  editAxis(ai, axis => { const act = axis.actions[aii]; if (act) fn(act) })
}
function removeAxis(ai: number) {
  if (!writableAxisAt(ai)) return
  configStore.stunAxes.splice(ai, 1)
}
function setEntryAnomaly(ai: number, v: number) {
  editAxis(ai, target => {
    if (v > 0) target.entryAnomaly = v
    else {
      target.entryAnomaly = undefined
      target.entryBars = undefined
    }
  })
}

// 多条异常条（v2.8 用户口径：多个角色各攒各的条，两条接近满进窗一碰即连续触发紊乱）
function entryBarList(axis: DeepReadonly<StunAxis>): string[] {
  return Object.keys(axis.entryBars ?? {})
}
function entryBarCandidates(axis: DeepReadonly<StunAxis>): string[] {
  const used = new Set(entryBarList(axis))
  return BOSS_ENTRY_ANOMALY_OPTIONS.filter(o => o.value > 0 && !used.has(o.element)).map(o => o.element)
}
function entryBarLabel(el: string): string { return damageElementLabel(el) }
function addEntryBar(ai: number, el: string) {
  editAxis(ai, target => { (target.entryBars ??= {})[el] = 50 })
}
function setEntryBar(ai: number, el: string, v: number | null) {
  editAxis(ai, axis => {
    if (v === null || !Number.isFinite(v) || v <= 0) {
      // 清空 = 移除该元素的条
      if (axis.entryBars) delete axis.entryBars[el]
      return
    }
    axis.entryBars = { ...(axis.entryBars ?? {}), [el]: Math.min(100, Math.round(v)) }
  })
}

// ===== 失衡内异常状态：板块展示 + 块级触发标注 =====
interface BossChainSeg { start: number; end: number; element: string }
function formatBossStateChain(chain: BossChainSeg[], wind?: BossChainSeg[]): string {
  const fmt = (x: BossChainSeg) => `${entryBarLabel(x.element)} ${x.start.toFixed(1)}~${x.end.toFixed(1)}s`
  const segs = chain.map(fmt)
  if (wind?.length) segs.push(`（风化层 ${wind.map(fmt).join('、')}）`)
  return segs.length > 0 ? segs.join(' → ') : '无异常状态'
}
/** 该条目展开后的首个窗口索引（编辑器展示单轮模式，事件取代表窗） */
function entryFirstWindow(ai: number): number {
  return (inStunAnomalyState.value?.windowEntryIdx ?? []).indexOf(ai)
}
/** 状态判定事件（v2.4 地基消费方）：异放/极性紊乱的元素归因与失衡易伤都按触发时刻当前状态结算 */
const stateJudgedRows = computed(() => {
  return damagePoolRows.value
    .filter(r => r.type === '异放' || r.type === '极性紊乱')
    .map(r => ({
      key: r.id,
      type: r.type,
      agentName: r.agentName,
      name: r.name,
      element: r.element,
      count: r.count,
      totalDamage: r.totalDamage,
    }))
})

/** 状态链行（仅展示与上一次不同的窗口；多轮重复段逐窗重演同一序列，不重复展示） */
const chainRows = computed(() => {
  const boss = bossAnomalyState.value
  if (!boss) return []
  const out: Array<{ wi: number; text: string }> = []
  let prev: string | null = null
  boss.stateChainsPerWindow.forEach((chain, wi) => {
    const text = formatBossStateChain(chain, boss.windOverlayPerWindow[wi])
    if (text !== prev) out.push({ wi, text })
    prev = text
  })
  return out
})
function moveNameOf(mid?: string): string {
  if (!mid) return ''
  for (const slot of [0, 1, 2]) {
    const m = findMove(catalogStore.getAgentSkills(configStore.team[slot]?.agentId ?? ''), mid)
    if (m?.name?.zhCN) return m.name.zhCN
  }
  return mid
}
/** 条目代表窗的触发 chip 数据（含抑制切换） */
function entryTriggerChips(ai: number): Array<{ id: string; label: string; suppressed: boolean }> {
  const st = inStunAnomalyState.value
  const boss = bossAnomalyState.value
  const axis = axes.value[ai]
  const wi = entryFirstWindow(ai)
  if (!st || !axis || wi < 0) return []
  const suppressed = new Set(axis.suppressedTriggers ?? [])
  const out: Array<{ id: string; label: string; suppressed: boolean }> = []
  for (const t of st.triggerSources ?? []) {
    if (t.windowIndex !== wi || !t.id) continue
    const replaced = (boss?.disorders ?? []).some(d => d.windowIndex === wi && Math.abs(d.time - t.offsetSeconds) < 1e-6)
    out.push({
      id: t.id,
      label: `@${t.offsetSeconds.toFixed(1)}s ${moveNameOf(t.moveId)}→${entryBarLabel(t.element)}${replaced ? '·紊' : ''}`,
      suppressed: suppressed.has(t.id),
    })
  }
  return out
}
function toggleTriggerSuppressed(ai: number, id: string) {
  editAxis(ai, target => {
    const set = new Set(target.suppressedTriggers ?? [])
    if (set.has(id)) set.delete(id)
    else set.add(id)
    target.suppressedTriggers = set.size > 0 ? [...set] : undefined
  })
}
function entryEventLine(ai: number): string {
  const st = inStunAnomalyState.value
  const boss = bossAnomalyState.value
  const axis = axes.value[ai]
  const wi = entryFirstWindow(ai)
  if (!st || !axis || wi < 0) return ''
  const parts: string[] = []
  if ((axis.entryAnomaly ?? 0) > 0) {
    const el = BOSS_ENTRY_ANOMALY_OPTIONS.find(o => o.value === axis.entryAnomaly)?.element
    if (el) parts.push(`边界注入 ${entryBarLabel(el)}${(axis.entryBars?.[el] ?? 0) > 0 ? ` ${axis.entryBars![el]}%` : ''}`)
  }
  for (const t of st.triggerSources ?? []) {
    if (t.windowIndex !== wi) continue
    const suppressed = (axis.suppressedTriggers ?? []).includes(t.id ?? '')
    const replaced = (boss?.disorders ?? []).some(d => d.windowIndex === wi && Math.abs(d.time - t.offsetSeconds) < 1e-6)
    parts.push(`@${t.offsetSeconds.toFixed(1)}s ${moveNameOf(t.moveId)}→${entryBarLabel(t.element)}${replaced ? '（紊乱替换）' : ''}${suppressed ? '（已抑制·满槽保持）' : ''}`)
  }
  return parts.length > 0 ? parts.join('；') : ''
}
/** 块级标注：该招式在本段代表窗触发的异常；紊乱替换加粗标 */
function anomalyTagsFor(ai: number, aii: number): Array<{ text: string; cls: string }> {
  const st = inStunAnomalyState.value
  const boss = bossAnomalyState.value
  const axis = axes.value[ai]
  const wi = entryFirstWindow(ai)
  if (!st || wi < 0 || !axis) return []
  const mid = axis.actions[aii]?.moveId
  if (!mid) return []
  const out: Array<{ text: string; cls: string }> = []
  if ((axis.entryAnomaly ?? 0) > 0 && aii === 0) {
    const el = BOSS_ENTRY_ANOMALY_OPTIONS.find(o => o.value === axis.entryAnomaly)?.element
    if (el) out.push({ text: `入窗·${entryBarLabel(el)}`, cls: 'mw-l3' })
  }
  const suppressed = new Set(axis.suppressedTriggers ?? [])
  for (const t of st.triggerSources ?? []) {
    // 按动作实例精确匹配：同一招式放多块时，触发标只落在真正触发的那一块上
    if (t.windowIndex !== wi || !t.id || suppressed.has(t.id)) continue
    if ((t.srcIndex ?? -1) !== aii) continue
    const replaced = (boss?.disorders ?? []).some(d => d.windowIndex === wi && Math.abs(d.time - t.offsetSeconds) < 1e-6)
    out.push({ text: `触${entryBarLabel(t.element)}${replaced ? '·紊' : ''}`, cls: replaced ? 'mw-l3' : 'mw-trigger' })
  }
  // 动作块末尾积蓄槽状态（用户口径：每个动作块都有对应积蓄值与槽状态）
  const snap = st.gaugeSnapshots?.find(g => g.windowIndex === wi && g.srcIndex === aii)
  if (snap) {
    const txt = Object.entries(snap.pct).filter(([, v]) => v > 0)
      .map(([el, v]) => `${entryBarLabel(el)}${Math.round(v)}%`).join('·')
    if (txt) out.push({ text: `条${txt}`, cls: 'mw-l2' })
  }
  return out
}

// 栈遍历警告：资源不足（energy/decibel）= 固定轴只提示；超时（time）= 超窗截断
const stackWarnings = computed(() => {
  const sk = stack.value?.skipped ?? []
  return sk.map(s => {
    const name = moveLabel(s.moveId) || s.moveId
    if (s.reason === 'energy') return `闪能不足：${agentName(s.slot)}·${name} 超支，仍按固定轴计入（共消耗 ${fmt(stack.value!.energyUsed, 1)}/${fmt(stack.value!.totalEnergy, 1)}）`
    if (s.reason === 'decibel') return `喧响不足：${agentName(s.slot)}·${name} 超支，仍按固定轴计入（共消耗 ${fmt(stack.value!.decibelUsed, 1)}/${fmt(stack.value!.totalDecibel, 1)}）`
    return `超时截断：${agentName(s.slot)}·${name} 超出失衡窗口，该动作被舍弃`
  })
})

function pct(t: number): string { return (t / maxDur.value * 100) + '%' }
function laneTop(s: number): string { return (24 + s * 20) + 'px' }

function applyPreset(p: StunAxisPreset) {
  // 方案 / 固定轴互斥写入的唯一实现（arena-D 第 368 轮，原在本页与 teamCompare 各写一份）；
  // 手动应用到 UI 现场 ⇒ 同自动命中一样预填预设声明的保底目标（CC-358；批量求值不预填）
  if (configStore.applyStunAxisPreset(p)) prefillPresetGuarantee(configStore, p)
}
function exportPreset() {
  const teamIds = configStore.team.map(c => c.agentId)
  if (teamIds.some(id => !id)) { message.warning('请先组满三名角色再导出预设'); return }
  const axs = configStore.stunAxes.filter(a => a.actions.length > 0)
  if (axs.length === 0) { message.warning('请先捏好至少一个轴再导出'); return }
  const id = `preset-${teamIds.join('-')}`
  const preset: StunAxisPreset = { id, name: axs[0]?.name || '未命名预设', team: teamIds as [string, string, string], note: '', axes: normalizeAxesForExport(axs) }
  const json = JSON.stringify(preset, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${id}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  const tip = '已导出 JSON：丢进 src/data/stunAxisPresets/ 即生效'
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(json).then(() => message.success(`${tip}（已复制）`)).catch(() => message.success(tip))
  else message.success(tip)
}

// ===== 动作池 =====
/** 轴实际分配到的窗口数（count 缺省 = 兜底吃剩余，与栈引擎同口径） */
// CC-50：整组分配缓存为 computed（原为每次调用都重算整组，且在 allMoves 的逐动作循环里被反复调用）；
// 分配函数经编排层 composables/stunAxisView（判据 7）。
const axisWindowCountList = computed(() => axisWindowCounts(axes.value, stunPoolResult.value?.stunCount ?? 0))
function axisTimes(ai: number): number {
  return axisWindowCountList.value[ai] ?? 0
}
/** 轴内已放置量：全部轴上「本槽 + 满足谓词」的块 count × 该轴窗口数（r475：原五处同式求和合一，口径不变） */
function consumedOnAxes(slot: number, match: (a: DeepReadonly<StunAxisAction>) => boolean): number {
  let consumed = 0
  axes.value.forEach((ax, ai) => {
    for (const a of ax.actions) if (a.slot === slot && match(a)) consumed += a.count * axisTimes(ai)
  })
  return consumed
}
const allMoves = computed(() => {
  const out: { slot: number; moveId: string; label: string; actionTime: number; remaining: number; key: string; promoteVariant?: '60' | '90'; sourceTag?: 'gift' }[] = []
  const chars = resourceResult.value?.characters ?? []
  const stunCount = stunPoolResult.value?.stunCount ?? 0
  for (const c of chars) {
    const basicTime = c.timeAllocation.basicAttackTime
    if (basicTime > 0) {
      const consumed = consumedOnAxes(c.slot, a => a.moveId === 'basic')
      out.push({ slot: c.slot, moveId: 'basic', label: '平A', actionTime: 1, remaining: Math.max(0, Math.floor(basicTime) - consumed), key: c.slot + ':basic' })
    }
    for (const exec of c.executions) {
      if (exec.moveId === 'basic_attack') continue
      // 模块声明隐藏的招式（CC-57，现唯一 = 伊德海莉裸极寒重碾 1051012：用连段表达能量消耗更准，避免误导闪能计算）
      // CC-392：伴随子行（并入 agentAxisHiddenMoves）与 CD / 时间驱动的自动行（autoSplitByStun）放进轴不起作用，不进候选池
      if (exec.autoSplitByStun || agentAxisHiddenMoves(c.agentId).includes(exec.moveId)) continue
      // 固定轴：资源不足（count 0）的招式也显示为 ×0 灰色块，供轴放置/标记 60/90 转大；
      // 连携/赠送动作的可用数按失衡次数兜底（连携可用 = 失衡次数）。
      const mid = exec.moveId
      // 自身招式只统计「无转大变体」的轴内块，避免 60/90 转大块把常规终结技的次数吃掉
      const consumed = consumedOnAxes(c.slot, a => a.moveId === mid && !a.promoteVariant && (a.sourceTag === 'gift') === (exec.source === 'gift'))
      const skills = catalogStore.getAgentSkills(configStore.team[c.slot]?.agentId ?? '')
      const move = findMove(skills, mid)
      const rawName = exec.moveName?.replace(/（.*/g, '').trim() || mid
      const srcTag = exec.source === 'stun' ? '·失衡' : exec.source === 'gift' ? '·赠' : ''
      // 仪玄影画1落雷：按 CD（6s）自动算次数（轴模式按轴内时间，非轴按战斗时间）
      const cdTag = mid === '1371_c1_lightning' ? '·CD6s自动' : ''
      // 失衡强特增伤（额外能力）：凝云术/墨烬影消命中失衡敌人 +30%（轴内行 dmgBonus = 60核心被动 + 30失衡）
      // CC-57：块名后缀经模块声明 axisMoveSuffix（现唯一 = 仪玄 1371022/1371026「·+30%失衡」）
      const stunExTag = agentAxisMoveSuffix(c.agentId, mid)
      let name = ((move?.name?.zhCN || rawName).slice(0, 8)) + srcTag + cdTag + stunExTag
      // 般岳怒/普分化：只写招式名（倍率随等级变不写；名字带「·怒」即 40 耗能，其余 20；连段块山威免费）
      // CC-48：招式元数据经模块声明 axisMoveMeta（现唯一 = 般岳；原为按般岳 agentId 1471 查 BANYUE_AXIS_MOVE_META）
      const axisMoveMeta = agentAxisMoveMeta(c.agentId)?.[mid]
      if (axisMoveMeta) {
        const meta = axisMoveMeta
        name = `[${meta.tag}]${move?.name?.zhCN || rawName}`
      }
      // 般岳 [普]/[怒] 强特：remaining 用资源预算推导（闪能/山威），不被「已捏反馈」锁成 0——
      // 玩家捏轴时看到的是「还能拉几个」，拉了才扣预算（普通强特耗闪能回嗔火，连段块耗山威免费）。
      let remaining = 0
      const cycle = c.banyueRageCycle
      const banyueMeta = axisMoveMeta
      if (cycle && banyueMeta) {
        if (banyueMeta.tag === '怒') {
          // 连段块：山威配额由模块给出（rageComboQuota = 怒相次数 × 2 组；官方预设自觉遵守，不硬限制）
          remaining = Math.max(0, cycle.rageComboQuota - consumed)
        } else {
          // 普通强特：剩余闪能预算（flashSpent 已含已捏的 axisExSpend 与自动连段）
          const budget = Math.max(0, cycle.flashIncome - cycle.flashSpent)
          remaining = Math.max(0, Math.floor(budget / banyueMeta.cost))
        }
      } else {
        const avail = exec.source === 'stun' ? Math.max(exec.count, stunCount) : exec.count
        remaining = Math.max(0, avail - consumed)
      }
      out.push({ slot: c.slot, moveId: mid, label: name, actionTime: exec.actionTime || move?.actionTime || 2, remaining, key: c.slot + ':' + mid + (exec.source === 'gift' ? ':gift' : ''), sourceTag: exec.source === 'gift' ? 'gift' : undefined })
    }
  }
  // 额外可放置：60/90 转大（琉音好评专属，只给转大目标、不给转大发起者自己；琉音不在队则不显示）
  // （触手常驻块已迁模块声明，见下方 axisExtraBlocks 循环）
  for (const c of chars) {
    const skills = catalogStore.getAgentSkills(c.agentId)
    const ultMove = findUltimateMove(skills) // CC-319：原 findMoveByEn(skills,'ultimate') 不看分类，青衣会取到普攻 1251001
    if (ultMove && promoteOwnerSlot.value >= 0 && !agentOwnsPromoteVariantAxisBlocks(c.agentId)) {
      for (const v of ['60', '90'] as const) {
        const consumed = consumedOnAxes(c.slot, a => a.moveId === ultMove.id && a.promoteVariant === v)
        out.push({ slot: c.slot, moveId: ultMove.id, label: '转大·' + v, actionTime: ultMove.actionTime ?? 0, remaining: Math.max(0, 9 - consumed), key: `${c.slot}:${ultMove.id}:promote:${v}` })
      }
    }
    // 伊德海莉寒冰触手块：CC-433 起经模块声明 axisExtraBlocks（下面的通用循环），不再在页面写死 1051024
    // CC-61：角色专属轴块经模块声明 axisExtraBlocks（现：诺姆转连携 norma-hat-chain / 希格莉德破阵连段 sigrid-pozhen / 伊德海莉寒冰触手 1051024（CC-433）；
    // 原为两段写死 c.agentId 1571 / 1591 的 if 块，数值口径逐字搬进各自模块）
    {
      const exSkills = catalogStore.getAgentSkills(c.agentId)
      const extraBlocks = agentAxisExtraBlocks(c.agentId, {
        cinemaLevel: configStore.team[c.slot]?.cinemaLevel ?? 0,
        actionTimeOf: mid => findMove(exSkills, mid)?.actionTime ?? 0,
      })
      for (const blk of extraBlocks) {
        const consumed = consumedOnAxes(c.slot, a => a.moveId === blk.moveId)
        out.push({ slot: c.slot, moveId: blk.moveId, label: blk.label, actionTime: blk.actionTime, remaining: Math.max(0, blk.quota - consumed), key: `${c.slot}:${blk.moveId}` })
      }
    }
    // 连段（打包招式，如 单次/双次）：能量按打包口径一次扣（50/85），比裸强特（极寒重碾）的能量消耗更准
    const combos = agentCombos(c.agentId)  // CC-47：经编排层门面（判据 7）
    if (combos) {
      for (const [comboId, combo] of Object.entries(combos)) {
        const actionTime = combo.moves.reduce((s, mv) => s + (findMove(skills, mv.moveId)?.actionTime ?? 0) * mv.count, 0)
        // 连段里含几个耗能强特 → 估算可放次数（remaining 只是提示）
        const exPerCombo = combo.moves.reduce((s, mv) => {
          const m = findMove(skills, mv.moveId)
          const cost = m?.energyCost ? Object.values(m.energyCost).map(v => parseFloat(String(v))).find(n => n > 0) : undefined
          return s + (cost ? mv.count : 0)
        }, 0) || 1
        // 般岳怒相连段块：山威配额（怒相次数 × 2 组）替代 exSpecialCount 估算，不被反馈闭环锁 0；
        // 论道/地动山摇两个连段块共享配额（didong 优先占：论道可再放 = 配额 − 已捏didong − 已捏论道）
        // CC-59：经模块声明 axisRageCombos（原写死 agentId 1471 + 两个 comboId 字面量）
        const rageCombos = agentAxisRageCombos(c.agentId)
        const isRageCombo = !!rageCombos && (comboId === rageCombos.primary || comboId === rageCombos.didong)
        const consumed = consumedOnAxes(c.slot, a => a.moveId === comboId)
        const didongConsumed = rageCombos && comboId === rageCombos.primary
          ? consumedOnAxes(c.slot, a => a.moveId === rageCombos.didong)
          : 0
        const rageQuota = c.banyueRageCycle?.rageComboQuota ?? 0
        const available = isRageCombo && c.banyueRageCycle
          ? comboId === rageCombos?.primary
            ? Math.max(0, rageQuota - didongConsumed - consumed)
            : Math.max(0, rageQuota - consumed)
          : Math.floor((c.exSpecialCount ?? 0) / exPerCombo)
        const comboLabel = isRageCombo
          ? `[怒]${combo.label}`
          : combo.label
        out.push({ slot: c.slot, moveId: comboId, label: comboLabel, actionTime, remaining: Math.max(0, available - consumed), key: `${c.slot}:${comboId}:combo` })
      }
    }
    // 未单独建模招式（技能表有伤害倍率行、模块未生成执行行）：也进动作池供轴内直读，
    // 放置后由结算按技能表倍率出直伤（吃易伤；不占时间预算、窗内不产失衡值）
    // 去重口径 = 伤害侧 `damagePoolDirect` 的 `backed`（本角色全部执行行 moveId）：有执行行的招式放 [表] 块不出伤害。
    // CC-392：原只看已进候选的招式 ⇒ 被隐藏的行（伴随子行 / 自动行 / axisHiddenMoves）会以 [表] 块重新冒出来。
    // CC-393：可直读判定与结算共用 `axisTableDirectCandidates`（隐藏招式 / 融合并入段 / 分类 / 倍率同一口径）；
    // 这里只额外跳过已作为别的块出现的 moveId（如伊德海莉触手 1051024），那是显示去重，不是判定。
    const shownIds = new Set(out.filter(m => m.slot === c.slot).map(m => m.moveId))
    const tblAgentId = configStore.team[c.slot]?.agentId ?? ''
    for (const { move: m } of axisTableDirectCandidates(tblAgentId, catalogStore.getAgentSkills(tblAgentId), new Set(c.executions.map(e => e.moveId)))) {
      if (shownIds.has(m.id)) continue
      out.push({ slot: c.slot, moveId: m.id, label: `[表]${(m.name?.zhCN || m.id).slice(0, 8)}`, actionTime: m.actionTime ?? 0, remaining: 99, key: `${c.slot}:${m.id}:table` })
    }
  }
  return out
})
function slotMoves(s: number) { return allMoves.value.filter(m => m.slot === s) }
function moveOptions(s: number) {
  // 同一 moveId 可能有多个池条目（常规终结技 + 转大·60/90），下拉选项按 moveId 去重，保留首个（常规）条目
  const seen = new Set<string>()
  return slotMoves(s).filter(m => {
    if (seen.has(m.moveId)) return false
    seen.add(m.moveId)
    return true
  }).map(m => ({ label: m.label + (m.remaining <= 0 ? ' (×0)' : ''), value: m.moveId }))
}
function moveLabel(mid: string) { return allMoves.value.find(m => m.moveId === mid)?.label ?? mid }
function actDuration(act: StunAxisAction): number {
  // 轴块 duration 覆盖倍率表 actionTime（仪玄轴内凝云术蓄力 0-2s 可调）
  const per = typeof act.duration === 'number' ? act.duration : (allMoves.value.find(m => m.slot === act.slot && m.moveId === act.moveId)?.actionTime ?? 0)
  return per * act.count
}
function actDurationText(act: StunAxisAction): string {
  const d = actDuration(act)
  return d > 0 ? d.toFixed(1) + 's' : '—'
}
function isPromotable(act: Pick<StunAxisAction, 'slot' | 'moveId'>): boolean {
  // 只有常规（喧响）终结技块可选 60/90 转大变体；
  // CC-448：非喧响终结技（仪玄符法千重，术法值触发）经块所属槽位模块声明 axisNonDecibelUltimates 排除（原写死 1371020）
  if (agentAxisNonDecibelUltimates(configStore.team[act.slot]?.agentId).includes(act.moveId)) return false
  const moveId = act.moveId
  for (const s of [0, 1, 2]) {
    const skills = catalogStore.getAgentSkills(configStore.team[s]?.agentId ?? '')
    if (chainMoveKind(skills, moveId) === 'ultimate') return true // CC-319
  }
  return false
}

// ===== 拖拽（startTime） =====
const dragging = ref<{ ai: number; aii: number; startX: number; origStart: number } | null>(null)
function startDrag(e: PointerEvent, ai: number, aii: number) {
  // 拖动起点即物化（自动模式），之后每帧写的是手动轴
  const axis = writableAxisAt(ai); if (!axis) return
  const act = axis.actions[aii]; if (!act) return
  dragging.value = { ai, aii, startX: e.clientX, origStart: act.startTime ?? 0 }
}
function onTimelineMove(e: PointerEvent, ai: number) {
  if (!dragging.value || dragging.value.ai !== ai) return
  const axis = configStore.stunAxes[ai]; if (!axis) return
  const act = axis.actions[dragging.value.aii]; if (!act) return
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const pxPerSec = rect.width / maxDur.value
  const dx = (e.clientX - dragging.value.startX) / pxPerSec
  const dur = actDuration(act)
  act.startTime = Math.max(-dur, Math.round((dragging.value.origStart + dx) * 10) / 10)
}
function endDrag() { dragging.value = null }
function blockStyle(act: StunAxisAction, selected: boolean) {
  const dur = actDuration(act); const start = act.startTime ?? 0
  const leftPct = (start / maxDur.value * 100)
  const wPct = Math.max(2, (dur / maxDur.value * 100))
  const ovr = start < 0 || start + dur > maxDur.value
  return {
    left: leftPct + '%',
    top: laneTop(act.slot),
    width: wPct + '%',
    background: ovr ? 'rgba(240,160,32,0.28)' : selected ? 'rgba(99,226,183,0.35)' : 'rgba(99,226,183,0.16)',
    borderColor: ovr ? 'rgba(240,160,32,0.5)' : 'transparent',
    zIndex: selected ? 5 : 2,
  }
}

// ===== 栈操作 =====
function addAxis() {
  if (!beginEdit()) return
  configStore.stunAxes.push({ name: `轴${axes.value.length+1}`, actions: [] })
}
function addToCurrentAxis(s: number, mid: string, promoteVariant?: '60' | '90', sourceTag?: 'gift') {
  if (!beginEdit()) return
  const axs = configStore.stunAxes; if (axs.length === 0) addAxis()
  const axis = axs[axs.length - 1]
  const info = slotMoves(s).find(m => m.moveId === mid)
  // 新动作自动接在同槽位现有动作末尾（startTime = 该槽位动作最大结束时刻）
  const endTime = axis.actions
    .filter(a => a.slot === s)
    .reduce((max, a) => Math.max(max, (a.startTime ?? 0) + actDuration(a)), 0)
  axis.actions.push({ slot: s, moveId: mid, count: 1, label: info?.label, startTime: Math.round(endTime * 10) / 10, promoteVariant, sourceTag })
}
function moveAction(ai: number, aii: number, dir: -1 | 1) {
  editAxis(ai, axis => {
    const to = aii + dir
    if (to < 0 || to >= axis.actions.length) return
    const arr = axis.actions
    const tmp = arr[aii]; arr[aii] = arr[to]; arr[to] = tmp
  })
}
function agentName(s: number) {
  const c = configStore.team[s]; if (!c?.agentId) return `槽${s+1}`
  return catalogStore.agentName(c.agentId, '').slice(0, 5) || `槽${s+1}`
}
</script>

<style scoped>
.sap-root { width: 100%; min-height: 300px; padding: 16px 20px; }
.placeholder { text-align: center; color: var(--wa-300); padding: 60px 0; }
.sap-topbar { display: flex; align-items: center; margin-bottom: 14px; }
.sap-top-label { font-size: 12px; color: var(--wa-550); margin-left: 6px; }
.sap-plan-banner { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding: 6px 10px; background: rgba(99,226,183,0.07); border: 1px solid rgba(99,226,183,0.2); border-radius: 6px; }
.sap-plan-label { font-size: 10px; color: var(--c-success); }
.sap-plan-name { font-size: 12px; color: var(--c-success); font-weight: 600; }
.sap-plan-note { font-size: 10px; color: var(--wa-450); }
.sap-pool { margin-bottom: 16px; }
.sap-section-title { font-size: 11px; color: var(--wa-400); margin-bottom: 4px; }
.sap-presets { margin-bottom: 16px; padding: 10px; background: rgba(99,226,183,0.04); border: 1px solid var(--c-success-soft); border-radius: 6px; }
.sap-preset-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
.sap-preset-name { font-size: 12px; color: var(--c-success); }
.sap-preset-note { font-size: 11px; color: var(--wa-500); }
.sap-slot-row { display: flex; align-items: center; gap: 4px; margin-bottom: 3px; flex-wrap: wrap; }
.sap-slot-name { font-size: 10px; color: var(--wa-450); min-width: 44px; }
.sap-chip { font-size: 10px; padding: 1px 6px; border-radius: 3px; background: rgba(99,226,183,0.08); color: var(--c-success); cursor: pointer; }
.sap-chip.dim { background: var(--wa-30); color: var(--fg-2); }
.sap-axes { display: flex; flex-direction: column; gap: 14px; }
.sap-axis { background: var(--wa-20); border-radius: 8px; padding: 10px; border: 1px solid var(--wa-50); }
.sap-axis-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.sap-label { font-size: 10px; color: var(--wa-350); }
.sap-stat { font-size: 11px; color: var(--wa-450); margin-left: auto; }
/* 时间轴 */
.sap-timeline { position: relative; height: 106px; margin: 8px 0 12px; background: var(--wa-15); border-radius: 4px; user-select: none; touch-action: none; }
.sap-ticks { position: absolute; top: 0; left: 0; right: 0; height: 14px; }
.sap-tick { position: absolute; top: 0; height: 100%; border-left: 1px solid var(--wa-80); }
.sap-tick-label { position: absolute; top: 0; left: 2px; font-size: 8px; color: var(--wa-250); }
.sap-window-bar { position: absolute; top: 14px; left: 0; right: 0; height: 9px; background: rgba(240,160,32,0.08); border-radius: 2px; }
.sap-win-label { font-size: 8px; color: rgba(240,160,32,0.5); padding-left: 4px; }
.sap-lane { position: absolute; left: 0; right: 0; height: 19px; background: var(--wa-20); border-radius: 2px; }
.sap-lane-name { font-size: 8px; color: var(--wa-300); padding-left: 3px; }
.sap-block { position: absolute; height: 15px; border-radius: 2px; display: flex; align-items: center; padding: 0 3px; cursor: grab; overflow: hidden; border: 1px solid transparent; }
.sap-block-text { font-size: 8px; color: var(--wa-750); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
/* 明王时间轴标注：flex 排在块名后（不重叠），块名省略号收缩 */
.sap-block { display: flex; align-items: center; gap: 2px; }
.sap-block-text { flex: 1; min-width: 0; }
.sap-mw { flex-shrink: 0; font-size: 7px; line-height: 1; padding: 1px 2px; border-radius: 2px; pointer-events: none; white-space: nowrap; }
.sap-mw.mw-trigger { color: var(--c-warning-strong); background: rgba(240,160,32,0.15); }
.sap-mw.mw-live { color: var(--c-success); background: rgba(99,226,183,0.15); }
/* 明王平行道：触发块处 8s 窗口条（2层黄 / 3层绿），6命满覆盖 */
.sap-mw-lane { background: rgba(240,160,32,0.03); }
.sap-mw-window { position: absolute; top: 2px; height: 15px; border-radius: 2px; display: flex; align-items: center; padding: 0 4px; font-size: 8px; white-space: nowrap; overflow: hidden; pointer-events: none; }
.sap-mw-window.mw-l2 { background: rgba(240,160,32,0.35); border: 1px solid rgba(240,160,32,0.6); color: var(--fg-2); }
.sap-mw-window.mw-l3 { background: rgba(99,226,183,0.35); border: 1px solid rgba(99,226,183,0.6); color: var(--fg-2); }
.sap-mw-window.mw-full { background: var(--c-success-soft); border: 1px dashed rgba(99,226,183,0.4); color: var(--c-success); }
.sap-mw-banner { margin: 6px 0 8px; padding: 5px 8px; font-size: 10px; color: var(--wa-600); background: rgba(99,226,183,0.05); border: 1px solid rgba(99,226,183,0.15); border-radius: 4px; }
/* 优先级栈 */
.sap-stack { display: flex; flex-direction: column; gap: 3px; }
.sap-stack-row { display: flex; align-items: center; gap: 6px; padding: 2px 4px; background: var(--wa-20); border-radius: 3px; flex-wrap: wrap; }
.sap-prio { width: 22px; font-size: 11px; color: var(--wa-450); text-align: center; }
.sap-prio.top { color: var(--c-success); font-weight: 600; }
.sap-t { flex: 1; min-width: 130px; font-size: 11px; color: var(--wa-650); white-space: nowrap; font-variant-numeric: tabular-nums; }
.sap-t .sap-t-time { font-weight: 600; color: var(--wa-850); }
.sap-ops { display: flex; gap: 2px; }
.sap-stats { margin-top: 16px; padding: 10px; background: var(--wa-20); border-radius: 6px; }
.sap-stat-row { display: flex; gap: 14px; font-size: 12px; color: var(--wa-550); }
.sap-warn { font-size: 10px; color: #f0a020; }
.sap-block.stale { opacity: .35; border: 1px dashed var(--app-accent-gold); }
</style>
