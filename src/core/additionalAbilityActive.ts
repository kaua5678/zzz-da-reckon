/**
 * 「面板上额外能力是否触发」的唯一读取口（CC-507，r689）。
 *
 * 事实源：`Panel.additionalAbilityActive: number` 只在 `composables/resourceCalc/panelPhases.ts`（`evalAdditionalAbility(...) ? 1 : 0`）
 * 写入，默认 0（`core/panel.ts`）⇒ 取值恒 0 / 1，「触发」= `> 0`。此前这条判定在 agents 下 ≥ 45 处各写一遍
 * `(panel.additionalAbilityActive ?? 0) > 0`（变体：`<= 0` 早退、`=== 1`、`Number(… ?? 0) > 0`、`> 0 ? 1 : 0`），
 * 编排层 `panelPhases.ts:333` 给钩子算 `additionalAbilityActive: boolean` 也是同一式。规则没有名字 ⇒ 第 46 份。
 *
 * 住 core：core 只许经 `mechanics/registry` 触达 mechanics（coreRuntimeDeps 锁），反向自由。
 * 不归这里：`specPanelBuffs.ts:151` 的 `?? 1`（未传 panel 的单测桩默认视为激活，是另一条缺省策略）；
 * `yeshuguang.ts` 把原始数值 `?? 0` 存进 cfg 的透传。
 */
export function additionalAbilityActiveOf(panel: { readonly additionalAbilityActive?: number } | null | undefined): boolean {
  return (panel?.additionalAbilityActive ?? 0) > 0
}
