/**
 * ZZZ Calculator - 核心类型定义（精简版）
 */

// ============ 基础类型 ============

export interface LocalizedString {
  zhCN?: string
  en?: string
}

export type Rarity = 'S' | 'A' | 'B'
export type Specialty = 'attack' | 'stun' | 'anomaly' | 'support' | 'defense' | 'rupture' | 'edgeguard' | 'sharpen'
export type Attribute = string
export type DamageElement = 'physical' | 'fire' | 'ice' | 'electric' | 'ether' | 'wind' | 'lumiflux'
export type StatId = string
export type BuffScope = 'outOfCombat' | 'inCombat'
export type EffectType = 'fixed' | 'derived' | 'stacked' | 'formula'
export type StatMode = 'flat' | 'pct' | 'decimal'
export type SkillDamageTarget = 'all' | 'basic' | 'special' | 'exSpecial' | 'ultimate' | 'chain' | 'assist' | 'dodgeCounter' | 'dashAttack' | 'additionalAttack'

// ============ 面板属性 ============

export interface Level60Stats {
  hpBase: number
  atkBase: number
  defBase: number
  critRate: number
  critDmg: number
  impact: number
  anomalyProficiency: number
  anomalyMastery: number
  energyRegen: number       // 能量自动回复（点/秒），普通角色 1.2，柏妮思 1.56
  flashEnergyRegen?: number // 闪能自动回复（点/秒），命破角色使用
  energyMax?: number        // 能量上限（默认 120 点）
  flashEnergyMax?: number   // 闪能上限（默认 0，命破角色才有）
  penRatio: number
}

export interface PanelValues {
  // 基础属性
  hp: number
  atk: number
  def: number
  critRate: number      // 百分比，如 5 表示 5%
  critDmg: number       // 百分比，如 50 表示 50%
  sharpCritDmg: number  // 锐暴伤害，锐化伤害暴击时替代暴击伤害
  impact: number        // 冲击力
  anomalyProficiency: number  // 异常精通
  anomalyMastery: number      // 异常掌控
  energyRegen: number       // 基础能量自动回复（点/秒），默认 1.2
  energyRegenOutOfCombat: number // 局外能量自动回复总计（基础 × 局外加成），供回能转模等读取
  flashEnergyRegen: number  // 基础闪能自动回复（点/秒），命破角色使用
  energyMax: number         // 能量上限（点），默认 120
  flashEnergyMax: number    // 闪能上限（点），默认 0，命破角色才有
  penRatio: number          // 穿透率，百分比
  penFlat: number           // 穿透值，固定值
  // 增伤区
  dmgBonus: number     // 通用伤害加成，百分比
  physicalDmg: number
  fireDmg: number
  iceDmg: number
  electricDmg: number
  etherDmg: number
  windDmg: number
  lumifluxDmg: number  // 辉光属性伤害
  penDmgBonus: number  // 贯穿增伤（命破角色用），百分比
  sheerForceFlat: number // 贯穿力固定提升
  sheerDmgBonus: number  // 贯穿伤害提升，百分比
  sharpDmgBonus: number // 锐化增伤（锋御角色用），百分比
  skillDmgBonus: number // 全招式伤害加成，百分比
  // 失衡相关
  stunBuildUpBonus: number      // 造成失衡值提升，百分比
  stunDmgMultiplierBonus: number // 失衡易伤（仅失衡时），百分比
  stunDmgMultiplierBonusAlways: number // 未失衡时也有的失衡易伤，百分比
  stunDmgMultiplierBonusCapAlways: number // 失衡易伤上限，百分比
  /** 叶瞬光帷幕易伤倍率上限（2.1/3.0；0=未启用） */
  yeshuguangStunCapMult: number
  // 异常积蓄相关
  anomalyBuildUpEfficiency: number // 异常积蓄效率提升，百分比
  electricAnomalyBuildUpEfficiency: number // 电属性异常积蓄效率提升，百分比
  physicalAnomalyBuildUpEfficiency: number // 物理属性异常积蓄效率提升，百分比
  // 异常伤害相关
  anomalyDmgBonus: number     // 异常伤害提升，百分比
  windAnomalyDmgBonus: number // 风化/风属性异常伤害提升，百分比
  turbulenceDamageBonus: number // 乱流伤害提升，百分比
  anomalyCritRate: number     // 异常暴击率，百分比（默认0，影响所有可暴击异常）
  anomalyCritDmg: number      // 异常暴击伤害，百分比（默认0，影响所有可暴击异常）
  anomalyReleaseDmgBonus: number // 异放伤害提升，百分比（异放专用独立区）
  remielleRefringeCoefficient: number // 蕾米埃尔折射/异化系数，百分比点
  remielleRefringeCoefficientBonusPct: number // 蕾米埃尔折射/异化系数提升，百分比
  remielleLuminizeMultiplierBonus: number // 蕾米埃尔被动耀变倍率提升，百分比点（由异常精通转化）
  remielleCinema4LuminizeMultiplierBonus: number // 蕾米埃尔4命耀变倍率独立提升，百分比点
  remielleCinema1SpecialVoidflareCount: number // 一命开局特殊虚耀数量
  remielleCinema1SpecialVoidflareDamage: number // 一命开局特殊虚耀伤害占位/计算结果
  remielleFlowerFeatherDanceDecibelPerUse: number // 花羽轮舞每次额外喧响
  remielleFlowerFeatherDanceCount: number // 花羽轮舞次数
  remielleCinema4SpecialVoidflareRefillCount: number // 四命特殊虚耀一次性再装填数量
  remielleCinema6LuminizeTriggerMultiplier: number // 六命异放/异常弹触发次数倍率
  remielleCinema6SpecialVoidflareTriggerMultiplier: number // 六命特殊虚耀触发次数倍率
  remielleCinema6FleetingGraceVoidflareTriggerMultiplier: number // 六命「普通攻击：惊鸿」关联虚耀触发次数倍率
  remielleCinema6SpecialVoidflareCount: number // 六命普攻4段获得特殊虚耀数量
  remielleCinema6SpecialVoidflareDamageRatio: number // 六命特殊虚耀相对一命特殊虚耀伤害比例
  skillLevelBonus: number // 技能等级提升（3命+2，5命+4，通用字段）
  assaultCritRate: number     // 强击暴击率，百分比（仅物理强击及其乱流继承）
  assaultCritDmg: number      // 强击暴击伤害，百分比（仅物理强击及其乱流继承）
  janeAssaultCritDmgBonus: number // 简潜能觉醒：仅简自身触发强击时生效，乱流不继承
  enemyAssaultDefReduction: number // 强击伤害无视/降低防御，百分比（简2命等）
  // 能量/资源相关
  energyRegenBonusPct: number     // 能量回复百分比加成（作用于基础回能）
  energyRegenBonusFlat: number    // 能量回复固定加成（直接加点数/秒）
  energyGainEfficiency: number    // 能量获得效率（最终乘区），百分比
  flashEnergyRegenBonusPct: number  // 闪能回复百分比加成
  flashEnergyRegenBonusFlat: number // 闪能回复固定加成
  flashEnergyGainEfficiency: number // 闪能获得效率，百分比
  decibelGainEfficiency: number     // 喧响获得效率，百分比
  // 敌方减益（作用于敌人的属性）
  enemyDefReduction: number       // 敌方防御降低，百分比（无视防御/减防）
  enemyDefFlatReduction: number   // 敌方防御固定降低
  enemyAnomalyDefReduction: number // 异常伤害专属防御降低/无视防御
  enemyLumifluxResReduction: number // 辉光/耀变伤害抗性降低/无视抗性
  enemyPhysicalDefReduction: number // 物理属性专属防御降低/无视防御
  enemyFireDefReduction: number     // 火属性专属防御降低/无视防御
  enemyIceDefReduction: number      // 冰属性专属防御降低/无视防御
  enemyElectricDefReduction: number // 电属性专属防御降低/无视防御
  enemyEtherDefReduction: number    // 以太属性专属防御降低/无视防御
  enemyWindDefReduction: number     // 风属性专属防御降低/无视防御
  enemyLumifluxDefReduction: number // 辉光/耀变专属防御降低/无视防御
  enemyResReduction: number       // 敌方抗性降低，百分比（旧兼容：全元素）
  enemyPhysicalResReduction: number // 物理属性专属抗性降低/无视抗性
  enemyFireResReduction: number     // 火属性专属抗性降低/无视抗性
  enemyIceResReduction: number      // 冰属性专属抗性降低/无视抗性
  enemyElectricResReduction: number // 电属性专属抗性降低/无视抗性
  enemyEtherResReduction: number    // 以太属性专属抗性降低/无视抗性
  enemyWindResReduction: number     // 风属性专属抗性降低/无视抗性
  enemyStunResReduction: number    // 敌方失衡抗性降低，百分比（旧兼容：全元素）
  enemyPhysicalStunResReduction: number // 物理属性专属失衡抗性降低/无视
  enemyFireStunResReduction: number // 火属性专属失衡抗性降低/无视
  enemyIceStunResReduction: number // 冰属性专属失衡抗性降低/无视
  enemyElectricStunResReduction: number // 电属性专属失衡抗性降低/无视
  enemyEtherStunResReduction: number // 以太属性专属失衡抗性降低/无视
  enemyWindStunResReduction: number // 风属性专属失衡抗性降低/无视
  enemyLumifluxStunResReduction: number // 辉光/耀变专属失衡抗性降低/无视
  enemyAnomalyResReduction: number // 敌方异常积蓄抗性降低，百分比（旧兼容：全元素）
  enemyPhysicalAnomalyResReduction: number // 物理属性专属积蓄抗性降低/无视
  enemyFireAnomalyResReduction: number // 火属性专属积蓄抗性降低/无视
  enemyIceAnomalyResReduction: number // 冰属性专属积蓄抗性降低/无视
  enemyElectricAnomalyResReduction: number // 电属性专属积蓄抗性降低/无视
  enemyEtherAnomalyResReduction: number // 以太属性专属积蓄抗性降低/无视
  enemyWindAnomalyResReduction: number // 风属性专属积蓄抗性降低/无视
  enemyLumifluxAnomalyResReduction: number // 辉光/耀变专属积蓄抗性降低/无视
  enemyDamageTakenBonus: number    // 敌方受到伤害提升（易伤），百分比
  enemyCritDmgTakenBonus: number   // 敌方受到暴击伤害提升，百分比（霜寒状态提供）
  enemyStunTakenBonus: number      // 敌方受到失衡值提升，百分比
  disorderDamageBonus: number       // 紊乱增伤，百分比（仅紊乱结算区）
  disorderBaseMultiplierBonus: number // 紊乱基础倍率提升（加到紊乱基础倍率）
  anomalyDurationBonusSeconds: number // 异常持续时间增加（只影响DoT/紊乱剩余时间）
  /** 按元素异常持续时间增加（简+物理5s、柏妮思+火3s、爱芮+以太3s、丽娜+电3s） */
  physicalAnomalyDurationBonusSeconds: number
  fireAnomalyDurationBonusSeconds: number
  electricAnomalyDurationBonusSeconds: number
  etherAnomalyDurationBonusSeconds: number
  /** 风化侵染区加成（独立乘区，%）：仅风属性与其染色属性直伤生效 */
  infectionZoneBonus: number
  /** 额外能力是否触发（0/1）：由 spec.additionalAbility 声明式条件统一判定写入，模块/伤害池按标记开关 */
  additionalAbilityActive: number
  /** 失衡持续时间延长（秒）：角色级，敌人进入失衡后的持续时间 +N 秒（琉音恶意投诉、诺姆技术鸿沟等） */
  stunDurationBonusSeconds: number
  // 其他
  [key: string]: number
}

// ============ Buff 效果系统 ============

export interface EffectTarget {
  kind: 'default' | 'skill' | 'teammate' | 'self'
  skillTargets?: SkillTarget[]
}

export interface SkillTarget {
  kind: 'skillType' | 'skillTag' | 'specific'
  skillType?: string
  skillTag?: string
  agentSkillId?: string
  categoryId?: string
  moveId?: string
  rowId?: string
}

export interface EffectCoverage {
  default: number
  min: number
  max: number
  step: number
}

export interface EffectRequirement {
  outOfCombatStat?: string
}

export interface BuffEffect {
  id: string
  type: EffectType
  stat: StatId
  mode: StatMode
  value: number
  target?: EffectTarget
  coverage?: EffectCoverage
  requirement?: EffectRequirement
  /** stat=skillDmgBonus 时使用：指定该招式增伤作用的技能类型 */
  targetSkillType?: SkillDamageTarget
  // derived 类型
  sourceLabel?: LocalizedString
  defaultSourceValue?: number
  /** 转模来源属性，如 atk / hp / penRatio / anomalyMastery */
  sourceStat?: StatId
  /** 转模来源属性取值阶段：初始/局外属性取 outOfCombat，当前/局内属性取 inCombat */
  sourcePanelPhase?: BuffScope
  /** 运行时注入的来源角色实际属性值；未提供时回落到 defaultSourceValue / source.defaultValue */
  dynamicSourceValue?: number
  /** 运行时注入的来源角色技能等级（12 + skillLevelBonus）；公式中可用 s 变量，默认按 12 级 */
  dynamicSkillLevel?: number
  ratio?: number
  cap?: number
  basis?: string
  // stacked 类型
  valuePerStack?: number
  maxStacks?: number
  defaultStacks?: number
  // formula 类型
  formula?: { expression?: string; valueUnit?: string }
}

export interface BuffGroup {
  scope: BuffScope
  name?: LocalizedString
  description?: LocalizedString
  effects: BuffEffect[]
  buffModifiers?: any[]
  appliesToOutOfCombatPanel?: boolean
  condition?: string
  hidden?: boolean
}

// ============ 队友 Buff ============

export interface TeammateBuff extends BuffGroup {
  id: string
  source?: LocalizedString       // 来源名称（如"核心被动"、"影画一"）
  sourceType: 'teammate' | 'agent'
  sourceCategory: 'agent' | 'wEngine' | 'driveDisc'
  sourceKind: string
  sourceLabel: LocalizedString
  ownerId: string
  ownerName: LocalizedString
  teammateId: string
  teammateName: LocalizedString
  conditionLabel?: LocalizedString
}

export interface TeammateBuffGroup {
  id: string
  name: LocalizedString
  attribute: string
  specialty: Specialty
  images?: { icon?: string }
  buffs: TeammateBuff[]
}

// ============ 角色类型 ============

export interface CoreSkillLevel {
  level: string
  label?: LocalizedString
  stats?: { stat: StatId; value: number; mode: StatMode; target?: string }[]
  skillLevelBonuses?: { skill: string; value: number }[]
}

export interface CoreSkill {
  name: LocalizedString
  defaultLevel: string
  levels: CoreSkillLevel[]
}

export interface CinemaBuff {
  cinemaLevel: number
  cinemaName: LocalizedString
  description?: LocalizedString
  buff?: BuffGroup
}

export interface AgentCombatBuffs {
  corePassive: BuffGroup | null
  additionalAbility: BuffGroup | null
  cinemaBuffs: CinemaBuff[]
}

export interface Agent {
  id: string
  name: LocalizedString
  rarity: Rarity
  attribute: Attribute
  specialty: Specialty
  attackTypes: string[]
  faction: string
  images: { portrait?: string; icon?: string; source?: string }
  level60: Level60Stats
  combatBuffs: AgentCombatBuffs
  coreSkill: CoreSkill
  damageElement?: DamageElement
  /** 平A基准段 moveId（可选）：缺省时引擎取第 3 个普通段。特殊情况在数据里配置，不用改代码。 */
  basicBenchmarkMoveId?: string
  sources: string[]
  verification?: Record<string, string>
  hidden?: boolean
  /** 映射到 teammate-buffs.json 中的角色 ID（nanoka 角色用英文名匹配队友 buff） */
  teammateBuffId?: string
  /** 标记为仅队友角色（无完整倍率表，只用于提供队友 buff） */
  isTeammateOnly?: boolean
}

// ============ 技能数据 ============

export interface SkillRow {
  id: string
  label: LocalizedString
  kind: string
  values: number[]
  damageBasis?: string
  damageElement?: DamageElement
}

export interface SkillMove {
  id: string
  name: LocalizedString
  damageElement?: DamageElement
  skillType?: string
  skillTags?: string[]
  /** 时间公式类型：normal=一般, dodgeCounter=闪避反击, parry=弹刀, ultimate=终结技 */
  timeType?: 'normal' | 'dodgeCounter' | 'parry' | 'ultimate'
  /** 预计算的动作时间（秒），= ether_purify/100 - 固定减免 */
  actionTime?: number
  /** 能量消耗（字典，如 {"Energy Cost": "60"}），仅强特等消耗能量的招式有 */
  energyCost?: Record<string, string>
  /** 合轴率 0-1（0=不合轴，1=完全合轴），默认0，部分招式可设为1表示必定合轴 */
  comboAlignRatio?: number
  rows: SkillRow[]
}

export interface SkillCategory {
  id: string
  name: LocalizedString
  levelRange: { min: number; max: number; default: number } | { levels: string[]; default: string }
  moves: SkillMove[]
}

export interface AgentSkills {
  id: string
  agentId: string
  name: LocalizedString
  categories: SkillCategory[]
}

// ============ 音擎类型 ============

export interface WEngineAdvancedStat {
  stat: StatId
  value: number
  mode: StatMode
  target?: EffectTarget
}

export interface WEngineLevel60 {
  atkBase: number
  /** 音擎基础属性类型；缺省为 atk，防御系音擎为 def（基础防御力） */
  baseStat?: 'atk' | 'def' | 'hp'
  advancedStat: WEngineAdvancedStat
}

export interface WEngineModification {
  minLevel: number
  maxLevel: number
  defaultLevel: number
}

export interface WEngineEffect {
  name: LocalizedString
  requirement?: { specialty: Specialty; label: LocalizedString }
  description: LocalizedString
  selfBuff: BuffGroup | null
  teamBuff: BuffGroup | null
}

export interface WEngine {
  id: string
  name: LocalizedString
  rarity: Rarity
  specialty: Specialty
  attribute: string
  images: { icon?: string; source?: string }
  level60: WEngineLevel60
  modification: WEngineModification
  effect: WEngineEffect
  sources: string[]
  verification?: Record<string, string>
  legacyIds?: string[]
  /** 专属角色 id（来自 nanoka icon Weapon_[SA]_<角色id>；非专属音擎无此字段） */
  ownerAgentId?: string
}

// ============ 驱动盘套装类型 ============

export interface DriveDiscSetPiece {
  effects: BuffEffect[]
}

export interface DriveDiscSetFourPiece {
  effectText: LocalizedString
  selfBuff: BuffGroup | null
  teamBuff: BuffGroup | null
}

export interface DriveDiscSet {
  id: string
  name: LocalizedString
  images: { icon?: string; source?: string }
  twoPiece: DriveDiscSetPiece
  fourPiece: DriveDiscSetFourPiece
  sources: string[]
  /** 旧 id（zzz_wiki_XXXX 等），id 统一为数字后的兼容映射 */
  legacyIds?: string[]
}

// ============ 驱动盘配置（非实例） ============

export interface DriveDiscConfig {
  fourPieceSetId: string       // 4件套套装
  twoPieceSetId: string        // 2件套套装（可选，空表示纯4件套）
  // 4、5、6号位主词条选择
  mainStats: {
    4: StatId  // 4号位：百分比主词条
    5: StatId  // 5号位：伤害杯
    6: StatId  // 6号位：功能性（异握/冲击/能量回复）
  }
  // 副词条数量（按角色定位分配，0-54，6盘子总副词条步数）
  subStatAllocation: Record<StatId, number>  // stat -> 词条数（0~54）
}

// ============ 异常/紊乱 ============

export interface AnomalyEffect {
  id: string
  settlementType: string
  label: LocalizedString
  element: DamageElement
  baseMultiplier: number
  defaultProcCount: number
  baseDurationSeconds: number
  tickIntervalSeconds: number
}

export interface DisorderEffect {
  id: string
  settlementType: string
  label: LocalizedString
  element: DamageElement
  fixedMultiplier: number
  tickMultiplier: number
  tickIntervalSeconds: number
  defaultDurationSeconds: number
}

// ============ Boss / 敌人 ============

export interface Boss {
  id: string
  name: LocalizedString
  level: number
  defense: number
  resistance: Record<DamageElement, number>
  stunMultiplier?: number
  [key: string]: any
}

// ============ StatRules ============

export interface StatRules {
  statDisplay: Record<string, { label: LocalizedString; format?: string }>
  driveDisc: {
    rarityMaxLevel: Record<Rarity, number>
    mainStatPools: Record<string, StatId[]>
    sRankMaxMainStat: Record<string, number>
    subStatPool: StatId[]
    sRankSubStatBaseStep: Record<string, number>
  }
  calculation: {
    baseAttackRule: string
    baseHpRule: string
    baseDefRule: string
  }
}

// ============ Catalog 完整数据 ============

export interface Catalog {
  agents: Agent[]
  agentSkills: AgentSkills[]
  wEngines: WEngine[]
  driveDiscSets: DriveDiscSet[]
  anomalyEffects: AnomalyEffect[]
  disorderEffects: DisorderEffect[]
  teammateCombatBuffs: TeammateBuff[]
  teammateCombatBuffGroups: TeammateBuffGroup[]
  bosses: Boss[]
  statRules: StatRules
}

// ============ 配装推荐（nanoka.cc 邦布精灵推荐） ============

export interface BuildDriveDiscSet {
  id: string
  name_en: string
  name_zh: string
  desc2_en: string
  desc4_en: string
  desc2_zh: string
  desc4_zh: string
}

export interface BuildMainStat {
  prop: string
  name: string
  format: string
  icon: string
}

export interface BuildSubstat {
  prop: string
  name: string
  priority: number
  icon?: string
}

export interface BuildSkillPriority {
  first: number[]
  second: number[]
  third: number[]
}

/** 专武推荐（nanoka ID 规律推导 + catalog 名称匹配） */
export interface BuildWEngine {
  /** nanoka 音擎 ID（S级=14+角色前三位，A级=13+角色前三位） */
  nanoka_wengine_id: string
  /** 音擎等级（S/A） */
  rank: string
  name_en: string
  name_zh: string
  /** nanoka 图标名（如 Weapon_S_1491） */
  icon: string
  /** 基础攻击力 */
  atk: number
  /** 副词条类型 */
  sub_stat: string
  /** 音擎描述（风味文本） */
  desc: string
  /** catalog.json 中的音擎 ID（通过中文名匹配，未匹配则为 null） */
  catalog_wengine_id: string | null
}

export interface CharacterBuildRecommendation {
  name: LocalizedString
  nanoka_id: string
  source_url: string
  strategy: string[]
  drive_disc_sets: {
    four_piece?: BuildDriveDiscSet
    two_piece?: BuildDriveDiscSet
    alt_two_piece?: BuildDriveDiscSet
  }
  main_stats: Record<number, BuildMainStat>
  substats: BuildSubstat[]
  /** 旧版爬取字段；当前计算默认技能全满级，推荐数据可不包含 */
  skill_priority?: BuildSkillPriority | null
  /** 专武推荐 */
  wengine?: BuildWEngine
}

export interface BuildRecommendations {
  metadata: {
    source: string
    description: string
    total_characters: number
    scraped_at: string
    note: string
    prop_map: Record<string, string>
    /** 专武 ID 规律说明 */
    wengine_id_pattern?: string
  }
  drive_disc_sets: Record<string, BuildDriveDiscSet>
  characters: Record<string, CharacterBuildRecommendation>
}

// ============ 计算配置 ============

export interface CalculatorConfig {
  // 主C配置
  mainAgentId: string
  mainCinemaLevel: number
  mainWEngineId: string
  mainWEngineModLevel: number
  driveDiscConfig: DriveDiscConfig
  // 队友配置（2个队友）
  teammates: {
    agentId: string
    cinemaLevel: number
    wEngineId: string
    wEngineModLevel: number
    enabled: boolean
  }[]
  // 敌人配置
  bossId: string
  enemyLevel: number
  enemyDefense: number
  enemyResistance: Record<string, number>
  stunMultiplier: number
  /** 是否失衡或失衡易伤覆盖率（0-1，期望乘区按覆盖率折算） */
  stunned: boolean | number
  // 暴击模式
  critMode: 'expect' | 'crit' | 'nonCrit'
}

// ============ 计算结果 ============

export interface DamageBreakdownItem {
  label: string
  formula: string
  value: number
  displayValue: string
}

export interface SkillDamageResult {
  moveId: string
  moveName: string
  category: string
  directDamage: number       // 直伤
  stunBuildUp: number        // 失衡积蓄
  anomalyBuildUp: number     // 异常积蓄
  energyRegen: number        // 能量回复
  breakdown: DamageBreakdownItem[]
}

export interface DamageResult {
  totalDamage: number
  skillResults: SkillDamageResult[]
  panelValues: PanelValues
  inCombatPanelValues: PanelValues
  breakdown: DamageBreakdownItem[]
}
