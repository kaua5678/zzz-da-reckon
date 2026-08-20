/**
 * 耀嘉音（1311）—— 整局近似口径
 *
 * 拐力（teammate-buffs + helpers）
 * - 核心·如歌的行板：全队（含自己）攻击 +初始攻×35% 顶 1200；C2 再 +19%/顶+400 → 合计 54%/1600
 * - 咏叹华彩：全队伤害/暴伤随特殊技等级（12/14/16）；默认满覆盖，可调 yaojiayin.ariaCoverage
 * - 影画1：全抗 -6%×3 层（满层 18%）
 *
 * 资源 / 执行
 * - 和弦：每 25 能量 1 次付费震音（1311008）；入场触发次数 = 全队快支+招架+回避支援 + 全队连携
 * - 额外能力（强攻/异常/命破）：每次付费震音视为精准支援 → 额外 +1 震音 +3 音簇（免费）
 * - 影画2：入场额外 +1 震音 +3 音簇，3s CD → min(入场, floor(t/3))
 * - 影画6：华彩震音/音簇倍率 ×2、暴击 +80%；精准支援追加蓄力随想曲#4，10s CD
 * - 影画4：华彩中快支入场 3s CD 按队内职业：
 *   强攻 → 300% 耀嘉音攻击附加火伤行；异常 → 该角色异常积蓄效率 +50%×覆盖；击破 → 失衡提升 +50%×覆盖
 * - 影画1：开场额外 +1000 喧响（initialDecibelGift +1000）
 *
 * 未建模：庇护之音无敌、终曲退出华彩逐帧、无和弦快支窗口的精确时间轴、震音视为强特的技能乘区细分（按强特伤害目标近似）。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentTeamConfigInput,
} from '../types'
import type { AgentSkills, SkillMove } from '@/types/catalog'
import type { CharacterOperationConfig, SkillExecution } from '@/types/resource'
import { fmt } from '@/utils/format'

export const YAOJIAYIN_ID = '1311'

/** 震音（和弦 #1） */
export const MOVE_TREMOLO = '1311008'
/** 音簇（和弦 #2） */
export const MOVE_CLUSTER = '1311009'
/** 蓄力随想曲第三段（#4）—— C6 精准支援追加 */
export const MOVE_CAPRICCIO_CHARGED = '1311004'
/** C4 强攻分支附加伤害假 id */
export const MOVE_C4_ATTACK_BONUS = '1311c4_atk_bonus'

export const YAOJIAYIN_ENERGY_PER_TREMOLO = 25
export const YAOJIAYIN_C2_ENTRY_CD = 3
export const YAOJIAYIN_C6_CAPRICCIO_CD = 10
export const YAOJIAYIN_C4_BRANCH_CD = 3
export const YAOJIAYIN_C4_ATK_MULT = 300
export const YAOJIAYIN_C1_DECIBEL = 1000

/** 咏叹华彩：技能等级 → 全队伤害% / 暴伤%（原文 CAL） */
export function computeAriaBonuses(skillLevel: number): { dmgBonus: number; critDmg: number } {
  const s = Math.max(1, Math.min(16, Math.floor(skillLevel)))
  return {
    dmgBonus: Math.min(24, Math.max(9, s + 8)),
    critDmg: Math.min(31, Math.max(8.5, s * 1.5 + 7)),
  }
}

export function yaojiayinSkillLevel(cinemaLevel: number): number {
  const bonus = cinemaLevel >= 5 ? 4 : cinemaLevel >= 3 ? 2 : 0
  return 12 + bonus
}

export interface YaojiayinTremoloInput {
  totalEnergy: number
  entryCount: number
  combatTime: number
  cinemaLevel: number
  additionalActive: boolean
}

export interface YaojiayinTremoloResult {
  paidTremolos: number
  freeTremolos: number
  totalTremolos: number
  clusters: number
  c2Extra: number
  c6Capriccio: number
  energyUsed: number
  entries: number
}

/**
 * 震音/音簇次数纯函数。
 * 付费震音 = min(⌊能量/25⌋, 入场次数)
 * 额外能力：每次付费震音 +1 震音 +3 音簇
 * C2：入场额外 +1 震音 +3 音簇，3s CD
 * C6 随想曲追加次数在外层按精准次数与 10s CD 再算
 */
export function computeYaojiayinTremolos(input: YaojiayinTremoloInput): YaojiayinTremoloResult {
  const energy = Math.max(0, Number(input.totalEnergy) || 0)
  const entries = Math.max(0, Math.floor(input.entryCount || 0))
  const cinema = input.cinemaLevel ?? 0
  const t = Math.max(0, Number(input.combatTime) || 0)
  const maxPaid = Math.floor(energy / YAOJIAYIN_ENERGY_PER_TREMOLO)
  const paidTremolos = Math.min(maxPaid, entries)
  let freeTremolos = 0
  let clusters = 0
  if (input.additionalActive && paidTremolos > 0) {
    freeTremolos += paidTremolos
    clusters += paidTremolos * 3
  }
  let c2Extra = 0
  if (cinema >= 2 && entries > 0) {
    c2Extra = Math.min(entries, Math.floor(t / YAOJIAYIN_C2_ENTRY_CD))
    freeTremolos += c2Extra
    clusters += c2Extra * 3
  }
  const totalTremolos = paidTremolos + freeTremolos
  // C6：精准支援次数 ≈ 付费震音（每次入场耗能震音都可接精准）；10s CD
  const precise = input.additionalActive ? paidTremolos : 0
  const c6Capriccio = cinema >= 6 && precise > 0
    ? Math.min(precise, Math.floor(t / YAOJIAYIN_C6_CAPRICCIO_CD))
    : 0
  return {
    paidTremolos,
    freeTremolos,
    totalTremolos,
    clusters,
    c2Extra,
    c6Capriccio,
    energyUsed: paidTremolos * YAOJIAYIN_ENERGY_PER_TREMOLO,
    entries,
  }
}

/** 核心攻击拐：0命 35%/1200；C2 54%/1600 */
export function computeYaojiayinCoreAtkBonus(sourceAtk: number, cinemaLevel: number): number {
  const atk = Math.max(0, Number(sourceAtk) || 0)
  if (cinemaLevel >= 2) return Math.min(1600, atk * 0.54)
  return Math.min(1200, atk * 0.35)
}

function findMove(skills: AgentSkills | undefined, id: string): SkillMove | null {
  if (!skills) return null
  for (const c of skills.categories) {
    const m = c.moves.find(x => x.id === id)
    if (m) return m
  }
  return null
}

function rowVal(move: SkillMove | null | undefined, rowId: string): number {
  const row = move?.rows?.find(r => r.id === rowId)
  const vals = row?.values ?? []
  if (!vals.length) return 0
  return Number(vals[11] ?? vals[vals.length - 1] ?? 0) || 0
}

function cfgNum(cfg: CharacterOperationConfig, key: string, fallback = 0): number {
  const raw = Number((cfg as unknown as Record<string, unknown>)[key] ?? fallback)
  return Number.isFinite(raw) ? raw : fallback
}

function pushExec(
  executions: SkillExecution[],
  moveId: string,
  moveName: string,
  count: number,
  dmg: number,
  note: string,
  opts?: {
    dmgBonus?: number
    critRateBonus?: number
    damageMultiplierOverride?: boolean
    category?: string
    skillDamageTarget?: string
  },
) {
  if (count <= 0 || dmg <= 0) return
  executions.push({
    moveId,
    moveName,
    category: opts?.category ?? 'special',
    count,
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
    damageMultiplier: dmg,
    damageMultiplierOverride: opts?.damageMultiplierOverride ?? true,
    element: 'ether',
    skillTableNote: note,
    skillDamageTarget: opts?.skillDamageTarget ?? 'exSpecial',
    ...(opts?.dmgBonus ? { dmgBonus: opts.dmgBonus } : {}),
    ...(opts?.critRateBonus ? { critRateBonus: opts.critRateBonus } : {}),
  } as SkillExecution)
}

function combatTimeOf(state: AgentResourceInput['state']): number {
  return (state.frontlineTime ?? 0) + (state.backstageTime ?? 0)
}

/**
 * 入场触发次数：全队快支+招架+回避支援 + 全队连携（编排注入 yaojiayinTeamChainTotal）。
 * 耀嘉音本人连携/终结进华彩不额外计「队友入场」，但队友连携入场会计入。
 */
export function estimateYaojiayinEntries(characters: CharacterOperationConfig[]): number {
  let entries = 0
  for (const ch of characters) {
    entries += Math.max(0, Math.floor(ch.quickAssistCount ?? 0))
    entries += Math.max(0, Math.floor(ch.parryCount ?? 0))
  }
  // 连携入场：编排写入 yaojiayinTeamChainTotal（全队 chainCountPerStun × 失衡次数）
  const injected = characters.find(c => c.agentId === YAOJIAYIN_ID)
  const injectedChains = Math.max(0, Math.floor(Number((injected as any)?.yaojiayinTeamChainTotal ?? 0)))
  entries += injectedChains
  return entries
}

export function applyYaojiayinTeamFlags(characters: CharacterOperationConfig[]): void {
  const yj = characters.find(c => c.agentId === YAOJIAYIN_ID)
  if (!yj) return
  const entries = estimateYaojiayinEntries(characters)
  ;(yj as any).yaojiayinEntryCount = entries
}

/**
 * 队伍级机制（原先由 useResourceCalc 手工调用 + 在编排层内联写 cfg 字段）：
 * 入场次数 = 全队快支 + 招架（build 阶段即可算）+ 全队连携（需要失衡次数 → converge 阶段）。
 * 连携总数与快支入场数原本由 useResourceCalc 直接写进 cfg（`yaojiayinTeamChainTotal` /
 * `yaojiayinQuickAssistEntries`），现在在模块内自算，编排层不再有 1311 特判分支。
 */
export function applyYaojiayinTeamHook(input: AgentTeamConfigInput): void {
  const { characters, phase, stunCount } = input
  if (phase !== 'build' && phase !== 'converge') return
  const yj = characters.find(c => c.agentId === YAOJIAYIN_ID)
  if (!yj) return
  if (phase === 'converge') {
    let teamChains = 0
    let quickAssists = 0
    for (const c of characters) {
      teamChains += Math.max(0, (c.chainCountPerStun ?? 0) * stunCount)
      quickAssists += Math.max(0, c.quickAssistCount ?? 0)
    }
    ;(yj as any).yaojiayinTeamChainTotal = teamChains
    ;(yj as any).yaojiayinQuickAssistEntries = quickAssists
  }
  applyYaojiayinTeamFlags(characters)
}

function applyPanel({ cinemaLevel, panel }: AgentPanelInput): void {
  // C4 异常/击破分支的面板加成在 helpers 按队内职业写到对应角色；此处不处理。
  void cinemaLevel
  void panel
}

function buildCharConfig({ skills, cinemaLevel, cfg, panel, team }: AgentCharConfigInput): void {
  const cinema = cinemaLevel ?? 0
  const record = cfg as unknown as Record<string, unknown>
  record.yaojiayinCinemaLevel = cinema
  record.yaojiayinAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0 ? 1 : 0
  record.yaojiayinAtk = panel.atk ?? 0
  record.yaojiayinTremoloDmg = rowVal(findMove(skills, MOVE_TREMOLO), 'damage')
  record.yaojiayinClusterDmg = rowVal(findMove(skills, MOVE_CLUSTER), 'damage')
  record.yaojiayinCapriccioDmg = rowVal(findMove(skills, MOVE_CAPRICCIO_CHARGED), 'damage')

  // 不走通用强特耗能：能量全部供给和弦震音
  cfg.exSpecialEnergyConsume = 0

  // 影画1：开场额外 1000 喧响（默认已有 1000 → 2000）
  if (cinema >= 1) {
    cfg.initialDecibelGift = (cfg.initialDecibelGift ?? 1000) + YAOJIAYIN_C1_DECIBEL
  }

  // 影画4：标记队内职业（供 helpers / 执行）
  const specs = new Set(
    team.filter(m => m.agentId && m.agentId !== YAOJIAYIN_ID).map(m => m.agent?.specialty).filter(Boolean),
  )
  record.yaojiayinTeamHasAttack = specs.has('attack') ? 1 : 0
  record.yaojiayinTeamHasAnomaly = specs.has('anomaly') ? 1 : 0
  record.yaojiayinTeamHasStun = specs.has('stun') ? 1 : 0
}

function buildExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.yaojiayinCinemaLevel ?? 0)))
  const additionalActive = Number(record.yaojiayinAdditionalActive ?? 0) > 0
  const combatTime = combatTimeOf(state)
  const entries = Math.max(0, Math.floor(Number(record.yaojiayinEntryCount ?? 0)))
  const totalEnergy = Math.max(0, Number(state.totalEnergy ?? 0))
  const result = computeYaojiayinTremolos({
    totalEnergy,
    entryCount: entries,
    combatTime,
    cinemaLevel: cinema,
    additionalActive,
  })
  record.yaojiayinTremolo = result

  const tremoloDmg = Number(record.yaojiayinTremoloDmg ?? 0) || 0
  const clusterDmg = Number(record.yaojiayinClusterDmg ?? 0) || 0
  const c6Mult = cinema >= 6 ? 2 : 1
  const c6Crit = cinema >= 6 ? 80 : 0

  pushExec(
    executions,
    MOVE_TREMOLO,
    '震音',
    result.totalTremolos,
    tremoloDmg * c6Mult,
    `震音 ×${result.totalTremolos}（付费 ${result.paidTremolos} + 免费 ${result.freeTremolos}`
      + `；入场 ${result.entries}；耗能 ${result.energyUsed}`
      + (c6Mult > 1 ? '；C6 倍率×2' : '')
      + '）',
    { critRateBonus: c6Crit, skillDamageTarget: 'exSpecial' },
  )

  pushExec(
    executions,
    MOVE_CLUSTER,
    '音簇',
    result.clusters,
    clusterDmg * c6Mult,
    `音簇 ×${result.clusters}（精准/C2 追加，每组 3 枚${c6Mult > 1 ? '；C6 倍率×2' : ''}）`,
    { critRateBonus: c6Crit, skillDamageTarget: 'exSpecial' },
  )

  if (result.c6Capriccio > 0) {
    const capDmg = Number(record.yaojiayinCapriccioDmg ?? 0) || 0
    pushExec(
      executions,
      MOVE_CAPRICCIO_CHARGED,
      '影画6·蓄力随想曲第三段',
      result.c6Capriccio,
      capDmg,
      `C6 精准支援追加随想曲蓄力段 ×${result.c6Capriccio}（${YAOJIAYIN_C6_CAPRICCIO_CD}s CD，暴击+80%）`,
      { critRateBonus: 80, category: 'basic', skillDamageTarget: 'basic' },
    )
  }

  // C4 强攻分支：快支入场 3s CD，300% 耀嘉音攻击附加
  if (cinema >= 4 && Number(record.yaojiayinTeamHasAttack ?? 0) > 0) {
    const qaEntries = Math.max(0, Math.floor(Number(record.yaojiayinQuickAssistEntries ?? 0)))
    const triggers = Math.min(qaEntries > 0 ? qaEntries : result.entries, Math.floor(combatTime / YAOJIAYIN_C4_BRANCH_CD))
    if (triggers > 0) {
      pushExec(
        executions,
        MOVE_C4_ATTACK_BONUS,
        '影画4·强攻快支附加',
        triggers,
        YAOJIAYIN_C4_ATK_MULT,
        `C4 强攻分支 ×${triggers}（${YAOJIAYIN_C4_BRANCH_CD}s CD，300% 耀嘉音攻击力）`,
        { category: 'basic', skillDamageTarget: 'basic' },
      )
    }
  }
}

function buildResourceResult({ cfg, state }: AgentResourceResultInput) {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.yaojiayinCinemaLevel ?? 0)))
  const additionalActive = Number(record.yaojiayinAdditionalActive ?? 0) > 0
  const result = computeYaojiayinTremolos({
    totalEnergy: Math.max(0, Number(state.totalEnergy ?? 0)),
    entryCount: Math.max(0, Math.floor(Number(record.yaojiayinEntryCount ?? 0))),
    combatTime: combatTimeOf(state as any),
    cinemaLevel: cinema,
    additionalActive,
  })
  record.yaojiayinTremolo = result
  return {
    yaojiayinTremolo: result,
    specResources: {
      yaojiayin_chord: {
        id: 'yaojiayin_chord',
        name: '和弦/震音',
        initialValue: 0,
        maxValue: null,
        totalGain: Math.floor(Math.max(0, Number(state.totalEnergy ?? 0)) / YAOJIAYIN_ENERGY_PER_TREMOLO),
        gains: { energy: Math.max(0, Number(state.totalEnergy ?? 0)) },
        bonusCount: result.freeTremolos,
        total: result.totalTremolos,
        remaining: 0,
        spendCounts: {
          paidTremolo: result.paidTremolos,
          cluster: result.clusters,
          c6Capriccio: result.c6Capriccio,
        },
        spendCosts: { tremolo: YAOJIAYIN_ENERGY_PER_TREMOLO },
      },
    },
  }
}

function resourceSections({ result }: AgentResourceSectionsInput) {
  const tr = (result as any)?.yaojiayinTremolo as YaojiayinTremoloResult | undefined
  if (!tr || tr.totalTremolos <= 0 && tr.clusters <= 0) return []
  return [{
    id: 'yaojiayin-tremolo',
    title: '耀嘉音·震音/音簇',
    summary: `震音 ${tr.totalTremolos} · 音簇 ${tr.clusters} · 入场 ${tr.entries}`,
    rows: [
      { label: '入场触发', value: String(tr.entries), detail: '全队快支+招架+回避支援+连携' },
      { label: '付费震音', value: String(tr.paidTremolos), detail: `每段 ${YAOJIAYIN_ENERGY_PER_TREMOLO} 能量` },
      { label: '免费震音', value: String(tr.freeTremolos), detail: '额外能力精准 + C2 入场追加' },
      { label: '音簇', value: String(tr.clusters), detail: '每组精准/C2 追加 3 枚' },
      ...(tr.c6Capriccio > 0
        ? [{ label: 'C6 随想曲', value: String(tr.c6Capriccio), detail: `${YAOJIAYIN_C6_CAPRICCIO_CD}s CD` }]
        : []),
    ],
  }]
}

export const yaojiayinMechanic: AgentMechanicModule = {
  applyTeamConfig: applyYaojiayinTeamHook,
  id: 'agent:yaojiayin',
  agentIds: [YAOJIAYIN_ID],
  name: '耀嘉音·咏叹华彩',
  description: '咏叹拐力、核心攻击、震音/音簇循环与影画1/2/4/6。',
  settings: [{
    id: 'yaojiayin.ariaCoverage',
    label: '咏叹华彩覆盖率',
    description: '全队伤害/暴伤拐的整局时间占比。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.1,
  }],
  applyPanel,
  buildCharConfig,
  buildExecutions,
  buildResourceResult,
  resourceSections,
}

export default yaojiayinMechanic
