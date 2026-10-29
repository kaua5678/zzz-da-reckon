<template>
  <div class="scb">
    <span class="scb-label">{{ label }}</span>
    <n-input
      class="scb-code"
      size="tiny"
      :value="code"
      placeholder="如 01"
      :status="invalid ? 'error' : undefined"
      :title="'两位数字：左 = 影画 0-6，右 = 精炼 1-5（右位 0 = 无专武）。例：01 = 0命本体 / 20 = 2命无专武 / 65 = 6命精5'"
      @update:value="v => { code = v; status = '' }"
    />
    <n-select
      v-if="scopes.length > 1"
      class="scb-scope"
      size="tiny"
      :value="scopeIndex"
      :options="scopeOptions"
      @update:value="v => { scopeIndex = Number(v); status = '' }"
    />
    <n-select
      class="scb-slots"
      size="tiny"
      multiple
      :value="slots"
      :options="SLOT_OPTIONS"
      :max-tag-count="3"
      title="批量写到哪几个槽位（默认三个槽全写）"
      @update:value="v => { slots = v as number[]; status = '' }"
    />
    <n-button size="tiny" :disabled="!canFill" :title="fillTitle" @click="fill">全填</n-button>
    <n-button size="tiny" quaternary :disabled="targetIds.length === 0" title="把选中的槽位清回「不覆盖」" @click="clearCells">清空槽</n-button>
    <span v-if="status" class="scb-status">{{ status }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * **批量配置码**（用户 2026-10-29：「配置码也支持批量修改，比如全填 01」）。
 *
 * 为什么抽成一个组件：本仓有两处「写配置码」的入口，存储层不同但**交互逐字相同**——
 * · `CustomTeamsEditor`（自定义队伍区）→ 写队伍自带的 `CustomTeamDef.slotCodes`（配置跟着队伍走）；
 * · `TeamSlotCodeEditor`（每队配置码操作区）→ 写页面级 `teamSlotCodes`（覆盖任何勾选的队，含预设库）。
 * 各写一份必然分叉（历史上这类跨组件克隆被 jscpd 抓过），所以这里只留「交互 + 校验」，
 * **写哪、写多少队由父组件的 `apply` 决定**（它返回实际改动数，组件据此给反馈）。
 *
 * 三条交互口径：
 * ① **非法码不写**（沿用逐格输入的同一条纪律：解析失败只在 UI 标红，不落盘）；
 * ② **作用对象是显式的**（多组时给下拉，如「全部自定义队伍 / 仅勾选」）——批量最危险的不是写错值，
 *    而是**写错了对象**（把别的队一起改了），所以范围必须看得见；
 * ③ **改了多少队要如实说**（0 也要说）：静默成功的批量操作，用户没法判断它到底生效没有。
 */
import { computed, ref } from 'vue'
import { NButton, NInput, NSelect } from 'naive-ui'
import { parseSetupCode } from '@/utils/setupCode'

const props = defineProps<{
  /** 前缀说明（两处用途各自说明作用对象与存储层） */
  label: string
  /** 可作用的对象分组（至少一组；多组时出现范围下拉，缺省第一组） */
  scopes: ReadonlyArray<{ label: string, ids: readonly string[] }>
  /** 给指定队伍 × 指定槽位批量写码（`''` = 清空该槽）；返回实际改动的队数 */
  apply: (text: string, slots: readonly number[], ids: readonly string[]) => number
}>()

const SLOT_OPTIONS = [
  { value: 0, label: '主C位' },
  { value: 1, label: '击破位' },
  { value: 2, label: '支援位' },
]

const code = ref('')
/** 三个槽全写 = 缺省（用户原话是「**全**填 01」） */
const slots = ref<number[]>([0, 1, 2])
const scopeIndex = ref(0)
const status = ref('')

const scopeOptions = computed(() => props.scopes.map((s, i) => ({ value: i, label: `${s.label}（${s.ids.length}）` })))
const targetIds = computed<readonly string[]>(() => props.scopes[scopeIndex.value]?.ids ?? [])
const invalid = computed(() => code.value.trim() !== '' && parseSetupCode(code.value) === null)
const canFill = computed(() => !invalid.value && code.value.trim() !== '' && slots.value.length > 0 && targetIds.value.length > 0)
const fillTitle = computed(() => {
  if (targetIds.value.length === 0) return '没有可作用的对象（先勾选或新建队伍）'
  if (code.value.trim() === '') return '先填两位配置码（如 01）'
  if (invalid.value) return '配置码格式错误：要两位数字（左命座 0-6 / 右精炼 0-5）'
  return `把 ${code.value.trim()} 写进 ${targetIds.value.length} 支队的 ${slots.value.length} 个槽`
})

function fill() {
  const n = props.apply(code.value.trim(), slots.value, targetIds.value)
  status.value = n > 0 ? `已写 ${n} 支队` : '码与现值相同，无需改动'
}
function clearCells() {
  const n = props.apply('', slots.value, targetIds.value)
  status.value = n > 0 ? `已清空 ${n} 支队` : '这些槽本来就是空的'
}
</script>

<style scoped>
.scb {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.scb-label {
  font-size: 11px;
  color: var(--fg-3);
}
.scb-code {
  width: 62px;
}
.scb-scope {
  width: 160px;
}
.scb-slots {
  width: 170px;
}
.scb-status {
  font-size: 11px;
  color: var(--fg-3);
}
</style>
