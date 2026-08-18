/**
 * 异常事件属性引用表（Attribute Reference Table）—— v2（用户核对版）
 *
 * 每个伤害事件声明：
 *   1. baseSource   基础区来源：谁的面板提供基础伤害属性（atk/精通/增伤/穿透）
 *   2. baseStats    基础区参与属性清单
 *   3. settlementSource 结算区来源：谁的面板提供结算属性
 *   4. settlementStats  结算区参与属性清单
 *   5. dmgZone      异常增伤区构成（加算：正统异常增伤 + 子类 + 变种）
 *
 * 核心规则（用户核对确认）：
 *   - 基础区（积蓄）：可以按积蓄占比加权（虚拟面板）
 *   - 结算区：**不是加权**。通过积蓄占比算出"谁可以触发几次"，然后用谁的结算面板算几次
 *     （例如 A 占 60% 积蓄 → 触发 10 次中 6 次用 A 的结算面板，4 次用 B 的）
 *   - 异属性角色无法积蓄某个元素的池子（贡献=0），天然不参与基础区和结算区
 *   - 异化区（蕾米 refringe）属于基础区，所有异常类事件（紊乱/乱流/异常DOT/耀变/异放）都享受
 *   - 异常增伤区分类加算：正统异常增伤(anomalyDmgBonus) + 事件子类增伤(如风化增伤) + 变种增伤(如异放/乱流增伤)
 *   - 强击暴击是异常暴击的子类；目前游戏只有强击暴击（异常暴击乘区由玩家从简推断，尚无第二例）
 *
 * ⚠️ 表中"倍率/公式"列为游戏机制数据，以用户口述为准。
 */

export interface DamageEventAttrRef {
  /** 事件唯一标识 */
  event: string
  /** 事件类型 */
  kind: 'anomaly' | 'disorder' | 'turbulence' | 'voidflare' | 'special_voidflare' | 'polar_assault' | 'passive_dot' | 'direct_attack'
  /** 基础区来源 */
  baseSource: 'virtual_weighted' | 'applier' | 'recorded_panel' | 'self' | 'none'
  /** 基础区参与属性 */
  baseStats: string[]
  /** 结算区来源 */
  settlementSource: 'per_trigger_share' | 'applier' | 'wind_panel' | 'remielle' | 'self' | 'none'
  /** 结算区参与属性 */
  settlementStats: string[]
  /** 异常增伤区构成（加算） */
  dmgZone: string[]
  /** 倍率/公式描述 */
  multiplier: string
  /** 备注 */
  note: string
}

/**
 * 属性引用表。key = 事件 id。
 */
export const DAMAGE_EVENT_ATTR_REFS: Record<string, DamageEventAttrRef> = {
  // ============ 元素属性异常（DoT 类） ============
  fire: {
    event: '灼烧',
    kind: 'anomaly',
    baseSource: 'virtual_weighted',
    baseStats: ['atk', 'anomalyProficiency', 'dmgBonus', 'elementDmg(fire)', 'penRatio', 'penFlat'],
    settlementSource: 'per_trigger_share',
    settlementStats: ['anomalyDmgBonus', 'anomalyCritRate', 'anomalyCritDmg', 'enemyDefReduction', 'enemyResReduction'],
    dmgZone: ['anomalyDmgBonus', 'fireAnomalyDmgBonus(如有)'],
    multiplier: '50%/tick × 0.5s × 20tick（10秒）',
    note: '基础区=积蓄贡献者按积蓄占比加权；结算区=按积蓄占比分摊触发次数，各触发者用自己的结算面板',
  },
  electric: {
    event: '感电',
    kind: 'anomaly',
    baseSource: 'virtual_weighted',
    baseStats: ['atk', 'anomalyProficiency', 'dmgBonus', 'elementDmg(electric)', 'penRatio', 'penFlat'],
    settlementSource: 'per_trigger_share',
    settlementStats: ['anomalyDmgBonus', 'anomalyCritRate', 'anomalyCritDmg', 'enemyDefReduction', 'enemyResReduction'],
    dmgZone: ['anomalyDmgBonus', 'electricAnomalyDmgBonus(如有)'],
    multiplier: '125%/tick × 1s × 10tick（10秒）',
    note: '',
  },
  ether: {
    event: '侵蚀',
    kind: 'anomaly',
    baseSource: 'virtual_weighted',
    baseStats: ['atk', 'anomalyProficiency', 'dmgBonus', 'elementDmg(ether)', 'penRatio', 'penFlat'],
    settlementSource: 'per_trigger_share',
    settlementStats: ['anomalyDmgBonus', 'anomalyCritRate', 'anomalyCritDmg', 'enemyDefReduction', 'enemyResReduction'],
    dmgZone: ['anomalyDmgBonus', 'etherAnomalyDmgBonus(如有)'],
    multiplier: '62.5%/tick × 0.5s × 20tick（10秒）',
    note: '',
  },
  // ============ 元素属性异常（单次类） ============
  physical: {
    event: '强击',
    kind: 'anomaly',
    baseSource: 'virtual_weighted',
    baseStats: ['atk', 'anomalyProficiency', 'dmgBonus', 'elementDmg(physical)', 'penRatio', 'penFlat'],
    settlementSource: 'per_trigger_share',
    settlementStats: ['anomalyDmgBonus', 'anomalyCritRate', 'anomalyCritDmg', 'assaultCritRate', 'assaultCritDmg', 'enemyDefReduction', 'enemyResReduction'],
    dmgZone: ['anomalyDmgBonus', 'physicalAnomalyDmgBonus(如有)'],
    multiplier: '713% 单次',
    note: '强击暴击(assaultCrit)=异常暴击的子类，目前游戏中唯一实现的异常暴击',
  },
  ice: {
    event: '碎冰',
    kind: 'anomaly',
    baseSource: 'virtual_weighted',
    baseStats: ['atk', 'anomalyProficiency', 'dmgBonus', 'elementDmg(ice)', 'penRatio', 'penFlat'],
    settlementSource: 'per_trigger_share',
    settlementStats: ['anomalyDmgBonus', 'anomalyCritRate', 'anomalyCritDmg', 'enemyDefReduction', 'enemyResReduction'],
    dmgZone: ['anomalyDmgBonus', 'iceAnomalyDmgBonus(如有)'],
    multiplier: '500% 单次',
    note: '',
  },
  // ============ 紊乱 ============
  disorder: {
    event: '紊乱',
    kind: 'disorder',
    baseSource: 'applier',
    baseStats: ['atk', 'anomalyProficiency', 'dmgBonus', 'elementDmg', 'penRatio', 'penFlat'],
    settlementSource: 'applier',
    settlementStats: ['disorderDamageBonus', 'enemyResReduction', 'enemyDamageTakenBonus', 'stunDmgMultiplierBonus'],
    dmgZone: ['disorderDamageBonus(紊乱独立，不继承正统异常增伤)'],
    multiplier: '450% + floor(T/1s)×7.5%（T=被覆盖异常剩余时长）',
    note: '基础区=被覆盖元素的施加者（被结算者）面板——精通在基础区，吃被覆盖者的精通；结算区=覆盖方（触发者）。不继承异常增伤区和异常暴击，只吃紊乱增伤区。不同元素 tick 不同。冻结/烈霜都带霜寒状态，霜寒使敌人受到暴击伤害+10%，按霜寒覆盖率折算。',
  },
  // ============ 乱流（维琳娜） ============
  turbulence: {
    event: '乱流',
    kind: 'turbulence',
    baseSource: 'applier',
    baseStats: ['atk', 'anomalyProficiency', 'dmgBonus', 'elementDmg', 'penRatio', 'penFlat'],
    settlementSource: 'wind_panel',
    settlementStats: ['anomalyDmgBonus', 'windAnomalyDmgBonus', 'turbulenceDamageBonus', 'anomalyCritRate', 'anomalyCritDmg', 'enemyResReduction', 'enemyDamageTakenBonus', 'stunDmgMultiplierBonus'],
    dmgZone: ['anomalyDmgBonus', 'turbulenceDamageBonus(乱流增伤，加算)'],
    multiplier: '物理800%/冰1300%/火900%/电650%/以太650%（base）+ tick 追加',
    note: '基础区=非风异常施加者面板；结算区=风角色（维琳娜）。乱流继承异常增伤和异常暴击（与紊乱不同）。例：维琳娜异常增伤10%+乱流增伤20% → 乱流增伤区=30%（加算）。',
  },
  // ============ 耀变（蕾米） ============
  voidflare: {
    event: '耀变',
    kind: 'voidflare',
    baseSource: 'virtual_weighted',
    baseStats: ['atk', 'anomalyProficiency', 'dmgBonus', 'elementDmg', 'penRatio', 'penFlat', 'refringe(异化区)'],
    settlementSource: 'remielle',
    settlementStats: ['enemyDefReduction', 'enemyAnomalyDefReduction', 'elementDefReduction', 'anomalyDmgBonus', 'remielleLuminizeMultiplierBonus', 'stunDmgMultiplierBonus', 'enemyDamageTakenBonus'],
    dmgZone: ['anomalyDmgBonus(蕾米)', 'luminize(耀变独立乘区)'],
    multiplier: '队友积蓄加权面板 × 耀变倍率',
    note: '蕾米记录（捕获）队友的异常事件与面板，转化为虚耀，由蕾米自己打出。基础区=队友积蓄的加权面板（同属性参与）；结算区=蕾米面板。异化区(refringe)在基础区内，所有异常事件都享受蕾米异化区独立加成。',
  },
  special_voidflare: {
    event: '特殊虚耀',
    kind: 'special_voidflare',
    baseSource: 'recorded_panel',
    baseStats: ['atk', 'anomalyProficiency', 'dmgBonus', 'elementDmg', 'refringe(异化区)'],
    settlementSource: 'remielle',
    settlementStats: ['anomalyDmgBonus', 'luminizeMultiplier', 'stunDmgMultiplierBonus'],
    dmgZone: ['anomalyDmgBonus(蕾米)', 'luminize(特殊独立乘区)'],
    multiplier: '进场记录面板 × 2.5（6命翻倍）',
    note: '基础区=蕾米进场时记录的面板；独立乘区 ×2.5。',
  },
  // ============ 极性强击（爱丽丝） ============
  physical_polar_assault: {
    event: '极性强击',
    kind: 'polar_assault',
    baseSource: 'self',
    baseStats: ['atk', 'anomalyProficiency', 'dmgBonus', 'elementDmg(physical)', 'penRatio', 'penFlat'],
    settlementSource: 'self',
    settlementStats: ['anomalyDmgBonus', 'anomalyCritRate', 'anomalyCritDmg', 'assaultCritRate', 'assaultCritDmg', 'enemyDefReduction', 'enemyResReduction'],
    dmgZone: ['anomalyDmgBonus', 'physicalAnomalyDmgBonus(如有)'],
    multiplier: '713% 单次（同普通强击）',
    note: '与普通强击同为一次强击事件（713%），只是可与强击附带的畏缩状态互紊；爱丽丝面板，赠送触发不耗异常条、不产生积蓄。',
  },
  // ============ 爱丽丝被动 DOT（注意：不是"畏缩 DOT"） ============
  alice_passive_dot: {
    event: '爱丽丝被动DOT',
    kind: 'passive_dot',
    baseSource: 'applier',
    baseStats: ['atk', 'anomalyProficiency', 'dmgBonus', 'elementDmg(physical)', 'penRatio', 'penFlat'],
    settlementSource: 'applier',
    settlementStats: ['anomalyDmgBonus', 'enemyResReduction', 'enemyDamageTakenBonus'],
    dmgZone: ['anomalyDmgBonus'],
    multiplier: '强击伤害 × 2.5% / 0.95s',
    note: '爱丽丝被动，不限于畏缩——敌人处于任何异常状态都触发。通常除无敌时间外全覆盖（有风属性也全覆盖）。畏缩本身无 DOT，只是持续时间内敌人失衡值提升 7.5% 的 buff。',
  },
  // ============ 爱丽丝 6 命附伤 ============
  alice_cinema6: {
    event: '爱丽丝6命附伤',
    kind: 'direct_attack',
    baseSource: 'none',
    baseStats: [],
    settlementSource: 'none',
    settlementStats: [],
    dmgZone: [],
    multiplier: '精通 × 3300% × 暴伤（必暴）',
    note: '本质是附伤事件（直伤类），不存在基础区/结算区之分。必暴、1秒1次、单轮最多6次。',
  },
}
