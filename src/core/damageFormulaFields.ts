/**
 * **伤害公式白名单**（2026-10-21，用户两次纠正后重建）。
 *
 * ## 用户口径
 * 1. 「你要注意展示**用于伤害公式的值**，不要把什么能量上限这种水货放这。」
 * 2. 「**积蓄是积蓄乘区，相当于直接独立影响你的异常伤害，怎么能去掉呢。还有掌控抗性之类**。」
 *
 * ## 我第一版的错误（记录在此，防再犯）
 * 我最初按「有没有直接出现在 `core/damage.ts` / `anomalyPool/helpers.ts` 的字段读取里」判定，
 * 于是把 **异常掌控 / 积蓄效率 / 积蓄抗性** 判成水货——这是**只看终点不看链条**的错误：
 *
 *   单次积蓄量 = 基础积蓄 x 掌控区(floor(掌控)/100) x 积蓄效率区 x (1 - 积蓄抗性区/100)
 *   触发次数   = f(总积蓄量)
 *   异常伤害   = 单次异常伤害 × 触发次数
 *
 * ⇒ 掌控/积蓄效率/积蓄抗性**直接且独立地**决定异常伤害总量，是伤害公式的一部分。
 * 同理「元素增伤 / 元素抗性 / 元素防御」经 `panelElementStat` 进乘区，也必须在册。
 *
 * ## 判定规则（本文件即规则本身）
 * 一个面板字段算「伤害公式值」当且仅当它满足**任一**：
 * - **A. 基础量**：被当作伤害基底（`atk` / `hp`→贯穿力 / `def`→某类 profile）；
 * - **B. 乘区输入**：进增伤 / 暴击 / 防御穿透 / 抗性易伤 / 失衡易伤 / 异常增伤 / 异常掌控 / 积蓄效率 / 异化等乘区；
 * - **C. 结算参数**：异常持续时间（决定 DoT 总量）、紊乱倍率等直接改变结算量的量。
 *
 * **不算**的（典型「水货」）：能量上限/回复（只影响资源循环）、冲击力与失衡值加成（只影响失衡次数，
 * 不直接进伤害式；它通过时间间接影响，属「资源/时间」而非「伤害公式」）、各类开关与档位字段。
 *
 * 本表是**白名单**：不在表内的字段不进公式表。新增伤害乘区时必须同步登记，
 * 判据 attributeLedger.test.ts 里有「白名单与引擎实际读取字段」的对账。
 */

/**
 * 伤害公式值分组（= 公式表里的分区，也是「这个值在公式的哪一段」）。
 * 与 `FormulaZone` 不同：那是**属性归类**，这是**公式角色**。
 */
export type DamageFormulaRole =
  | '伤害基底'      // atk / hp（命破贯穿力）/ def
  | '增伤区'        // dmgBonus + 元素增伤
  | '暴击区'        // critRate / critDmg / sharpCritDmg / 异常暴击
  | '防御穿透区'    // penRatio / penFlat / 敌人防御降低
  | '抗性易伤区'    // 敌人抗性降低 / 易伤
  | '失衡易伤区'    // stunDmgMultiplier*
  | '异常乘区'      // 掌控 / 积蓄效率 / 积蓄抗性 / 异常增伤 / 紊乱 / 异化 / 耀变
  | '异常时长'      // 持续时间加成（决定 DoT 总量）

export interface DamageFormulaField {
  stat: string
  role: DamageFormulaRole
  /** 该字段在公式里的作用（一句话，展示层 tooltip 用） */
  note: string
}

/**
 * 白名单本体。
 *
 * 组织顺序 = 公式计算顺序（基底 → 增伤 → 暴击 → 防御 → 抗性 → 失衡 → 异常），
 * 与 `core/damage.ts` 的乘区顺序一致，便于逐段核对。
 */
export const DAMAGE_FORMULA_FIELDS: DamageFormulaField[] = [
  // ── A. 伤害基底 ──
  { stat: 'atk', role: '伤害基底', note: '普通直伤基底；命破贯穿力也吃 atk 系数' },
  { stat: 'hp', role: '伤害基底', note: '命破贯穿力 = atk×系数 + hp×系数 + 贯穿力提升' },
  { stat: 'def', role: '伤害基底', note: '部分 profile（如防御型）以防御为基底' },

  // ── B. 增伤区 ──
  { stat: 'dmgBonus', role: '增伤区', note: '通用增伤，与元素增伤/招式增伤加算' },

  // ── B. 暴击区 ──
  { stat: 'critRate', role: '暴击区', note: '直伤暴击期望' },
  { stat: 'critDmg', role: '暴击区', note: '直伤暴击伤害' },
  { stat: 'sharpCritDmg', role: '暴击区', note: '锋御（sharpen）profile 的暴伤口径' },

  // ── B. 防御穿透区 ──
  { stat: 'penRatio', role: '防御穿透区', note: '穿透率，进防御区' },
  { stat: 'penFlat', role: '防御穿透区', note: '穿透值，进防御区' },
  { stat: 'enemyDefReduction', role: '防御穿透区', note: '敌人防御降低（百分比）' },
  { stat: 'enemyDefFlatReduction', role: '防御穿透区', note: '敌人防御降低（固定值）' },

  // ── B. 抗性易伤区 ──
  { stat: 'enemyResReduction', role: '抗性易伤区', note: '敌人全属性抗性降低' },
  { stat: 'enemyDamageTakenBonus', role: '抗性易伤区', note: '敌人受到伤害提升（易伤）' },

  // ── B. 失衡易伤区 ──
  { stat: 'stunDmgMultiplierBonus', role: '失衡易伤区', note: '失衡易伤倍率（仅失衡内）' },
  { stat: 'stunDmgMultiplierBonusAlways', role: '失衡易伤区', note: '失衡易伤倍率（失衡外也生效）' },
  { stat: 'stunDmgMultiplierBonusCapAlways', role: '失衡易伤区', note: '失衡易伤倍率上限' },

  // ── B. 异常乘区（用户点名：积蓄是独立乘区、掌控/抗性都算）──
  { stat: 'anomalyProficiency', role: '异常乘区', note: '异常精通：进异常伤害乘区（精通/100）' },
  { stat: 'anomalyMastery', role: '异常乘区', note: '异常掌控：floor(掌控)/100 进**积蓄乘区**，直接决定触发次数→异常伤害总量' },
  { stat: 'anomalyBuildUpEfficiency', role: '异常乘区', note: '积蓄效率：进积蓄乘区（与掌控加算），直接决定触发次数' },
  { stat: 'enemyAnomalyResReduction', role: '异常乘区', note: '异常积蓄抗性降低：进积蓄抗性区，直接决定触发次数' },
  { stat: 'anomalyDmgBonus', role: '异常乘区', note: '异常伤害增伤' },
  { stat: 'windAnomalyDmgBonus', role: '异常乘区', note: '风化/风属性异常增伤（与通用异常增伤加算）' },
  { stat: 'disorderDamageBonus', role: '异常乘区', note: '紊乱增伤' },
  { stat: 'disorderBaseMultiplierBonus', role: '异常乘区', note: '紊乱基础倍率提升' },
  { stat: 'turbulenceDamageBonus', role: '异常乘区', note: '乱流伤害提升' },
  { stat: 'turbulenceResIgnore', role: '异常乘区', note: '乱流抗性无视' },
  { stat: 'anomalyCritRate', role: '异常乘区', note: '异常暴击率' },
  { stat: 'anomalyCritDmg', role: '异常乘区', note: '异常暴击伤害' },
  { stat: 'enemyAnomalyDefReduction', role: '异常乘区', note: '异常伤害无视防御' },
  // 角色专属字段（remielle* 等）**不在此登记**：core 层不得出现角色前缀字段（判据 22）。
  // 它们经 registerDamageFormulaFields() 由机制层注册（见文件末尾）。

  // ── C. 异常时长（DoT 总量 = 单跳 × 跳数，跳数 ∝ 时长）──
  { stat: 'anomalyDurationBonusSeconds', role: '异常时长', note: '异常持续时间延长：直接增加 DoT 跳数' },
]

/**
 * **角色专属字段的注册表**（机制层写入，core 只读）。
 *
 * 为什么要有这一层：`core/` 不许出现角色前缀字段（判据 22「角色知识回模块」）。
 * 但属性账确实要展示蕾米的异化度/耀变倍率这类**角色专属伤害乘区**——
 * 于是 core 只提供**注册接口**，具体字段名由角色模块自己声明（`mechanics/agents/*.ts` 里
 * `damageFormulaFields` 能力），core 不写死任何角色名。
 *
 * 键 = 字段名，值 = 展示说明。
 */
const ROLE_FIELD_REGISTRY = new Map<string, DamageFormulaField>()

/**
 * 注册角色专属的伤害公式字段（由机制层调用）。
 *
 * @example
 * // in mechanics/agents/remielle.ts
 * damageFormulaFields: () => [
 *   { stat: 'remielleRefringeCoefficient', role: '异常乘区', note: '蕾米异化度（全队拐）' },
 * ]
 */
export function registerDamageFormulaFields(fields: readonly DamageFormulaField[]): void {
  for (const f of fields) ROLE_FIELD_REGISTRY.set(f.stat, f)
}

/** 快速查表：stat → 白名单条目（通用字段 + 已注册的角色字段） */
export function damageFormulaFieldOf(stat: string): DamageFormulaField | undefined {
  return DAMAGE_FORMULA_BY_STAT.get(stat) ?? ROLE_FIELD_REGISTRY.get(stat)
}

/** 快速查表：通用字段 stat → 白名单条目 */
export const DAMAGE_FORMULA_BY_STAT: ReadonlyMap<string, DamageFormulaField> =
  new Map(DAMAGE_FORMULA_FIELDS.map(f => [f.stat, f]))

/** 某字段是否是「伤害公式值」 */
export function isDamageFormulaStat(stat: string): boolean {
  return damageFormulaFieldOf(stat) !== undefined
}
