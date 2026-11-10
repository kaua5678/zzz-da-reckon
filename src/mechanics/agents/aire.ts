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
 * 影画4 异放回能/喧响已建模：floor(有效战斗时间/10)（10s CD 上限）× (4能量+70喧响)，经 bonusEnergy / extraSelfDecibelReward 入账
 *   （CC-561：此前并入 initialEnergyGift / initialDecibelGift，把「战斗内累计」错贴成「进场赠送」）。
 * 影画6 强化绝对音准/终结技以太伤害+40%已建模：patchExecutions 按 moveId 加 dmgBonus（妄想时刻不退出 → 强化绝对音准全覆盖）。
 *
 * 妄想时刻窗口（CC-561）：玩家不是开场就开大——首次放大在「首次放大时间」滑块（默认 30s）。
 * 影画6 的「妄想时刻内敌人进异常 ⇒ +1 层[全场应援]（6s 内至多一次）」只在
 * [首次放大, 有效战斗时间) 里计数，即 floor((有效战斗时间 − 首次放大时间)/6)，不再从 t=0 起算。
 */
import { clampRatio } from '@/utils/finiteClamp'
import { initialStat } from '@/mechanics/initialStat'
import { effectiveBattleTime } from '@/core/effectiveTime'
import type {
  AgentCharConfigInput,
  AgentEventInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  ExtraNecessaryAction,
  ReleaseModifier,
  ReleaseModifierInput,
} from '../types'
import { basicComboCycleSeconds, findMoveById } from '@/data/moveTableQueries'
import { mechanicSettingPanelReader, mechanicSettingReader, capOfAuto } from '@/utils/mechanicSettingCfg'
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
/** 全场应援获取 CD（秒）：影画6「敌人进属性异常 ⇒ +1 层，6 秒内最多一次」 */
export const AIRE_CHEER_CD_SECONDS = 6
/**
 * 首次开大（进入[妄想时刻]）时间默认值（秒）。用户口径 2026-11-10：玩家通常 30 秒开大。
 *
 * 为什么需要它：影画6 的「妄想时刻内敌人进异常 ⇒ +1 层[全场应援]（6s 内至多一次）」是**条件触发**，
 * 而[妄想时刻]要等第一次终结技才进入。旧实现按 {@link AIRE_CHEER_CD_SECONDS} 从 t=0 起
 * `floor(总时间/6)`，等于假设「进场即妄想时刻」——实测默认队虚高约 5 层（30 → 25）。
 * 局内旋钮 = 本模块 settings `aire.firstUltTime`（0–180s）。
 */
export const AIRE_FIRST_ULT_SECONDS = 30

export interface AireCycle {
  cinemaLevel: number
  additionalActive: boolean
  coreProficiency: number
  c1EtherAnomalyResIgnore: number
  c2DefIgnore: number
  c6DecibelGift: number
  /** 影画4 异放回能（整局总量，引擎固定源通道 bonusEnergy；C4 以下为 0） */
  c4EnergyGift: number
  /** 影画4 异放喧响（整局总量，不可分享通道 extraSelfDecibelReward；C4 以下为 0） */
  c4DecibelGift: number
  /** 影画6 妄想时刻内 6s/层[全场应援]层数（首次放大之后才计数；C6 以下为 0） */
  c6CheerLayers: number
  /** 首次放大时间（秒，滑块）——妄想窗口起点 */
  firstUltTime: number
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
    // 面板/纯函数路径不带 cfg（无战斗时间）⇒ 这三项由 cycleFromCfg 回填
    c4EnergyGift: 0,
    c4DecibelGift: 0,
    c6CheerLayers: 0,
    firstUltTime: AIRE_FIRST_ULT_SECONDS,
    note: '妄想时刻与应援能量转化按总量近似；异放比例结算、影画1暴击与影画4异放回能/喧响已接入。',
  }
}

function buildAireCharConfig({ cinemaLevel, cfg, panel, outOfCombatPanel, skills }: AgentCharConfigInput): void {
  cfg.aireCinemaLevel = cinemaLevel
  // 原文「每10点初始异常掌控」「若初始异常掌控大于100点」⇒ 初始 = 局外面板（CC-125；读取口 `initialStat`，CC-497）
  cfg.aireInitialMastery = initialStat(outOfCombatPanel, panel, 'anomalyMastery')
  if (cinemaLevel >= 4) {
    /**
     * 影画4：异放触发回 4 能量 + 70 喧响，10秒一次。
     * 异放次数 = 应援能量/2 + 全场应援；典型整局 ≫ floor(有效时间/10)，故触发次数取 10s CD 上限
     * （CC-196 后全场应援非C6=终结×3，不再恒 ≥ floor(t/6)；不设 min 截断，属近似）。
     *
     * CC-561：触发次数改用**有效战斗时间**（扣 boss 无敌，同影画6 的窗口口径），
     * 且这两笔**战斗内累计**不再写进 `initialEnergyGift` / `initialDecibelGift`——
     * 那两个字段是「进场赠送」，写进去会让结果卡「开局赠送」显示成 1000+1260+1200=3460
     * （用户实测直觉只有 2200），还会把战斗内收益提前成种子参与终结技次数推导。
     * 回能走模块 `bonusEnergy`（引擎固定源能量通道，结果卡「专属额外」行），
     * 喧响走 `extraSelfDecibelReward`（不可分享通道，官方面板同款归类）。
     */
    const triggers = Math.max(0, Math.floor(effectiveBattleTime(cfg) / AIRE_C4_CD_SECONDS))
    cfg.aireC4EnergyGift = triggers * AIRE_C4_RELEASE_ENERGY
    cfg.aireC4DecibelGift = triggers * AIRE_C4_RELEASE_DECIBEL
    cfg.extraSelfDecibelReward = cfg.extraSelfDecibelReward + cfg.aireC4DecibelGift
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

// @fact agent:1501/妄想时刻窗口 口径: 影画6「妄想时刻内敌人进入属性异常 ⇒ +1 层[全场应援]（6s 内至多一次）」= floor((有效战斗时间 − 首次放大时间)/6)；首次放大时间 = 旋钮 `aire.firstUltTime`（0–180s，缺省 30s）。强化版绝对音准占比复用同一窗口（窗口/有效战斗时间），置 0 = 旧口径「进场即妄想时刻」 | 据 用户@2026-11-10（「玩家通常在 30 秒开大…后面才有 buff，这个需要算（180s−无敌时间−首次放大时间）/6 秒」） | 验 src/mechanics/__tests__/aire.test.ts | 锚 src/mechanics/agents/aire.ts#aireDelusionCheerLayers | 信 确认
// ⟳复核: base(gachabase) 更新的 1501 talent.6 / 终结技文本若改变[妄想时刻]的进入条件（例如其他动作也能进入），复核「首次放大 = 唯一入口」是否仍成立，并相应改旋钮语义 | 到期 2027-05-10
// @fact agent:1501/影画4入账通道 口径: 异放回能/喧响（floor(有效战斗时间/10) 次 × (4 能量 + 70 喧响)）走 `bonusEnergy` / `extraSelfDecibelReward` 两个战斗内通道，**不写** `initialEnergyGift` / `initialDecibelGift`——「进场赠送」只含基础 1000 + 影画6 的 1200；实测换通道零数值差（decibel total 逐位相同），只改归属 | 据 用户@2026-11-10（「开局赠送 3,460 啥情况，我感觉只有 2200，1k 和 1k2 的 6 命」） | 验 src/mechanics/__tests__/aire.test.ts | 锚 src/mechanics/agents/aire.ts#buildAireCharConfig | 信 确认
// ⟳复核: 若结果卡「专属额外」通道改版，或引擎新增「战斗内固定源喧响」能力，复核影画4 的 1260 仍落在可对账通道上（不得回流「进场赠送」） | 到期 2027-05-10

/**
 * 首次放大时间（秒）——玩家第一次开出终结技、进入[妄想时刻]的时刻。
 *
 * 用户口径 2026-11-10：「玩家通常在 30 秒开大（具体的给个局内修改旋钮，0-180s 都能填，
 * 作为首次放大时间），后面才有 buff」。⇒ 本值只做下限 0 的钳制（允许越过战斗时间，
 * 此时窗口为空、层数为 0），上限由滑块范围的 180s 兜住。
 */
export function aireFirstUltTime(cfg: AgentResourceInput['cfg']): number {
  return Math.max(0, setting(cfg, 'aire.firstUltTime'))
}

/**
 * 影画6 的[全场应援]层数（「妄想时刻内敌人进属性异常 ⇒ +1 层，6 秒内最多一次」）。
 *
 * 计数窗口 = **[首次放大时间, 有效战斗时间)**，层数 = floor(窗口秒数 / 6)。
 * 旧实现是 floor(总时间 / 6)，等于假设进场即妄想时刻（用户 2026-11-10 纠正）。
 * 有效战斗时间扣 boss 无敌（`core/effectiveTime.ts`，单一来源）。
 * 回退点：本函数（改回 `totalTime` 即恢复旧近似）。
 */
export function aireDelusionCheerLayers(cfg: AgentResourceInput['cfg'], fallbackTotalTime = 0): number {
  return Math.max(0, Math.floor(aireDelusionWindowSeconds(cfg, fallbackTotalTime) / AIRE_CHEER_CD_SECONDS))
}

/**
 * [妄想时刻]在局内剩余的覆盖秒数 = 有效战斗时间 − 首次放大时间（下限 0）。
 *
 * 影画6「妄想时刻不退出」⇒ 首次开大之后整局都在妄想时刻内，故窗口 = 首次放大 → 战斗结束。
 * 影画6 的两个「妄想时刻内才有的效果」共用本函数：6s 一层[全场应援] + 强化版绝对音准占比。
 */
export function aireDelusionWindowSeconds(cfg: AgentResourceInput['cfg'], fallbackTotalTime = 0): number {
  const battleTime = Number.isFinite(cfg.battleTime) ? cfg.battleTime : fallbackTotalTime
  const invincibleTime = Number.isFinite(cfg.invincibleTime) ? cfg.invincibleTime : 0
  return Math.max(0, effectiveBattleTime({ battleTime, invincibleTime }) - aireFirstUltTime(cfg))
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
  const additionalActive = additionalAbilityActiveOf(cfg.panel)
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
    ? aireDelusionCheerLayers(cfg, totalTime) + (ultCount > 0 ? 3 : 0)
    : 3 * ultCount
  // 次数自动 = 应援能量/2 + 全场应援；滑块 = **上限**（用户口径 2026-10-19「是修改上限而不是修改招式次数」），0 = 不设上限
  const auto = Math.floor(cheerEnergy / 2) + cheerGain
  return capOfAuto(auto, Math.max(0, Math.floor(setting(cfg, 'aire.absolutePitchCount'))))
}

/**
 * 强化版绝对音准占比。
 *
 * - 影画6：[妄想时刻]不退出 ⇒ 覆盖率 = **妄想窗口 / 有效战斗时间**（首次放大之前的绝对音准还是普通版）；
 * - 其它命座：min(1, 终结次数 × 15s / 战斗时长)（CC-197 可逆近似）。
 *
 * CC-561：此前影画6 恒返回 1 = 「开局即妄想时刻」，与首次放大时间滑块矛盾（用户 2026-11-10 纠正）。
 * 滑块置 0 时窗口 = 有效战斗时间 ⇒ 覆盖率 1，恢复旧口径。
 */
export function aireEnhancedPitchShare(cfg: AgentResourceInput['cfg'], ultimateCount: number, fallbackTotalTime = 0): number {
  const cinemaLevel = cinemaLevelOf(cfg.aireCinemaLevel)
  if (cinemaLevel >= 6) {
    const effectiveSeconds = effectiveBattleTime({
      battleTime: Number.isFinite(cfg.battleTime) ? cfg.battleTime : fallbackTotalTime,
      invincibleTime: Number.isFinite(cfg.invincibleTime) ? cfg.invincibleTime : 0,
    })
    if (!(effectiveSeconds > 0)) return 0
    return clampRatio(aireDelusionWindowSeconds(cfg, fallbackTotalTime) / effectiveSeconds)
  }
  if (!(fallbackTotalTime > 0)) return 0
  return clampRatio(Math.max(0, ultimateCount) * AIRE_DELUSION_SECONDS / fallbackTotalTime)
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
  const share = aireEnhancedPitchShare(cfg, state.ultimateCount, totalTime)
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
  const cycle = computeAireCycle({
    cinemaLevel: cinemaLevelOf(cfg.aireCinemaLevel),
    additionalActive: additionalAbilityActiveOf(cfg.panel),
    c2DelusionCoverage: clampRatio(setting(cfg, 'aire.c2DelusionCoverage')),
  })
  // 结果卡展示用：影画4/6 的整局量与首次放大窗口（面板阶段拿不到 cfg，故在结果装配期回填）
  // 影画4 两份量由 buildCharConfig 写进 cfg（单一事实源，不在此重算 floor）
  return {
    ...cycle,
    c4EnergyGift: Number(cfg.aireC4EnergyGift ?? 0),
    c4DecibelGift: Number(cfg.aireC4DecibelGift ?? 0),
    c6CheerLayers: cycle.cinemaLevel >= 6 ? aireDelusionCheerLayers(cfg, cfg.battleTime) : 0,
    firstUltTime: aireFirstUltTime(cfg),
  }
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
    /**
     * 影画2 梦幻节拍：「**爱芮攻击和触发[异放]**时无视目标16%防御力」（妄想时刻内再+8%）。
     *
     * 原文点名的载体只有两个：**攻击**（直伤）与**触发[异放]**，**不是**「造成属性异常伤害」。
     * 按用户口径（2026-11-09）：
     * > 「异放减防就是异常减防的子集，只在异放事件时计算。异放作为异常事件可以吃异放加成和
     * >   异常加成相加，而异常比如侵蚀这种父事件就吃不了异放加成，只能吃异常。」
     *
     * ⇒ 两半分开落：
     * - **攻击**那半 ⇒ 直伤族 `enemyDefIgnoreDirect`（只有直伤链读）；
     * - **触发[异放]** 那半 ⇒ `releaseModifier`（**异放专属层**，只在异放行结算）。
     *
     * ⚠ 绝不能写进 `enemyDefReduction`（通用）/ `enemyAnomalyDefReduction`（异常父层）：
     * 那两个是「所有异常都吃」的层，侵蚀 / 感电 / 紊乱 也会跟着吃 ⇒ 过度授予。
     * 异放行本来就经 `calcAnomalyDamage` 吃父层，`releaseModifier` 在其上**再加**，
     * 正好是「异放加成 + 异常加成相加」。
     */
    panel.enemyDefIgnoreDirect = panel.enemyDefIgnoreDirect + cycle.c2DefIgnore
    // 异放那半份 ⇒ 统一承载字段（与菲欧妮/普罗米娅同族），既让面板可显示，也给 releaseModifier 做读数源
    panel.enemyAnomalyReleaseDefReduction = panel.enemyAnomalyReleaseDefReduction + cycle.c2DefIgnore
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
    note: `第三段绝对音准 #3 命中异常目标触发（次数=应援能量/2+全场应援）；基底属性取基底异常元素主施加者，结算区=爱芮。全场应援=终结×3层（影画6 另 +floor((有效战斗时间−首次放大)/6)，妄想内异常触发 6 秒CD上限近似）。`,
  })
}

function patchAireExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = cinemaLevelOf(cfg.aireCinemaLevel)
  if (cinema < 6) return
  /**
   * 6 命 +40% 的作用范围 = 原文点名的两个载体：**强化版[普通攻击：绝对音准]**（妄想时刻内替换出的
   * #5 行 1501008）与 **[终结技]**。
   *
   * CC-561：首次放大之前打的是普通版 #3（1501007），它**不是**强化版 ⇒ 不给 +40%。
   * 此前对 1501005/1501006/1501007/1501022 一律加 +40%，前提是「妄想时刻从 t=0 起全覆盖」；
   * 那个前提已被首次放大时间纠正，故收窄到强化版行（非强化行改由 aireEnhancedPitchShare 拆出）。
   */
  for (const exec of executions) {
    if (!exec.moveId) continue
    if (exec.moveId === AIRE_ULTIMATE_MOVE_ID) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + AIRE_C6_ETHANOL_DMG_BONUS
      exec.skillTableNote = `${exec.skillTableNote ?? ''}；影画6 终结技以太伤害+${AIRE_C6_ETHANOL_DMG_BONUS}%`
    } else if (exec.moveId === AIRE_ENHANCED_PITCH_MOVE_ID) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + AIRE_C6_ETHANOL_DMG_BONUS
      exec.skillTableNote = `${exec.skillTableNote ?? ''}；影画6 强化绝对音准以太伤害+${AIRE_C6_ETHANOL_DMG_BONUS}%`
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
      { label: '影画6进场喧响', value: `+${cycle.c6DecibelGift}`, detail: '进场 1200（整局一次）' },
      {
        label: '影画6妄想时刻全场应援',
        value: `+${cycle.c6CheerLayers} 层`,
        detail: `首次放大 ${cycle.firstUltTime}s 后，每 6s 至多 1 层（有效战斗时间扣无敌）`,
      },
      {
        label: '影画4异放回能/喧响',
        value: `${cycle.c4EnergyGift} 能量 / ${cycle.c4DecibelGift} 喧响`,
        detail: '异放 10s 一次 × (4 能量 + 70 喧响)，整局总量',
      },
    ],
    footer: cycle.note,
  }]
}

/**
 * 异放专属减防（影画2 的「触发[异放]」那半）：**只在异放事件结算**。
 *
 * 用户口径：「异放减防就是异常减防的子集，只在异放事件时计算；异放可以吃异放加成和异常加成相加，
 * 侵蚀这种父事件吃不了异放加成」。⇒ 本函数返回的量由 `damagePool#pushRelease` 仅加到异放行，
 * 与面板 `enemyAnomalyDefReduction`（父层，一切异常都吃）**加算**。
 */
function aireReleaseModifier({ self }: ReleaseModifierInput): ReleaseModifier {
  const v = self.panel?.enemyAnomalyReleaseDefReduction ?? 0
  return v > 0
    ? { enemyResReduction: 0, enemyDefReduction: v, note: `；影画2：异放无视 ${v}% 防御（releaseModifier 异放专属）` }
    : { enemyResReduction: 0, note: '' }
}

export const aireMechanic: AgentMechanicModule = {
  id: 'agent:aire',
  agentIds: [AIRE_ID],
  // CC-80：终结技开启帷幕 1:1（原 mechanics/teamVeil.ts 写死集合）
  teamVeilCount: ({ ultimateCount }) => ultimateCount,
  name: '爱芮·控场核心',
  description: '异常精通+90、影画1以太积蓄抗性无视+异放暴击、影画2无视防御、影画4异放回能/喧响、影画6进场喧响+强化直伤；核心异放已按异常比例结算。',
  settings: [
    {
      id: 'aire.firstUltTime',
      label: '首次放大时间',
      description: '爱芮第一次开出终结技、进入[妄想时刻]的局内秒数（0-180s，玩家通常 30s 开大）。影画6 的「妄想时刻内敌人进入属性异常 ⇒ +1 层[全场应援]（6s 内至多一次）」= floor((战斗时间−无敌时间−首次放大时间)/6)，强化版绝对音准占比同此窗口；置 0 = 旧口径（进场即妄想时刻）。',
      default: AIRE_FIRST_ULT_SECONDS,
      min: 0,
      max: 180,
      step: 1,
      suffix: 's',
    },
    { id: 'aire.c2DelusionCoverage', label: '妄想时刻覆盖率', description: '影画2妄想时刻内额外无视8%防御的整局覆盖率（独立于上方首次放大时间，按需手动调）', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'aire.absolutePitchCount', label: '绝对音准#3次数上限', description: '第三段[普通攻击：绝对音准 #3]整局次数的**上限**。次数自动 = 应援能量/2 + 全场应援；调低 = 你手动吞掉一部分。0 = 不设上限。', default: 0, min: 0, max: 200, step: 1 },
    { id: 'aire.cheerEnergyBonus', label: '应援能量额外', description: '应援能量总量额外补充（自动公式已含强特×3+连携×4+帷幕4个/次×全队帷幕次数，此处补甜心四段等次要来源）', default: 0, min: 0, max: 400, step: 10 },
  ],
  applyPanel: applyAirePanel,
  releaseModifier: aireReleaseModifier,
  buildCharConfig: buildAireCharConfig,
  buildAnomalyEvents: buildAireAnomalyEvents,
  patchExecutions: patchAireExecutions,
  /**
   * 影画4 异放回能（整局总量）：异放每 10s 至多一次 × 4 点能量。
   *
   * CC-561：此前写进 `initialEnergyGift`（结果卡「开局赠送」）——那是**进场**通道，
   * 把战斗内累计贴上去会让「开局赠送」显示 40+72=112，且提前成种子参与强特次数推导。
   * 改走引擎通用「角色专属能量项」通道（结果卡单列一行，不乘效率，见 `calcEnergySource`）。
   */
  bonusEnergy({ cfg }) {
    const value = Number(cfg.aireC4EnergyGift ?? 0)
    return value > 0
      ? [{ key: 'aireC4ReleaseEnergy', label: '影画4异放回能', value, detail: '异放 10s CD 上限 × 4 点（整局总量）' }]
      : []
  },
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
    /** 甜蜜普攻四段的循环秒数（basicComboCycleSeconds） */
    aireBasicCheerCycleSeconds?: number
    /** 「绝对音高」动作时长（秒，缺省 1） */
    airePitchActionTime?: number
    /** 强化「绝对音高」动作时长（秒，缺省 1） */
    aireEnhancedPitchActionTime?: number
    /** 影画4 异放回能整局总量（buildCharConfig 写，bonusEnergy 读） */
    aireC4EnergyGift?: number
    /** 影画4 异放喧响整局总量（buildCharConfig 写，同时累加进 extraSelfDecibelReward；结果卡展示读） */
    aireC4DecibelGift?: number
  }
}

/** r407：本模块私有结果键（原塞在 `specResources['aire_cycle']`，与 spec 账本混用同一无类型通道） */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 艾瑞循环明细 */
    aireCycle?: AireCycle
  }
}

// 异放专属减防已改用公共字段 enemyAnomalyReleaseDefReduction（与菲欧妮/普罗米娅同族，面板可显示）
