/**
 * ZZZ 资源池计算 - 类型定义
 *
 * 资源池系统包含：能量/闪能、喧响、时间、失衡、连携
 * 核心是循环计算：平A时间→回能→强特/大招次数→必做动作前台时间→可分配时间→重新分配
 */

// ============ 时间分配 ============

/** 单个角色的战场时间分配 */
export interface TimeAllocation {
  /** 单角色前台时间（必做动作前台 + 平A时间，含合轴部分） */
  frontlineTime: number
  /** 后台时间（180 - 前台时间） */
  backstageTime: number
  /** 合轴时间（前台中的非操作时间，触发"非操作中角色"回能加成） */
  comboAlignTime: number
  /**
   * 合轴抵扣时间：comboAlignTime 中**含在 necessaryTime 内**、可与其他角色动作并行
   * 的部分——团队时间预算与超时判定只抵扣该值（NET 约定模块的合轴已剔除出
   * necessaryTime，不再重复抵扣；GROSS 约定与通用招式 = comboAlignTime）。
   */
  comboAlignCredit?: number
  /** 平A时间（可自由分配的战场时间） */
  basicAttackTime: number
  /** 必做动作前台时间（强特+大招+连携+特殊招式的 actionTime 之和，未扣除合轴） */
  necessaryTime: number
}

// ============ 能量资源 ============

/**
 * 队友联动回能明细（依赖「其他槽位的次数」的能量来源）。
 *
 * 这些来源既要参与 iterate 的次数推导，也必须出现在最终 energySource 明细里。
 * 单一事实源 = `core/resource/helpers.ts` 的 `calcCrossAgentEnergy`（两处调用同一函数）。
 * 历史事故：曾在 iterate 与最终装配各写一份，且最终明细只补回 supportUltimateRegen，
 * 导致界面「能量/闪能总览」比真正驱动次数的能量少一截（仪玄队友终结闪能 120 全程不可见）。
 */
export interface CrossAgentEnergy {
  /** 辅助角色终结技邻位回能（其他角色 supportUltimateEnergyRegen × 其终结技次数） */
  supportUltimateRegen: number
  /** 模块声明的「队友终结技回闪能」（仪玄额外能力·玄墨暗涌 20/次） */
  teamUltimateFlash: number
  /** 丽娜（1211）终结技按槽位补充能量 */
  rinaUltEnergy: number
  /** 苍角（1131）终结技邻位回能（邻位 30/10） */
  soukakuUltEnergy: number
  /** 露西（1151）终结邻位回能 + 影画1 回旋全队回能 */
  lucyEnergy: number
  /** 莱特（1161）影画4 士气喷发后场回能 */
  lighterC4Energy: number
  /** 席德（1461）额外能力为正兵回能（2 能量/秒 × 席德前台时间，1秒至多1次） */
  xideVanguardEnergy: number
  /** 合计（已计入 EnergySource.total） */
  total: number
}

/** 能量回复来源明细 */
export interface EnergySource {
  /** 自动回复：基础回能 × 战斗时间，不含百分比/固定/效率加成 */
  autoRegen: number
  /** 百分比回能加成：基础回能 × 百分比加成 × 战斗时间 */
  pctRegenBonus: number
  /** 全程固定回能加成：固定加成 × 战斗时间 */
  flatRegenBonus: number
  /** 后台回能加成：后台时间 × 后台固定回能加成（来自灼心摇壶等） */
  backstageBonus: number
  /** 非操作回能加成：合轴/非操作时间 × 非操作固定回能加成（来自思络成歌等） */
  comboAlignBonus: number
  /** 获得效率额外收益：上述自动回能来源 × 能量获得效率（含德玛拉覆盖秒数折算） */
  gainEfficiencyBonus: number
  /** 德玛拉电池II型覆盖秒数：min((闪反+快支+弹刀)×8, 战斗时间) */
  demaraCoverageSeconds: number
  /** 德玛拉电池II型覆盖率：覆盖秒数 / 战斗时间 */
  demaraCoverageRate: number
  /** 战场平A回复：平A时间 × 秒均回能 */
  basicAttackRegen: number
  /** 时光切片触发回能：按闪反/强特/支援/连携触发次数结算 */
  timeSliceEnergy: number
  /** 真元奇枢受伤/回血触发回能：当前需资源轴提供触发次数，默认0 */
  zhenyuanEnergy: number
  /** 诺姆影画2·帽子把戏回能：战斗中触发帽子把戏回25能量，20秒冷却；按战斗时间驱动（180s→9次） */
  hatTrickEnergy: number
  /** 青衣影画4·稳态电弧屏障回能：护盾刷新回5能量，10秒冷却；按战斗时间驱动（180s→18次） */
  qingyiC4Energy: number
  /** 莱卡恩影画2·能量回馈回能：失衡或队友连携触发回5能量；次数 = 失衡次数 + 队伍连携总次数 */
  lycaonC2Energy: number
  /** 比利影画1：冲刺攻击/闪避反击命中回能（合并原始次数后按5秒冷却封顶） */
  billyC1Energy: number
  /** 伊德海莉：非失衡（溯寒后）极寒重碾每次回 15 闪能 */
  yidhariRefund: number
  /** 般岳：怒相内山威强特回闪能（4 山威/怒相 × 10/个，影画2 额外 +5/个） */
  banyueSwayRefund: number
  /** 仪玄：额外闪能总账（完美格挡+10/次、极限闪避+5/次、影画1落雷+5/次，模块汇总进 cfg.yixuanFlashBonus） */
  yixuanFlashBonus: number
  /** 安东影画1：每个实际电钻招式最多回5能量，已计入 total */
  antonC1EnergyGift: number
  /** 辅助大招回复：辅助大招次数 × 每次回能量（= crossAgent.supportUltimateRegen，保留旧字段供界面直读） */
  supportUltimateRegen: number
  /** 队友联动回能明细（已计入 total；单一事实源 calcCrossAgentEnergy） */
  crossAgent: CrossAgentEnergy
  /** 开局赠送（普通人40，仪玄120闪能，般岳/比利60闪能，部分命座额外） */
  initialGift: number
  /** 破秽盾赠送（60点能量/闪能） */
  shieldBreakGift: number
  /** 破能量盾赠送（30点能量，不给命破角色加闪能） */
  energyShieldBreakGift: number
  /** 总计 */
  total: number
}

// ============ 喧响资源 ============

/** 喧响回复来源明细 */
export interface DecibelSource {
  /** 开局赠送（每人1000，部分命座额外） */
  initialGift: number
  /** 招式回复（平A+强特+大招+连携等所有招式的 decibel_recovery 之和） */
  skillRegen: number
  /** 奖励回复（时光切片等池内效果；快支/弹刀/连携奖励见 specialActionBonus） */
  bonusRegen: number
  /** 时光切片额外喧响：按闪反/强特/支援/连携触发次数结算，已计入奖励回复 */
  timeSliceDecibel: number
  /** 特殊动作奖励（弹刀215/闪反10/连携10/快支20，含队友伴随50%）；参与终结技次数推导 */
  specialActionBonus: number
  /** 异常/紊乱/乱流触发奖励（含队友伴随50%）；参与终结技次数推导 */
  anomalyBonus: number
  /** 队友伴随获得（其他队友招式回复的 50% 或 52.5%） */
  teammateShare: number
  /** 不可分享的额外喧响（如蕾米一命花羽轮舞） */
  unshareableBonus: number
  /** 伊德海莉烧血喧响（75%开局 + 回血总量）换算，固定不可分享 */
  yidhariBurnDecibel: number
  /** 总计（不含开局赠送，用于分给队友） */
  shareableTotal: number
  /** 总计（含开局赠送） */
  total: number
}

// ============ 维琳娜专属资源 ============

/** 维琳娜风华资源明细 */
export interface VelinaFloriaSource {
  /** 初始风华，默认45 */
  initial: number
  /** 消耗能量获得的风华（当前按强特耗能折算） */
  energySpentGain: number
  /** 总可用风华 = 初始 + 能量消耗获得 */
  totalAvailable: number
  /** 90风华消耗触发广域气旋的次数 */
  broadCycloneCount: number
  /** 广域气旋消耗风华 = broadCycloneCount × 90 */
  broadCycloneCost: number
  /** 结余风华 */
  remaining: number
}

/** 维琳娜风蚀资源明细 */
export interface VelinaCorrosionSource {
  /** 乱流总次数 */
  turbulenceCount: number
  /** 0/1风蚀触发乱流时获得风蚀并触发微域气旋的次数 */
  microCycloneCount: number
  /** 2风蚀触发乱流时消耗风蚀并替换为广域气旋的次数 */
  broadCycloneCount: number
  /** 本次乱流获得+150%倍率区提升的次数 */
  boostedTurbulenceCount: number
  /** 2命风化获得风蚀的期望值 */
  c2WindGainExpected: number
  /** 6命消耗2风蚀后返还1点的次数 */
  cinema6RefundCount: number
  /** 最终剩余风蚀 */
  finalCorrosion: number
  /** 当前状态机说明 */
  note: string
}

// ============ 爱丽丝专属资源 ============

/** 爱丽丝剑意资源明细 */
export interface AliceSwordWillSource {
  /** 额外能力入场赠送，默认300 */
  initial: number
  /** 普攻段获得的剑意 = basicAttackTime × swordWillPerSec */
  basicAttackGain: number
  /** 强特获得的剑意 = exSpecialCount × exSpecialSwordWill */
  exSpecialGain: number
  /** 极性强击获得的剑意 = sparkCount × polarityAssaultSwordWill */
  polarityAssaultGain: number
  /** 每次极性强击回复剑意量（C0=10，C1=35） */
  polarityAssaultPerSpark: number
  /** 全队强击获得的剑意 = 全队强击触发次数 × 10 */
  teamAssaultGain: number
  /** 紊乱回复剑意 = 紊乱次数 × 30 */
  disorderGain: number
  /** 二命终结技额外触发极性强击次数 */
  c2UltSparkCount: number
  /** 总可用剑意 = initial + basicAttackGain + exSpecialGain + polarityAssaultGain + teamAssaultGain + disorderGain */
  totalAvailable: number
  /** 星芒圆舞曲 #3 触发次数 = floor(totalAvailable / 300) + c2UltSparkCount */
  sparkCount: number
  /** 星芒圆舞曲 #3 总消耗 = sparkCount × 300 */
  sparkCost: number
  /** 结余剑意 */
  remaining: number
}

/** 洛克茜风能/风眼资源明细 */
export interface RoxyWindEnergySource {
  /** 强特消耗能量合计（当前按强特次数 × 单次耗能） */
  energySpentTotal: number
  /** 风能总量 = floor(总耗能 / 25) + 终结技次数（核心被动 Lv.7：每 25 能量 +1）；3 为存量上限 */
  windEnergyGain: number
  windEnergyCap: number
  /** 敬请安息消耗风能 = min(总获得, 强特次数 × 3)（存量上限 3/发） */
  windEnergyConsumed: number
  /** 敬请安息每消耗 1 点风能生成的风眼数（上限 9，30s 自动引爆） */
  windEyeGenerated: number
  /** 被引爆的风眼数（全部，爆鸣结算） */
  windEyeDestroyed: number
  /** 恕不远送次数 = floor(消耗/3)（每次引爆至多 3 个风眼） */
  sendOffCount: number
  /** 巨型风旋次数（3 个风眼同命中 → 1s） */
  megaTornadoCount: number
  /** 小旋风个数（不足 3 的余数） */
  miniTornadoCount: number
  /** 小旋风总秒数 = miniTornadoCount × 1s（v12 持续 1 秒） */
  miniTornadoSeconds: number
  /** 自旋秒数（滑块，30 能量/s） */
  spinSeconds: number
  note: string
}

/** 克拉蕾残痕/锐能资源明细（v12 口径 2026-09-03） */
export interface ClaretSharpResourceSource {
  /** 残痕值来源（%）：平A聚合（秒均残痕值×平A时间）+ 秘血铸锋单发（234.96%）；锐化伤害命中积累 */
  gashValuePct: number
  /** 残痕积蓄效率倍率 = 1 + 核心被动 50%（Lv7，猩红铭刻期间近似常驻）+ 影画2 20%（锐暴命中近似常驻） */
  gashBuildupMultiplier: number
  /** 残痕层数 = floor(残痕值 / 100)，上限 3 层（溢出浪费） */
  gashStacks: number
  /** 血华誓毁伤需求次数（斩金断铁×1 + 葬血强袭×3 + 影画6 连携/终结各1） */
  maimDemand: number
  /** 命中残痕状态消耗的层数 = min(残痕层数, 需求) × 残痕覆盖率 */
  gashStackConsumed: number
  /** 触发毁伤次数 = 消耗残痕层数 + 影画6 不消耗残痕的单体毁伤 */
  maimCount: number
  /** 斩金断铁触发的毁伤数 */
  maimFromCleave: number
  /** 葬血强袭触发的毁伤数 */
  maimFromBurial: number
  /** 影画6 连携/终结重击直接触发的单体毁伤数（不消耗残痕） */
  maimFromC6: number
  /** 锐能初始 60（进场，勘域 180s 一次）——v12 口径：锐能只此来源 */
  sharpnessGain: number
  /** 锐能可负担的秘血铸锋次数 = floor(锐能 / 60) */
  affordableExCount: number
  /** 锐能消耗（秘血铸锋 60/次） */
  sharpnessSpend: number
  sharpnessRemaining: number
  note: string
}

/** 雅落霜资源明细 */
export interface MiyabiFrostFallSource {
  total: number
  frostMoonCount: number
}

/** 简机制资源明细（啮咬/狂热/强击暴击） */
export interface JaneMechanicSource {
  assaultCritBaseRate: number
  assaultCritRatePerMastery: number
  assaultCritRate: number
  assaultCritDmgBonus: number
  frenzyBuildUpBonus: number
  atkFromMastery: number
  frenzyActive: boolean
  biteSeconds: number
  note: string
}

/** 柏妮思燃点/余烬资源明细 */
export interface BurniceMechanicSource {
  initialIgnition: number
  ignitionFromEnergy: number
  ultimateIgnitionGain: number
  totalIgnition: number
  ignitionCap: number
  specialStateActive: boolean
  emberTriggerCount: number
  emberCost: number
  emberDamageRatio: number
  emberDamageRatioWithMastery: number
  emberDamagePerHit: number
  emberTotalDamage: number
  /** 单次基础积蓄，固定 60；1命效率加成单独存在 emberBuildUpEfficiencyBonusPct */
  emberBuildUpPerHit: number
  emberBuildUpEfficiencyBonusPct: number
  /** 基础积蓄总和 = 60 × 触发次数，不含1命效率加成 */
  emberTotalBuildUp: number
  emberTotalTriggerCount: number
  stirringMaxCount: number
  stirringCount: number
  stirringDamageRatio: number
  /** 搅拌式（炽焰搅拌式 1171007 融合）单次动作时长（秒） */
  stirringActionTimeSeconds: number
  stirringIgnitionCost: number
  stirringIgnitionSpent: number
  stirringFreeEmberCount: number
  flowCountRaw: number
  flowCountUtilization: number
  flowCountEffective: number
  flowFireCount: number
  tossingCount: number
  tossingMoveId: string
  tossingDamageRatio: number
  /** 流火·灼热抛接法（1171026）单次动作时长（秒） */
  tossingActionTimeSeconds: number
  releaseMultiplier: number
  releaseCount: number
  cinemaLevel: number
  cinema2TeamPenRatio: number
  cinema4CritRateBonus: number
  cinema4DoubleSprayMaxSeconds: number
  cinema6FireResIgnore: number
  cinema6SpecialEmberCount: number
  cinema6SpecialEmberPerCast: number
  cinema6SpecialEmberBaseRatio: number
  cinema6SpecialEmberDamageRatio: number
  cinema6SpecialEmberDamagePerHit: number
  cinema6SpecialEmberTotalDamage: number
  cinema6BurnBurstCount: number
  cinema6BurnBurstMultiplier: number
  cinema6BurnBurstDamageRatio: number
  potentialAnomalyMasteryBonus: number
  potentialDmgBonus: number
  emberCooldownSeconds: number
  singleCastCount: number
  doubleCastCount: number
  singleSpraySeconds: number
  doubleSpraySeconds: number
  singleCastEnergy: number
  doubleCastEnergy: number
  singleCastTime: number
  doubleCastTime: number
  totalExEnergy: number
  totalExTime: number
  singleSustainedMultiplier: number
  singleExplosionMultiplier: number
  doubleSustainedMultiplier: number
  doubleExplosionMultiplier: number
  note: string
}

/** 柚叶甜度点/狸之愿/硬糖射击·彩糖花火资源明细 */
export interface YuzuhaMechanicSource {
  sweetnessInitial: number
  sweetnessFromChain: number
  /** 影画6：招架成功额外甜度点 */
  sweetnessFromParry: number
  sweetnessTotal: number
  sweetnessCap: number
  /** 整场甜度终身预算（进场+连携入场+影画6招架；存量上限6只钳瞬时持有，不钳终身收入） */
  sweetnessBudget: number
  teamAtkBonus: number
  teamAtkCap: number
  teamDmgBonus: number
  /** 有效战斗时间（秒）= battleTime - invincibleTime，后台追击类次数的時間基数 */
  effectiveSeconds: number
  /** 硬糖射击触发次数 = min(floor(有效时间/CD), 甜度终身预算)；影画2 CD 8→6秒 */
  hardCandyCount: number
  hardCandyCdSeconds: number
  /** 彩糖花火 tick 数 = floor(有效时间)（惊吓满覆盖，1秒/次） */
  fireworkTickCount: number
  /** 彩糖花火·极次数 = 硬糖射击 + 夹心硬糖(≈招架数) 重击触发 */
  fireworkExtremeCount: number
  /** 十人十色转积蓄目标元素（队伍有异常专精队友时为其属性；无则缺省物理不转） */
  transferElement?: string
  note: string
}

/** 南宫羽重拍/颤音/异放资源明细 */
export interface NangongMechanicSource {
  anomalyProficiencyBonus: number
  impactFromMastery: number
  vibratoStacks: number
  vibratoMax: number
  releaseCount: number
  releaseRatios: Record<string, number>
  beatInitial: number
  beatRegen: number
  beatTotal: number
  beatCap: number
  note: string
}

/** 蕾米埃尔虚曜/耀变/异化系数资源明细 */
export interface RemielleMechanicSource {
  voidflareStored: number
  voidflareMax: number
  refringeCoefficient: number
  luminizeMultiplierBonus: number
  note: string
}

/** 琉音好评/抱拳资源明细 */
export interface LiuyinMechanicSource {
  /** 好评初始值 */
  goodReviewInitial: number
  /** 好评每秒回复（接战） */
  goodReviewPerSec: number
  /** 好评每次强特重击回复 */
  goodReviewPerEx: number
  /** 1命好评回复乘算系数（1 或 1.16） */
  goodReviewC1Multiplier: number
  /** 好评总回复量（不含初始） */
  goodReviewGainTotal: number
  /** 好评总量（初始 + 回复） */
  goodReviewTotal: number
  /** 强特重击次数（= exSpecialCount，用于好评回复与专属直伤） */
  exHeavyCount: number
  /** 转大次数（开窗次数 = floor(好评总量/90)，每次满 90 好评可抱拳转大一次；60/90 分配见 promoteFixpoint） */
  promoteWindows: number
  /** 琉音自己的终结技次数（每次终结技送 1 客诉，可打一次不转大的抱拳） */
  ownUltimateCount: number
  /** 抱拳次数（送客长按 1481009 执行次数）= 转大次数 + 终结技次数（等效规则） */
  farewellCount: number
  /** 额外能力是否触发（队伍有强攻或命破队友） */
  extraAbilityActive: boolean
  /** 专属直伤读取的上一位队友槽位（已按设置解析） */
  previousTeammateSlot: number
  /** 命座等级 */
  cinemaLevel: number
  note: string
}

// ============ 招式执行计划 ============

/** 单个招式的执行记录 */
export interface SkillExecution {
  /** 招式 move id */
  moveId: string
  /** 招式名称 */
  moveName: string
  /** 分类: basic/special/dodge/chain/assist */
  category: string
  /** 动作代号/倍率表动作id，用于区分同类多段招式 */
  actionCode?: string
  /** 招式元素（用于异常积蓄池分组；空时从倍率表 damageElement 获取）。
   *  变种异常角色应显式设置为变种ID（如 'physical_polar_assault'）以确保与基础元素分桶互紊。 */
  element?: string
  /** 执行次数 */
  count: number
  /** 单次 actionTime（秒） */
  actionTime: number
  /** 合轴时间占比 0-1（0=不合轴，0.5=合轴一半时间） */
  comboAlignRatio: number
  /** 总时间 = count × actionTime（秒） */
  totalTime: number
  /** 总合轴时间 = count × actionTime × comboAlignRatio */
  totalComboAlignTime: number
  /** 能量消耗（每次，正数表示消耗） */
  energyConsume: number
  /** 总能量消耗 */
  totalEnergyConsume: number
  /** 喧响回复（每次） */
  decibelRecovery: number
  /** 总喧响回复 */
  totalDecibelRecovery: number
  /** 能量回复（每次，部分招式可能回能） */
  energyRecovery: number
  /** 总能量回复 */
  totalEnergyRecovery: number
  /** 伤害倍率（从倍率表 damage 行输出，百分比） */
  damageMultiplier?: number
  /** 失衡倍率（从倍率表 daze 行输出） */
  dazeMultiplier?: number
  /** 异常积蓄（从倍率表 anomaly_buildup 行输出） */
  anomalyBuildUp?: number
  /** 总异常积蓄 = anomalyBuildUp × count（或 × totalTime for basic） */
  totalAnomalyBuildUp?: number
  /** 特殊资源回复（如后续角色专属资源；当前从非标准 recovery 行兜底收集） */
  specialResourceRecovery?: number
  /** 总特殊资源回复 */
  totalSpecialResourceRecovery?: number
  /** 生命回复量（回血量）；部分角色会把血量变化作为资源触发条件 */
  healingAmount?: number
  /** 总生命回复量 */
  totalHealingAmount?: number
  /** 倍率表字段是否已回填 */
  skillTableResolved?: boolean
  /** 倍率表回填说明 */
  skillTableNote?: string
  /** 由机制模块直接覆盖伤害倍率（跳过倍率表回填） */
  damageMultiplierOverride?: boolean
  /** 由机制模块直接覆盖失衡倍率（跳过倍率表回填；如诺姆 C6 破甲弹头失衡值+30%） */
  dazeMultiplierOverride?: boolean
  /** 由机制模块直接覆盖异常积蓄（跳过倍率表回填；如持续段按时长等比缩放后的积蓄） */
  anomalyBuildUpOverride?: boolean
  /** 本行招式专属暴击率加成（%），只加给该行（如青衣1命满电压醉花月云转、柏妮思4命） */
  critRateBonus?: number
  /** 本行招式专属暴击伤害加成（%），只加给该行（如青衣6命醉花月云转暴伤+100%） */
  critDmgBonus?: number
  /** 招式类型定向（如 'exSpecial'），用于技能专属 buff（增伤/暴伤等）匹配 */
  skillDamageTarget?: string
  /** 本行招式专属增伤（%，进增伤区加算，如伊德海莉满蓄碎惘沉击 +30%） */
  dmgBonus?: number
  /** 本行招式专属贯穿增伤（%，进贯穿增伤乘区，如星徽·比利影画6 骑士飞踢/最高马力星光 +18%） */
  sheerDmgBonus?: number
  /** 本行固定附加伤害（基础区：技能倍率后、各乘区前直接相加；如卢西娅[合唱]按最大生命值百分比附加） */
  flatDamageBonus?: number
  /** 本行专属抗性无视（%）（如仪玄影画2：终结技/强化特殊技无视 15% 以太伤害抗性，招式限定） */
  resIgnore?: number
  /** 本行专属防御无视（%）（与面板 enemyDefReduction 同乘区加算；如叶瞬光影画2 飞光/斩妄 40%） */
  defIgnore?: number
  /** 本行专属穿透率加成（%）（叠加面板 penRatio 后进防御乘区乘算；如希格莉德影画2 出枪式/敛枪式 +24%） */
  penRatioBonus?: number
  /** 本行专属失衡值提升（%，与面板 stunBuildUpBonus 同乘区加算；如莱卡恩 C1 有限次强特强化 +12%/+22%） */
  stunBuildUpBonus?: number
  /** 覆盖基底区数值（如专属直伤读贯穿力作为基底，其余乘区仍用本面板） */
  basisValueOverride?: number
  /** 覆盖基底区展示标签 */
  basisLabelOverride?: string
  /** 动作来源：stun=失衡送的连携、gift=队友赠（诺姆连携/琉音转大）、self=自己攒（默认） */
  source?: 'stun' | 'gift' | 'self'
  /** 诺姆膛温换连携标记：本行是帽子把戏赠送的连携（招式取上一位队友技能表），
   *  失衡捏轴下吃易伤的次数由诺姆槽位 'norma-hat-chain' 轴内块决定（见 useResourceCalc） */
  normaGiftChain?: boolean
  /** CD 驱动的后台自动行（如猫又超凶爪印每秒 dot）：轴模式不按捏轴认领、不进轴编辑器放置语义，
   *  改按失衡时间占比拆「占比内吃满易伤 / 其余无易伤」（非轴模式本就按全局覆盖率，不受影响） */
  autoSplitByStun?: boolean
  /** 时间桶：necessary=必做动作（必要池）/ basic=平A池渲染 / backstage=后台活动。
   *  前台判定见 isFrontlineExecution：未打标按前台处理（保守，不漏计）。
   *  Σ前台行时间 ≡ 该角色账本（necessaryTime+basicAttackTime）由折叠循环强制收敛（resource.ts）。 */
  timeBucket?: 'necessary' | 'basic' | 'backstage'
  /**
   * 时间线截断比例（1 = 未截断）：本行按「可用前台」等比缩到 ratio（count 与所有 total* 同比例，
   * 伤害/失衡/积蓄/回能随之线性缩）。见 truncateExecutionsToFrontline。
   */
  truncatedRatio?: number
}

/** 行是否占用三人共享前台时间轴（后台行不进超时校验与账本折叠；未打标默认前台） */
export function isFrontlineExecution(e: { timeBucket?: 'necessary' | 'basic' | 'backstage' }): boolean {
  return e.timeBucket !== 'backstage'
}

/** 异常事件执行记录：不属于普通直伤/失衡/积蓄招式行，但会由动作或资源触发 */
export interface AnomalyEventExecution {
  /** 事件 id */
  eventId: string
  /** 事件名称 */
  eventName: string
  /** 事件类型 */
  eventType: 'special_voidflare' | 'luminize' | 'release' | 'polar_disorder' | 'polar_assault' | 'direct_damage' | 'other'
  /** 异放/释放事件使用的基础元素；缺省时由伤害池按现有逻辑推断 */
  element?: string
  /** 绑定的载体动作 move id */
  carrierMoveId?: string
  /** 绑定的载体动作名称 */
  carrierMoveName?: string
  /** 事件次数 */
  count: number
  /** 本事件当前读取的公式 */
  formula: string
  /** 本事件当前读取的字段 */
  fields: string[]
  /** 说明 */
  note?: string
  /**
   * 直伤事件（eventType='direct_damage'）的倍率（% 攻击力）。
   * 伤害池据此把事件转成直伤行；缺省 = 未接线（如 spec 事件走专用结算块，不进此通用路径）。
   */
  damageMultiplier?: number
  /**
   * 比例型异放（eventType='release' 且非固定 releaseMultiplier）。
   * 倍率 = 原异常单次/单跳倍率(element) × (触发者[basis]/10 × perTenByElement[element]%) × 失衡加成。
   * basis 取触发者面板的异常掌控或异常精通；basis='anomalyDamageRatio' 时倍率直接 =
   * 原异常单次倍率 × perTenByElement[element]%（「相对于原属性异常伤害的比例」句式，南宫羽颤音异放）；
   * stunBonusPct 为失衡时比例额外提升（%）。
   */
  releaseRatio?: {
    basis: 'anomalyMastery' | 'anomalyProficiency' | 'anomalyDamageRatio'
    /** 每 10 点 basis → 的百分比（key = element，如 { ether: 27.5, wind: 1.4 }） */
    perTenByElement: Record<string, number>
    /** 目标失衡时，该比例额外提升 N%（如 50 = ×1.5） */
    stunBonusPct?: number
  }
  /**
   * 异放专属暴击（eventType='release' 的异常暴击，仅作用于异放结算）。
   * 爱芮影画1：基础暴击率 ratePct、暴伤 dmgPct；异常掌控超过 masteryThreshold 后
   * 每点额外 +masteryPerPointRatePct 暴击率。
   */
  releaseCrit?: {
    /** 基础暴击率（%） */
    ratePct: number
    /** 暴击伤害（%） */
    dmgPct: number
    /** 掌控阈值（超过后每点额外加暴击率） */
    masteryThreshold?: number
    /** 掌控超过阈值后，每点额外 +的暴击率（%） */
    masteryPerPointRatePct?: number
  }
  /**
   * 极性紊乱倍率（eventType='polar_disorder'）：本次极性紊乱 = 原本[紊乱]效果 × 该倍率。
   * 缺省 0.25（南宫羽口径）；月城柳 = 0.15（C0）/ 0.20（C2，每额外突刺 +0.15，上限 2 次）。
   */
  polarDisorderRatio?: number
  /**
   * 次数全部发生在失衡窗口内（轴模式标记，如南宫羽颤音异放=进窗清除结算、次数=失衡数×覆盖）。
   * 结算区据此把全部次数记为「失衡内」（全额失衡易伤），不做轴内/轴外拆分；
   * 未标记的 release 事件按「事件计数器」拆分：元素失衡内触发占比 = 时间线触发数 / 全局池触发数。
   */
  inStunBound?: boolean
  /**
   * 异放跟随载体招式（前台招式）的失衡内外：失衡内占比 = 载体块的轴内单位 / 载体总次数
   * （不是占比期望，而是玩家捏轴能精确控制的绑定）。载体 moveId 由 carrierMoveId 指定。
   * 结算区据此把 release 拆「失衡内(stunned=1)/轴外(stunned=0)」两段，总次数守恒。
   * 载体总次数 = 执行行 count → carrierTotalCount → 事件次数（兜底，见 damagePool）。
   */
  followCarrierInStun?: boolean
  /**
   * 载体动作总次数（模块显式提供时优先于执行行/事件次数兜底）：
   * 事件次数与载体次数不成 1:1 时用（如薇薇安落羽生花异放 = 落羽生花次数 × 命中异常占比，
   * 事件次数已被占比稀释，轴内占比的分母必须用落羽生花次数本身）。
   */
  carrierTotalCount?: number
}

/** 失衡内异常状态摘要（失衡内异常系统 v2，轴模式）：每元素触发次数与窗均覆盖 */
export interface InStunAnomalyElementState {
  element: string
  triggerCount: number
  avgCoverage: number
}

export interface InStunAnomalySummary {
  windows: number
  elements: InStunAnomalyElementState[]
  /** 展开后的每个窗口属于哪条轴条目（索引对齐窗口序）——捏轴页按条目标注触发事件用 */
  windowEntryIdx?: number[]
  /** 触发来源明细（动作带 moveId 时回填，id=抑制引用键）：捏轴页块级「这个招式触发了什么」可视化用 */
  triggerSources?: Array<{ windowIndex: number; moveId: string; element: string; offsetSeconds: number; id: string; srcIndex?: number }>
  note: string
}

/** 通用专属资源展示段，由角色机制模块生成 */
export interface SpecialResourceSection {
  /** 展示段 id */
  id: string
  /** 标题，如“维琳娜风华” */
  title: string
  /** 总览文本，如“剩余 12 / 风蚀 1” */
  summary: string
  /** 明细行 */
  rows: {
    label: string
    value: string
    detail?: string
  }[]
  /** 底部说明 */
  footer?: string
}

/** 机制模块声明的可调参数，例如期望利用率 */
export interface MechanicSetting {
  /** 全局唯一设置 id，如 velina.cinema2CorrosionRate */
  id: string
  /** 展示标题 */
  label: string
  /** 说明文本 */
  description: string
  /** 默认值 */
  default: number
  min?: number
  max?: number
  step?: number
  suffix?: string
}

// ============ 角色资源汇总 ============

/** 伊德海莉蓄力循环招式（buildCharConfig 从倍率表提取，buildExecutions 消费） */
export interface YidhariLoopMove {
  id: string
  damage: number
  daze: number
  anomaly: number
  actionTime: number
  decibel: number
  flash: number
}

/** 伊德海莉生命值烧血/回血/喧响明细 */
export interface YidhariHpSource {
  /** 能量/闪能决定的强化特殊技总次数（极寒重碾） */
  exSpecialCount: number
  /** 强化特殊技单次闪能消耗 */
  exSpecialEnergyCost: number
  /** 失衡内（追碾）极寒重碾次数 = 每次失衡次数 × 失衡次数 */
  inStunExCount: number
  /** 非失衡（溯寒后）极寒重碾次数 = 总次数 − 失衡内，每次回 15 闪能 */
  outStunExCount: number
  /** 每次失衡的极寒重碾次数（0命2 / 1命3，可调） */
  exPerStun: number
  /** 蓄力循环次数（蓄力1s→霜寒拥覆#3→碎惘沉击#4） */
  chargeCycles: number
  /** 蓄力总时长（秒，烧血时间） */
  chargedAttackSeconds: number
  /** 每秒消耗生命值百分比（近似） */
  hpBurnPctPerSecond: number
  /** 总烧血百分比 */
  hpBurnPct: number
  /** 强化特殊技回血：已损失生命值 × 33% × 次数（近似） */
  hpHealPct: number
  /** 强化特殊技释放时已损失生命值比例（0-1，默认 0.75 最优） */
  exHealMissingHpPct: number
  /** 每降低 1% 生命值获得的喧响 */
  decibelPerHpPct: number
  /** 烧血换算出的总喧响 */
  burnDecibel: number
  note: string
}

/** 诺姆预热膛温/嗯呢弹幕/技术鸿沟资源明细 */
export interface NormaMechanicSource {
  heatInitial: number
  heatFromFrontline: number
  heatFromExSpecial: number
  /** 长按延长射击额外膛温（长按能量 20/s × 0.4%）；完整模型：膛温 = 消耗能量 × 0.4% */
  heatFromHold: number
  heatFromUltimate: number
  heatTotal: number
  /** 影画2·帽子把戏回能触发次数（floor(战斗时间/20)，默认180s→9次） */
  c2EnergyTriggers: number
  /** 影画2·帽子把戏回能总量（次数 × 25） */
  c2EnergyTotal: number
  /** 膛温≥80%帽子把戏→连携技替换次数 = floor(膛温总量/80) */
  hatToChainCount: number
  hatToChainCost: number
  /** 嗯呢弹幕覆盖秒数（每次 32 秒） */
  barrageSeconds: number
  /** 嗯呢弹幕覆盖率（0-1，默认满覆盖可调） */
  barrageCoverage: number
  /** 嗯呢弹幕期间全队增伤（+20% × 覆盖率，额外能力触发时） */
  barrageTeamDmgBonus: number
  /** 炮塔总座数（每次弹幕 2 座） */
  towerCount: number
  /** 炮塔普通自动射击次数（弹幕覆盖秒数 / 3s，打靶练习 1571013） */
  towerAutoShotCount: number
  /** 火力实验导弹舱次数 = 失衡次数 + 膛温换连携次数 */
  missileBayCount: number
  /** 导弹舱强化自动射击总发数（每舱 8s/2s=4 发，C1 12s/2s=6 发） */
  boostedShotTotal: number
  /** 火力实验强化期失衡内秒数（打高爆弹） */
  highExplosiveSeconds: number
  /** 火力实验强化期超出失衡的秒数（打失衡高的破甲弹） */
  armorPierceSeconds: number
  /** 破甲弹头发数（未失衡，1571014） */
  armorPierceCount: number
  /** 高爆弹头发数（失衡，1571015） */
  highExplosiveCount: number
  /** C6 导弹轰击触发次数（min(失衡次数, floor(180/30))） */
  c6BurstCount: number
  /** C6 导弹总发数 = 触发次数 × 8 发 */
  c6MissileCount: number
  /** 额外能力是否触发 */
  additionalAbilityActive: boolean
  /** 技术鸿沟失衡易伤（+3%/层×10层，额外能力触发时） */
  techGapStunBonus: number
  /** 额外能力攻击提升（44~870，随等级） */
  extraAbilityAtkBonus: number
  cinemaLevel: number
  note: string
}

/** 青衣闪络电压/醉花月云转资源明细 */
export interface QingyiMechanicSource {
  /** 失衡次数（外层不动点传入） */
  stunCount: number
  /** 醉花月云转轮数 = 2 × 失衡次数 */
  rounds: number
  /** 总电压需求 = 200 × 失衡次数（点） */
  totalVoltageNeeded: number
  /** 1命开局赠送电压 */
  c1StartVoltage: number
  /** 通用招式（强特/大招/连携/闪反/快支/支援突击）电压合计 */
  genericVoltage: number
  /** 剩余需由一煞整套弦（#4+#5+#6 ≈ 14.26 电压/2.96s）补齐的电压 */
  remainingVoltage: number
  /** 一煞整套弦补电压套数（每套 = #4/#5/#6 各一段） */
  yisha4Hits: number
  /** 一煞整套弦补电压所需时间（秒） */
  yisha4NecessaryTime: number
  /** 醉花月云转总时间（秒） */
  zuiHuaTime: number
  /** 必要时间合计 = 一煞#4 补电压 + 醉花月云转 */
  necessaryTime: number
  note: string
}

/** 卢西娅·艾洛温梦境值/追加攻击/回血资源明细（用户确认口径） */
export interface LuciaMechanicSource {
  /** 全局目标梦境值（默认 500） */
  dreamTarget: number
  /** 计划内强特次数（占用前台时间） */
  dreamExSpecialCount: number
  /** 计划外强特次数（合轴 0 秒） */
  excessExSpecialCount: number
  /** A5 次数（开局场地外 1 次 + 战斗中 E 后接） */
  a5Count: number
  /** 终结技次数 */
  ultimateCount: number
  /** 梦境值总计 = 60 + A5×40 + E×60 + Q×100 */
  dreamTotal: number
  /** 追加攻击次数 = min(设置上限, floor(dreamTotal/25)) */
  additionalAttackCount: number
  /** 追加攻击消耗梦境值 */
  additionalAttackDreamCost: number
  /** 每次终结技回血量（%卢西娅最大生命）= 8s × (1% + 0.05%×终结技等级)/秒，12级=12.8% */
  healPctPerUlt: number
  /** 队友回血总量 = 终结技次数 × healPctPerUlt × 覆盖滑块（% 卢西娅最大生命） */
  healTotalHpPct: number
  /** 4命帷幕触发次数（开启/延长，含队友如伊德海莉大招开帷幕；15s CD 封顶 × 利用率滑块） */
  curtainTriggerCount: number
  /** 4命每次触发给全队每人的喧响（100；未开4命为 0） */
  c4DecibelPerTrigger: number
  /** 4命全队每人喧响合计 = curtainTriggerCount × c4DecibelPerTrigger */
  c4TeamDecibelPerChar: number
  note: string
}

/** 般岳·艾洛温嗔火/怒相循环明细（用户确认口径） */
export interface BanyueRageCycle {
  /** 怒相次数 = floor(嗔火总量 / 120) */
  rageCount: number
  /** 嗔火总量 = 115(开局) + (闪反+招架+金身)×4 + 怒相外闪能消耗×0.5 */
  furyTotal: number
  /** 怒相外连段总数（论道连段 + 地动山摇连段，闪能支付 60/组，自动 = floor(剩余闪能/60)） */
  comboOutCount: number
  /** 怒相外「地动→山摇·怒」连段组数（滑块分配，默认 0 = 全打论道连段） */
  diDongComboCount: number
  /** 失衡轴内捏的普通强特消耗的总闪能（默认 0，轴模式由捏轴反馈；连段块免费不计） */
  axisExSpend: number
  /** 失衡轴内捏的连段块总数（免费·山威 = 怒相内连段的轴内表达，不影响怒相外自动连段） */
  axisComboCount: number
  /** 双反次数（完美闪避+金身弹刀组合，+10嗔火/次，产冲霄） */
  dualCounterCount: number
  /** 怒相内「地动→山摇·怒」连段组数（轴内捏的 banyue-combo-didong 块决定，默认 0 = 怒相内全打论道连段） */
  rageDiDongComboCount: number
  /** 怒相内论道次数（山威免费，= (2×怒相次数 − rageDiDongComboCount)） */
  lunDaoRageCount: number
  /** 怒相内狮子吼·怒次数（山威免费，论道派生连段，= lunDaoRageCount） */
  shiZiHouNuCount: number
  /** 怒相内地动次数（山威免费，地动山摇连段 = rageDiDongComboCount） */
  diDongRageCount: number
  /** 怒相内山摇·怒次数（山威免费，地动派生连段 = rageDiDongComboCount） */
  shanYaoNuRageCount: number
  /** 怒相外论道连段的论道次数（= comboOutCount − diDongComboCount） */
  lunDaoOutCount: number
  /** 怒相外论道连段的狮子吼·怒次数（= comboOutCount − diDongComboCount） */
  shiZiHouNuOutCount: number
  /** 怒相外地动山摇连段的地动次数（= diDongComboCount） */
  diDongOutCount: number
  /** 怒相外地动山摇连段的山摇·怒次数（= diDongComboCount） */
  shanYaoNuOutCount: number
  /** 怒相内山摇次数（剩余山威，固定 0） */
  shanYaoRageCount: number
  /** 闪能总收入（秒回+进场+山威回能） */
  flashIncome: number
  /** 闪能总支出（怒相外连段+轴内普通强特） */
  flashSpent: number
  /** 山威免费强特总数 = 怒相次数 × 4 */
  swayExCount: number
  /** 嘲讽取消次数（钳制到失衡外连段总数） */
  tauntCancelCount: number
  /** 失衡外连段组数（轴模式 = 全部连段 − 轴内捏块；非轴模式 = 怒相外自动连段，怒相内默认失衡内全取消） */
  outStunComboCount: number
  /** 失衡轴内捏的连段块总数（banyue-combo + banyue-combo-didong，×窗口数；非轴模式 0） */
  axisInComboCount: number
  /** 失衡外连段末尾强特后摇次数（= outStunComboCount − 嘲讽取消；失衡内连段被连携/大招/瞬拳取消后摇，不计） */
  comboOutRecoveryCount: number
  /** 后摇按两类连段占比拆分：论道连段剩余后摇次数（末尾 = 狮子吼·怒） */
  lunDaoRecoveryCount: number
  /** 后摇按两类连段占比拆分：地动山摇连段剩余后摇次数（末尾 = 山摇·怒） */
  diDongRecoveryCount: number
}

/** 星徽·比利主循环/EX 链明细（用户确认口径） */
export interface YixuanExChain {
  /** 强特招式总次数（展示用） */
  cycles: number
  /** 墨痕化形链次数（2连+3连） */
  inkCycles: number
  /** 凝云术链总次数（轴内+轴外） */
  cloudCycles: number
  /** 墨痕化形 #1 次数（40闪能） */
  ink1: number
  /** 墨痕化形 #2 次数（完美格挡赠送，免费） */
  ink2: number
  /** 墨痕化形 #3 次数（免费） */
  ink3: number
  /** 墨痕化形 #4 次数（20闪能） */
  ink4: number
  /** 墨烬影消次数（20闪能，凝云术前置） */
  ashen: number
  /** 凝云术次数 */
  cloud: number
  /** 凝云术蓄力秒数（0-2；轴内按轴时长，轴外满蓄） */
  cloudChargeSeconds: number
  /** 总耗闪能（术法值 = 该值 × 0.667） */
  flashSpent: number
  /** 强特链总前台时间（秒） */
  chainSeconds: number
  /** 轴内凝云次数（扩展字段，Record 读取） */
  axisCloud?: number
  /** 轴外凝云次数（扩展字段） */
  cloudOut?: number
  /** 轴内凝云蓄力秒数（扩展字段） */
  axisCloudSeconds?: number
  /** 2连墨痕化形次数（扩展字段） */
  ink2Count?: number
  /** 3连墨痕化形次数（扩展字段） */
  ink3Count?: number
  /** 完美格挡次数（扩展字段） */
  perfectBlockCount?: number
}

export interface BillyChain {
  /** 付费单位总数 = floor(闪能总量 / 60)（闪能只支付 摇曳/抓地；动力压制与孤轮 0 闪能） */
  paidEx: number
  /** 摇曳步伐链数（动力压制+孤轮+摇曳，120 闪能/条；轴模式 = 轴内捏的数量） */
  rocking: number
  /** 抓地轮毂总次数（60 闪能/次；轴模式 = 轴内 + 轴外剩余闪能） */
  traction: number
  /** 轴外抓地轮毂次数（轴模式 = max(0, 付费单位 − 轴内付费)，非轴模式 = traction） */
  tractionOut: number
  /** 动力压制链总数 = 动力压制次数 = 孤轮特技次数（0 闪能免费衔接，只受 HP 池约束） */
  chain: number
  /** 银河横行次数（动力压制期间漂移→尾焰全旋→衔接孤轮特技；= min(闪反次数, 动力压制数)，轴外） */
  galaxy: number
  /** 最高马力星光次数 = floor(决意总量 / 100) */
  fullThrottle: number
  /** 是否失衡轴模式（轴内动作按捏轴执行） */
  axisMode: boolean
  /** HP 池：动力压制总消耗 %生命上限（由 buildExecutions 填充） */
  hpCostPct?: number
  /** HP 池：回血总量 %生命上限（抓地30/摇曳15/普攻 attack_data_1） */
  healPct?: number
  /** HP 池：战斗结束剩余生命 %（100 − 消耗 + 回血，0-100 截断） */
  hpFloorPct?: number
  /** HP 池：经普攻第四段衔接（耗血减半）的动力压制占比（滑块 1531.driveSuppressionHpDiscountRatio） */
  hpDiscountRatio?: number
}

/** 单个角色的资源池计算结果 */
export interface CharacterResourceResult {
  /** 槽位 0/1/2 */
  slot: number
  /** 角色 ID */
  agentId: string
  /** 角色名称 */
  agentName: string
  /** 是否命破角色（使用闪能而非能量） */
  isFlashUser: boolean

  // --- 时间 ---
  timeAllocation: TimeAllocation

  // --- 能量 ---
  energySource: EnergySource
  /**
   * 真正驱动 exSpecialCount 的收敛后总能量（= 收敛末轮 iterate 的 totalEnergy）。
   *
   * 与 `energySource.total` 应当一致：iterate 与最终装配用同一函数、同一入参（连携次数
   * 同口径）。历史版本 iterate 内 calcEnergySource 以 chainCountTotal=0 调用，时光切片
   * 连携触发的回能只进展示明细、不参与次数推导，二者存在固定差值——已修复对齐。
   * 保留双字段的目的：让口径分裂可被测试/界面观测（差值 ≠ 0 即回归信号）。
   */
  derivedEnergy: number
  /** 可用强特次数 = 总能量 ÷ 强特消耗 */
  exSpecialCount: number
  /** 强特 move id */
  exSpecialMoveId: string
  /** 强特单次能量消耗 */
  exSpecialEnergyConsume: number

  // --- 喧响 ---
  decibelSource: DecibelSource
  /** 终结技消耗（默认3000，部分角色2000） */
  ultimateCost: number
  /** 可用终结技次数 = 总喧响 ÷ 终结技消耗 */
  ultimateCount: number

  // --- 专属资源 ---
  /** 维琳娜风华资源明细 */
  velinaFloriaSource?: VelinaFloriaSource
  /** 爱丽丝剑意资源明细 */
  aliceSwordWillSource?: AliceSwordWillSource
  /** 洛克茜风能/风眼资源明细 */
  roxyWindEnergySource?: RoxyWindEnergySource
  /** 克拉蕾残痕/锐能资源明细 */
  claretSharpResourceSource?: ClaretSharpResourceSource
  /** 简机制资源明细 */
  janeMechanicSource?: JaneMechanicSource
  /** 雅落霜资源明细 */
  miyabiFrostFallSource?: MiyabiFrostFallSource
  /** 柏妮思机制资源明细 */
  burniceMechanicSource?: BurniceMechanicSource
  /** 柚叶机制资源明细 */
  yuzuhaMechanicSource?: YuzuhaMechanicSource
  /** 南宫羽机制资源明细 */
  nangongMechanicSource?: NangongMechanicSource
  /** 蕾米埃尔机制资源明细 */
  remielleMechanicSource?: RemielleMechanicSource
  /** 琉音机制资源明细 */
  liuyinMechanicSource?: LiuyinMechanicSource
  /** 伊德海莉烧血/回血/喧响明细 */
  yidhariHpSource?: YidhariHpSource
  /** 诺姆预热膛温/嗯呢弹幕/技术鸿沟明细 */
  normaMechanicSource?: NormaMechanicSource
  /** 青衣闪络电压/醉花月云转明细 */
  qingyiMechanicSource?: QingyiMechanicSource
  /** 卢西娅梦境值/追加攻击/回血明细 */
  luciaMechanicSource?: LuciaMechanicSource
  /** 般岳嗔火/怒相循环明细 */
  banyueRageCycle?: BanyueRageCycle
  /** 般岳轴模式自动补齐的交互次数（保底语义：在交互栏输入之上补多少） */
  banyueInteractionTopUp?: { parry: number; dual: number }
  /** 星徽·比利 EX 链明细 */
  billyChain?: BillyChain
  /** 仪玄强特链明细（墨痕化形链/凝云术链） */
  yixuanExChain?: YixuanExChain
  /** 通用专属资源展示段（由角色机制模块提供） */
  specialResources?: SpecialResourceSection[]
  /** 閫氱敤 spec 璧勬簮璁＄畻缁撴灉锛?key = spec resource.id */
  specResources?: Record<string, any>

  // --- 连携 ---
  /** 每次失衡的连携次数（用户可调） */
  chainCountPerStun: number
  /** 总连携次数 = 每次失衡连携次数 × 失衡次数 */
  chainCountTotal: number

  // --- 招式执行计划 ---
  executions: SkillExecution[]
  /** 异常事件执行计划：特殊虚耀/异放/极性紊乱等事件单独展示 */
  anomalyEventExecutions: AnomalyEventExecution[]

  // --- 失衡（该角色造成的总失衡值，后续模块用） ---
  totalStunBuildUp: number
}

// ============ 队伍资源汇总 ============

/**
 * 收敛诊断（一次计算里三层不动点各自的落地情况）。
 *
 * 背景：本引擎有三层嵌套不动点——
 *   ① `iterate` 内层（能量→强特→喧响→终结→时间，判据 = 强特/终结次数整数相等）
 *   ② `calcTeamResources` 时间预算外层（Σ执行行前台时间 ≤ 战斗时间，只折正 excess）
 *   ③ `useResourceCalc.runCalcRound` 失衡外层（失衡次数 ↔ 资源池 ↔ 转大 ↔ 异常喧响奖励）
 * 但原先只有 ① 上报 `converged`，② 与 ③ 耗尽迭代上限时**静默接受末轮结果**：既无告警也无残差，
 * 测试也断言不到 —— 建模错误（例如某模块 estimateExSpecialTime 系统性高估）会被悄悄吞掉。
 * 本结构把三层的收敛状态与残差一起抬到结果对象上，让「没收敛」变成可观测、可断言的事实。
 */
export interface ConvergenceReport {
  /** 时间预算外层：是否在上限内收敛（Σ执行行前台时间 ≤ 战斗时间） */
  timeBudgetConverged: boolean
  /** 时间预算外层实际跑的轮数 */
  timeBudgetPasses: number
  /** 退出时仍未消化的最大正溢出（秒）；0 = 完全收敛 */
  timeBudgetResidualSeconds: number
  /**
   * 退出时的最大「负溢出」（秒）：执行行前台时间比战斗时间**少**的量。
   * 按设计不折回（折回会让 necessaryTime 变负、平A池膨胀），但持续偏大意味着
   * `estimateExSpecialTime` 系统性高估必要时间 —— 单侧钳制会掩盖这类建模错误，故单独上报。
   */
  timeBudgetIdleSeconds: number
  /**
   * 欠打回填总量（秒，团队级）：账本高估挤占的平A池经 timeBudgetRefund 回填的量。
   * 0 = 账本与物化行自洽；偏大 = 某模块 estimate 高估（同 timeBudgetIdleSeconds 的诊断语义）。
   */
  timeBudgetRefundedSeconds?: number
  /**
   * 时间线截断总量（秒）：装配阶段按「本槽可用前台」砍掉的执行行时间（含被等比缩的边界行）。
   * >0 = 资源允许的动作量装不进战斗时间，多余资源没兑现成动作（实战 180s 结算口径）。
   * 与 overflowSeconds 同值口径，单独上报便于与"账本超预算"区分。
   */
  timeTruncatedSeconds?: number
  /**
   * 失衡外层不动点（runCalcRound 环）是否真收敛。
   * 由编排层回填；`calcTeamResources` 单独调用时保持 false（它看不到外层）。
   */
  outerConverged?: boolean
  /** 失衡外层实际跑的轮数 */
  outerRounds?: number
  /**
   * 失衡外层的退出方式：
   * - `stable`：反馈量全稳定（真收敛）；
   * - `cycle`：检测到离散 2-循环（如失衡次数 5→4→5）后主动停 —— 离散场景的正确兜底，不是失败，
   *   但结果取的是循环中的一支，需与真收敛区分；
   * - `maxIter`：耗尽迭代上限（**可疑**：反馈量仍在变，结果可能停在错误值）。
   */
  outerExit?: 'stable' | 'cycle' | 'maxIter'
  /**
   * 轴退化（用户口径 2026-08）：轴的资源需求（轴内块/自动补齐交互 × 窗口数）超出战斗时间预算
   * → 收敛后 Σ物化前台行仍 > 战斗时间 → 该轴不可操作（需 boss 秽盾等外界环境才打得成）
   * → 编排层自动弃用轴注入（退化为一般轴）重算。true = 本结果是无轴的一般循环，
   * 轴定义仍可从 UI 查看；false/undefined = 未触发退化（含本来就无轴）。
   */
  axisFallback?: boolean
  /**
   * 非轴降配（用户口径 2026-08-30）：无轴态前台净占用仍超预算时，用户交互次数
   * （招架/金身/双反/闪反）按该比例缩放（round）直到回到预算内；boss 强制弹刀不缩放。
   * undefined = 未降配；0 = 交互全砍仍超（如实保留超时结果）。与 axisFallback 可同时为 true
   * （轴退化后配置本身仍超预算）。
   */
  interactionScale?: number
}

/** 队伍资源池计算结果 */
export interface TeamResourceResult {
  /** 总时间（秒，默认180） */
  totalTime: number
  /** 失衡次数 = 总失衡值 ÷ boss失衡值 */
  stunCount: number
  /** 3个角色的资源结果 */
  characters: CharacterResourceResult[]
  /** 迭代次数（内层 iterate） */
  iterations: number
  /** 是否达到收敛（内层 iterate：强特/终结次数稳定） */
  converged: boolean
  /** 三层不动点的收敛诊断（见 ConvergenceReport） */
  convergence: ConvergenceReport
  /**
   * 轴内合轴节省（秒，团队级）：失衡窗口内跨角色块并行（如般岳强特时琉音抱拳）只计一次前台，
   * 节省 = 轴内块时长和 − 块区间并集（栈引擎 overlapSeconds）。**前台净占用口径**：
   * Σ物化前台行 totalTime − 本值 = 时间轴净占用（iterate 平A池吃进、折叠循环/队伍对比超时判定按净占用）。
   * 非轴模式 / 无并行块 = 0。
   */
  axisOverlapSeconds?: number
  /** 合轴节省按块分摊（`${slot}:${moveId}` → 秒）：单角色行级扣减用，Σ 值 = axisOverlapSeconds */
  axisOverlapByAction?: Record<string, number>
  /**
   * 时间线溢出＝**被截断掉的秒数**（合轴抵扣后，轴模式抵扣与栈引擎节省取 max）：资源允许的
   * 动作量超出「战斗时间 − 无敌」的部分。装配阶段按可用前台截断执行计划（实战 180s 直接结算，
   * 不管这一轮/这套连段打没打完 ⇒ 截断后净占用恒 ≤ 预算，见 truncateExecutionsToFrontline），
   * 本字段就是"为了塞进 180s 砍掉了多少"。已并入 TeamComparePage 操作难度横轴
   * （1 秒 = 1 难度点，用户口径 2026-09-04；截断口径 2026-09-05）。
   */
  overflowSeconds?: number
}

// ============ 计算输入 ============

/** 单个招式/事件的资源利用率覆盖 */
export interface ResourceUtilizationRule {
  /** 释放率，0-1；用于把资源池上限折算成实际释放次数 */
  rate: number
  /** 次数上限；null/undefined 表示不封顶 */
  cap?: number | null
}

/** 单个角色的操作配置 */
/**
 * 强特成本类型（findExSpecial 2026-09 按键语义分类，替代原「一切非空键都当能量」的窄口径）：
 * - energy：能量/闪能键（键名含 energy）→ 按能量预算计费
 * - resource：替代资源（如克拉蕾 "Sharpness Cost"（锐能））→ 引擎不扣能量，次数由模块资源账本给出
 * - free：无成本键 → 免能（如千夏特别拍照技巧）
 */
export type ExSpecialCostType = 'energy' | 'resource' | 'free'

/** 额外强特行（buildCharConfig 预存、buildExecutions 发行；注册表 src/data/exSpecialPlans.ts） */
export interface ExtraExPlanRow {
  moveId: string
  label: string
  count: {
    /** 每 N 秒窗口 1 次（×maxPerWindow 封顶） */
    windowSeconds: number
    /** 每窗口次数上限（默认 1） */
    maxPerWindow?: number
    /** 不超过主强特次数（千夏：每次强特授予 40s [天使协律]，每次进入限 1 次拍照） */
    capByExCount?: boolean
  }
  /** 每发能量成本（0 = 免费/替代资源强特，由模块账本记） */
  energyCost: number
  /** 单次动作时长（秒） */
  actionTime: number
  /** 单次喧响回复（倍率表行） */
  decibelRecovery: number
  note: string
}

export interface CharacterOperationConfig {
  /** 槽位 */
  slot: number
  /** 角色 ID */
  agentId: string
  /** 是否命破角色 */
  isFlashUser: boolean
  /** 面板（来自 panel.ts 的计算结果） */
  panel: PanelValues
  /** 平A秒均回能（能量/闪能，预计算值） */
  basicAttackRegenPerSec: number
  /** 平A秒均喧响（预计算值） */
  basicAttackDecibelPerSec: number
  /** 蕾米一/四命特殊虚耀跟随的「普通攻击：垂虹」move id */
  remielleRainbowEndMoveId: string
  /** 蕾米「普通攻击：垂虹」actionTime */
  remielleRainbowEndActionTime: number
  /** 蕾米「普通攻击：垂虹」喧响回复 */
  remielleRainbowEndDecibelRecovery: number
  /** 蕾米「普通攻击：垂虹」合轴率 0-1 */
  remielleRainbowEndComboAlignRatio: number
  /** 蕾米后台飞行状态每5秒自动释放一次 Radiant Turn */
  remielleEnabled?: boolean
  /** 蕾米后台 Radiant Turn move id */
  remielleRadiantTurnMoveId?: string
  /** 蕾米后台 Radiant Turn actionTime */
  remielleRadiantTurnActionTime?: number
  /** 蕾米后台 Radiant Turn 喧响回复 */
  remielleRadiantTurnDecibelRecovery?: number
  /** 蕾米额外能力：Luminous Reflection 状态失衡提升（6/12/35） */
  remielleRadiantTurnDazeBonusPct?: number
  /** 强特 move id */
  exSpecialMoveId: string
  /** 强特单次能量消耗 */
  promiaNiyingCount?: number  // 普罗米娅·处刑式·匿影次数（交互栏填写；+10寒蚀/次并解锁重霜）
  /** 免费强特次数（不耗能量，照常计时/喧响/伤害；如南宫羽天使队长「每次失衡白送一次E」）。
   *  由机制模块经 applyTeamConfig converge 写入；resolveExSpecialCount 在付费次数外累加，
   *  通用执行行只对付费部分扣能量 */
  freeExSpecialCount?: number
  /** x弹刀时间豁免次数（用户口径 2026-09-02：两人同时招架同一攻击，前台时间只计一份）——
   *  本槽位的这 N 次轻弹刀/支援突击行 totalTime 记 0（喧响/失衡/伤害照计），
   *  由 useResourceCalc 按 boss defaults.xParryTotal 注入（非主弹窗位）。 */
  parryTimeFreeCount?: number
  /** 强特成本类型（catalog energyCost 键语义分类；见 ExSpecialCostType 注释） */
  exSpecialCostType?: ExSpecialCostType
  /** 强特成本数值（energy 型 = 每发能量；resource 型 = 每发资源点；free 型 = 0） */
  exSpecialCostAmount?: number
  /** 替代资源标识（如 'sharpness'；energy/free 型为空） */
  exSpecialResourceId?: string
  /** 替代资源型强特的应付次数：模块资源账本本轮 assembly 写入、下一轮 resolveExSpecialCount 读（不动点收敛，同般岳套路） */
  exSpecialResourcePaidCount?: number
  /** 额外强特行（免费/窗口门控的次要强特），注册表 src/data/exSpecialPlans.ts 预存于 buildCharConfig */
  extraExPlans?: ExtraExPlanRow[]
  /** 失衡内异常系统 v2：上一轮时间线统计的每窗轴内异常触发次数（南宫羽颤音自动层数用） */
  inStunWindowTriggers?: number
  exSpecialEnergyConsume: number
  /** 强特 actionTime */
  exSpecialActionTime: number
  /** 强特单次喧响回复 */
  exSpecialDecibelRecovery: number
  /** 终结技 move id */
  ultimateMoveId: string
  /** 终结技消耗喧响（全游戏统一3000，仅1个角色2000暂不纳入） */
  ultimateCost: number
  /** 终结技 actionTime */
  ultimateActionTime: number
  /** 终结技单次喧响回复（恒为0：花3000喧响释放动作id，数据行无decibel_recovery） */
  ultimateDecibelRecovery: number
  /** 连携技 move id */
  chainMoveId: string
  /** 连携技 actionTime */
  chainActionTime: number
  /** 连携技单次喧响回复 */
  chainDecibelRecovery: number
  /** 连携技合轴率 0-1 */
  chainComboAlignRatio: number
  /** 每次失衡的连携次数（用户可调，默认非辅助1次辅助0次） */
  chainCountPerStun: number
  /** 连携总次数覆盖（失衡轴模式：按各轴分配的窗口数加权求和后的最终次数，缺省走 chainCountPerStun × 失衡次数） */
  chainCountTotalOverride?: number
  /** 强制连携追加次数（队伍级联动写入，如柚叶影画2：重击命中非失衡敌强制触发连携，20s CD） */
  chainCountTotalExtra?: number
  /** 强特合轴率 0-1 */
  exSpecialComboAlignRatio: number
  /** 终结技合轴率 0-1 */
  ultimateComboAlignRatio: number
  /** 弹刀次数（per-character；正常弹刀 = 轻弹刀 + 支援突击 + 喧响 215） */
  parryCount: number
  /** 不带支援突击的弹刀次数（per-character；只有轻弹刀倍率行 + 喧响 215，无支援突击行；boss 机制强制，非用户可调） */
  parryNoFollowUpCount: number
  /** 只给喧响的弹刀次数（per-character；轻弹刀打小怪无 daze 无支援突击，只有喧响 215；boss 机制强制，非用户可调） */
  parryDecibelOnlyCount: number
  /** 闪避反击次数（per-character） */
  dodgeCounterCount: number
  /** 快速支援次数（per-character） */
  quickAssistCount: number
  /** 强特完美格挡次数（主页交互栏填写；佩洛伊斯日珥回复来源） */
  perfectBlockCount: number
  /** 特殊技：强袭训令次数（主页交互栏填写；佩洛伊斯格挡招式） */
  assaultOrderCount: number
  /** 闪避反击（Dodge Counter）move id */
  dodgeCounterMoveId: string
  /** 闪避反击 actionTime */
  dodgeCounterActionTime: number
  /** 闪避反击 喧响回复 */
  dodgeCounterDecibelRecovery: number
  /** 闪避反击 合轴率 0-1 */
  dodgeCounterComboAlignRatio: number
  /** 轻弹刀（Defensive Assist #1）move id */
  defensiveAssistMoveId: string
  /** 轻弹刀 actionTime */
  defensiveAssistActionTime: number
  /** 轻弹刀 喧响回复 */
  defensiveAssistDecibelRecovery: number
  /** 轻弹刀 合轴率 0-1 */
  defensiveAssistComboAlignRatio: number
  /** 支援突击（Assist Follow-Up）move id */
  assistFollowUpMoveId: string
  /** 支援突击 actionTime */
  assistFollowUpActionTime: number
  /** 支援突击 喧响回复 */
  assistFollowUpDecibelRecovery: number
  /** 支援突击 合轴率 0-1 */
  assistFollowUpComboAlignRatio: number
  /** 后台回能加成（点/秒，来自音擎"位于后场时回能提升"等） */
  backstageRegenBonus: number
  /** 非操作回能加成（点/秒，来自音擎"非操作中角色回能提升"等） */
  comboAlignRegenBonus: number
  /** 真元奇枢受伤/回血触发次数；暂无UI时默认为0 */
  zhenyuanTriggerCount?: number
  /** 加农转子触发伤害倍率（攻击力百分比），未装备或不匹配时为0 */
  cannonRotorDamageMultiplier?: number
  /** 加农转子触发冷却，按精修等级 8/7.5/7/6.5/6 秒 */
  cannonRotorCooldownSeconds?: number
  /** 是否为维琳娜，用于风华/风蚀专属资源 */
  velinaEnabled?: boolean
  /** 维琳娜额外能力是否触发：队伍中存在其他异常角色或同属性角色 */
  velinaAdditionalAbilityActive?: boolean
  /** 维琳娜2命：赋彩属性获得同等积蓄 */
  velinaCinema2?: boolean
  /** 赋彩复制的队友属性，默认取第一个非风队友属性 */
  velinaColorElement?: string
  /** 风华广域：Eye of the Storm move id */
  velinaEyeMoveId?: string
  /** 风华广域：Eye of the Storm actionTime */
  velinaEyeActionTime?: number
  /** 风华广域：Eye of the Storm 喧响回复 */
  velinaEyeDecibelRecovery?: number
  /** 风华广域：Sweeping Cyclone #1 move id */
  velinaSweepingCyclone1MoveId?: string
  /** 风华广域：Sweeping Cyclone #2 move id */
  velinaSweepingCyclone2MoveId?: string
  /** 风蚀微域：Condensed Cyclone move id */
  velinaCondensedCycloneMoveId?: string
  /** 是否为爱丽丝，用于剑意专属资源 */
  aliceEnabled?: boolean
  /** 爱丽丝额外能力是否触发：队伍中存在另一名异常或支援角色 */
  aliceAdditionalAbilityActive?: boolean
  /** 爱丽丝普攻秒均剑意回复（attack_data[0]/actionTime 平均） */
  aliceSwordWillPerSec?: number
  /** 爱丽丝强特单次剑意回复（attack_data[0]） */
  aliceExSpecialSwordWill?: number
  /** 爱丽丝入场剑意赠送（额外能力=300，否则0） */
  aliceInitialSwordWill?: number
  /** 爱丽丝星芒圆舞曲 #3 move id = 1401012 */
  aliceSwordWillMoveId?: string
  /** 爱丽丝星芒圆舞曲 #3 actionTime = 3.983 */
  aliceSwordWillActionTime?: number
  /** 爱丽丝星芒圆舞曲 #3 喧响回复 = 76.6975 */
  aliceSwordWillDecibelRecovery?: number
  /** 爱丽丝星芒圆舞曲 #3 合轴率：设默认使前台时间=1s */
  aliceSwordWillComboAlignRatio?: number
  /** 爱丽丝极性强击每次回复剑意 = 10 */
  alicePolarityAssaultSwordWill?: number
  /** 爱丽丝全队强击每次回复剑意 = 10 */
  aliceTeamAssaultSwordWill?: number
  /** 爱丽丝紊乱每次回复剑意 = 30 */
  aliceDisorderSwordWill?: number
  /** 洛克茜风炮 move id */
  roxyWindCannonMoveId?: string
  /** 洛克茜风眼 move id */
  roxyWindEyeMoveId?: string
  /** 洛克茜小旋风 move id */
  roxyMiniTornadoMoveId?: string
  /** 洛克茜旋风锤 move id */
  roxyCycloneHammerMoveId?: string
  /** 洛克茜旋风锤引爆风眼次数；0 表示自动按风眼数全部引爆 */
  roxyCycloneHammerCount?: number
  /** 洛克茜小旋风持续秒数，默认 5 */
  roxyMiniTornadoSeconds?: number
  /** 克拉蕾斩金断铁使用次数（残痕消耗来源之一） */
  claretCleaveCount?: number
  /** 克拉蕾葬血强袭使用次数（消耗个人资源并提升伤害） */
  claretBloodBurialCount?: number
  /** 克拉蕾毁伤 move id */
  claretMaimMoveId?: string
  /** 克拉蕾葬血强袭 move id */
  claretBloodBurialMoveId?: string
  /** 克拉蕾葬血强袭的毁伤伤害倍率 move id */
  claretMaimBurialMoveId?: string
  /** 克拉蕾秘血铸锋（锐能强特）单次动作时长（秒，倍率表） */
  claretExActionTime?: number
  /** 克拉蕾秘血铸锋（锐能强特）单次喧响回复（倍率表行） */
  claretExDecibelRecovery?: number
  /** 克拉蕾葬血强袭基础伤害倍率（倍率表 1611014 damage 行） */
  claretBloodBurialDamageMultiplier?: number
  /** 克拉蕾葬血强袭的毁伤伤害倍率基础值（倍率表 1611015 damage 行） */
  claretMaimBurialDamageMultiplier?: number
  /** 跳过通用强特执行，由机制模块自行生成强特执行（柏妮思等可变耗能强特） */
  skipGenericExSpecial?: boolean
  /** 强特次数强制取整（默认 skipGenericExSpecial 时按小数期望值模型）；琉音等真实次数强特需开启 */
  exSpecialCountFloor?: boolean
  /** 柏妮思单喷持续秒数（0 表示不放） */
  burniceSingleSpraySeconds?: number
  /** 柏妮思双喷持续秒数（0 表示不放） */
  burniceDoubleSpraySeconds?: number
  /** 柏妮思命座等级（1命强化余烬伤害与积蓄） */
  burniceCinemaLevel?: number
  /** 柚叶连携入场次数（其他角色连携技入场+1甜度点，滑块 yuzuha.chainEntryCount） */
  yuzuhaChainEntryCount?: number
  /** 十人十色转积蓄目标元素（applyTeamConfig 定位异常专精队友写入，buildExecutions 行级 element 消费） */
  yuzuhaTransferElement?: string
  /** 柚叶命座等级（影画6） */
  yuzuhaCinemaLevel?: number
  /** 柏妮思搅拌式次数：0 表示自动按溢出燃点取上限 */
  burniceStirringCount?: number
  /** 柏妮思搅拌式（1171007 融合）单次动作时长（秒） */
  burniceStirringActionTimeSeconds?: number
  /** 柏妮思流火计数利用率（0-1），默认 1 */
  burniceFlowCountUtilization?: number
  /** 搅拌式融合倍率 = Mixed Flame Blend #1×0.5 + #2 */
  burniceStirringDamageRatio?: number
  /** 灼热抛接法伤害倍率（1171026） */
  burniceTossingDamageRatio?: number
  /** 流火·灼热抛接法（1171026）单次动作时长（秒） */
  burniceTossingActionTimeSeconds?: number
  /** 机制模块引用的倍率表基础值（moveId → 行值），供事件→倍率表映射使用 */
  mechanicRowValues?: Record<string, number>
  /** 克拉蕾锐能消耗（秘血铸锋 60/次） */
  claretSharpnessCost?: number
  /** 克拉蕾命中残痕状态覆盖率（0-1，默认 1） */
  claretGashCoverage?: number
  /** 克拉蕾命座等级（用于二命锐能额外回复） */
  claretCinemaLevel?: number
  /** 星见雅命座等级（影画1 招式限定减防等按此门控） */
  miyabiCinemaLevel?: number
  /** 爱丽丝畏缩 DOT 伤害比例（% 强击伤害），默认 2.5 */
  aliceCoweringDotRatio?: number
  /** 爱丽丝畏缩 DOT 间隔（秒），默认 0.95 */
  aliceCoweringDotInterval?: number
  /** 爱丽丝畏缩紊乱倍率加成每剩余秒数（%），默认 18 */
  aliceCoweringDisorderBonusPerSec?: number
  /** 爱丽丝畏缩紊乱倍率加成上限（%），默认 180 */
  aliceCoweringDisorderBonusMax?: number
  /** 爱丽丝畏缩物理异常积蓄效率加成（%），默认 25 */
  aliceCoweringBuildUpEfficiency?: number
  /** 爱丽丝异常掌控转精通：掌控>140时超出部分转化率，默认 1.6 */
  aliceMasteryToProficiencyRate?: number
  /** 爱丽丝二命：终结技命中触发极性强击（额外 spark） */
  aliceCinema2UltSpark?: boolean
  /** 爱丽丝六命：决胜状态额外攻击已启用 */
  aliceCinema6Enabled?: boolean
  /** 爱丽丝六命：单轮最大触发次数（默认 6） */
  aliceCinema6MaxTriggers?: number
  /** 爱丽丝六命：伤害倍率 = 异常精通 × 3300%（小数形式 33） */
  aliceCinema6DamageRatio?: number
  /** 开局赠送能量（普通人40，仪玄120闪能等） */
  initialEnergyGift: number
  /** 开局赠送喧响（默认1000，部分命座额外） */
  initialDecibelGift: number
  /** 不可分享的额外喧响（默认0） */
  extraSelfDecibelReward: number
  /** 每次终结技额外获得的不可分享喧响（如橘福福额外能力对强攻/命破 300/次） */
  extraSelfDecibelPerUltimate?: number
  /** 伊德海莉 4 命：生命值降低时喧响获得提升 10% */
  yidhariCinema4Enabled?: boolean
  /** 伊德海莉每降低 1% 生命值获得的喧响（含命座修正） */
  yidhariDecibelPerHpPct?: number
  /** 伊德海莉强特释放时已损失生命值比例（0-1，默认0.75） */
  yidhariExHealMissingHpPct?: number
  /** 伊德海莉失衡次数（外层不动点传入，供失衡内极寒重碾次数） */
  yidhariStunCount?: number
  /** 伊德海莉每次失衡极寒重碾次数（0命2 / 1命3） */
  yidhariExPerStun?: number
  /** 伊德海莉寒冰触手触发间隔（秒，默认13.5） */
  yidhariTentacleInterval?: number
  /** 伊德海莉非失衡（溯寒后）极寒重碾每次回闪能（默认15） */
  yidhariRefundPerOutStunEx?: number
  /** 伊德海莉强特次数迭代期实数化（refund 反馈解析求解后，必要时间按连续不动点参与收敛，终局才 floor） */
  yidhariContinuousEx?: boolean
  /** 伊德海莉终局整数重推标记（收敛后临时置位，重推 ≤3 轮让时间账本与整数次数自洽；迭代期勿置位） */
  yidhariFinalizeEx?: boolean
  /** 伊德海莉失衡内极寒重碾次数（失衡轴连段反推：单次1 + 双次2；缺省走 yidhariExPerStun × 失衡数） */
  yidhariInStunExCount?: number
  /** 伊德海莉失衡内强特消耗的闪能（单次×50 + 双次×85；缺省 = 次数 × exSpecialEnergyConsume） */
  yidhariInStunEnergyCost?: number
  /** 伊德海莉外部回血（%自身最大生命值）：如卢西娅星光汇聚之地等，由其他机制换算后累加 */
  yidhariExternalHealPct?: number
  /** 伊德海莉外部回血按卢西娅终结技次数结算的比例（每次大 %自身最大生命值），由卢西娅模块换算注入 */
  yidhariExternalHealPerUltPct?: number
  /** 卢西娅4命：每次帷幕开启/延长给全队每人的喧响（100；未开4命为 0/undefined） */
  luciaC4DecibelPerTrigger?: number
  /** 卢西娅4命帷幕触发利用率（0-1，帷幕连着放卡15s CD 时调低），默认 1 */
  luciaC4CurtainCoverage?: number
  /** 卢西娅4命本局帷幕触发总次数（收敛后由资源池按最终终结技次数写入，供模块展示） */
  luciaCurtainTriggerCount?: number
  /** 伊德海莉蓄力循环招式（buildExecutions 消费） */
  yidhariChargeSlam?: YidhariLoopMove
  yidhariBasicFollow?: YidhariLoopMove
  /** 喧响伴随获得比例（默认0.5，部分角色0.525） */
  decibelShareRatio: number
  /** 辅助大招给队友回能量（如柚叶25，无则0） */
  supportUltimateEnergyRegen: number
  /** 是否为辅助角色（影响连携默认分配） */
  isSupport: boolean
  /** 时间分配权重（3个角色的权重比，用于分配平A时间） */
  timeWeight: number
  /** 时间预算收敛：执行计划前台时间超出战斗时间的部分（秒），折入必要前台时间以压缩平A池（引擎时间收敛外层循环写入） */
  timeBudgetExcess?: number
  /**
   * 真实时间压力（秒，引擎折叠循环每轮写入，模块只读）：
   * `本槽物化前台净占用 − max(0, 预算 − 队友账本净占用)` —— 即"队友占完之后，本槽真正可用的
   * 前台时间还剩多少"，正数 = **本槽的动作真的装不下**。
   * 与 `timeBudgetExcess` 的区别：后者是**累加的折叠残差**（pass0 平A池满额发放时会灌进一个
   * 后续再也不会出现的巨大值，且只增不减），拿它当退化判据会误判——叶瞬光自动选轴曾因此
   * 被人为关掉（`yeshuguang.formAxis` default 0 打满，描述写着「超支信号被虚高，自动会过度退化」）。
   * 需要「时间不够就压结构」的模块（退化短轴/砍交互）一律读本字段，不要读 timeBudgetExcess。
   */
  timePressureSeconds?: number
  /**
   * 本槽可用前台时间（秒，与 `timePressureSeconds` 同源）：`预算 − 队友账本净占用`。
   * 模块按它封顶自己的动作量（叶瞬光按它砍明心境轮数），比"超了多少"更好用。
   */
  timeAvailableFrontlineSeconds?: number
  /** 嘲讽取消次数（般岳专属：失衡外强特连段末尾后摇的嘲讽取消，每次取消一次后摇；缺省 0） */
  tauntCancelCount?: number
  /** 资源利用率覆盖：actionId/eventId -> 释放率/上限 */
  resourceUtilization?: Record<string, ResourceUtilizationRule>
  /** 是否为雅，用于烈霜/落霜专属机制 */
  miyabiEnabled?: boolean
  /** 雅霜月架势三段 move id = 1091029 */
  miyabiFrostMoonMoveId?: string
  /** 雅霜月架势三段消耗落霜 = 6 */
  miyabiFrostMoonCount?: number
  /** 雅霜月架势三段 actionTime = 3.434 */
  miyabiFrostMoonActionTime?: number
  /** 琉音命座等级 */
  liuyinCinemaLevel?: number
  /** 琉音额外能力是否触发（队伍存在强攻或命破角色） */
  liuyinExtraAbilityActive?: boolean
  /** 琉音专属直伤读取的上一位队友槽位（已解析） */
  liuyinPreviousTeammateSlot?: number
  /** 琉音 60 好评抱拳次数；-1 表示按失衡次数自动 */
  liuyinHug60Count?: number
  /** 琉音送客长按（客诉抱拳）move id = 1481009 */
  liuyinFarewellMoveId?: string
  /** 琉音送客长按伤害倍率（1481009 damage 行） */
  liuyinFarewellDamage?: number
  /** 琉音送客长按动作时间（1481009 actionTime） */
  liuyinFarewellActionTime?: number
  /** 琉音送客长按喧响回复（1481009 decibel_recovery 行） */
  liuyinFarewellDecibel?: number
  /** 琉音强化A（普通攻击：猜拳把戏 #1-#4）一轮总时长（秒）；= 4 段 actionTime 之和 */
  liuyinJankenRoundSeconds?: number
  /** 琉音强化A 4 段（1481005-1481008）各段 actionTime */
  liuyinJankenActionTimes?: number[]
  /** 诺姆命座等级 */
  normaCinemaLevel?: number
  /** 诺姆额外能力是否触发（队伍有强攻/命破/同阵营） */
  normaAdditionalAbilityActive?: boolean
  /** 诺姆嗯呢弹幕覆盖率（0-1，手动可调；0=自动按 32s×次数/战斗时间） */
  normaBarrageCoverage?: number
  /** 诺姆技术鸿沟覆盖率（0-1，默认 1） */
  normaTechGapCoverage?: number
  /** 诺姆技术鸿沟失衡易伤（额外能力触发时，+3%/层×10层） */
  normaTechGapStunBonus?: number
  /** 诺姆额外能力攻击提升（44~870，随等级） */
  normaExtraAbilityAtkBonus?: number
  /** 诺姆失衡次数（外层不动点传入，供火力实验导弹舱次数） */
  normaStunCount?: number
  /** 诺姆失衡覆盖率（外层不动点传入，供火力实验高爆/破甲按失衡时长拆分） */
  normaStunCoverage?: number
  /** 诺姆战斗时间（外层注入，供炮塔全程射击/导弹舱时长封顶） */
  normaBattleTime?: number
  /** 诺姆嗯呢弹幕 6 段 actionTime（1571007-1571012，buildCharConfig 预存） */
  normaBarrageActionTimes?: number[]
  /** 诺姆嗯呢弹幕 6 段 damage/daze 表值（buildCharConfig 预存，供 C6 技能专属加成缩放） */
  normaBarrageRowValues?: { damage: number[]; daze: number[] }
  /** 诺姆火力实验导弹 2 段 damage/daze 表值（1571014 破甲/1571015 高爆，buildCharConfig 预存） */
  normaMissileRowValues?: { damage: number[]; daze: number[] }
  /** 诺姆影画2·帽子把戏每次回能（25；未达2命为 0） */
  normaC2EnergyPerTrigger?: number
  /** 诺姆影画2·帽子把戏触发间隔（20秒） */
  normaC2TriggerInterval?: number
  /** 青衣命座等级 */
  qingyiCinemaLevel?: number
  /** 希格莉德命座等级（patchExecutions 门控影画2/1/6 执行级效果） */
  sigridCinemaLevel?: number
  /** 希格莉德局内攻击力（敛枪式最后一击附加伤害的基数，buildCharConfig 预存） */
  sigridAtk?: number
  /** 奥菲丝命座等级（patchExecutions 门控影画6 激光附加伤害） */
  orphieCinemaLevel?: number
  /** 奥菲丝局内攻击力（影画6 激光附加伤害的基数，buildCharConfig 预存） */
  orphieAtk?: number
  /** 奥菲丝影画6 火刀触发次数（buildResourceResult 按 cinema>=6 写入，蓄炎资源读取） */
  orphieBladeHits?: number
  /** 席德命座等级（patchExecutions 门控影画6 激光附加伤害） */
  xideCinemaLevel?: number
  /** 席德局内攻击力（影画6 激光附加伤害的基数，buildCharConfig 预存） */
  xideAtk?: number
  /** 席德正兵槽位（applyTeamConfig build 阶段确定：初始攻击最高的强攻队友；无强攻队友为 -1） */
  xideVanguardSlot?: number
  /** 席德正兵实际耗能（calcCrossAgentEnergy 算席德能量时写入 = 正兵强特次数 × 正兵强特耗能） */
  xideVanguardEnergySpent?: number
  /** 席德额外能力门控（buildCharConfig 写入：additionalAbilityActive>0 为 1；patchExecutions 招式限定用） */
  xideAAActive?: number
  /** 席德钢能平A秒均（四段 attack_data 总和 ÷ 四段 actionTime 总和） */
  xideBasicSteelPerSec?: number
  /** 席德钢能各招式 attack_data 总和（moveId → 钢能点，buildCharConfig 统一对全部倍率页求和） */
  xideAttackDataMap?: Record<string, number>
  /** 席德钢能招式攻击数据总回复（buildExecutions 统一对全部执行行求和写入） */
  xideAttackSteel?: number
  /** 希希芙命座等级（毒素初始值门控影画1） */
  xixifuCinemaLevel?: number
  /** 希希芙进场毒素（3，影画1→6；computeXixifuToxinTotal 写入） */
  xixifuInitialToxin?: number
  /** 希希芙队伍电属性角色数（含自身；buildCharConfig 写入，蚀骨失衡值 +40%/60% 门控） */
  xixifuElectricCount?: number
  /** 希希芙局内攻击力（蚀骨核心附加 335% 的 flatDamageBonus 基数，buildCharConfig 写入） */
  xixifuAtk?: number
  /** 希希芙失衡次数（applyTeamConfig converge 写入，影画2 失衡下终结+3毒素门控） */
  xixifuStunCount?: number
  /** 希希芙影画2 失衡下连携/终结额外毒素合计（computeXixifuToxinTotal 写入，spec gain rule cfgField 读取） */
  xixifuC2Toxin?: number
  /** 朱鸢命座等级（霰弹资源门控影画1 快速装填/影画6 以太余温） */
  zhuyuanCinemaLevel?: number
  /** 朱鸢影画1 快速装填连携回复量（6，非影画1 为 0；computeZhuYuanShellsTotal 写入） */
  zhuyuanC1ChainReload?: number
  /** 朱鸢影画1 快速装填终结回复量（9，非影画1 为 0；computeZhuYuanShellsTotal 写入） */
  zhuyuanC1UltReload?: number
  /** 青衣失衡次数（外层不动点传入，供醉花月云转轮数） */
  qingyiStunCount?: number
  /** 青衣通用行实测总时间（buildExecutions 写入，电压计划预算扣减用） */
  qingyiGenericRowsTime?: number
  /** 青衣可分配循环秒均（一煞#4 连打→醉花月云转） */
  qingyiLoopRates?: {
    yisha4Voltage: number
    yisha4ActionTime: number
    hitsPerRound: number
    yisha4TimePerRound: number
    zuiHuaTimePerRound: number
    dmgPerSec: number
    dazePerSec: number
    anomalyPerSec: number
  }
  /** 青衣醉花月云转 #1/#2 倍率行（含 +25% 伤害 / +12.5% 失衡） */
  qingyiZuiHuaMove1?: { id: string; damage: number; daze: number; anomaly: number; actionTime: number; decibel: number; energy: number }
  qingyiZuiHuaMove2?: { id: string; damage: number; daze: number; anomaly: number; actionTime: number; decibel: number; energy: number }
  /** 青衣一煞#4（1251004）倍率行——补电压专用快段（≈25 电压/秒） */
  qingyiYisha4?: { id: string; damage: number; daze: number; anomaly: number; actionTime: number; decibel: number; energy: number }
  /** 青衣通用招式电压回复量（attack_data） */
  qingyiExSpecialVoltage?: number
  qingyiUltimateVoltage?: number
  qingyiChainVoltage?: number
  qingyiDodgeCounterVoltage?: number
  qingyiQuickAssistVoltage?: number
  qingyiAssistFollowUpVoltage?: number
  /** 青衣影画4·稳态电弧屏障：护盾刷新每次回能（5；未达4命为 0） */
  qingyiC4EnergyPerTrigger?: number
  /** 青衣影画4·稳态电弧屏障：回能冷却间隔（10秒） */
  qingyiC4TriggerInterval?: number
  /** 莱卡恩失衡次数（外层不动点传入，围猎次数 = 失衡次数，用户口径） */
  lycaonStunCount?: number
  /** 莱卡恩单次失衡窗口时长（秒，外层注入 = stunTime + 4 + 全队失衡延长） */
  lycaonWindowDuration?: number
  /** 莱卡恩总战斗时间（秒，外层注入） */
  lycaonTotalTime?: number
  /** 莱卡恩 boss 无敌时间（秒，外层注入，围猎后台时间扣减） */
  lycaonInvincibleTime?: number
  /** 莱卡恩围猎后台蓄力普攻秒均伤害倍率（buildCharConfig 预存，蓄力短循环 #2→#4→#6） */
  lycaonChargePerSec?: number
  /** 莱卡恩围猎后台蓄力普攻秒均失衡（buildCharConfig 预存，蓄力短循环 #2→#4→#6） */
  lycaonChargeDazePerSec?: number
  /** 莱卡恩前台普攻秒均伤害（buildCharConfig 预存，全部蓄力段 #2/#4/#6/#8/#10/#11 平均，用户口径） */
  lycaonFrontChargePerSec?: number
  /** 莱卡恩前台普攻秒均失衡（buildCharConfig 预存，全部蓄力段平均） */
  lycaonFrontChargeDazePerSec?: number
  /** 莱卡恩围猎后台跟随闪反次数 = 队伍其他角色闪避反击次数之和（useResourceCalc 注入） */
  lycaonBackstageDodgeCount?: number
  /** 莱卡恩围猎后台闪避反击单次失衡倍率（1141019，buildCharConfig 预存） */
  lycaonDodgeDaze?: number
  /** 莱卡恩冰舞（1141027）异常积蓄表值（buildCharConfig 预存，围猎开场/收尾冰舞有积蓄/喧响） */
  lycaonIceDanceAnomaly?: number
  /** 莱卡恩冰舞（1141027）喧响表值（buildCharConfig 预存） */
  lycaonIceDanceDecibel?: number
  /** 莱卡恩强特三段（1141015-1141017）喧响表值（buildCharConfig 预存） */
  lycaonExDecibels?: Record<string, number>
  /** 莱卡恩命座等级（buildCharConfig 写入，buildExecutions 读取） */
  lycaonCinemaLevel?: number
  /** 莱卡恩影画1强特失衡强化覆盖率（滑块 lycaon.c1Coverage，8s CD 折算） */
  lycaonC1Coverage?: number
  /** 莱卡恩影画2回能（5 能量/次；次数 = 失衡次数 + 队伍连携总次数，由 useResourceCalc 注入总额） */
  lycaonC2EnergyPerTrigger?: number
  /** 诺姆膛温换连携次数（buildResourceResult 回写，C4 喧响 = 次数 × 200 × 2 由资源池注入） */
  normaHatToChainCount?: number
  /** 莱卡恩影画2回能总额（useResourceCalc 注入 = (失衡次数 + 队伍连携总次数) × 5） */
  lycaonC2Energy?: number
  /** 卢西娅 A5（随想 1451005）actionTime，buildCharConfig 从倍率表读取 */
  luciaA5ActionTime?: number
  /** 卢西娅命座等级（buildCharConfig 写入，供 patchExecutions 按命座补合唱行专属字段） */
  luciaCinemaLevel?: number
  /** 般岳失衡轴内捏的强特/连段块次数（useResourceCalc 注入，moveId → 总次数；先扣闪能，剩余自动补连段） */
  banyueAxisEx?: Record<string, number>
  /** 般岳招式 actionTime 表（buildCharConfig 从倍率表预存） */
  banyueMoveTimes?: Record<string, number>
  /** 般岳招式 damage 倍率表（buildCharConfig 从倍率表预存） */
  banyueMoveDmg?: Record<string, number>
  /** 比利影画1：冲刺/闪反额外回能总额（模块按原始次数与5秒冷却计算） */
  billyC1Energy?: number
  /** 星徽·比利招式 actionTime 表（buildCharConfig 从倍率表预存） */
  billyMoveTimes?: Record<string, number>
  /** 星徽·比利招式 damage 倍率表（buildCharConfig 从倍率表预存） */
  billyMoveDmg?: Record<string, number>
  /** 星徽·比利招式 decibel_recovery 表（buildCharConfig 从倍率表预存） */
  billyMoveDecibel?: Record<string, number>
  /** 仪玄招式 actionTime 表（buildCharConfig 从倍率表预存） */
  yixuanMoveTimes?: Record<string, number>
  /** 仪玄招式 damage 倍率表（buildCharConfig 从倍率表预存） */
  yixuanMoveDmg?: Record<string, number>
  /** 仪玄招式 daze 表（buildCharConfig 从倍率表预存） */
  yixuanMoveDaze?: Record<string, number>
  /** 仪玄额外闪能总账（模块汇总：完美格挡+10/次、极限闪避+5/次、影画1落雷+5/次，calcEnergySource 通用读取） */
  yixuanFlashBonus?: number
  /** 仪玄额外能力：队友释放终结技时回复闪能（2/s×10s=20/次；队伍有击破/支援/防护时生效，iterate 补算） */
  teamUltimateFlashBonus?: number
  /** 仪玄术法值初始值（影画1：立即获得 120；spec 术法值 initialValueSource=cfgField 读取） */
  yixuanShufaInitial?: number
  /** 橘福福威风初始值（影画1：进场立即获得 100；spec 威风 initialValueSource=cfgField 读取） */
  jufufuAweInitial?: number
  /** 橘福福影画2：任意角色终结技时威势回复量/次（未达2命为 0；spec gain valueSource=cfgField） */
  jufufuC2WeishiPerUlt?: number
  /** 橘福福·虎威自动攻击次数（后场 floor(t/4)） */
  jufufuHuweiHits?: number
  /** 橘福福·虎釜震煞次数（威风账本 floor(total/100)） */
  jufufuTigerChainCount?: number
  /** 橘福福·山君鼎戏·威势旋转命中次数（= 威势消耗） */
  jufufuSpinCount?: number
  /** 橘福福影画等级（模块缓存） */
  jufufuCinemaLevel?: number
  /** 叶瞬光青溟剑势初始（影画1：进场 6 点；未达1命为 0） */
  yeshuguangSwordInitial?: number
  /** 叶瞬光：琉音转大赠送逐云次数（编排层注入） */
  yeshuguangGiftUltCount?: number
  /** 丽娜终结技每次给本槽位的能量（邻位30/10） */
  rinaEnergyPerRinaUlt?: number
  /** 露西终结技每次给本槽位的能量（邻位 30/10） */
  lucyEnergyPerLucyUlt?: number
  /** 露西影画1：回旋挥击全队回能标记 */
  lucyC1Enabled?: number
  /** 露西：队友强特合计（编排注入） */
  lucyTeammateExTotal?: number
  /** 莱特：全队普通能量消耗（士气能量来源；编排注入，不含闪能） */
  lighterTeamEnergyConsumed?: number
  /** 莱特影画等级（模块缓存） */
  lighterCinemaLevel?: number
  /** 莱特影画4：喷发时给后场角色的能量总额（次数×4，18s CD） */
  lighterC4BurstEnergy?: number
  /** 莱特后场时间占比（影画4 前场效率覆盖） */
  lighterBackstageRatio?: number
  /** 全队通用：当前轮失衡时间覆盖率（0-1；编排层按失衡次数×窗口时长/有效时间统一注入，供模块近似拆失衡内外） */
  teamStunCoverage?: number
  /** 全队通用：轴内各 moveId 捏块总次数（块数×窗口数；轴模式由编排层注入，非轴为空对象） */
  axisActionCounts?: Record<string, number>
  /** 全队通用：轴内终结技块总次数（× 窗口数；轴模式注入，非轴 0；希希芙影画2 等消费） */
  axisUltimateTotal?: number
  /** 苍角终结技每次给本槽位的能量（邻位 30/10） */
  soukakuEnergyPerSoukakuUlt?: number
  /** 全队通用：以太帷幕开启总次数（照 veilCount + 爱芮/叶瞬光/千夏开帷幕；爱芮应援能量与叶瞬光溯影惊鸿消费） */
  teamVeilCountTotal?: number
  /** 仪玄·2连墨痕化形次数（主页交互栏；#1+#3，40闪能/次） */
  yixuanInk2Count?: number
  /** 仪玄·3连墨痕化形次数（主页交互栏；#1+#3+#4，60闪能/次） */
  yixuanInk3Count?: number
  /** 仪玄·完美格挡次数（主页交互栏；#2 赠送 + 回10闪能/次） */
  yixuanPerfectBlockCount?: number
  /** 仪玄失衡轴内强特次数（useResourceCalc 注入，moveId → 总次数） */
  yixuanAxisEx?: Record<string, number>
  /** 仪玄轴内凝云术蓄力时长（轴 action.duration 加权，默认满蓄 2s） */
  yixuanAxisCloudSeconds?: number
  /** 仪玄失衡轴模式标记（useResourceCalc 注入） */
  yixuanAxisActive?: boolean
  /** 仪玄玄墨异常触发回闪能（外层收敛注入：触发次数 × 10，10s CD 封顶） */
  yixuanAnomalyTriggerFlash?: number
  /** 仪玄极限支援换场次数上限 = 队友正常弹刀次数求和（useResourceCalc 注入，用户口径） */
  yixuanExtremeAssistCap?: number
  /** 仪玄极限支援换场次数（主页录入；缺省 = 上限） */
  yixuanExtremeAssistCount?: number
  /** 仪玄·墨影凝云合轴次数（后台墨影凝云+霄云劲#5，不占战场时间但有倍率行调用） */
  yixuanBackstageComboCount?: number
  /** 失衡轴内总时间（秒）= Σ窗口数 × 窗口时长（useResourceCalc 轴模式注入；CD 自动动作如仪玄C1落雷/卢西娅追击按此折算次数） */
  axisInSeconds?: number
  /** 星徽·比利失衡轴内捏的动作次数（useResourceCalc 注入，moveId → 总次数，组合块已展开） */
  billyAxisEx?: Record<string, number>
  /** 星徽·比利是否失衡轴模式（useResourceCalc 注入） */
  billyAxisActive?: boolean
  /** 希格莉德轴内破阵连段套数（useResourceCalc 注入：破阵块 + C6 时诺姆赠送连携触发的破阵，经窗口时间门控） */
  sigridAxisPozhenSets?: number
  /** 希格莉德是否失衡轴模式（useResourceCalc 注入） */
  sigridAxisActive?: boolean
  /** 星徽·比利失衡覆盖率（useResourceCalc 注入，涡轮增压「失衡动力压制」获得计数用） */
  billyStunCoverage?: number
  /** 星徽·比利普攻秒均决意（attack_data_0 四段总和/四段时长，buildCharConfig 从倍率表预存） */
  billyBasicDeterminationPerSec?: number
  /** 星徽·比利普攻秒均回血%（attack_data_1 四段总和/四段时长，buildCharConfig 从倍率表预存） */
  billyBasicHealPerSec?: number
  /** 总战斗时间（秒，默认 180；全战斗时间类来源使用，如星徽·比利决意缓慢回复 2 点/秒） */
  battleTime?: number
  /** boss 无敌时间（秒，缺省 0）。后台/CD 伤害通道按 core/effectiveTime.ts 扣减折算；能量/喧响通道不扣 */
  invincibleTime?: number
  /** 敌方体型（影响体型相关招式倍率，如艾莲霜锋剑气 0/3/6 段） */
  bodySize?: 'small' | 'medium' | 'large'
  /** 金身格挡/不动如山招架次数（队伍配置页 per-character，般岳嗔火来源） */
  blockCount?: number
  /** 双反次数（般岳专属：完美闪避+金身弹刀组合，+10嗔火/次，产冲霄） */
  dualCounterCount?: number
}

// ============ 计算配置 ============

/** 资源池计算的全局配置 */
export interface ResourceCalcConfig {
  /** 总时间（秒，默认180） */
  totalTime: number
  /** boss 无敌时间（秒，扣减平A可分配池） */
  invincibleTime?: number
  /** boss 失衡值 */
  bossStunValue: number
  /** 秽盾数量（每个破后送60能量/闪能） */
  shieldCount: number
  /** 能量盾数量（每个破后送30能量，不给命破加闪能） */
  energyShieldCount: number
  /** 最大迭代次数 */
  maxIterations: number
  /** 时间预算收敛最大外层循环次数（缺省 8）：模块专属动作行超出战斗时间时折入必要前台重收敛 */
  maxTimeIterations?: number
  /**
   * 时间预算欠打回填（秒，团队级）：上一轮测得「各角色账本 − 物化前台行」的正差总和。
   * 账本高估（estimate 高于物化行）时 basic 池会被挤到 0，物化行打不满战斗时间；
   * 该差额回填进团队平A池（按 timeWeight 分配），让 Σ前台行 ≈ 预算。
   * 由 calcTeamResources 时间预算折叠循环每轮重写；iterate 只读。
   */
  timeBudgetRefund?: number
  /**
   * 轴内合轴节省（秒，团队级，输入）：失衡窗口内跨角色块并行（般岳强特时琉音抱拳）只计一次前台。
   * 由 useResourceCalc 用栈引擎算好传入（StackTraversalResult.overlapSeconds）；iterate 平A池吃进、
   * 折叠循环 excess 测量与结果上报（TeamResourceResult.axisOverlapSeconds）共用同一值。
   */
  axisOverlapSeconds?: number
  /** 合轴节省按块分摊（`${slot}:${moveId}` → 秒）：折叠循环按行扣减用 */
  axisOverlapByAction?: Record<string, number>
  /**
   * 全队必要前台的可行比例（引擎 iterate 每轮写入，装配阶段消费）：
   * `预算 ÷ Σ必要净占用`，<1 = 想打的必做动作装不进战斗时间 ⇒ 执行计划按时间线截断。
   */
  timeFeasibleScale?: number
  /**
   * 合轴溢出（秒，输出）：合轴抵扣后的必做前台净占用超出「战斗时间 − 无敌」的量
   * （iterate 每轮写入；轴模式抵扣与栈引擎节省取 max，不叠加）。
   */
  overflowSeconds?: number
  /** 迭代初值注入（测试/热启动用）：连续松弛下收敛态与初值无关，任意种子应得同解；长度不符时忽略 */
  initialStates?: IterationState[]
  /** 失衡次数输入（连携次数 = chainCountPerStun × stunCount）；由外部失衡池不动点收敛后回填 */
  stunCount?: number
  /**
   * 时间轴喧响轨（对轴模块，用户口径 2026-08-31）：窗口时序推演出的「实际可放大招数」
   * 按 slot 给定（轴模式注入；缺省 = 不启用，按总量口径 floor(喧响/3000)）。
   * 语义：180s 按失衡窗分段，喧响均匀回复（3000 上限、溢出浪费），进窗够 3000 放大清空、
   * 不够削减该窗大招。iterate 用它替代 floor(decibels/cost) 的大招次数。
   */
  axisUltimateTrackBySlot?: Record<number, number>
  /** 特殊动作喧响奖励（弹刀/闪反/连携/快支，含伴随50%）按槽位注入；参与终结技次数推导 */
  specialActionDecibelBonusPerSlot?: number[]
  /** 异常/紊乱/乱流喧响奖励（含伴随50%）按槽位注入，由上一轮异常池结果回填；参与终结技次数推导 */
  anomalyDecibelBonusPerSlot?: number[]
  /** 3个角色的操作配置 */
  characters: CharacterOperationConfig[]
}

// ============ 迭代中间状态 ============

/** 单次迭代中各角色的中间状态 */
export interface IterationState {
  /** 平A时间 */
  basicAttackTime: number
  /** 强特次数 */
  exSpecialCount: number
  /** 终结技次数 */
  ultimateCount: number
  /** 本轮计划连携次数；先按配置参与资源池迭代，后续可由失衡池二阶段回填 */
  chainCountTotal: number
  /** 总能量 */
  totalEnergy: number
  /** 驱动本次迭代次数的能量源快照（2026-09-03：展示与驱动同源——装配直接复用，
   *  杜绝「iterate 用上轮态 vs 装配用当前态」的 Δ 分裂；缺省 = 重新计算） */
  energySource?: EnergySource
  /** 总喧响（含开局赠送） */
  totalDecibel: number
  /** 必做动作前台时间（未扣除合轴） */
  necessaryTime: number
  /** 前台时间 */
  frontlineTime: number
  /** 后台时间 */
  backstageTime: number
  /** 合轴时间 */
  comboAlignTime: number
  /** 合轴抵扣时间（comboAlignTime 中含在 necessaryTime 内、计入团队时间预算抵扣的部分；缺省 = 0） */
  comboAlignCredit?: number
}

// ============ 失衡池 ============

/** 单个招式的失衡贡献记录 */
export interface StunContribution {
  /** 招式 move id */
  moveId: string
  /** 招式名称 */
  moveName: string
  /** 角色 slot */
  slot: number
  /** 执行次数 */
  count: number
  /** 基础失衡倍率（从倍率表 daze row 提取） */
  baseDaze: number
  /** 单次实际失衡值（经过乘区计算后） */
  perHitStun: number
  /** 总失衡值 = count × perHitStun */
  totalStun: number
  /** 落在失衡窗口内的单位占比（0-1；失衡轴模式下窗口内失衡值无效） */
  inAxisFraction: number
  /** 落在失衡窗口内的失衡值（无效部分） */
  inAxisStun: number
  /** 有效失衡值 = totalStun - inAxisStun */
  effectiveStun: number
}

/** 队伍失衡池结果 */
export interface StunPoolResult {
  /** 各招式的失衡贡献明细 */
  contributions: StunContribution[]
  /** 全队有效总失衡值（已扣除失衡窗口内的无效失衡值） */
  totalStunBuildUp: number
  /** 全队毛失衡值（未扣除轴内无效部分；无轴时 = totalStunBuildUp） */
  grossStunBuildUp: number
  /** 失衡窗口内失效的失衡值合计 */
  inAxisStunTotal: number
  /** Boss 失衡值上限 */
  bossStunValue: number
  /** 失衡次数 = floor(有效总失衡值 / bossStunValue)；含失衡值返还（第1次满额、之后按 (1-返还比例) 折算） */
  stunCount: number
  /** 失衡值返还比例（0~0.25，雨果决算口径） */
  stunRefundRatio: number
  /** 实际返还的失衡值合计（除最后一次失衡外的每次各返还 refundStunRatio × bossStunValue） */
  stunRefundValue: number
  /** Boss 白送的失衡值（如 亵渎者 30% 失衡上限；计入 stunCount 推导，不参与抗性/返还折算） */
  stunGift: number
  /** 每次失衡的连携次数（首领默认3，可由用户配置） */
  chainCountPerStun: number
  /** 总连携次数 = 失衡次数 × 每次连携次数 */
  chainCountTotal: number
  /** 失衡相关喧响奖励 = 失衡次数 × 20 + 总连携次数 × 10 */
  decibelBonus: number
  /** 各角色的有效失衡贡献汇总 */
  perSlotStun: number[]
}

// ============ 积蓄池 ============

/** 单个元素的积蓄进度 */
export interface AnomalyProgress {
  /** 元素 */
  element: string
  /** 总积蓄值 */
  totalBuildUp: number
  /** 积蓄上限（暂时用默认值，后续由用户配置） */
  buildUpCap: number
  /** 触发异常次数 = floor(总积蓄值 / 积蓄上限) */
  triggerCount: number
  /** 触发异常奖励喧响 = triggerCount × 170 */
  decibelBonus: number
  /** 该元素触发次数按角色归属拆分 */
  perSlotTriggerCounts: number[]
  /** 各招式积蓄贡献明细 */
  contributions: AnomalyContribution[]
}

/** 单个招式的异常积蓄贡献记录 */
export interface AnomalyContribution {
  moveId: string
  moveName: string
  slot: number
  element: string
  count: number
  /** 基础积蓄值（从倍率表 anomaly_buildup row 提取） */
  baseBuildUp: number
  /** 单次实际积蓄值（经过乘区计算后） */
  perHitBuildUp: number
  /** 总积蓄值 */
  totalBuildUp: number
  /** 本行招式限定增伤（%，从 SkillExecution.dmgBonus 携带，进异常基础区增伤按积蓄占比加权） */
  dmgBonus?: number
}

/** 队伍积蓄池结果 */
export interface AnomalyPoolResult {
  /** 各元素的积蓄进度 */
  perElement: AnomalyProgress[]
  /** 触发异常总次数（所有元素之和） */
  totalTriggerCount: number
  /** 紊乱次数 = min(sum - 1, 2 × (sum - max)) */
  disorderCount: number
  /** 积蓄相关喧响奖励 = 触发异常 × 170 + 紊乱 × 85 + 乱流 × 85 */
  decibelBonus: number
  /** 各角色归属的异常触发次数 */
  perSlotAnomalyTriggers: number[]
  /** 各角色归属的紊乱触发次数 */
  perSlotDisorderTriggers: number[]
  /** 各角色归属的乱流触发次数（触发者为风底属性提供者） */
  perSlotTurbulenceTriggers: number[]
  /** 各角色获得的异常/紊乱/乱流喧响奖励（含队友伴随） */
  perSlotBonus: number[]
  /** 异常状态覆盖率分析 */
  coverage: AnomalyCoverageResult
  /** 紊乱伤害详情（无风属性时计算） */
  disorderDamage?: DisorderDamageResult
  /** 乱流伤害详情（有风属性时计算） */
  turbulenceDamage?: TurbulenceDamageResult
  /** 维琳娜风蚀资源明细（有风属性且触发乱流时计算） */
  velinaCorrosionSource?: VelinaCorrosionSource
  /** 标准元素 DOT 伤害明细（灼烧/感电/侵蚀） */
  standardDotDamage?: StandardDotDamageResult
  /** 爱丽丝畏缩 DOT 伤害明细 */
  aliceCoweringDot?: AliceCoweringDotResult
  /** 异常事件明细：把”异常条触发/覆盖触发/动作跟随触发”等事件化展示给开发调试 */
  anomalyEvents: AnomalyEventRecord[]
}

/** 异常事件记录：不是新的伤害公式，只是把当前函数真正算出的事件透明暴露 */
export interface AnomalyEventRecord {
  /** 稳定 id */
  id: string
  /** 事件类型 */
  type: 'anomaly_trigger' | 'disorder' | 'turbulence' | 'special_voidflare' | 'luminize' | 'release' | 'polar_disorder' | 'polar_assault'
  /** 展示名称 */
  label: string
  /** 来源说明：积蓄条、覆盖、动作跟随等 */
  source: string
  /** 事件次数 */
  count: number
  /** 本事件在当前函数中使用的公式 */
  formula: string
  /** 本事件读取的关键字段 */
  fields: string[]
  /** 当前实现限制或归属说明 */
  note?: string
}

// ============ 异常覆盖率 ============

/** 异常状态覆盖率结果 */
export interface AnomalyCoverageResult {
  /** 各元素的总DoT时间（触发次数 × 默认持续时间） */
  perElementDoTTime: Record<string, number>
  /** 全元素总DoT时间 = Σ(触发次数 × 持续时间) */
  totalDoTTime: number
  /** boss无敌时间（用户配置） */
  invincibleTime: number
  /** 有效DoT时间 = 总DoT时间 - boss无敌时间 */
  effectiveDoTTime: number
  /** 总战斗时间 */
  totalTime: number
  /** 综合异常覆盖率 = 有效DoT时间 / 总战斗时间 */
  coverageRate: number
  /** 各元素覆盖率 = 该元素DoT时间 / 总战斗时间 */
  perElementCoverageRate: Record<string, number>
  /** 物理异常（畏缩）覆盖率，用于增幅失衡 */
  physicalCoverageRate: number
  /** 霜寒（冻结+烈霜）覆盖率，用于敌人受到暴击伤害提升 */
  frostCoverageRate: number
  /** 风化实际覆盖率：非风异常只在 (1 - windCoverageRate) 的时间窗内正常生效，其余走乱流 */
  windCoverageRate: number
}

// ============ 紊乱伤害 ============

/** 紊乱倍率公式参数 */
export interface DisorderFormula {
  /** 基础倍率（百分比） */
  baseMultiplier: number
  /** 每tick时间系数（百分比） */
  tickMultiplier: number
  /** tick间隔（秒），用于 floor(T/interval) */
  tickInterval: number
}

/** 单次紊乱伤害详情 */
export interface DisorderDamageDetail {
  /** 被覆盖的异常元素 */
  element: string
  /** 异常施加者 slot */
  applierSlot: number
  /** 触发者 slot */
  triggerSlot: number
  /** 剩余时间 T（秒） */
  remainingTime: number
  /** 紊乱倍率（百分比） */
  disorderMultiplier: number
  /** 异常质量（基础部分：atk × 倍率 × 增伤 × 精通 × 防御[穿透] × 等级） */
  anomalyMass: number
  /** 结算区乘数（减防 × 减抗 × 异常增伤 × 暴击 × 易伤 × 失衡） */
  settlementMultiplier: number
  /** 该元素对应的紊乱事件次数 */
  events: number
  /** 单次紊乱伤害 */
  perEventDamage: number
  /** 最终紊乱伤害（该元素所有紊乱事件合计） */
  damage: number
}

/** 紊乱伤害汇总 */
export interface DisorderDamageResult {
  /** 各次紊乱伤害明细 */
  details: DisorderDamageDetail[]
  /** 总紊乱伤害 */
  totalDamage: number
  /** 紊乱次数 */
  count: number
  /** 平均单次紊乱伤害 */
  avgDamage: number
}

// ============ 爱丽丝畏缩 DOT ============

/** 爱丽丝畏缩 DOT 伤害结果 */
/** 标准元素 DOT 伤害明细（灼烧/感电/侵蚀） */
export interface StandardDotDamageResult {
  /** 各元素 DOT 详情 */
  details: StandardDotDamageDetail[]
  /** 总 DOT 伤害 */
  totalDamage: number
}

export interface StandardDotDamageDetail {
  element: string
  applierSlot: number
  /** 每 tick 倍率（%） */
  tickMultiplier: number
  /** tick 间隔（秒） */
  tickInterval: number
  /** 总 tick 数（按有效时间折算） */
  totalTicks: number
  /** 单 tick 伤害 */
  perTickDamage: number
  /** 总伤害 */
  damage: number
}

export interface AliceCoweringDotResult {
  /** DOT tick 间隔（秒） */
  dotInterval: number
  /** DOT 每 tick 比例（% 强击伤害） */
  dotRatio: number
  /** 强击（物理异常）单次基础伤害 */
  assaultDamagePerTrigger: number
  /** DOT 每 tick 伤害 = assaultDamage × dotRatio% */
  dotDamagePerTick: number
  /** 畏缩 DOT 总 tick 数 = 物理异常覆盖时间 / dotInterval */
  totalTicks: number
  /** 畏缩 DOT 总伤害 = perTick × totalTicks */
  totalDotDamage: number
}

// ============ 乱流伤害 ============

/** 乱流倍率公式参数 */
export interface TurbulenceFormula {
  /** 基础倍率（百分比） */
  baseMultiplier: number
  /** 每tick时间系数（百分比） */
  tickMultiplier: number
  /** tick间隔（秒） */
  tickInterval: number
}

/** 单次乱流伤害详情 */
export interface TurbulenceDamageDetail {
  /** 非风异常元素 */
  element: string
  /** 非风异常施加者 slot */
  applierSlot: number
  /** 本明细包含的乱流事件次数 */
  count: number
  /** 其中吃到风蚀强化的次数 */
  boostedCount?: number
  /** 剩余时间 T（秒） */
  remainingTime: number
  /** 乱流倍率（百分比） */
  turbulenceMultiplier: number
  /** 异常质量（基础部分，来自非风角色） */
  anomalyMass: number
  /** 结算区乘数（维琳娜为触发者） */
  settlementMultiplier: number
  /** 最终乱流伤害 */
  damage: number
}

/** 乱流伤害汇总 */
export interface TurbulenceDamageResult {
  /** 各次乱流伤害明细 */
  details: TurbulenceDamageDetail[]
  /** 总乱流伤害 */
  totalDamage: number
  /** 乱流次数 */
  count: number
  /** 其中吃到风蚀+150%倍率区提升的次数 */
  boostedCount: number
  /** 平均单次乱流伤害 */
  avgDamage: number
}

// ============ 特殊动作喧响奖励 ============

/** 特殊动作喧响奖励配置 */
export interface SpecialActionBonus {
  /** 弹刀（招架支援）次数 */
  parryCount: number
  /** 闪避反击次数 */
  dodgeCounterCount: number
  /** 快速支援次数 */
  quickAssistCount: number
}

/** 特殊动作喧响奖励结果 */
export interface SpecialActionBonusResult {
  /** 弹刀喧响 = parryCount × 215 */
  parry: number
  /** 连携喧响 = chainCount × 10 */
  chain: number
  /** 闪避反击喧响 = dodgeCounterCount × 10 */
  dodgeCounter: number
  /** 快速支援喧响 = quickAssistCount × 20 */
  quickAssist: number
  /** 总计（仅完整奖励，不含伴随重复获得） */
  total: number
  /** 各角色弹刀次数 */
  perSlotParry: number[]
  /** 各角色连携次数 */
  perSlotChain: number[]
  /** 各角色闪避反击次数 */
  perSlotDodgeCounter: number[]
  /** 各角色快速支援次数 */
  perSlotQuickAssist: number[]
  /** 各角色获得的特殊动作喧响（含伴随） */
  perSlotBonus: number[]
}

// ============ 失衡轴 ============

/** 轴内单个动作定义 */
export interface StunAxisAction {
  /** 角色槽位 0/1/2 */
  slot: number
  /** 倍率表 moveId（如 '1401010'）或 'basic'（basic 单位=秒，其余单位=次） */
  moveId: string
  /** 单次轴执行该动作的次数（basic 为秒数） */
  count: number
  /** 自定义显示名（可选，默认从倍率表取） */
  label?: string
  /** 动作开始时间（秒，相对失衡窗口起点）。默认 0，用户拖拽定位。 */
  startTime?: number
  /** 转大变体：仅队友赠送大招块用。'60'=60转大（耗1连携窗口）、'90'=90转大（不耗连携）。缺省=普通大招。 */
  promoteVariant?: '60' | '90'
  /** 来源标记：'gift' = 诺姆膛温换连携（赠送连携，不占目标自身连携次数，吃易伤由块标记）。缺省=普通动作。 */
  sourceTag?: 'gift'
  /** 动作单次时长覆盖（秒）：覆盖倍率表 actionTime。仪玄轴内凝云术专用（蓄力 0-2s 可延长/缩短）。 */
  duration?: number
  // 注：失衡易伤覆盖比例由 startTime + 动作时长 + 窗口时长推导（core/stunAxis.computeInAxisRatio），不在此存储。
}

/** 单轮轴定义 */
export interface StunAxis {
  /** 轴名（如 "轴1"） */
  name: string
  /** 该轴打几次失衡窗口；缺省 = 兜底（吃掉所有剩余窗口）。多条轴时按顺序分配，末条兜底。 */
  count?: number
  /** 轴内动作列表 */
  actions: StunAxisAction[]
  /** 兜底平A角色槽位：资源不足时剩余窗口时间由该角色打平A填充（吃易伤）；缺省不填充 */
  basicFillerSlot?: number
  /**
   * 进窗初始异常状态（BOSS_ENTRY_ANOMALY_OPTIONS 索引，0/缺省=未指定）。
   * 中间态口径（2026-08-24 用户纠正）：每次失衡都是中间态——该声明表示敌方以什么异常状态
   * 进入这段失衡，在该条目首个窗口边界注入状态机（不记紊乱）。随预设导出保留。
   */
  entryAnomaly?: number
  /**
   * 进窗时各元素异常条的进度（key=基础元素，value=第一管百分比 0-100）。**可同时填多个**：
   * 多个角色各攒各的条，两条都接近满时进窗一碰即连续触发打紊乱。随预设导出保留。
   */
  entryBars?: Record<string, number>
  /**
   * 被抑制的异常触发事件 id（`${条目内局部窗序}:${基础元素}:${序数}`）。
   * 满槽保持不触发（施加者后台/CD 无法结算由用户自行判断），编辑器可恢复。随预设导出保留。
   */
  suppressedTriggers?: string[]
}

/** 轴方案命中条件（全部满足才命中） */
export interface StunAxisCondition {
  /** 失衡次数下限（含） */
  stunMin?: number
  /** 失衡次数上限（含） */
  stunMax?: number
  /** 好评（摇人值）下限（含） */
  goodReviewMin?: number
  /** 好评（摇人值）上限（含） */
  goodReviewMax?: number
  /** 闪能（强化特殊技能量）下限（含）；检查 energySlot 指定槽位的总闪能 */
  energyMin?: number
  /** 闪能（强化特殊技能量）上限（含） */
  energyMax?: number
  /** 能量检查的槽位（默认 0 = 主C） */
  energySlot?: number
  /** 命座（影画）下限（含）；检查 cinemaSlot 指定槽位的命座等级 */
  cinemaMin?: number
  /** 命座（影画）上限（含） */
  cinemaMax?: number
  /** 命座检查的槽位（默认 0 = 主C） */
  cinemaSlot?: number
}

/** 窗口自动分配算法名（读取时按此名匹配，不按预设名；新轴文件声明此字段即可复用同一算法） */
export type StunAxisSplitAlgorithm = 'goodReviewOverflow' | 'energyOverflow'

/** 窗口自动分配方案：先全给 base 轴，资源溢出再逐窗升级成 upgrade 轴（鸡兔同笼） */
export interface StunAxisWindowSplit {
  /** 算法名 */
  algorithm: StunAxisSplitAlgorithm
  /** 兜底轴：先全打这个 */
  baseAxis: StunAxis
  /** 升级轴：资源溢出时逐窗升级成这个 */
  upgradeAxis: StunAxis
  /** 兜底轴每窗资源消耗（goodReviewOverflow 缺省自动按 promoteVariant 求和：60转大=60、90转大=90） */
  baseCost?: number
  /** 升级轴每窗资源消耗 */
  upgradeCost?: number
  /** energyOverflow 检查的闪能槽位（默认 0 = 主C） */
  energySlot?: number
}

/** 条件轴方案：一组轴 + 命中条件；解析按顺序取第一个命中项，最后一条建议无条件兜底 */
export interface StunAxisPlan {
  name: string
  /** 命中条件；缺省 = 无条件兜底 */
  when?: StunAxisCondition
  /** 固定轴（与 split 二选一） */
  axes?: StunAxis[]
  /** 按算法名自动分配窗口（与 axes 二选一）；读取时按 split.algorithm 分发 */
  split?: StunAxisWindowSplit
}

/** 轴内单个 (slot, moveId) 的取用分配结果 */
export interface StunAxisAllocation {
  slot: number
  moveId: string
  /** 轴内单位数（次或秒，跨边界按比例折算，可为小数） */
  inAxisUnits: number
  /** 轴外单位数（次或秒） */
  outAxisUnits: number
}

/** 失衡轴计算结果 */
export interface StunAxisResult {
  /** 所有轴内失衡值之和（信息展示：捏轴动作本身产生的失衡值） */
  totalInAxisStun: number
  /** 失衡次数（固定，来自失衡池收敛结果；捏轴不改变它） */
  stunCount: number
  /** 轴总轮数 = Σ axisDetails.times（解析自 axis.count，末条缺省兜底） */
  totalAxisRounds: number
  /** 易伤覆盖率 = 失衡次数 × 窗口时长 / 有效时间（与捏轴无关，固定） */
  stunCoverage: number
  /** 每个 (slot, moveId) 的轴内/轴外取用分配，供伤害池拆分直伤 */
  allocation: Record<string, StunAxisAllocation>
  /** 每轴明细 */
  axisDetails: {
    name: string
    times: number
    axisStun: number
    /** 该轴单轮动作块总时长（秒） */
    axisDuration: number
    actions: {
      actionKey: string
      count: number
      /** 该动作块在窗口内的覆盖比例（0-1，跨边界折算） */
      inAxisRatio: number
      perStun: number
      totalStun: number
      overuse: number
    }[]
    warnings: string[]
  }[]
  /** 全局警告（资源超额 / 窗口数超限） */
  globalWarnings: string[]
}

// 引用 PanelValues
import type { PanelValues } from './catalog'
