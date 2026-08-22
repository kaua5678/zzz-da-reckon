/**
 * 标准职业稀有度倍率表 —— 「倍率表系数演算记录」的数据基线（唯一事实源）。
 *
 * 口径：社区「1 级技能 A 级角色标准倍率表」+ 本仓库已验证的换算系数。
 * 模型：实际录入值(Lv12) = 标准式(const + perT×t [+ perE×e]) × 等级系数 × 稀有度系数 × 角色系数
 *   - t = move.actionTime（秒）；e = 强化特殊技耗能（energyCost 首个非持续项，见 multiplierCoefficients.parseEnergyCost）
 *   - 等级系数：伤害×2、失衡×1.5（1级表→12级表，同源引用 core/skillLevel.ts 的 LEVEL1_TO_LEVEL12）
 *   - 稀有度系数：限定S 1.1 / 常驻S 1.05 / A 1.0，只乘伤害与失衡两列；命破职业伤害另×0.8
 *   - 角色系数 = 实际 / 期望，即本体系要推导的目标（如爱丽丝失衡 0.9、伊德海莉喧响 ~0.5）
 *
 * 验证记录（2026-08，catalog.json 全量 60 角色只读验算）：13 类招式 × 失衡/喧响/积蓄/回能/秽盾
 * 五列的「实际/期望」中位数全部 ≈100%；强化特殊技伤害/秽盾中位数 ≈101%/100%（逐角色偏离属设计空间，
 * 由演算页呈现）。已知与数据存在系统性出入、暂按原表口径保留的条目见页面「待确认口径」区。
 */

/** 常驻 S 角色（获取不消耗限定金）。原定义在 teamCompare.ts，因标准表稀有度分档也要用，移到此为单一来源。 */
export const STANDARD_S_AGENT_IDS = new Set(['1021', '1041', '1101', '1141', '1181', '1211'])

/** 参与演算的倍率表行 id（catalog SkillRow.id） */
export type StandardRowId =
  | 'damage'
  | 'daze'
  | 'energy_recovery'
  | 'decibel_recovery'
  | 'anomaly_buildup'
  | 'ether_purify'

export const STANDARD_ROW_IDS: StandardRowId[] = [
  'damage',
  'daze',
  'energy_recovery',
  'decibel_recovery',
  'anomaly_buildup',
  'ether_purify',
]

/** 招式类型（标准表的行单位）。分类规则见 composables/multiplierCoefficients.classifyMove */
export type MoveType =
  | 'basic' // 普攻（弱/强不分段，伤害列仅作参考基准）
  | 'special' // 特殊技
  | 'exSpecial' // 强化特殊技（含耗能项）
  | 'dashAttack' // 冲刺攻击
  | 'dodgeCounter' // 闪避反击
  | 'quickAssist' // 快速支援
  | 'assistFollowUp' // 支援突击（纵向系数锚点：通常不随角色变化）
  | 'parryLight' // 招架支援 #1（轻招架）
  | 'parryHeavy' // 招架支援 #2（重招架）
  | 'parryChain' // 招架支援 #3（连续招架）
  | 'chain' // 连携技
  | 'ultimateAttack' // 强攻/支援/防护终结技
  | 'ultimateStun' // 击破终结技
  | 'ultimateAnomaly' // 异常终结技

export const MOVE_TYPE_LABELS: Record<MoveType, string> = {
  basic: '普攻',
  special: '特殊技',
  exSpecial: '强化特殊技',
  dashAttack: '冲刺攻击',
  dodgeCounter: '闪避反击',
  quickAssist: '快速支援',
  assistFollowUp: '支援突击',
  parryLight: '轻招架',
  parryHeavy: '重招架',
  parryChain: '连续招架',
  chain: '连携技',
  ultimateAttack: '终结技(强攻/支援/防护)',
  ultimateStun: '终结技(击破)',
  ultimateAnomaly: '终结技(异常)',
}

/** 标准式：数值 = const + perT×t + perE×e（缺省项为 0），按 1 级 A 级角色记录 */
export interface StdFormula {
  const?: number
  perT?: number
  perE?: number
}

/**
 * 标准倍率表本体。列 = StandardRowId；只录社区表给出的格子，缺格 = 该类型无此列标准。
 * 注意：
 * - 普攻弱/强段伤害不同（130t / 183t），catalog 不分段，basic 按 130t 记，伤害列比值仅供参考；
 * - 轻招架 71.661+130t 与重招架 71.2935+130t 在数据里分别恒定偏 +10.7% / +8.3%（待确认口径），
 *   常数按原表保留，演算时这两类不参与纵向系数聚合；
 * - 快速支援的伤害/失衡/喧响与原表出入较大且新旧角色分层（待确认口径），同样不进纵向聚合的强约束。
 */
export const STANDARD_MULTIPLIER_TABLE: Record<MoveType, Partial<Record<StandardRowId, StdFormula>>> = {
  basic: {
    damage: { perT: 130 },
    daze: { perT: 100 },
    energy_recovery: { perT: 3.6 },
    decibel_recovery: { perT: 27.5 },
    anomaly_buildup: { perT: 100 },
    ether_purify: { perT: 100 },
  },
  special: {
    damage: { perT: 100 },
    daze: { perT: 100 },
    // 特殊技不回能（用户确认，原表 3.6t 系笔误；catalog 实录也以缺失/0 为主）
    energy_recovery: { const: 0 },
    decibel_recovery: { perT: 27.5 },
    anomaly_buildup: { perT: 100 },
    ether_purify: { perT: 100 },
  },
  exSpecial: {
    damage: { perT: 140, perE: 5.55835 },
    daze: { perT: 130, perE: 4.175 },
    energy_recovery: { const: 0 },
    decibel_recovery: { perT: 41.25, perE: 1.909 },
    anomaly_buildup: { perT: 135, perE: 4.86 },
    ether_purify: { perT: 100 },
  },
  dashAttack: {
    damage: { perT: 200 },
    daze: { perT: 100 },
    energy_recovery: { perT: 3.6 },
    decibel_recovery: { perT: 27.5 },
    anomaly_buildup: { perT: 100 },
    ether_purify: { perT: 100 },
  },
  dodgeCounter: {
    damage: { perT: 230 },
    daze: { perT: 200 },
    energy_recovery: { perT: 3.6 },
    decibel_recovery: { perT: 27.5 },
    anomaly_buildup: { perT: 100 },
    ether_purify: { const: 150, perT: 100 },
  },
  quickAssist: {
    damage: { perT: 100 },
    daze: { perT: 100 },
    energy_recovery: { perT: 3.6 },
    decibel_recovery: { perT: 27.5 },
    anomaly_buildup: { perT: 100 },
    ether_purify: { perT: 100 },
  },
  assistFollowUp: {
    damage: { const: 111.35, perT: 140 },
    daze: { const: 83.5, perT: 130 },
    energy_recovery: { const: 0 },
    decibel_recovery: { const: 38.1, perT: 41.25 },
    anomaly_buildup: { const: 97.2, perT: 135 },
    ether_purify: { const: 0 },
  },
  parryLight: {
    daze: { const: 71.661, perT: 130 },
    ether_purify: { const: 250, perT: 100 },
  },
  parryHeavy: {
    daze: { const: 71.2935, perT: 130 },
    ether_purify: { const: 250, perT: 100 },
  },
  parryChain: {
    daze: { perT: 130 },
    ether_purify: { perT: 100 },
  },
  chain: {
    damage: { const: 400, perT: 100 },
    daze: { perT: 100 },
    energy_recovery: { const: 0 },
    decibel_recovery: { const: 182.883, perT: 27.5 },
    anomaly_buildup: { const: 200, perT: 100 },
    ether_purify: { perT: 100 },
  },
  ultimateAttack: {
    damage: { const: 1500, perT: 130 },
    daze: { perT: 100 },
    energy_recovery: { const: 0 },
    anomaly_buildup: { perT: 100 },
    ether_purify: { const: 500, perT: 100 },
  },
  ultimateStun: {
    damage: { const: 1240, perT: 130 },
    daze: { const: 780, perT: 100 },
    energy_recovery: { const: 0 },
    anomaly_buildup: { perT: 100 },
    ether_purify: { const: 500, perT: 100 },
  },
  ultimateAnomaly: {
    damage: { const: 1233.33, perT: 130 },
    daze: { perT: 100 },
    energy_recovery: { const: 0 },
    anomaly_buildup: { const: 800, perT: 100 },
    ether_purify: { const: 500, perT: 100 },
  },
}

/** 稀有度系数（只乘伤害与失衡）：限定 S 1.1 / 常驻 S 1.05 / A 及以下 1.0 */
export const RARITY_DAMAGE_DAZE_COEF = {
  limitedS: 1.1,
  standardS: 1.05,
  normal: 1.0,
} as const

/** 命破职业伤害倍率另乘系数 */
export const RUPTURE_DAMAGE_COEF = 0.8

/**
 * 闪能质量 = 普通能量的 1.2 倍：强特公式里四个耗能利用率系数
 * （伤害 5.55835 / 失衡 4.175 / 喧响 1.909 / 积蓄 4.86）在消耗闪能（Flash Energy Cost）时
 * 先 ×1.2 再乘闪能量——相同闪能比相同能量多转化 20% 数值。
 * 口径锚点是真斗（最接近纯闪能转化；catalog 未录其耗能）；仪玄/般岳在此之上还有各自机制调整，
 * 由演算页偏差清单呈现。
 */
export const FLASH_ENERGY_QUALITY = 1.2

/** 喧响回复基准（每秒）：快速支援等 actionTime 存疑招式用 t_db = 喧响实际值 / DECIBEL_PER_SECOND 校准 */
export const DECIBEL_PER_SECOND = 27.5

/** 稀有度 + 命破修正后的列系数（等级系数除外） */
export function getRarityMultiplier(rarity: string, agentId: string, specialty: string, rowId: StandardRowId): number {
  let m = RARITY_DAMAGE_DAZE_COEF.normal
  if (rowId === 'damage' || rowId === 'daze') {
    if (rarity === 'S') m *= STANDARD_S_AGENT_IDS.has(agentId) ? RARITY_DAMAGE_DAZE_COEF.standardS : RARITY_DAMAGE_DAZE_COEF.limitedS
  }
  if (rowId === 'damage' && specialty === 'rupture') m *= RUPTURE_DAMAGE_COEF
  return m
}

/** 把标准式渲染成社区表习惯的公式文本，如 "400+100t"、"5.55835e+140t"、"780" */
export function formatStdFormula(f: StdFormula): string {
  const parts: string[] = []
  if (f.const) parts.push(trimNum(f.const))
  if (f.perT) parts.push(`${trimNum(f.perT)}t`)
  if (f.perE) parts.push(`${trimNum(f.perE)}e`)
  if (!parts.length) return '0'
  return parts
    .map((p, i) => (i === 0 || p.startsWith('-') ? p : `+${p}`))
    .join('')
}

function trimNum(n: number): string {
  return String(Number(n.toFixed(6)))
}
