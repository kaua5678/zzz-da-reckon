/**
 * 副词条默认分配（按角色模板优先序填词条）。
 *
 * CC-186（第 209 轮）：原「套装等效词条 + 融合贪心」打分模型（computeExpectedScore / greedyAllocate /
 * pruneAndRankSets / 拐力 / 套装分解，约 700 行）已退役：
 * - 它的唯一生产入口是 store `optimizer.useDefault=0` 分支，而该设置自引入（5c087473，2026-08-30）起
 *   **从无任何写入点**（无 UI、无导入、无持久化）⇒ 生产中不可达；它写的 `perSlotMarginalGains` 永远为空，
 *   两处展示卡片永远显示「（未计算）」。
 * - 真正「求最优」的路径已是编排层 `composables/substatOptimizer.ts`：本文件的默认分配作起点 → 读真实
 *   `teamTotalDamage` 挪步精修（CC-183/185）。实测起点换成打分式贪心，精修结果零差（§24.32）。
 * 详见 docs/mcp-stun-dual-source.md §24.33。回退点：revert 本卡提交。
 * ⚠ R34：旧 `substatAlloc.ts`（computeRecommendedSubStats）已整文件删除，别按旧指针找它。
 */

import type {
  Agent, WEngine, DriveDiscSet, PanelValues,
  DriveDiscConfig, TeammateBuff, StatRules,
} from '@/types/catalog'
import { calcPanel, type PanelCalcConfig } from './panel'
import { getAgentMechanic } from '@/mechanics/registry'
import type { MechanicTeamMember } from '@/mechanics/types'
import { applyAgentPanelHooks } from './agentPanelPhases'
import type { SourcePanelsBySlot } from './sourcePanels'

/** 暴击率副词条步长：单一来源在 `data/critMultiplier.ts`（乘区溢出转化与百暴预算共用；core 可 import data） */
import { CRIT_RATE_STEP } from '@/data/critMultiplier'

// ============ 副词条预算（设置键 + 缺省值的唯一来源） ============
//
// arena-D 第 361 轮：原先「模板词条数 → 总步数设置键」的三元式在 store 配装推荐、编排层优化器、优化器测试里
// 各抄一份，缺省总步数又单独写在这里的 getDefaultTotalSteps 里，两边分档还不一致（1 词条读 totalSteps2 键、
// 缺省却是 39；≥5 词条读 totalSteps4 键、缺省也是 39）。当前所有模板都是 2–4 词条，不一致不可达，
// 但「一个口径三处手抄」本身就是会漂移的结构。现在键、缺省值、分档放在同一张表里，调用方只传读取器。
// 设置键属于 store 的 mechanicSettings，core 只认字符串、不依赖 store（读取器由调用方注入）。

/** 单词条分配上限（步数）的设置键与缺省值。 */
export const SUBSTAT_CAP_SETTING = 'optimizer.substatCap'
const SUBSTAT_CAP_DEFAULT = 20

/**
 * 副词条「现实性」约束：**最高的两项词条数之和 ≤ 35**（用户 2026-10-26 裁决）。
 *
 * > 「你的词条不能太极端了，最高的两个加起来最好不超过 35，最高词条之前写过不超过 20 比较合理」
 *
 * 为什么必须有（不是洁癖）：一块驱动盘 4 条副词条、每次强化随机落在其中一条上 ⇒ 真实盘不可能
 * 「暴击 20 条 + 暴伤 19 条 + 第三条 0 条」。旧默认分配是「按优先序贪心填满」，39 步的 3 词条模板
 * 恒落成 20 / 19 / 0——这正是用户点名的「20+19 就很超标」。约束落在这里 = 所有走默认分配的
 * 路径（配装推荐「一键应用」/ 编排层优化器起点）同一口径，而不是各局各填一份好看数。
 *
 * 与 `statCap`（单项上限 20，用户 2026-08 口径）的关系：单项上限管「一条能堆多高」，
 * 本条管「两条最高的合计」——两条都顶 20 就是 40，仍然超标。
 */
// @fact substat:现实性约束 口径: 副词条「最高的两项步数之和 ≤ 35」，单项仍受 statCap(20) 约束；默认分配与真实伤害精修都必须满足（精修只能在合法空间里挪步） | 据 用户@2026-10-26「你的词条不能太极端了，最高的两个加起来最好不超过35，最高词条之前写过不超过20比较合理。这个新机制你可以记录一下」 | 验 src/core/__tests__/substatOptimizer.test.ts + src/data/__tests__/buildRecCuratedLoadout.test.ts | 锚 src/core/substatOptimizer.ts#SUBSTAT_TOP2_STEP_CAP | 信 确认
// ⟳复核: 若用户给出更细的词条桶规则（例如「单盘 4 条副词条、每条强化步数」的真实分布）或 TOP2 阈值改口，复核 35 这个数并把默认分配/精修两处一起改 | 到期 2027-04-30
export const SUBSTAT_TOP2_STEP_CAP = 35

/** 写回 `driveDisc.subStatAllocation` 前的硬上限（原 store / 编排层两处各写一个 54，原样保留）。 */
const SUBSTAT_ALLOC_HARD_MAX = 54

/** 总步数分档：模板词条数 ≤ maxStats 落该档；设置值 0 = 用 defaultSteps。 */
const TOTAL_STEP_TIERS: readonly { maxStats: number; setting: string; defaultSteps: number }[] = [
  { maxStats: 2, setting: 'optimizer.totalSteps2', defaultSteps: 32 },
  { maxStats: 3, setting: 'optimizer.totalSteps3', defaultSteps: 39 },
  { maxStats: Infinity, setting: 'optimizer.totalSteps4', defaultSteps: 43 },
]

/** 影响默认分配的全部设置键（store 据此 watch 重算）。 */
export const SUBSTAT_BUDGET_SETTINGS: readonly string[] = [SUBSTAT_CAP_SETTING, ...TOTAL_STEP_TIERS.map(t => t.setting)]

function totalStepTier(statsCount: number) {
  return TOTAL_STEP_TIERS.find(t => statsCount <= t.maxStats)!
}

/** 读取器签名与 store `getMechanicSetting(id, fallback)` 相同。 */
export type SubstatSettingReader = (id: string, fallback: number) => number

/** 按模板词条数解析副词条预算：单词条上限 + 总步数（设置 > 0 用设置，否则按分档缺省）。 */
export function resolveSubstatBudget(
  template: SubstatTemplate,
  readSetting: SubstatSettingReader,
): { statCap: number; totalSteps: number } {
  const tier = totalStepTier(template.stats.length)
  const override = readSetting(tier.setting, 0)
  return {
    statCap: readSetting(SUBSTAT_CAP_SETTING, SUBSTAT_CAP_DEFAULT),
    totalSteps: override > 0 ? override : tier.defaultSteps,
  }
}

/** 写回 store 的规整：只留 n > 0 的键，夹到 [0, 54]。调用方整体替换 `subStatAllocation`。 */
export function normalizeSubstatAllocation(alloc: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [s, n] of Object.entries(alloc)) {
    if (n > 0) out[s] = Math.max(0, Math.min(SUBSTAT_ALLOC_HARD_MAX, n))
  }
  return out
}

// ============ 角色词条模板 ============

/** 词条模板：自动分配的词条范围与优先序 */
export interface SubstatTemplate {
  /** 优先分配的副词条列表（有序：默认分配按此顺序填到上限；精修只在这些词条间挪步） */
  stats: string[]
  /** 暴击率封顶（默认 100）。锋御=200：100% 以上每 1% 是一次「额外锐暴判定」的概率，
   *  锐暴乘算（见 core/damage.ts sharpCritMultiplier，用户口径 2026-09-09）。 */
  critRateCap?: number
}

/**
 * 按 specialty 兜底的默认词条模板。
 * 角色特例由角色模块声明 `substatTemplate`（CC-81），见 getTemplate。
 * CC-186：模板只剩 stats / critRateCap；与兜底相同的模块声明已删除（简 / 蕾米埃尔 / 柏妮思 / 维琳娜 / 爱丽丝 / 月城柳）。
 */
const AGENT_TEMPLATES: Record<string, SubstatTemplate> = {
  _default_dps: { stats: ['critRate', 'critDmg', 'atkPct', 'penFlat'] },
  _default_anomaly: { stats: ['anomalyProficiency', 'atkPct'] },
  _default_support: { stats: ['atkPct', 'hpPct', 'defPct'] }, // 辅助不优化伤害，保生存/面板
  _default_stun: { stats: ['critRate', 'critDmg', 'atkPct', 'penFlat'] },
  _default_defense: { stats: ['hpPct', 'defPct', 'atkPct'] },
  // 命破（rupture）：暴击是乘区（贯穿伤害吃暴击/爆伤），生命是贯穿基底 atk×0.3+hp×0.1 的加法项 → 暴击→爆伤→生命
  _default_rupture: { stats: ['critRate', 'critDmg', 'hpPct'] },
  // 锋御（sharpen）：伤害走引擎 SHARPEN_DAMAGE_PROFILE（basisFormula=def、calcBasisValue=panel.def）
  // → defPct 是**伤害词条**而不是生存词条，不能落 _default_dps 吃 atkPct。首个实例克拉蕾（1611，
  // 锐化伤害/残痕/毁伤全 def 基底）此前落 _default_dps → 自动副词条给攻击力不给防御力（2026-09-09 用户抓到）。
  // 顺序按邦布精灵推荐：暴击率 → 防御力 → 暴击伤害；暴击率封顶 200（锐暴 100% 以上可额外判定，乘算）。
  _default_sharpen: {
    stats: ['critRate', 'defPct', 'critDmg'],
    critRateCap: 200,
  },
}

/** 获取角色的词条模板 */
export function getTemplate(agent: Agent): SubstatTemplate {
  const direct = getAgentMechanic(agent.id)?.substatTemplate
  if (direct) return direct
  const spec = agent.specialty
  if (spec === 'anomaly') return AGENT_TEMPLATES._default_anomaly
  if (spec === 'support') return AGENT_TEMPLATES._default_support
  if (spec === 'stun') return AGENT_TEMPLATES._default_stun
  // 锋御与 damage.ts resolveSpecialDamageProfile 同口径（锐化伤害 def 基底）
  if (spec === 'sharpen') return AGENT_TEMPLATES._default_sharpen
  if (spec === 'defense') return AGENT_TEMPLATES._default_defense
  if (spec === 'rupture') return AGENT_TEMPLATES._default_rupture
  return AGENT_TEMPLATES._default_dps
}

// ============ 默认分配 ============

/**
 * 快速默认副词条分配（用户口径 2026-08：最优队伍词条选择固定）。
 * 规则：按模板 stats 优先序依次填，受三重上限约束，直到总预算耗尽：
 *   ① `statCap` —— 单项上限（缺省 20 步）；
 *   ② 暴击特例「百暴」—— 填到面板暴击封顶（100%，锋御 `critRateCap`=200）的最多步数，
 *      不是「够了就不堆」，而是「溢出浪费、不该堆过」；
 *   ③ `SUBSTAT_TOP2_STEP_CAP`(35) —— **前两项合计**上限（用户 2026-10-26：词条不能太极端）。
 *      第 3 条必须与 ① 一起看：两条都顶 20 = 40 仍然超标，所以第二个词条只能再吃 15 步。
 * 余下的步数顺延给后面的词条（模板第 3/4 位），不浪费。
 * 转模角色的转模源（如卢西娅 hpPct、洛克茜 defPct）在模板 stats 首位，天然吃满。
 * @param baseCritRate 无副词条面板暴击率（用于「百暴」缺口）。
 */
export function computeDefaultSubStats(
  template: SubstatTemplate,
  baseCritRate: number,
  totalSteps: number,
  statCap: number,
): Record<string, number> {
  const allocation: Record<string, number> = {}
  for (const stat of template.stats) allocation[stat] = 0
  let remaining = Math.max(0, totalSteps)
  for (const stat of template.stats) {
    if (remaining <= 0) break
    let target = statCap
    if (stat === 'critRate') {
      // 锋御锐暴封顶 200%（template.critRateCap），其余角色 100%
      const cap = template.critRateCap ?? 100
      const stepsToCap = Math.floor(Math.max(0, cap - baseCritRate) / CRIT_RATE_STEP)
      target = Math.min(statCap, stepsToCap)
    }
    // TOP2：本词条最多吃到「加完之后前两项合计仍 ≤ 35」——不是「剩下的额度」，
    // 第三/第四条只要不超过前两名就不影响合计（旧写法会把它误挡成 0）。
    target = Math.min(target, maxStepsUnderTop2(allocation, stat))
    const steps = Math.min(remaining, Math.max(0, target))
    allocation[stat] = steps
    remaining -= steps
  }
  return allocation
}

/**
 * 把 `stat` 设成 v 之后，前两项最大值之和。
 *
 * 关键：新加的这条只有**进到前二**时才影响合计；比第二名还小就完全不影响
 * （所以第三/第四条能继续吃满，不会被 20+15 的头部锁死）。
 */
function topTwoWith(allocation: Readonly<Record<string, number>>, stat: string, v: number): number {
  const rest = Object.entries(allocation)
    .filter(([k]) => k !== stat)
    .map(([, n]) => n)
    .sort((a, b) => b - a)
  const a1 = rest[0] ?? 0
  const a2 = rest[1] ?? 0
  if (v >= a1) return v + a1
  if (v >= a2) return a1 + v
  return a1 + a2
}

/** `stat` 最多能吃多少步而不破坏 TOP2（不依赖步长，逐 1 步试探；量级 ≤ 20，成本可忽略） */
function maxStepsUnderTop2(allocation: Readonly<Record<string, number>>, stat: string): number {
  let v = 0
  while (topTwoWith(allocation, stat, v + 1) <= SUBSTAT_TOP2_STEP_CAP) v++
  return v
}

/** 已分配两项最大值之和（TOP2 约束的读数；未分配的词条按 0 计） */
export function topTwoOf(allocation: Readonly<Record<string, number>>): number {
  let first = 0
  let second = 0
  for (const v of Object.values(allocation)) {
    if (v > first) { second = first; first = v }
    else if (v > second) second = v
  }
  return first + second
}

/** 分配是否满足 TOP2 约束（refine / 手填校验共用，与 computeDefaultSubStats 同一常量） */
export function fitsTopTwoCap(allocation: Readonly<Record<string, number>>, cap = SUBSTAT_TOP2_STEP_CAP): boolean {
  return topTwoOf(allocation) <= cap
}

/** 默认分配输入 */
export interface DefaultSubStatInput {
  agent: Agent
  wEngine: WEngine | undefined
  driveDiscConfig: DriveDiscConfig
  setsMap: Map<string, DriveDiscSet>
  teammateBuffs: TeammateBuff[]
  statRules: StatRules | null
  config: PanelCalcConfig
  /** 单词条分配上限（步数）。缺省 20。生产调用方用 `resolveSubstatBudget` 求出后传入。 */
  statCap?: number
  /** 总步数。缺省或 0 = 按模板词条数分档（2→32 / 3→39 / ≥4→43，见 TOTAL_STEP_TIERS）。 */
  totalSteps?: number
  /**
   * 角色面板钩子（`applyPanel`）所需的上下文；缺省 = **不派发**（只有 `calcPanel` 的纯 buff 面板）。
   *
   * 为什么必须传（2026-10-18 修「百暴溢出」）：`calcPanel` 只跑 buff 管线，角色模块的
   * `applyPanel`（核心被动/额外能力/影画面板段）与 3/5 命技能等级通用规则在**编排层**才跑。
   * 不派发 ⇒ 「百暴」基线读到的是**没有角色面板**的暴击率，实测 62 角色里 8 个把暴击词条配到溢出
   * （希格莉德基线 19.4% / 真实 85.4%，满 20 步后 133.4%，浪费 13 步）。细节见 `core/agentPanelPhases.ts`。
   *
   * ⚠ 有意**不**在 `computeNoSubstatPanel` 里从 store 反查：core 不依赖 store（调用方组装）。
   * store 的配装推荐传 `teammateBuffs: []`（推荐配装与队友无关的口径），这里同样只补角色自身面板。
   */
  panelHooks?: DefaultSubStatPanelHooks
}

/** 角色面板钩子入参（由调用方从 store 组装；core 只认字段不认 store） */
export interface DefaultSubStatPanelHooks {
  /** 槽位号（`applyPanel` 的 `slot` 字段；`teamPanelEffects` 按它取自己） */
  slot: number
  /** 已解析的机制滑块（`resolveMechanicSettings` 同形）；缺省 `{}` ⇒ 模块内走声明缺省 */
  settings?: Readonly<Record<string, number>>
  /** 额外能力门控（1 = 生效）；缺省 = 由调用方判定的结果，未给则保持 calcPanel 的面板值 */
  additionalAbilityActive?: number
  /** 敌方失衡易伤基础值（叶瞬光帷幕算式的外部输入） */
  enemyStunVuln?: number
  /** 队伍成员快照（`MechanicTeamMember[]`）；缺省 = 只有本槽的空队 */
  team?: readonly MechanicTeamMember[]
  /**
   * 全队各槽的源面板（槽位键控，`core/sourcePanels#SourcePanelsBySlot`）——原样派发给
   * `applyPanel` / `teamPanelEffects`。缺省 undefined = 调用方没建源面板（单测直调），
   * 钩子侧按「读不到就不加」处理，与 `computePanelPhases` 的同一份数据同源。
   */
  sourcePanels?: SourcePanelsBySlot
  /**
   * 是否把**队友给本槽的面板加成**（`teamPanelEffects`）也算进基线。
   * - 编排层优化器（起点要与伤害管线同面板）传 `true`；
   * - store 配装推荐（推荐配装与队友无关的口径）不传 ⇒ 只算角色自身面板。
   */
  withTeamPanelEffects?: boolean
}

/**
 * 按给定副词条分配算局内面板（含角色面板钩子）。
 *
 * 2026-10-26 起带分配参数（原来是「一律空分配」）：**「百暴/贴顶」缺口必须按最终分配读**，
 * 否则漏掉「副词条 → 面板 → 转模 → 暴击」这一环。实测挽昼（1601，核心被动「初始暴伤 ×0.35 =
 * 初始暴击」）：4 条暴伤副词条会经转模再涨 6.7% 暴击，空洞缺口的算法看不到 ⇒ 按 20 步填暴击，
 * 最终 202.0%（越过 200% 锐暴封顶的那 2% 白给），而少填 1 步给防御 = 199.6% 且防御 +48 点、
 * 队伤高 0.8%（46.3948M → 46.7599M，实测见 substatOptimizer.test.ts 的锋御判据）。
 */
function computePanelForAllocation(input: DefaultSubStatInput, alloc: Record<string, number>): PanelValues {
  const subConfig: DriveDiscConfig = {
    ...input.driveDiscConfig,
    subStatAllocation: alloc,
  }
  const result = calcPanel(
    input.agent,
    input.wEngine,
    subConfig,
    input.setsMap,
    input.teammateBuffs,
    input.statRules,
    {
      cinemaLevel: input.config.cinemaLevel,
      wEngineModLevel: input.config.wEngineModLevel,
      potentialLevel: input.config.potentialLevel,
      sourcePanelsByOwner: input.config.sourcePanelsByOwner,
      effectCoverageMap: input.config.effectCoverageMap,
      enemyWeakness: input.config.enemyWeakness,
    },
  )
  const panel: PanelValues = { ...result.inCombat }
  // 角色面板钩子：与 computePanelPhases 的派发顺序一致（门控标记 → applyPanel → 技能等级）。
  // 不传上下文 = 调用方明确要求「纯 buff 面板」（例如只比较套装/音擎差异的夹具）。
  if (input.panelHooks) {
    applyAgentPanelHooks({
      agent: input.agent,
      panel,
      outOfCombatPanel: result.outOfCombat,
      slot: input.panelHooks.slot,
      cinemaLevel: input.config.cinemaLevel,
      potentialLevel: input.config.potentialLevel ?? 6,
      team: input.panelHooks.team ?? [],
      settings: input.panelHooks.settings ?? {},
      sourcePanels: input.panelHooks.sourcePanels,
      additionalAbilityActive: input.panelHooks.additionalAbilityActive,
      enemyStunVuln: input.panelHooks.enemyStunVuln,
      withTeamPanelEffects: input.panelHooks.withTeamPanelEffects,
    })
  }
  return panel
}

/**
 * 角色默认副词条分配：模板 → 无副词条面板暴击率 → computeDefaultSubStats。
 * 调用方：store 配装推荐（全部预设 / zd / 测试 harness 走它）、编排层优化器起点（随后真实伤害精修）。
 */
export function computeDefaultSubStatAllocation(input: DefaultSubStatInput): Record<string, number> {
  const template = getTemplate(input.agent)
  const statCap = input.statCap ?? SUBSTAT_CAP_DEFAULT
  const totalSteps = input.totalSteps && input.totalSteps > 0
    ? input.totalSteps
    : totalStepTier(template.stats.length).defaultSteps
  // 第一遍：按「无副词条」面板算封顶缺口（绝大多数角色一次就收敛）。
  let alloc = computeDefaultSubStats(template, computePanelForAllocation(input, {}).critRate, totalSteps, statCap)
  if (!template.stats.includes('critRate')) return alloc
  // 定点迭代：把**上一轮分配的最终面板**作为读暴击的输入，扣掉暴击副词条自己那部分
  // （computeDefaultSubStats 的 stepsToCap 是按「每步 +CRIT_RATE_STEP」推步数的，不扣就会双计）。
  // 只在「暴击缺口受其他词条影响的角色」（转模/面板加成）上有区别 ⇒ 3 轮足够，不收敛就停在上一步。
  for (let i = 0; i < 3; i++) {
    const finalCrit = computePanelForAllocation(input, alloc).critRate
    const baseCrit = finalCrit - (alloc.critRate ?? 0) * CRIT_RATE_STEP
    const next = computeDefaultSubStats(template, baseCrit, totalSteps, statCap)
    if (JSON.stringify(next) === JSON.stringify(alloc)) break
    alloc = next
  }
  return alloc
}
