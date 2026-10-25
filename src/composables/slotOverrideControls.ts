/**
 * 「逐槽锁定」的页面状态（队伍对比页散点图型）。
 *
 * 口径在 `presetSlotOverrides.ts`（纯函数，可单测）；这里只管**页面态**：
 *  三格文本输入（配置码）→ 解析 → `SlotOverrides`，localStorage 持久化。
 *
 * 为什么是「文本 + 解析」而不是三个下拉：配置码是**用户已有的心智模型**（自由对比页同款，
 * `utils/setupCode.ts` 同一套解析），手打 `21` 比点两次下拉快；留空 = 不锁（= 完全走原路径），
 * 所以默认态就是「什么都没锁」，快路径零成本（用户 2026-10-25「默认肯定要快速」）。
 *
 * 默认值刻意做成**空串**：`SlotOverrides` 全 null ⇒ `applySlotOverrides` 原样返回同一个 preset
 * ⇒ 引擎侧逐位不变（见 `presetSlotOverrides.test.ts` 的 `toBe` 判据）。
 */
import { computed, type Ref } from 'vue'
import { persistedRef } from '@/composables/persistedRef'
import type { SlotOverrides } from '@/composables/presetSlotOverrides'
import { parseSetupCode, setupCodeLabel, type SetupCode } from '@/utils/setupCode'

export const SLOT_OVERRIDE_KEY = 'zzz-compare-slot-overrides:v1'
export const SLOT_NAMES = ['槽1', '槽2', '槽3'] as const

/** 三格配置码文本（缺省空串 = 不锁） */
export type SlotOverrideText = [string, string, string]

/** 存档解析：只收三条字符串（非法码在 UI 侧标红、引擎侧按空处理，不在这里静默丢弃用户输入） */
function parseStored(stored: unknown): SlotOverrideText | undefined {
  if (!Array.isArray(stored) || stored.length !== 3) return undefined
  return stored.map(v => (typeof v === 'string' ? v : '')) as SlotOverrideText
}

/** 页面用的三格状态 + 解析结果（非法码 = 该格 `invalid`，引擎侧按「不锁」处理） */
export function useSlotOverrideControls() {
  const text: Ref<SlotOverrideText> = persistedRef<SlotOverrideText>(SLOT_OVERRIDE_KEY, parseStored, () => ['', '', ''])

  /** 每格解析结果（null = 空/非法 ⇒ 不锁） */
  const parsed = computed<readonly (SetupCode | null)[]>(() =>
    text.value.map(t => (t.trim() === '' ? null : parseSetupCode(t))),
  )
  /** 非法格（非空但解析不出来）——UI 标红，不写进 options */
  const invalid = computed<readonly boolean[]>(() =>
    text.value.map((t, i) => t.trim() !== '' && parsed.value[i] === null),
  )
  /** 传给引擎的锁定（非法格当「不锁」） */
  const overrides = computed<SlotOverrides>(() => [parsed.value[0]!, parsed.value[1]!, parsed.value[2]!])
  /** 是否有任何有效锁定（决定提示文案与「同金分配」表是否还有意义） */
  const activeCount = computed(() => parsed.value.filter(p => p !== null).length)

  /** 该格的悬浮说明：`21` → 「2命 精1」；空 → 「不锁」；非法 → 「格式错误」 */
  function hintOf(slot: number): string {
    if (invalid.value[slot]) return '格式错误：要两位数字（左命座 0-6 / 右精炼 0-5）'
    const p = parsed.value[slot]
    if (!p) return '不锁：该槽走预设/加金'
    return `锁定 ${setupCodeLabel(p)}（不计入加金预算）`
  }

  function setText(slot: number, v: string): void {
    const next = [...text.value] as SlotOverrideText
    next[slot] = v
    text.value = next
  }

  function reset(): void {
    text.value = ['', '', '']
  }

  return { text, parsed, invalid, overrides, activeCount, hintOf, setText, reset }
}
