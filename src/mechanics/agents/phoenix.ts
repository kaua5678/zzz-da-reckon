/**
 * 菲欧妮（1641，火属性·异常，坎卜斯黑枝）—— nanoka 3.3.12+19629936（v12 正式数值）。
 * 原文来源：data/raw/nanoka_missing/full/1641.json（证据契约 data/recordings/1641.json）。
 *
 * - 核心被动·涅槃：异常精通 **+85**；[灼蚀]（v12 取代旧[脆弱]）——队伍任意角色造成属性异常伤害时
 *   使敌人陷入 20 秒；[灼蚀] 敌人受到属性异常伤害**有概率暴击**：
 *   · 基础暴击率 30%、暴击伤害 **25%**（v12 不再随异常角色数分档）；
 *   · 菲欧妮**初始异常掌控 > 155** 时，每点 +0.7% 暴击率；
 *   · 初始异常掌控达 **255** 时暴击率达到最大值（30 + 0.7×100 = 100）。
 *   · **[灼蚀] 敌人每 8 秒受到菲欧妮 50% 攻击力火属性伤害，视为[强化特殊技]伤害**（v12 新增，
 *     走 direct_damage 事件通道，非异放）。
 * - 额外能力：队伍有其他[异常]或同阵营角色 → [灼蚀] 敌人受到属性异常伤害的**暴击伤害 +15%**
 *   （v12 起固定 +15，不再按异常角色数 2/3 → 25%/40%）。
 * - 异放（固定 releaseMultiplier）：
 *   · [普通攻击：焚罪]（1641005）终结一击 225+20×(s-1)，暴击时暴伤额外 +40%；
 *   · [烬火追魂]（1641019）终结一击 300+27×(s-1)，暴击时暴伤额外 +40%；
 *   · 影画4：上述两者命中异常状态敌人时**额外触发一次异放，固定 600%**。
 * - [燔焰]：上限 120；[燃烧攻击]（普攻三/四段、熔毁、燎斩、眩焰、坠阳、连携、终结）造成伤害时按
 *   倍率表 attack_data_0 回复；完美格挡 +5（10 秒一次）；影画1 效率 +15%。
 *   满 90 长按普攻发动[焚罪]（消耗 90 点）。
 * - [升变]：发动[坠阳]获得 1 点（上限 1）；影画1 入场 +1；影画6 眩焰 +1；持有可发动[燎斩]（1641023）。
 * - [枯荣]：发动强化特殊技进入 20 秒；[枯荣]下发动[眩焰]后，下次[眩焰]替换为[坠阳]。
 *   ⇒ 强特循环 = 眩焰(40) → 坠阳(40, +1升变) → 燎斩(0 耗能，消耗升变)。
 * - 影画1：入场 +1 升变；[灼蚀] 暴伤额外 +25%；[燃烧攻击] 燔焰获取效率 +15%。
 * - 影画2：[灼烧]持续时间 +2 秒；对[灼蚀] 敌人造成的伤害 +30%（dmgBonus）。
 * - 影画4：焚罪/烬火追魂终结一击额外一次异放 600%。
 * - 影画6：无视目标 15% 全属性伤害抗性；眩焰获得 1 点升变；异放无视 40% 防御力。
 * - [烬火追魂]（1641019，191.2%）不占前台时间（收尾追加攻击，卢西娅 1451007 先例），
 *   计数 = 终结次数（[生竭] → 下一次换入前场触发）。
 *
 * 未建模（spec notes 在册）：[生竭]/[重明] 状态机本体（回血无乘区）、[枯荣] 逐时序状态机
 * （按「每轮眩焰→坠阳→燎斩」稳态口径）、[灼烧] 持续时间 +2 秒的 DPS 折算（异常 DPS 走引擎异常池）。
 */
import { clampRatio, whole } from '@/utils/finiteClamp'
import type {
  AgentCharConfigInput,
  AgentExSpecialTimeInput,
  AgentEventInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  ReleaseModifier,
  ReleaseModifierInput,
} from '../types'
import type { CharacterResourceResult, MechanicSetting } from '@/types/resource'
import { mechanicSettingReader, capOfAuto } from '@/utils/mechanicSettingCfg'
import { getRowValue } from '@/data/moveTableQueries'
import { moduleExecRow } from '@/mechanics/moduleExecRow'
import { cinemaLevelOf } from '@/data/cinemaLevel'
import { additionalAbilityActiveOf } from '@/core/additionalAbilityActive'
import { minusInvincibleTime } from '@/core/effectiveTime'

const setting = mechanicSettingReader(() => settings)
export const PHOENIX_ID = '1641'
/** 核心被动：异常精通 +85（v12；旧 40） */
export const PHOENIX_CORE_PROFICIENCY = 85
/** [灼蚀]：基础暴击率 30%、暴击伤害 25%（v12） */
export const PHOENIX_SCORCH_CRIT_RATE = 30
export const PHOENIX_SCORCH_CRIT_DMG = 25
/** [灼蚀]：初始异常掌控 > 155 每点 +0.7% 暴击率；达 255 时封顶 */
export const PHOENIX_SCORCH_MASTERY_THRESHOLD = 155
export const PHOENIX_SCORCH_PER_POINT_RATE = 0.7
export const PHOENIX_SCORCH_MASTERY_CAP = 255
/** [灼蚀] 每 8 秒 50% 攻击力火伤（视为强化特殊技伤害） */
export const PHOENIX_SCORCH_DOT_INTERVAL = 8
export const PHOENIX_SCORCH_DOT_RATIO = 50
/** 额外能力：[灼蚀] 敌人受到属性异常伤害的暴击伤害 +15（v12 固定，不再分档） */
export const PHOENIX_ADDITIONAL_SCORCH_CRIT_DMG = 15
/** 影画1：[灼蚀] 暴伤额外 +25%；燔焰获取效率 +15%；入场 +1 升变 */
export const PHOENIX_C1_CRIT_DMG = 25
export const PHOENIX_C1_EMBER_EFFICIENCY = 15
/** 影画2：对[灼蚀] 敌人造成的伤害 +30% */
export const PHOENIX_C2_SCORCH_DMG_BONUS = 30
/** 影画2：施加[灼烧]时其持续时间 +2 秒（走 teamAnomalyDurationBonus 通用臂） */
export const PHOENIX_C2_BURN_DURATION_BONUS = 2
/** 影画4：焚罪/烬火追魂终结一击额外一次异放，固定 600% 倍率 */
export const PHOENIX_C4_RELEASE_MULT = 600
/** 影画6：无视 15% 全属性伤害抗性；异放无视 40% 防御 */
export const PHOENIX_C6_RES_IGNORE = 15
export const PHOENIX_C6_RELEASE_DEF_IGNORE = 40
/** 异放暴击时暴伤额外 +40%（焚罪/烬火追魂共有） */
export const PHOENIX_RELEASE_CRIT_EXTRA_DMG = 40

/** moveId（param 空间，v12 重排后） */
export const PHOENIX_CHARGED_MOVE_ID = '1641005' // 普通攻击：焚罪（长按，消耗 90 燔焰）
export const PHOENIX_BRANCH_MOVE_ID = '1641006' // 普通攻击：熔毁（分支攻击）
export const PHOENIX_EX_FIRST_MOVE_ID = '1641008' // 强化特殊技：眩焰（40 能量）
export const PHOENIX_EX_SECOND_MOVE_ID = '1641009' // 强化特殊技：坠阳（40 能量，+1 升变）
export const PHOENIX_EX_LIAOZHAN_MOVE_ID = '1641023' // 强化特殊技：燎斩（消耗 1 升变，不耗能）
export const PHOENIX_ULT_MOVE_ID = '1641013' // 终结技：万死重明
export const PHOENIX_ENTRY_MOVE_ID = '1641019' // 烬火追魂（[生竭] 后下一次换入前场）
export const PHOENIX_CHAIN_MOVE_ID = '1641012' // 连携技：绝处逢生
/** 长按普攻消耗燔焰 */
export const PHOENIX_CHARGED_EMBER_COST = 90
/** [燔焰] 上限（原文「菲欧妮最多拥有120点[燔焰]」） */
export const PHOENIX_EMBER_CAP = 120
/**
 * [燃烧攻击]集合（燔焰来源：倍率表 `attack_data_0` 列 = **每次命中的燔焰获取**）。
 *
 * 标度口径（2026-09-14 用户复核确认）：这批整型列统一 **×10000**——同一行的
 * `energy_gain_base=71040` 在 catalog 里就是 `energy_recovery 7.104`，
 * 故 `attack_data[1641004]=169072` → **16.9072 燔焰/次**（v12 重导后的真实值）。
 * 分支攻击 1641006（熔毁）为操作向量，滑块/人工次数覆盖。
 */
export const PHOENIX_COMBUSTION_MOVE_IDS: ReadonlySet<string> = new Set([
  '1641003', '1641004', // 普攻三/四段
  PHOENIX_BRANCH_MOVE_ID, // 分支攻击：熔毁
  PHOENIX_EX_LIAOZHAN_MOVE_ID, // 强化特殊技：燎斩
  PHOENIX_EX_FIRST_MOVE_ID, PHOENIX_EX_SECOND_MOVE_ID, // 眩焰 / 坠阳
  PHOENIX_CHAIN_MOVE_ID, PHOENIX_ULT_MOVE_ID, // 连携 / 终结
])
/** 平A段循环（普攻一~四段，燔焰按第三/四段命中计） */
export const PHOENIX_BASIC_SEGMENT_IDS: readonly string[] = ['1641001', '1641002', '1641003', '1641004']
/** 异放固定倍率（满级 s=12）：焚罪 225+20×11=445、烬火追魂 300+27×11=597 */
export const PHOENIX_RELEASE_BASE = { charged: 225, chargedPerLevel: 20, entry: 300, entryPerLevel: 27 } as const
/** 通用技能等级口径：影画3 +2、影画5 累计 +4 */
export function phoenixSkillLevel(cinemaLevel: number): number {
  const cinema = cinemaLevelOf(cinemaLevel)
  return 12 + (cinema >= 5 ? 4 : cinema >= 3 ? 2 : 0)
}

export interface PhoenixCycle {
  cinemaLevel: number
  additionalActive: boolean
  coreProficiency: number
  scorchCritRate: number
  scorchCritDmg: number
  scorchDmgBonus: number
  scorchDotCount: number
  emberCap: number
  chargedCount: number
  exCount: number
  liaozhanCount: number
  entryCount: number
  c1CritDmg: number
  c2ScorchDmgBonus: number
  c4ReleaseMult: number
  c6ResIgnore: number
  c6ReleaseDefIgnore: number
  note: string
}

/**
 * [灼蚀] 异常暴击（v12）：率 = 30 + 0.7×min(掌控,255)−155 的超出量（达 255 封顶 = 100）；
 * 伤 = 25 + 额外能力 15 + 影画1 25。
 *
 * `mastery` 必须是**初始异常掌控**（局外面板）——原文两处都写「初始」。
 */
export function computePhoenixScorchCrit(input: {
  initialMastery: number
  additionalActive: boolean
  cinemaLevel: number
}): { rate: number; dmg: number } {
  const mastery = Math.max(0, Math.min(PHOENIX_SCORCH_MASTERY_CAP, Number(input.initialMastery) || 0))
  const rate = PHOENIX_SCORCH_CRIT_RATE
    + Math.max(0, mastery - PHOENIX_SCORCH_MASTERY_THRESHOLD) * PHOENIX_SCORCH_PER_POINT_RATE
  const cinema = cinemaLevelOf(input.cinemaLevel)
  const dmg = PHOENIX_SCORCH_CRIT_DMG
    + (input.additionalActive ? PHOENIX_ADDITIONAL_SCORCH_CRIT_DMG : 0)
    + (cinema >= 1 ? PHOENIX_C1_CRIT_DMG : 0)
  return { rate: Math.min(100, rate), dmg }
}

/**
 * 异放专属暴击参数（引擎 `releaseCrit` 通道，爱芮同款）：率取[灼蚀]档，伤取[灼蚀]档 + 40。
 *
 * 原文：「该次[异放]效果触发暴击时，其暴击伤害额外提升40%」——**只加在异放这一跳上**，
 * 不是面板暴伤，所以必须走事件级 releaseCrit 而不是 panel。
 */
function releaseCritOf(crit: { rate: number; dmg: number }, _mastery: number) {
  return {
    releaseCrit: {
      ratePct: crit.rate,
      dmgPct: crit.dmg + PHOENIX_RELEASE_CRIT_EXTRA_DMG,
    },
  }
}

/**
 * 平A三/四段（燃烧攻击）命中次数：按段循环计数（第三段=打完前两段后到达，第四段=再打完第三段）。
 */
export function phoenixBasicCombustionHits(basicTime: number, cycle: { moveId: string; actionTime: number }[]): { third: number; fourth: number } {
  if (cycle.length !== 4 || basicTime <= 0) return { third: 0, fourth: 0 }
  const cycleTime = cycle.reduce((s, seg) => s + seg.actionTime, 0)
  if (cycleTime <= 0) return { third: 0, fourth: 0 }
  const full = Math.floor(basicTime / cycleTime)
  const tail = basicTime - full * cycleTime
  const beforeThird = cycle[0].actionTime + cycle[1].actionTime
  const third = full + (tail >= beforeThird - 1e-9 ? 1 : 0)
  const fourth = full + (tail >= beforeThird + cycle[2].actionTime - 1e-9 ? 1 : 0)
  return { third, fourth }
}

/**
 * 燔焰收入：按 **moveId × 倍率表 attack_data_0** 直算。
 * ⚠️ buildExecutions 阶段 executions 的 `totalSpecialResourceRecovery` **尚未 enrich 回填**，直接读是 0。
 * 完美格挡 +5（10 秒一次）按 cfg.perfectBlockCount/10 折算并入。
 */
function phoenixEmberIncome(cfg: AgentCharConfigInput['cfg'], state: AgentResourceInput['state'] | undefined, executions: AgentResourceInput['executions']): number {
  const meta = cfg.phoenixCombustionMeta ?? {}
  const basicCycle = cfg.phoenixBasicCycle ?? []
  const basicTime = Math.max(0, state?.basicAttackTime ?? 0)
  const { third, fourth } = phoenixBasicCombustionHits(basicTime, basicCycle)
  let income = third * (meta['1641003'] ?? 0) + fourth * (meta['1641004'] ?? 0)
  for (const e of executions) {
    if (!e.moveId || !PHOENIX_COMBUSTION_MOVE_IDS.has(e.moveId)) continue
    if (e.moveId === '1641003' || e.moveId === '1641004') continue // 平A段已按段循环计
    if (e.moveId === PHOENIX_BRANCH_MOVE_ID) continue // 分支攻击是操作向量
    income += Math.max(0, e.count) * (meta[e.moveId] ?? 0)
  }
  // 完美格挡 +5 燔焰 / 10 秒一次
  const blocks = Math.max(0, Math.floor(cfg.perfectBlockCount))
  income += Math.floor(blocks / 10) * 5
  return income
}

/** 长按普攻（焚罪）次数：自动 = floor(燔焰收入×影画1效率/90)；滑块 = **上限**（用户口径 2026-10-19），0 = 不设上限 */
export function phoenixChargedCount(cfg: AgentCharConfigInput['cfg'], state: AgentResourceInput['state'] | undefined, executions: AgentResourceInput['executions']): number {
  const cinema = cinemaLevelOf(cfg.phoenixCinemaLevel)
  const eff = cinema >= 1 ? 1 + PHOENIX_C1_EMBER_EFFICIENCY / 100 : 1
  const auto = Math.floor(phoenixEmberIncome(cfg, state, executions) * eff / PHOENIX_CHARGED_EMBER_COST)
  return capOfAuto(auto, whole(setting(cfg, 'phoenix.chargedAttackCount')))
}

function buildPhoenixCharConfig({ cfg, cinemaLevel, panel, skills, outOfCombatPanel }: AgentCharConfigInput): void {
  cfg.phoenixCinemaLevel = cinemaLevel
  // 原文两处都写「初始异常掌控」⇒ 取局外面板
  cfg.phoenixInitialMastery = outOfCombatPanel ? outOfCombatPanel.anomalyMastery : panel.anomalyMastery
  // 强化特殊技：眩焰（40 能量）走通用强特通道；[枯荣] 循环下每轮另有坠阳（40）+ 燎斩（0）。
  const special = skills.categories.find(c => c.id === 'special')?.moves
  const exFirst = special?.find(m => m.id === PHOENIX_EX_FIRST_MOVE_ID)
  const exSecond = special?.find(m => m.id === PHOENIX_EX_SECOND_MOVE_ID)
  if (exFirst) {
    cfg.exSpecialMoveId = PHOENIX_EX_FIRST_MOVE_ID
    if (exFirst.actionTime) cfg.exSpecialActionTime = exFirst.actionTime
    // 一轮[枯荣]强特 = 眩焰(40) + 坠阳(40) ⇒ 引擎按「轮」计次数，收费必须收两段合计 80。
    // 柏妮思同款（`(c1+c2)/2` 合并计价）：只收 40 会让强特次数翻倍（实测可用能量 473 却排出 11 轮）。
    const ecFirst = parseFloat(exFirst.energyCost?.['Energy Cost'] ?? '')
    const ecSecond = parseFloat(exSecond?.energyCost?.['Energy Cost'] ?? '')
    const perRound = (Number.isFinite(ecFirst) && ecFirst > 0 ? ecFirst : 0)
      + (Number.isFinite(ecSecond) && ecSecond > 0 ? ecSecond : 0)
    if (perRound > 0) cfg.exSpecialEnergyConsume = perRound
  }
  const all = skills.categories.flatMap(c => c.moves)
  const metaOf = (moveId: string) => {
    const m = all.find(mm => mm.id === moveId)
    return {
      moveId,
      actionTime: m?.actionTime ?? 0,
      // CC-242：取行值走 data getRowValue（吃逻辑编辑器行规则，作用面 §24.85 ④ / §24.88）
      damage: getRowValue(m, 'damage'),
      decibelRecovery: getRowValue(m, 'decibel_recovery'),
      energyCost: parseFloat(m?.energyCost?.['Energy Cost'] ?? '') || 0,
    }
  }
  // 燃烧攻击燔焰获取（attack_data_0 列，moveId → 每次命中燔焰）
  const combustion: Record<string, number> = {}
  for (const moveId of PHOENIX_COMBUSTION_MOVE_IDS) {
    const m = all.find(mm => mm.id === moveId)
    combustion[moveId] = getRowValue(m, 'attack_data_0')
  }
  cfg.phoenixCombustionMeta = combustion
  cfg.phoenixBasicCycle = PHOENIX_BASIC_SEGMENT_IDS.map(metaOf)
  cfg.phoenixChargedMeta = metaOf(PHOENIX_CHARGED_MOVE_ID)
  cfg.phoenixExSecondMeta = metaOf(PHOENIX_EX_SECOND_MOVE_ID)
  cfg.phoenixLiaozhanMeta = metaOf(PHOENIX_EX_LIAOZHAN_MOVE_ID)
  cfg.phoenixEntryMeta = metaOf(PHOENIX_ENTRY_MOVE_ID)
}

/**
 * 面板层（v12）：核心异常精通 +85；影画6 无视 15% 全属性伤害抗性；影画2 对[灼蚀]目标增伤 30%。
 *
 * [灼蚀] 异常暴击（率/伤）**不在这里写**——走 spec teamBuffs 声明式承载
 * （phoenix.scorch_anomaly_crit_*），公式读**初始**异常掌控；自体与队友同吃，引擎 EV 乘区通用消费。
 * 防双通道双计。
 */
function applyPhoenixPanel({ cinemaLevel, panel }: AgentPanelInput): void {
  if (!panel) return
  const cinema = cinemaLevelOf(cinemaLevel)
  panel.anomalyProficiency = panel.anomalyProficiency + PHOENIX_CORE_PROFICIENCY
  if (cinema >= 6) panel.enemyResReduction = panel.enemyResReduction + PHOENIX_C6_RES_IGNORE
  // 影画2：对[灼蚀]状态下的敌人造成的伤害 +30%（[灼蚀] 由队伍异常伤害施加，默认满覆盖）
  if (cinema >= 2) panel.dmgBonus = panel.dmgBonus + PHOENIX_C2_SCORCH_DMG_BONUS
}

/** 影画6：异放限定无视 40% 防御（普罗米娅同款通道） */
function phoenixReleaseModifier({ self }: ReleaseModifierInput): ReleaseModifier {
  return self.cinemaLevel >= 6
    ? { enemyResReduction: 0, enemyDefReduction: PHOENIX_C6_RELEASE_DEF_IGNORE, note: `；影画6：异放无视 ${PHOENIX_C6_RELEASE_DEF_IGNORE}% 防御（releaseModifier 异放限定）` }
    : { enemyResReduction: 0, note: '' }
}

/**
 * 执行行：焚罪（长按普攻）、燎斩（拥有升变时的强化特殊技）、烬火追魂（终结后换入）。
 *
 * 强特循环口径（[枯荣] 稳态）：每轮 = 眩焰（通用 exSpecialCount 通道，40 能量）
 * → 坠阳（40 能量，+1 升变）→ 燎斩（消耗升变，0 耗能）。
 * 坠阳与燎斩各自按 exCount 计次（一轮一次），坠阳耗能 40 由本行显式记账。
 */
function buildPhoenixExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const chargedCount = phoenixChargedCount(cfg, state, executions)
  cfg.phoenixChargedCount = chargedCount
  const exCount = Math.max(0, state.exSpecialCount)
  const ultCount = Math.max(0, state.ultimateCount)
  cfg.phoenixExCount = exCount
  cfg.phoenixEntryCount = ultCount

  const chargedMeta = cfg.phoenixChargedMeta
  if (chargedMeta && chargedCount > 0) {
    executions.push(moduleExecRow({
      moveId: chargedMeta.moveId,
      moveName: '普通攻击：焚罪（消耗90燔焰）',
      category: 'basic',
      element: 'fire',
      count: chargedCount,
      actionTime: chargedMeta.actionTime,
      totalTime: chargedCount * chargedMeta.actionTime,
      skillTableNote: `燔焰驱动 ×${chargedCount}（90 点/次）`,
    }))
  }
  // 坠阳（1641009）：[枯荣] 下眩焰之后每轮一次，40 能量；+1 升变
  const exSecondMeta = cfg.phoenixExSecondMeta
  if (exSecondMeta && exCount > 0) {
    executions.push(moduleExecRow({
      moveId: exSecondMeta.moveId,
      moveName: '强化特殊技：坠阳',
      category: 'special',
      element: 'fire',
      count: exCount,
      actionTime: exSecondMeta.actionTime,
      totalTime: exCount * exSecondMeta.actionTime,
      energyConsume: exSecondMeta.energyCost,
      totalEnergyConsume: exCount * exSecondMeta.energyCost,
      skillTableNote: `[枯荣]下每轮眩焰后发动 ×${exCount}（40 能量/次，获得 1 点[升变]）`,
    }))
  }
  // 燎斩（1641023）：消耗 1 点[升变]，不耗能
  const liaozhanMeta = cfg.phoenixLiaozhanMeta
  if (liaozhanMeta && exCount > 0) {
    executions.push(moduleExecRow({
      moveId: liaozhanMeta.moveId,
      moveName: '强化特殊技：燎斩',
      category: 'special',
      element: 'fire',
      count: exCount,
      actionTime: liaozhanMeta.actionTime,
      totalTime: exCount * liaozhanMeta.actionTime,
      skillTableNote: `消耗[升变] ×${exCount}（坠阳产出 1 点/轮，不耗能量）`,
    }))
  }
  // 烬火追魂（1641019）：[生竭] → 下一次换入前场发动，计数 = 终结次数；收尾追加攻击不占前台时间
  const entryMeta = cfg.phoenixEntryMeta
  if (entryMeta && ultCount > 0) {
    executions.push(moduleExecRow({
      moveId: entryMeta.moveId,
      moveName: '烬火追魂（终结后换入发动）',
      category: 'chain',
      element: 'fire',
      count: ultCount,
      actionTime: entryMeta.actionTime,
      skillTableNote: `[生竭]后换入发动 ×${ultCount}（计数=终结次数；收尾追加攻击不占前台时间）`,
    }))
  }
}

/** 必做前台时间：通用强特（眩焰）+ 坠阳 + 燎斩 + 焚罪 */
function phoenixExSpecialTime({ cfg, exSpecialCount }: AgentExSpecialTimeInput): { necessaryTime: number; comboAlignTime: number } {
  const exTime = Math.max(0, exSpecialCount) * cfg.exSpecialActionTime
  const chargedMeta = cfg.phoenixChargedMeta
  const chargedCount = whole(Number(cfg.phoenixChargedCount ?? 0))
  const chargedTime = chargedMeta ? chargedCount * chargedMeta.actionTime : 0
  const exSecond = cfg.phoenixExSecondMeta
  const liaozhan = cfg.phoenixLiaozhanMeta
  const exSecondTime = exSecond ? Math.max(0, exSpecialCount) * exSecond.actionTime : 0
  const liaozhanTime = liaozhan ? Math.max(0, exSpecialCount) * liaozhan.actionTime : 0
  return {
    necessaryTime: exTime + chargedTime + exSecondTime + liaozhanTime,
    comboAlignTime: exTime * cfg.exSpecialComboAlignRatio,
  }
}

/**
 * 事件层：
 * ① 异放（焚罪/烬火追魂终结一击，固定 releaseMultiplier，附异常暴击参数 releaseCrit）
 * ② 影画4：上述两者各**额外触发一次异放 600%**
 * ③ [灼蚀] DoT：每 8 秒 50% 攻击力火伤（direct_damage，视为强化特殊技伤害）
 */
function buildPhoenixAnomalyEvents({ cfg, events, totalTime }: AgentEventInput): void {
  const cinema = cinemaLevelOf(cfg.phoenixCinemaLevel)
  const s = phoenixSkillLevel(cinema)
  const coverage = clampRatio(setting(cfg, 'phoenix.releaseCoverage'))
  const chargedCount = whole(Number(cfg.phoenixChargedCount ?? 0))
  const entryCount = whole(Number(cfg.phoenixEntryCount ?? 0))
  const mastery = Number(cfg.phoenixInitialMastery ?? 0)
  const additionalActive = additionalAbilityActiveOf(cfg.panel)
  const crit = computePhoenixScorchCrit({ initialMastery: mastery, additionalActive, cinemaLevel: cinema })

  if (coverage > 0 && chargedCount > 0) {
    const chargedRelease = Math.round(chargedCount * coverage)
    if (chargedRelease > 0) {
      const mult = PHOENIX_RELEASE_BASE.charged + PHOENIX_RELEASE_BASE.chargedPerLevel * (s - 1)
      events.push({
        eventId: 'phoenix_charged_release',
        eventName: '焚罪终结一击·异放',
        eventType: 'release',
        element: 'dominant',
        carrierMoveId: PHOENIX_CHARGED_MOVE_ID,
        carrierMoveName: '普通攻击：焚罪（终结一击）',
        followCarrierInStun: true,
        count: chargedRelease,
        ...releaseCritOf(crit, mastery),
        formula: `releaseMultiplier=${mult}（225+20×(${s}-1)，固定倍率）+ 暴击时暴伤额外+${PHOENIX_RELEASE_CRIT_EXTRA_DMG}`,
        fields: [`releaseMultiplier=${mult}`, `charged=${chargedCount}`, `coverage=${coverage}`],
        note: '终结一击命中属性异常状态敌人触发；异放暴击时暴伤额外 +40%（异常暴击参数见 spec teamBuffs）。',
      })
    }
    if (cinema >= 4) {
      const c4Count = Math.round(chargedCount * coverage)
      if (c4Count > 0) {
        events.push({
          eventId: 'phoenix_c4_charged_release',
          eventName: '影画4·焚罪额外异放',
          eventType: 'release',
          element: 'dominant',
          carrierMoveId: PHOENIX_CHARGED_MOVE_ID,
          carrierMoveName: '普通攻击：焚罪（终结一击）',
          followCarrierInStun: true,
          count: c4Count,
          formula: `releaseMultiplier=${PHOENIX_C4_RELEASE_MULT}（固定倍率）`,
          fields: [`releaseMultiplier=${PHOENIX_C4_RELEASE_MULT}`, `charged=${chargedCount}`],
          note: '影画4：焚罪终结一击命中异常状态敌人时额外触发一次异放，固定 600%。',
        })
      }
    }
  }
  if (coverage > 0 && entryCount > 0) {
    const entryRelease = Math.round(entryCount * coverage)
    if (entryRelease > 0) {
      const mult = PHOENIX_RELEASE_BASE.entry + PHOENIX_RELEASE_BASE.entryPerLevel * (s - 1)
      events.push({
        eventId: 'phoenix_entry_release',
        eventName: '烬火追魂终结一击·异放',
        eventType: 'release',
        element: 'dominant',
        carrierMoveId: PHOENIX_ENTRY_MOVE_ID,
        carrierMoveName: '烬火追魂（终结一击）',
        followCarrierInStun: true,
        count: entryRelease,
        ...releaseCritOf(crit, mastery),
        formula: `releaseMultiplier=${mult}（300+27×(${s}-1)，固定倍率）+ 暴击时暴伤额外+${PHOENIX_RELEASE_CRIT_EXTRA_DMG}`,
        fields: [`releaseMultiplier=${mult}`, `entry=${entryCount}`, `coverage=${coverage}`],
        note: '烬火追魂终结一击命中属性异常状态敌人触发；异放暴击时暴伤额外 +40%。',
      })
    }
    if (cinema >= 4) {
      const c4Count = Math.round(entryCount * coverage)
      if (c4Count > 0) {
        events.push({
          eventId: 'phoenix_c4_entry_release',
          eventName: '影画4·烬火追魂额外异放',
          eventType: 'release',
          element: 'dominant',
          carrierMoveId: PHOENIX_ENTRY_MOVE_ID,
          carrierMoveName: '烬火追魂（终结一击）',
          followCarrierInStun: true,
          count: c4Count,
          formula: `releaseMultiplier=${PHOENIX_C4_RELEASE_MULT}（固定倍率）`,
          fields: [`releaseMultiplier=${PHOENIX_C4_RELEASE_MULT}`, `entry=${entryCount}`],
          note: '影画4：烬火追魂终结一击命中异常状态敌人时额外触发一次异放，固定 600%。',
        })
      }
    }
  }
  // ③ [灼蚀] 每 8 秒 50% 攻击力火伤（视为强化特殊技伤害）
  const scorchCoverage = clampRatio(setting(cfg, 'phoenix.scorchCoverage'))
  const effectiveSeconds = minusInvincibleTime(totalTime, cfg)
  const ticks = Math.max(0, Math.floor((effectiveSeconds * scorchCoverage) / PHOENIX_SCORCH_DOT_INTERVAL))
  if (ticks > 0) {
    events.push({
      eventId: 'phoenix_scorch_dot',
      eventName: '[灼蚀]周期火伤',
      eventType: 'direct_damage',
      element: 'fire',
      carrierMoveId: PHOENIX_CHARGED_MOVE_ID,
      carrierMoveName: '[灼蚀]',
      count: ticks,
      damageMultiplier: PHOENIX_SCORCH_DOT_RATIO,
      formula: `每 ${PHOENIX_SCORCH_DOT_INTERVAL}s 造成 ${PHOENIX_SCORCH_DOT_RATIO}% 攻击力火属性伤害；次数 = floor(战斗时长 × 覆盖率 / ${PHOENIX_SCORCH_DOT_INTERVAL})`,
      fields: ['totalTime', 'phoenix.scorchCoverage', 'PHOENIX_SCORCH_DOT_INTERVAL', 'PHOENIX_SCORCH_DOT_RATIO'],
      note: `[灼蚀] 敌人每 8 秒受到菲欧妮 50% 攻击力火伤（视为强化特殊技伤害）；次数按 ${effectiveSeconds.toFixed(1)}s（已扣无敌）× ${(scorchCoverage * 100).toFixed(0)}% 近似。异常暴击 率${crit.rate.toFixed(1)}%/伤${crit.dmg}% 由 spec teamBuffs 承载。`,
    })
  }
}

function buildPhoenixResourceResult({ cfg }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const cinema = cinemaLevelOf(cfg.phoenixCinemaLevel)
  const additionalActive = additionalAbilityActiveOf(cfg.panel)
  const crit = computePhoenixScorchCrit({
    initialMastery: Number(cfg.phoenixInitialMastery ?? 0),
    additionalActive,
    cinemaLevel: cinema,
  })
  return {
    phoenixCycle: {
      cinemaLevel: cinema,
      additionalActive,
      coreProficiency: PHOENIX_CORE_PROFICIENCY,
      scorchCritRate: Math.round(crit.rate * 100) / 100,
      scorchCritDmg: crit.dmg,
      scorchDmgBonus: cinema >= 2 ? PHOENIX_C2_SCORCH_DMG_BONUS : 0,
      scorchDotCount: 0,
      emberCap: PHOENIX_EMBER_CAP,
      chargedCount: whole(Number(cfg.phoenixChargedCount ?? 0)),
      exCount: whole(Number(cfg.phoenixExCount ?? 0)),
      liaozhanCount: whole(Number(cfg.phoenixExCount ?? 0)),
      entryCount: whole(Number(cfg.phoenixEntryCount ?? 0)),
      c1CritDmg: cinema >= 1 ? PHOENIX_C1_CRIT_DMG : 0,
      c2ScorchDmgBonus: cinema >= 2 ? PHOENIX_C2_SCORCH_DMG_BONUS : 0,
      c4ReleaseMult: cinema >= 4 ? PHOENIX_C4_RELEASE_MULT : 0,
      c6ResIgnore: cinema >= 6 ? PHOENIX_C6_RES_IGNORE : 0,
      c6ReleaseDefIgnore: cinema >= 6 ? PHOENIX_C6_RELEASE_DEF_IGNORE : 0,
      note: '[灼蚀] 异常暴击承载 = spec teamBuffs（含队友受益）；[生竭]/[重明] 状态机未建模（回血无乘区）；[枯荣] 按稳态循环（眩焰→坠阳→燎斩）。',
    },
  }
}

function buildPhoenixResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.phoenixCycle
  if (!cycle) return []
  return [{
    id: 'phoenix-cycle',
    title: '菲欧妮·灼蚀与燔焰',
    summary: `异常精通 +${cycle.coreProficiency} · [灼蚀] 暴击 率${cycle.scorchCritRate}%/伤${cycle.scorchCritDmg}% · 焚罪 ×${cycle.chargedCount} · 燎斩 ×${cycle.liaozhanCount}`,
    rows: [
      { label: '核心异常精通', value: `+${cycle.coreProficiency}`, detail: '计入面板' },
      { label: '[灼蚀] 异常暴击率', value: `${cycle.scorchCritRate}%`, detail: '30 + 0.7×(初始掌控−155)，255 封顶' },
      { label: '[灼蚀] 异常暴伤', value: `${cycle.scorchCritDmg}%`, detail: `25${cycle.additionalActive ? ' +额外能力15' : ''}${cycle.c1CritDmg > 0 ? ' +影画1 25' : ''}` },
      { label: '[灼蚀] 周期火伤', value: '8s/次 · 50%', detail: '视为强化特殊技伤害' },
      { label: '影画2目标增伤', value: `+${cycle.scorchDmgBonus}%`, detail: '对[灼蚀]敌人' },
      { label: '影画4额外异放', value: `${cycle.c4ReleaseMult}%`, detail: '焚罪/烬火追魂各一次' },
      { label: '影画6无视抗性', value: `+${cycle.c6ResIgnore}%`, detail: '全属性伤害抗性' },
      { label: '影画6异放无视防御', value: `+${cycle.c6ReleaseDefIgnore}%`, detail: '异放限定' },
      { label: '焚罪次数', value: `×${cycle.chargedCount}`, detail: '燔焰收入/90' },
      { label: '燎斩次数', value: `×${cycle.liaozhanCount}`, detail: '[升变]驱动（=眩焰次数）' },
      { label: '烬火追魂次数', value: `×${cycle.entryCount}`, detail: '=终结次数' },
    ],
    footer: cycle.note,
  }]
}

const settings: MechanicSetting[] = [
  {
    id: 'phoenix.chargedAttackCount',
    label: '菲欧妮·焚罪次数上限',
    description: '[普通攻击：焚罪]（消耗 90 燔焰）整局次数的**上限**。次数自动 = 燃烧攻击行 attack_data_0 燔焰收入 × 影画1效率1.15 ÷ 90；调低 = 你手动吞掉一部分。0 = 不设上限。',
    default: 0,
    min: 0,
    max: 40,
    step: 1,
    suffix: '次',
  },
  {
    id: 'phoenix.releaseCoverage',
    label: '菲欧妮·异放触发覆盖率',
    description: '焚罪/烬火追魂终结一击命中「属性异常状态敌人」的占比（异常队默认满覆盖）。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: 'phoenix.scorchCoverage',
    label: '菲欧妮·[灼蚀]覆盖率',
    description: '[灼蚀]（20 秒，队伍任意角色造成属性异常伤害时施加）的整局覆盖率——[灼蚀]周期火伤（每 8 秒 50% 攻击力）按此折算。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
]

export const phoenixMechanic: AgentMechanicModule = {
  id: 'agent:phoenix',
  agentIds: [PHOENIX_ID],
  name: '菲欧妮·涅槃',
  description: 'v12：核心异常精通+85、[灼蚀] 异常暴击（率30+0.7×(初始掌控−155) 封顶255、伤25）+额外能力暴伤+15、[灼蚀]周期火伤（8s/50%攻击力）；异放（焚罪445/烬火追魂597，暴击再+40暴伤）+影画4 额外600%；[燔焰]120→焚罪90、[升变]→燎斩、[枯荣] 眩焰→坠阳→燎斩稳态；影画6 无视15%抗性+异放无视40%防御。',
  applyPanel: applyPhoenixPanel,
  buildCharConfig: buildPhoenixCharConfig,
  estimateExSpecialTime: phoenixExSpecialTime,
  buildExecutions: buildPhoenixExecutions,
  buildAnomalyEvents: buildPhoenixAnomalyEvents,
  buildResourceResult: buildPhoenixResourceResult,
  resourceSections: buildPhoenixResourceSections,
  releaseModifier: phoenixReleaseModifier,
  /**
   * 影画2：「菲欧妮对敌人施加[灼烧]效果时，该效果的持续时间提升2秒」。
   *
   * 走引擎通用臂 `teamAnomalyDurationBonus`（柏妮思 火+3 / 丽娜 电+3 / 简 物理+5 同款，**加算**）。
   * 影响乱流/紊乱窗口与持续单属性覆盖——按你的口径这是经典字段，不该省。
   */
  teamAnomalyDurationBonus: ({ element, slot, team }) => {
    // `MechanicTeamMember.cinemaLevel` 已归一化（非空槽恒有值）⇒ 直接比较，不走 cinemaLevelOf、也不写 `?? 0`
    const member = team.find(m => m.slot === slot)
    if (!member || member.cinemaLevel < 2) return 0
    return element === 'fire' ? PHOENIX_C2_BURN_DURATION_BONUS : 0
  },
  /**
   * **烬火追魂（`1641019`）不扣喧响**：原文首句「当菲欧妮处于[生竭]状态时，下一次普通换入/
   * 快速支援/招架支援换入前场时发动」——触发条件是**状态+换入**，没有「喧响等级达到[极]」购买句
   * ⇒ 它不由喧响购买。父块 `1641013`（终结技）与它同在执行行池里且父块照收 3000。
   * 只免喧响，不免窗口时间。
   */
  axisMoveFreeOfDecibel: moveId => moveId === PHOENIX_ENTRY_MOVE_ID,
  settings,
}


/** 招式元数据（buildCharConfig 从 catalog 预存） */
interface PhoenixMoveMeta { moveId: string; actionTime: number; damage: number; decibelRecovery: number; energyCost: number }

/**
 * D2（CC-359/362）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 菲尼克斯命座等级（buildCharConfig 写） */
    phoenixCinemaLevel?: number
    /** 菲尼克斯**初始**异常掌控（buildCharConfig 由局外面板预存；[灼蚀] 暴击公式读它） */
    phoenixInitialMastery?: number
    /** 菲尼克斯燃烧攻击燔焰获取（moveId → 每次命中燔焰，attack_data_0 列） */
    phoenixCombustionMeta?: Record<string, number>
    /** 菲尼克斯平A各段元数据（buildCharConfig 从 catalog 预存） */
    phoenixBasicCycle?: PhoenixMoveMeta[]
    /** 菲尼克斯焚罪（长按普攻）招式元数据 */
    phoenixChargedMeta?: PhoenixMoveMeta
    /** 菲尼克斯坠阳（强特第二段）招式元数据 */
    phoenixExSecondMeta?: PhoenixMoveMeta
    /** 菲尼克斯燎斩（升变消耗）招式元数据 */
    phoenixLiaozhanMeta?: PhoenixMoveMeta
    /** 菲尼克斯烬火追魂（终结后换入）招式元数据 */
    phoenixEntryMeta?: PhoenixMoveMeta
    /** 菲尼克斯焚罪次数（资源阶段写） */
    phoenixChargedCount?: number
    /** 菲尼克斯眩焰次数（资源阶段写） */
    phoenixExCount?: number
    /** 菲尼克斯烬火追魂次数（资源阶段写 = 终结次数） */
    phoenixEntryCount?: number
  }
}

/** r407：本模块私有结果键（原塞在 `specResources['phoenix_cycle']`，与 spec 账本混用同一无类型通道） */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 不死鸟循环明细 */
    phoenixCycle?: PhoenixCycle
  }
}
