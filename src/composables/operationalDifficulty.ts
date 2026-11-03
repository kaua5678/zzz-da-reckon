/** 操作难度的统一量尺；只依赖实打交互与引擎时间读数，不依赖比较/搜索入口。 */
import { teamCompareInteractionTypes } from '@/composables/agentMechanicView'
import { INTERACTION_WEIGHTS, type InteractionItem } from '@/types/teamPreset'
import { evalSandboxedFormula } from '@/utils/formulaSandbox'

/** 难度权重覆盖（见 TeamCompareOptions.difficultyWeights） */
export interface DifficultyWeights {
  interaction?: Record<string, number>
  /**
   * **时间压力权重**（难度点/秒，缺省 1）。时间压力 = **一个**秒数：
   * 引擎硬溢出 `overflowSeconds` + 合轴抵扣 `frontlineOccupationBreakdown().saved`。
   * 用户 2026-09-11 口径：「合轴本身就有难度，通过合轴来让溢出时间降低这俩其实是一个东西，
   * 允许溢出一部分的原因是队友可以合轴，而合轴的效果是总动作时间可以溢出一部分」——
   * 同一份必做前台超出窗口的秒数，一半被合轴吃掉、一半硬溢出，**不拆成两个自变量**
   * （拆开会把「用合轴换掉溢出」重复计一次，V 型曲线就是那个假象）。
   */
  timePressure?: number
  /**
   * ⚠ **已废弃**（2026-09-20 由逐类型公式取代，见 `interactionFormula` / `interactionExponent`）：
   * 原先这里是「全局一个指数」，无法表达「只有需怪攻击的交互才吃修正」——用户口径
   * 「仪玄的 e 弹、佩洛伊斯的完美格挡、般岳的金身弹刀和双反都需要怪物的一次攻击……这个我想让
   * 用户抉择，哪些是要吃非失衡占比的，让他自己编公式」。字段已删除（死通道扫描点名），
   * 需要全局行为请给所有类型设同一公式。
   */
  /**
   * **逐交互类型的难度公式**（用户口径 2026-09-20：「仪玄的 e 弹、佩洛伊斯的完美格挡、般岳的
   * 金身弹刀和双反都需要怪物的一次攻击，所以要算金（修正）。这个我想让用户抉择，哪些是要吃
   * 非失衡占比的，让他自己编公式」）。
   *
   * 键 = 交互类型（`INTERACTION_WEIGHTS` 的键）；值 = 公式字符串，缺省用该类型的默认公式。
   *
   * **可用变量**（与 `core/buff.ts#evalFormulaExpression` 同款沙箱：字符白名单 +
   * `clamp/floor/max/min`）：
   *  · `c` = 该项**次数**
   *  · `w` = 该项**权重**
   *  · `r` = **非失衡占比**（0..1，已钳到 ≥ `NON_STUN_RATIO_FLOOR`）
   *  · `k` = 该类型的指数（见 `interactionExponent`，缺省 1）
   *
   * 默认公式（未在表里的类型）= `c*w`（不修正，历史行为）。
   * 需怪攻击的类型（`BOSS_ATTACK_INTERACTIONS`）默认 = `c*w/pow(max(r,0.05),k)`。
   *
   * ⚠ **幂运算写 `pow(a,b)` 或 `a**b`**：JS 的 `^` 是**按位异或**，写成 `r^k` 会静默算出错值
   * （实测 `max(r,0.05)^k` 在 r=0.2 与 r=0.8 下得同一个数）。
   *
   * 例：
   *  · 只放大一半：`c*w/(0.5+0.5*r)`
   *  · 完全不吃修正：`c*w`
   *  · 平方惩罚：`c*w/pow(max(r,0.05),2)`
   */
  interactionFormula?: Record<string, string>
  /**
   * 逐类型的指数 `k`（公式里的 `k` 变量取值）。缺省：需怪攻击的类型 = 1，其余 = 0。
   * 单列它的理由 = 让用户在**不改公式**的前提下快速调强度（指数是常用旋钮）。
   */
  interactionExponent?: Record<string, number>
}

/**
 * **需要怪物出手一次**才能成立的交互类型 —— 它们的难度吃非失衡占比修正。
 *
 * 物理依据（用户口径 2026-09-20）：「失衡期怪物不攻击，没有交互机会。非失衡时间越少，
 * 怪物攻击越少，交互到足够次数的难度越大」——这些交互**吃的是怪物的出手**，
 * 故非失衡窗口越窄越难凑够同样次数，默认公式带 `÷非失衡占比^k`。
 *
 * ⚠ **2026-09-20 二次修正（用户指出）**：初版只列了角色专属的四类（仪玄 e 弹 / 佩洛伊斯完美格挡 /
 * 般岳金身弹刀 / 般岳双反），把**弹刀/闪避/格挡**错分成「玩家主动动作」。实测语义是：
 *  · `parry`（招架支援）= 挡 boss 攻击；
 *  · `dodge`（闪避反击）= 躲 boss 攻击；
 *  · `block`（格挡）= 格挡 boss 攻击；
 *  · `counterAssist`（角力/反制支援）= 化解 boss 控制技（一组连段攻击）。
 * 四者**都要求 boss 先出手** ⇒ 与角色专属那四类同源，一并吃修正。
 *
 * **不吃的几类**（语义上不依赖 boss 出手）：
 *  · `tauntCancel`（嘲讽取消）= 般岳自然后摇取消（**操作收益型**，权重 1.2；它不要求 boss 出手，
 *    只取决于玩家取消得准不准 ⇒ 不吃本修正）；
 *  · `claretBurialInterrupt`（克拉蕾·葬血强袭打断）= 同类操作收益型技巧（权重 1.2，同上不吃）。
 *
 * ⚠ 2026-10-26：`quickAssist`（快速支援）类型已**整体删除**（用户裁决「手动快支全都删了，这机制过时了」）
 * —— 它随 `quickAssistCount` 字段一起消失，权重 / 标签 / 引擎字段映射三处同时下线。
 *  ⚠ 2026-10-09 修正：`tauntCancel` 此前写成「配置类交互（weight 0）」——那是**错**的，它是操作收益型
 *    （取消得越准越省后摇、平A 时间越多、总伤越高），用户裁决权重 = 一次闪反（1.2）。
 *
 * ⚠ 这只是**默认值**：用户在「难度权重」弹层可逐项开关/改公式（用户明确要求可抉择）。
 */
export const BOSS_ATTACK_INTERACTIONS: readonly string[] = [
  // 通用四类：响应 boss 攻击（2026-09-20 二次修正补入）
  'parry',                // 弹刀（招架支援）
  'dodge',                // 闪避（闪避反击）
  'block',                // 格挡
  'counterAssist',        // 角力（反制支援，化解 boss 控制技连段）
  // 角色专属四类
  'yixuanPerfectBlock',   // 仪玄·e 弹（完美格挡）
  'perfectBlock',         // 佩洛伊斯·完美格挡
  'banyueGoldenParry',    // 般岳·金身弹刀
  'banyueDualCounter',    // 般岳·双反
  // 2026-10-22：赛维里安·自动闪避（a4 起手瞬间 / 前三段受击 ⇒ 打断 a4 自动发动烈旋）。
  // 与闪反/弹刀平行但要 boss 出手 ⇒ 吃非失衡占比修正。
  'severianAutoEvade',
] as const

/** 逐类型默认指数：需怪攻击的类型 = 1（线性），其余 = 0（不修正） */
export function defaultInteractionExponent(type: string): number {
  return BOSS_ATTACK_INTERACTIONS.includes(type) ? 1 : 0
}

/** 逐类型默认公式（未指定时） */
export function defaultInteractionFormula(type: string): string {
  // ⚠ 幂运算必须写 `**` 或 `pow(...)`——JS 的 `^` 是**按位异或**，`max(r,0.05)^k` 会静默算出
  // 错误值（实测 r=0.2 与 r=0.8 得同一个数）。沙箱已注入 `pow` 供用户书写。
  return defaultInteractionExponent(type) > 0 ? 'c*w/pow(max(r,0.05),k)' : 'c*w'
}

/**
 * 非失衡占比的下限（防 0 除）：占比低于它时按它算。
 * 取 0.05 = 「180s 里只有 9s 非失衡」——实战极端（长失衡轴）也不会更窄；再窄按地板计，
 * 避免难度爆到 Infinity 把散点/曲线轴撑坏。
 */
const NON_STUN_RATIO_FLOOR = 0.05

// @fact engine:操作难度/权重可调 口径: 难度 = Σ(交互次数×权重) + **时间压力秒×时间压力权重**（时间压力 = 引擎硬溢出 overflowSeconds + 合轴抵扣 saved —— 用户 2026-09-11「这俩其实是一个东西」：同一份「必做前台超出可用窗口的秒数」，合轴吃掉多少、硬溢出剩多少都只是这笔秒数的两种花法，故**只挂一个权重**）；交互权重与时间压力权重都只是默认值（INTERACTION_WEIGHTS / 1 秒=1 点），用户在对比页「难度权重」弹层自填覆盖（localStorage 持久化）；优先级 条目weight > 用户覆盖 > 默认表 | 据 用户@2026-09-04·口径合并@2026-09-11·复核@2026-09-25·锚未变@2026-09-27·复核@2026-09-30 | 验 src/composables/__tests__/teamCompare.test.ts::难度权重用户覆盖 | 锚 src/composables/operationalDifficulty.ts#computeDifficulty | 信 确认
// ⟳复核: 权重或时间压力量尺变化时复核曲线、散点与主页的同快照逐位一致 | 到期 2027-04-30
export const INTERACTION_LABELS: Record<string, string> = {
  parry: '弹刀',
  counterAssist: '反制支援（角力）',
  dodge: '闪避',
  severianAutoEvade: '自动闪避',
  block: '格挡',
  banyueGoldenParry: '般岳·金身弹刀',
  banyueDualCounter: '般岳·双反',
  // 2026-09-20：需怪攻击的两类补进难度轴（用户口径点名「仪玄的 e 弹、佩洛伊斯的完美格挡」）
  yixuanPerfectBlock: '仪玄·e 弹（完美格挡）',
  perfectBlock: '完美格挡',
  tauntCancel: '嘲讽取消',
  // 2026-10-09：克拉蕾·葬血强袭打断（角色专属交互，用户技巧）
  claretBurialInterrupt: '克拉蕾·葬血强袭打断',
}

/** 补全 0 值交互条目（内置三类型 + 队伍角色专属），让预设里为 0 的字段也显示出来，方便照抄字段填数字。 */
function completeInteractionList(interactions: InteractionItem[], team: (string | null | undefined)[]): InteractionItem[] {
  const present = new Set(interactions.map(i => i.type))
  const out = [...interactions]
  for (const t of ['parry', 'dodge'] as const) {
    if (!present.has(t)) out.push({ type: t, count: 0 })
  }
  // CC-68 / CC-258：角色专属交互类型 = 模块声明 interactionFieldTypes 的值（原写死般岳 id）
  for (const t of teamCompareInteractionTypes(team)) {
    if (!present.has(t)) out.push({ type: t, count: 0, slot: 0 })
  }
  return out
}

/**
 * 交互清单 → 难度 = Σ(count × weight) + **时间压力秒 × 时间压力权重**，附明细文案（含 0 值条目，标注 ×0 供照抄字段）。
 * 权重优先级：条目自带 weight > 用户覆盖 weights.interaction > INTERACTION_WEIGHTS 默认表（未知类型 1）。
 *
 * **时间压力 = 一项，不是一个自变量两个**（用户 2026-09-11 口径修正）：
 * `overflowSeconds`（引擎输出 = 合轴抵扣后必做前台净占用仍超窗口、被时间线截断掉的秒数）与
 * `alignSeconds`（`frontlineOccupationBreakdown().saved` = 合轴把队友前台压出去、解放成可用前台的秒数）
 * 是**同一笔秒数**的两种花法——**允许溢出一部分，正是因为队友可以合轴；合轴的效果就是总动作时间可以溢出一部分**。
 * 两者相加 = 必做前台秒 − 可用窗口秒，即这套轴「要塞进 180s 得挤出多少秒」。所以相加后**只乘一个权重**
 * （默认 1 秒 = 1 难度点，`weights.timePressure` 可调）：拿合轴换掉溢出不再被重复计一次
 * （原「溢出权重 + 合轴权重」两旋钮造成的 V 型假象，2026-09-11 删）。
 * `alignSeconds` 缺省 0 = 只算硬溢出（散点页口径不变）。
 */

/**
 * 难度公式求值器（逐交互类型，用户可自编）——沙箱与 `core/buff.ts#evalFormulaExpression` **同一份代码**
 * `utils/formulaSandbox.ts#evalSandboxedFormula`（CC-504）：字符白名单 + 仅注入
 * `clamp/floor/max/min/pow/abs/sqrt`（`pow` 必须有：JS 无幂运算符 `^`，见默认公式注释）。
 *
 * 为什么用白名单 + `Function` 而不是引第三方表达式库（规则 12 阶梯 ③）：
 *  · 仓库已有同款先例（`core/buff.ts` 的 spec `formula` 通道，服务几十个角色的录入），
 *    引库会多一个依赖且与既有口径分裂；
 *  · 白名单已挡住属性访问（`.` 后跟字母是允许的，但无对象可及）、模板串、注释等逃逸面；
 *    公式来自**用户自己的浏览器本地配置**（localStorage），不是远端输入。
 *
 * 变量（契约，改签名即改口径）：
 *  · `c` = 该项次数
 *  · `w` = 该项权重
 *  · `r` = 非失衡占比（0..1，已钳到 ≥ `NON_STUN_RATIO_FLOOR`）
 *  · `k` = 该类型指数（`DifficultyWeights.interactionExponent[type]` 或默认）
 *
 * 非法表达式/求值异常/结果非有限 ⇒ 返回 `c*w`（**退化为不修正**，不是 0——
 * 返回 0 会让用户一个笔误就把该项难度抹掉，静默且危险）。
 */
// @fact engine:操作难度/逐类型公式 口径: 难度公式**按交互类型逐项配置**（`DifficultyWeights.interactionFormula[type]`，缺省按类型默认）——**需要怪物一次攻击**的八类（`BOSS_ATTACK_INTERACTIONS`：通用四类 弹刀 / 闪避 / 格挡 / 角力 + 角色专属四类 仪玄 e 弹 / 佩洛伊斯完美格挡 / 般岳金身弹刀 / 般岳双反；通用四类为 2026-09-20 二次修正补入）默认 `c*w/pow(max(r,0.05),k)`（吃非失衡占比），其余默认 `c*w`（不吃）；变量 c=次数 w=权重 r=非失衡占比 k=指数；用户可逐项开关（写 `c*w` 即关闭）与自编公式；非法公式退化为 `c*w`（不修正，不是 0）| 据 用户@2026-09-20「仪玄的 e 弹、佩洛伊斯的完美格挡、般岳的金身弹刀和双反都需要怪物的一次攻击……这个我想让用户抉择，哪些是要吃非失衡占比的，让他自己编公式」·复核@2026-09-25·锚未变@2026-09-27·复核@2026-09-30·复核@2026-10-07 | 验 src/composables/__tests__/teamCompare.test.ts::逐类型公式 | 锚 src/composables/operationalDifficulty.ts#evalDifficultyFormula | 信 确认
// ⟳复核: `BOSS_ATTACK_INTERACTIONS` 名单（新增需怪攻击的角色机制时）、默认公式、或 `NON_STUN_RATIO_FLOOR` 再动时，复核「只对名单内类型修正（其余旧基线逐位不变）」+「非法公式退化不修正」两条 | 到期 2026-12-31
function evalDifficultyFormula(
  expression: string,
  c: number,
  w: number,
  rr: number,
  k: number,
): number {
  const fallback = c * w
  const expr = expression.trim()
  if (expr === '' || expr === 'c*w') return fallback
  const r = evalSandboxedFormula(expr, { c, r: rr, k, w })
  return r.ok && typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : fallback
}

export function computeDifficulty(
  interactions: InteractionItem[],
  team: (string | null | undefined)[] = [],
  overflowSeconds = 0,
  weights: DifficultyWeights = {},
  /** 合轴把队友前台压出去、解放成可用前台时间的秒数（`frontlineOccupationBreakdown().saved`）；缺省 0 = 不计 */
  alignSeconds = 0,
  /**
   * **失衡窗口占比**（0..1，缺省 0 = 不失衡/未测 ⇒ 不修正）。
   * 非失衡占比 = 1 − 本值；逐类型公式里的 `r` 变量（见 `DifficultyWeights.interactionFormula`）。
   * 调用方从 `stunWindowFraction(stunCount, windowDuration, effectiveTime)` 取（单一事实源）。
   */
  stunWindowRatio = 0,
): { difficulty: number; detail: string } {
  const items = completeInteractionList(interactions, team)
  /**
   * 非失衡占比（0..1，钳到地板防 0 除）——逐类型公式里的 `r` 变量。
   * 用户口径 2026-09-20：「非失衡占比应该是被除数，越低难度越大」。
   */
  const nonStunRatio = Math.max(
    NON_STUN_RATIO_FLOOR,
    Math.min(1, 1 - Math.max(0, Math.min(1, stunWindowRatio))),
  )
  let total = 0
  let interactionTotal = 0
  const parts: string[] = []
  for (const it of items) {
    const weight = it.weight ?? weights.interaction?.[it.type] ?? INTERACTION_WEIGHTS[it.type] ?? 1
    /**
     * **逐类型公式**（用户口径 2026-09-20：「仪玄的 e 弹、佩洛伊斯的完美格挡、般岳的金身弹刀和
     * 双反都需要怪物的一次攻击，所以要算修正。这个我想让用户抉择，哪些是要吃非失衡占比的，
     * 让他自己编公式」）：
     *  · `weights.interactionFormula[type]` 优先（用户自编）；
     *  · 否则按类型默认：需怪攻击的四类（`BOSS_ATTACK_INTERACTIONS`）= `c*w/max(r,0.05)^k`，
     *    其余 = `c*w`（不修正，历史行为）。
     * 这是「逐项可抉择」的落点——用户既能开关（改成 `c*w`），也能改形式。
     */
    const exponent = weights.interactionExponent?.[it.type] ?? defaultInteractionExponent(it.type)
    const expr = weights.interactionFormula?.[it.type] ?? defaultInteractionFormula(it.type)
    const value = evalDifficultyFormula(expr, it.count, weight, nonStunRatio, exponent)
    interactionTotal += value
    if (weight <= 0) continue // 权重 0 的交互不进难度明细（现在没有默认 0 的类型；用户可在权重弹层把某项调成 0）
    const label = it.label ?? INTERACTION_LABELS[it.type] ?? it.type
    parts.push(`${label}${it.count}×${weight}`)
    // 结果与裸和不同（= 公式真的起了作用）才打修正明细，用户看得见自己编的公式生效了。
    // ⚠ 判据用「值不等」而不是「表达式非默认」：r=0 时非失衡占比钳到 1，公式虽非默认但结果
    // 与 c*w 相同——那种情况打「修正→7.5」是噪音（实测旧判据在无占比数据时也打）。
    if (it.count > 0 && Math.abs(value - it.count * weight) > 1e-9) {
      parts.push(`${label}修正→${Math.round(value * 100) / 100}`)
    }
  }
  total += interactionTotal
  // 时间压力 = 硬溢出 + 合轴抵扣（同一笔秒数，见函数头）：默认 1 秒 = 1 难度点，只挂一个权重
  const hard = Math.max(0, overflowSeconds)
  const align = Math.max(0, alignSeconds)
  const pressure = hard + align
  if (pressure > 0) {
    const pw = weights.timePressure ?? 1
    if (pw > 0) {
      const split = [
        align > 0 ? `合轴抵扣${Math.round(align * 10) / 10}` : '',
        hard > 0 ? `硬溢出${Math.round(hard * 10) / 10}` : '',
      ].filter(Boolean).join('+')
      total += pressure * pw
      parts.push(`时间压力${Math.round(pressure * 10) / 10}s(${split})×${pw}`)
    }
  }
  return { difficulty: Math.round(total * 100) / 100, detail: parts.join(' + ') || '无交互' }
}

