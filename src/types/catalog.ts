/**
 * ZZZ Calculator - 核心类型定义（精简版）
 */

// ============ 基础类型 ============

export interface LocalizedString {
  zhCN?: string
  en?: string
}

export type Rarity = 'S' | 'A' | 'B'
export type Specialty = 'attack' | 'stun' | 'anomaly' | 'support' | 'defense' | 'rupture' | 'sharpen'
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
  /** 锐能自动累积（点/秒）——角色专属资源「锐能」，目前只有克拉蕾 1611（nanoka `stats.ep_recover`/100 = 1.5） */
  sharpnessRegen?: number
  energyMax?: number        // 能量上限（默认 120 点）
  flashEnergyMax?: number   // 闪能上限（默认 0，命破角色才有）
  penRatio: number
  /** 锐暴伤害基值（仅少数角色数据带；缺省时面板取 50）。r407 前经 `(s as any)` 读取、未声明 */
  sharpCritDmg?: number
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
  veilStunCapMult: number
  /**
   * 叶瞬光帷幕易伤**基数**（= `veilStunMultiplier(boss基础易伤, 全部失衡易伤加成, cap) − 加成/100`）。
   *
   * 伤害池直接把它当本行的 `stunBase`（`calcDirectDamage` 内部还会再加一次
   * `stunDmgMultiplierBonus/100`，故这里反向扣掉）。唯一写入方 = `yeshuguang.ts#applyPanel`
   * （判据同 T6：字段非 0 即蕴含是本角色；非本角色恒为 0）。
   * 2026-09-17 round 18 / R15-d 由伤害池的 `row.agentId === '1431'` 分支迁入模块。
   */
  veilStunVulnBase: number
  // 异常积蓄相关
  anomalyBuildUpEfficiency: number // 异常积蓄效率提升，百分比
  /** 命中失衡状态敌人时的属性异常积蓄效率提升（%），池侧按失衡覆盖折算（南宫羽天使队长：全招式 +30） */
  anomalyBuildUpEfficiencyOnStunBonus: number
  /** 连携技命中失衡目标时的额外积蓄效率（%，与上一字段同区加算，南宫羽天使队长连携再 +30） */
  anomalyBuildUpEfficiencyOnStunChainBonus: number
  electricAnomalyBuildUpEfficiency: number // 电属性异常积蓄效率提升，百分比
  physicalAnomalyBuildUpEfficiency: number // 物理属性异常积蓄效率提升，百分比
  etherAnomalyBuildUpEfficiency: number // 以太属性异常积蓄效率提升，百分比
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
  remielleCinema4SpecialVoidflareRefillCount: number // 四命特殊虚耀一次性再装填数量
  remielleCinema6FleetingGraceVoidflareTriggerMultiplier: number // 六命「普通攻击：垂虹/惊鸿」耀变触发次数倍率（①=③同一效果 用户裁决 2026-09-30）
  remielleCinema6SpecialVoidflareCount: number // 六命普攻4段获得特殊虚耀数量
  remielleCinema6SpecialVoidflareDamageRatio: number // 六命特殊虚耀相对一命特殊虚耀伤害比例
  skillLevelBonus: number // 技能等级提升（3命+2，5命+4，通用字段）
  assaultCritRate: number     // 强击暴击率，百分比（仅物理强击及其乱流继承）
  assaultCritDmg: number      // 强击暴击伤害，百分比（仅物理强击及其乱流继承）
  selfAssaultCritDmgBonus: number // 简潜能觉醒：仅简自身触发强击时生效，乱流不继承
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
  // ---- r401（docs/mcp-panel-fields.md §4 S1）：以下 15 个跨层字段原先只靠末尾索引签名成立，现显式声明 ----
  // 能量/喧响类：音擎·驱动盘效果按 catalog.json 统计键写入（`utils/statMeta.ts` 登记标签），
  // `core/resource/resourceIncome.ts` 读；`core/panel.ts#emptyPanel` 初始化为 0。
  // 一律**必填** `number`（emptyPanel 都有初值）。r401 时是被迫的：当时末尾还是 `[key: string]: number`，`?:` 会撞 TS2411；r402 换成模板签名后不再冲突。
  // 下面 5 个原先缺省 = undefined 的字段，emptyPanel 里给的初值与所有读者的兜底同值（potentialLevel 读者全是 `?? 6`，其余 `?? 0`）⇒ 行为不变。
  /** 后台固定回能 */
  backstageEnergyRegenFlat: number
  /** 非操作固定回能 */
  nonOperatingEnergyRegenFlat: number
  /** 德玛拉能量获得效率 */
  demaraEnergyGainEfficiency: number
  /** 真元奇枢受伤/回血回能 */
  zhenyuanEnergyPerTrigger: number
  /** 时光切片闪反喧响 */
  timeSliceDodgeCounterDecibel: number
  /** 时光切片强特喧响 */
  timeSliceExSpecialDecibel: number
  /** 时光切片支援喧响 */
  timeSliceAssistDecibel: number
  /** 时光切片连携喧响 */
  timeSliceChainDecibel: number
  /** 时光切片触发回能 */
  timeSliceEnergyPerTrigger: number
  /** 回血量（statMeta 登记的统计键，emptyPanel 初值 0；面板上目前没有代码读者，招式回血走 `resourceCalc/helpers.ts#getHealingAmount`） */
  healingAmount: number
  /** 旧字段：灼心摇壶后台回能（兼容旧数据；新数据用 `backstageEnergyRegenFlat`，resourceIncome 两者相加） */
  roaringRideBackstageEnergyRegen: number
  /** 潜能等级（1..6）：`core/panel.ts` 算局外面板时盖章，`core/buff.ts` 动态潜能效果读 */
  potentialLevel: number
  /** 乱流抗性无视（%）：角色模块 applyPanel 写（现为维琳娜 1 命 20），`core/anomalyPool/helpers.ts` 乱流结算读 */
  turbulenceResIgnore: number
  /**
   * 风化侵染覆盖率原值（0..1）：`composables/useResourceCalc.ts` 构造 damagePanels 时以对象展开盖章（无风角色 ⇒ 0），
   * `composables/resourceCalc/panelPhases.ts` 传给 `axisWindowOverlays`（希格莉德浸染增伤）。
   */
  windInfectionRate: number
  /** 异化度展示值（%）：只出现在异常虚拟面板（`composables/resourceCalc/anomalyPanels.ts`） */
  refringe: number
  /**
   * 槽位号（0/1/2）**印章** —— 面板数组是**按位置压缩**的（`computePanel` 跳过空槽），
   * 故 `panels[i]` 的下标 i ≠ 槽位号。凡按槽位取面板一律走 `core/panel.ts#panelAt`
   * （或 `.find(p => p.slot === slot)`），**不要**用下标。producer 在 push 前盖章；
   * 测试手工构造的密集数组（下标 == 槽位号）可缺省，`panelAt` 对「整体无章」的数组按下标兜底。
   */
  slot: number
  /**
   * 定向属性键 `${stat}__${target}`（`core/buff.ts#targetedStatKey`，如 `skillDmgBonus__basic`）：buff 系统合法的动态通道。
   * r402（CC-376，`docs/mcp-panel-fields.md` §4 S2+S4）前这里是 `[key: string]: number`，任何模块都能往面板塞未声明的键、编译器不拦。
   * 现在未声明的键一律编译失败：通用字段在本接口声明；只有一个模块读写的字段在该模块里
   * `declare module '@/types/catalog' { interface PanelValues { xxx?: number } }`（D2 规则）；
   * 键名来自数据（catalog stat、`elementStatKey` 元素键族、`Object.keys`）时走 `utils/panelStat.ts`。
   */
  [key: `${string}__${string}`]: number
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
  /**
   * 局外面板属性门槛。结构化 {stat, min}（如 {stat:'def',min:1000}、{stat:'anomalyMastery',min:115}、
   * {stat:'critRate',min:50}）；兼容旧字符串格式 "stat=def min=1000"（历史数据曾是字符串正则口径）。
   */
  outOfCombatStat?: string | { stat: string; min: number }
  /** 特化限定：装备者 specialty 匹配才生效（如山大王 4pc 团队效果=击破） */
  specialty?: Specialty
  /** 属性限定：装备者 attribute 匹配才生效（如拂晓行纪 4pc 暴伤=以太） */
  attribute?: string
  /**
   * 装备者限定（CC-103 / R5 D18）：装备者 agent.id 在名单内才生效（如 14155 日冕遗蜕以太抗性无视=佩洛伊斯 1551）。
   * 数据声明、引擎通用判定——core 不写具体角色 id。当前只有音擎 effect 级读取。
   */
  wearerAgentIds?: string[]
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
  /** 运行时注入的来源角色潜能觉醒档位（1..6，取自源面板 `potentialLevel` 盖章）；公式中可用 p 变量，默认按 6 满档 */
  dynamicPotentialLevel?: number
  ratio?: number
  cap?: number
  basis?: string
  // stacked 类型
  valuePerStack?: number
  maxStacks?: number
  defaultStacks?: number
  // formula 类型
  formula?: { expression?: string; valueUnit?: string }
  /** stacked 类型的叠层显示名（catalog 数据带，如「青溟同行层数」；展示层读，引擎不读） */
  stackLabel?: LocalizedString
  /** 同 stackGroup 的效果共享叠层状态（catalog 数据带，如 qingming_companion；覆盖率滑块联动用，引擎仍按 effect.id 读） */
  stackGroup?: string
  /** 效果自带持续时间秒数（`scripts/patch-disc-sets.mjs` 写在效果级；CC-111 据此给 fixed 效果覆盖率滑块） */
  durationSeconds?: number
  /** 音擎精修 1–5 档的替换值（catalog 音擎 effect 带，`applyWEngineModLevel` 读）。r407 前 `as any` 读取、未声明 */
  modificationValues?: { value?: number[]; valuePerStack?: number[] }
  /** 该效果不作用于这些目标角色 id（teammate-buffs 数据带，`isExcludedForTarget` 读） */
  excludeTargetAgentIds?: string[]
  /** derived 来源变量声明（teammate-buffs 数据带；`defaultValue` 为来源值缺省，UI 滑块用 min/max） */
  source?: { variable?: string; label?: LocalizedString; defaultValue?: number; min?: number; max?: number }
}

/** buff 修饰器（队友 buff / 选择拐数据带）：把目标 buff 某些效果的已解析值乘以 factor（丽娜 C1 / 莱特 C2 / 悠夜 C1 等） */
export interface BuffModifier {
  id: string
  operation: 'multiplyResolvedValue'
  factor: number
  targetBuffIds?: string[]
  /** 空 / 缺省 = 目标 buff 的全部效果 */
  targetEffectIds?: string[]
  label?: LocalizedString
}

export interface BuffGroup {
  scope: BuffScope
  name?: LocalizedString
  description?: LocalizedString
  effects: BuffEffect[]
  buffModifiers?: BuffModifier[]
  /** 与 `scope === 'outOfCombat'` 同义的导入冗余字段，引擎不读（局外判定只看 scope）。同义性由 r5DataInvariants.test.ts 钉住（R6 C3）。 */
  appliesToOutOfCombatPanel?: boolean
  condition?: string
  /** 组级持续时间秒数。**防御性字段**：导入脚本当前只在效果级写 `durationSeconds`（见 `BuffEffect`），
   *  组级真被写上时 `TeamConfigPage` 的覆盖率滑块自动生效。 */
  durationSeconds?: number
  /**
   * 数值**单源化**标记：true = **不要**把本条的 effects 放进 `collectInCombatTeamBuffs`
   * （数值由角色模块 / helpers 单独接入），防「同一效果算两遍」。
   *
   * ⚠ 与「UI 可见性」**无关**（2026-09-20 R65 改名，原字段名 `hidden` 撒了这个谎：
   * 全库渲染面零处读它，于是属性配置页渲染出一批拨了没反应的控件）。
   * 渲染面的可交互性不靠人肉打标，而是从数据派生 —— 见 `src/utils/teammateBuffRows.ts`。
   * ⚠ 也**不是**「死控件」的修法：死控件的成因是「数值被别的写者覆写」，
   * 给它加 `singleSourced` 是 no-op（R64 实测三环全断，见 `.claude/PROMPT-handoff-round64.md` §1.1）。
   */
  singleSourced?: boolean
  /** 组级生效门槛（驱动盘 teamBuff 的装备者特化限定等），对该组全部 effect 生效 */
  requirement?: EffectRequirement
  /**
   * 互斥组：同组的全队效果**只计一次**（「同名被动效果之间不可叠加」）。目前只有 31900 原始朋克
   * 4 件套 teamBuff 标了。消费方：`core/inCombatBuffs.ts#collectInCombatTeamBuffs`（CC-101，R5 D8）。
   */
  exclusiveGroup?: string
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
  /** 整条 buff 不作用于这些目标角色 id（teammate-buffs 数据带，`isExcludedForTarget` 读） */
  excludeTargetAgentIds?: string[]
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
  // CC-276：原 `teammateBuffId`（队友 buff 归属别名）已退役——数据面 5 个取值全部等于自身 id，
  // 队友 buff 组 id 就是 agent.id（CC-275 在 catalog 加载处把 buff 拥有者也归一到组 id）。
  // 身份只剩 `id` 一个字段；数据若再出现不等于 id 的别名，`agentIdentitySingleField.test` 会红。
  /** 标记为仅队友角色（无完整倍率表，只用于提供队友 buff） */
  isTeammateOnly?: boolean
}

// ============ 技能数据 ============

export interface SkillRow {
  id: string
  label: LocalizedString
  kind: string
  /** 按技能等级取值的等级档（与 values 等长，如耀变倍率行 [12,14,16]；remielle 读取，parity 测试锁定） */
  levelValues?: number[]
  values: number[]
  /** 导入脚本合成的展示字段（scripts/resolve.mjs 打印用）。**引擎不读**：伤害基底由 core/damage.ts resolveSpecialDamageProfile 按 specialty 决定；
   *  命破角色此处写 atk 但实际按贯穿力算（R5 D6）。R6 C5 决定保留字段、不让引擎改读（字段不是规格）。 */
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
  // 4、5、6号位主词条选择。缺键 = 未选：时间线轻量速算（composables/teamTimelineStore.ts#applyTeamToStore）
  // 会清掉上一队残留的 4/6 号位只留 5 号位；读端（core/panel.ts 等）缺键即跳过。
  mainStats: {
    4?: StatId  // 4号位：百分比主词条
    5?: StatId  // 5号位：伤害杯
    6?: StatId  // 6号位：功能性（异握/冲击/能量回复）
  }
  // 副词条数量（按角色定位分配，0-54，6盘子总副词条步数）
  subStatAllocation: Record<StatId, number>  // stat -> 词条数（0~54）
}

// ============ Boss / 敌人 ============

export interface Boss {
  id: string
  name: LocalizedString
  level: number
  defense: number
  resistance: Record<DamageElement, number>
  stunMultiplier?: number
}

// ============ StatRules ============

export interface StatRules {
  /**
   * 属性展示元数据（catalog 外部数据，**驱动盘传入 mode 的权威面**）。
   *
   * `core/panel.ts#inferStatMode` 将 percent 映射为 pct，number/integer 映射为 flat。
   * 最终结算还取决于 `applyStat` 的字段分派：AM/回能等基础标量消费 mode；显式 Pct/Flat 键
   * 与暴击百分点、异常精通、固定穿透不依赖它，不能把所有 percent 都解释为“乘基础值”。
   * 当前合法副词条池属于后者；步长/步数与 mode 灵敏度反控见 `discSubstats.test.ts`。
   * ⚠ 实测存在「名字后缀与语义相反」的字段：`anomalyMastery`（异常掌控）名字带 `Mastery` 却是
   * `number`（+30 加点）⇒ 名字启发式必错（2026-09-18 round 28 修，见 `inferStatMode` 头注释）。
   * ⚠ 真实数据里 `label` 是 **string**（类型声明为 `LocalizedString` 是历史宽化，`useStatLabel` 兼容两形态）。
   */
  statDisplay: Record<string, { label: LocalizedString; display?: 'percent' | 'number' | 'integer'; format?: string }>
  driveDisc: {
    rarityMaxLevel: Record<Rarity, number>
    mainStatPools: Record<string, StatId[]>
    sRankMaxMainStat: Record<string, number>
    subStatPool: StatId[]
    sRankSubStatBaseStep: Record<string, number>
    /**
     * 驱动盘主词条 / 副词条的**结算口径**（pct = 按基础值百分比；flat = 固定值加点）。
     * 来源：nanoka 爬取的 `build-recommendations.json` `main_stats[*].format`（带 `%` ⇒ pct），
     * 副词条池里的 *Flat / anomalyProficiency 为 flat。CC-100（R5 D15）新增；缺失时回退 statDisplay.display。
     * 命名刻意避开 `utils/statMeta.ts#statSettlementMode`（全局 Buff 通路，语义不同）。
     */
    statModes?: Record<string, 'pct' | 'flat'>
  }
  calculation: {
    baseAttackRule: string
    baseHpRule: string
    baseDefRule: string
  }
}

// ============ Catalog 完整数据 ============

// 顶层字段白名单单一事实源镜像：scripts/lib/catalog-fields.mjs（CATALOG_FIELDS）。
// 消费方 = scripts/minify-static.mjs（剔除 legacy 死键）+ scripts/validate-data.mjs（机器护栏：
// catalog.json 顶层键必须 == 本接口字段，且 public/static/*.json 必须紧凑写）。
// 增删字段时两侧必须同步，否则 validate:data 红。
export interface Catalog {
  agents: Agent[]
  agentSkills: AgentSkills[]
  wEngines: WEngine[]
  driveDiscSets: DriveDiscSet[]
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

// ============ 计算结果 ============

export interface DamageBreakdownItem {
  label: string
  formula: string
  value: number
  displayValue: string
}
