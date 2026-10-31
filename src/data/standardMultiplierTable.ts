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

/**
 * 常驻 S 音擎（获取不消耗限定金）= 上面 6 名常驻 S 的专武本体。
 * 钢铁肉垫(14102)/硫磺石(14104)/燃狱齿轮(14110)/拘缚者(14114)/嵌合编译器(14118)/啜泣摇篮(14121)。
 * 焰心桂冠(14116) 是莱特专武（限定），不在此列。与角色名单同为身份事实源，不要在 composable 再抄一份。
 */
export const STANDARD_S_WENGINE_IDS = new Set(['14102', '14104', '14110', '14114', '14118', '14121'])

/** 参与演算的倍率表行 id（catalog SkillRow.id） */
export type StandardRowId =
  | 'damage'
  | 'daze'
  | 'energy_recovery'
  | 'decibel_recovery'
  | 'anomaly_buildup'
  | 'ether_purify'
  | 'attack_data_0'

export const STANDARD_ROW_IDS: StandardRowId[] = [
  'damage',
  'daze',
  'energy_recovery',
  'decibel_recovery',
  'anomaly_buildup',
  'ether_purify',
  'attack_data_0',
]

/**
 * 角色专属资源行（**非标准行**）：没有标准公式 ⇒ 算不出「实际/期望」比值，只展示实际值。
 *
 * 为什么与上面的标准行分开登记：它们不进纵向系数聚合、不进偏差清单（`ratio = null`），
 * 但都是「这一招发多少资源」的量，跨招式比较的正确单位是**秒均**（`actual / t`）——
 * 总数值随招式长短变化（同一招式的长段/短段差一个 t），读不出效率；一批人肉对账都卡在这里。
 *
 * - `attack_data_0` 专属资源：青衣闪络电压 / 星徽·比利决意 / 猫又呼噜 / 席德钢能…（gachabase kind=special 第 0 通道，含普攻聚合行）
 * - `gash_buildup` 残痕积累：锋御专属（挽昼 1601 / 克拉蕾 1611），600 点 = 1 层
 * - `sharpness_gain` 锐能回复：锋御的专属能量回复（= 其他职业的「回能」位；1 点锐能 ≈ 1 点能量，
 *   逐角色判，见 EX_SHARPNESS_ENERGY）——展示时并入明细表的「回能」列，不单列
 *
 * 历史：attack_data_0 曾整列不显示（用户 2026-08 报告「倍率表没显示平A的电压值」）；
 * 残痕/锐能两列曾整列缺失（用户 2026-10-29 报告「锋御的残痕积累没写」）。
 */
export type ResourceRowId = 'attack_data_0' | 'gash_buildup' | 'sharpness_gain'

/**
 * @fact ui:倍率系数记录/资源列单位 口径: 无标准式的资源行（专属资源 attack_data_0 / 残痕积累 gash_buildup / 锐能回复 sharpness_gain）一律按**秒均**（整招合计 ÷ t）展示，不展示整招合计；锋御无 energy_recovery 行 ⇒ 锐能回复并进「回能」列 | 据 用户@2026-10-29（「专属资源该用秒均数据而不是总数据」「锋御的残痕积累没写呢」「回能也可以把锋御角色的回复锐能加进去」） | 验 src/composables/__tests__/multiplierCoefficients.test.ts | 锚 src/data/standardMultiplierTable.ts#RESOURCE_ROW_IDS | 信 确认
 * ⟳复核: 新增锋御角色或新增资源行时，看它是否仍是「按命中时长线性发放」——若出现一次性/被动型资源（值不随 t 增长），秒均会把量摊薄成误导，那时该行要改回整招合计展示 | 到期 2027-06-30
 */
export const RESOURCE_ROW_IDS: ResourceRowId[] = ['attack_data_0', 'gash_buildup', 'sharpness_gain']

export const RESOURCE_ROW_LABELS: Record<ResourceRowId, string> = {
  attack_data_0: '专属资源',
  gash_buildup: '残痕积累',
  sharpness_gain: '锐能回复',
}

/** 标准行 + 资源行的全集（倍率表单元格遍历用） */
export type CoefficientRowId = StandardRowId | ResourceRowId

export const COEFFICIENT_ROW_IDS: CoefficientRowId[] = [...STANDARD_ROW_IDS, ...RESOURCE_ROW_IDS]

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
  | 'counterAssist' // 反制支援（一次化解整组控制技的本体；等效能量口径见 EQUIVALENT_ENERGY）
  | 'counterAssistFollowUp' // 反制支援后的专属支援突击（克拉蕾 1611030 琢形；与普通支援突击不同行）
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
  counterAssist: '反制支援',
  counterAssistFollowUp: '反制支援·专属支援突击',
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
/**
 * 强特耗能利用率系数：每 1 点能量换多少倍率（伤害 / 失衡 / 喧响 / 积蓄）。
 * 强特标准式 = perT×t + 本系数×e；**支援突击/反制支援系共用这四个系数**（见 EQUIVALENT_ENERGY）。
 * ⚠ 命破角色的「能」= 闪能，走同样的四个系数再 ×FLASH_ENERGY_QUALITY(1.2)。
 */
export const EX_ENERGY_CONVERSION = {
  damage: 5.55835,
  daze: 4.175,
  decibel_recovery: 1.909,
  anomaly_buildup: 4.86,
} as const

/**
 * 支援突击 / 反制支援系的「等效能量」——把晦涩的常数还原成策划的原始口径。
 *
 * 口径：支援突击的四个常数 ÷ 强特耗能利用率系数 = `20.03 / 20.00 / 19.96 / 20.00`
 * （伤害 111.35÷5.55835、失衡 83.5÷4.175、喧响 38.1÷1.909、积蓄 97.2÷4.86）
 * ⇒ **支援突击公式 ≡ 强特公式在 e=20 处的取值**：弹刀后跟的支援突击是「送 20 点等效能量」的奖励，
 * 这 20 点不是玩家花的能量，而是策划调倍率时的记账单位。
 *
 * **反制支援本体 = @40（招族价，三家反解一致）**：克拉蕾 1611028 / 挽昼 1601204 / 知更鸟 1661017
 * 按各自列系数反解，失衡/喧响/积蓄三列都落在 40.0±0.06。
 * **反制支援的专属追击 = 招式级事实、不按招族定价**（见 `COUNTER_ASSIST_FOLLOW_UP_EQUIVALENT_ENERGY`）：
 * 克拉蕾 1611030 琢形 = @80（基线 + 60），挽昼 1601205 灯塔 = @20（**普通支援突击基线本身、零奖励**）。
 * 2026-10-31 用户提问「灯塔说送了很多等效能量、各项数值却都低」触发复核：按 @80 评估会把四列统一压到
 * 0.51~0.59 的假象，按 @20 评估则失衡/喧响/积蓄 1.000、伤害 = 她的直伤系数 1.091（四列同证）。
 * 融合只体现在动作/时间层，倍率按行各算各的（见 data/moveFusions.ts）。
 *
 * @fact data:倍率系数/反制支援等效能量 口径: 反制支援本体 = 支援突击基线 + 20（整行 = 强特公式@40，克拉蕾/挽昼/知更鸟三家反解一致）；专属追击**逐招式登记**（克拉蕾 1611030 = @80，挽昼 1601205 = @20 基线零奖励）；支援突击本身 = 强特公式@20 | 据 用户@2026-10-24（「其奖励倍率是相当于等效多少能量×能量转化率算出来的数值」）·反解自 1611028/1611030（40.0/80.0）·1601204/1601205（40.0/20.0）·1661017（40.0） | 验 src/composables/__tests__/multiplierCoefficients.test.ts | 锚 src/data/standardMultiplierTable.ts#COUNTER_ASSIST_FOLLOW_UP_EQUIVALENT_ENERGY | 信 确认
 * ⟳复核: 新增反制支援角色时，先反解「本体 + 专属追击」两行的失衡/喧响/积蓄——本体不在 40、追击不在 20/80 说明这族又不是这个价，按解出的整数登记到 COUNTER_ASSIST_FOLLOW_UP_EQUIVALENT_ENERGY，不要套类型默认；若官方补 energyCost，等效能量口径让位给真耗能 | 到期 2027-06-30
 */
export const EQUIVALENT_ENERGY: Partial<Record<MoveType, number>> = {
  assistFollowUp: 20,
  counterAssist: 40,
}

/**
 * 反制支援**专属追击**段的等效能量 —— **逐招式登记**（MoveType 级只留 20 这个基线价）。
 *
 * 为什么不能按类型定价：@80 是克拉蕾一个人的价。她与挽昼同为锋御、同形的「反制支援后点按攻击发动」段，
 * 灯塔(1601205) 却反解出 20.02 / 20.05 / 20.00（失衡/喧响/积蓄三列独立命中）——就是普通支援突击基线、
 * **零奖励**（伤害列 109.1% = 她的直伤系数 1.091，第四列同证）。套 @80 会让这四列统一显示 0.51~0.59。
 * 值 = 整行等效能量（含支援突击基线的 20）；标准式由 `counterAssistFormulaForEquivalentEnergy` 生成。
 * 未登记 = 没有标准式（该招只展示实际值），新增角色必须反解后登记（判据会点名）。
 */
export const COUNTER_ASSIST_FOLLOW_UP_EQUIVALENT_ENERGY: Partial<Record<string, number>> = {
  '1611030': 80, // 克拉蕾·血华誓·琢形：79.96 / 80.03 / 80.01
  '1601205': 20, // 挽昼·灯塔，立于苍穹：20.02 / 20.05 / 20.00 = 基线、零奖励（2026-10-31 复核）
}

/** 反制支援本体在「支援突击基线」之上额外的奖励等效能量（= 40 − 20） */
export const COUNTER_ASSIST_REWARD_ENERGY = 20

/**
 * 锋御「锐能」按能量计价（e 通道）——**逐角色登记，不按职业泛化**。
 *
 * 锋御的锐能有两种用法，在倍率表上长得完全不一样，只能逐角色判：
 * - **挽昼(1601)：锐能 = 能量**。四个强化特殊技行各耗 30 点（raw「锐能消耗 30点」），把 30 代入强特标准式的
 *   `e` 后，失衡/喧响/积蓄三列全部落在 1.000~1.001 带内（四行 12 个格子反解出的 e 都是 30.0~30.1），
 *   伤害列 = 1.09（她的直伤系数，支援突击锚点独立算出 1.091）⇒ 与普通能量同价，登记 30。
 *   ⚠「（改）」两行**伤害与失衡整列另 ×1.1**（喧响/积蓄/秽盾不变），登记值仍是 30。
 * - **克拉蕾(1611)：锐能 = 入场门禁**，不进公式。她的 60 锐能买的是 16s [猩红铭刻]；三列速率量实测是
 *   **特殊技基线**（失衡 1.0014 / 喧响 1.1000 = 她自己的喧响系数 / 积蓄 0.9998），
 *   按强特式 e=60 评估会得 0.34~0.42 的假象、e=0 得 0.73~0.77，都是把她的设计读错 ⇒ 不登记。
 *
 * @fact data:倍率系数/锋御锐能 口径: 挽昼(1601) 四个强特行的锐能 30 点按能量等价计入强特标准式（e 通道）；克拉蕾(1611) 不登记——60 锐能是 [猩红铭刻] 的入场门禁，速率列实测为特殊技基线（e=0） | 据 用户@2026-10-26（「挽昼加进去，克拉蕾不进公式，太特殊了」）·四行 12 格反解 e=30.0~30.1·伤害列 1.09=她的直伤系数 | 验 src/composables/__tests__/multiplierCoefficients.test.ts | 锚 src/data/standardMultiplierTable.ts#EX_SHARPNESS_ENERGY | 信 确认
 * ⟳复核: 新增锋御角色/锐能强特时先拿它的四列反解 e——若速率列落到特殊技基线或解出非整数，说明它走「门禁」而不是「能量」，不要登记 | 到期 2027-06-30
 */
export const EX_SHARPNESS_ENERGY: Partial<Record<string, number>> = {
  // 挽昼（1601）强化特殊技：焚夜·曦生 / 燃灯·晦尽 及其（改）
  '1601106': 30,
  '1601006': 30,
  '1601016': 30,
  '1601115': 30,
}

/**
 * 走「锐能门禁」的强特行（**不产生奖励倍率**，e 项恒 0）——与 `EX_SHARPNESS_ENERGY` 互斥。
 * 目前只有克拉蕾 1611010：60 锐能买 16s [猩红铭刻]，速率列实测是特殊技基线；
 * 登记在这里只用于在倍率演算页标注「为什么这行不接 e」，不参与任何数值计算。
 */
export const SHARPNESS_GATED_MOVES: ReadonlySet<string> = new Set(['1611010'])

/** 支援突击实录标准式（社区表原值，一字不改；见文件头 EQUIVALENT_ENERGY 的「20」解释） */
const ASSIST_FOLLOW_UP_FORMULA: Partial<Record<StandardRowId, StdFormula>> = {
  damage: { const: 111.35, perT: 140 },
  daze: { const: 83.5, perT: 130 },
  energy_recovery: { const: 0 },
  decibel_recovery: { const: 38.1, perT: 41.25 },
  anomaly_buildup: { const: 97.2, perT: 135 },
  ether_purify: { const: 0 },
}

/**
 * 反制系标准式的生成器：**以支援突击实录常数为基线**，按「奖励等效能量 × 强特耗能利用率系数」加算。
 *
 * ⚠ 不写成 `e×系数`：支援突击实录常数（111.35/83.5/38.1/97.2）÷ 系数 = 20.03/20.00/19.96/20.00，
 * 与整数 20 有 ≤0.16% 的残差（社区表原始值，来历不明但不能改——改了会让全库直伤系数集体漂移，
 * 例如克拉蕾 122.7%→122.8%）。故**实录值原样保留作基线**，反制系在其上叠加折算量。
 * 斜率沿用强特 perT；回能/秽盾恒 0（这两列不吃能量奖励，实录也是 0）。
 */
function counterAssistFormula(
  base: Partial<Record<StandardRowId, StdFormula>>,
  rewardEnergy: number,
): Partial<Record<StandardRowId, StdFormula>> {
  const out: Partial<Record<StandardRowId, StdFormula>> = {}
  for (const rowId of STANDARD_ROW_IDS) {
    const f = base[rowId]
    if (!f) continue
    const perE = EX_ENERGY_CONVERSION[rowId as keyof typeof EX_ENERGY_CONVERSION]
    out[rowId] = perE == null
      ? { ...f }
      : { const: round6((f.const ?? 0) + perE * rewardEnergy), perT: f.perT }
  }
  return out
}

/** 反制系整行等效能量 → 标准式（= 支援突击实录基线 + (E − 20) × 强特耗能利用率系数） */
export function counterAssistFormulaForEquivalentEnergy(equivalentEnergy: number): Partial<Record<StandardRowId, StdFormula>> {
  return counterAssistFormula(ASSIST_FOLLOW_UP_FORMULA, equivalentEnergy - (EQUIVALENT_ENERGY.assistFollowUp ?? 0))
}

/** 保留 6 位（与 formatStdFormula 的 trimNum 同精度；避免 1.909×20 一类浮点尾巴进表） */
function round6(n: number): number {
  return Number(n.toFixed(6))
}

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
  // 支援突击：社区表实录常数（= 强特公式在 20 等效能量处的取整，残差 ≤0.16%，见 EQUIVALENT_ENERGY）
  assistFollowUp: ASSIST_FOLLOW_UP_FORMULA,
  // 反制支援本体 = 实录基线 + 奖励 20（整行 @40，招族价）。
  counterAssist: counterAssistFormula(ASSIST_FOLLOW_UP_FORMULA, COUNTER_ASSIST_REWARD_ENERGY),
  // 专属追击**没有类型级标准式**：同一 MoveType 下两家价位不同（克拉蕾 @80 / 挽昼 @20），
  // 由 COUNTER_ASSIST_FOLLOW_UP_EQUIVALENT_ENERGY 逐招式生成（standardTableOfMove）。
  counterAssistFollowUp: {},
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

/**
 * 招式的等效能量（奖励口径）：反制支援·专属追击**逐招式登记**，其余按 MoveType 定价。
 * 未分类 / 未登记的追击 = null（= 没有标准式，只展示实际值，不静默套别人的价）。
 */
export function equivalentEnergyOfMove(moveType: MoveType | 'other', moveId: string): number | null {
  if (moveType === 'other') return null
  if (moveType === 'counterAssistFollowUp') return COUNTER_ASSIST_FOLLOW_UP_EQUIVALENT_ENERGY[moveId] ?? null
  return EQUIVALENT_ENERGY[moveType] ?? null
}

/**
 * 招式级标准式查表：反制系按「该招式的等效能量」现算（同一个 MoveType 下价位可以不同），
 * 其余类型直接取类型表。**不要绕过它去索引 STANDARD_MULTIPLIER_TABLE[moveType]**——
 * 反制系那一格是空的（没有类型级标准式）。
 */
export function standardTableForMove(moveType: MoveType, moveId: string): Partial<Record<StandardRowId, StdFormula>> {
  if (moveType === 'counterAssist' || moveType === 'counterAssistFollowUp') {
    const energy = equivalentEnergyOfMove(moveType, moveId)
    return energy == null ? {} : counterAssistFormulaForEquivalentEnergy(energy)
  }
  return STANDARD_MULTIPLIER_TABLE[moveType]
}

/** 稀有度系数（只乘伤害与失衡）：限定 S 1.1 / 常驻 S 1.05 / A 及以下 1.0 */
const RARITY_DAMAGE_DAZE_COEF = {
  limitedS: 1.1,
  standardS: 1.05,
  normal: 1.0,
} as const

/** 命破职业伤害倍率另乘系数 */
const RUPTURE_DAMAGE_COEF = 0.8

/**
 * 闪能质量 = 普通能量的 1.2 倍：强特公式里四个耗能利用率系数
 * （伤害 5.55835 / 失衡 4.175 / 喧响 1.909 / 积蓄 4.86）在消耗闪能（Flash Energy Cost）时
 * 先 ×1.2 再乘闪能量——相同闪能比相同能量多转化 20% 数值。
 * 口径锚点是真斗（最接近纯闪能转化；catalog 未录其耗能）；仪玄/般岳在此之上还有各自机制调整，
 * 由演算页偏差清单呈现。
 */
export const FLASH_ENERGY_QUALITY = 1.2

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
 * 定点时间修正（moveId → actionTime 增量，秒）。
 *
 * **当前为空**（2026-10-18 用户口径）：原唯一条目 `1471029: -1.5` 是「支援突击：冲霄」
 * 录制含金身格挡持盾时间的补丁，只被倍率演算页消费、**资源引擎没接** ⇒ 同一招在两个页面
 * 两个时间（页面 1.167s / 引擎 2.667s），违反「算的什么就展示什么」。现改由
 * 数据驱动规则在 **catalog 源头**修正：`秽盾 − 积蓄 ∈ {150,250,500}±2` ⇒ `actionTime =
 * (秽盾−加成)/100`（`scripts/lib/type-bonus-time.mjs` 单一事实源 + `validate:data` 护栏），
 * 两个页面读同一个 `actionTime`，本表不再需要手写补丁。
 *
 * 保留本表：它是「公式推不出、只能用户核对」的逃生口（先例：
 * `scripts/patch-move-action-time.mjs` 的 `USER_TIME_OVERRIDES`）。新条目必须在注释里写清
 * 为什么数据推不出来。
 */
export const MOVE_TIME_ADJUSTMENTS: Record<string, number> = {}

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
 * 注：仪玄(1371)强特原按「#1+#2=斩击 / #3+#4=追击」融合，评估得 ~0.46~2.56 假象（追击段
 * 头行无耗能标注、且拆法与真实强特链不符），已改为交互变体定点整链记录（FIXED_RECORD_UNITS）。
 */
export const MOVE_FUSION_GROUPS: Array<{ members: string[] }> = [
  { members: ['1091009', '1091010'] },
  { members: ['1091011', '1091012'] },
  { members: ['1091015', '1091016', '1091017'] },
]

/** 定点整链记录的耗能（整链一次计；kind 区分普通能量与闪能，闪能质量 ×1.2） */
export interface FixedRecordEnergy {
  value: number
  kind: 'energy' | 'flashEnergy'
}

/**
 * 定点整链记录（FIXED_RECORD_UNITS）：catalog 把一套交互招式拆成多行、且逐段/简单融合都
 * 无法表达「整链一次评估」时（耗能整链只计一次、弹刀赠送段免费），按交互变体手工记录合成
 * 评估单元，替代该角色对应 catalog 行的自动评估（成员行不再单独/融合评估）。
 *
 * 仪玄(1371)「墨痕化形」强特链（用户口径，见 src/mechanics/agents/yixuan.ts 与 spec notes）：
 *   #1=1371009（40 闪能）/ #2=1371024（完美格挡赠送，免费）/ #3=1371023（跟随#1，免费）/
 *   #4=1371025（20 闪能）；2连 = #1+#3（40 闪能）、3连 = #1+#3+#4（60 闪能）、单E = #1（40 闪能）；
 *   弹刀与否 = 是否追加免费 #2。每变体 = 完整一次链：t 与各列数值求和、耗能整链一次计。
 *   原「#1+#2=斩击 / #3+#4=追击」融合评估得 ~0.46~2.56 假象（追击头行 1371023 无耗能标注、
 *   拆法与真实强特链不符），按交互变体记录后各变体比值如实反映整链调优
 *   （单E 伤害 ~0.82、3连·弹刀 喧响/积蓄 ≈0.99、全变体秽盾 ≈1.000）。
 * 普罗米娅(1541)「处刑式·重霜/坠霜」（用户口径）：实为消耗 40 能量（封喉霜径 1541009 /
 *   匿影）后接的免费招——本质上算作 40 能量换来的奖励，评估时按强特公式带 40 能量（否则
 *   按特殊技公式 e=0 得 2.2~3.1 倍虚高比值，且污染其纵向积蓄系数）；重霜 #1+#2 合一
 *   （#2 子段 24.2%，t=0）。
 */
export interface FixedRecordUnit {
  agentId: string
  /** 展示用 moveId（合成 id，避免与 catalog 行混淆；不参与任何 catalog 行匹配） */
  moveId: string
  moveName: string
  moveType: MoveType
  /** 参与合成的 catalog 行（t 与各列数值求和） */
  members: string[]
  /** 整链耗能（一次计）：null = 按头行 energyCost 解析 */
  energy: FixedRecordEnergy | null
}

export const FIXED_RECORD_UNITS: FixedRecordUnit[] = [
  {
    agentId: '1371',
    moveId: '1371_ink_solo',
    moveName: '强化特殊技：墨痕化形（单E）',
    moveType: 'exSpecial',
    members: ['1371009'],
    energy: { value: 40, kind: 'flashEnergy' },
  },
  {
    agentId: '1371',
    moveId: '1371_ink_solo_parry',
    moveName: '强化特殊技：墨痕化形（单E·弹刀）',
    moveType: 'exSpecial',
    members: ['1371009', '1371024'],
    energy: { value: 40, kind: 'flashEnergy' },
  },
  {
    agentId: '1371',
    moveId: '1371_ink_2x',
    moveName: '强化特殊技：墨痕化形（2连）',
    moveType: 'exSpecial',
    members: ['1371009', '1371023'],
    energy: { value: 40, kind: 'flashEnergy' },
  },
  {
    agentId: '1371',
    moveId: '1371_ink_2x_parry',
    moveName: '强化特殊技：墨痕化形（2连·弹刀）',
    moveType: 'exSpecial',
    members: ['1371009', '1371024', '1371023'],
    energy: { value: 40, kind: 'flashEnergy' },
  },
  {
    agentId: '1371',
    moveId: '1371_ink_3x',
    moveName: '强化特殊技：墨痕化形（3连）',
    moveType: 'exSpecial',
    members: ['1371009', '1371023', '1371025'],
    energy: { value: 60, kind: 'flashEnergy' },
  },
  {
    agentId: '1371',
    moveId: '1371_ink_3x_parry',
    moveName: '强化特殊技：墨痕化形（3连·弹刀）',
    moveType: 'exSpecial',
    members: ['1371009', '1371024', '1371023', '1371025'],
    energy: { value: 60, kind: 'flashEnergy' },
  },
  {
    agentId: '1541',
    moveId: '1541_zhuishuang',
    moveName: '特殊技：处刑式·坠霜（40能量奖励）',
    moveType: 'exSpecial',
    members: ['1541010'],
    energy: { value: 40, kind: 'energy' },
  },
  {
    agentId: '1541',
    moveId: '1541_zhongshuang',
    moveName: '特殊技：处刑式·重霜（40能量奖励）',
    moveType: 'exSpecial',
    members: ['1541011', '1541012'],
    energy: { value: 40, kind: 'energy' },
  },
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
