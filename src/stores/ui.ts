/**
 * 界面态 Store（CC-356，2026-10-02 arena-E r386）：当前页签、队伍配置页选中的槽位。
 *
 * 从 config store 搬出来的原因：它们**不是计算输入**。住在 config 里时，calcOutput 记忆化键要特判排除
 * （原 `CALC_MEMO_KEY_EXCLUDE`）、独立分析场景的出生态要白白复制、`$state` 快照（难度曲线会话缓存键）
 * 会因切槽而失配。搬走后 config `$state` = 全部计算输入，记忆化键直接取整个 `$state`。
 *
 * 规则：引擎 / 管线 / 分析器不得读本 store（槽位要作为参数传进去）；新的纯界面态放这里，不放 config。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  /** 当前页签（AppHeader 切换、CalculatorView 按它渲染页面） */
  const activeTab = ref<string>('team')
  /** 队伍配置页 / 调试页当前编辑的槽位 */
  const selectedSlot = ref<number>(0)

  function selectSlot(slot: number) {
    selectedSlot.value = slot
  }

  return { activeTab, selectedSlot, selectSlot }
})
