/**
 * ZZZ 资源池计算 · 类型定义（按域拆分自原 `src/types/resource.ts`，2026-09-11）
 *
 * 域：计算输入与配置（CharacterOperationConfig / ResourceCalcConfig —— 引擎的输入面）
 * 消费方一律经 `@/types/resource`（barrel = ./index.ts）引用，勿深链本目录内部文件。
 */

import type { PanelValues } from '../catalog'
import type { YidhariLoopMove } from './agentResources'
import type { IterationState, StunPlanProjection } from './time'

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
  /**
   * 倍率表 decibel_recovery 按 moveId 预存表（buildCharConfig 从 catalog 全量提取，含行级融合乘子）。
   * 键存在 = 招式在倍率表中找到；值 = getRowValue(move,'decibel_recovery')（无行为 0）。
   * 喧响收入行级化（Σ 切换）后，calcRawDecibelParts 按此表复刻 enrichExecutionPlan 回填语义
   * （显式 0 = 模块禁用、缺省 = 表值、decibelRecoveryOverride = 模块覆盖），保证记账层 == 展示层。
   */
  decibelRecoveryByMoveId?: Record<string, number>
  /**
   * 倍率表 energy_recovery 按 moveId 预存表（与 decibelRecoveryByMoveId 同源同循环，含行级融合乘子）。
   * 键存在 = 招式在倍率表中找到；值 = fusedRowValue ?? getRowValue(move,'energy_recovery')（无行为 0）。
   * 能量收入行级化（Σ 切换）后，calcEnergySource 按此表复刻 enrichExecutionPlan 能量分支回填语义
   * （显式 0 = 模块禁用、缺省 = 表值 || 行值），保证记账层 == 展示层。
   */
  energyRecoveryByMoveId?: Record<string, number>
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
  /** 反制支援（Counter Assist）move id —— 登记见 `src/data/counterAssists.ts`；无该招式 = 空串。
   *  时间/喧响是「一次动作」的融合值（本体 + 专属支援突击，见 data/moveFusions.ts#CLARET_COUNTER_ASSIST）。 */
  counterAssistMoveId?: string
  /** 反制支援 单次 actionTime（融合后含专属支援突击段） */
  counterAssistActionTime?: number
  /** 反制支援 单次喧响回复（融合后含专属支援突击段；**不拿弹刀 215 特殊动作奖励**，用户口径 2026-09-12） */
  counterAssistDecibelRecovery?: number
  /** 反制支援 合轴率 0-1 */
  counterAssistComboAlignRatio?: number
  /** 反制支援次数 = 本次计算由该角色整组化解的控制技组数（boss 预设 `counterAssistGroups` 注入，
   *  非用户手填；0 = 不替换（队内无反制支援角色 / 用户关掉 `boss.counterAssistReplace`））。 */
  counterAssistCount?: number
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
  /** 仪玄·墨影凝云合轴自动填充（反推至保底4失衡，由 useResourceCalc 线程收敛注入；手动输入 >0 时优先） */
  yixuanBackstageAutoCount?: number
  /** 失衡轴内总时间（秒）= Σ窗口数 × 窗口时长（useResourceCalc 轴模式注入；CD 自动动作如仪玄C1落雷/卢西娅追击按此折算次数） */
  axisInSeconds?: number
  /** 星徽·比利失衡轴内捏的动作次数（useResourceCalc 注入，moveId → 总次数，组合块已展开） */
  billyAxisEx?: Record<string, number>
  /** 星徽·比利是否失衡轴模式（useResourceCalc 注入） */
  billyAxisActive?: boolean
  /** 星徽·比利终局整数重推旗标（calcTeamResources 置位：迭代期实数链数 → 终局 floor；最终装配后复位） */
  billyFinalizeChain?: boolean
  /** 星徽·比利链数实数化 opt-in（buildCharConfig 恒置位；外部直调不带 → 整数口径保持历史行为） */
  billyContinuousChain?: boolean
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
  /**
   * **失衡计划值 → 计数**的投影方式（默认 `'off'` = 保持实数，即现行口径）。
   *
   * 背景（2026-09-10 实测，探针 `PROBE_COUNT_FRAC=1`）：外层不动点为让时间账「装得下」把失衡次数
   * 做成实数（非失衡占比缩放 / 超窗口残失衡按残差系数 / 非失衡时间不足时反解），再乘进连携次数
   * ⇒ 终局 **23.5% 的计数槽非整数、其中 91% 是连携**。用户口径：**离散动作的次数应当整数化**，
   * 时间缺口用合轴率/预算宽容，而不是折半次。
   *
   * **语义边界**：只影响「把计划值当次数用」的地方（连携/喧响/能量等计数通道）；
   * 时间账（失衡窗口分配、覆盖率、`stunSeconds`）与不动点迭代**仍用实数**——那里实数才是对的。
   * 实验开关（`configStore` 机制参数 `time.stunPlanProjection`，0=off/1=floor/2=round/3=ceil）。
   */
  stunPlanProjection?: StunPlanProjection
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
   * 轴模式琉音赠大计数（编排层注入，`useResourceCalc` 按轴预设 promoteVariant 块 × 窗口数加权）：
   * 轴内 60/90 转大次数**由轴预设决定**，core 的 `liuyinGiftChainInfo` 通用公式（好评/连携窗口推导）
   * 会算出另一个数——跨层口径统一入口，见 `core/resource.ts#liuyinGiftTime`。
   */
  axisLiuyinPromote?: { targetSlot: number; count: number }
  /**
   * 编排层队长（`configStore.team.length`，含空槽）：**赠行物化口径**解析「上一位队友」用。
   * 引擎只收到已配置角色（`configs.length`），退化配置（单角色扫描）下两者不同——账本/试探口径
   * 仍用 `configs.length`（不改基线），只有行口径对齐编排层，见 `core/resource.ts#giftRowTargetSlot`。
   */
  teamSize?: number
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
  /**
   * 轴模式信号（编排层注入）：**口径**已改为「大招次数 = 槽位喧响总量 `floor(decibel/消耗)`」
   * （用户 2026-09-10 裁决 A「总量为准」，来源 = 自攒 + 赠送；窗口时序不再反推次数）。
   * 本字段只作**轴态判定**（赠行预留/行口径、必要前台封顶豁免等），不再携带次数。
   */
  axisMode?: boolean
  /** 特殊动作喧响奖励（弹刀/闪反/连携/快支，含伴随50%）按槽位注入；参与终结技次数推导 */
  specialActionDecibelBonusPerSlot?: number[]
  /** 异常/紊乱/乱流喧响奖励（含伴随50%）按槽位注入，由上一轮异常池结果回填；参与终结技次数推导 */
  anomalyDecibelBonusPerSlot?: number[]
  /** 3个角色的操作配置 */
  characters: CharacterOperationConfig[]
}
