/**
 * 队友 Buff 行的「**可交互性**」单一事实源（R65 §R64-J1）。
 *
 * ## 为什么有这个模块
 *
 * `hidden` 字段名撒了一个谎：它叫「隐藏」，但**全库没有任何渲染面读它**——
 * 它只在**数值通道**被消费（`core/inCombatBuffs.ts` / `core/buff.ts` 过滤掉该条，
 * 使数值由模块/helpers 单通道接入，防「同一效果算两遍」）。R64 实测三环全断：
 *   ① `deriveTeammateBuffEnabled`（`stores/config.ts`）零 `hidden` 判据 ⇒ `enabled` 仍 true；
 *   ② 属性配置页 `v-for="buff in group.buffs"` 不过滤 ⇒ 条目与覆盖率滑块照旧渲染；
 *   ③ 拨覆盖率三档总伤恒定 ⇒ 控件是纯装饰。
 * ⇒ 用户看到的是「**可点但拨了没反应**的控件」，与「机制没做」同形。
 *
 * 而 `hidden` 也**不是**这个缺陷的判据：R65 行为层普查实测，全库**另有 5 条**
 * `effects: []` 且 `buffModifiers: []` 的条（`jufufu.extra_ability_team_decibel` /
 * `grace_c1_team_energy` / `anby_zero_potential_followup` / `promethea_core_team_voidflare` /
 * `promethea_c1_extra_def_ignore`）——它们**没有** `hidden`，checkbox 同样拨不动任何读数
 * （三态 damagePoolRows 全行 sha256 逐位相同、总伤逐分相同）。
 * 它们的语义是「数值已由模块/helpers 接入，此条**仅作声明**」——与 `hidden` 同一件事，
 * 却因为少写一个字段而逃过数值通道过滤（幸好 `effects` 为空，过滤与否都不产生数值）。
 *
 * ## 结论：一个字段背了两件事，必须拆
 *
 * | 语义 | 字段 | 消费者 |
 * |---|---|---|
 * | 数值单源化（此条的数值**不要**进 collectInCombatTeamBuffs，防双计） | `singleSourced` | **数值通道** |
 * | 该行在 UI 上**可交互**吗（拨了会改数值吗） | **派生**（本模块） | **渲染面** |
 *
 * `singleSourced` 由原 `hidden` **改名**而来（逐条语义不变，只是名字说实话）；
 * 「可交互」不再靠人肉打标，而是**从数据本身派生**：一条先进入数值通道的条，
 * 只有在它有**可求值的** effects 或 buffModifiers 时才可能驱动读数。
 * ⇒ 不可能再出现「声明里忘了打某个字段 ⇒ 用户看见死控件」。
 *
 * ## 判据方向（两侧都不取自被测对象）
 *
 * 本模块只回答「**结构上有没有可求值的东西**」——这是**必要条件**，不是「拨了确实变」。
 * 「拨了确实变」由行为层判据承担（`specTeamBuffDeadControl.test.ts`：真管线三态读数）。
 * 两者成对：本模块挡住「结构上不可能有效果」的假控件；行为判据挡住「结构上有、但被覆写」的
 * （R64 的 velina 形态——它 `effects` 非空却仍拨不动，因此**本模块不声称能拦它**，
 * 那一类由 R64 的赋值覆写判据 + 本任的行为层全库普查承担）。
 *
 * @fact ui:队友Buff/可交互性 口径: 属性配置页的队友 buff checkbox/覆盖率滑块只在「该条会进数值通道（!singleSourced）且结构上存在可求值效果（effects 非空或 buffModifiers 非空）」时渲染；单一事实源 = src/utils/teammateBuffRows.ts#isTeammateBuffInteractive，数值通道过滤 = singleSourced（原 hidden 改名） | 据 实测@2026-09-20·R65 行为层普查（hidden 2/2 与 decl-only 5/5 三态读数逐位相同） | 验 src/utils/__tests__/teammateBuffRows.test.ts | 锚 src/utils/teammateBuffRows.ts#isTeammateBuffInteractive | 信 确认
 */
import type { TeammateBuff } from '@/types/catalog'

/**
 * 该条**是否会进入数值通道**（`core/inCombatBuffs.ts` / `core/buff.ts` 的过滤条件）。
 * `singleSourced === true` ⇒ 数值由模块/helpers 单通道接入，本条不进 collectInCombatTeamBuffs。
 */
export function entersNumericChannel(buff: Pick<TeammateBuff, 'singleSourced'>): boolean {
  return buff.singleSourced !== true
}

/**
 * 该条**结构上是否存在可求值的东西**。
 *
 * `effects` 非空 ⇒ 有数值可算；`buffModifiers` 非空 ⇒ 它虽自带 effects 为空，
 * 但会**放大别的条**（丽娜 C1 / 青衣 C2 / 凯撒 C2 / 潘引壶 C6 / 诺姆 C2 五条先例），
 * 因此拨它的 checkbox **确实**改数值（R65 probe D 实测：4/5 逐位不同）。
 * ⚠ 潘引壶 C6 那条实测恒等——那是**其目标条的承载条件不满足**（R62 第六句的仪器盲区），
 * 不是「结构上没有效果」⇒ 本判据**刻意不声称**能拦它（见头注「判据方向」）。
 */
export function hasComputablePayload(
  buff: Pick<TeammateBuff, 'effects' | 'buffModifiers'>,
): boolean {
  return (buff.effects?.length ?? 0) > 0 || (buff.buffModifiers?.length ?? 0) > 0
}

/**
 * 该条在 UI 上**可交互**（渲染 checkbox + 覆盖率滑块）吗？
 *
 * 两条同时成立才可交互：
 *   ① 它会进数值通道（`!singleSourced`）——单源化的条**按设计**不由用户拨；
 *   ② 它结构上有可求值的东西（`hasComputablePayload`）。
 *
 * ⚠ 反过来（可交互 ⇒ 拨了必变）**不成立**，本模块不声称——那需要行为层判据。
 * 本模块只保证「**不会渲染一个结构上根本不可能有效果的控件**」。
 */
export function isTeammateBuffInteractive(
  buff: Pick<TeammateBuff, 'singleSourced' | 'effects' | 'buffModifiers'>,
): boolean {
  return entersNumericChannel(buff) && hasComputablePayload(buff)
}

/** 渲染面用：过滤出该组里应渲染为「可交互行」的条 */
export function interactiveTeammateBuffs<T extends Pick<TeammateBuff, 'singleSourced' | 'effects' | 'buffModifiers'>>(
  buffs: readonly T[] | undefined,
): T[] {
  return (buffs ?? []).filter(isTeammateBuffInteractive)
}

/**
 * 渲染面用：该组里应渲染为「**仅声明行**」的条 —— 数值已由模块/helpers 接入，
 * UI 仍把条目与说明列出来（用户要知道这个机制存在），但**不给**拨不动的 checkbox/滑块。
 */
export function declaredOnlyTeammateBuffs<T extends Pick<TeammateBuff, 'singleSourced' | 'effects' | 'buffModifiers'>>(
  buffs: readonly T[] | undefined,
): T[] {
  return (buffs ?? []).filter(b => !isTeammateBuffInteractive(b))
}

/**
 * 「仅声明行」的**理由**文案（渲染面与判据共用同一事实源）。
 * 区分两种成因，用户与后继 agent 都能一眼看出**数值去哪儿了**：
 *   · `singleSourced` ⇒ 该条被显式标为数值单源化（数值在模块，本条防双计）；
 *   · 否则 ⇒ 本条 `effects` 为空，数值早已并入同组的另一条/模块通道（防双计留空）。
 */
export function declaredOnlyReason(
  buff: Pick<TeammateBuff, 'singleSourced' | 'effects' | 'buffModifiers'>,
): string {
  if (buff.singleSourced === true) return '数值由角色模块单通道接入（防双计）'
  return '数值已并入其它条目/模块通道（本条防双计，无独立数值）'
}
