/**
 * 零号·安比（1381）—— 银星、白雷、雷殛与电磁涡流整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1381.json，按核心被动 Lv.7。
 * - 额外能力电极化：击破/支援队友激活，自身暴击率+10%。
 * - 影画2 冗余协议：暴击率+12%（电鸣替代白雷层数的资源细节未建模）。
 * - 核心被动电位差：对银星标记敌人伤害+25%，按可调整局覆盖率折算面板增伤。
 * - 影画4 银白残响：命中银星敌人无视12%电抗，按同一覆盖率折算面板电抗无视。
 * - 白雷额外伤害次数 = 苍光发动次数（每次消耗1层白雷触发1次）+ 影画1强特命中×3（不耗层）。
 *   白雷额外伤害用真实 moveId 1381007（苍光#1，actionTime=0，视为追加攻击）结算。
 * - 特殊技雷殛：同一敌人连续3次白雷额外伤害触发1次，真实 moveId 1381008（视为追加攻击）。
 * - 影画6 前传主角：每6次白雷额外伤害引发电磁涡流，1000%攻击力电伤（视为追加攻击），
 *   合成执行行 damageMultiplierOverride 结算（不伪造 catalog moveId）。
 *
 * 明确未建模/近似：
 * - 核心被动「银星使追加攻击暴击伤害额外提升=自身暴伤×35%（30%+延伸5%）」：经 spec teamBuffs
 *   derived 通道全队生效（sourceStat=critDmg 取安比自身局内暴伤，targetSkillType=additionalAttack）。
 * - 额外能力「全队追加攻击对银星敌人+25%」：经 spec teamBuffs fixed 通道全队生效
 *   （dmgBonus__additionalAttack）；潜能电脉冲 34-50% 档位待 teamBuff 通道支持 potentialLevel，暂以基线 25 建模。
 * - 影画2（用户口径 2026-08）：终结技 6 电鸣等效白雷直接计入总量；苍光·临界速度加快 50%
 *   （每 3 层电鸣一招，动作时间 ÷1.5，按电鸣配额折算均摊）。
 * - 苍光·临界（1381023）：每轮 3 层白雷打完后接一招收尾，499.1%、真实动作时间 0.867s 占前台。
 * - 连携/终结视为追加攻击伤害（Lv7 文本），供限定追击增伤命中。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
} from '../types'

export const ANBY_ZERO_ID = '1381'
export const ANBY_ZERO_WHITE_LIGHTNING_MOVE_ID = '1381007'
export const ANBY_ZERO_RAIJITU_MOVE_ID = '1381008'
export const ANBY_ZERO_CORE_DMG = 25
export const ANBY_ZERO_ADDITIONAL_CRIT_RATE = 10
export const ANBY_ZERO_C2_CRIT_RATE = 12
export const ANBY_ZERO_C4_RES_IGNORE = 12
export const ANBY_ZERO_C1_WHITE_LIGHTNING_PER_EX = 3
export const ANBY_ZERO_RAIJITU_PER_LIGHTNING = 3
export const ANBY_ZERO_VORTEX_PER_LIGHTNING = 6
export const ANBY_ZERO_CRITICAL_MOVE_ID = '1381023'
export const ANBY_ZERO_CRITICAL_ACTION_TIME = 0.867
/** 影画2：每次终结技获得 6 层电鸣（等效白雷触发，计入总量） */
export const ANBY_ZERO_C2_THUNDER_PER_ULT = 6
/** 影画2：每消耗 3 层电鸣，下一次苍光·临界速度加快 50%（动作时间 ÷1.5） */
export const ANBY_ZERO_C2_CRITICAL_SPEEDUP = 1.5
/** 核心被动：银星敌人受到的追加攻击暴伤额外提升 = 自身暴伤 ×（30% + 延伸 5%） */
export const ANBY_ZERO_FOLLOWUP_CRIT_DMG_RATIO = 0.35
export const ANBY_ZERO_C6_VORTEX_MULTIPLIER = 1000
/** 额外能力电极化「全队追加攻击对银星敌人伤害提升」按潜能等级（index 0 占位，1=I=25% … 6=VI=50%） */
export const ANBY_ZERO_TEAM_FOLLOWUP_DMG_BY_POTENTIAL = [0, 25, 34, 38, 42, 46, 50] as const

export interface AnbyZeroCycle {
  cinemaLevel: number
  potentialLevel: number
  cangguangCount: number
  silverStarCoverage: number
  additionalActive: boolean
  whiteLightningFromCangguang: number
  whiteLightningFromC1: number
  whiteLightningFromC2Thunder: number
  whiteLightningFromTeammates: number
  whiteLightningTotal: number
  raijituCount: number
  vortexCount: number
  criticalCount: number
  criticalFastCount: number
  criticalActionTime: number
  coreDmgBonus: number
  teamFollowupDmgBonus: number
  c4ResIgnore: number
  critRateGain: number
  note: string
}

function setting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const value = Number((cfg as unknown as Record<string, unknown>)[`setting:${id}`])
  return Number.isFinite(value) ? value : fallback
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function whole(value: number | undefined): number {
  const n = value ?? 0
  return Math.max(0, Math.floor(Number.isFinite(n) ? n : 0))
}

export function computeAnbyZeroCycle(input: {
  cinemaLevel: number
  potentialLevel: number
  cangguangCount: number
  exSpecialCount: number
  /** 缺省按 0（whole 兜底）：外层线程未回填/纯函数测试省略时合法 */
  ultimateCount?: number
  teammateWhiteLightning?: number
  additionalActive: boolean
  silverStarCoverage: number
}): AnbyZeroCycle {
  const cinemaLevel = whole(input.cinemaLevel)
  const potentialLevel = Math.max(1, Math.min(6, whole(input.potentialLevel)))
  const cangguangCount = whole(input.cangguangCount)
  const ultimateCount = whole(input.ultimateCount)
  const silverStarCoverage = clampRatio(input.silverStarCoverage)
  const whiteLightningFromCangguang = cangguangCount
  const whiteLightningFromC1 = cinemaLevel >= 1
    ? whole(input.exSpecialCount) * ANBY_ZERO_C1_WHITE_LIGHTNING_PER_EX
    : 0
  // 影画2：每次终结技获得 6 层电鸣，等效白雷触发——用户口径「不需要时序建模，直接加总量」
  const whiteLightningFromC2Thunder = cinemaLevel >= 2
    ? ultimateCount * ANBY_ZERO_C2_THUNDER_PER_ULT
    : 0
  // 队友追加攻击命中充能折算（外层线程回填，含 5s ICD 与 75% 计入系数）
  const whiteLightningFromTeammates = whole(input.teammateWhiteLightning)
  const whiteLightningTotal = whiteLightningFromCangguang + whiteLightningFromC1
    + whiteLightningFromC2Thunder + whiteLightningFromTeammates
  const raijituCount = Math.floor(whiteLightningTotal / ANBY_ZERO_RAIJITU_PER_LIGHTNING)
  // 苍光·临界：每轮 3 白雷打完接一招；C2 后每消耗 3 层电鸣有一招收尾加速 50%（动作时间 ÷1.5）
  const criticalCount = raijituCount
  const criticalFastCount = cinemaLevel >= 2 ? Math.min(criticalCount, ultimateCount * 2) : 0
  const criticalSlowCount = criticalCount - criticalFastCount
  const criticalActionTime = criticalCount > 0
    ? ANBY_ZERO_CRITICAL_ACTION_TIME * (criticalFastCount / ANBY_ZERO_C2_CRITICAL_SPEEDUP + criticalSlowCount) / criticalCount
    : ANBY_ZERO_CRITICAL_ACTION_TIME
  return {
    cinemaLevel,
    potentialLevel,
    cangguangCount,
    silverStarCoverage,
    additionalActive: input.additionalActive,
    whiteLightningFromCangguang,
    whiteLightningFromC1,
    whiteLightningFromC2Thunder,
    whiteLightningFromTeammates,
    whiteLightningTotal,
    raijituCount,
    vortexCount: cinemaLevel >= 6
      ? Math.floor(whiteLightningTotal / ANBY_ZERO_VORTEX_PER_LIGHTNING)
      : 0,
    criticalCount,
    criticalFastCount,
    criticalActionTime,
    coreDmgBonus: ANBY_ZERO_CORE_DMG * silverStarCoverage,
    teamFollowupDmgBonus: input.additionalActive
      ? ANBY_ZERO_TEAM_FOLLOWUP_DMG_BY_POTENTIAL[potentialLevel] * silverStarCoverage
      : 0,
    c4ResIgnore: cinemaLevel >= 4 ? ANBY_ZERO_C4_RES_IGNORE * silverStarCoverage : 0,
    critRateGain: (input.additionalActive ? ANBY_ZERO_ADDITIONAL_CRIT_RATE : 0)
      + (cinemaLevel >= 2 ? ANBY_ZERO_C2_CRIT_RATE : 0),
    note: '攻击数据充能：攻击命中→银星充能，每1/3充能=1层白雷（上限3）→3次苍光消耗3层并触发3白雷+1雷殛+1临界；影画2 终结技 6 电鸣等效白雷直接加总量、临界加速50%按电鸣配额折算。',
  }
}

function buildAnbyZeroCharConfig({ cinemaLevel, potentialLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.anbyZeroCinemaLevel = cinemaLevel
  record.anbyZeroPotentialLevel = potentialLevel
  record.anbyZeroCangguangCount = whole(setting(cfg, 'anbyZero.cangguangCount', 6))
  record.anbyZeroSilverStarCoverage = clampRatio(setting(cfg, 'anbyZero.silverStarCoverage', 1))
  record.anbyZeroAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
}

function cycleFromInput({ cfg, state }: Pick<AgentResourceInput, 'cfg' | 'state'>): AnbyZeroCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computeAnbyZeroCycle({
    cinemaLevel: Number(record.anbyZeroCinemaLevel ?? 0),
    potentialLevel: Number(record.anbyZeroPotentialLevel ?? 6),
    cangguangCount: Number(record.anbyZeroCangguangCount ?? 6),
    exSpecialCount: state.exSpecialCount,
    ultimateCount: state.ultimateCount,
    teammateWhiteLightning: Number(record.anbyZeroTeammateWhiteLightning ?? 0),
    additionalActive: record.anbyZeroAdditionalActive === true,
    silverStarCoverage: Number(record.anbyZeroSilverStarCoverage ?? 1),
  })
}

function pushAnbyZeroExecution(executions: AgentResourceInput['executions'], input: {
  moveId: string
  moveName: string
  count: number
  damageMultiplier?: number
  /** 非零 = 占用前台的真实动作时间（如苍光·临界收尾招） */
  actionTime?: number
}): void {
  if (input.count <= 0) return
  const actionTime = input.actionTime ?? 0
  executions.push({
    moveId: input.moveId,
    moveName: input.moveName,
    category: 'special',
    element: 'electric',
    count: input.count,
    actionTime,
    comboAlignRatio: 0,
    totalTime: actionTime * input.count,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    skillDamageTarget: 'additionalAttack',
    ...(input.damageMultiplier == null
      ? {}
      : { damageMultiplier: input.damageMultiplier, damageMultiplierOverride: true }),
  })
}

function buildAnbyZeroExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  pushAnbyZeroExecution(executions, {
    moveId: ANBY_ZERO_WHITE_LIGHTNING_MOVE_ID,
    moveName: '白雷额外伤害（苍光追击）',
    count: cycle.whiteLightningTotal,
  })
  pushAnbyZeroExecution(executions, {
    moveId: ANBY_ZERO_RAIJITU_MOVE_ID,
    moveName: '特殊技：雷殛',
    count: cycle.raijituCount,
  })
  // 苍光·临界：每轮 3 层白雷打完（= 雷殛一次的节奏）后接一招收尾强化特殊技，
  // 真实动作时间 0.867s/次占用前台；倍率 499.1% 走倍率表（含失衡/喧响/异常行）
  pushAnbyZeroExecution(executions, {
    moveId: ANBY_ZERO_CRITICAL_MOVE_ID,
    moveName: '特殊技：苍光·临界',
    count: cycle.criticalCount,
    actionTime: cycle.criticalActionTime,
  })
  pushAnbyZeroExecution(executions, {
    moveId: '1381_c6_electromagnetic_vortex',
    moveName: '电磁涡流（影画6）',
    count: cycle.vortexCount,
    damageMultiplier: ANBY_ZERO_C6_VORTEX_MULTIPLIER,
  })
}

function applyAnbyZeroPanel({ charResult, panel }: AgentSkillTransformInput): void {
  if (!panel) return
  ;(panel as Record<string, unknown>).__anbyZeroPanelApplied = true
  const ids = (charResult.executions ?? []).map(e => e.moveId).join(',')
  let patched = 0
  const cycle = charResult.specResources?.anby_zero_cycle as AnbyZeroCycle | undefined
  if (!cycle) return
  if (cycle.critRateGain > 0) panel.critRate = (panel.critRate ?? 0) + cycle.critRateGain
  if (cycle.coreDmgBonus > 0) panel.dmgBonus = (panel.dmgBonus ?? 0) + cycle.coreDmgBonus
  if (cycle.c4ResIgnore > 0) {
    panel.enemyElectricResReduction = (panel.enemyElectricResReduction ?? 0) + cycle.c4ResIgnore
  }
  // 全队追加攻击增伤（额外能力25%+潜能34-50%）与银星追攻暴伤（自身暴伤×35%）——
  // 均为全队向/敌方目标向增益，已由 spec teamBuffs 经 collectInCombatTeamBuffs 全队合并生效，
  // 不在此落自身面板（防双计，见 spec 1381 teamBuffs anby_zero_extra_team_followup / anby_zero_core_silverstar_crit）。
  for (const exec of charResult.executions ?? []) {
    // 核心被动 Lv7：零号·安比的连携技和终结技视为追加攻击伤害（供限定追击增伤命中）
    const mid = String(exec.moveId)
    if (mid === '1381014' || mid === '1381015') {
      exec.skillDamageTarget = 'additionalAttack'
    }
  }
}

function buildAnbyZeroResourceResult({ cfg, state }: AgentResourceResultInput) {
  return { specResources: { anby_zero_cycle: cycleFromInput({ cfg, state }) } }
}

function buildAnbyZeroResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.anby_zero_cycle as AnbyZeroCycle | undefined
  if (!cycle) return []
  return [{
    id: 'anby-zero-cycle',
    title: '零号·安比·白雷与电磁涡流',
    summary: `白雷 ${cycle.whiteLightningTotal} 次 · 雷殛 ${cycle.raijituCount} · 涡流 ${cycle.vortexCount}`,
    rows: [
      { label: '苍光发动', value: `${cycle.cangguangCount} 次`, detail: '每次消耗1层白雷触发1次白雷额外伤害；每轮3层打完接一招苍光·临界' },
      { label: '苍光·临界', value: `${cycle.criticalCount} 次`, detail: `每轮白雷打完后的收尾强技（499.1%）；影画2 加速 ${cycle.criticalFastCount} 次（÷1.5），均摊 ${cycle.criticalActionTime.toFixed(3)}s/次` },
      { label: '影画2 电鸣', value: `+${cycle.whiteLightningFromC2Thunder}`, detail: '每次终结技 6 层电鸣等效白雷触发，计入总量' },
      { label: '队友追攻白雷', value: `+${cycle.whiteLightningFromTeammates}`, detail: '队友追加攻击命中充能 16.667/次（5s ICD、计入 75%）→ 每 1/3 充能 1 层' },
      { label: '影画1强特白雷', value: `+${cycle.whiteLightningFromC1}`, detail: '强化特殊技命中×3，不耗白雷层数' },
      { label: '雷殛', value: `${cycle.raijituCount} 次`, detail: '同一敌人每3次白雷额外伤害触发' },
      { label: '电磁涡流', value: `${cycle.vortexCount} 次`, detail: '影画6每6次白雷触发1000%攻击力电伤' },
      { label: '银星增伤', value: `+${cycle.coreDmgBonus}%`, detail: '对银星标记敌人，按覆盖率折算' },
      { label: '全队追攻增伤', value: `+25%`, detail: '额外能力电极化（teamBuff 全队通道 dmgBonus__additionalAttack）；潜能电脉冲 34-50% 档位待 teamBuff 支持 potentialLevel' },
      { label: '影画4电抗无视', value: `+${cycle.c4ResIgnore}%`, detail: '命中银星敌人，按覆盖率折算' },
      { label: '暴击率', value: `+${cycle.critRateGain}%`, detail: '额外能力+10，影画2+12' },
    ],
    footer: cycle.note,
  }]
}

export const anbyZeroMechanic: AgentMechanicModule = {
  id: 'agent:anby_zero',
  agentIds: [ANBY_ZERO_ID],
  name: '零号·安比·电位差',
  description: '银星增伤、白雷/雷殛/电磁涡流折算、额外能力与影画2暴击、影画4电抗无视。',
  settings: [
    { id: 'anbyZero.cangguangCount', label: '苍光发动次数', description: '整局发动特殊技苍光的次数，每次消耗1层白雷触发1次白雷额外伤害', default: 6, min: 0, max: 40, step: 1, suffix: '次' },
    { id: 'anbyZero.silverStarCoverage', label: '银星覆盖率', description: '对银星标记敌人增伤与无视电抗的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
  ],
  buildCharConfig: buildAnbyZeroCharConfig,
  buildExecutions: buildAnbyZeroExecutions,
  transformSkillExecutions: applyAnbyZeroPanel,
  buildResourceResult: buildAnbyZeroResourceResult,
  resourceSections: buildAnbyZeroResourceSections,
}

export default anbyZeroMechanic
