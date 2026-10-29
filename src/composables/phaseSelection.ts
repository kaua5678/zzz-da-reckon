/**
 * 「页面/卡片当前显示**哪一期**」的唯一实现（2026-10-29）：属性配置页的环境卡与 Boss 选择卡共用。
 *
 * ## 为什么需要它（用户实报）
 * 实战对比页「部署」写的是**归档快照里那一季**的房间（2026-10-29 快照最新一季 = 690481），而期视图最新一期
 * 是 690501（归档里一条 run 都没有）⇒ 两个卡各自「默认 = 最新一期」时，部署完切到属性配置页：
 * Boss 卡不显示「已应用」、环境卡报「本期还没有应用 Boss」，而 store 里 Boss 房间与 layer-buff 行**都已写好**
 * （实测 appliedBoss=40012/690481 + 2 行 layer-buff enabled）——页面和 store 各说各话。
 *
 * ## 口径
 * 显示期 = **用户手选的** ＞ **已应用 Boss 的房间相位**（限候选里真有的期，避免摆一个不存在的期出来）
 * ＞ 候选首项（调用方按新→旧给 = 最新一期）。
 *
 * 用响应式实现（而不是进入页面时赋值一次）：期视图与 `appliedBoss` 都是「数据晚到 / 随时可变」的，
 * 派生写法两页都不用再挂 watcher，也不会出现「赋值后被自己的 watcher 改回最新期」。
 *
 * @fact ui:属性配置页/默认期 口径: 显示期 = 用户手选 ＞ 已应用 Boss 的房间相位（限候选里真有的期）＞ 候选首项（最新一期） | 据 用户实报@2026-10-29（部署后切页 Boss/buff 不显示） | 验 src/composables/__tests__/phaseSelection.test.ts | 锚 src/composables/phaseSelection.ts#defaultPhaseIdOf | 信 确认
 * ⟳复核: 归档快照追平到期视图最新一期后（判别性消失），复核「默认期仍跟随已应用房间」是不是用户想要的默认；若用户更想要「进页面先看最新一期、已应用房间只作提示」，改这里 | 到期 2027-01-31
 */
import { computed, ref, type ComputedRef } from 'vue'

/** 默认期：已应用房间的期（限 `listed` 里有的）＞ `listed` 首项；候选空 = 空串（页面自行显示空态） */
export function defaultPhaseIdOf(listed: readonly string[], appliedPhaseId: string | null | undefined): string {
  if (appliedPhaseId && listed.includes(appliedPhaseId)) return appliedPhaseId
  return listed[0] ?? ''
}

export interface PhaseSelection {
  /** 当前显示的期（用户手选 ＞ 默认） */
  selected: ComputedRef<string>
  /** 手选一期；不在候选里 = 忽略（不允许摆一个选不出来的期） */
  pick: (phaseId: string) => void
}

/**
 * @param listed         候选期 id，**按新→旧**（首项 = 最新一期）
 * @param appliedPhaseId 已应用 Boss 的房间相位（`configStore.appliedBoss?.phaseId`）
 */
export function usePhaseSelection(
  listed: () => readonly string[],
  appliedPhaseId: () => string | null | undefined,
): PhaseSelection {
  /** 用户手选过的期（null = 跟随默认） */
  const picked = ref<string | null>(null)
  const selected = computed(() => picked.value ?? defaultPhaseIdOf(listed(), appliedPhaseId()))
  function pick(phaseId: string) {
    if (listed().includes(phaseId)) picked.value = phaseId
  }
  return { selected, pick }
}
