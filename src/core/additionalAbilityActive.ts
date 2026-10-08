/**
 * 「面板上额外能力是否触发」的唯一读取口（CC-507，r689）。
 *
 * 事实源：`Panel.additionalAbilityActive: number` 只在 `composables/resourceCalc/panelPhases.ts`（`evalAdditionalAbility(...) ? 1 : 0`）
 * 写入，默认 0（`core/panel.ts`）⇒ 取值恒 0 / 1，「触发」= `> 0`。此前这条判定在 agents 下 ≥ 45 处各写一遍
 * `(panel.additionalAbilityActive ?? 0) > 0`（变体：`<= 0` 早退、`=== 1`、`Number(… ?? 0) > 0`、`> 0 ? 1 : 0`），
 * 编排层 `panelPhases.ts:333` 给钩子算 `additionalAbilityActive: boolean` 也是同一式。规则没有名字 ⇒ 第 46 份。
 *
 * 住 core：core 只许经 `mechanics/registry` 触达 mechanics（coreRuntimeDeps 锁），反向自由。
 * 模块钩子直接读 `additionalAbilityActiveOf(cfg.panel)`：`cfg.panel` 与 buildCharConfig 入参 `panel` 是同一对象。
 * applyPanel 拿到的 `panel` 派发前已写好标记，transformSkillExecutions 的 `panel` 也是本槽局内面板 ⇒ 同样只读标记，
 * 不要再调 `specAdditionalAbilityActive` 按 spec 重算（那是给 teammateBuffGate 这类面板之前的钩子用的，r760）。
 * 不要把判定结果抄进 cfg 字段或面板扩展字段（r759 删 16 个 cfg 镜像，r760 再删 3 个 cfg 镜像、2 个面板镜像；测试夹具经 `panel` 给值）。
 * 唯一例外 `cfg.velinaAdditionalAbilityActive`：spec 1561.json 的 `enabledField` 按名读 cfg，而 specs 层不得 import core（CC-248）。
 */
export function additionalAbilityActiveOf(panel: { readonly additionalAbilityActive?: number } | null | undefined): boolean {
  return (panel?.additionalAbilityActive ?? 0) > 0
}
