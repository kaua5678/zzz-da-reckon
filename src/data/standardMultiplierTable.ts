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
  | 'quickAssist' // 快速支援（标准版）
  | 'quickAssistLegacy' // 快速支援（翻倍版：失衡/喧响/回能/积蓄 ×2，伤害同为 200t）
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
  quickAssistLegacy: '快速支援(翻倍)',
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
 * - 轻招架 95.511+130t / 重招架 95.178+130t：数据校准值（斜率固定 130，对 catalog 主簇
 *   47/53、48/54 条实录取隐含截距中位数；两段仅差 0.33）。来源：用户按单角色推算的
 *   官方口径 92.4 / 89.1 偏低 ~3.4%，经用户确认改用全体平均值。连续招架 = 130t 不变。
 *   这两类不参与纵向系数聚合；
 * - 快速支援存在两版录入口径（2026-08 数据校准，n=30+34）：伤害两版同为 **200t**（原表 100t
 *   系笔误）；分版列 = 失衡/喧响/回能/积蓄（标准 100t/27.5t/3.6t/100t vs 翻倍 200t/55t/7.2t/200t），
 *   秽盾恒 100t。分版判据 = 喧响速率 ≥40/s（不受稀有度系数影响）。另有 ~5 条减半/离群记录
 *   （安东、卢西娅等）按标准版评估后由偏差清单呈现。
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
    // 数据校准（2026-08，n=30）：伤害 200t（原表 100t 系笔误，两版中仅翻倍版为 100t）；
    // 失衡/喧响/回能/积蓄/秽盾 = 原表值
    damage: { perT: 200 },
    daze: { perT: 100.78 },
    energy_recovery: { perT: 3.6 },
    decibel_recovery: { perT: 27.5 },
    anomaly_buildup: { perT: 100 },
    ether_purify: { perT: 100 },
  },
  quickAssistLegacy: {
    // 「翻倍版」真实语义（用户口径）：录制的 actionTime 为真实有效时间的 1/2（其秽盾基准为
    // 50t 而非 100t），评估时按 MOVE_TYPE_TIME_SCALE ×2 还原；各列速率与标准版相同，
    // 仅伤害为 100t（标准版为 200t）。实测还原后全列比值 ≈1.00。
    damage: { perT: 100 },
    daze: { perT: 100 },
    energy_recovery: { perT: 3.6 },
    decibel_recovery: { perT: 27.5 },
    anomaly_buildup: { perT: 100 },
    ether_purify: { perT: 50 },
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
    daze: { const: 95.511, perT: 130 },
    ether_purify: { const: 250, perT: 100 },
  },
  parryHeavy: {
    daze: { const: 95.178, perT: 130 },
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

/**
 * 定点分类覆盖（moveId → 标准表招式类型）：catalog 的类别/命名无法表达的特殊归属。
 * - 1471029 般岳「支援突击：冲霄」：金身格挡后跟的招式，实为闪避反击公式（用户口径）；
 *   般岳的中心系数锚点由「支援突击：昂霄」承担（与支援突击公式五列比值 ≈1.000）。
 * - 1441024/1441025 真斗「支援突击：孤影·断獠 #1/#2」：真斗没有支援突击公式——机制是
 *   弹刀后连续攻击，结构同闪反（纯 t 项）：喧响 27.5t / 积蓄 100t 两列精确命中（≈1.000）；
 *   伤害/失衡/秽盾为各段自有数值（设计空间，偏差清单呈现）。改判后真斗无支援突击锚点，
 *   其直伤系数记「—」。
 */
export const MOVE_TYPE_OVERRIDES: Record<string, MoveType | 'other'> = {
  '1471029': 'dodgeCounter',
  '1441024': 'dodgeCounter',
  '1441025': 'dodgeCounter',
}

/**
 * 定点时间修正（moveId → actionTime 增量，秒）：
 * - 1471029 般岳「支援突击：冲霄」：录制 t=2.667s 含金身格挡持盾时间，闪反公式口径需 −1.5
 *   （有效 t=1.167s）。三列同时验证：秽盾 150+100×1.167=266.7（实录精确相等）、积蓄/喧响 ≈1.000；
 *   伤害/失衡在该 t 下为 ~0.94/~0.93，属般岳自身特调，由偏差清单呈现。
 */
export const MOVE_TIME_ADJUSTMENTS: Record<string, number> = {
  '1471029': -1.5,
}

/** 招式类型级时间缩放：quickAssistLegacy 录制的 actionTime 是真实有效时间的 1/2（秽盾 50t 基准），评估时 ×2 还原 */
export const MOVE_TYPE_TIME_SCALE: Partial<Record<MoveType, number>> = {
  quickAssistLegacy: 2,
}

/**
 * 倍率行融合组：catalog 把一套招式拆成了多行/多段，需加总为一个评估单元
 * （期望值的前缀项/耗能只计一次，t 与各列数值求和）。
 * - 星见雅(1091)「飞雪 #1+#2」= 一次斩击（耗能40）、「#3+#4」= 一次追击（耗能40）——
 *   融合后与 nanoka 官方倍率（788.3%/967.2%）逐位相同，且代入强特公式三列比值 ≈1.001；
 * - 星见雅连携「春临 #1~#3」三段合计才是一次连携：融合后伤害/喧响比值 ≈1.000（逐段评估
 *   会得到 ~0.38 的假象）；
 * - 仪玄(1371)「墨痕化形 #1+#2」= 斩击（40 闪能）、「#3+#4」= 追击（40 闪能）。
 */
export const MOVE_FUSION_GROUPS: Array<{ members: string[] }> = [
  { members: ['1091009', '1091010'] },
  { members: ['1091011', '1091012'] },
  { members: ['1091015', '1091016', '1091017'] },
  { members: ['1371009', '1371024'] },
  { members: ['1371023', '1371025'] },
]

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
