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
      <div class="sap-plan-banner" v-if="autoPreset || hasYidhari">
        <template v-if="autoActive && autoPreset">
          <span class="sap-plan-label">自动轴</span>
          <span class="sap-plan-name">{{ autoPreset.name }}</span>
          <span class="sap-plan-note">{{ autoPresetNote }}；手动应用预设/捏轴后自动让路</span>
        </template>
        <template v-else-if="configStore.autoYidhariAxis && !hasManualAxes">
          <span class="sap-plan-label">自动轴</span>
          <span class="sap-plan-name">未命中预设</span>
          <span class="sap-plan-note">当前队伍没有匹配的预设失衡轴{{ hasYidhari ? `（${autoChapterLabel}·${autoLiuyinLabel}）` : '' }}；给队伍捏轴并导出预设后自动生效</span>
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
            @click="addToCurrentAxis(s, act.moveId, act.promoteVariant, act.sourceTag)" :title="act.label+' 剩'+act.remaining">
            {{ act.label }} {{ act.remaining>0?'×'+act.remaining:'×0' }}
          </span>
        </div>
      </div>

      <!-- 轴列表 -->

      <div v-if="banyueSlot >= 0" class="sap-mw-banner">
        <template v-if="banyueCinema >= 6">般岳影画6：明王满覆盖（30s 任意强特常态刷新）→ 全队火伤 +39%，无需轴内标注。</template>
        <template v-else>般岳明王（非6命）：只有怒相技能「[怒]怒相连段（论道→狮子吼·怒）」（山威免费，4山威/怒相=2组）触发 8s 窗口（首次 2 层、窗口内再触发 3 层并刷新）；单招强特（[普]，20/40 闪能，回复嗔火）不触发但可享受窗口。触发块标「触发·明王8s」，底部明王道显示窗口时间条。</template>
      </div>
      <div v-if="yixuanSlot >= 0" class="sap-mw-banner">
        仪玄凝神（额外能力）：发动终结技（青溟云影/符法千重）后进入[凝神] 15s，窗口内动作暴伤+40%（般岳明王式 buff 轴扫描）；触发块标「凝神15s」，落窗动作标「凝神+40%」，底部凝神道显示窗口时间条。轴内凝云术/墨烬影消块自动标「+30%失衡」（额外能力·命中失衡敌人增伤）。
      </div>
      <div class="sap-axes" v-if="useAxes">
        <div v-for="(axis, ai) in axes" :key="ai" class="sap-axis">
          <div class="sap-axis-head">
            <n-input v-model:value="axis.name" size="small" style="width:130px" placeholder="轴名" />
            <span class="sap-label">×</span>
            <n-input-number v-model:value="axis.count" size="small" :min="0" :max="20" style="width:60px" :placeholder="'兜底'" />
            <span class="sap-label">次（空=兜底）</span>
            <span class="sap-label">兜底平A</span>
            <n-select :value="fillerValue(ai)" @update:value="v => setFiller(ai, v)" size="small" style="width:110px" :options="fillerOptions" />
            <span class="sap-label">初始异常</span>
            <n-select :value="axis.entryAnomaly ?? 0" size="small" style="width:96px" :options="entryAnomalyOptions"
              :disabled="hasPlans" :title="hasPlans ? '条件轴方案模式下只读' : undefined"
              @update:value="v => setEntryAnomaly(axis, v ?? 0)" />
            <n-input-number v-if="(axis.entryAnomaly ?? 0) > 0" :value="axis.entryGauge ?? 0" size="small" style="width:104px"
              :min="0" :max="100" :step="10" suffix="%" :disabled="hasPlans"
              @update:value="v => setEntryGauge(axis, v)" />
            <n-button size="tiny" quaternary type="warning" @click="axes.splice(ai,1)">删除</n-button>
            <span class="sap-stat">实际 ×{{ axisResult?.axisDetails?.[ai]?.times ?? '?' }} 次 · 单轮 {{ (axisResult?.axisDetails?.[ai]?.axisDuration ?? 0).toFixed(1) }}s · 窗口 {{ maxDur }}s</span>
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
              <span class="sap-win-label">失衡窗口 {{ maxDur }}s</span>
            </div>
            <div v-for="s in [0,1,2]" :key="s" class="sap-lane" :style="{ top: laneTop(s) }">
              <span class="sap-lane-name">{{ agentName(s) }}</span>
            </div>
            <!-- 明王平行道（限时 buff 可视化）：非6命触发块处画 8s 窗口条；6命满覆盖铺满 -->
            <div v-if="banyueSlot >= 0" class="sap-lane sap-mw-lane" :style="{ top: '84px' }">
              <span class="sap-lane-name">明王</span>
              <div v-if="banyueCinema >= 6" class="sap-mw-window mw-full" style="left:0;width:100%">满覆盖 +39%</div>
              <template v-else>
                <div v-for="w in mingwangWindowsFor(ai)" :key="w.key" class="sap-mw-window"
                  :class="w.layers >= 3 ? 'mw-l3' : 'mw-l2'"
                  :style="{ left: w.leftPct + '%', width: w.widthPct + '%' }">
                  <span v-if="w.widthPct > 7">明王×{{ w.layers }}层</span>
                </div>
              </template>
            </div>
            <!-- 凝神平行道（仪玄额外能力）：大招块触发处画 15s 窗口条 -->
            <div v-if="yixuanSlot >= 0" class="sap-lane sap-mw-lane" :style="{ top: '104px' }">
              <span class="sap-lane-name">凝神</span>
              <div v-for="w in ningshenWindowsFor(ai)" :key="w.key" class="sap-mw-window mw-l2"
                :style="{ left: w.leftPct + '%', width: w.widthPct + '%' }">
                <span v-if="w.widthPct > 7">凝神+40%</span>
              </div>
            </div>
            <div v-for="(act, aii) in axis.actions" :key="aii"
              class="sap-block"
              :style="blockStyle(act, aii === dragging?.aii)"
              @pointerdown.prevent="startDrag($event, ai, aii)">
              <span class="sap-block-text">{{ act.label || moveLabel(act.moveId) }}×{{ act.count }}{{ act.promoteVariant ? '·' + act.promoteVariant : '' }}{{ act.sourceTag === 'gift' ? '·赠' : '' }}</span>
              <span v-if="mingwangTag(ai, aii)" class="sap-mw" :class="mingwangTag(ai, aii)!.cls">{{ mingwangTag(ai, aii)!.text }}</span>
              <span v-if="ningshenTag(ai, aii)" class="sap-mw" :class="ningshenTag(ai, aii)!.cls">{{ ningshenTag(ai, aii)!.text }}</span>
              <span v-if="stunExTag(ai, aii)" class="sap-mw mw-trigger">{{ stunExTag(ai, aii)!.text }}</span>
            </div>
          </div>

          <!-- 动作列表（优先级栈：从上到下=优先级；改次数/转大变体/排序/删除） -->
          <div class="sap-stack" v-if="axis.actions.length > 0">
            <div v-for="(act, aii) in axis.actions" :key="aii" class="sap-stack-row">
              <span class="sap-prio" :class="{ top: aii === 0 }">{{ aii + 1 }}</span>
              <n-select v-model:value="act.slot" :options="slotOptions" size="tiny" style="width:92px" />
              <n-select v-model:value="act.moveId" :options="moveOptions(act.slot)" size="tiny" style="width:168px" @update:value="() => act.sourceTag = undefined" />
              <span>×</span>
              <n-input-number v-model:value="act.count" size="tiny" :min="1" :max="99" style="width:52px" />
              <n-select v-if="isPromotable(act.moveId)" :value="act.promoteVariant ?? ''" @update:value="v => act.promoteVariant = v || undefined" size="tiny" style="width:82px"
                :options="[{label:'常规',value:''},{label:'60转大',value:'60'},{label:'90转大',value:'90'}]" />
              <span v-if="act.moveId === '1371022'" class="sap-t" title="轴内凝云术蓄力时长（0-2s，可延长/缩短；倍率/耗能/daze 按秒均折算）">
                蓄力<n-input-number :value="act.duration ?? 2" :min="0" :max="2" :step="0.1" size="tiny" style="width:62px"
                  @update:value="v => act.duration = v ?? 2" />s
              </span>
              <span class="sap-t">
                <span class="sap-t-time">{{ actDurationText(act) }}</span>s · 起点 <span class="sap-t-time">{{ (act.startTime ?? 0).toFixed(1) }}</span>s
              </span>
              <span class="sap-ops">
                <n-button size="tiny" quaternary :disabled="aii===0" @click="moveAction(ai, aii, -1)">↑</n-button>
                <n-button size="tiny" quaternary :disabled="aii===axis.actions.length-1" @click="moveAction(ai, aii, 1)">↓</n-button>
                <n-button size="tiny" quaternary type="error" @click="axis.actions.splice(aii,1)">×</n-button>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 统计 -->
      <div v-if="axisResult && useAxes" class="sap-stats">
        <div class="sap-stat-row">
          <span>轴内失衡 {{ fmt(axisResult.totalInAxisStun,1) }}</span>
          <span>失衡次数 {{ axisResult.stunCount }} 次</span>
          <span>轴轮数 {{ axisResult.totalAxisRounds }} 轮</span>
          <span>覆盖率 {{ (axisResult.stunCoverage*100).toFixed(1) }}%</span>
        </div>
        <div v-if="axisResult.globalWarnings.length" style="margin-top:6px">
          <div v-for="(w,i) in axisResult.globalWarnings" :key="i" class="sap-warn">{{ w }}</div>
        </div>
        <div v-if="stack" style="margin-top:8px; border-top:1px dashed rgba(255,255,255,0.08); padding-top:6px">
          <div class="sap-stat-row">
            <span>轴内闪能消耗 {{ stack.energyUsed }} / {{ stack.totalEnergy }}</span>
            <span>喧响消耗 {{ stack.decibelUsed }} / {{ stack.totalDecibel }}</span>
            <span>实际窗口 {{ stack.windowsUsed }} / {{ stack.windowsUsed + stack.skipped.filter(s=>s.reason==='time').length }}</span>
          </div>
          <div v-for="(w,i) in stackWarnings" :key="i" class="sap-warn">{{ w }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NInput, NInputNumber, NSelect, NSwitch, useMessage } from 'naive-ui'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { getAgentMechanic } from '@/mechanics'
import { matchStunAxisPresets, cloneStunAxes, normalizeAxesForExport } from '@/data/stunAxisPresets'
import { allocateAxisWindows } from '@/core/stunAxisStack'
import { computeBanyueMingwangBlocks, BANYUE_AXIS_MOVE_META } from '@/mechanics/agents/banyue'
import { computeYixuanNingshenBlocks } from '@/mechanics/agents/yixuan'
import type { StunAxisPreset } from '@/data/stunAxisPresets'
import { fmt } from '@/utils/format'
import type { StunAxisAction, StunAxisPlan, StunAxis } from '@/types/resource'
import { BOSS_ENTRY_ANOMALY_OPTIONS } from '@/core/stunAxis/inStunAnomaly'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
const message = useMessage()
const { resourceResult, stunAxisResult: axisResult, stunPoolResult, stackTraversalResult: stack, matchedPlanName, effectiveStunAxes, autoPreset, autoActive, windowDuration } = useResourceCalc()

const hasTeam = computed(() => configStore.team.some(c => !!c.agentId))
// 通用自动轴：队伍匹配到预设失衡轴即自动选用（手动配置过轴时让路）
const hasYidhari = computed(() => configStore.team.some(c => c.agentId === '1051'))
const hasManualAxes = computed(() => configStore.stunAxisPlans.length > 0 || configStore.stunAxes.length > 0)
const yidhariCinema = computed(() => configStore.team.find(c => c.agentId === '1051')?.cinemaLevel ?? 0)
const autoChapterLabel = computed(() => (yidhariCinema.value >= 1 ? '1章（≥1命）' : '0章（0命）'))
const autoLiuyinLabel = computed(() => (configStore.team.some(c => c.agentId === '1481') ? '有琉' : '无琉'))
// 自动轴 banner 备注：章鱼体系显示 章×有琉，其余显示预设 note
const autoPresetNote = computed(() => {
  if (!autoPreset.value) return ''
  if (hasYidhari.value) return `${autoChapterLabel.value}·${autoLiuyinLabel.value}`
  return autoPreset.value.note || '队伍匹配预设失衡轴自动选用'
})
// 条件轴方案激活时，编辑器展示命中方案解析出的轴（只读展示，改动不写回方案本体）
const hasPlans = computed(() => configStore.stunAxisPlans.length > 0)
const axes = computed({
  get: () => hasPlans.value || autoActive.value ? effectiveStunAxes.value : configStore.stunAxes,
  set: (v) => { if (!hasPlans.value) configStore.stunAxes.splice(0, configStore.stunAxes.length, ...v) },
})
const useAxes = computed({
  get: () => configStore.useStunAxis || autoActive.value,
  set: (v) => {
    // 手动关闭：同时关掉章鱼自动轴，避免自动又把开关顶回来
    if (!v) configStore.autoYidhariAxis = false
    configStore.useStunAxis = v
  },
})
const matchedPresets = computed(() => matchStunAxisPresets(configStore.team.map(c => c.agentId)))
const stunTime = computed(() => configStore.enemy.stunTime ?? 12)
// 失衡窗口时长 = stunTime + 连携窗口(4) + 全队失衡延时（琉音+2、般岳C1+2 等），与引擎同口径
const maxDur = computed(() => windowDuration.value)
const ticks = computed(() => { const t: number[] = []; for (let i = 0; i <= maxDur.value; i += 2) t.push(i); return t })
const slotOptions = computed(() => [0, 1, 2].map(s => ({ label: agentName(s), value: s })))
// 般岳明王时间轴可视化：怒相二连块触发 8s 窗口（2层→3层刷新），块级标注触发/落窗层数；6命满覆盖单独提示
const banyueSlot = computed(() => configStore.team.findIndex(c => c.agentId === '1471'))
const banyueCinema = computed(() => (banyueSlot.value >= 0 ? configStore.team[banyueSlot.value]?.cinemaLevel ?? 0 : 0))
const banyueMingwangBlocks = computed(() => computeBanyueMingwangBlocks(axes.value, banyueSlot.value, banyueCinema.value))
function mingwangTag(ai: number, aii: number): { text: string; cls: string } | null {
  if (banyueSlot.value < 0 || banyueCinema.value >= 6) return null
  const info = banyueMingwangBlocks.value.get(`${ai}:${aii}`)
  if (!info) return null
  if (info.trigger) return { text: '触发8s', cls: 'mw-trigger' }
  if (info.layers > 0) return { text: `×${info.layers}层`, cls: 'mw-live' }
  return null
}
// 仪玄凝神时间轴可视化：大招块触发 15s 窗口（般岳明王式）；触发块标「凝神15s」、落窗动作标「凝神+40%」
const yixuanSlot = computed(() => configStore.team.findIndex(c => c.agentId === '1371'))
// 60/90 转大（好评把队友连携升级为终结技）是琉音专属机制，只有琉音在队时才给其他队友发转大块
const liuyinSlot = computed(() => configStore.team.findIndex(c => c.agentId === '1481'))
const yixuanNingshenBlocks = computed(() => computeYixuanNingshenBlocks(axes.value, yixuanSlot.value))
function ningshenTag(ai: number, aii: number): { text: string; cls: string } | null {
  if (yixuanSlot.value < 0) return null
  const info = yixuanNingshenBlocks.value.get(`${ai}:${aii}`)
  if (!info) return null
  if (info.trigger) return { text: '凝神15s', cls: 'mw-trigger' }
  if (info.active) return { text: '凝神+40%', cls: 'mw-live' }
  return null
}
// 失衡强特标注（额外能力）：轴内凝云术/墨烬影消块命中失衡敌人伤害+30%
function stunExTag(ai: number, aii: number): { text: string } | null {
  if (yixuanSlot.value < 0) return null
  const act = axes.value[ai]?.actions[aii]
  if (!act || act.slot !== yixuanSlot.value) return null
  if (act.moveId === '1371022' || act.moveId === '1371026') return { text: '+30%失衡' }
  return null
}
// 凝神平行道窗口条：大招块处画 15s 窗口
function ningshenWindowsFor(ai: number): { key: string; leftPct: number; widthPct: number }[] {
  if (yixuanSlot.value < 0) return []
  const axis = axes.value[ai]
  if (!axis) return []
  const win: { key: string; leftPct: number; widthPct: number }[] = []
  for (const [aii, act] of axis.actions.entries()) {
    if (act.slot !== yixuanSlot.value) continue
    if (act.moveId !== '1371014' && act.moveId !== '1371020') continue
    const start = act.startTime ?? 0
    win.push({
      key: `${ai}:${aii}`,
      leftPct: (start / maxDur.value * 100),
      widthPct: Math.max(2, (15 / maxDur.value * 100)),
    })
  }
  return win
}
// 明王平行道窗口条：该轴内触发块处画 8s 窗口（层数用块级扫描结果：窗口内再触发 → 3 层）
function mingwangWindowsFor(ai: number): { key: string; layers: number; leftPct: number; widthPct: number }[] {
  if (banyueSlot.value < 0 || banyueCinema.value >= 6) return []
  const axis = axes.value[ai]
  if (!axis) return []
  const win: { key: string; layers: number; leftPct: number; widthPct: number }[] = []
  for (const [aii, act] of axis.actions.entries()) {
    if (act.slot !== banyueSlot.value) continue
    if (act.moveId !== 'banyue-combo' && act.moveId !== 'banyue-combo-didong') continue
    const start = act.startTime ?? 0
    const info = banyueMingwangBlocks.value.get(`${ai}:${aii}`)
    win.push({
      key: `${ai}:${aii}`,
      layers: info?.layers ?? 2,
      leftPct: (start / maxDur.value * 100),
      widthPct: Math.max(2, (8 / maxDur.value * 100)),
    })
  }
  return win
}
const fillerOptions = computed(() => [{ label: '不填充', value: -1 }, ...slotOptions.value])
function fillerValue(ai: number): number { return axes.value[ai]?.basicFillerSlot ?? -1 }
function setFiller(ai: number, v: number) {
  const axis = axes.value[ai]; if (!axis) return
  if (v < 0) delete axis.basicFillerSlot
  else axis.basicFillerSlot = v
}

// 进窗初始异常状态/异常条（随预设导出；引擎取首个生效轴条目上的显式设置，未填回落全局 boss.*）
const ENTRY_ANOMALY_LABELS: Record<string, string> = { fire: '火', electric: '电', ice: '冰', ether: '以太', physical: '物理', wind: '风' }
const entryAnomalyOptions = [
  { label: '无', value: 0 },
  ...BOSS_ENTRY_ANOMALY_OPTIONS.filter(o => o.value > 0).map(o => ({ label: ENTRY_ANOMALY_LABELS[o.element] ?? o.element, value: o.value })),
]
// 自动命中/条件方案模式下展示的是解析副本，直接改不落盘（改动会被下一帧重算冲掉）——
// 自动模式下首次编辑把展示的轴物化为手动轴（自动轴让路）；条件方案无法写回，控件禁用
const editingEphemeral = computed(() => hasPlans.value || autoActive.value)
function ensureWritableAxis(axis: StunAxis): StunAxis | null {
  if (!editingEphemeral.value) return axis
  if (hasPlans.value) return null
  const idx = axes.value.indexOf(axis)
  if (idx < 0) return null
  const clones = cloneStunAxes(axes.value)
  configStore.stunAxes.splice(0, configStore.stunAxes.length, ...clones)
  message.info('已从自动命中的预设轴派生为手动轴，后续编辑直接生效')
  return configStore.stunAxes[idx]
}
function setEntryAnomaly(axis: StunAxis, v: number) {
  const target = ensureWritableAxis(axis); if (!target) return
  if (v > 0) target.entryAnomaly = v
  else {
    target.entryAnomaly = undefined
    target.entryGauge = undefined
  }
}
function setEntryGauge(axis: StunAxis, v: number | null) {
  const target = ensureWritableAxis(axis); if (!target) return
  target.entryGauge = v ?? undefined
}

// 栈遍历警告：资源不足（energy/decibel）= 固定轴只提示；超时（time）= 超窗截断
const stackWarnings = computed(() => {
  const sk = stack.value?.skipped ?? []
  return sk.map(s => {
    const name = moveLabel(s.moveId) || s.moveId
    if (s.reason === 'energy') return `闪能不足：${agentName(s.slot)}·${name} 超支，仍按固定轴计入（共消耗 ${stack.value!.energyUsed}/${stack.value!.totalEnergy}）`
    if (s.reason === 'decibel') return `喧响不足：${agentName(s.slot)}·${name} 超支，仍按固定轴计入（共消耗 ${stack.value!.decibelUsed}/${stack.value!.totalDecibel}）`
    return `超时截断：${agentName(s.slot)}·${name} 超出失衡窗口，该动作被舍弃`
  })
})

function pct(t: number): string { return (t / maxDur.value * 100) + '%' }
function laneTop(s: number): string { return (24 + s * 20) + 'px' }

function clonePlans(plans: StunAxisPlan[]): StunAxisPlan[] {
  return JSON.parse(JSON.stringify(plans))
}
function applyPreset(p: StunAxisPreset) {
  if (p.plans && p.plans.length > 0) {
    // 条件轴方案：整组替换方案列表，并清空手动轴
    configStore.stunAxisPlans.splice(0, configStore.stunAxisPlans.length, ...clonePlans(p.plans))
    configStore.stunAxes.splice(0, configStore.stunAxes.length)
  } else if (p.axes && p.axes.length > 0) {
    configStore.stunAxisPlans.splice(0, configStore.stunAxisPlans.length)
    configStore.stunAxes.splice(0, configStore.stunAxes.length, ...cloneStunAxes(p.axes))
  }
  configStore.useStunAxis = true
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
function axisTimes(ai: number): number {
  const stunCount = stunPoolResult.value?.stunCount ?? 0
  return allocateAxisWindows(axes.value, stunCount)[ai] ?? 0
}
const allMoves = computed(() => {
  const out: { slot: number; moveId: string; label: string; actionTime: number; remaining: number; key: string; promoteVariant?: '60' | '90'; sourceTag?: 'gift' }[] = []
  const chars = resourceResult.value?.characters ?? []
  const stunCount = stunPoolResult.value?.stunCount ?? 0
  for (const c of chars) {
    const basicTime = c.timeAllocation.basicAttackTime
    if (basicTime > 0) {
      let consumed = 0
      axes.value.forEach((ax, ai) => {
        for (const a of ax.actions) if (a.slot === c.slot && a.moveId === 'basic') consumed += a.count * axisTimes(ai)
      })
      out.push({ slot: c.slot, moveId: 'basic', label: '平A', actionTime: 1, remaining: Math.max(0, Math.floor(basicTime) - consumed), key: c.slot + ':basic' })
    }
    for (const exec of c.executions) {
      if (exec.moveId === 'basic_attack') continue
      // 伊德海莉的裸极寒重碾(1051012)从池里隐藏：用连段(单次/双次)表达能量消耗更准，避免误导闪能计算
      if (c.agentId === '1051' && exec.moveId === '1051012') continue
      // 固定轴：资源不足（count 0）的招式也显示为 ×0 灰色块，供轴放置/标记 60/90 转大；
      // 连携/赠送动作的可用数按失衡次数兜底（连携可用 = 失衡次数）。
      const mid = exec.moveId
      // 自身招式只统计「无转大变体」的轴内块，避免 60/90 转大块把常规终结技的次数吃掉
      let consumed = 0
      axes.value.forEach((ax, ai) => {
        for (const a of ax.actions) if (a.slot === c.slot && a.moveId === mid && !a.promoteVariant && (a.sourceTag === 'gift') === (exec.source === 'gift')) consumed += a.count * axisTimes(ai)
      })
      const skills = catalogStore.getAgentSkills(configStore.team[c.slot]?.agentId ?? '')
      const move = findMove(skills, mid)
      const rawName = exec.moveName?.replace(/（.*/g, '').trim() || mid
      const srcTag = exec.source === 'stun' ? '·失衡' : exec.source === 'gift' ? '·赠' : ''
      // 仪玄影画1落雷：按 CD（6s）自动算次数（轴模式按轴内时间，非轴按战斗时间）
      const cdTag = mid === '1371_c1_lightning' ? '·CD6s自动' : ''
      // 失衡强特增伤（额外能力）：凝云术/墨烬影消命中失衡敌人 +30%（轴内行 dmgBonus = 60核心被动 + 30失衡）
      const stunExTag = c.agentId === '1371' && (mid === '1371022' || mid === '1371026') ? '·+30%失衡' : ''
      let name = ((move?.name?.zhCN || rawName).slice(0, 8)) + srcTag + cdTag + stunExTag
      // 般岳怒/普分化：只写招式名（倍率随等级变不写；名字带「·怒」即 40 耗能，其余 20；连段块山威免费）
      if (c.agentId === '1471' && BANYUE_AXIS_MOVE_META[mid]) {
        const meta = BANYUE_AXIS_MOVE_META[mid]
        name = `[${meta.tag}]${move?.name?.zhCN || rawName}`
      }
      // 般岳 [普]/[怒] 强特：remaining 用资源预算推导（闪能/山威），不被「已捏反馈」锁成 0——
      // 玩家捏轴时看到的是「还能拉几个」，拉了才扣预算（普通强特耗闪能回嗔火，连段块耗山威免费）。
      let remaining = 0
      const cycle = c.banyueRageCycle
      const banyueMeta = c.agentId === '1471' ? BANYUE_AXIS_MOVE_META[mid] : undefined
      if (cycle && banyueMeta) {
        if (banyueMeta.tag === '怒') {
          // 连段块：山威配额 = 怒相次数 × 2 组（4 山威/怒相；官方预设自觉遵守，不硬限制）
          remaining = Math.max(0, cycle.rageCount * 2 - consumed)
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
  // + 触手（即使当前执行数为 0 也常驻显示）
  for (const c of chars) {
    const skills = catalogStore.getAgentSkills(c.agentId)
    const ultMove = findMoveByEn(skills, 'ultimate')
    if (ultMove && liuyinSlot.value >= 0 && c.agentId !== '1481') {
      for (const v of ['60', '90'] as const) {
        let consumed = 0
        axes.value.forEach((ax, ai) => {
          for (const a of ax.actions) if (a.slot === c.slot && a.moveId === ultMove.id && a.promoteVariant === v) consumed += a.count * axisTimes(ai)
        })
        out.push({ slot: c.slot, moveId: ultMove.id, label: '转大·' + v, actionTime: ultMove.actionTime ?? 0, remaining: Math.max(0, 9 - consumed), key: `${c.slot}:${ultMove.id}:promote:${v}` })
      }
    }
    const tentacle = findMove(skills, '1051024')
    if (tentacle) {
      let consumed = 0
      axes.value.forEach((ax, ai) => {
        for (const a of ax.actions) if (a.slot === c.slot && a.moveId === '1051024') consumed += a.count * axisTimes(ai)
      })
      out.push({ slot: c.slot, moveId: '1051024', label: '寒冰触手', actionTime: 0, remaining: Math.max(0, 9 - consumed), key: `${c.slot}:1051024:tentacle` })
    }
    // 诺姆膛温换连携（自动全打 floor(膛温/80)，块为轴内标记/占位，不控制次数）
    if (c.agentId === '1571') {
      let consumed = 0
      axes.value.forEach((ax, ai) => {
        for (const a of ax.actions) if (a.slot === c.slot && a.moveId === 'norma-hat-chain') consumed += a.count * axisTimes(ai)
      })
      out.push({ slot: c.slot, moveId: 'norma-hat-chain', label: '诺姆转连携', actionTime: 0, remaining: Math.max(0, 9 - consumed), key: `${c.slot}:norma-hat-chain` })
    }
    // 希格莉德破阵连段：连携命中失衡敌人后长按连放敛枪式一至三段（免费，不耗闪能/喧响）。
    // C6 加快 25% → 块时长 ×0.75；窗口时间门控自动决定「失衡内打了几段」（超窗段不吃易伤）。
    if (c.agentId === '1591') {
      const pzSkills = catalogStore.getAgentSkills(c.agentId)
      const pzSum = ['1591007', '1591008', '1591022'].reduce((sum, mid) => sum + (findMove(pzSkills, mid)?.actionTime ?? 0), 0)
      const pzScale = (configStore.team[c.slot]?.cinemaLevel ?? 0) >= 6 ? 0.75 : 1
      let consumed = 0
      axes.value.forEach((ax, ai) => {
        for (const a of ax.actions) if (a.slot === c.slot && a.moveId === 'sigrid-pozhen') consumed += a.count * axisTimes(ai)
      })
      out.push({ slot: c.slot, moveId: 'sigrid-pozhen', label: '破阵连段', actionTime: pzSum * pzScale, remaining: Math.max(0, 9 - consumed), key: `${c.slot}:sigrid-pozhen` })
    }
    // 连段（打包招式，如 单次/双次）：能量按打包口径一次扣（50/85），比裸强特（极寒重碾）的能量消耗更准
    const combos = getAgentMechanic(c.agentId)?.combos
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
        const isBanyueRageCombo = c.agentId === '1471' && (comboId === 'banyue-combo' || comboId === 'banyue-combo-didong')
        let consumed = 0
        let didongConsumed = 0
        axes.value.forEach((ax, ai) => {
          for (const a of ax.actions) {
            if (a.slot !== c.slot) continue
            if (a.moveId === comboId) consumed += a.count * axisTimes(ai)
            if (comboId === 'banyue-combo' && a.moveId === 'banyue-combo-didong') didongConsumed += a.count * axisTimes(ai)
          }
        })
        const rageQuota = c.banyueRageCycle ? c.banyueRageCycle.rageCount * 2 : 0
        const available = isBanyueRageCombo && c.banyueRageCycle
          ? comboId === 'banyue-combo'
            ? Math.max(0, rageQuota - didongConsumed - consumed)
            : Math.max(0, rageQuota - consumed)
          : Math.floor((c.exSpecialCount ?? 0) / exPerCombo)
        const comboLabel = isBanyueRageCombo
          ? `[怒]${combo.label}`
          : combo.label
        out.push({ slot: c.slot, moveId: comboId, label: comboLabel, actionTime, remaining: Math.max(0, available - consumed), key: `${c.slot}:${comboId}:combo` })
      }
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
function findMove(skills: any, mid: string): any {
  if (!skills) return null
  for (const cat of skills.categories ?? []) for (const m of cat.moves ?? []) if (m.id === mid) return m
  return null
}
function findMoveByEn(skills: any, enPart: string): any {
  if (!skills) return null
  for (const cat of skills.categories ?? []) for (const m of cat.moves ?? []) if ((m.name?.en ?? '').toLowerCase().includes(enPart)) return m
  return null
}
function actDuration(act: StunAxisAction): number {
  // 轴块 duration 覆盖倍率表 actionTime（仪玄轴内凝云术蓄力 0-2s 可调）
  const per = typeof act.duration === 'number' ? act.duration : (allMoves.value.find(m => m.slot === act.slot && m.moveId === act.moveId)?.actionTime ?? 0)
  return per * act.count
}
function actDurationText(act: StunAxisAction): string {
  const d = actDuration(act)
  return d > 0 ? d.toFixed(1) + 's' : '—'
}
function isPromotable(moveId: string): boolean {
  // 只有常规终结技（大招）块可选 60/90 转大变体；
  // 仪玄的符法千重（1371020）是术法值触发的额外终结技，不能被琉音转大
  if (moveId === '1371020') return false
  for (const s of [0, 1, 2]) {
    const skills = catalogStore.getAgentSkills(configStore.team[s]?.agentId ?? '')
    const move = findMove(skills, moveId)
    if (move && (move.name?.en ?? '').toLowerCase().includes('ultimate')) return true
  }
  return false
}

// ===== 拖拽（startTime） =====
const dragging = ref<{ ai: number; aii: number; startX: number; origStart: number } | null>(null)
function startDrag(e: PointerEvent, ai: number, aii: number) {
  const axis = axes.value[ai]; if (!axis) return
  const act = axis.actions[aii]
  dragging.value = { ai, aii, startX: e.clientX, origStart: act.startTime ?? 0 }
}
function onTimelineMove(e: PointerEvent, ai: number) {
  if (!dragging.value || dragging.value.ai !== ai) return
  const axis = axes.value[ai]; if (!axis) return
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
  if (hasPlans.value) { message.warning('条件轴方案为只读，请在 JSON 预设里修改方案'); return }
  configStore.stunAxes.push({ name: `轴${axes.value.length+1}`, actions: [] })
}
function addToCurrentAxis(s: number, mid: string, promoteVariant?: '60' | '90', sourceTag?: 'gift') {
  if (hasPlans.value) { message.warning('条件轴方案为只读，请在 JSON 预设里修改方案'); return }
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
  const axis = axes.value[ai]; if (!axis) return
  const to = aii + dir
  if (to < 0 || to >= axis.actions.length) return
  const arr = axis.actions
  const tmp = arr[aii]; arr[aii] = arr[to]; arr[to] = tmp
}
function agentName(s: number) {
  const c = configStore.team[s]; if (!c?.agentId) return `槽${s+1}`
  return catalogStore.getAgent(c.agentId)?.name?.zhCN?.slice(0, 5) || `槽${s+1}`
}
function axisStun(ai: number): number {
  const contribs = stunPoolResult.value?.contributions ?? []; let total = 0
  const axis = axes.value[ai]; if (!axis) return 0
  for (const act of axis.actions) {
    const hits = contribs.filter(c => c.moveId === act.moveId || (act.moveId === 'basic' && c.moveId === 'basic_attack'))
    const perHit = hits.length > 0 ? hits.reduce((s, c) => s + c.totalStun, 0) / hits.reduce((s, c) => s + c.count, 0) : 0
    total += perHit * act.count * axisTimes(ai)
  }
  return total
}
</script>

<style scoped>
.sap-root { width: 100%; min-height: 300px; padding: 16px 20px; }
.placeholder { text-align: center; color: rgba(255,255,255,0.3); padding: 60px 0; }
.sap-topbar { display: flex; align-items: center; margin-bottom: 14px; }
.sap-top-label { font-size: 12px; color: rgba(255,255,255,0.55); margin-left: 6px; }
.sap-plan-banner { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding: 6px 10px; background: rgba(99,226,183,0.07); border: 1px solid rgba(99,226,183,0.2); border-radius: 6px; }
.sap-plan-label { font-size: 10px; color: #63e2b7; }
.sap-plan-name { font-size: 12px; color: #63e2b7; font-weight: 600; }
.sap-plan-note { font-size: 10px; color: rgba(255,255,255,0.45); }
.sap-pool { margin-bottom: 16px; }
.sap-section-title { font-size: 11px; color: rgba(255,255,255,0.4); margin-bottom: 4px; }
.sap-presets { margin-bottom: 16px; padding: 10px; background: rgba(99,226,183,0.04); border: 1px solid rgba(99,226,183,0.12); border-radius: 6px; }
.sap-preset-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
.sap-preset-name { font-size: 12px; color: #63e2b7; }
.sap-preset-note { font-size: 11px; color: rgba(255,255,255,0.5); }
.sap-slot-row { display: flex; align-items: center; gap: 4px; margin-bottom: 3px; flex-wrap: wrap; }
.sap-slot-name { font-size: 10px; color: rgba(255,255,255,0.45); min-width: 44px; }
.sap-chip { font-size: 10px; padding: 1px 6px; border-radius: 3px; background: rgba(99,226,183,0.08); color: #63e2b7; cursor: pointer; }
.sap-chip.dim { background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.25); }
.sap-axes { display: flex; flex-direction: column; gap: 14px; }
.sap-axis { background: rgba(255,255,255,0.02); border-radius: 8px; padding: 10px; border: 1px solid rgba(255,255,255,0.05); }
.sap-axis-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.sap-label { font-size: 10px; color: rgba(255,255,255,0.35); }
.sap-stat { font-size: 11px; color: rgba(255,255,255,0.45); margin-left: auto; }
/* 时间轴 */
.sap-timeline { position: relative; height: 106px; margin: 8px 0 12px; background: rgba(255,255,255,0.015); border-radius: 4px; user-select: none; touch-action: none; }
.sap-ticks { position: absolute; top: 0; left: 0; right: 0; height: 14px; }
.sap-tick { position: absolute; top: 0; height: 100%; border-left: 1px solid rgba(255,255,255,0.08); }
.sap-tick-label { position: absolute; top: 0; left: 2px; font-size: 8px; color: rgba(255,255,255,0.25); }
.sap-window-bar { position: absolute; top: 14px; left: 0; right: 0; height: 9px; background: rgba(240,160,32,0.08); border-radius: 2px; }
.sap-win-label { font-size: 8px; color: rgba(240,160,32,0.5); padding-left: 4px; }
.sap-lane { position: absolute; left: 0; right: 0; height: 19px; background: rgba(255,255,255,0.02); border-radius: 2px; }
.sap-lane-name { font-size: 8px; color: rgba(255,255,255,0.3); padding-left: 3px; }
.sap-block { position: absolute; height: 15px; border-radius: 2px; display: flex; align-items: center; padding: 0 3px; cursor: grab; overflow: hidden; border: 1px solid transparent; }
.sap-block-text { font-size: 8px; color: rgba(255,255,255,0.75); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
/* 明王时间轴标注：flex 排在块名后（不重叠），块名省略号收缩 */
.sap-block { display: flex; align-items: center; gap: 2px; }
.sap-block-text { flex: 1; min-width: 0; }
.sap-mw { flex-shrink: 0; font-size: 7px; line-height: 1; padding: 1px 2px; border-radius: 2px; pointer-events: none; white-space: nowrap; }
.sap-mw.mw-trigger { color: #f0a020; background: rgba(240,160,32,0.15); }
.sap-mw.mw-live { color: #63e2b7; background: rgba(99,226,183,0.15); }
/* 明王平行道：触发块处 8s 窗口条（2层黄 / 3层绿），6命满覆盖 */
.sap-mw-lane { background: rgba(240,160,32,0.03); }
.sap-mw-window { position: absolute; top: 2px; height: 15px; border-radius: 2px; display: flex; align-items: center; padding: 0 4px; font-size: 8px; white-space: nowrap; overflow: hidden; pointer-events: none; }
.sap-mw-window.mw-l2 { background: rgba(240,160,32,0.35); border: 1px solid rgba(240,160,32,0.6); color: #ffd591; }
.sap-mw-window.mw-l3 { background: rgba(99,226,183,0.35); border: 1px solid rgba(99,226,183,0.6); color: #b7f5dd; }
.sap-mw-window.mw-full { background: rgba(99,226,183,0.12); border: 1px dashed rgba(99,226,183,0.4); color: rgba(99,226,183,0.7); }
.sap-mw-banner { margin: 6px 0 8px; padding: 5px 8px; font-size: 10px; color: rgba(255,255,255,0.6); background: rgba(99,226,183,0.05); border: 1px solid rgba(99,226,183,0.15); border-radius: 4px; }
/* 优先级栈 */
.sap-stack { display: flex; flex-direction: column; gap: 3px; }
.sap-stack-row { display: flex; align-items: center; gap: 6px; padding: 2px 4px; background: rgba(255,255,255,0.02); border-radius: 3px; flex-wrap: wrap; }
.sap-prio { width: 22px; font-size: 11px; color: rgba(255,255,255,0.45); text-align: center; }
.sap-prio.top { color: #63e2b7; font-weight: 600; }
.sap-t { flex: 1; min-width: 130px; font-size: 11px; color: rgba(255,255,255,0.65); white-space: nowrap; font-variant-numeric: tabular-nums; }
.sap-t .sap-t-time { font-weight: 600; color: rgba(255,255,255,0.85); }
.sap-ops { display: flex; gap: 2px; }
.sap-stats { margin-top: 16px; padding: 10px; background: rgba(255,255,255,0.02); border-radius: 6px; }
.sap-stat-row { display: flex; gap: 14px; font-size: 12px; color: rgba(255,255,255,0.55); }
.sap-warn { font-size: 10px; color: #f0a020; }
</style>
