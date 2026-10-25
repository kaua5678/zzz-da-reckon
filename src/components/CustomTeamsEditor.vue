<template>
  <div class="custom-teams">
    <div class="ct-head">
      <span class="ct-title">自定义队伍</span>
      <n-button size="tiny" secondary @click="onAdd">+ 新建</n-button>
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
 */
import { computed, ref } from 'vue'
import { NButton, NCheckbox, NInput, NSelect } from 'naive-ui'
import { useCatalogStore } from '@/stores/catalog'
import { useCustomTeamsStore, type CustomTeamDef } from '@/composables/customTeams'
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
</script>

<style scoped>
.custom-teams { margin-top: 8px; }
.ct-head { display: flex; align-items: center; gap: 8px; }
.ct-title { font-size: 12px; color: var(--fg-2); }
.ct-empty { font-size: 12px; color: var(--fg-2); margin-top: 6px; }
.ct-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.ct-name { width: 150px; }
.ct-slot { width: 118px; }
.ct-code { width: 68px; }
</style>
