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
 * - 额外能力合作舞台：击破/支援/同阵营/异常队友激活；侵蚀持续+3秒沿用 spec teamBuffs；
 *   帷幕生应援能量 4个/次 × 全队帷幕次数（含队友开的帷幕——照/千夏/叶瞬光，
 *   useResourceCalc 收敛注入 teamVeilCountTotal，2026-08-31 从「每大招120」改为按帷幕次数）。
 *
 * 明确未建模（状态机）：
 * - 影画6 妄想时刻不退出、全场应援/应援能量转化（场上资源状态机）。
 * 核心异放已建模：第三段绝对音准 #3 命中异常目标 → release 事件（dominant 元素按覆盖率分配），
 * 倍率 = 原异常单次/单跳倍率 × (初始掌控/10 × 元素比例%) × (失衡?1.5:1)，结算区=爱芮。
 * 影画1 异放暴击已建模：基础25%暴击率/25%暴伤，掌控>100每点+0.5%暴击率（releaseCrit）。
 * 影画4 异放回能/喧响已建模：floor(t/10)（10s CD 上限，异放次数≥floor(t/6)>floor(t/10)）× (4能量+70喧响) 并入 initialEnergyGift/initialDecibelGift。
 * 影画6 强化绝对音准/终结技以太伤害+40%已建模：patchExecutions 按 moveId 加 dmgBonus（妄想时刻不退出 → 强化绝对音准全覆盖）。
 */
import { clampRatio } from '@/utils/finiteClamp'
import { initialStat } from '@/mechanics/initialStat'
import type {
  AgentCharConfigInput,
  AgentEventInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  ExtraNecessaryAction,
} from '../types'
import { basicComboCycleSeconds, findMoveById } from '@/data/moveTableQueries'
import { mechanicSettingPanelReader, mechanicSettingReader } from '@/utils/mechanicSettingCfg'
import type { CharacterResourceResult } from '@/types/resource'
import { cinemaLevelOf } from '@/data/cinemaLevel'
import { additionalAbilityActiveOf } from '@/core/additionalAbilityActive'

const setting = mechanicSettingReader(() => aireMechanic.settings)
const settingOf = mechanicSettingPanelReader(() => aireMechanic.settings)
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
/** 影画6 / 妄想时刻内的强化版第三段绝对音准（倍率表 #5，642.1%）。#4（1501022，0s 83.1%）归属不明，不计（CC-197） */
export const AIRE_ENHANCED_PITCH_MOVE_ID = '1501008'
/** 妄想时刻最大持续（秒）：期间第三段绝对音准提升为强化版 */
export const AIRE_DELUSION_SECONDS = 15
/** 普攻甜心律动第四段：命中后生成 1 个应援能量（原文 skill.basic.description.0） */
export const AIRE_SWEET_BASIC4_MOVE_ID = '1501004'
export const AIRE_CHEER_BASIC4 = 1
/** 应援能量来源（总量近似）：强特 +3 / 连携 +4 / 甜心四段 +1 / 帷幕每次开 4 个（额外能力） */
export const AIRE_CHEER_EX = 3
export const AIRE_CHEER_CHAIN = 4
/** 额外能力·合作舞台：每次以太帷幕开启生成 4 个应援能量（1s ICD 在帷幕持续 30s+ 下不约束） */
export const AIRE_CHEER_PER_VEIL = 4
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

export function computeAireCycle(input: {
  cinemaLevel: number
  additionalActive: boolean
  c2DelusionCoverage: number
}): AireCycle {
  const cinemaLevel = cinemaLevelOf(input.cinemaLevel)
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
    note: '妄想时刻与应援能量转化按总量近似；异放比例结算、影画1暴击与影画4异放回能/喧响已接入。',
  }
}

function buildAireCharConfig({ cinemaLevel, cfg, panel, outOfCombatPanel, skills }: AgentCharConfigInput): void {
  cfg.aireCinemaLevel = cinemaLevel
  // 原文「每10点初始异常掌控」「若初始异常掌控大于100点」⇒ 初始 = 局外面板（CC-125；读取口 `initialStat`，CC-497）
  cfg.aireInitialMastery = initialStat(outOfCombatPanel, panel, 'anomalyMastery')
  cfg.aireC2DelusionCoverage = clampRatio(setting(cfg, 'aire.c2DelusionCoverage'))
  cfg.aireAdditionalActive = additionalAbilityActiveOf(panel)
  if (cinemaLevel >= 4) {
    // 影画4：异放触发回 4 能量 + 70 喧响，10秒一次。
    // 异放次数 = 应援能量/2 + 全场应援；典型整局 ≫ floor(t/10)，故触发次数取 10s CD 上限
    // （CC-196 后全场应援非C6=终结×3，不再恒 ≥ floor(t/6)；不设 min 截断，属近似）。
    const triggers = Math.max(0, Math.floor(cfg.battleTime / AIRE_C4_CD_SECONDS))
    cfg.initialEnergyGift = cfg.initialEnergyGift + triggers * AIRE_C4_RELEASE_ENERGY
    cfg.initialDecibelGift = cfg.initialDecibelGift + triggers * AIRE_C4_RELEASE_DECIBEL
  }
  if (cinemaLevel >= 6) {
    cfg.initialDecibelGift = cfg.initialDecibelGift + AIRE_C6_DECIBEL_GIFT
  }
  // CC-196：甜心律动 #4 应援能量按普攻时长折算（CC-195 通用口径 basicComboCycleSeconds）
  cfg.aireBasicCheerCycleSeconds = basicComboCycleSeconds(skills, AIRE_SWEET_BASIC4_MOVE_ID)
  // CC-197：绝对音准直伤行动作时长（倍率表）
  cfg.airePitchActionTime = findMoveById(skills, AIRE_ABSOLUTE_PITCH_MOVE_ID)?.actionTime ?? 1
  cfg.aireEnhancedPitchActionTime = findMoveById(skills, AIRE_ENHANCED_PITCH_MOVE_ID)?.actionTime ?? 1
}

/**
 * 第三段绝对音准次数（纯函数，CC-196 抽出）——异放事件与直伤行（CC-197 extraNecessaryAction）同源。
 * 手动覆盖（>0）优先；否则 = floor(应援能量 / 2) + 全场应援次数。
 * 应援能量：强特 +3、连携 +4、甜心律动 #4 +1（普攻时长 / 甜心律动整套时长，CC-196 补）、
 * 额外能力下每次帷幕 +4（含队友帷幕，teamVeilCountTotal）、滑块补充。
 * 原文：消耗 2 个应援能量可直接快速发动第三段；全场应援每层 +2 段蓄力。
 */
export function aireAbsolutePitchCount(
  cfg: AgentResourceInput['cfg'],
  state: { exSpecialCount: number; chainCountTotal: number; basicAttackTime?: number; ultimateCount?: number },
  totalTime: number,
): number {
  const manualCount = Math.max(0, Math.floor(setting(cfg, 'aire.absolutePitchCount')))
  if (manualCount > 0) return manualCount
  const additionalActive = cfg.aireAdditionalActive === true
  const teamVeilCount = Math.max(0, Math.floor(Number(cfg.teamVeilCountTotal ?? 0) || 0))
  const basicCycle = Number(cfg.aireBasicCheerCycleSeconds ?? 0)
  const basic4Hits = basicCycle > 0 ? Math.floor(Math.max(0, Number(state.basicAttackTime ?? 0)) / basicCycle) : 0
  const cheerEnergy = state.exSpecialCount * AIRE_CHEER_EX
    + state.chainCountTotal * AIRE_CHEER_CHAIN
    + basic4Hits * AIRE_CHEER_BASIC4
    + (additionalActive ? AIRE_CHEER_PER_VEIL * teamVeilCount : 0)
    + Math.max(0, setting(cfg, 'aire.cheerEnergyBonus'))
  // 全场应援层数（每层 = 蓄力+2段 或 转化 2 应援能量，均 ≈ 1 次第三段）。CC-196 按原文订正：
  // - 终结技进入[妄想时刻]获得 3 层（skill.chain 原文）；
  // - 「妄想时刻内异常触发 +1 层 / 6s」是影画6 专属（talent.6 原文），旧实现对全命座无门控计 floor(t/6)。
  // C6 妄想不退出 ⇒ 仅首次进入给 3 层（后续终结是否算「进入」原文未明，保守不计；回退点=本段）。
  const ultCount = Math.max(0, Math.floor(Number(state.ultimateCount ?? 0) || 0))
  const cheerGain = cinemaLevelOf(cfg.aireCinemaLevel) >= 6
    ? Math.floor(totalTime / AIRE_CHEER_CD_SECONDS) + (ultCount > 0 ? 3 : 0)
    : 3 * ultCount
  return Math.floor(cheerEnergy / 2) + cheerGain
}

/** 强化版占比：影画6 妄想时刻不退出 ⇒ 1；否则 = min(1, 终结次数 × 15s / 战斗时长)（CC-197 可逆近似） */
export function aireEnhancedPitchShare(cinemaLevel: number, ultimateCount: number, totalTime: number): number {
  if (cinemaLevel >= 6) return 1
  if (!(totalTime > 0)) return 0
  return clampRatio(Math.max(0, ultimateCount) * AIRE_DELUSION_SECONDS / totalTime)
}

/**
 * 绝对音准直伤行（CC-197）：走引擎通用「模块必做动作」通道 `extraNecessaryAction`——时间进入账本估计
 * （Σnecessary），装不下由团队级 feasibleScale 等比封顶 + 装配截断；**不**在 buildExecutions 推 necessary 行
 * （那条路经折叠残差 `+=`，正反馈时前台 Σ 溢出 213s/180s，按自身普攻池封顶又系统性减半，见 §24.43）。
 * 次数 = aireAbsolutePitchCount（与异放事件同源）；强化占比见 aireEnhancedPitchShare；回能/喧响交倍率表回填。
 * 影画6 +40% 经 patchAireExecutions 命中 1501008 行。回退：删本能力即可（异放事件不受影响）。
 */
export function aireExtraNecessaryActions(cfg: AgentResourceInput['cfg'], state?: Readonly<AgentResourceInput['state']>): ExtraNecessaryAction[] | null {
  if (!state) return null
  const totalTime = cfg.battleTime
  const pitch = aireAbsolutePitchCount(cfg, state, totalTime)
  if (pitch <= 0) return null
  const share = aireEnhancedPitchShare(cinemaLevelOf(cfg.aireCinemaLevel), state.ultimateCount, totalTime)
  const enhanced = Math.round(pitch * share)
  const rows: ExtraNecessaryAction[] = []
  if (pitch - enhanced > 0) {
    rows.push({ count: pitch - enhanced, moveId: AIRE_ABSOLUTE_PITCH_MOVE_ID, moveName: '普通攻击：绝对音准 #3',
      actionTime: Number(cfg.airePitchActionTime ?? 1), comboAlignRatio: 0 })
  }
  if (enhanced > 0) {
    rows.push({ count: enhanced, moveId: AIRE_ENHANCED_PITCH_MOVE_ID, moveName: '普通攻击：绝对音准（强化·妄想时刻）',
      actionTime: Number(cfg.aireEnhancedPitchActionTime ?? 1), comboAlignRatio: 0 })
  }
  return rows
}

function cycleFromCfg(cfg: AgentResourceResultInput['cfg']): AireCycle {
  return computeAireCycle({
    cinemaLevel: cinemaLevelOf(cfg.aireCinemaLevel),
    additionalActive: cfg.aireAdditionalActive === true,
    c2DelusionCoverage: Number(cfg.aireC2DelusionCoverage ?? 1),
  })
}

function applyAirePanel({ cinemaLevel, panel, settings }: AgentPanelInput): void {
  // CC-333：面板字段直接复用 computeAireCycle（coreProficiency / c1EtherAnomalyResIgnore / c2DefIgnore 单源）。
  const cycle = computeAireCycle({
    cinemaLevel,
    additionalActive: additionalAbilityActiveOf(panel),
    c2DelusionCoverage: settingOf(settings, 'aire.c2DelusionCoverage'),
  })
  panel.anomalyProficiency = panel.anomalyProficiency + cycle.coreProficiency
  if (cycle.c1EtherAnomalyResIgnore > 0) {
    panel.enemyEtherAnomalyResReduction = panel.enemyEtherAnomalyResReduction
      + cycle.c1EtherAnomalyResIgnore
  }
  if (cycle.c2DefIgnore > 0) {
    panel.enemyDefReduction = panel.enemyDefReduction + cycle.c2DefIgnore
  }
}

function buildAireResourceResult({ cfg }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return { aireCycle: cycleFromCfg(cfg) }
}

function buildAireAnomalyEvents({ cfg, state, events, totalTime }: AgentEventInput): void {
  const cinemaLevel = cinemaLevelOf(cfg.aireCinemaLevel)
  // 初始（局外）掌控；buildCharConfig 未跑（单测直调）时 undefined ⇒ 引擎回落局内面板
  const initialMastery = cfg.aireInitialMastery === undefined ? undefined : Number(cfg.aireInitialMastery)
  // 绝对音准#3 次数（CC-196 纯函数 aireAbsolutePitchCount）
  const pitchCount = aireAbsolutePitchCount(cfg, state, totalTime)
  if (pitchCount <= 0) return
  events.push({
    eventId: 'aire_absolute_pitch_release',
    eventName: '绝对音准·异放',
    eventType: 'release',
    element: 'dominant',
    carrierMoveId: AIRE_ABSOLUTE_PITCH_MOVE_ID,
    carrierMoveName: '普通攻击：绝对音准 #3',
    // 异放随绝对音准#3（资源驱动特殊普攻）触发：失衡轴内占比 = 载体轴内单位/总次数。
    // 特殊普攻不是 basic filler 兜底能打出的（filler 只打点倍率）——玩家把绝对音准#3
    // 显式捏进窗内才吃易伤，不捏=轴外（2026-08 审计，用户口径「计数轴内消耗的资源」）
    followCarrierInStun: true,
    count: pitchCount,
    formula: 'releaseMultiplier = 原异常单次倍率 × (异常掌控/10 × 初始比例%) × (失衡?1.5:1)',
    fields: ['anomalyMastery', 'AIRE_RELEASE_RATIO_PER_TEN', 'AIRE_RELEASE_STUN_BONUS_PCT'],
    releaseRatio: {
      basis: 'anomalyMastery',
      perTenByElement: AIRE_RELEASE_RATIO_PER_TEN,
      stunBonusPct: AIRE_RELEASE_STUN_BONUS_PCT,
      basisValue: initialMastery,
    },
    releaseCrit: cinemaLevel >= 1
      ? {
          ratePct: AIRE_C1_RELEASE_CRIT_RATE,
          dmgPct: AIRE_C1_RELEASE_CRIT_DMG,
          masteryThreshold: AIRE_C1_RELEASE_CRIT_MASTERY_THRESHOLD,
          masteryPerPointRatePct: AIRE_C1_RELEASE_CRIT_PER_POINT_RATE,
          masteryValue: initialMastery,
        }
      : undefined,
    note: `第三段绝对音准 #3 命中异常目标触发（次数=应援能量/2+全场应援）；基底属性取基底异常元素主施加者，结算区=爱芮。全场应援=终结×3层（影画6 另 +floor(t/6)，妄想内异常触发 6 秒CD上限近似）。`,
  })
}

function patchAireExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = cinemaLevelOf(cfg.aireCinemaLevel)
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
  const cycle = result.aireCycle
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
  // CC-80：终结技开启帷幕 1:1（原 mechanics/teamVeil.ts 写死集合）
  teamVeilCount: ({ ultimateCount }) => ultimateCount,
  name: '爱芮·控场核心',
  description: '异常精通+90、影画1以太积蓄抗性无视+异放暴击、影画2无视防御、影画4异放回能/喧响、影画6进场喧响+强化直伤；核心异放已按异常比例结算。',
  settings: [
    { id: 'aire.c2DelusionCoverage', label: '妄想时刻覆盖率', description: '影画2妄想时刻内额外无视8%防御的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'aire.absolutePitchCount', label: '绝对音准#3次数覆盖', description: '第三段[普通攻击：绝对音准 #3]整局次数的手动覆盖；0=自动（应援能量/2+全场应援），>0 强制用该值', default: 0, min: 0, max: 200, step: 1 },
    { id: 'aire.cheerEnergyBonus', label: '应援能量额外', description: '应援能量总量额外补充（自动公式已含强特×3+连携×4+帷幕4个/次×全队帷幕次数，此处补甜心四段等次要来源）', default: 0, min: 0, max: 400, step: 10 },
  ],
  applyPanel: applyAirePanel,
  buildCharConfig: buildAireCharConfig,
  buildAnomalyEvents: buildAireAnomalyEvents,
  patchExecutions: patchAireExecutions,
  // CC-197：绝对音准直伤行（通用必做动作通道，时间进账本估计）
  extraNecessaryAction: aireExtraNecessaryActions,
  buildResourceResult: buildAireResourceResult,
  resourceSections: buildAireResourceSections,
}


/**
 * D2（CC-359/362）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 命座等级：buildCharConfig 写 */
    aireCinemaLevel?: number
    /** 局外异常掌控（无局外面板时取局内）；spec 1501.json 按字段名读 */
    aireInitialMastery?: number
    /** 影画2「妄想」覆盖率：机制设置 aire.c2DelusionCoverage，夹到 0–1 */
    aireC2DelusionCoverage?: number
    /** 额外能力是否触发：由面板 additionalAbilityActive 推出 */
    aireAdditionalActive?: boolean
    /** 甜蜜普攻四段的循环秒数（basicComboCycleSeconds） */
    aireBasicCheerCycleSeconds?: number
    /** 「绝对音高」动作时长（秒，缺省 1） */
    airePitchActionTime?: number
    /** 强化「绝对音高」动作时长（秒，缺省 1） */
    aireEnhancedPitchActionTime?: number
  }
}

/** r407：本模块私有结果键（原塞在 `specResources['aire_cycle']`，与 spec 账本混用同一无类型通道） */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 艾瑞循环明细 */
    aireCycle?: AireCycle
  }
}
