/**
 * 「初始 X」口径的唯一读取口（CC-497，r681）。
 *
 * 原文「初始攻击力 / 初始异常掌控 / 初始暴击率」= **局外面板**（未合并局内 buff 的 `outOfCombatPanel`），
 * 不是正在被叠 buff 的局内 `panel`。这条规则此前被 CC-118 / 123 / 124 / 125 / 126 / 128 六轮各自在一个模块里
 * 重新发现并修一次，每处写成 `(outOfCombatPanel ?? panel).X ?? 0`、注释互指「与 CC-1xx 同口径」——这里给它一个名字，
 * 新模块遇到「初始」字样直接调它，不再第七次发现。
 *
 * 回落规则（与原各处逐位一致）：`outOfCombatPanel` 缺省时读局内 `panel`，再缺省为 0。
 * - `AgentPanelInput.outOfCombatPanel` 类型上必填，但多处测试夹具以 cast 不带它（如 qianxia.test.ts:107/112），
 *   所以 applyPanel 侧也走同一回落；生产装配（`panelPhases.ts:534`）永远带。
 * - `AgentCharConfigInput.outOfCombatPanel` 可选（少数模块以局部参数转调基类、夹具不带）。
 * 不走本函数的两处（有意）：`claret.ts` 核心被动「初始暴伤」**不回落局内**（缺局外面板按 0，局内暴伤拐不参与转化）；
 * `xide.ts` 读的是**队友** cfg 上的 `outOfCombatPanel`（跨槽选先锋），不是本槽「初始 X」。
 */
import type { PanelValues } from '@/types/catalog'

export function initialStat<K extends keyof PanelValues>(
  outOfCombatPanel: { readonly [P in K]?: PanelValues[P] } | null | undefined,
  panel: { readonly [P in K]?: PanelValues[P] } | null | undefined,
  key: K,
): number {
  return Number((outOfCombatPanel ?? panel)?.[key] ?? 0)
}

/**
 * 「以局外面板 X 为基数」的严格读取口（CC-502，r684）：**不回落局内**、负值截 0。
 * 用于「局外攻击/生命/防御 × N%」这类**固定加成**——加进局内 `panel.X` 的是绝对量，不能走 `applyStat(panel,'xPct')`
 * （那会以当前局内值为基数整体乘，`panelPhases.ts:522` 记录过的「局内固定加成被错误放大」坑）。
 * 与 {@link initialStat} 的区别：那是「初始 X」口径（局外缺省回落局内，不截负）；这是「局外基数」口径（缺局外按 0）。
 * 此前 harumasa / vivian / zhao ×2 / zhendou / ben 六处各写 `Math.max(0, Number(outOfCombatPanel.X ?? 0))`，注释互指「同款」。
 */
export function outOfCombatStat<K extends keyof PanelValues>(
  outOfCombatPanel: { readonly [P in K]?: PanelValues[P] } | null | undefined,
  key: K,
): number {
  return Math.max(0, Number(outOfCombatPanel?.[key] ?? 0))
}
