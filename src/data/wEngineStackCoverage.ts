/**
 * 音擎叠层效果的「整局固定覆盖率」折算（单一事实源）。
 *
 * 背景：catalog 里 stacked 音擎效果的 `defaultStacks = maxStacks`（满层）+ 滑块默认 100%，
 * 等价于「整局满层常驻」——对触发稀疏的角色系统性高估（嵌合编译器在触发少的角色身上
 * +75 精通 vs 实测远低）。引擎此前的口径注释见 core/wengineConditions.ts：散文条件（层数、
 * 后台、特定招式）由覆盖率滑块近似。本模块把「近似」从手调升级为**由资源侧数据自动折算**。
 *
 * @fact wengine:stackedCoverage/折算口径 口径: 有效层数=min(maxStacks,整局能量扣除事件数×每层持续秒/战斗总时长),自动覆盖率=有效层数/maxStacks×100(不写回 state:表只存手调值、手调优先,见 mergeWEngineEffectCoverageAuto);整局固定加成,舍弃密度/相位分布 | 据 用户@2026-10-01 时间加权裁决(纯次数封顶被否:4次×8s在180s局只覆盖18%时间)·复核@2026-10-07(r715 订正:f3771bd1 起自动值不再回填 state) | 验 src/composables/__tests__/wEngineStackCoverage.test.ts | 锚 src/data/wEngineStackCoverage.ts#stacksToCoverage | 信 确认
 * ⟳复核: 新叠层音擎录入时其 effect.id 是否已登记折算器/未登记是否回退满层 | 到期 2026-12-01
 * @fact wengine:stackedCoverage/触发语义 口径: 「发动X时」类叠层的层数=**能量扣除事件次数**——一段持续耗能只算1次扣除事件(无论长按多久),每个固定能量段(爆炸/下砸/追加戳)各算1次;与行数/招式数无关(引擎把多段耗能聚合成整数招,行计数会丢) | 据 用户@2026-10-01 对话裁决·复核@2026-10-07 | 验 src/composables/__tests__/wEngineStackCoverage.test.ts | 锚 src/data/wEngineStackCoverage.ts#STACK_ENERGY_EVENT_EVALUATORS | 信 确认
 * ⟳复核: 新持续型/多段耗能强特角色录入时其扣除段结构是否已建进对应折算器 | 到期 2026-12-01
 *
 * 设计约束：
 * - 折算按 **effect.id 登记折算器**（输入该槽资源侧数据，输出整局能量扣除事件数）。
 *   catalog 的 condition 字段是自由散文（43 条 stacked 效果 20+ 种写法），不可机判。
 * - 折算器按**穿戴角色**分支（同一音擎不同角色的耗能段结构不同）；未登记的角色 ⇒
 *   回退「通用 1 次发动 = 1 事件」（≈ exSpecialCount）；连这也拿不到 ⇒ 回退满层（旧行为）。
 *   这是近似修正不是正确性门槛，漏登记只是回到旧的手调滑块。
 * - 用户手调滑块优先：`wEngineEffectCoverages` 只存手调值，表里已有的键不用自动值（`mergeWEngineEffectCoverageAuto`）。
 */

import type { SkillExecution } from '@/types/resource'

/** 折算器输入：该槽资源侧已收敛的数据（只读，对齐 `CharacterResourceResult` 已有字段）。 */
export interface StackEvalInput {
  /** 穿戴角色 agentId（如 '1221' 柳 / '1171' 柏妮思 / '1181' 格莉丝） */
  agentId: string
  /** 引擎收敛的强特次数（整数招式数，**不是**能量扣除事件数） */
  exSpecialCount: number
  /** 该角色强特链路的执行行（模块自推的行也在这里，按 moveId 匹配） */
  executions: readonly SkillExecution[]
  /**
   * 平A时间（秒）——「**普通攻击命中**」类叠层的触发源（如青衣专武 14125 玉壶青冰·茶劲）。
   * 缺省 = 该效果不按平A折算（只看能量事件的折算器不受影响）。
   */
  basicAttackTime?: number
}

/**
 * 能量扣除事件折算器：返回整局「扣除事件数」（= 叠层次数）。
 * 返回 null = 本折算器不认领（回退通用 / 满层）。
 */
export type StackEnergyEventEvaluator = (input: StackEvalInput) => number | null

/** 从执行行累计某 moveId 的发动次数（模块自推行也走这里）。 */
function execCount(executions: readonly SkillExecution[], moveIds: readonly string[]): number {
  let n = 0
  for (const row of executions) if (moveIds.includes(row.moveId)) n += Math.max(0, row.count)
  return n
}

/**
 * 逐角色折算器注册表：agentId → 折算器。
 * 仅登记嵌合编译器(14118) selfBuff `effect_wiki_214_self_ap` 已核实的角色；其余角色走通用回退。
 *
 * 各角色耗能段结构（实锤来源）：
 * - 柳(1221) `yanagi.ts`：月华流转基础耗能 40 = 首段突刺+下砸打包(1 次扣除)；影画2 每次追加
 *   突刺独立 +10 能量 = 独立 1 次扣除（C6 前 4 次减半为 +5，但**次数**不变）。
 *   ⇒ 事件数 = exSpecialCount × (1 + extraThrusts)。extraThrusts 读 cfg.yanagiExtraThrustCount
 *   （模块按命座+滑块 `yanagi.extraThrustCount` 写入，C0=0 / C2 默认 1 / C6 上限 4）。
 * - 柏妮思(1171) `burnice.ts`：单喷 = 持续段(s1×12.5 一段连续扣=1) + 爆炸(5 一次扣=1) = 2 次/施放；
 *   双喷 = 双手持续(s2×25 一段=1) + 双爆炸(10 一次扣=1) = 2 次/施放（用户裁决：一段持续耗能
 *   只算 1 次扣除事件，无论秒数）。模块发四行 count = 单/双喷施放次数（各 exCount/2）。
 *   ⇒ 事件数 = 2×(单喷数+双喷数) = 2×exSpecialCount。
 * - 格莉丝(1181) `grace.ts`：每次发动(普E 1181005 / 强特 1181006)是一次扣除 ⇒ 事件数 = 发动次数。
 *   模块行已物化（含普E——用户录的手法 a3e1a1e1 循环），直接数行。
 */
const PER_AGENT_EVALUATORS: Record<string, StackEnergyEventEvaluator> = {
  // 月城柳(1221)：基础段(首段突刺+下砸)=1 + 每次追加突刺=1。
  // extraThrusts 从追加突刺行(1221022, count = exCount×extraThrusts)反推，无该行 = 0（C0/未发动）。
  '1221': ({ exSpecialCount, executions }) => {
    const ex = Math.max(0, exSpecialCount)
    if (ex <= 0) return 0
    const thrustRowCount = execCount(executions, ['1221022'])
    const extra = thrustRowCount > 0 ? thrustRowCount / ex : 0
    return ex * (1 + extra)
  },
  // 柏妮思(1171)：单喷 2 次/施放 + 双喷 2 次/施放（行 count = 施放次数）
  '1171': ({ executions }) =>
    2 * execCount(executions, ['1171010', '1171012']), // 持续行 count=施放数（爆炸行同 count，不重复数）
  // 格莉丝(1181)：普E + 强特每次发动 1 次
  '1181': ({ executions }) => execCount(executions, ['1181005', '1181006']),
}

/**
 * 嵌合编译器(14118) 异常精通 25×3层/8s 的折算登记。
 * key = effect.id；value.evaluators = 逐角色折算器（未命中走 generic）。
 */
export const STACK_ENERGY_EVENT_EVALUATORS: Record<string, {
  /** 每层持续秒（散文「每层效果单独结算持续时间」） */
  durationSeconds: number
  /** 逐角色折算器；未登记角色走 generic */
  evaluators: Record<string, StackEnergyEventEvaluator>
  /** 通用回退：无专属折算器的角色 = 每次强特发动 1 次扣除事件（≈ exSpecialCount） */
  generic: StackEnergyEventEvaluator
}> = {
  'effect_wiki_214_self_ap': {
    durationSeconds: 8,
    evaluators: PER_AGENT_EVALUATORS,
    generic: ({ exSpecialCount }) => Math.max(0, exSpecialCount),
  },

}

/** 求某效果在某槽的整局能量扣除事件数（穿戴角色有专属折算器用专属，否则通用）。 */
export function stackEnergyEvents(effectId: string, input: StackEvalInput): number | null {
  const spec = STACK_ENERGY_EVENT_EVALUATORS[effectId]
  if (!spec) return null
  const ev = spec.evaluators[input.agentId] ?? spec.generic
  return ev(input)
}

/** 该效果的每层持续秒（未登记返回 null）。 */
export function stackDurationSeconds(effectId: string): number | null {
  return STACK_ENERGY_EVENT_EVALUATORS[effectId]?.durationSeconds ?? null
}

/**
 * 时间加权折算：整局能量扣除事件数 → 有效层数 → 覆盖率(0-100)。
 * 有效层数 = min(maxStacks, 事件数 × 每层持续秒 / 战斗总时长)。
 * battleSeconds ≤ 0（未跑资源）时回退 null = 不折算（保持默认满层）。
 */
export function stacksToCoverage(
  triggerStacks: number,
  durationSeconds: number,
  battleSeconds: number,
  maxStacks: number,
): number | null {
  if (!(battleSeconds > 0) || !(maxStacks > 0) || !(durationSeconds > 0)) return null
  const effective = Math.min(maxStacks, Math.max(0, triggerStacks) * durationSeconds / battleSeconds)
  return (effective / maxStacks) * 100
}

/**
 * **「每轮失衡」叠层模型**（用户 2026-10-25 逐字）：
 *
 * > 「你折叠成全局不适合击破这种专门在非失衡打伤害的。我们可以这样建模，**每轮失衡都将上场一次**
 * > 并支付 `总平a / 失衡轮次` 的平a数，设为 x，这 x 次平a在第一次叠层前是按照**平均次数 x/2** 获得拐力；
 * > 其他的强特、大招等招式的都算作 **x 次叠层**，算作他平a叠层完毕后进行的击破。这样青衣这种平a次数多的
 * > 每轮能分到30多次平a，前30次只算15层，其他都算满层。像有些击破a的很少甚至不a，x就很低，比如0-10，
 * > 技能吃的层数也是0-5。」
 *
 * ⚠ 不沿用 `stacksToCoverage` 的**整局时间加权**：那个把「不在场的时间」也摊进去，而击破角色的拐力恰恰
 * 用在**非失衡期打失衡**（在场时层数最高）⇒ 全局折叠系统性低估，也与「每轮失衡打一轮」的节奏不符。
 */
/** 平A段平均层数：x 次命中时第 i 次已叠 (i−1) 层 ⇒ 前 min(max,x) 次平均 capped/2；超出封顶的都算满层 */
export function teaBasicPhaseStacks(basicHits: number, maxStacks: number): number {
  const hits = Math.max(0, basicHits)
  if (!(hits > 0) || !(maxStacks > 0)) return 0
  const capped = Math.min(maxStacks, hits)
  return (capped * capped / 2 + (hits - capped) * capped) / hits
}

/** 技能段层数（强特/大招/连携等）：平A叠完才出手 ⇒ min(maxStacks, x) */
export function teaSkillPhaseStacks(basicHits: number, maxStacks: number): number {
  if (!(maxStacks > 0)) return 0
  return Math.min(maxStacks, Math.max(0, basicHits))
}

/** 玉壶青冰(14125) 的自 BUFF 效果 id（catalog `wEngines[14125].effect.selfBuff.effects[0].id`） */
export const TEA_STACK_EFFECT_ID = 'effect_wiki_678_self_impact_tea_full_stack'
/** 玉壶青冰音擎 id */
export const TEA_STACK_ENGINE_ID = '14125'
/** 茶劲满层（原文「最多叠加30层」） */
export const TEA_STACK_MAX = 30
/** 茶劲触发条件（原文「获得[茶劲]时，若层数 ≥15，全队伤害 +20%」） */
export const TEA_STACK_THRESHOLD = 15
/** 玉壶青冰(14125) teamBuff 效果 id（≥15 层 → 全队增伤） */
export const TEA_TEAM_BUFF_EFFECT_ID = 'effect_wiki_678_team_dmg'
/** 茶劲每层持续秒数（原文「持续8秒，每层效果单独结算持续时间」） */
export const TEA_STACK_DURATION = 8
/** 达到 15 层所需的最低命中速率（次/秒）= 15 / 8 */
export const TEA_STACK_MIN_HIT_RATE = TEA_STACK_THRESHOLD / TEA_STACK_DURATION

/**
 * **玉壶青冰 teamBuff（≥15 层 → 全队增伤）的覆盖率（0–1）。
 *
 * 原文：「获得[茶劲]时，若装备者拥有的[茶劲]层数大于等于15层，全队角色造成的伤害提升20%…持续10秒」
 * ⇒ 触发点是「**获得茶劲时**」，即**每次命中都在判定并刷新 10s**，不是每轮失衡只触发一次。
 *
 * 用户口径 2026-10-26：
 * - 「其他角色没这个算法就直接按照一行是一下来算就行」⇒ 命中速率沿用 basicHitRateOf（一行 = 一下）；
 * - 「本来 14125 在别的角色身上就几乎无用，因为你不能叠层，没达到要求啊」⇒ **先判能不能维持 15 层**；
 * - 「青衣对青专的触发次数也不是一轮只有一次吧，而且她达到满层也不会停止平A」
 * - 「扳机对青专应该是全局覆盖的吧，他总是自动攻击保持层数」
 * ⇒ 命中持续且层数稳定 ≥15 的角色（青衣前场连续平A、扳机后台自动攻击）是**持续刷新 ⇒ 100% 覆盖**。
 *
 * 判据（命中速率 R = 命中数 / 平A时间，茶劲每层持续 8s 且单独计时）：
 * - **R × 8 ≥ 15**（即 R ≥ 1.875/s）⇒ 稳定维持 15 层以上 ⇒ 每次命中都刷新 10s ⇒ **覆盖率 100%**；
 * - **R × 8 < 15** ⇒ 层数在 8s 内**永远爬不到 15** ⇒ 本条增益**完全吃不到**（0%）。
 *
 * 为什么不按「轮数 × 10s / 总时长」：那个口径只适用于「每轮失衡刚开始叠层、之后停手」的打法；
 * 而实测角色（青衣 3.76/s、扳机 6.83/s、莱特 5.33/s）命中是连续的，层数不中断，
 * 10s 持续被反复刷新 ⇒ 用轮数算会系统性低估（16.7% vs 实际接近 100%）。
 */export function teaTeamBuffCoverage(input: {
  wEngineId: string
  /** 整局普攻命中个数 */
  basicHits: number
  /** 平A时间（秒）：命中速率 = basicHits / basicAttackTime */
  basicAttackTime: number
}): number {
  if (String(input.wEngineId) !== TEA_STACK_ENGINE_ID) return 0
  const basicTime = Math.max(0, Number(input.basicAttackTime))
  if (!(basicTime > 0)) return 0
  // 命中速率 R：8s 内可叠 R×8 层。R×8 ≥ 15 ⇒ 稳定维持 ⇒ 每次命中刷新 10s ⇒ 全覆盖；否则永远吃不到。
  const hitRate = Math.max(0, Number(input.basicHits)) / basicTime
  return hitRate * TEA_STACK_DURATION >= TEA_STACK_THRESHOLD ? 1 : 0
}

/** 一个 basic 段（倍率表 basic 分类里的一段普攻） */
export interface BasicStageLike { actionTime?: number }

/**
 * **普攻命中速率（次/秒）= 段数 / 连段总时长**，从倍率表 basic 分类读（不写死）。
 * 这是**武器口径**（谁带玉壶青冰都按自己的普攻节奏算），不是某个角色专属。
 */
export function basicHitRateOf(stages: readonly BasicStageLike[]): number {
  let seconds = 0
  let count = 0
  for (const s of stages) {
    const t = Math.max(0, Number(s.actionTime ?? 0))
    if (!(t > 0)) continue
    seconds += t
    count += 1
  }
  return seconds > 0 ? count / seconds : 0
}

/**
 * **玉壶青冰·茶劲的失衡值口径冲击力缩放**（0–1；1 = 满层不缩放）。
 *
 * 用户 2026-10-25 口径：「每轮失衡都将上场一次并支付 `总平a / 失衡轮次` 的平a数，设为 x，
 * 这 x 次平a在第一次叠层前按**平均次数 x/2** 获得拐力；其他强特/大招等算作 **x 次叠层**
 * （平a叠完之后进行的击破）」⇒ 平A段 x/2 层、技能段 x 层，按两段失衡贡献加权取等效层数。
 *
 * ⚠ 这是**武器口径**：任何角色带 14125 都走这里（不限于青衣）。
 * 命中速率取自倍率表（`basicHitRateOf`）⇒ 普攻慢的击破每轮分不到几次平A ⇒ 层数低、≥15 的增伤吃不到。
 *
 * **用户补充口径 2026-10-26**：「莱特也不是每个都是叠层期间打的呀，也有叠完层打的。而且叠完层的
 * 算多数吧，不用刻意算这个少数」⇒ 上式已经自动反映这一点：`teaBasicPhaseStacks` 只在**前 maxStacks 次**
 * 爬层，之后都按满层计。克劳实测莱特每轮 78 次命中 / 30 层封顶 ⇒ 平A段等效 24.23/30 = 81%，
 * 爬层期只占 38% 的命中。**不要再额外乘 0.5**（那会把冲击力砍半，与实战不符）。
 */
export function teaStunImpactScale(input: {
  wEngineId: string
  /** 整局**普攻个数**（执行行 count 之和；原文「[普通攻击]命中敌人时获得1层茶劲」按个数算，不看秒数） */
  basicCount: number
  stunRounds: number
  basicWeight: number
  skillWeight: number
}): number {
  if (String(input.wEngineId) !== TEA_STACK_ENGINE_ID) return 1
  const rounds = Math.max(1, Math.floor(input.stunRounds || 0) || 1)
  const hitsPerCycle = Math.max(0, input.basicCount) / rounds
  const basic = teaBasicPhaseStacks(hitsPerCycle, TEA_STACK_MAX)
  const skill = teaSkillPhaseStacks(hitsPerCycle, TEA_STACK_MAX)
  const wBasic = Math.max(0, input.basicWeight)
  const wSkill = Math.max(0, input.skillWeight)
  const sum = wBasic + wSkill
  const stacks = sum > 0 ? (wBasic * basic + wSkill * skill) / sum : skill
  return Math.max(0, Math.min(1, stacks / TEA_STACK_MAX))
}


/**
 * **该槽整局的「普攻命中个数」**——「普通攻击命中 → +1 层」类叠层（茶劲 / 萎靡）的触发源（单一事实源）。
 *
 * 两条通道各自只覆盖一部分角色，必须**按可验证性**选，不能一律用其中一条：
 * - **物化行计数**：模块把平A拆成显式行（青衣 一煞/醉花 行 count=163）时可信；
 * - **平A时间 × 倍率表命中速率**：模块只留「平A池汇总行」（count=0）时行计数是**测量假象**
 *   （实测莱特 1161：58.28s 平A时间只物化出 10 次终结段命中，按时间×速率应为 90.6 次/局）。
 *
 * 判据 = **带计数的行覆盖了多少平A时间**：≥50% ⇒ 计数通道在跑，用行计数；否则用时间×速率。
 * 实测两端分得很开（青衣 46.94/47.03 = 99.8% vs 莱特 0/58.28 = 0%，莱特的计数行 totalTime=0），
 * 阈值取中间任意值都等价；50% 只是把「一半以上的平A时间有逐次计数」写成可读的名分。
 */
export interface BasicHitSources {
  /** 该槽平A执行行（category === 'basic'）；moveId 用于查压缩倍率块换算 */
  rows: readonly { moveId?: string; count?: number; totalTime?: number }[]
  /** 该槽平A时间（秒，timeAllocation.basicAttackTime） */
  basicAttackTime: number
  /** 倍率表 basic 分类的命中速率（次/秒，basicHitRateOf）；0 = 拿不到倍率表 */
  hitRate: number
}

/**
 * **压缩倍率块**：一行倍率表代表 0.777s 内连续打出的多次命中（用户口径 2026-10-26：「2 段是指倍率表的两段，
 * 这个一行倍率表花了 0.7 秒打的这些倍率，游戏里是多次刺拳……莱特把多次攻击整合成一个大的倍率块，
 * 实际上他的攻击次数也很多」）。
 *
 * ⇒ 这类行的 `count`（倍率块数）**不等于命中次数**，武器叠层（萎靡/茶劲）按命中次数结算，
 *   必须乘一个换算系数。**伤害不用这个系数**——倍率块本身的 729.5% 已是整块总量。
 *
 * 系数推导（用户给的攻略两档，仓库无逐帧数据）：
 *   80 士气 → 25 次刺拳；100 士气 → 31 次刺拳
 *   ⇒ 线性 1 + 0.3×士气；用户视频「80 士气兑现 2 段 ≈1.4 秒」= 2 × 0.777s
 *   ⇒ 25 次 / 2 段 = **12.5 次/段**（每段 0.777s ⇒ 每次刺拳 0.0622s ≈ 60ms）。
 */
export const COMPRESSED_BLOCK_HITS_PER_ROW: Record<string, number> = {
  /** 莱特 1161027 五段连击（连续冲拳）：一行 = 12.5 次命中 */
  '1161027': 12.5,
}

/**
 * @fact wengine:basicHits/计入个数 口径: 普攻命中个数 = 物化行 count 之和（带计数的行覆盖 ≥50% 平A时间时），否则 平A时间×倍率表命中速率；两条都是下界，取较大者 | 据 本任务 2026-10-26（莱特 1161 实测：58.28s 平A 只物化出 10 次命中，行计数是测量假象） | 验 src/composables/__tests__/wEngineStackCoverage.test.ts | 锚 src/data/wEngineStackCoverage.ts#basicHitCountOf | 信 高
 * ⟳复核: 再有「平A只物化终结段」的角色（行 totalTime=0）出现时，确认 50% 阈值仍把两端分开 | 到期 2027-01-31
 */
export function basicHitCountOf(input: BasicHitSources): number {
  let rowHits = 0
  let countedSeconds = 0
  for (const row of input.rows) {
    const n = Math.max(0, Number(row.count ?? 0))
    if (!(n > 0)) continue
    // 压缩倍率块（一行 = 多次命中）：count 是倍率块数，命中数要乘换算系数
    const perRow = COMPRESSED_BLOCK_HITS_PER_ROW[String(row.moveId ?? '')] ?? 1
    rowHits += n * perRow
    countedSeconds += Math.max(0, Number(row.totalTime ?? 0))
  }
  const basicTime = Math.max(0, Number(input.basicAttackTime))
  const timeHits = basicTime * Math.max(0, Number(input.hitRate))
  // 恒取两条通道的较大者：行计数只覆盖「已物化的那部分平A」，未物化的残余由时间×速率兜底，
  // 二者是**互补下界**不是互斥二选一（原实现在覆盖 ≥50% 时只取 rowHits，会漏掉残余平A的命中）。
  return Math.max(rowHits, timeHits)
}

/**
 * **「普通攻击命中 → 目标 +1 层」类长持续叠层**（焰心桂冠 14116·萎靡）的登记表。
 *
 * 原文：「装备者的[普通攻击]命中敌人时，对目标施加一层[萎靡]，最多叠加20层，持续30秒，
 * 重复触发时刷新持续时间；队伍中任意角色攻击命中敌人时，目标每拥有一层[萎靡]，
 * 本次攻击中冰属性伤害和火属性伤害的暴击伤害提升1.5%…」。
 *
 * ⚠ 与茶劲（8s）的区别 = **跨轮续层**：30s 比一次失衡轮次还长，层数不会每轮从 0 爬
 * ⇒ 用「近 durationSeconds 秒内的命中次数」的**滑动窗稳态**，不套 x/2 的爬层模型。
 * 实测莱特（auto-1041-1161-1311，5 窗）两模型给同一个数：滑动窗 15.10 层 vs 爬层+时间加权 15.19 层。
 */
/**
 * @fact wengine:萎靡/稳态层数 口径: 14116 萎靡 = 近 durationSeconds(30s) 内普攻命中次数、封顶 20；覆盖率 = 层数/defaultStacks×100（不是 maxStacks）；不套茶劲 x/2 爬层（30s > 轮长 ⇒ 跨轮续层） | 据 用户裁决@2026-10-26「莱特专武也是类似青衣专武的叠层」+ 原文「持续30秒，重复触发时刷新持续时间」 | 验 src/composables/__tests__/wEngineStackCoverage.test.ts | 锚 src/data/wEngineStackCoverage.ts#BASIC_HIT_STACK_EFFECTS | 信 高
 * ⟳复核: 莱特平A行物化（lighter.ts 拆出真实普攻段）后层数是否仍在 15 层附近；用户若改口径为轮内爬层则同步改模型 | 到期 2027-01-31
 */
export const BASIC_HIT_STACK_EFFECTS: Record<string, { maxStacks: number; durationSeconds: number }> = {
  effect_wiki_951_team_crit_dmg_iceCritDmg: { maxStacks: 20, durationSeconds: 30 },
  effect_wiki_951_team_crit_dmg_fireCritDmg: { maxStacks: 20, durationSeconds: 30 },
}

/**
 * 滑动窗**稳态层数** = 近 durationSeconds 秒内命中的次数（按整局平均命中率摊平，封顶 maxStacks）。
 * battleSeconds ≤ 0（未跑资源）或 maxStacks ≤ 0 ⇒ null = 不折算（保持手调/满层）。
 */
export function basicHitWindowStacks(input: {
  basicHits: number
  battleSeconds: number
  durationSeconds: number
  maxStacks: number
}): number | null {
  const battle = Number(input.battleSeconds)
  const maxStacks = Number(input.maxStacks)
  const duration = Number(input.durationSeconds)
  if (!(battle > 0) || !(maxStacks > 0) || !(duration > 0)) return null
  const hits = Math.max(0, Number(input.basicHits))
  return Math.min(maxStacks, (hits / battle) * duration)
}

/**
 * 覆盖率(0–100) = 稳态层数 / 效果的**默认层数**（resolveEffectValue 里 stacked 走
 * valuePerStack × defaultStacks × coverage ⇒ 覆盖率必须相对 defaultStacks，不是 maxStacks）。
 */
export function basicHitStackCoverage(input: {
  basicHits: number
  battleSeconds: number
  durationSeconds: number
  maxStacks: number
  defaultStacks: number
}): number | null {
  const stacks = basicHitWindowStacks(input)
  const defaultStacks = Number(input.defaultStacks)
  if (stacks == null || !(defaultStacks > 0)) return null
  return Math.max(0, Math.min(100, (stacks / defaultStacks) * 100))
}
