/**
 * ZZZ 资源池计算 · 类型定义（按域拆分自原 `src/types/resource.ts`，2026-09-11）
 *
 * 域：计算输入与配置（CharacterOperationConfig / ResourceCalcConfig —— 引擎的输入面）
 * 消费方一律经 `@/types/resource`（barrel = ./index.ts）引用，勿深链本目录内部文件。
 */

import type { PanelValues } from '../catalog'
import type { StunPlanProjection } from './time'

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

/**
 * `CharacterOperationConfig` 上值为数字的键（r408）。供模块声明式字段名（如 `backstageAutoFill.cfgField`）
 * 约束键名：编排层按声明字段动态读写 cfg 时无需 `as any`，字段拼错/未声明在编译期报错。
 */
export type NumericCfgField = {
  [K in keyof CharacterOperationConfig]-?: NonNullable<CharacterOperationConfig[K]> extends number ? K : never
}[keyof CharacterOperationConfig]

export interface CharacterOperationConfig {
  /** 槽位 */
  slot: number
  /** 角色 ID */
  agentId: string
  /** 是否命破角色 */
  isFlashUser: boolean
  /** 面板（来自 panel.ts 的计算结果） */
  panel: PanelValues
  /**
   * 局外面板（未合并局内 buff，只读；CC-129）。供 build 阶段 applyTeamConfig 按队友「初始属性」
   * 做选择（如席德按「初始攻击力最高的强攻队友」选正兵）。与 AgentPanelInput.outOfCombatPanel 同源
   * （同一次 computePanelPhases）。可选：测试直接构造的 cfg 不带它，读者须回退。
   */
  outOfCombatPanel?: Readonly<PanelValues>
  /** 平A秒均回能（能量/闪能，预计算值） */
  basicAttackRegenPerSec: number
  /** 平A秒均喧响（预计算值） */
  basicAttackDecibelPerSec: number
  /** 平A基准段 move id（`getBasicComboMoves`；汇总平A行据此写 `benchmarkMoveId`，CC-193）。缺省 = 汇总行不带基准段（旧行为） */
  basicBenchmarkMoveId?: string
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
  /** 跳过通用强特执行，由机制模块自行生成强特执行（柏妮思等可变耗能强特） */
  skipGenericExSpecial?: boolean
  /**
   * 强特次数按**小数期望值**计（不取整）。只给「按住秒数可变」的持续型强特用：柏妮思（burnice.ts）与
   * sustainedEx 注册表（resourceCalc/helpers.ts buildCharConfig）。缺省 = 取整（真实次数）。
   * CC-324：此前取整与否由 `!skipGenericExSpecial` 隐式决定、再用 exSpecialCountFloor 反向纠正——
   * 接管产行却漏设 floor 的 1181 格莉丝 / 1621 洛克茜被按小数记资源、按整数产行。
   */
  exSpecialCountFractional?: boolean
  /**
   * 通用「单次释放必打招 + 可持续招」强特的预存执行计划（`src/data/sustainedEx.ts` 注册表）。
   * 写入方：resourceCalc/helpers.ts buildCharConfig（倍率已按满蓄秒数缩放）；读取方：core/resource/rowBuild.ts 按次数产行。
   * CC-398 前两边各用 `cfg as unknown as Record` 读写、形状只写在读端 ⇒ 改字段名 tsc 不报；现在是声明契约。
   */
  sustainedEx?: SustainedExPlan
  /** 机制模块引用的倍率表基础值（moveId → 行值），供事件→倍率表映射使用 */
  mechanicRowValues?: Record<string, number>
  /**
   * catalog 招式 actionTime（moveId → 秒，只含 >0）。写入方：helpers.ts buildCharConfig（`moveActionTimesOf(skills)`）；
   * 读取方：角色模块经 `utils/moveActionTimeCfg#cfgMoveActionTime`（CC-409：替代模块内手抄的 `X_ACTION_TIME` 常量）。
   * 可选只为了测试手搭 cfg 不必全填；引擎路径恒有。
   */
  moveActionTimes?: Record<string, number>
  /** 开局赠送能量（普通人40，仪玄120闪能等） */
  initialEnergyGift: number
  /** 开局赠送喧响（默认1000，部分命座额外） */
  initialDecibelGift: number
  /** 不可分享的额外喧响（默认0） */
  extraSelfDecibelReward: number
  /** 每次终结技额外获得的不可分享喧响（如橘福福额外能力对强攻/命破 300/次） */
  extraSelfDecibelPerUltimate?: number
  /**
   * CC-312：模块自报的「视为终结技」额外次数（上一轮收敛值，如仪玄符法千重 / 调息赠送），
   * 与 `ultimateCount` 一起乘 `extraSelfDecibelPerUltimate`。「每次终结技 +N」类规则的提供者
   * （橘福福额外能力）因此不必知道谁有终结技等价物，等价物的拥有者也不必知道谁在发奖励。
   * 写入方须**覆盖**写（幂等）；未写 = 0。
   */
  ultimateEquivalentCount?: number

  // ============ 连续强特通道（引擎通用，模块声明）============
  // 正反馈资源环（强特次数 → 回能 → 强特次数）的通用表达：引擎只认下列字段，
  // 由角色模块在自己的 buildCharConfig / applyTeamConfig 里声明；引擎不读 agentId。
  // 当前唯一声明方 = 1051 `mechanics/agents/yidhari.ts`。
  /** 迭代期强特次数实数参与收敛（阻尼 + 实数 ult 时间信道 + 内层上限 ≥100） */
  exContinuous?: boolean
  /** 终局整数重推期：floor 一次、不阻尼 */
  exFinalize?: boolean
  /** 超出保留/上限部分的每发强特返还闪能 */
  exRefundPerPaid?: number
  /** 次数已知、不返还的强特（条件写形态：只在 `>0` 时写，消费端按 `!== undefined` 选通路） */
  exReservedCount?: number
  /** 上述不返还强特的闪能成本 */
  exReservedEnergyCost?: number
  /** 非保留模式下不返还的强特次数上限（`exRefundFreeCap`） */
  exRefundFreeCap?: number

  /**
   * 帷幕提供者每次终结技给**本槽**的回血（%本槽最大生命值；通用字段，CC-313 由 `yidhariExternalHealPerUltPct` 改名）。
   * 现唯一写入方：卢西娅[星光汇聚之地]（写给全队每槽）；现唯一消费者：伊德海莉烧血→喧响（按提供者终结技次数结算）。
   */
  healPctPerCurtainProviderUlt?: number
  /**
   * 每次帷幕开启/延长给本槽的喧响（通用字段，CC-35c-C 2026-09-27 由 `luciaC4DecibelPerTrigger` 改名）。
   * 引擎按「帷幕触发次数（`curtainTriggers` 能力）× 本值」计入自身喧响。现唯一写入方：卢西娅4命（全队每人 100），未开时为 undefined。
   */
  decibelPerCurtainTrigger?: number
  /** 喧响伴随获得比例（默认0.5，部分角色0.525） */
  decibelShareRatio: number
  /** 辅助大招给队友回能量（如柚叶25，无则0） */
  supportUltimateEnergyRegen: number
  /** 时间分配权重（3个角色的权重比，用于分配平A时间） */
  timeWeight: number
  /** 时间预算收敛：执行计划前台时间超出战斗时间的部分（秒），折入必要前台时间以压缩平A池（引擎时间收敛外层循环写入） */
  timeBudgetExcess?: number
  /**
   * 真实时间压力（秒，引擎折叠循环每轮写入，模块只读）：
   * `本槽物化前台净占用 − (预算 − 无敌时间)` —— **不减队友占用**，正数 = **本槽自己的动作
   * 绝对装不下战斗窗口**。用户裁决 2026-09-25：退化（短轴/砍交互）只在「自己绝对打不完」时
   * 触发——旧口径减了队友账本净占用，队友吃掉前台就把「其实装得下」的队顶过阈值误退化
   * （叶瞬光满命队 auto 退短轴、白丢灭极段伤害 −11% 即此因）。
   * 与 `timeBudgetExcess` 的区别：后者是**累加的折叠残差**（pass0 平A池满额发放时会灌进一个
   * 后续再也不会出现的巨大值，且只增不减），拿它当退化判据会误判——叶瞬光自动选轴曾因此
   * 被人为关掉（`yeshuguang.formAxis` default 0 打满，描述写着「超支信号被虚高，自动会过度退化」）。
   * 需要「时间不够就压结构」的模块（退化短轴/砍交互）一律读本字段，不要读 timeBudgetExcess。
   */
  timePressureSeconds?: number
  /**
   * 行级收入可行上限（秒，**招式行**、不含平A填充；债 2 批 2-1 截断外环回灌，2026-09-19 R37-J2）。
   * 缺省 undefined ⇒ 账本收入按未截断行计（默认路径零分支零写入）。只由 `calcTeamResources` 的重折环在
   * 「初装截断 > 容差」时按上一轮装配的每槽 `kept` 写入，`calcEnergySource` / `calcRawDecibelParts` 经 `feasibleRows`
   * 消费（= 180s 真能兑现的行才进账本）；**返回前恒删除**，不会随 cfg 复用/热启动键泄漏到下一轮。
   * ⚠ 诊断/迭代量（坑 42 / R25-J2 同族）：不读自外部、模块不得写、外部不得当前置条件读。
   */
  rowTimeLimit?: number
  /** 嘲讽取消次数（般岳专属：失衡外强特连段末尾后摇的嘲讽取消，每次取消一次后摇；缺省 0） */
  tauntCancelCount?: number
  /** 资源利用率覆盖：actionId/eventId -> 释放率/上限 */
  resourceUtilization?: Record<string, ResourceUtilizationRule>
  /** 仪玄额外能力：队友释放终结技时回复闪能（2/s×10s=20/次；队伍有击破/支援/防护时生效，iterate 补算） */
  teamUltimateFlashBonus?: number
  /**
   * 定额队友联动能量（CC-32b 2026-09-27，通用）：模块在 applyTeamConfig 里给**落点** cfg 预写「本槽额外获得的
   * 队友联动能量」，键 = 展示键（并入 `CrossAgentEnergy.bySource`）。莱特影画4 士气喷发写 `{ lighterC4Energy }`
   * （原 `lighterC4BurstEnergy`）。多提供者请合并写（`{ ...旧值, 我的键: 量 }`），不要整体覆盖。
   */
  crossAgentFlatEnergyBySource?: Record<string, number>
  /** 全队通用：当前轮失衡时间覆盖率（0-1；编排层按失衡次数×窗口时长/有效时间统一注入，供模块近似拆失衡内外） */
  teamStunCoverage?: number
  /** 全队通用：轴内各 moveId 捏块总次数（块数×窗口数；轴模式由编排层注入，非轴为空对象） */
  axisActionCounts?: Record<string, number>
  /** 全队通用：轴内终结技块总次数（× 窗口数；轴模式注入，非轴 0；希希芙影画2 等消费） */
  axisUltimateTotal?: number
  /** 全队通用：以太帷幕开启总次数（照 veilCount + 爱芮/叶瞬光/千夏开帷幕；爱芮应援能量与叶瞬光溯影惊鸿消费） */
  teamVeilCountTotal?: number
  /** 仪玄·2连墨痕化形次数（主页交互栏；#1+#3，40闪能/次） */
  yixuanInk2Count?: number
  /** 仪玄·3连墨痕化形次数（主页交互栏；#1+#3+#4，60闪能/次） */
  yixuanInk3Count?: number
  /** 仪玄·完美格挡次数（主页交互栏；#2 赠送 + 回10闪能/次） */
  yixuanPerfectBlockCount?: number
  /** 仪玄极限支援换场次数（主页录入；缺省 = 上限） */
  yixuanExtremeAssistCount?: number
  /** 仪玄·墨影凝云合轴次数（后台墨影凝云+霄云劲#5，不占战场时间但有倍率行调用） */
  yixuanBackstageComboCount?: number
  /** 失衡轴内总时间（秒）= Σ窗口数 × 窗口时长（useResourceCalc 轴模式注入；CD 自动动作如仪玄C1落雷/卢西娅追击按此折算次数） */
  axisInSeconds?: number
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
   * 实验开关（`configStore` 机制参数 `time.stunPlanProjection`，0=off/1=floor/2=round/3=ceil/4=physical）。
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
   * 轴内合轴节省按块分摊（`${slot}:${moveId}` → 秒，输入）：失衡窗口内跨角色块并行（般岳强特时琉音抱拳）只计一次前台。
   * 由编排层用栈引擎算好传入（StackTraversalResult.overlapByAction，Σ = overlapSeconds）；iterate 平A池、
   * 折叠循环按行扣减、结果上报共用同一值。团队级总量字段 axisOverlapSeconds 已于 CC-178 删除（按块分摊是唯一表示，要总量就求和）。
   */
  axisOverlapByAction?: Record<string, number>
  /**
   * 轴模式琉音赠大计数（编排层注入，`useResourceCalc` 按轴预设 promoteVariant 块 × 窗口数加权）：
   * 轴内 60/90 转大次数**由轴预设决定**（不是通用公式推导）——这是跨层口径统一入口，
   * 消费方 `core/resource.ts` 的 `frontlineRowsOf`（试探测量）与 `giftTimeOfSlot`（装配侧）。
   *
   * ⚠ 原文提到的 `liuyinGiftChainInfo` **已不存在**（2026-09-13 迁为模块声明式
   * `crossAgentSupply`，见 `core/resource/crossAgentSupply.ts` 头注释）。
   * 且「通用公式会算错」这条**已由阈值结转修正关闭**（2026-09-15）：
   * 通用公式与轴预设声明现在给出同一个开窗数（实测 10大轴 60×4+90×1=5 两侧一致，
   * 修前通用公式算 4），判据 = `liuyin.test.ts`「通用公式 vs 轴预设声明」。
   */
  axisUltimatePromote?: { targetSlot: number; count: number }
  /**
   * 全队必要前台的可行比例（引擎 iterate 每轮写入，装配阶段消费）：
   * `预算 ÷ Σ必要净占用`，<1 = 想打的必做动作装不进战斗时间 ⇒ 执行计划按时间线截断。
   * ⚠ 诊断量副作用（坑 42 / R25-J2）：由引擎计算中途写回 cfg，调用前在新克隆对象上恒为 undefined，
   * 严禁在调用前预读其值作为前置条件判定（全仓零生产读取点）。
   */
  timeFeasibleScale?: number
  /**
   * 合轴溢出（秒，输出）：合轴抵扣后的必做前台净占用超出「战斗时间 − 无敌」的量
   * （iterate 每轮写入；轴模式抵扣与栈引擎节省取 max，不叠加）。
   * ⚠ 诊断量副作用（坑 42 / R25-J2）：计算中途写回 cfg，外部消费者读截断秒数必须读
   * convergence.timeTruncatedSeconds 而不是未收敛的 rr.overflowSeconds。
   */
  overflowSeconds?: number
  /** 失衡次数输入（连携次数 = chainCountPerStun × stunCount）；由外部失衡池不动点收敛后回填 */
  stunCount?: number
  /**
   * 上一外层轮失衡池的**物理次数**（`threads.prevPoolStunCount`，floor(N*)）；只在
   * `stunPlanProjection = 'physical'` 时被计数通道读取（CC-140，docs/mcp-stun-dual-source.md §5）。首轮缺省。
   */
  stunCountPhysical?: number
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
  /**
   * 动态合轴吸收上限（0..1；用户口径 2026-09-19 v3「默认队友的 40% 可以被吸收，超过了就无力合轴」）：
   * 非操作角色的吸收容量 = 本值 × 其净必要前台。缺省 `DEFAULT_COMBO_ALIGN_ABSORB_RATIO`（0.4）；0 = 不吸收。
   * 编排层从机制参数 `time.comboAlignAbsorbRatio` 注入；难度阶梯的「全关」置 0、G5 分档推进到用户上限。
   */
  comboAlignAbsorbRatio?: number
  /** 特殊动作喧响奖励（弹刀/闪反/连携/快支，含伴随50%）按槽位注入；参与终结技次数推导 */
  specialActionDecibelBonusPerSlot?: number[]
  /**
   * **手动锁定交互**（编排层注入；配装页「手动锁定交互」勾选框，用户口径 2026-10-06）：
   * 「用户选择交互次数已经确定了交互这一块的难度设置，就可以尽量满足，自动调整合轴率和其他内容来做到。
   *  实在做不到就说哪里做不到。用户没选择交互，就自动计算低交互与高交互，也就是难度曲线的计算了」。
   *
   * **语义**：`true` ⇒ 用户在交互栏填的次数（弹刀/闪避反击/格挡/双反）是**用户明确意图**，
   * `stageResolveFeasibility` 的**非轴降配整块不执行**——不缩交互、不改结构，装不下时保留基线态、
   * 由 `resourceResult.overflowSeconds` / `convergence.truncationBySlot` **如实上报截断**
   * （`convergence.interactionScale` 保持 `undefined`）。
   * `false`/缺省 ⇒ 普通路径**逐位不变**：超预算照旧自动降配缩交互，服务难度曲线。
   *
   * **为什么是独立开关而不是用数值推断**：降配触发是
   * 「超预算」这一运行期事实的函数，`scale = 1` 既可能是「用户锁定」也可能是「恰好装得下」
   * ——从结果反推会把「没触发降配」误判成「已锁定」。显式开关让「用户意图」与「引擎判定」可区分，
   * 且缺省 `false` ⇒ 既有路径零影响。
   *
   * **同款先例**：锁失衡次数（`enemy.stunCountLock ≥ 0`）在 `resourceCalc/solveTeam.ts` 里
   * 一律不触发退化/降配、超时如实上报——本字段是同一原则补到交互次数上。
   *
   * ⚠ **锁定 ≠ 不做自动调整**：合轴吸收（G5 / `comboAlignAbsorbRatio`）在 `core/resource/helpers.ts#iterate`
   * 内部，**本来就在降配之前**生效 ⇒ 锁定后它自然先跑（把队友前台按溢出量并行吸收），
   * 只有吸收不完的剩余才成为截断。故本字段不新增任何「先提高合轴率」的调用。
   * ⚠ 本字段只管**要不要降配**（整块跳过），不改降配内部的选档策略（`resourceCalc/feasibilitySearch.ts`）。
   */
  interactionsLocked?: boolean
  /** 异常/紊乱/乱流喧响奖励（含伴随50%）按槽位注入，由上一轮异常池结果回填；参与终结技次数推导 */
  anomalyDecibelBonusPerSlot?: number[]
  /** 3个角色的操作配置 */
  characters: CharacterOperationConfig[]
}

/** 持续型强特的一段（起手 / 收尾）：招式 id + 该段占用的动作时间（能力场 / 自动攻击段记 0） */
export interface SustainedExSegment {
  moveId: string
  actionTime: number
}

/** 持续型强特执行计划（见 `CharacterOperationConfig.sustainedEx`） */
export interface SustainedExPlan {
  opener: SustainedExSegment[]
  sustain: {
    moveId: string
    /** 持续段满蓄秒数 */
    actionTime: number
    damageMultiplier: number
    dazeMultiplier: number
    anomalyBuildUp: number
  }
  finisher: SustainedExSegment[]
}
