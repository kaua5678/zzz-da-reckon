/**
 * 菲欧妮（1641，火属性·异常，坎卜斯黑枝）—— ⚠️ 3.3 测试服临时录入（nanoka 3.3.2+18895034）。
 * 原文来源：data/raw/nanoka_missing/full/1641.json（双源对账 data/raw/gachabase/1641.json）。
 *
 * - 核心被动：异常精通 +40；[脆弱]敌方 debuff——属性异常伤害可暴击：
 *   anomalyCritRate 30 + 0.7×(异常掌控-145)、anomalyCritDmg 15/25/40（队伍异常角色数 2/3，
 *   额外能力门控），影画1 再 +20。引擎异常结算区已有 EV 乘区（calcAnomalyCritExpect = 1+率×伤，
 *   爱芮异放暴击同通道）——不造新乘区。
 * - 异放（普罗米娅绝裁同款固定 releaseMultiplier 通道）：
 *   长按普攻 1641005（225+20×(s-1)，s=普攻技能等级）、终结技 1641013（300+27×(s-1)）、
 *   影画6 强特 200% + releaseModifier 无视 15% 防御（异放限定）。
 * - [余火]→长按普攻：燃烧攻击行 attack_data_0（moveId×倍率表直算——**buildExecutions 阶段
 *   totalSpecialResourceRecovery 未 enrich 回填为 0**，2026-09-12 探针修正）×影画1 效率 / 90 = 次数。
 * - [蓄能]附加攻击 1641021：次数 = 强特二段 + 长按普攻 + 终结（重击命中来源）。
 * - 影画2 焚化积蓄效率 +15%×覆盖率；第二段回 8 能量（行级）；影画4 长按普攻 +200 喧响（行级）。
 *
 * 未建模（spec notes 在册）：[重生]/[消亡]状态机、影画2 保留段数、队友向脆弱异常暴击。
 */
import type {
  AgentCharConfigInput,
  AgentExSpecialTimeInput,
  AgentEventInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  ReleaseModifierInput,
} from '../types'
import type { MechanicSetting } from '@/types/resource'

export const PHOENIX_ID = '1641'
/** 核心被动：异常精通 +40 */
export const PHOENIX_CORE_PROFICIENCY = 40
/** [脆弱]：基础暴击率 30%、暴伤 15%；掌控>145 每点 +0.7% 率 */
export const PHOENIX_WEAKNESS_CRIT_RATE = 30
export const PHOENIX_WEAKNESS_CRIT_DMG = 15
export const PHOENIX_WEAKNESS_MASTERY_THRESHOLD = 145
export const PHOENIX_WEAKNESS_PER_POINT_RATE = 0.7
/** 额外能力：队伍异常角色数 2/3 → 脆弱暴伤提升为 25/40（门控 additionalAbilityActive） */
export const PHOENIX_WEAKNESS_CRIT_DMG_BY_COUNT: Record<number, number> = { 1: 15, 2: 25, 3: 40 }
/** 影画1：脆弱目标异常伤害触发暴击时暴伤 +20（近似为自身异常暴伤面板 +20） */
export const PHOENIX_C1_CRIT_DMG = 20
/** 影画1：燃烧攻击余火获取效率 +15% */
export const PHOENIX_C1_EMBER_EFFICIENCY = 15
/** 影画2：焚化下异常积蓄效率 +15% × 覆盖率；第二段回 8 能量 */
export const PHOENIX_C2_BUILDUP_EFF = 15
export const PHOENIX_C2_EX2_ENERGY = 8
/** 影画4：长按普攻 +200 喧响 */
export const PHOENIX_C4_CHARGED_DECIBEL = 200
/** 影画6：异放无视 15% 防御 */
export const PHOENIX_C6_RELEASE_DEF_IGNORE = 15

/** moveId（param 空间） */
export const PHOENIX_CHARGED_MOVE_ID = '1641005' // 普通攻击：普通攻击长按（消耗 90 余火）
export const PHOENIX_EX1_MOVE_ID = '1641008' // 强化特殊技：第一段
export const PHOENIX_EX2_MOVE_ID = '1641009' // 强化特殊技：第二段
export const PHOENIX_ENERGIZE_MOVE_ID = '1641021' // 蓄能附加攻击（视为强化特殊技）
export const PHOENIX_ULT_MOVE_ID = '1641013' // 终结技
export const PHOENIX_ENTRY_MOVE_ID = '1641019' // 终结技：入场（终结「招式发动后，可点按发动」→ 每次终结一次，用户口径 2026-09-12）
export const PHOENIX_CHAIN_MOVE_ID = '1641012' // 连携技（[消亡]消费：退出消亡并+30%积蓄）
/** 消亡消费：连携技积蓄 +30%（原文「若处于[消亡]状态，则会退出[消亡]状态并使该次[连携技]累积的属性异常积蓄提升30%」） */
export const PHOENIX_WANGLIANG_CHAIN_BUILDUP_PCT = 30
/**
 * 消亡→连携加成次数（消费型状态机，2026-09-12 用户纠错建模）：
 * 消亡由终结技进入（进入次数 = 终结次数），每次消亡被**下一次连携**消费退出
 * → 加成次数 = min(终结次数, 连携次数)。状态机本体不建，但次数驱动的乘区不丢。
 */
export function phoenixWangliangChainBonus(ultCount: number, chainCount: number): number {
  return Math.max(0, Math.min(Math.floor(ultCount || 0), Math.floor(chainCount || 0)))
}
/** 长按普攻消耗余火 */
export const PHOENIX_CHARGED_EMBER_COST = 90
/** [燃烧攻击]集合（余火来源，倍率表 attack_data_0 列 = 每次命中的余火获取，/10000 口径 [猜测·低]）。
 *  分支攻击 1641006（追斩后点按）不计入自动收入——操作向量，滑块/人工次数覆盖。 */
export const PHOENIX_COMBUSTION_MOVE_IDS: ReadonlySet<string> = new Set([
  '1641003', '1641004', // 普攻三/四段
  '1641008', '1641009', // 强化特殊技第一/二段
  '1641012', '1641013', // 连携/终结
])
/** 平A段循环（普攻一~四段，余火按第三/四段命中计） */
export const PHOENIX_BASIC_SEGMENT_IDS: readonly string[] = ['1641001', '1641002', '1641003', '1641004']
/** 异放固定倍率（满级 s=12）：长按普攻 225+20×11=445、终结 300+27×11=597、影画6 强特 200 */
export const PHOENIX_RELEASE_BASE = { charged: 225, chargedPerLevel: 20, ult: 300, ultPerLevel: 27, c6Ex: 200 } as const
/** 通用技能等级口径：影画3 +2、影画5 累计 +4 */
export function phoenixSkillLevel(cinemaLevel: number): number {
  const cinema = Math.max(0, Math.floor(cinemaLevel))
  return 12 + (cinema >= 5 ? 4 : cinema >= 3 ? 2 : 0)
}

function setting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const v = Number((cfg as unknown as Record<string, unknown>)[`setting:${id}`])
  return Number.isFinite(v) ? v : fallback
}
function settingOf(settings: Readonly<Record<string, number>>, id: string, fallback: number): number {
  const v = Number(settings?.[id])
  return Number.isFinite(v) ? v : fallback
}
function whole(value: number): number { return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)) }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)) }

export interface PhoenixCycle {
  cinemaLevel: number
  additionalActive: boolean
  coreProficiency: number
  weaknessCritRate: number
  weaknessCritDmg: number
  c1CritDmg: number
  teamAnomalyCount: number
  c2BuildUpEff: number
  emberGain: number
  chargedCount: number
  note: string
}

/** 脆弱异常暴击：率 = 30 + 0.7×(掌控-145)；伤 = 15/25/40（队伍异常数，需额外能力门控） */
export function computePhoenixWeaknessCrit(input: {
  anomalyMastery: number
  additionalActive: boolean
  teamAnomalyCount: number
  cinemaLevel: number
}): { rate: number; dmg: number } {
  const mastery = Math.max(0, Number.isFinite(input.anomalyMastery) ? input.anomalyMastery : 0)
  const rate = PHOENIX_WEAKNESS_CRIT_RATE
    + Math.max(0, mastery - PHOENIX_WEAKNESS_MASTERY_THRESHOLD) * PHOENIX_WEAKNESS_PER_POINT_RATE
  // 影画6：额外能力所需异常角色数 -1 → 同等编成下档位更高
  const effectiveCount = Math.min(3, Math.max(1, input.teamAnomalyCount + (input.cinemaLevel >= 6 ? 1 : 0)))
  const tierDmg = input.additionalActive
    ? (PHOENIX_WEAKNESS_CRIT_DMG_BY_COUNT[effectiveCount] ?? PHOENIX_WEAKNESS_CRIT_DMG)
    : PHOENIX_WEAKNESS_CRIT_DMG
  const c1 = input.cinemaLevel >= 1 ? PHOENIX_C1_CRIT_DMG : 0
  return { rate, dmg: tierDmg + c1 }
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
 * 余火收入：按 **moveId × 倍率表 attack_data_0** 直算（2026-09-12 探针修正）。
 * ⚠️ buildExecutions 阶段 executions 的 `totalSpecialResourceRecovery` **尚未 enrich 回填**，
 * 直接读它是 0（第一版因此长按普攻 0 次、1641 单人伤害全库垫底 #62/62）。分支攻击 1641006
 *（追斩后点按）是操作向量，不计自动收入。
 */
export function phoenixEmberIncome(cfg: AgentCharConfigInput['cfg'], state: AgentResourceInput['state'] | undefined, executions: AgentResourceInput['executions']): number {
  const record = cfg as unknown as Record<string, unknown>
  const meta = (record.phoenixCombustionMeta as Record<string, number> | undefined) ?? {}
  const basicCycle = (record.phoenixBasicCycle as { moveId: string; actionTime: number }[] | undefined) ?? []
  const basicTime = Math.max(0, Number((state as { basicAttackTime?: number } | undefined)?.basicAttackTime ?? 0))
  const { third, fourth } = phoenixBasicCombustionHits(basicTime, basicCycle)
  let income = third * (meta['1641003'] ?? 0) + fourth * (meta['1641004'] ?? 0)
  for (const e of executions) {
    if (!e.moveId || !PHOENIX_COMBUSTION_MOVE_IDS.has(e.moveId)) continue
    if (e.moveId === '1641003' || e.moveId === '1641004') continue // 平A段已按段循环计
    income += Math.max(0, Number(e.count ?? 0)) * (meta[e.moveId] ?? 0)
  }
  return income
}

/** 长按普攻次数（估时与物化唯一共用入口）：floor(余火收入×效率/90)，滑块覆盖优先 */
export function phoenixChargedCount(cfg: AgentCharConfigInput['cfg'], state: AgentResourceInput['state'] | undefined, executions: AgentResourceInput['executions']): number {
  const override = setting(cfg, 'phoenix.chargedAttackCount', 0)
  if (override > 0) return whole(override)
  const cinema = whole(Number((cfg as unknown as Record<string, unknown>).phoenixCinemaLevel ?? 0))
  const eff = cinema >= 1 ? 1 + PHOENIX_C1_EMBER_EFFICIENCY / 100 : 1
  return Math.floor(phoenixEmberIncome(cfg, state, executions) * eff / PHOENIX_CHARGED_EMBER_COST)
}

function buildPhoenixCharConfig({ cfg, cinemaLevel, panel, skills }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.phoenixCinemaLevel = cinemaLevel
  record.phoenixAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
  record.phoenixAnomalyMastery = panel.anomalyMastery ?? 0
  // 影画4：长按普攻 +200 喧响/次——行级 decibel 会被 enrich 按倍率表回填，改走 initialDecibelGift。
  // 次数：滑块覆盖优先；自动按 战斗时长/15s 一次长按普攻估算 [猜测·低]（余火循环收敛值在 buildExecutions 才有）。
  if (cinemaLevel >= 4) {
    const override = setting(cfg, 'phoenix.chargedAttackCount', 0)
    const count = override > 0 ? whole(override) : Math.max(0, Math.floor((cfg.battleTime ?? 180) / 15))
    cfg.initialDecibelGift = (cfg.initialDecibelGift ?? 0) + PHOENIX_C4_CHARGED_DECIBEL * count
  }
  // 强化特殊技走通用通道：每轮强特 = 第一段→第二段，**轮均耗能 = 40+40 = 80 并入
  // cfg.exSpecialEnergyConsume**（resolveExSpecialCount 按此推强特次数，第二段行本身不再重复记耗能）。
  // 耗能为 catalog energyCost 真实值（2026-09-12 从「能量消耗」param 行 desc 文本补抓）。
  const special = skills?.categories?.find(c => c.id === 'special')?.moves
  const ex1 = special?.find(m => m.id === PHOENIX_EX1_MOVE_ID)
  const ex2 = special?.find(m => m.id === PHOENIX_EX2_MOVE_ID)
  if (ex1) {
    cfg.exSpecialMoveId = PHOENIX_EX1_MOVE_ID
    if (ex1.actionTime) cfg.exSpecialActionTime = ex1.actionTime
    const ec1 = parseFloat(ex1.energyCost?.['Energy Cost'] ?? '')
    const ec2 = parseFloat(ex2?.energyCost?.['Energy Cost'] ?? '')
    const roundCost = (Number.isFinite(ec1) && ec1 > 0 ? ec1 : 0) + (Number.isFinite(ec2) && ec2 > 0 ? ec2 : 0)
    if (roundCost > 0) cfg.exSpecialEnergyConsume = roundCost
  }
  const all = skills?.categories?.flatMap(c => c.moves ?? []) ?? []
  const metaOf = (moveId: string) => {
    const m = all.find(mm => mm.id === moveId)
    return {
      moveId,
      actionTime: m?.actionTime ?? 0,
      damage: m?.rows?.find(r => r.id === 'damage')?.values?.[0] ?? 0,
      decibelRecovery: m?.rows?.find(r => r.id === 'decibel_recovery')?.values?.[0] ?? 0,
      energyCost: parseFloat(m?.energyCost?.['Energy Cost'] ?? '') || 0,
    }
  }
  // 燃烧攻击余火获取（attack_data_0 列，moveId → 每次命中余火）
  const combustion: Record<string, number> = {}
  for (const moveId of PHOENIX_COMBUSTION_MOVE_IDS) {
    const m = all.find(mm => mm.id === moveId)
    combustion[moveId] = m?.rows?.find(r => r.id === 'attack_data_0')?.values?.[0] ?? 0
  }
  record.phoenixCombustionMeta = combustion
  record.phoenixBasicCycle = PHOENIX_BASIC_SEGMENT_IDS.map(metaOf)
  record.phoenixChargedMeta = metaOf(PHOENIX_CHARGED_MOVE_ID)
  record.phoenixEx2Meta = metaOf(PHOENIX_EX2_MOVE_ID)
  record.phoenixEnergizeMeta = metaOf(PHOENIX_ENERGIZE_MOVE_ID)
  record.phoenixEntryMeta = metaOf(PHOENIX_ENTRY_MOVE_ID)
  record.phoenixChainMeta = {
    ...metaOf(PHOENIX_CHAIN_MOVE_ID),
    anomalyBuildUp: all.find(m => m.id === PHOENIX_CHAIN_MOVE_ID)?.rows?.find(r => r.id === 'anomaly_buildup')?.values?.[0] ?? 0,
  }
}

/**
 * 面板层只剩自面板部分：异常精通 +40、影画2 积蓄效率。
 * [脆弱] 异常暴击（率/伤）**不在这里写**——2026-09-12 改为 spec teamBuffs 声明式承载
 *（phoenix.weakness_anomaly_crit_*，公式读源面板掌控；自体与队友同吃，引擎 EV 乘区通用消费；
 * 额外能力门控走 computePanelPhases 的 buff-id 过滤，SOP §6.2 标准接线），防双通道双计。
 */
function applyPhoenixPanel({ cinemaLevel, panel, settings }: AgentPanelInput): void {
  if (!panel) return
  panel.anomalyProficiency = (panel.anomalyProficiency ?? 0) + PHOENIX_CORE_PROFICIENCY
  if (cinemaLevel >= 2) {
    const cov = clamp01(settingOf(settings, 'phoenix.c2IncinerationCoverage', 1))
    panel.anomalyBuildUpEfficiency = (panel.anomalyBuildUpEfficiency ?? 0) + PHOENIX_C2_BUILDUP_EFF * cov
  }
  // releaseModifier 用（影画6 异放限定无视防御需读命座）
  ;(panel as unknown as Record<string, unknown>).phoenixCinemaLevel = cinemaLevel
}

/** 影画6：异放限定无视 15% 防御（普罗米娅同款通道） */
function phoenixReleaseModifier({ panels }: ReleaseModifierInput): { enemyResReduction: number; enemyDefReduction?: number; note: string } {
  const phoenix = panels.find(p => (p as Record<string, unknown>).phoenixCinemaLevel !== undefined)
  const cinema = phoenix ? Number((phoenix as Record<string, unknown>).phoenixCinemaLevel ?? 0) : 0
  return cinema >= 6
    ? { enemyResReduction: 0, enemyDefReduction: PHOENIX_C6_RELEASE_DEF_IGNORE, note: `；影画6：异放无视 ${PHOENIX_C6_RELEASE_DEF_IGNORE}% 防御（releaseModifier 异放限定）` }
    : { enemyResReduction: 0, note: '' }
}

/** 长按普攻/强化特殊技第二段/蓄能附加攻击执行行 */
function buildPhoenixExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = whole(Number(record.phoenixCinemaLevel ?? 0))
  const chargedCount = phoenixChargedCount(cfg, state, executions)
  record.phoenixChargedCount = chargedCount
  const exCount = Math.max(0, Number(state.exSpecialCount ?? 0))
  const ultCount = Math.max(0, Number(state.ultimateCount ?? 0))

  const chargedMeta = record.phoenixChargedMeta as { moveId: string; actionTime: number } | undefined
  if (chargedMeta && chargedCount > 0) {
    executions.push({
      moveId: chargedMeta.moveId,
      moveName: '普通攻击：普通攻击长按（消耗90余火）',
      category: 'basic',
      element: 'fire',
      count: chargedCount,
      actionTime: chargedMeta.actionTime,
      comboAlignRatio: 0,
      totalTime: chargedCount * chargedMeta.actionTime,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      // 影画4 喧响走 initialDecibelGift（行级 decibel 会被 enrich 按倍率表回填）
      skillTableNote: `余火驱动 ×${chargedCount}${cinema >= 4 ? `；影画4 +${PHOENIX_C4_CHARGED_DECIBEL} 喧响/次（initialDecibelGift）` : ''}`,
    })
  }
  // 强化特殊技第二段：按「每轮强特 = 第一段→第二段」近似 [猜测·低]；影画2 回 8 能量挂行级
  const ex2Meta = record.phoenixEx2Meta as { moveId: string; actionTime: number } | undefined
  if (ex2Meta && exCount > 0) {
    executions.push({
      moveId: ex2Meta.moveId,
      moveName: '强化特殊技：第二段',
      category: 'special',
      element: 'fire',
      count: exCount,
      actionTime: ex2Meta.actionTime,
      comboAlignRatio: 0,
      totalTime: exCount * ex2Meta.actionTime,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      energyRecovery: cinema >= 2 ? PHOENIX_C2_EX2_ENERGY : 0,
      totalEnergyRecovery: exCount * (cinema >= 2 ? PHOENIX_C2_EX2_ENERGY : 0),
      skillTableNote: '每轮强特按两段近似（第二段耗能 40 并入 exSpecialEnergyConsume 轮均 80）',
    })
  }
  // 蓄能附加攻击（视为强化特殊技）：重击命中来源 = 强特二段 + 长按普攻 + 终结
  const energizeCount = exCount + chargedCount + ultCount
  const energizeMeta = record.phoenixEnergizeMeta as { moveId: string; actionTime: number } | undefined
  if (energizeMeta && energizeCount > 0) {
    executions.push({
      moveId: energizeMeta.moveId,
      moveName: '蓄能附加攻击（视为强化特殊技）',
      category: 'special',
      element: 'fire',
      count: energizeCount,
      actionTime: energizeMeta.actionTime,
      comboAlignRatio: 0,
      totalTime: 0,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      skillTableNote: `重击命中送 ×${energizeCount}（强特二段+长按普攻+终结；附加攻击不占前台时间）`,
    })
  }
  // 终结技：入场（1641019，1545.8%）——终结「招式发动后，可点按发动」→ 每次终结后点按触发一次
  //（用户口径 2026-09-12「喧响大后按攻击可以触发一次」，仪玄影画6「赠送次数=大招次数」同款计数）。
  // 原文「切换入场/快支入场时发动」是消亡期间的另一触发面，此处按每次终结一次的稳定计数建模 [已确认]。
  const entryMeta = record.phoenixEntryMeta as { moveId: string; actionTime: number } | undefined
  if (entryMeta && ultCount > 0) {
    executions.push({
      moveId: entryMeta.moveId,
      moveName: '终结技：入场（终结后点按）',
      category: 'chain',
      element: 'fire',
      count: ultCount,
      actionTime: entryMeta.actionTime,
      comboAlignRatio: 0,
      totalTime: ultCount * entryMeta.actionTime,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      skillTableNote: `每次终结后点按发动 ×${ultCount}（计数=终结次数，用户口径）`,
    })
  }
}

/**
 * 消亡消费（2026-09-12 用户纠错建模）：终结进入[消亡]，下一次连携退出并+30%积蓄——
 * 加成次数 = min(终结次数, 连携次数)（phoenixWangliangChainBonus），按占比乘到连携行积蓄
 *（南宫羽 ×1.35 / 妮可C1 行级乘法同款先例；anomalyBuildUpOverride 同步防 enrich 回填）。
 */
function patchPhoenixExecutions({ state, executions }: AgentResourceInput): void {
  const ultCount = Math.max(0, Number(state.ultimateCount ?? 0))
  if (ultCount <= 0) return
  const chainExec = executions.find(e => e.moveId === PHOENIX_CHAIN_MOVE_ID)
  if (!chainExec) return
  const chainCount = Math.max(0, Number(chainExec.count ?? 0))
  if (chainCount <= 0) return
  const consume = phoenixWangliangChainBonus(ultCount, chainCount)
  if (consume <= 0) return
  const base = Math.max(0, Number(chainExec.anomalyBuildUp ?? 0))
  if (base <= 0) return
  const ratio = consume / chainCount
  chainExec.anomalyBuildUp = base * (1 + PHOENIX_WANGLIANG_CHAIN_BUILDUP_PCT / 100 * ratio)
  chainExec.anomalyBuildUpOverride = true
  if (chainExec.totalAnomalyBuildUp != null) {
    chainExec.totalAnomalyBuildUp = chainExec.anomalyBuildUp * chainCount
  }
  chainExec.skillTableNote = `${chainExec.skillTableNote ?? ''}；[消亡]消费 ×${consume}/${chainCount}：连携积蓄+${PHOENIX_WANGLIANG_CHAIN_BUILDUP_PCT}%×占比${(ratio * 100).toFixed(0)}%`
}

/** 必做前台时间：长按普攻 + 强特第二段 + 终结入场（次数读上一轮 buildExecutions 的收敛值/终结次数） */
function phoenixExSpecialTime({ cfg, exSpecialCount, state }: AgentExSpecialTimeInput): { necessaryTime: number; comboAlignTime: number } {
  const record = cfg as unknown as Record<string, unknown>
  const exTime = Math.max(0, exSpecialCount) * (cfg.exSpecialActionTime ?? 0)
  const chargedMeta = record.phoenixChargedMeta as { actionTime: number } | undefined
  const ex2Meta = record.phoenixEx2Meta as { actionTime: number } | undefined
  const entryMeta = record.phoenixEntryMeta as { actionTime: number } | undefined
  const chargedCount = whole(Number(record.phoenixChargedCount ?? 0))
  const ultCount = Math.max(0, Number(state?.ultimateCount ?? 0))
  const ex2Time = ex2Meta ? Math.max(0, exSpecialCount) * ex2Meta.actionTime : 0
  const chargedTime = chargedMeta ? chargedCount * chargedMeta.actionTime : 0
  const entryTime = entryMeta ? ultCount * entryMeta.actionTime : 0
  return {
    necessaryTime: exTime + ex2Time + chargedTime + entryTime,
    comboAlignTime: exTime * (cfg.exSpecialComboAlignRatio ?? 0),
  }
}

/** 异放事件：长按普攻终结一击 + 终结技终结一击（+ 影画6 强特） */
function buildPhoenixAnomalyEvents({ cfg, state, events, totalTime }: AgentEventInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = whole(Number(record.phoenixCinemaLevel ?? 0))
  const s = phoenixSkillLevel(cinema)
  const coverage = clamp01(setting(cfg, 'phoenix.releaseCoverage', 1))
  if (coverage <= 0) return
  const chargedCount = whole(Number(record.phoenixChargedCount ?? 0))
  const exCount = Math.max(0, Number(state.exSpecialCount ?? 0))
  const ultCount = Math.max(0, Number(state.ultimateCount ?? 0))

  const chargedRelease = Math.round(chargedCount * coverage)
  if (chargedRelease > 0) {
    const mult = PHOENIX_RELEASE_BASE.charged + PHOENIX_RELEASE_BASE.chargedPerLevel * (s - 1)
    events.push({
      eventId: 'phoenix_charged_release',
      eventName: '长按普攻终结一击·异放',
      eventType: 'release',
      element: 'dominant',
      carrierMoveId: PHOENIX_CHARGED_MOVE_ID,
      carrierMoveName: '普通攻击：普通攻击长按（终结一击）',
      followCarrierInStun: true,
      count: chargedRelease,
      formula: `releaseMultiplier=${mult}（225+20×(${s}-1)，固定倍率）`,
      fields: [`releaseMultiplier=${mult}`, `charged=${chargedCount}`, `coverage=${coverage}`],
      note: `终结一击命中属性异常状态敌人触发（异常队默认满覆盖，滑块 phoenix.releaseCoverage）；元素按目标当前异常分配。`,
    })
  }
  const ultRelease = Math.round(ultCount * coverage)
  if (ultRelease > 0) {
    const mult = PHOENIX_RELEASE_BASE.ult + PHOENIX_RELEASE_BASE.ultPerLevel * (s - 1)
    events.push({
      eventId: 'phoenix_ultimate_release',
      eventName: '终结技终结一击·异放',
      eventType: 'release',
      element: 'dominant',
      carrierMoveId: PHOENIX_ULT_MOVE_ID,
      carrierMoveName: '终结技（终结一击）',
      followCarrierInStun: true,
      count: ultRelease,
      formula: `releaseMultiplier=${mult}（300+27×(${s}-1)，固定倍率）`,
      fields: [`releaseMultiplier=${mult}`, `ult=${ultCount}`, `coverage=${coverage}`],
      note: '终结一击命中属性异常状态敌人触发；元素按目标当前异常分配。',
    })
  }
  if (cinema >= 6) {
    const c6Release = Math.round(exCount * coverage)
    if (c6Release > 0) {
      events.push({
        eventId: 'phoenix_c6_ex_release',
        eventName: '影画6·强化特殊技异放',
        eventType: 'release',
        element: 'dominant',
        carrierMoveId: PHOENIX_EX2_MOVE_ID,
        carrierMoveName: '强化特殊技：第二段（终结一击）',
        followCarrierInStun: true,
        count: c6Release,
        formula: `releaseMultiplier=${PHOENIX_RELEASE_BASE.c6Ex}（固定倍率）`,
        fields: [`releaseMultiplier=${PHOENIX_RELEASE_BASE.c6Ex}`, `ex=${exCount}`],
        note: `影画6：终结一击命中异常状态敌人触发 1 次异放 200%，异放无视 15% 防御（releaseModifier）。整局约 ${totalTime}s。`,
      })
    }
  }
}

function buildPhoenixResourceResult({ cfg }: AgentResourceResultInput) {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = whole(Number(record.phoenixCinemaLevel ?? 0))
  const additionalActive = record.phoenixAdditionalActive === true
  const chargedCount = whole(Number(record.phoenixChargedCount ?? 0))
  // 展示口径：脆弱暴击实际承载 = spec teamBuffs（公式读源面板掌控 + 档位/影画门控）；
  // 这里按 2 档（触发额外能力的最低编成）估算给资源卡看，权威值以面板为准。
  const weakness = computePhoenixWeaknessCrit({
    anomalyMastery: Number(record.phoenixAnomalyMastery ?? 0),
    additionalActive,
    teamAnomalyCount: 2,
    cinemaLevel: cinema,
  })
  return {
    specResources: {
      phoenix_cycle: {
        cinemaLevel: cinema,
        additionalActive,
        coreProficiency: PHOENIX_CORE_PROFICIENCY,
        weaknessCritRate: Math.round(weakness.rate * 100) / 100,
        weaknessCritDmg: weakness.dmg,
        c1CritDmg: cinema >= 1 ? PHOENIX_C1_CRIT_DMG : 0,
        teamAnomalyCount: 2,
        c2BuildUpEff: cinema >= 2 ? PHOENIX_C2_BUILDUP_EFF : 0,
        emberGain: 0,
        chargedCount,
        note: '脆弱暴击承载 = spec teamBuffs（含队友受益）；重生/消亡状态机未建模；余火按总量口径。',
      } as PhoenixCycle,
    },
  }
}

function buildPhoenixResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.phoenix_cycle as PhoenixCycle | undefined
  if (!cycle) return []
  return [{
    id: 'phoenix-cycle',
    title: '菲欧妮·脆弱与余火',
    summary: `异常精通 +${cycle.coreProficiency} · 脆弱暴击 率${Math.round(cycle.weaknessCritRate * 100) / 100}%/伤${cycle.weaknessCritDmg}% · 长按普攻 ×${cycle.chargedCount}`,
    rows: [
      { label: '核心异常精通', value: `+${cycle.coreProficiency}`, detail: '计入面板' },
      { label: '脆弱异常暴击率', value: `${cycle.weaknessCritRate}%`, detail: '30 + 0.7×(掌控-145)' },
      { label: '脆弱异常暴伤', value: `${cycle.weaknessCritDmg}%`, detail: `${cycle.additionalActive ? '额外能力已触发（2档口径）' : '额外能力未触发（基础15）'}${cycle.cinemaLevel >= 1 ? ' +影画1 20' : ''}；3档/影画6 档位+1 见 teamBuffs 说明` },
      { label: '影画2焚化积蓄效率', value: `+${cycle.c2BuildUpEff}%`, detail: '×覆盖率' },
      { label: '长按普攻次数', value: `×${cycle.chargedCount}`, detail: '余火收入/90' },
    ],
    footer: cycle.note,
  }]
}

const settings: MechanicSetting[] = [
  {
    id: 'phoenix.chargedAttackCount',
    label: '菲欧妮·长按普攻次数覆盖',
    description: '手动指定整局长按普通攻击（消耗90余火）次数；0=自动（燃烧攻击行 attack_data 余火收入×影画1效率1.15/90）。',
    default: 0,
    min: 0,
    max: 40,
    step: 1,
    suffix: '次',
  },
  {
    id: 'phoenix.releaseCoverage',
    label: '菲欧妮·异放触发覆盖率',
    description: '长按普攻/终结技/影画6 强特的终结一击命中「属性异常状态敌人」的占比（异常队默认满覆盖）。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: 'phoenix.c2IncinerationCoverage',
    label: '菲欧妮·影画2焚化覆盖率',
    description: '影画2 [焚化]状态（强特进入10秒，燃烧攻击命中刷新）的整局覆盖率——异常积蓄效率+15%。',
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
  name: '菲欧妮·脆弱',
  description: '⚠️3.3 测试服临时录入：核心异常精通+40、影画2 积蓄效率×覆盖率；脆弱异常暴击走 spec teamBuffs 通用承载（公式读源面板掌控，自体+队友同吃 EV 乘区）；长按普攻/终结/影画6 异放（固定 releaseMultiplier）；余火→长按普攻计数；终结入场=每次终结后点按一次（1641019 计数=终结次数）；[消亡]消费：连携积蓄+30%×min(终结,连携)/连携占比；影画4 喧响、蓄能附加攻击。',
  applyPanel: applyPhoenixPanel,
  buildCharConfig: buildPhoenixCharConfig,
  estimateExSpecialTime: phoenixExSpecialTime,
  buildExecutions: buildPhoenixExecutions,
  patchExecutions: patchPhoenixExecutions,
  buildAnomalyEvents: buildPhoenixAnomalyEvents,
  buildResourceResult: buildPhoenixResourceResult,
  resourceSections: buildPhoenixResourceSections,
  releaseModifier: phoenixReleaseModifier,
  settings,
}

export default phoenixMechanic
