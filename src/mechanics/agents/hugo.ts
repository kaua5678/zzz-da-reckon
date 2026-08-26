/**
 * 雨果（1291）—— 暗渊回响、决算与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1291.json，按核心被动 Lv.7。
 * - 暗渊回响按可调覆盖率折算暴击+12%、暴伤+25%；C6默认满覆盖。
 * - 其他击破队友为1/2名时，自身攻击力固定+300/+900。
 * - 决算按可调“触发时剩余失衡秒数”计算额外倍率：基础1000%，前5秒每秒+280%，
 *   5~15秒每秒+100%，总上限3400%。当前总量模型展示返还失衡比例但不回灌下一条失衡。
 * - 强特倍率表拆为起手1291009与终结1291010；资源池只自动生成起手，本模块补齐终结一击。
 * - 普通敌人专属额外35%伤害与20能量不适用于当前首领口径，未建模。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
} from '../types'

export const HUGO_ID = '1291'
export const HUGO_EX_OPEN_MOVE_ID = '1291009'
export const HUGO_EX_FINAL_MOVE_ID = '1291010'
export const HUGO_CHAIN_MOVE_ID = '1291015'
export const HUGO_ULT_MOVE_ID = '1291018'
// 合成执行行 id（buildExecutions 产出；真实 1291010 由倍率表拆为起手/终结，模块按决算与否拆分结算）
export const HUGO_EX_VERDICT_MOVE_ID = '1291_ex_verdict_final'
export const HUGO_EX_NORMAL_MOVE_ID = '1291_ex_normal_final'
export const HUGO_C6_OUT_OF_STUN_VERDICT_MOVE_ID = '1291_c6_out_of_stun_verdict'
export const HUGO_ULT_VERDICT_BONUS_MOVE_ID = '1291_ultimate_verdict_bonus'
/**
 * 非轴模式吃满易伤的招式：失衡赠送连携 + 决算招式（强特终结一击/终结技本体与决算追加倍率）。
 * 其余（强特起手、普通攻击、失衡外强特终结、C6 轴外荆棘决算）在失衡外、不吃易伤。
 * 用户口径 2026-08-26：雨果能吃到易伤的就是失衡赠送连携和决算招式。
 */
export const HUGO_FULL_STUN_MOVES = new Set<string>([
  HUGO_CHAIN_MOVE_ID,
  HUGO_ULT_MOVE_ID,
  HUGO_EX_VERDICT_MOVE_ID,
  HUGO_ULT_VERDICT_BONUS_MOVE_ID,
])

/**
 * 轴模式「窗口终结」判定：强特终结一击(1291_ex_verdict_final) 永远结束失衡；
 * 终结技本体(1291018) 仅 C0/C1 结束失衡（影画2「终结技决算不结束失衡」不截断窗口）。
 */
export function isHugoEndsWindowMove(moveId: string, cinemaLevel: number): boolean {
  if (moveId === HUGO_EX_VERDICT_MOVE_ID) return true
  if (moveId === HUGO_ULT_MOVE_ID) return cinemaLevel < 2
  return false
}

/** 雨果决算块的动作时长兜底（合成行无倍率表条目时用模块常量） */
export function hugoMoveActionTime(moveId: string, catalogActionTime: number): number {
  if (moveId === HUGO_EX_VERDICT_MOVE_ID && catalogActionTime <= 0) return HUGO_EX_FINAL_ACTION_TIME
  return catalogActionTime
}
export const HUGO_EX_FINAL_BASE_MULTIPLIER = 709.8
export const HUGO_EX_FINAL_ACTION_TIME = 1.805
export const HUGO_VERDICT_BASE_MULTIPLIER = 1000
export const HUGO_VERDICT_MAX_MULTIPLIER = 3400
export const HUGO_ECHO_CRIT_RATE = 12
export const HUGO_ECHO_CRIT_DMG = 25
export const HUGO_C1_CRIT_RATE = 12
export const HUGO_C1_CRIT_DMG = 30
export const HUGO_C2_DEF_IGNORE = 15
export const HUGO_C4_ICE_RES_IGNORE = 12
export const HUGO_C6_DMG_BONUS = 60
export const HUGO_ADDITIONAL_CHAIN_DMG = 15
export const HUGO_ADDITIONAL_VERDICT_DMG = 40

export interface HugoCycle {
  cinemaLevel: number
  exSpecialCount: number
  ultimateCount: number
  exVerdictCount: number
  exNormalCount: number
  ultimateVerdictCount: number
  c6OutOfStunVerdictCount: number
  remainingStunSeconds: number
  verdictMultiplier: number
  stunRefundRatio: number
  echoCoverage: number
  note: string
}

function setting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const value = Number((cfg as unknown as Record<string, unknown>)[`setting:${id}`])
  return Number.isFinite(value) ? value : fallback
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function computeHugoVerdictMultiplier(remainingStunSeconds: number): number {
  const seconds = Math.max(0, Math.min(15, Number.isFinite(remainingStunSeconds) ? remainingStunSeconds : 0))
  const dynamic = Math.min(seconds, 5) * 280 + Math.max(0, seconds - 5) * 100
  return Math.min(HUGO_VERDICT_MAX_MULTIPLIER, HUGO_VERDICT_BASE_MULTIPLIER + dynamic)
}

export function computeHugoCycle(input: {
  cinemaLevel: number
  exSpecialCount: number
  ultimateCount: number
  exVerdictRatio: number
  ultimateVerdictRatio: number
  remainingStunSeconds: number
  echoCoverage: number
  /** 轴模式覆盖：强特决算次数 = 轴内 1291_ex_verdict_final 块 × 窗口数（合法轴；非法轴不建模） */
  exVerdictCountOverride?: number
  /** 轴模式覆盖：终结技决算次数 = 轴内 1291018 块 × 窗口数 */
  ultimateVerdictCountOverride?: number
}): HugoCycle {
  const cinemaLevel = Math.max(0, Math.floor(input.cinemaLevel))
  const exSpecialCount = Math.max(0, Math.floor(input.exSpecialCount))
  const ultimateCount = Math.max(0, Math.floor(input.ultimateCount))
  const exVerdictCount = input.exVerdictCountOverride !== undefined
    ? Math.min(exSpecialCount, Math.max(0, Math.floor(input.exVerdictCountOverride)))
    : Math.min(exSpecialCount, Math.round(exSpecialCount * clampRatio(input.exVerdictRatio)))
  const ultimateVerdictCount = input.ultimateVerdictCountOverride !== undefined
    ? Math.min(ultimateCount, Math.max(0, Math.floor(input.ultimateVerdictCountOverride)))
    : Math.min(ultimateCount, Math.round(ultimateCount * clampRatio(input.ultimateVerdictRatio)))
  const exNormalCount = exSpecialCount - exVerdictCount
  return {
    cinemaLevel,
    exSpecialCount,
    ultimateCount,
    exVerdictCount,
    exNormalCount,
    ultimateVerdictCount,
    c6OutOfStunVerdictCount: cinemaLevel >= 6 ? exNormalCount : 0,
    remainingStunSeconds: Math.max(0, Math.min(15, input.remainingStunSeconds)),
    verdictMultiplier: computeHugoVerdictMultiplier(input.remainingStunSeconds),
    stunRefundRatio: Math.min(0.25, Math.max(0, input.remainingStunSeconds) * 0.05),
    echoCoverage: cinemaLevel >= 6 ? 1 : clampRatio(input.echoCoverage),
    note: '决算按可调剩余失衡时间结算；失衡返还仅展示，不回灌失衡次数。',
  }
}

function applyHugoPanel({ slot, team, panel }: AgentPanelInput): void {
  const stunTeammates = team.filter(member =>
    member.slot !== slot && member.agent?.specialty === 'stun').length
  const atkBonus = stunTeammates >= 2 ? 900 : stunTeammates === 1 ? 300 : 0
  panel.atk = (panel.atk ?? 0) + atkBonus
  panel.hugoStunTeammateAtkBonus = atkBonus
}

function buildHugoCharConfig({ cinemaLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.hugoCinemaLevel = cinemaLevel
  record.hugoExVerdictRatio = clampRatio(setting(cfg, 'hugo.exVerdictRatio', 1))
  record.hugoUltimateVerdictRatio = clampRatio(setting(cfg, 'hugo.ultimateVerdictRatio', 1))
  record.hugoRemainingStunSeconds = Math.max(0, Math.min(15, setting(cfg, 'hugo.remainingStunSeconds', 5)))
  record.hugoEchoCoverage = cinemaLevel >= 6 ? 1 : clampRatio(setting(cfg, 'hugo.echoCoverage', 1))
  record.hugoC4Coverage = cinemaLevel >= 4 ? clampRatio(setting(cfg, 'hugo.c4Coverage', 1)) : 0
  record.hugoAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
  panel.hugoEchoCoverage = record.hugoEchoCoverage as number
}

function cycleFromInput({ cfg, state }: Pick<AgentResourceInput, 'cfg' | 'state'>): HugoCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computeHugoCycle({
    cinemaLevel: Number(record.hugoCinemaLevel ?? 0),
    exSpecialCount: state.exSpecialCount,
    ultimateCount: state.ultimateCount,
    exVerdictRatio: Number(record.hugoExVerdictRatio ?? 1),
    ultimateVerdictRatio: Number(record.hugoUltimateVerdictRatio ?? 1),
    remainingStunSeconds: Number(record.hugoRemainingStunSeconds ?? 5),
    echoCoverage: Number(record.hugoEchoCoverage ?? 1),
    exVerdictCountOverride: record.hugoAxisExVerdictCount !== undefined
      ? Number(record.hugoAxisExVerdictCount)
      : undefined,
    ultimateVerdictCountOverride: record.hugoAxisUltVerdictCount !== undefined
      ? Number(record.hugoAxisUltVerdictCount)
      : undefined,
  })
}

function pushExecution(executions: AgentResourceInput['executions'], input: {
  moveId: string
  moveName: string
  category: 'special' | 'chain'
  count: number
  actionTime: number
  damageMultiplier: number
  verdict: boolean
  cinemaLevel: number
  additionalActive: boolean
}): void {
  if (input.count <= 0) return
  const verdictDmg = input.verdict
    ? (input.additionalActive ? HUGO_ADDITIONAL_VERDICT_DMG : 0) + (input.cinemaLevel >= 6 ? HUGO_C6_DMG_BONUS : 0)
    : 0
  executions.push({
    moveId: input.moveId,
    moveName: input.moveName,
    category: input.category,
    element: 'ice',
    count: input.count,
    actionTime: input.actionTime,
    comboAlignRatio: 0,
    totalTime: input.count * input.actionTime,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    damageMultiplier: input.damageMultiplier,
    damageMultiplierOverride: true,
    ...(verdictDmg > 0 ? { dmgBonus: verdictDmg } : {}),
    ...(input.verdict && input.cinemaLevel >= 1
      ? { critRateBonus: HUGO_C1_CRIT_RATE, critDmgBonus: HUGO_C1_CRIT_DMG }
      : {}),
    ...(input.verdict && input.cinemaLevel >= 2 ? { defIgnore: HUGO_C2_DEF_IGNORE } : {}),
  })
}

function buildHugoExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  const record = cfg as unknown as Record<string, unknown>
  const additionalActive = record.hugoAdditionalActive === true
  pushExecution(executions, {
    moveId: HUGO_EX_VERDICT_MOVE_ID,
    moveName: '魂狩·惩戒·决算终结一击',
    category: 'special',
    count: cycle.exVerdictCount,
    actionTime: HUGO_EX_FINAL_ACTION_TIME,
    damageMultiplier: HUGO_EX_FINAL_BASE_MULTIPLIER + cycle.verdictMultiplier,
    verdict: true,
    cinemaLevel: cycle.cinemaLevel,
    additionalActive,
  })
  pushExecution(executions, {
    moveId: HUGO_EX_NORMAL_MOVE_ID,
    moveName: '魂狩·惩戒·终结一击',
    category: 'special',
    count: cycle.cinemaLevel >= 6 ? 0 : cycle.exNormalCount,
    actionTime: HUGO_EX_FINAL_ACTION_TIME,
    damageMultiplier: HUGO_EX_FINAL_BASE_MULTIPLIER,
    verdict: false,
    cinemaLevel: cycle.cinemaLevel,
    additionalActive,
  })
  pushExecution(executions, {
    moveId: HUGO_C6_OUT_OF_STUN_VERDICT_MOVE_ID,
    moveName: '魂狩·惩戒·荆棘决算',
    category: 'special',
    count: cycle.c6OutOfStunVerdictCount,
    actionTime: HUGO_EX_FINAL_ACTION_TIME,
    damageMultiplier: HUGO_EX_FINAL_BASE_MULTIPLIER + HUGO_VERDICT_BASE_MULTIPLIER,
    verdict: true,
    cinemaLevel: cycle.cinemaLevel,
    additionalActive,
  })
  pushExecution(executions, {
    moveId: HUGO_ULT_VERDICT_BONUS_MOVE_ID,
    moveName: '渎神者·决算追加倍率',
    category: 'chain',
    count: cycle.ultimateVerdictCount,
    actionTime: 0,
    damageMultiplier: cycle.verdictMultiplier,
    verdict: true,
    cinemaLevel: cycle.cinemaLevel,
    additionalActive,
  })
}

function patchHugoExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cycle = cycleFromInput({ cfg, state })
  const cinemaLevel = Number(record.hugoCinemaLevel ?? 0)
  const additionalActive = record.hugoAdditionalActive === true
  const c4Coverage = Number(record.hugoC4Coverage ?? 0)
  const exOutOfStunRatio = cycle.exSpecialCount > 0
    ? cycle.exNormalCount / cycle.exSpecialCount
    : 0
  const ultimateVerdictRatio = cycle.ultimateCount > 0
    ? cycle.ultimateVerdictCount / cycle.ultimateCount
    : 0
  for (const exec of executions) {
    if (exec.moveId === HUGO_EX_OPEN_MOVE_ID) {
      exec.stunBuildUpBonus = (exec.stunBuildUpBonus ?? 0) + 20 * exOutOfStunRatio
    }
    if (additionalActive && exec.moveId === HUGO_CHAIN_MOVE_ID) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + HUGO_ADDITIONAL_CHAIN_DMG
    }
    if (exec.moveId === HUGO_ULT_MOVE_ID) {
      if (ultimateVerdictRatio > 0) {
        if (additionalActive) {
          exec.dmgBonus = (exec.dmgBonus ?? 0) + HUGO_ADDITIONAL_VERDICT_DMG * ultimateVerdictRatio
        }
        if (cinemaLevel >= 1) {
          exec.critRateBonus = (exec.critRateBonus ?? 0) + HUGO_C1_CRIT_RATE * ultimateVerdictRatio
          exec.critDmgBonus = (exec.critDmgBonus ?? 0) + HUGO_C1_CRIT_DMG * ultimateVerdictRatio
        }
        if (cinemaLevel >= 2) {
          exec.defIgnore = (exec.defIgnore ?? 0) + HUGO_C2_DEF_IGNORE * ultimateVerdictRatio
        }
        if (cinemaLevel >= 6) {
          exec.dmgBonus = (exec.dmgBonus ?? 0) + HUGO_C6_DMG_BONUS * ultimateVerdictRatio
        }
      }
    }
    if (cinemaLevel >= 4 && c4Coverage > 0) {
      exec.resIgnore = (exec.resIgnore ?? 0) + HUGO_C4_ICE_RES_IGNORE * c4Coverage
    }
  }
}

function applyHugoEchoPanel({ charResult, panel }: AgentSkillTransformInput): void {
  if (!panel) return
  const cycle = charResult.specResources?.hugo_abyss_echo as HugoCycle | undefined
  if ((panel as Record<string, unknown>).__hugoEchoApplied) return
  ;(panel as Record<string, unknown>).__hugoEchoApplied = true
  const coverage = cycle?.echoCoverage ?? 0
  panel.critRate = (panel.critRate ?? 0) + HUGO_ECHO_CRIT_RATE * coverage
  panel.critDmg = (panel.critDmg ?? 0) + HUGO_ECHO_CRIT_DMG * coverage
  panel.hugoEchoCoverage = coverage
}

function buildHugoResourceResult({ cfg, state }: AgentResourceResultInput) {
  return { specResources: { hugo_abyss_echo: cycleFromInput({ cfg, state }) } }
}

function buildHugoResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.hugo_abyss_echo as HugoCycle | undefined
  if (!cycle) return []
  return [{
    id: 'hugo-verdict',
    title: '雨果·暗渊回响与决算',
    summary: `决算 ${cycle.exVerdictCount + cycle.ultimateVerdictCount} 次 · +${cycle.verdictMultiplier}%倍率`,
    rows: [
      { label: '暗渊回响覆盖', value: `${Math.round(cycle.echoCoverage * 100)}%`, detail: '暴击+12%、暴伤+25%按覆盖率折算' },
      { label: '强特决算', value: `${cycle.exVerdictCount} 次`, detail: `强特总计 ${cycle.exSpecialCount} 次` },
      { label: '终结技决算', value: `${cycle.ultimateVerdictCount} 次`, detail: `终结技总计 ${cycle.ultimateCount} 次` },
      { label: '触发时剩余失衡', value: `${cycle.remainingStunSeconds}秒`, detail: `决算额外倍率 +${cycle.verdictMultiplier}%` },
      { label: '失衡值返还', value: `${Math.round(cycle.stunRefundRatio * 100)}%`, detail: '展示原文上限；当前不回灌下一条失衡' },
    ],
    footer: cycle.note,
  }]
}

export const hugoMechanic: AgentMechanicModule = {
  id: 'agent:hugo',
  agentIds: [HUGO_ID],
  name: '雨果·终末裁决',
  description: '暗渊回响、击破队友攻击、决算倍率、额外能力与影画1/2/4/6。',
  settings: [
    { id: 'hugo.echoCoverage', label: '暗渊回响覆盖率', description: '6秒暴击/暴伤状态的整局覆盖率；影画6固定满覆盖', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'hugo.exVerdictRatio', label: '强特决算比例', description: '强化特殊技在失衡状态触发决算的比例', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'hugo.ultimateVerdictRatio', label: '终结技决算比例', description: '终结技在失衡状态触发决算的比例', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'hugo.remainingStunSeconds', label: '决算剩余失衡时间', description: '决算触发时敌人剩余的失衡秒数', default: 5, min: 0, max: 15, step: 0.5, suffix: '秒' },
    { id: 'hugo.c4Coverage', label: '影画4冰抗无视覆盖率', description: '蓄力射击后15秒冰抗无视的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
  ],
  applyPanel: applyHugoPanel,
  buildCharConfig: buildHugoCharConfig,
  buildExecutions: buildHugoExecutions,
  patchExecutions: patchHugoExecutions,
  transformSkillExecutions: applyHugoEchoPanel,
  buildResourceResult: buildHugoResourceResult,
  resourceSections: buildHugoResourceSections,
}

export default hugoMechanic
