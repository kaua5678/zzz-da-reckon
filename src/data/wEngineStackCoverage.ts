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

/** 一行执行行在「每轮失衡」口径下的权重来源（只需与失衡值成正比、与 impact 无关的量） */
export interface TeaStackRowWeight {
  count: number
  /** 该行基础失衡倍率（impact 之外的部分） */
  baseDaze: number
  isBasicAttack: boolean
}

/**
 * 等效层数 = 按**失衡贡献**（次数 × 基础失衡倍率）加权平均两段层数。
 * 失衡值对 impact 线性 ⇒ 用「平均 impact」与逐行叠层等价，不必逐行改面板。
 */
export function teaEffectiveStacks(input: {
  basicHitsPerCycle: number
  maxStacks: number
  rows: readonly TeaStackRowWeight[]
}): number {
  const maxStacks = Math.max(0, input.maxStacks)
  const basic = teaBasicPhaseStacks(input.basicHitsPerCycle, maxStacks)
  const skill = teaSkillPhaseStacks(input.basicHitsPerCycle, maxStacks)
  let weight = 0
  let weighted = 0
  for (const row of input.rows) {
    const w = Math.max(0, row.count) * Math.max(0, row.baseDaze)
    if (!(w > 0)) continue
    weight += w
    weighted += w * (row.isBasicAttack ? basic : skill)
  }
  return weight > 0 ? weighted / weight : skill
}


/** 玉壶青冰(14125) 的自 BUFF 效果 id（catalog `wEngines[14125].effect.selfBuff.effects[0].id`） */
export const TEA_STACK_EFFECT_ID = 'effect_wiki_678_self_impact_tea_full_stack'
/** 玉壶青冰音擎 id */
export const TEA_STACK_ENGINE_ID = '14125'
/** 茶劲满层（原文「最多叠加30层」） */
export const TEA_STACK_MAX = 30
/** 茶劲触发条件（原文「获得[茶劲]时，若层数 ≥15，全队伤害 +20%」） */
export const TEA_STACK_THRESHOLD = 15

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
 */
export function teaStunImpactScale(input: {
  wEngineId: string
  /** 整局**普攻个数**（执行行 count 之和；原文「[普通攻击]命中敌人时获得1层茶劲」按个数算，不看秒数） */
  basicCount: number
  stunRounds: number
  basicWeight: number
  skillWeight: number
}): number {
  if (String(input.wEngineId ?? '') !== TEA_STACK_ENGINE_ID) return 1
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

