/**
 * ZZZ 资源池计算 · 类型定义（按域拆分自原 `src/types/resource.ts`，2026-09-11）
 *
 * 域：招式执行计划（SkillExecution 及其派生）
 * 消费方一律经 `@/types/resource`（barrel = ./index.ts）引用，勿深链本目录内部文件。
 */

import type { SkillDamageTarget } from '@/types/catalog'

// ============ 招式执行计划 ============

/** 单个招式的执行记录 */
/** 合轴率的来源（CC-453，T18 阶段 2）：
 *  'setting' = 用户覆盖 ?? 倍率表默认（`configStore.getComboAlignOverride`，键 = 本行 moveId；结果页「合轴率调节」可改）；
 *  'fixed'   = 行作者直写（引擎常量行 / 角色模块行 / 赠行 / 跟随别的招式比例的衍生行），按本行 moveId 写覆盖不生效 ⇒ 弹窗只读。
 *  类型上可选只为不扫 ~90 处模块字面量；`buildExecutions` 出口统一补 'fixed'，赠行在 `buildGiftRow` 打，
 *  所以引擎产出的行恒有值（锁 core/__tests__/comboAlignSourceCc453.test.ts）；展示层按「≠ 'setting' 即只读」读，缺省安全。 */
export type ComboAlignSource = 'setting' | 'fixed'
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
  /**
   * 总时间 = count × actionTime（秒）。**≥ 0 由生产方保证**：截断按比例缩，从平A行扣时间的模块在源头钳到 0；
   * 消费方（`frontlineRowSeconds` 等）直接相加，不再各自钳（r738：插桩跑全套测试 + 零差矩阵，没有负行）。
   */
  totalTime: number
  /** 总合轴时间 = count × actionTime × comboAlignRatio */
  totalComboAlignTime: number
  /** 合轴率来源，见 `ComboAlignSource`；引擎产出行恒有值 */
  comboAlignSource?: ComboAlignSource
  /** 能量消耗（每次，正数表示消耗） */
  energyConsume: number
  /** 总能量消耗 */
  totalEnergyConsume: number
  /** 喧响回复（每次）；未提供时由 enrichExecutionPlan 按倍率表回填（显式 0 = 模块禁用回填） */
  decibelRecovery?: number
  /** 总喧响回复 */
  totalDecibelRecovery?: number
  /** 能量回复（每次）；未提供时由 enrichExecutionPlan 按倍率表回填（显式 0 = 模块禁用回填，与喧响同构三态） */
  energyRecovery?: number
  /** 总能量回复 */
  totalEnergyRecovery?: number
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
  /** 仅汇总平A行（moveId = 'basic_attack'）：该行按哪一段普攻的秒均倍率结算（`getBasicComboMoves`，CC-193）。
   *  模块按 moveId 集合匹配普攻段时经 `execMatchesMove` 读它——汇总行本身的 moveId 永远是 'basic_attack'。 */
  benchmarkMoveId?: string
  /** 倍率表回填说明 */
  skillTableNote?: string
  /** 由机制模块直接覆盖伤害倍率（跳过倍率表回填） */
  damageMultiplierOverride?: boolean
  /** 由机制模块直接覆盖失衡倍率（跳过倍率表回填；如诺姆 C6 破甲弹头失衡值+30%） */
  dazeMultiplierOverride?: boolean
  /** 由机制模块直接覆盖异常积蓄（跳过倍率表回填；如持续段按时长等比缩放后的积蓄） */
  anomalyBuildUpOverride?: boolean
  /** 由机制模块直接覆盖喧响回复（跳过倍率表回填；如洛克茜自旋——表值为每秒口径，行值 = 每秒 × 持续秒数） */
  decibelRecoveryOverride?: boolean
  /** 本行招式专属暴击率加成（%），只加给该行（如青衣1命满电压醉花月云转、柏妮思4命） */
  critRateBonus?: number
  /** 本行招式专属暴击伤害加成（%），只加给该行（如青衣6命醉花月云转暴伤+100%） */
  critDmgBonus?: number
  /** 招式类型定向（如 'exSpecial'），用于技能专属 buff（增伤/暴伤等）匹配。r408 起收窄为 SkillDamageTarget（原 string 经行接口 any 静默流入 core/damage） */
  skillDamageTarget?: SkillDamageTarget
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
  /** 赠送的连携行标记（引擎赠链供给产出，招式取上一位队友技能表；当前唯一来源 = 诺姆膛温换连携）。
   *  失衡捏轴下吃易伤的次数由提供者槽的 'norma-hat-chain' 轴内块决定（见 useResourceCalc；轴块 id 是数据标识，不随字段改名）。
   *  2026-09-26 CC-15：原名 normaGiftChain。 */
  chainGift?: boolean
  /** CD 驱动的后台自动行（如猫又超凶爪印每秒 dot）：轴模式不按捏轴认领、不进轴编辑器放置语义，
   *  改按失衡时间占比拆「占比内吃满易伤 / 其余无易伤」（非轴模式本就按全局覆盖率，不受影响） */
  autoSplitByStun?: boolean
  /** 仅失衡段生效的增伤%（CC-33a 2026-09-27，原名 `harumasaStunOnly`）：轴模式下模块把「失衡专属 buff」写在行上，
   *  伤害池按段直加（轴内段 stunOverride>0 才加、轴外段不加）；字段存在即表示「本行有失衡专属部分」。
   *  当前唯一写入方 = 悠真额外能力（`harumasa.ts` patchExecutions，只在轴模式写）。 */
  stunOnlyDmgBonus?: number
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

/** 前台求和只读这两个字段（`SkillExecution` 结构兼容；测试可只给这两个字段） */
export type FrontlineRow = Pick<SkillExecution, 'totalTime' | 'timeBucket'>

/**
 * 前台行总时长（秒）= Σ 前台行 `totalTime`（r738 单一实现）：展示时间分配（`normalizeDisplayTime`）、
 * 装配时间账（`assembleSlot`）、折叠环行测量（`foldLoop`）、单槽净占用与占用拆解（`timeOccupation.ts`）都调它。
 * 行时长 ≥ 0 由生产方保证（见 `SkillExecution.totalTime`），这里直接相加、不钳。
 * `from`：接着已有累加值往下加——占用拆解跨槽累加毛前台时用，保持逐行累加顺序，结果逐位不变。
 */
export function frontlineRowSeconds(rows: ReadonlyArray<FrontlineRow>, from = 0): number {
  let t = from
  for (const e of rows) if (isFrontlineExecution(e)) t += e.totalTime
  return t
}

/**
 * 执行行是否命中给定招式集合（CC-193）。普攻恒为一条汇总行（moveId = 'basic_attack'，按基准段秒均结算），
 * 模块按普攻段 moveId 匹配时直接 `set.has(exec.moveId)` 永远碰不到它（第 216 轮普查：安东打桩/C6、振斗耗血暴伤因此恒不生效）。
 * 本函数把汇总行按其 `benchmarkMoveId` 参与匹配：基准段在集合里 ⇒ 整条平A行视为该段。
 */
/**
 * 执行行里汇总平A行（`moveId: 'basic_attack'`）的总时长（秒）——CC-195。
 * 与 `data/moveTableQueries#basicComboCycleSeconds` 配对，把「平A时长」折算成某普攻段的命中次数。
 */
export function basicSummarySeconds(executions: readonly { moveId?: string; totalTime?: number }[]): number {
  let t = 0
  for (const e of executions) if (e.moveId === 'basic_attack') t += e.totalTime ?? 0
  return t
}

export function execMatchesMove(e: { moveId: string; benchmarkMoveId?: string }, ids: ReadonlySet<string>): boolean {
  if (ids.has(e.moveId)) return true
  return e.moveId === 'basic_attack' && !!e.benchmarkMoveId && ids.has(e.benchmarkMoveId)
}

/**
 * 装配期时间线截断的**逐行**明细（`truncateExecutionsToFrontline` 产出 → 汇总进
 * `TeamResourceResult.truncationCuts`）：这一行原本要打 `countBefore` 次、180s 里只留 `countAfter` 次，
 * 砍掉的秒数与随之作废的行级回能/喧响。
 *
 * 为什么要有它（用户 2026-09-11 三问）：截断此前只报**总量**（`overflowSeconds`），于是
 * ① 资源池看不到「砍了哪些招」；② 难度轴的交互次数仍按 config 全量计；③ 「被砍招式的回能还在账本里」
 * 只能靠人肉推断。逐行明细是这三件事的共同输入（也是 A 项「截断回灌资源循环」的输入）。
 */
export interface TruncationCut {
  slot: number
  moveId: string
  moveName: string
  /** 截断前想打的次数 */
  countBefore: number
  /** 180s 里实际保留的次数 */
  countAfter: number
  cutSeconds: number
  /** 砍掉部分作废的行级能量回复（按 totalEnergyRecovery 同比例） */
  cutEnergyRecovery: number
  /** 砍掉部分作废的行级喧响回复 */
  cutDecibelRecovery: number
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
    /**
     * 预先确定的 basis 取值（CC-125）：原文写「每 N 点**初始** X」时，由模块在 buildCharConfig 阶段
     * 用局外面板（`AgentCharConfigInput.outOfCombatPanel`）算好写入；缺省 = 读触发者局内面板 `[basis]`。
     */
    basisValue?: number
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
    /** 预先确定的掌控取值（CC-125，原文「初始异常掌控」⇒ 局外面板）；缺省 = 读结算面板局内掌控 */
    masteryValue?: number
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

/** 动作完成后的积蓄槽快照（用户口径：每个动作块末尾显示对应积蓄槽状态）；由 core/stunAxis/inStunAnomaly.ts 产出 */
export interface InStunGaugeSnapshot {
  windowIndex: number
  /** 原始动作索引（InStunAction.srcIndex 回传） */
  srcIndex?: number
  /** 各元素槽占第一管百分比（0-100，超满截断到 100） */
  pct: Record<string, number>
}

export interface InStunAnomalySummary {
  windows: number
  elements: InStunAnomalyElementState[]
  /** 展开后的每个窗口属于哪条轴条目（索引对齐窗口序）——捏轴页按条目标注触发事件用 */
  windowEntryIdx?: number[]
  /** 触发来源明细（动作带 moveId 时回填，id=抑制引用键）：捏轴页块级「这个招式触发了什么」可视化用 */
  triggerSources?: Array<{ windowIndex: number; moveId: string; element: string; offsetSeconds: number; id: string; srcIndex?: number }>
  /**
   * 每个动作块末尾的积蓄槽快照（捏轴页块级「条XX%」标注用）。
   * CC-398：2026-08-24 起 core 已产出、页面已读取，但编排层从未透传——页面用 `as unknown as` 读，tsc 看不见，
   * 该标注因此静默死了 40 天。现在是显式契约：core 产出 → 这里声明 → convergence 透传 → 页面直接读。
   */
  gaugeSnapshots?: InStunGaugeSnapshot[]
  note: string
}

/** 专属资源展示段的一行明细 */
export interface SpecialResourceRow {
  label: string
  value: string
  detail?: string
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
  rows: SpecialResourceRow[]
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
