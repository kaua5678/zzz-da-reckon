import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { SkillExecution } from '@/types/resource'
import { getAgentSpec } from '@/specs/registry'
import { buildSpecEventExecutions, specToMechanicModule } from '@/specs/mechanics'
import { computeSpecResources } from '@/specs/resources'
import { effectiveBattleTime } from '@/core/effectiveTime'

/**
 * 猫又（1021）战斗逻辑（用户口供 2026-08-23 两批）：
 * - 呼噜能量全部用于释放[闪避反击：绒爪穿刺](1021019)，两档同一伤害载体：
 *   30 档 = 极限闪避后点按（尾巴失踪术无伤害，价值 = 免费接一次穿刺，净省 10 点）；
 *   40 档 = 长按直接穿刺。失衡内无法极限闪避 → 失衡内只能打 40 档；失衡外一律 30 档。
 *   门控不建模（用户口径：总量不管单发持有限制）——预算直接除以档位单价。
 * - 非轴模式按「失衡内释放占比」滑杆拆分（-1 = 自动按失衡时间覆盖率 teamStunCoverage）；
 *   轴模式按轴内捏的穿刺块精确计 40 档（axisActionCounts），其余预算全打 30 档。
 * - 回复：进场 40 + 接战白送 60 总量 + 终结 20 + 连携 10 + 强特 5 +
 *   攻击数据命中回复（catalog attack_data_0，每次施放；平A聚合行走秒均 × 秒数）。
 * - 永续面板项：猫步诡影 60% 增伤（Lv.7）；C1 猎鸟技巧背后全覆盖无视 16% 物抗；
 *   C2 猫鼠游戏能量获得效率 +25%；潜能夜行习性暴伤按档位（C2-C6 = 20~60%）；
 *   C4 磨爪暴击率 14%（2层×7%，覆盖率滑块）；C6 捕食者血统暴伤 54%（3层满层永续）。
 * - 猫步秀（额外能力）：[强化特殊技]/[闪避反击]命中伤害 +35%×2 层永续 = +70%，
 *   moveId 限定 {1021008 强特, 1021010 闪避反击, 1021019 绒爪穿刺}，按 additionalAbility 门控。
 * - [超凶爪印]：肉球突袭永续 → 每秒自动一次 30% 攻击力物理伤害（后台行 actionTime 0，
 *   不占前台）。CD 自动行（autoSplitByStun 通用机制）：非轴按全局覆盖率吃易伤；
 *   轴模式自动按失衡时间占比拆「失衡内满易伤 / 其余无易伤」，无需手动捏轴。
 */

const NEKOMATA_AGENT_ID = '1021'
const PIERCE_MOVE_ID = '1021019'
const CLAW_MARK_MOVE_ID = 'nekomata_chaoxiong_claw' // 合成 id：倍率表无行，固定 30% 攻击力物理
const COST_DODGE_PATH = 30
const COST_HOLD = 40
/** 猫步秀增伤：35% × 2 层（永续满层） */
export const NEKOMATA_CATSHOW_BONUS = 70
/** 猫步秀作用招式：强化特殊技 / 闪避反击（含绒爪穿刺） */
export const NEKOMATA_CATSHOW_MOVE_IDS = ['1021008', '1021010', '1021019']

const spec = getAgentSpec(NEKOMATA_AGENT_ID)!
const base = specToMechanicModule(spec)

/** 攻击数据回呼噜（catalog attack_data_0，每次施放回复量；0 值/缺失不列） */
const HIT_PURR_GAIN: Record<string, number> = {
  '1021001': 0.5981,
  '1021002': 0.6231,
  '1021003': 0.66,
  '1021004': 1.5398,
  '1021005': 1.0321,
  '1021006': 1.0321,
  '1021007': 0.7878,
  '1021009': 0.292,
  '1021010': 1.5745,
  '1021011': 0.9465,
  '1021013': 0.7873,
  '1021017': 2.187,
}

/** 平A六段（聚合行 basic_attack 的秒均基数）：attack_data_0 × actionTime 加权 */
const BASIC_SEGMENTS: Array<{ moveId: string; actionTime: number }> = [
  { moveId: '1021001', actionTime: 0.171 },
  { moveId: '1021002', actionTime: 0.353 },
  { moveId: '1021003', actionTime: 0.444 },
  { moveId: '1021004', actionTime: 0.987 },
  { moveId: '1021005', actionTime: 0.59 },
  { moveId: '1021006', actionTime: 0.59 },
]

/** 平A秒均呼噜回复（供聚合平A池按秒折算） */
export const NEKOMATA_BASIC_HIT_PURR_PER_SEC = (() => {
  let weighted = 0
  let time = 0
  for (const seg of BASIC_SEGMENTS) {
    weighted += (HIT_PURR_GAIN[seg.moveId] ?? 0) * seg.actionTime
    time += seg.actionTime
  }
  return time > 0 ? weighted / time : 0
})()

export interface NekomataPiercePlan {
  /** 40 档次数（失衡内长按） */
  holdCount: number
  /** 30 档次数（失衡外极限闪避点按） */
  dodgeCount: number
  /** 总穿刺行数（两档同载体） */
  totalCount: number
  /** 呼噜能量总收入（含攻击数据命中回复） */
  budget: number
  /** 实际消耗（≤ 预算，尾数不足一档时剩余） */
  spent: number
}

/** 把呼噜能量预算分配成 40 档（失衡内）/30 档（失衡外）两次数；纯函数便于测试。门控不建模（用户口径）。 */
export function planNekomataPierceCasts(
  budget: number,
  opts: { holdBudgetShare?: number; axisHoldPicks?: number } = {},
): NekomataPiercePlan {
  const total = Math.max(0, Math.floor(budget))
  // 轴模式：轴内捏块精确决定 40 档；否则按占比滑杆（-1=自动覆盖率）折算
  let holdBudget: number
  if (opts.axisHoldPicks != null) {
    holdBudget = Math.max(0, Math.floor(opts.axisHoldPicks)) * COST_HOLD
  } else {
    const share = Math.max(0, Math.min(1, opts.holdBudgetShare ?? 0))
    holdBudget = total * share
  }
  const holdCount = Math.min(Math.floor(holdBudget / COST_HOLD), Math.floor(total / COST_HOLD))
  const restBudget = Math.max(0, total - holdCount * COST_HOLD)
  const dodgeCount = Math.floor(restBudget / COST_DODGE_PATH)
  return {
    holdCount,
    dodgeCount,
    totalCount: holdCount + dodgeCount,
    budget: total,
    spent: holdCount * COST_HOLD + dodgeCount * COST_DODGE_PATH,
  }
}

function planWithMap(
  map: ReturnType<typeof computeSpecResources>,
  cfg: AgentResourceInput['cfg'],
): NekomataPiercePlan {
  const purr = map.get('nekomata_purr')
  // 攻击数据命中回复由 buildExecutions 上一轮写入 cfg（iterate/buildExecutions 分离惯例），随外层环收敛
  const record = cfg as unknown as Record<string, unknown>
  const budget = (purr?.total ?? 0) + Math.max(0, Number(record.nekomataHitPurrGain ?? 0))
  const axisMode = Number(record.axisInSeconds ?? 0) > 0
  const axisPicks = Number((record.axisActionCounts as Record<string, number> | undefined)?.[PIERCE_MOVE_ID] ?? 0)
  const rawSetting = Number(record['setting:nekomata.stunCastShare'] ?? -1)
  const share = Number.isFinite(rawSetting) && rawSetting >= 0 ? rawSetting : Math.max(0, Math.min(1, Number(record.teamStunCoverage ?? 0)))
  const plan = planNekomataPierceCasts(budget, axisMode && axisPicks > 0 ? { axisHoldPicks: axisPicks } : { holdBudgetShare: share })
  // 回写 spendCounts/spendCosts 供资源卡展示（与 spec spendRule id 对齐）
  if (purr) {
    purr.spendCounts['nekomata_pierce_hold'] = plan.holdCount
    purr.spendCounts['nekomata_pierce_dodge'] = plan.dodgeCount
    purr.spendCosts['nekomata_pierce_hold'] = plan.holdCount * COST_HOLD
    purr.spendCosts['nekomata_pierce_dodge'] = plan.dodgeCount * COST_DODGE_PATH
  }
  return plan
}

function planFromCfg(cfg: AgentResourceInput['cfg'], state: AgentResourceInput['state']): NekomataPiercePlan {
  return planWithMap(computeSpecResources(spec, cfg, state), cfg)
}

/** 攻击数据命中呼噜合计：执行行 × attack_data_0；平A聚合行走秒均 × 秒数（纯函数，测试用） */
export function estimateNekomataHitPurrGain(executions: SkillExecution[]): number {
  let hitGain = 0
  for (const exec of executions) {
    if ((exec.count ?? 0) <= 0 && (exec.totalTime ?? 0) <= 0) continue
    if (exec.moveId === 'basic_attack') {
      hitGain += NEKOMATA_BASIC_HIT_PURR_PER_SEC * (exec.totalTime ?? 0)
      continue
    }
    if ((exec.count ?? 0) > 0) hitGain += (HIT_PURR_GAIN[exec.moveId ?? ''] ?? 0) * (exec.count ?? 0)
  }
  return hitGain
}

function buildNekoCharConfig(input: AgentCharConfigInput): void {
  base.buildCharConfig?.(input)
}

function buildNekoResourceResult({ cfg, state }: AgentResourceResultInput) {
  const map = computeSpecResources(spec, cfg, state)
  planWithMap(map, cfg)
  return { specResources: Object.fromEntries(map) }
}

/** 全部永续面板项（猫步诡影 / C1 / C2 / 潜能夜行习性 / C4 / C6）——见文件头口供注释 */
function applyNekoPanel(input: AgentPanelInput): void {
  const { panel, cinemaLevel, settings } = input
  // 核心被动·猫步诡影 Lv.7：[闪避反击]/[快速支援]命中 60% 增伤 → 直接永续
  panel.dmgBonus = (panel.dmgBonus ?? 0) + 60
  if (cinemaLevel >= 1) {
    // 影画1·猎鸟技巧：肉球突袭永续 → 背后命中全覆盖 → 无视 16% 物理抗性
    panel.enemyPhysicalResReduction = (panel.enemyPhysicalResReduction ?? 0) + 16
  }
  if (cinemaLevel >= 2) {
    // 影画2·猫鼠游戏：单敌前场能量获得效率 +25%
    panel.energyGainEfficiency = (panel.energyGainEfficiency ?? 0) + 25
    // 潜能觉醒·夜行习性（潜能 II-VI）：肉球突袭中暴伤 20/30/40/50/60% 永续
    const nightProwl = [20, 30, 40, 50, 60][Math.min(cinemaLevel, 6) - 2]
    if (nightProwl != null) panel.critDmgBonus = (panel.critDmgBonus ?? 0) + nightProwl
  }
  if (cinemaLevel >= 4) {
    // 影画4·磨爪：强特暴击率 7%×2 层 → 默认永续，给覆盖率滑块
    const coverage = Math.max(0, Math.min(1, Number(settings?.['nekomata.c4CritRateCoverage'] ?? 1)))
    panel.critRateBonus = (panel.critRateBonus ?? 0) + 14 * coverage
  }
  if (cinemaLevel >= 6) {
    // 影画6·捕食者血统：连携/终结暴伤 18%×3 层满层永续
    panel.critDmgBonus = (panel.critDmgBonus ?? 0) + 54
  }
}

function buildNekoExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const plan = planFromCfg(cfg, state)
  const counts = {
    'resource:nekomata_purr:nekomata_casts_total': plan.totalCount,
  }
  executions.push(...buildSpecEventExecutions(spec, {
    cfg,
    state,
    counts,
    getRowValue: (moveId, rowId) => rowId === 'damage' ? (cfg.mechanicRowValues?.[moveId] ?? 0) : 0,
  }))

  // [超凶爪印]：肉球突袭永续 → 每秒自动一次 30% 攻击力物理（后台行，不占前台时间）；
  // 按有效战斗时间折算，无敌期间爪印不结算（core/effectiveTime.ts）
  const battleTime = effectiveBattleTime(cfg)
  const clawHits = Math.floor(battleTime)
  if (clawHits > 0) {
    const claw: SkillExecution = {
      moveId: CLAW_MARK_MOVE_ID,
      moveName: '[超凶爪印] 每秒自动（物理）',
      category: 'special',
      count: clawHits,
      actionTime: 0,
      comboAlignRatio: 0,
      totalTime: 0,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      damageMultiplier: 30,
      damageMultiplierOverride: true,
      autoSplitByStun: true,
      skillTableNote: '肉球突袭永续：每 1 秒触发一次 30% 攻击力物理伤害；CD 自动行——非轴按失衡覆盖率吃易伤，轴模式自动按失衡时间占比拆失衡内（满易伤）/轴外',
    }
    executions.push(claw)
  }

  // 攻击数据命中回复：本轮回执行行 × attack_data_0 写回 cfg，供下一轮资源预算收敛
  ;(cfg as unknown as Record<string, unknown>).nekomataHitPurrGain = estimateNekomataHitPurrGain(executions)
}

/** 超凶爪印固定物理元素（合成 id 无倍率表行） */
function resolveNekoExecutionDamage({ exec }: { exec: SkillExecution }): { element: string; source: string } | null {
  if (exec.moveId !== CLAW_MARK_MOVE_ID) return null
  return { element: 'physical', source: CLAW_MARK_MOVE_ID }
}

/** 猫步秀（额外能力门控）：[强化特殊技]/[闪避反击]命中 +35%×2 层 = +70%，限定招式 */
function patchNekoExecutions({ cfg, executions }: AgentResourceInput): void {
  const aaOn = ((cfg.panel as { additionalAbilityActive?: number } | undefined)?.additionalAbilityActive ?? 0) > 0
  if (!aaOn) return
  for (const exec of executions) {
    if (exec.moveId && NEKOMATA_CATSHOW_MOVE_IDS.includes(exec.moveId)) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + NEKOMATA_CATSHOW_BONUS
    }
  }
}

function buildNekoResourceSections(input: AgentResourceSectionsInput) {
  return base.resourceSections?.(input) ?? []
}

export const nekomataMechanic: AgentMechanicModule = {
  id: 'agent:nekomata',
  agentIds: [NEKOMATA_AGENT_ID],
  name: '猫又',
  applyPanel: applyNekoPanel,
  buildCharConfig: buildNekoCharConfig,
  buildResourceResult: buildNekoResourceResult,
  buildExecutions: buildNekoExecutions,
  patchExecutions: patchNekoExecutions,
  resolveExecutionDamage: resolveNekoExecutionDamage,
  resourceSections: buildNekoResourceSections,
  settings: [
    {
      id: 'nekomata.stunCastShare',
      label: '猫又·失衡内释放占比',
      description: '失衡内无法极限闪避只能打 40 档长按，其余全打 30 档（尾巴失踪术+免费穿刺，净省10点）。-1 = 自动按失衡时间覆盖率拆分；0~1 手动覆盖。',
      default: -1,
      min: -1,
      max: 1,
      step: 0.05,
      suffix: '%',
    },
    {
      id: 'nekomata.c4CritRateCoverage',
      label: '猫又·磨爪暴击覆盖率',
      description: '影画4：发动强化特殊技后暴击率 +7%/层 ×2 层（15s），默认按永续满层（100%）计。',
      default: 1,
      min: 0,
      max: 1,
      step: 0.05,
      suffix: '%',
    },
  ],
}
