<template>
  <div class="custom-teams">
    <div class="ct-head">
      <span class="ct-title">自定义队伍</span>
      <n-button size="tiny" secondary @click="onAdd">+ 新建</n-button>
      <n-button
        size="tiny"
        secondary
        :type="showGroup ? 'primary' : 'default'"
        title="固定两人 + 第三位多选候选 ⇒ 一次建一批队（如「挽昼+诺姆+X」逐个 X）"
        @click="showGroup = !showGroup"
      >创建组（批量建队）</n-button>
      <span v-if="store.defs.length > 0" class="ct-hint">共 {{ store.defs.length }} 支</span>
    </div>

    <!-- 创建组（用户 2026-10-29：「固定两人，剩下一个位置从某个位置里面多选，批量设置多个队伍」） -->
    <div v-if="showGroup" class="ct-group">
      <div class="ct-group-row">
        <span class="ct-group-label">变化槽位</span>
        <n-select
          class="ct-group-slot"
          size="tiny"
          :value="groupVarying"
          :options="varyingOptions"
          title="候选依次填进这一槽；另外两个槽由下面的「固定」决定"
          @update:value="v => { groupVarying = v as 0 | 1 | 2; groupStatus = '' }"
        />
        <template v-for="s in fixedSlots" :key="s">
          <span class="ct-group-label">固定·{{ SLOT_LABELS[s] }}</span>
          <n-select
            class="ct-group-agent"
            size="tiny"
            clearable
            filterable
            :value="groupFixed[s] ?? null"
            :options="agentOptions"
            :placeholder="SLOT_LABELS[s]"
            @update:value="v => { groupFixed[s] = v; groupStatus = '' }"
          />
        </template>
      </div>
      <div class="ct-group-row">
        <span class="ct-group-label">候选（多选）</span>
        <n-select
          class="ct-group-cands"
          size="tiny"
          multiple
          filterable
          max-tag-count="responsive"
          :value="groupCandidates"
          :options="agentOptions"
          placeholder="每个候选建一支队"
          @update:value="v => { groupCandidates = v; groupStatus = '' }"
        />
        <span class="ct-group-label">新队配置码</span>
        <n-input
          class="ct-code"
          size="tiny"
          :value="groupCode"
          placeholder="可留空"
          :status="groupCodeInvalid ? 'error' : undefined"
          title="选填：写进新建队伍的三个槽（两位数字：左影画 0-6 / 右精炼 1-5，如 01）；留空 = 三槽都不固定（走 01 基线/加金）"
          @update:value="v => { groupCode = v; groupStatus = '' }"
        />
        <n-button size="tiny" type="primary" :disabled="!canCreateGroup" :title="createTitle" @click="onCreateGroup">
          创建 {{ groupCandidates.length }} 支队
        </n-button>
        <span v-if="groupStatus" class="ct-group-status">{{ groupStatus }}</span>
      </div>
      <div class="ct-group-tip">
        {{ fixedSlots.map(s => `固定·${SLOT_LABELS[s]}`).join(' + ') }} + 候选逐个进「{{ SLOT_LABELS[groupVarying] }}」
        ⇒ <b>每个候选一支队</b>；成员与配置码都相同的队（已在清单里的）自动跳过并计入提示。
        新建的队伍会<b>自动勾选</b>，可直接去算难度曲线。
      </div>
    </div>

    <div v-if="store.defs.length === 0" class="ct-empty">
      还没有自定义队伍。新建后自填槽位成员（可留空），即可与预设队伍一起对比。
    </div>

    <div v-for="def in store.defs" :key="def.id" class="ct-row">
      <n-checkbox
        :checked="selectedIds.includes(def.id)"
        @update:checked="v => toggle(def.id, v)"
      />
      <n-input
        class="ct-name"
        size="tiny"
        :value="def.name"
        :placeholder="store.displayName(def)"
        @update:value="v => store.setName(def.id, v)"
      />
      <template v-for="slot in SLOTS" :key="slot">
        <n-select
          class="ct-slot"
          size="tiny"
          clearable
          filterable
          :value="def.team[slot] || null"
          :options="agentOptions"
          :placeholder="SLOT_LABELS[slot]"
          @update:value="v => store.setSlot(def.id, slot, v)"
        />
        <n-input
          class="ct-code"
          size="tiny"
          :value="codeText(def, slot)"
          :placeholder="'配置码'"
          :status="codeInvalid(def, slot) ? 'error' : undefined"
          :title="'该槽固定配装：左=影画 0-6、右=精炼 1-5（20 = 2命无专武）。留空 = 不固定（走 01 基线/加金）'"
          @update:value="v => onCode(def.id, slot, v)"
        />
      </template>
      <n-button size="tiny" quaternary type="error" @click="store.remove(def.id)">删</n-button>
    </div>

    <!-- 批量配置码（用户 2026-10-29：「配置码也支持批量修改，比如全填 01」）——写的是
         **队伍自带**的槽位码（CustomTeamDef.slotCodes，配置跟着队伍走） -->
    <SlotCodeBatchBar
      v-if="store.defs.length > 0"
      label="批量配置码"
      :scopes="batchScopes"
      :apply="applyBatchCodes"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 自定义队伍编辑器（用户 2026-10-11：「点了职业和属性后就不能加其他队伍了…这不够自由」）。
 *
 * 两个对比页（队伍对比 / 位置对比）共用本组件：**编辑 + 勾选**都在这，页面只负责把
 * `selectedIds` 接进自己的多选绑定。这样做的理由：两页的预设选择器已经是同一个 composable
 * （CC-482），自定义队再各写一份必然分叉（历史上这类跨页克隆被 jscpd 抓到过 32 行）。
 *
 * 模型与物化口径在 `composables/customTeams.ts`（自定义队 → TeamPreset）；本组件只管交互。
 * 空槽是有意的：引擎按位压缩（AGENTS §2），少于 3 人也能算，故不强制选满。
 *
 * ## 创建组（2026-10-29）
 *
 * 用户原话：「自定义队伍需要一个创建组的功能，固定两人，剩下一个位置从某个位置里面多选，
 * 批量设置多个队伍」。逐支手填三个下拉在「同两人 + 换第三个」这类对比里是纯体力活
 * （挽昼系一次十几支队），所以给一个**批量建队**入口：固定两人 + 候选多选 ⇒ 每候选一支队。
 * 语义与去重口径在 `customTeams.ts#createGroup`（含「码不同 ⇒ 是另一支队」这条）。
 */
import { computed, ref } from 'vue'
import { NButton, NCheckbox, NInput, NSelect } from 'naive-ui'
import { useCatalogStore } from '@/stores/catalog'
import { useCustomTeamsStore, CUSTOM_TEAM_PREFIX, type CustomTeamDef } from '@/composables/customTeams'
import SlotCodeBatchBar from '@/components/SlotCodeBatchBar.vue'
import { formatSetupCode, parseSetupCode } from '@/utils/setupCode'
import { localized } from '@/utils/format'

/**
 * 逐槽配置码的**编辑态**（用户 2026-10-25：「队友是固定65丽娜61克拉蕾」「比较同样克拉蕾和丽娜配置的
 * 不同配置诺姆的难度曲线」）。
 *
 * 为什么不把输入框直接绑到 store 的 `slotCodes`：配置码是**两位文本**，而 store 里存的是
 * `{cinema, wengine}`。输入过程中必然经过「只打了 1 位」的非法中间态——若直接写 store，
 * 那个中间态会被 parse 成 `null`（= 不固定），用户打第二个字符时锁已经悄悄解除了。
 * 所以文本留在组件本地，只有**解析成功**才写 store；留空 = 显式清空。
 *
 * ⚠ 批量写码（`applyBatchCodes`）之后必须**丢掉对应队伍的草稿**，否则输入框仍显示旧文本
 * （草稿是首次渲染时从 store 抄下来的，不丢就永远不回读）——用户会以为批量没生效。
 */
const codeDrafts = ref<Record<string, [string, string, string]>>({})

function draftOf(def: CustomTeamDef): [string, string, string] {
  const existing = codeDrafts.value[def.id]
  if (existing) return existing
  const fromStore = [0, 1, 2].map(i => {
    const c = def.slotCodes?.[i]
    return c ? formatSetupCode(c) : ''
  }) as [string, string, string]
  codeDrafts.value = { ...codeDrafts.value, [def.id]: fromStore }
  return fromStore
}

function dropDrafts(ids: readonly string[]) {
  const next = { ...codeDrafts.value }
  for (const id of ids) delete next[id]
  codeDrafts.value = next
}

function codeText(def: CustomTeamDef, slot: number): string {
  return draftOf(def)[slot]
}

function codeInvalid(def: CustomTeamDef, slot: number): boolean {
  const t = draftOf(def)[slot].trim()
  return t !== '' && parseSetupCode(t) === null
}

function onCode(id: string, slot: 0 | 1 | 2, text: string) {
  const def = store.byId(id)
  if (!def) return
  const cur = [...draftOf(def)] as [string, string, string]
  cur[slot] = text
  codeDrafts.value = { ...codeDrafts.value, [id]: cur }
  const code = text.trim() === '' ? null : parseSetupCode(text)
  // 非法中间态**不写 store**（保持上一次的有效值），只在 UI 标红
  if (text.trim() !== '' && code === null) return
  store.setSlotCode(id, slot, code)
}

const props = defineProps<{
  /** 已选队伍 id（与预设队共用一个数组；本组件只增删属于自定义队的那些） */
  selectedIds: string[]
}>()
const emit = defineEmits<{ 'update:selectedIds': [string[]] }>()

const store = useCustomTeamsStore()
const catalogStore = useCatalogStore()

/** 槽位号（0=主C / 1=击破 / 2=辅助，与预设库槽位约定一致） */
const SLOTS = [0, 1, 2] as const
const SLOT_LABELS = ['主C位', '击破位', '支援位'] as const

/** 角色下拉：全目录（含 hidden 之外的全部可见角色），标签 = 中文名 */
const agentOptions = computed(() =>
  catalogStore.displayAgents.map(a => ({ value: a.id, label: localized(a.name, a.id) })),
)

const selectedIds = computed(() => props.selectedIds)

function toggle(id: string, on: boolean) {
  const next = on
    ? [...props.selectedIds, id]
    : props.selectedIds.filter(x => x !== id)
  emit('update:selectedIds', next)
}

function onAdd() {
  const def = store.add()
  // 新建即勾选：用户点「+ 新建」的意图就是「把这队加进对比」，再让他手动勾一次是多余动作
  emit('update:selectedIds', [...props.selectedIds, def.id])
}

// ============ 创建组（批量建队）============
const showGroup = ref(false)
/** 变化槽位（缺省支援位：最常见的对比是「同两人、换第三个」） */
const groupVarying = ref<0 | 1 | 2>(2)
/** 固定成员（槽位 → 角色 id）；变化槽那一格不参与 */
const groupFixed = ref<Record<number, string | null>>({ 0: null, 1: null, 2: null })
const groupCandidates = ref<string[]>([])
const groupCode = ref('')
const groupStatus = ref('')

const varyingOptions = SLOTS.map(s => ({ value: s, label: SLOT_LABELS[s] }))
const fixedSlots = computed(() => SLOTS.filter(s => s !== groupVarying.value))
const groupCodeInvalid = computed(() => groupCode.value.trim() !== '' && parseSetupCode(groupCode.value) === null)
const canCreateGroup = computed(() => groupCandidates.value.length > 0 && !groupCodeInvalid.value)
const createTitle = computed(() => {
  if (groupCandidates.value.length === 0) return '先在「候选」里多选几个角色'
  if (groupCodeInvalid.value) return '配置码格式错误：要两位数字（左命座 0-6 / 右精炼 0-5）'
  return `建 ${groupCandidates.value.length} 支队：${fixedSlots.value.map(s => SLOT_LABELS[s]).join(' + ')} 固定，候选逐个进${SLOT_LABELS[groupVarying.value]}`
})

function onCreateGroup() {
  const code = groupCode.value.trim() === '' ? null : parseSetupCode(groupCode.value)
  const res = store.createGroup({
    varyingSlot: groupVarying.value,
    fixed: fixedSlots.value.map(s => ({ slot: s, agentId: groupFixed.value[s] ?? '' })),
    candidates: groupCandidates.value,
    code,
  })
  groupStatus.value = res.created.length > 0
    ? `已建 ${res.created.length} 支队${res.skipped > 0 ? `（跳过 ${res.skipped} 个：已有同队或目录里没有）` : ''}`
    : `没有新建（${res.skipped} 个候选都已有同队或目录里没有）`
  if (res.created.length > 0) emit('update:selectedIds', [...props.selectedIds, ...res.created])
}

// ============ 批量配置码 ============
/** 作用范围：默认全量，可选「仅勾选」——批量最危险的错误是**改错了对象**，范围必须看得见 */
const batchScopes = computed(() => [
  { label: '全部自定义队伍', ids: store.defs.map(d => d.id) },
  { label: '仅勾选', ids: props.selectedIds.filter(id => id.startsWith(CUSTOM_TEAM_PREFIX)) },
])

/** 写进队伍自带的 slotCodes（配置跟着队伍走）；text 为空 = 清这几个槽 */
function applyBatchCodes(text: string, slots: readonly number[], ids: readonly string[]): number {
  const code = text.trim() === '' ? null : parseSetupCode(text)
  const n = store.setCodesMany(ids, slots, code)
  dropDrafts(ids)
  return n
}
</script>

<style scoped>
.custom-teams { margin-top: 8px; }
.ct-head { display: flex; align-items: center; gap: 8px; }
.ct-title { font-size: 12px; color: var(--fg-2); }
.ct-hint { font-size: 11px; color: var(--fg-3); }
.ct-empty { font-size: 12px; color: var(--fg-2); margin-top: 6px; }
.ct-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.ct-name { width: 150px; }
.ct-slot { width: 118px; }
.ct-code { width: 68px; }
.ct-group {
  margin-top: 6px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
}
.ct-group-row { display: flex; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
.ct-group-row:first-child { margin-top: 0; }
.ct-group-label { font-size: 11px; color: var(--fg-3); }
.ct-group-slot { width: 92px; }
.ct-group-agent { width: 132px; }
.ct-group-cands { width: 260px; }
.ct-group-status { font-size: 11px; color: var(--fg-2); }
.ct-group-tip { font-size: 11px; color: var(--fg-3); margin-top: 6px; line-height: 1.5; }
</style>
