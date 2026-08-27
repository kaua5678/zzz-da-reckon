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
 * 明确未建模（状态机）：
 * - 影画6 妄想时刻不退出、全场应援/应援能量转化（场上资源状态机）。
 * 核心异放已建模：第三段绝对音准 #3 命中异常目标 → release 事件（dominant 元素按覆盖率分配），
 * 倍率 = 原异常单次/单跳倍率 × (初始掌控/10 × 元素比例%) × (失衡?1.5:1)，结算区=爱芮。
 * 影画1 异放暴击已建模：基础25%暴击率/25%暴伤，掌控>100每点+0.5%暴击率（releaseCrit）。
 * 影画4 异放回能/喧响已建模：floor(t/10)（10s CD 上限，异放次数≥floor(t/6)>floor(t/10)）× (4能量+70喧响) 并入 initialEnergyGift/initialDecibelGift。
 * 影画6 强化绝对音准/终结技以太伤害+40%已建模：patchExecutions 按 moveId 加 dmgBonus（妄想时刻不退出 → 强化绝对音准全覆盖）。
 */
import type {
  AgentCharConfigInput,
  AgentEventInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'

export const AIRE_ID = '1501'
export const AIRE_CORE_PROFICIENCY = 90
export const AIRE_C1_ETHER_ANOMALY_RES_IGNORE = 10
export const AIRE_C2_DEF_IGNORE = 16
export const AIRE_C2_DELUSION_DEF_IGNORE = 8
export const AIRE_C6_DECIBEL_GIFT = 1200
/** 第三段[普通攻击：绝对音准 #3] 的 moveId（异放载体） */
export const AIRE_ABSOLUTE_PITCH_MOVE_ID = '1501007'
/** 绝对音准全段 moveId（影画6 强化版以太伤害 +40% 的作用范围） */
export const AIRE_ABSOLUTE_PITCH_MOVE_IDS = new Set(['1501005', '1501006', '1501007', '1501022', '1501008'])
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
/** 影画1 异放暴击：基础暴击率/暴伤，掌控>阈值后每点额外加暴击率 */
export const AIRE_C1_RELEASE_CRIT_RATE = 25
export const AIRE_C1_RELEASE_CRIT_DMG = 25
export const AIRE_C1_RELEASE_CRIT_MASTERY_THRESHOLD = 100
export const AIRE_C1_RELEASE_CRIT_PER_POINT_RATE = 0.5
/** 影画4 异放触发回能/喧响（10秒一次） */
export const AIRE_C4_RELEASE_ENERGY = 4
export const AIRE_C4_RELEASE_DECIBEL = 70
export const AIRE_C4_CD_SECONDS = 10
/** 影画6 强化绝对音准/终结技以太伤害 +40% */
export const AIRE_C6_ETHANOL_DMG_BONUS = 40
export const AIRE_ULTIMATE_MOVE_ID = '1501016'
/** 应援能量来源（总量近似）：强特 +3 / 连携 +4 / 甜心四段 +1 / 帷幕 4/s×30s=120 */
export const AIRE_CHEER_EX = 3
export const AIRE_CHEER_CHAIN = 4
export const AIRE_CHEER_VEIL_PER_ULT = 120
/** 全场应援获取 CD（秒） */
export const AIRE_CHEER_CD_SECONDS = 6

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
    note: '妄想时刻与应援能量转化属状态机、异放回能/喧响（影画4）未建模；异放比例结算与影画1暴击已接入。',
  }
}

function buildAireCharConfig({ cinemaLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.aireCinemaLevel = cinemaLevel
  record.aireC2DelusionCoverage = clampRatio(setting(cfg, 'aire.c2DelusionCoverage', 1))
  record.aireAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
  if (cinemaLevel >= 4) {
    // 影画4：异放触发回 4 能量 + 70 喧响，10秒一次。
    // 异放次数 = 应援能量/2 + 全场应援 ≥ floor(t/6) > floor(t/10)，故触发次数取 10s CD 上限。
    const triggers = Math.max(0, Math.floor((cfg.battleTime ?? 180) / AIRE_C4_CD_SECONDS))
    cfg.initialEnergyGift = (cfg.initialEnergyGift ?? 0) + triggers * AIRE_C4_RELEASE_ENERGY
    cfg.initialDecibelGift = (cfg.initialDecibelGift ?? 0) + triggers * AIRE_C4_RELEASE_DECIBEL
    record.aireC4ReleaseTriggers = triggers
  }
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

function applyAirePanel({ cinemaLevel, panel, settings }: AgentPanelInput): void {
  // 面板字段与 computeAireCycle 同源（coreProficiency / c1EtherAnomalyResIgnore / c2DefIgnore）。
  const c2DelusionCoverage = clampRatio(settings['aire.c2DelusionCoverage'] ?? 1)
  panel.anomalyProficiency = (panel.anomalyProficiency ?? 0) + AIRE_CORE_PROFICIENCY
  if (cinemaLevel >= 1) {
    panel.enemyEtherAnomalyResReduction = (panel.enemyEtherAnomalyResReduction ?? 0)
      + AIRE_C1_ETHER_ANOMALY_RES_IGNORE
  }
  if (cinemaLevel >= 2) {
    panel.enemyDefReduction = (panel.enemyDefReduction ?? 0)
      + AIRE_C2_DEF_IGNORE + AIRE_C2_DELUSION_DEF_IGNORE * c2DelusionCoverage
  }
}

function buildAireResourceResult({ cfg }: AgentResourceResultInput) {
  return { specResources: { aire_cycle: cycleFromCfg(cfg) } }
}

function buildAireAnomalyEvents({ cfg, state, events, totalTime }: AgentEventInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinemaLevel = Number(record.aireCinemaLevel ?? 0)
  const additionalActive = record.aireAdditionalActive === true
  // 绝对音准#3 次数：手动覆盖（>0）优先；否则按「应援能量/2 + 全场应援次数」自动推导
  const manualCount = Math.max(0, Math.floor(setting(cfg, 'aire.absolutePitchCount', 0)))
  let pitchCount = manualCount
  if (pitchCount <= 0) {
    // 应援能量总量近似：强特 +3、连携 +4、帷幕 4/s×30s×终结技次数（额外能力门控）
    const cheerEnergy = state.exSpecialCount * AIRE_CHEER_EX
      + state.chainCountTotal * AIRE_CHEER_CHAIN
      + (additionalActive ? AIRE_CHEER_VEIL_PER_ULT * state.ultimateCount : 0)
      + Math.max(0, setting(cfg, 'aire.cheerEnergyBonus', 0))
    // 全场应援次数 = min(异常触发次数, floor(t/6))；异常队异常触发次数通常远超 CD 上限，取上限近似
    const cheerGain = Math.floor(totalTime / AIRE_CHEER_CD_SECONDS)
    pitchCount = Math.floor(cheerEnergy / 2) + cheerGain
  }
  if (pitchCount <= 0) return
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
    releaseCrit: cinemaLevel >= 1
      ? {
          ratePct: AIRE_C1_RELEASE_CRIT_RATE,
          dmgPct: AIRE_C1_RELEASE_CRIT_DMG,
          masteryThreshold: AIRE_C1_RELEASE_CRIT_MASTERY_THRESHOLD,
          masteryPerPointRatePct: AIRE_C1_RELEASE_CRIT_PER_POINT_RATE,
        }
      : undefined,
    note: `第三段绝对音准 #3 命中异常目标触发（次数=应援能量/2+全场应援）；基底属性取基底异常元素主施加者，结算区=爱芮。全场应援≈${Math.floor(totalTime / AIRE_CHEER_CD_SECONDS)}次（6秒CD上限近似，异常触发次数通常远超上限）。`,
  })
}

function patchAireExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = Number((cfg as unknown as Record<string, unknown>).aireCinemaLevel ?? 0)
  if (cinema < 6) return
  // 6命：妄想时刻不退出 → 强化版绝对音准全覆盖，强化直伤 +40% 全占比
  for (const exec of executions) {
    if (!exec.moveId) continue
    if (exec.moveId === AIRE_ULTIMATE_MOVE_ID) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + AIRE_C6_ETHANOL_DMG_BONUS
      exec.skillTableNote = `${exec.skillTableNote ?? ''}；影画6 终结技以太伤害+${AIRE_C6_ETHANOL_DMG_BONUS}%`
    } else if (AIRE_ABSOLUTE_PITCH_MOVE_IDS.has(exec.moveId)) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + AIRE_C6_ETHANOL_DMG_BONUS
      exec.skillTableNote = `${exec.skillTableNote ?? ''}；影画6 强化绝对音准以太伤害+${AIRE_C6_ETHANOL_DMG_BONUS}%（妄想时刻全覆盖）`
    }
  }
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
  description: '异常精通+90、影画1以太积蓄抗性无视+异放暴击、影画2无视防御、影画4异放回能/喧响、影画6进场喧响+强化直伤；核心异放已按异常比例结算。',
  settings: [
    { id: 'aire.c2DelusionCoverage', label: '妄想时刻覆盖率', description: '影画2妄想时刻内额外无视8%防御的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'aire.absolutePitchCount', label: '绝对音准#3次数覆盖', description: '第三段[普通攻击：绝对音准 #3]整局次数的手动覆盖；0=自动（应援能量/2+全场应援），>0 强制用该值', default: 0, min: 0, max: 200, step: 1 },
    { id: 'aire.cheerEnergyBonus', label: '应援能量额外', description: '应援能量总量额外补充（自动公式已含强特×3+连携×4+帷幕120/大招，此处补甜心四段等次要来源）', default: 0, min: 0, max: 400, step: 10 },
  ],
  applyPanel: applyAirePanel,
  buildCharConfig: buildAireCharConfig,
  buildAnomalyEvents: buildAireAnomalyEvents,
  patchExecutions: patchAireExecutions,
  buildResourceResult: buildAireResourceResult,
  resourceSections: buildAireResourceSections,
}

export default aireMechanic
