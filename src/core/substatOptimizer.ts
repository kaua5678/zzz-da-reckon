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
import { calcPanel } from './panel'
import type { SourcePanelsByOwner } from './buff'
import { getAgentMechanic } from '@/mechanics/registry'

/** 暴击率副词条步长（S 级 +2.4%/步；原 SUBSTAT_POOL.critRate，只剩「百暴」缺口在用） */
const CRIT_RATE_STEP = 2.4

/**
 * 按有效词条数自动计算总步数。
 * 2 词条→32、3 词条→39、4 词条→43，其他→39。
 */
function getDefaultTotalSteps(statsCount: number): number {
  if (statsCount === 2) return 32
  if (statsCount === 3) return 39
  if (statsCount === 4) return 43
  return 39
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
 * 规则：按模板 stats 优先序依次填到上限（statCap），直到总预算耗尽。
 * 暴击特例——「百暴」：填到面板暴击 ≤100% 的最多步数（floor 防溢出，基础暴击越高暴击词条越少），
 * 受 statCap 封顶；不是「够了就不堆」，而是「溢出浪费、不该堆过 100%」。
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
    const steps = Math.min(remaining, target)
    allocation[stat] = steps
    remaining -= steps
  }
  return allocation
}

/** 默认分配输入 */
export interface DefaultSubStatInput {
  agent: Agent
  wEngine: WEngine | undefined
  driveDiscConfig: DriveDiscConfig
  setsMap: Map<string, DriveDiscSet>
  teammateBuffs: TeammateBuff[]
  statRules: StatRules | null
  config: {
    cinemaLevel: number
    wEngineModLevel: number
    sourcePanelsByOwner?: SourcePanelsByOwner
    /** 角色潜能档（1..6），透传给起点面板盖章（CC-174：calcPanel 生产调用点须显式给出）。缺省 = 6。 */
    potentialLevel?: number
    /** 效果覆盖率表（effect id → 0~1），与伤害管线 calcPanel 同口径；缺省 = 全部按 100%（第 194 轮） */
    effectCoverageMap?: Map<string, number>
    enemyWeakness?: readonly string[]
  }
  /** 单词条分配上限（步数）。默认 20。 */
  statCap?: number
  /** 总步数覆盖。0（默认）= 自动按有效词条数（2→32/3→39/4→43）。>0 时强制使用。 */
  totalSteps?: number
}

/** 不含副词条的局内面板（只用于「百暴」缺口：暴击率） */
function computeNoSubstatPanel(input: DefaultSubStatInput): PanelValues {
  const emptySubConfig: DriveDiscConfig = {
    ...input.driveDiscConfig,
    subStatAllocation: {},
  }
  const result = calcPanel(
    input.agent,
    input.wEngine,
    emptySubConfig,
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
  return { ...result.inCombat }
}

/**
 * 角色默认副词条分配：模板 → 无副词条面板暴击率 → computeDefaultSubStats。
 * 调用方：store 配装推荐（全部预设 / zd / 测试 harness 走它）、编排层优化器起点（随后真实伤害精修）。
 */
export function computeDefaultSubStatAllocation(input: DefaultSubStatInput): Record<string, number> {
  const template = getTemplate(input.agent)
  const basePanel = computeNoSubstatPanel(input)
  const statCap = input.statCap ?? 20
  const totalSteps = input.totalSteps && input.totalSteps > 0
    ? input.totalSteps
    : getDefaultTotalSteps(template.stats.length)
  return computeDefaultSubStats(template, basePanel.critRate, totalSteps, statCap)
}
