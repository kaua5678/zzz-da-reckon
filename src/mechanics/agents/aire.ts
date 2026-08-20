/**
 * 爱芮（1501）—— 异常精通、无视抗性/防御与进场喧响整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1501.json，按核心被动 Lv.7。
 * - 核心被动控场核心：异常精通提升90点计入面板（同时抬升她的异常伤害/异放基底）。
 * - 影画1 元气声浪：普攻/特殊技/强特无视10%以太异常积蓄抗性计入面板
 *   enemyEtherAnomalyResReduction（异放暴击部分属异常结算区，未建模）。
 * - 影画2 梦幻节拍：攻击与异放无视16%防御计入面板 enemyDefReduction；
 *   妄想时刻内额外无视8%按覆盖率折算。
 * - 影画6 构造体之梦：进场喧响+1200计入 initialDecibelGift（180秒一次整局近似）。
 * - 额外能力合作舞台：击破/支援/同阵营/异常队友激活；侵蚀持续+3秒沿用 spec teamBuffs。
 *
 * 明确未建模（异常结算区/状态机）：
 * - 影画1 异放暴击（基础25%、暴伤25%、掌控>100每点+0.5%暴击率）。
 * - 影画4 异放触发回4能量+70喧响（10秒一次）。
 * - 影画6 妄想时刻不退出、强化绝对音准/终结技以太伤害+40%、全场应援/应援能量转化。
 * 核心异放已建模：第三段绝对音准 #3 命中异常目标 → release 事件（dominant 元素按覆盖率分配），
 * 倍率 = 原异常单次/单跳倍率 × (初始掌控/10 × 元素比例%) × (失衡?1.5:1)，结算区=爱芮。
 */
import type {
  AgentCharConfigInput,
  AgentEventInput,
  AgentMechanicModule,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
} from '../types'

export const AIRE_ID = '1501'
export const AIRE_CORE_PROFICIENCY = 90
export const AIRE_C1_ETHER_ANOMALY_RES_IGNORE = 10
export const AIRE_C2_DEF_IGNORE = 16
export const AIRE_C2_DELUSION_DEF_IGNORE = 8
export const AIRE_C6_DECIBEL_GIFT = 1200
/** 第三段[普通攻击：绝对音准 #3] 的 moveId（异放载体） */
export const AIRE_ABSOLUTE_PITCH_MOVE_ID = '1501007'
/** 核心被动 Lv.7：每 10 点初始异常掌控 → 各元素异放比例（%） */
export const AIRE_RELEASE_RATIO_PER_TEN: Record<string, number> = {
  ether: 27.5,
  electric: 14.3,
  fire: 35.7,
  physical: 2.5,
  ice: 3.6,
  wind: 1.4,
}
/** 目标失衡时，异放比例额外提升 50% */
export const AIRE_RELEASE_STUN_BONUS_PCT = 50
/** 妄想时刻（终极技 buff）单次持续时间（秒），用于估算强化版绝对音准占比 */
export const AIRE_DELUSION_DURATION = 15

export interface AireCycle {
  cinemaLevel: number
  additionalActive: boolean
  coreProficiency: number
  c1EtherAnomalyResIgnore: number
  c2DefIgnore: number
  c6DecibelGift: number
  note: string
}

function setting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const value = Number((cfg as unknown as Record<string, unknown>)[`setting:${id}`])
  return Number.isFinite(value) ? value : fallback
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function whole(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))
}

export function computeAireCycle(input: {
  cinemaLevel: number
  additionalActive: boolean
  c2DelusionCoverage: number
}): AireCycle {
  const cinemaLevel = whole(input.cinemaLevel)
  const c2DelusionCoverage = clampRatio(input.c2DelusionCoverage)
  return {
    cinemaLevel,
    additionalActive: input.additionalActive,
    coreProficiency: AIRE_CORE_PROFICIENCY,
    c1EtherAnomalyResIgnore: cinemaLevel >= 1 ? AIRE_C1_ETHER_ANOMALY_RES_IGNORE : 0,
    c2DefIgnore: cinemaLevel >= 2
      ? AIRE_C2_DEF_IGNORE + AIRE_C2_DELUSION_DEF_IGNORE * c2DelusionCoverage
      : 0,
    c6DecibelGift: cinemaLevel >= 6 ? AIRE_C6_DECIBEL_GIFT : 0,
    note: '异放精通比例结算、异放暴击、妄想时刻与应援能量转化属异常结算区/状态机，未建模。',
  }
}

function buildAireCharConfig({ cinemaLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.aireCinemaLevel = cinemaLevel
  record.aireC2DelusionCoverage = clampRatio(setting(cfg, 'aire.c2DelusionCoverage', 1))
  record.aireAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
  if (cinemaLevel >= 6) {
    cfg.initialDecibelGift = (cfg.initialDecibelGift ?? 0) + AIRE_C6_DECIBEL_GIFT
  }
}

function cycleFromCfg(cfg: unknown): AireCycle {
  const record = cfg as Record<string, unknown>
  return computeAireCycle({
    cinemaLevel: Number(record.aireCinemaLevel ?? 0),
    additionalActive: record.aireAdditionalActive === true,
    c2DelusionCoverage: Number(record.aireC2DelusionCoverage ?? 1),
  })
}

function applyAirePanel({ charResult, panel }: AgentSkillTransformInput): void {
  if (!panel) return
  if ((panel as Record<string, unknown>).__airePanelApplied) return
  ;(panel as Record<string, unknown>).__airePanelApplied = true
  const cycle = charResult.specResources?.aire_cycle as AireCycle | undefined
  if (!cycle) return
  panel.anomalyProficiency = (panel.anomalyProficiency ?? 0) + cycle.coreProficiency
  if (cycle.c1EtherAnomalyResIgnore > 0) {
    panel.enemyEtherAnomalyResReduction = (panel.enemyEtherAnomalyResReduction ?? 0)
      + cycle.c1EtherAnomalyResIgnore
  }
  if (cycle.c2DefIgnore > 0) {
    panel.enemyDefReduction = (panel.enemyDefReduction ?? 0) + cycle.c2DefIgnore
  }
}

function buildAireResourceResult({ cfg }: AgentResourceResultInput) {
  return { specResources: { aire_cycle: cycleFromCfg(cfg) } }
}

function buildAireAnomalyEvents({ cfg, state, events }: AgentEventInput): void {
  const pitchCount = Math.max(0, Math.floor(setting(cfg, 'aire.absolutePitchCount', 8)))
  if (pitchCount <= 0) return
  const totalTime = state.frontlineTime + state.backstageTime
  // 强化版占比 ≈ 妄想时刻覆盖 = min(1, 大招次数 × 15s / 全局时间)；核心异放不区分强化/原版，仅用于口径展示
  const delusionCoverage = totalTime > 0
    ? Math.min(1, (state.ultimateCount * AIRE_DELUSION_DURATION) / totalTime)
    : 0
  events.push({
    eventId: 'aire_absolute_pitch_release',
    eventName: '绝对音准·异放',
    eventType: 'release',
    element: 'dominant',
    carrierMoveId: AIRE_ABSOLUTE_PITCH_MOVE_ID,
    carrierMoveName: '普通攻击：绝对音准 #3',
    count: pitchCount,
    formula: 'releaseMultiplier = 原异常单次倍率 × (异常掌控/10 × 初始比例%) × (失衡?1.5:1)',
    fields: ['anomalyMastery', 'AIRE_RELEASE_RATIO_PER_TEN', 'AIRE_RELEASE_STUN_BONUS_PCT'],
    releaseRatio: {
      basis: 'anomalyMastery',
      perTenByElement: AIRE_RELEASE_RATIO_PER_TEN,
      stunBonusPct: AIRE_RELEASE_STUN_BONUS_PCT,
    },
    note: `第三段绝对音准 #3 命中异常目标触发；基底属性取基底异常元素主施加者，结算区=爱芮。强化版占比≈${(delusionCoverage * 100).toFixed(0)}%（大招次数×${AIRE_DELUSION_DURATION}s/全局时间）。`,
  })
}

function buildAireResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.aire_cycle as AireCycle | undefined
  if (!cycle) return []
  return [{
    id: 'aire-cycle',
    title: '爱芮·异常精通与无视',
    summary: `异常精通 +${cycle.coreProficiency} · 无视防御 +${cycle.c2DefIgnore}%`,
    rows: [
      { label: '核心异常精通', value: `+${cycle.coreProficiency}`, detail: '计入面板，抬升异常/异放基底' },
      { label: '影画1以太积蓄抗性无视', value: `+${cycle.c1EtherAnomalyResIgnore}%`, detail: '普攻/特殊技/强特' },
      { label: '影画2无视防御', value: `+${cycle.c2DefIgnore}%`, detail: '16%+妄想时刻8%按覆盖率' },
      { label: '影画6进场喧响', value: `+${cycle.c6DecibelGift}`, detail: '180秒一次整局近似' },
    ],
    footer: cycle.note,
  }]
}

export const aireMechanic: AgentMechanicModule = {
  id: 'agent:aire',
  agentIds: [AIRE_ID],
  name: '爱芮·控场核心',
  description: '异常精通+90、影画1以太积蓄抗性无视、影画2无视防御、影画6进场喧响；核心异放已按异常比例结算。',
  settings: [
    { id: 'aire.c2DelusionCoverage', label: '妄想时刻覆盖率', description: '影画2妄想时刻内额外无视8%防御的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'aire.absolutePitchCount', label: '第三段绝对音准次数', description: '第三段[普通攻击：绝对音准 #3]的整局次数（每次命中异常目标触发一次异放）；默认值待按实际循环校准', default: 8, min: 0, max: 60, step: 1 },
  ],
  buildCharConfig: buildAireCharConfig,
  buildAnomalyEvents: buildAireAnomalyEvents,
  transformSkillExecutions: applyAirePanel,
  buildResourceResult: buildAireResourceResult,
  resourceSections: buildAireResourceSections,
}

export default aireMechanic
