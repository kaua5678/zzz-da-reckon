/**
 * ZZZ 资源池计算 · 类型定义（按域拆分自原 `src/types/resource.ts`，2026-09-11）
 *
 * 域：单角色资源汇总与角色专属资源（维琳娜 / 爱丽丝等）
 * 消费方一律经 `@/types/resource`（barrel = ./index.ts）引用，勿深链本目录内部文件。
 */

import type { DecibelSource, EnergySource } from './energy'
import type { AnomalyEventExecution, SkillExecution, SpecialResourceSection } from './execution'
import type { TimeAllocation } from './time'

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
  /** 参与锐能账本的终结技次数（锐能额外来源 10/次） */
  ultimateCount: number
  /** 平A伤害秒均（%）＝常态基准 345.21 与铭刻基准 531.88 按铭刻时间占比加权 */
  basicDamagePerSec: number
  /** 平A失衡秒均（%）＝两态基准同法加权 */
  basicDazePerSec: number
  /** 平A残痕积累秒均（%）＝血锻 100/s 与锻星 120/s 同法加权（catalog `gash_buildup` 行） */
  basicGashPerSec: number
  /** 铭刻平A时间占比 0–1（账本推导或面板滑块覆盖） */
  inscriptionBasicTimeShare: number
  /** 占比来源：ledger = 由锐能账本推导（默认）；manual = 面板滑块覆盖 */
  inscriptionBasicTimeShareSource: 'ledger' | 'manual'
  /** 常态锐能产出合计（/s）= 自动累积（接战时间基准）+ 血锻招式增益 */
  normalSharpnessPerSec: number
  /** 锐能基础自动累积（/s，catalog `level60.sharpnessRegen`） */
  sharpnessAutoPerSec: number
  /** 常态血锻四式的锐能招式增益（/s，catalog `sharpness_gain` 列） */
  normalAttackSharpnessPerSec: number
  /** 账本推导出的常态平A时间（秒）＝轮数 × 攒能秒数 */
  normalBasicTimeNeeded: number
  /** 铭刻平A时间（秒）＝轮数 × 窗口时长 */
  inscriptionBasicTime: number
  /** 账本推导出的铭刻平A时间占比（面板未覆盖时的口径，供展示对照） */
  derivedInscriptionTimeShare: number
  /** 平A时间能支撑的进场轮数（常态攒能 → EX 进场 → 铭刻窗口），= EX 发数 */
  inscriptionEntries: number
  /** 全局总延长秒（连携×2s + 停表白送时长）——总额口径一次性加到铭刻总时间 */
  inscriptionWindowSeconds: number
  /** 自动累积的时长基准 = 接战时间（秒，前后台都回；用户口径 2026-09-11） */
  combatTime: number
  /** 单次进场锐能成本（60） */
  sharpnessPerEntry: number
  /** 锐能总量 = 进场 60（勘域 180s 一次）+ 终结技 ×10（单次上限不参与总量口径） */
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
