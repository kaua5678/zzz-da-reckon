<template>
  <div class="tsc" :class="{ 'tsc-empty': presets.length === 0 }">
    <div class="tsc-head">
      <span class="tsc-title">每队配置码</span>
      <span class="tsc-hint">
        左 = 影画 0-6，右 = 精炼 0-5（<b>右位 0 = 无专武</b>，会穿下位）。留空 = 该槽不覆盖（走预设/加金）。
        改这里只影响这一支队，不写回预设库。
      </span>
    </div>
    <div v-if="presets.length === 0" class="tsc-none">先在「预设队伍」里勾几支队</div>
    <!-- 批量配置码（用户 2026-10-29：「配置码也支持批量修改，比如全填 01」）——写的是**页面级**
         覆盖（`teamSlotCodes`，压过预设/自定义队自带的码），作用对象 = 本区列出的这些队 -->
    <SlotCodeBatchBar
      v-else
      label="批量配置码"
      :scopes="batchScopes"
      :apply="applyBatchCells"
    />
    <div v-for="p in presets" :key="p.id" class="tsc-row">
      <span class="tsc-name" :title="p.name">{{ p.name }}</span>
      <div v-for="slot in SLOTS" :key="slot" class="tsc-slot">
        <n-input
          size="tiny"
          class="tsc-code"
          :value="store.entryOf(p.id).cells[slot]"
          :placeholder="slotPlaceholder(p, slot)"
          :status="invalidAt(p.id)[slot] ? 'error' : undefined"
          :title="cellTitle(p, slot)"
          @update:value="v => onCell(p.id, slot, v)"
        />
        <!-- 右位 0（无专武）才出现下位选择；「自动」= 下位表第一件（写明是哪件，不让人猜） -->
        <n-select
          v-if="needsDowngrade(p.id).includes(slot)"
          size="tiny"
          class="tsc-pick"
          :value="store.entryOf(p.id).downgrades?.[slot] ?? ''"
          :options="downgradeOptions(p, slot)"
          :title="'这件槽不带专武 ⇒ 选穿哪件下位音擎（「自动」= 下位表里该角色实战最常用的那件）'"
          @update:value="v => store.setDowngrade(p.id, slot, v === '' ? null : v)"
        />
      </div>
      <n-button
        size="tiny"
        quaternary
        :disabled="!store.activeOf(p.id)"
        :title="'清掉这支队的所有覆盖，回到预设自带配装'"
        @click="store.clear(p.id)"
      >清</n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * **每队配置码操作区**（用户 2026-10-26）。
 *
 * 用户原话：「难度曲线中，你给自定义队伍加了配置码。我想这里写成操作区，比如我从上面勾选的队伍
 * 也能写配置码。而且填 00 或者其他不带专武的配置时，我在哪里勾选下位武器呢？」
 *
 * ## 与旧「逐槽锁定」的区别（为什么替换掉它）
 *
 * 旧控件是**页面级三格**（槽1/槽2/槽3），一张图上所有队共用同一套覆盖 ⇒
 * 「诺姆30 队 vs 诺姆11 队」根本写不出来（两队会被写成同一套），而那正是用户要做的对比。
 * 现在按 **presetId** 存（`composables/teamSlotCodes`）：勾几支队就出现几行，各写各的。
 *
 * ## 「填 00 之后去哪选下位」
 *
 * 右位 0（无专武）的槽会**就地出现一个下位音擎下拉**：
 * · 默认「自动（炎炙沸釜）」= `data/downgradeWEngines` 的角色表 → 职业表第一件（0 次伤害求值）；
 * · 也能点名某一件（`downgradeWEngineId`），列表 = 该角色的下位候选全量。
 *
 * 这条不是装饰：`applySlotOverrides` 右位 0 时**绝不留空音擎**（空音擎实测比下位低 34~41%，
 * 那是「没带武器」而不是「没抽专武」）——UI 必须让人看见它到底穿了哪件。
 */
import { computed } from 'vue'
import { NButton, NInput, NSelect } from 'naive-ui'
import { useCatalogStore } from '@/stores/catalog'
import { invalidCells, slotsNeedingDowngrade, useTeamSlotCodes } from '@/composables/teamSlotCodes'
import SlotCodeBatchBar from '@/components/SlotCodeBatchBar.vue'
import { downgradeNameOf } from '@/composables/downgradeNaming'
import { downgradePoolFor } from '@/data/downgradeWEngines'
import {
  engineLabelOf, groupEnginesForAgent, partitionEngineIds, specialtyPoolOf, type EngineOption,
} from '@/composables/enginePicker'
import { setupCodeLabel } from '@/utils/setupCode'
import { localized } from '@/utils/format'
import type { TeamPreset } from '@/types/teamPreset'

const props = defineProps<{
  /** 页面上已勾选的队伍（预设库 + 自定义队合并解析后的结果） */
  presets: TeamPreset[]
}>()

const SLOTS = [0, 1, 2] as const
const store = useTeamSlotCodes()
const catalog = useCatalogStore()

/** 非法格标记：判定住 composables/teamSlotCodes#invalidCells（vitest 对 .vue 全盲，只能靠纯函数测） */
const invalidAt = computed(() => (id: string) => invalidCells(store.map.value[id]))

function onCell(id: string, slot: number, v: string) {
  store.setCell(id, slot, v)
}

/**
 * 批量写格（用户 2026-10-29：「配置码也支持批量修改，比如全填 01」）。
 *
 * 作用对象 = 本区已经列出的队伍（`presets`，即勾选清单，含预设库与自定义队）。只给一组，
 * 故组件不显示范围下拉——这一区本来就是「你勾了哪几支队就写哪几支」。
 */
const batchScopes = computed(() => [{ label: '已勾选队伍', ids: props.presets.map(p => p.id) }])
function applyBatchCells(text: string, slots: readonly number[], ids: readonly string[]): number {
  return store.setCellsMany(ids, slots, text)
}

/** 右位 0 的槽（需要选下位）：同一判定另有纯函数版（composables/teamSlotCodes#slotsNeedingDowngrade）供判据直测 */
function needsDowngrade(id: string): number[] {
  return slotsNeedingDowngrade(store.map.value[id])
}

function agentOf(p: TeamPreset, slot: number): string {
  return p.team[slot] ?? ''
}

function agentName(p: TeamPreset, slot: number): string {
  const id = agentOf(p, slot)
  if (!id) return SLOT_FALLBACK[slot]!
  const a = catalog.getAgent(id)
  return a ? localized(a.name, id) : id
}
const SLOT_FALLBACK = ['主C位', '击破位', '支援位'] as const

function slotPlaceholder(p: TeamPreset, slot: number): string {
  return agentName(p, slot)
}

/**
 * 该槽下位候选（2026-10-26 用户：「这个下拉菜单点进去太多了，能不能把同职业的放在前面，
 * 因为同职业才能触发武器效果」）。
 *
 * 排序口径 = 「能不能触发被动」优先（`enginePicker#engineTierOf`）：
 * · **✓ 同职业**：角色表里实战用过的那几件 + 该职业全部不占金件（顺序 = 表的频次序，不重排）；
 * · **× 其它职业**：折进第二组并标注「被动不触发」——留着是为了能比较"少一条被动差多少"。
 *
 * 第二组只收下位候选池里的件（不把全目录 85 件都塞进来：用户抱怨的就是"太多了"）。
 */
function downgradeOptions(p: TeamPreset, slot: number): EngineOption[] {
  const agentId = agentOf(p, slot)
  const specialty = catalog.getAgent(agentId)?.specialty
  const pool = downgradePoolFor(agentId, specialty)
  const auto = pool?.ids[0]
  // 候选 = 角色表 ∪ 该职业表（同职业兜底），去重保序
  const ids = [...new Set([...(pool?.ids ?? []), ...specialtyPoolOf(specialty)])]
  const { own, other } = partitionEngineIds(ids, id => catalog.getWEngine(id), specialty, agentId)
  return [
    ...groupEnginesForAgent([], specialty, agentId, {
      emptyLabel: auto ? `自动（${downgradeNameOf(catalog, auto)}）` : '自动（无候选）',
    }),
    { type: 'group', label: '✓ 同职业（被动可触发）', children: own.map(w => ({ value: w.id, label: engineLabelOf(w) })) },
    { type: 'group', label: '× 其它职业（被动不触发）', children: other.map(w => ({ value: w.id, label: engineLabelOf(w) })) },
  ].filter(o => {
    if (!('type' in o) || o.type !== 'group') return true
    const kids = o.children
    return Array.isArray(kids) && kids.length > 0
  }) as EngineOption[]
}

function cellTitle(p: TeamPreset, slot: number): string {
  const t = store.entryOf(p.id).cells[slot]
  const who = agentName(p, slot)
  if (t.trim() === '') return `${who}：不覆盖（走预设 / 加金）`
  const ov = store.overridesFor(p.id)[slot]
  if (!ov) return `${who}：格式错误——要两位数字（左命座 0-6 / 右精炼 0-5）`
  return `${who}：${setupCodeLabel(ov)}（右位 0 = 无专武 ⇒ 穿下位）`
}
</script>

<style scoped>
.tsc {
  margin-top: 8px;
  border-top: 1px dashed var(--line);
  padding-top: 8px;
}
.tsc-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.tsc-title {
  font-size: 12px;
  color: var(--fg-2);
}
.tsc-hint {
  font-size: 11px;
  color: var(--fg-3);
}
.tsc-none {
  font-size: 12px;
  color: var(--fg-3);
  margin-top: 6px;
}
.tsc-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.tsc-name {
  width: 168px;
  font-size: 12px;
  color: var(--fg-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tsc-slot {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tsc-code {
  width: 62px;
}
.tsc-pick {
  width: 132px;
}
</style>
