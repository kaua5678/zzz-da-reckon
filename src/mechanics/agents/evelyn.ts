/**
 * 伊芙琳（1321）—— 牵缠禁制、燎火/燎索点、月辉丝连携与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1321.json，按核心被动 Lv.7。
 * - 核心被动缠丝：进入牵缠禁制暴击率+25%（退出后保有10秒），按可调整局覆盖率折算到面板。
 * - 额外能力潜袭支点：击破/支援队友激活；连携技与终结技增伤+30%；自身暴击率≥80%时
 *   月辉丝·绊/月辉丝·弦音伤害倍率×1.25（预缩倍率表值后经 damageMultiplierOverride 精确结算）。
 * - 燎火/燎索点：绞勒式次数显式可调（燎火累积速率原文未给数值，不做臆造）；燎索点=绞勒式+终结技
 *   各+1，每满3点把下一次绞勒式替换为月辉丝·绊，终结技后的焰舞觉醒使消耗降为净2点，按此折算追加连携。
 * - 影画1：进场喧响+1500（180秒一次整局近似）；攻击禁锢敌人无视12%防御按覆盖率折算。
 * - 影画2：攻击力+15% 沿用 computePanelPhases 既有块；燎火返还（25s一次返还50%燎火）按
 *   「额外绞勒式 floor(battleTime/25)」计入绞勒式与燎索点；打断等级提升（纯霸体）不建模。
 * - 影画4：连携/终结获得护盾时暴伤+40%，按持盾覆盖率折算。
 * - 影画6：弦影绝锋期间普攻/冲刺/特殊/强特命中追加月辉丝·弦追击（375%攻击力火伤，视为连携伤害），
 *   次数显式可调（每窗口上限16次）。
 * - 牵缠禁制/禁锢作为敌方状态、禁锢扩散、束裂式自动衔接等逐状态机制不在总量模型内，未建模。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
} from '../types'
import type { AgentSkills, SkillMove } from '@/types/catalog'

export const EVELYN_ID = '1321'
export const EVELYN_CHAIN_MOVE_ID = '1321015'
export const EVELYN_ULT_MOVE_ID = '1321016'
export const EVELYN_GARROTE_1_MOVE_ID = '1321006'
export const EVELYN_GARROTE_2_MOVE_ID = '1321007'
export const EVELYN_GARROTE_1_ACTION_TIME = 1.1
export const EVELYN_GARROTE_2_ACTION_TIME = 1.134
export const EVELYN_CHAIN_ACTION_TIME = 2.15
export const EVELYN_CORE_CRIT_RATE = 25
export const EVELYN_ADDITIONAL_DMG = 30
export const EVELYN_MULTIPLIER = 1.25
export const EVELYN_CRIT_THRESHOLD = 80
export const EVELYN_C1_DEF_IGNORE = 12
export const EVELYN_C1_DECIBEL_GIFT = 1500
export const EVELYN_C4_CRIT_DMG = 40
export const EVELYN_C6_FOLLOWUP_MULTIPLIER = 375
export const EVELYN_C2_EMBER_REFUND_INTERVAL = 25

const CHAIN_ULT_TARGETS = new Set<string>([EVELYN_CHAIN_MOVE_ID, EVELYN_ULT_MOVE_ID])

export interface EvelynCycle {
  cinemaLevel: number
  garroteCount: number
  garroteType1Count: number
  garroteType2Count: number
  c2BonusGarrote: number
  anchorPoints: number
  anchorCost: number
  anchorChainCount: number
  coreCritRate: number
  additionalActive: boolean
  additionalDmg: number
  multiplierActive: boolean
  c1DefIgnore: number
  c4CritDmg: number
  c6FollowUpCount: number
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

export function computeEvelynCycle(input: {
  cinemaLevel: number
  garroteCount: number
  ultimateCount: number
  baseCritRate: number
  additionalActive: boolean
  restraintCoverage: number
  c1DefIgnoreCoverage: number
  c4ShieldCoverage: number
  c6FollowUpCount: number
  battleTime?: number
}): EvelynCycle {
  const cinemaLevel = whole(input.cinemaLevel)
  const garroteCount = whole(input.garroteCount)
  const ultimateCount = whole(input.ultimateCount)
  const battleTime = Math.max(0, Number.isFinite(input.battleTime) ? Number(input.battleTime) : 180)
  // 影画2 燎火返还：发动绞勒式时返还所消耗的 50% 燎火（25s 一次）≈ 白嫖一次绞勒式。
  // 额外绞勒式同样 +1 燎索点（计入 anchorPoints），进而多换月辉丝·绊。
  const c2BonusGarrote = cinemaLevel >= 2 ? Math.floor(battleTime / EVELYN_C2_EMBER_REFUND_INTERVAL) : 0
  const totalGarrote = garroteCount + c2BonusGarrote
  const coreCritRate = EVELYN_CORE_CRIT_RATE * clampRatio(input.restraintCoverage)
  const anchorPoints = totalGarrote + ultimateCount
  const anchorCost = ultimateCount > 0 ? 2 : 3
  const anchorChainCount = Math.floor(anchorPoints / anchorCost)
  const additionalActive = input.additionalActive
  const multiplierActive = additionalActive
    && (input.baseCritRate + coreCritRate) >= EVELYN_CRIT_THRESHOLD
  return {
    cinemaLevel,
    garroteCount: totalGarrote,
    garroteType1Count: Math.ceil(totalGarrote / 2),
    garroteType2Count: Math.floor(totalGarrote / 2),
    c2BonusGarrote,
    anchorPoints,
    anchorCost,
    anchorChainCount,
    coreCritRate,
    additionalActive,
    additionalDmg: additionalActive ? EVELYN_ADDITIONAL_DMG : 0,
    multiplierActive,
    c1DefIgnore: cinemaLevel >= 1 ? EVELYN_C1_DEF_IGNORE * clampRatio(input.c1DefIgnoreCoverage) : 0,
    c4CritDmg: cinemaLevel >= 4 ? EVELYN_C4_CRIT_DMG * clampRatio(input.c4ShieldCoverage) : 0,
    c6FollowUpCount: cinemaLevel >= 6 ? whole(input.c6FollowUpCount) : 0,
    note: '绞勒式次数显式可调 + C2 燎火返还每25s白嫖一次；燎索点按绞勒式+终结技各+1折算追加连携；牵缠禁制/禁锢逐状态未建模。',
  }
}

function findMove(skills: AgentSkills | undefined, moveId: string): SkillMove | null {
  for (const category of skills?.categories ?? []) {
    const move = category.moves.find(item => item.id === moveId)
    if (move) return move
  }
  return null
}

function buildEvelynCharConfig({ cinemaLevel, skills, cfg, panel, getRowValue }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.evelynCinemaLevel = cinemaLevel
  record.evelynGarroteCount = whole(setting(cfg, 'evelyn.garroteCount', 4))
  record.evelynRestraintCoverage = clampRatio(setting(cfg, 'evelyn.restraintCoverage', 1))
  record.evelynC1DefIgnoreCoverage = clampRatio(setting(cfg, 'evelyn.c1DefIgnoreCoverage', 1))
  record.evelynC4ShieldCoverage = clampRatio(setting(cfg, 'evelyn.c4ShieldCoverage', 1))
  record.evelynC6FollowUpCount = whole(setting(cfg, 'evelyn.c6FollowUpCount', 16))
  record.evelynAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
  if (cinemaLevel >= 1) {
    cfg.initialDecibelGift = (cfg.initialDecibelGift ?? 0) + EVELYN_C1_DECIBEL_GIFT
  }
  // 额外能力×1.25：预缩倍率表值，patchExecutions 经 damageMultiplierOverride 精确结算。
  const additionalActive = record.evelynAdditionalActive === true
  const coreCritRate = EVELYN_CORE_CRIT_RATE * Number(record.evelynRestraintCoverage)
  const multiplierActive = additionalActive
    && ((panel.critRate ?? 0) + coreCritRate) >= EVELYN_CRIT_THRESHOLD
  record.evelynMultiplierActive = multiplierActive
  if (multiplierActive) {
    record.evelynChainMultScaled = getRowValue(findMove(skills, EVELYN_CHAIN_MOVE_ID), 'damage') * EVELYN_MULTIPLIER
    record.evelynUltMultScaled = getRowValue(findMove(skills, EVELYN_ULT_MOVE_ID), 'damage') * EVELYN_MULTIPLIER
  }
}

function cycleFromInput({ cfg, state }: Pick<AgentResourceInput, 'cfg' | 'state'>): EvelynCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computeEvelynCycle({
    cinemaLevel: Number(record.evelynCinemaLevel ?? 0),
    garroteCount: Number(record.evelynGarroteCount ?? 4),
    ultimateCount: state.ultimateCount,
    baseCritRate: Number((cfg.panel?.critRate as number | undefined) ?? 0),
    additionalActive: record.evelynAdditionalActive === true,
    restraintCoverage: Number(record.evelynRestraintCoverage ?? 1),
    c1DefIgnoreCoverage: Number(record.evelynC1DefIgnoreCoverage ?? 1),
    c4ShieldCoverage: Number(record.evelynC4ShieldCoverage ?? 1),
    c6FollowUpCount: Number(record.evelynC6FollowUpCount ?? 16),
    battleTime: Number((cfg as unknown as Record<string, unknown>).battleTime ?? 180),
  })
}

function pushEvelynExecution(executions: AgentResourceInput['executions'], input: {
  moveId: string
  moveName: string
  count: number
  category: string
  actionTime: number
  damageMultiplier?: number
  skillDamageTarget?: string
}): void {
  if (input.count <= 0) return
  executions.push({
    moveId: input.moveId,
    moveName: input.moveName,
    category: input.category,
    element: 'fire',
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
    ...(input.damageMultiplier == null
      ? {}
      : { damageMultiplier: input.damageMultiplier, damageMultiplierOverride: true }),
    ...(input.skillDamageTarget ? { skillDamageTarget: input.skillDamageTarget } : {}),
  })
}

function buildEvelynExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  pushEvelynExecution(executions, {
    moveId: EVELYN_GARROTE_1_MOVE_ID,
    moveName: '普通攻击：绞勒式·I型',
    count: cycle.garroteType1Count,
    category: 'basic',
    actionTime: EVELYN_GARROTE_1_ACTION_TIME,
  })
  pushEvelynExecution(executions, {
    moveId: EVELYN_GARROTE_2_MOVE_ID,
    moveName: '普通攻击：绞勒式·II型',
    count: cycle.garroteType2Count,
    category: 'basic',
    actionTime: EVELYN_GARROTE_2_ACTION_TIME,
  })
  pushEvelynExecution(executions, {
    moveId: EVELYN_CHAIN_MOVE_ID,
    moveName: '连携技：月辉丝·绊（燎索点追加）',
    count: cycle.anchorChainCount,
    category: 'chain',
    actionTime: EVELYN_CHAIN_ACTION_TIME,
  })
  pushEvelynExecution(executions, {
    moveId: '1321_c6_moonlight_followup',
    moveName: '月辉丝·弦追击（影画6）',
    count: cycle.c6FollowUpCount,
    category: 'chain',
    actionTime: 0,
    damageMultiplier: EVELYN_C6_FOLLOWUP_MULTIPLIER,
    skillDamageTarget: 'chain',
  })
}

function patchEvelynExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  const record = cfg as unknown as Record<string, unknown>
  const scaledChain = Number(record.evelynChainMultScaled ?? 0)
  const scaledUlt = Number(record.evelynUltMultScaled ?? 0)
  for (const exec of executions) {
    if (!CHAIN_ULT_TARGETS.has(exec.moveId)) continue
    if (cycle.additionalDmg > 0) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + cycle.additionalDmg
    }
    if (record.evelynMultiplierActive === true) {
      const scaled = exec.moveId === EVELYN_CHAIN_MOVE_ID ? scaledChain : scaledUlt
      if (scaled > 0) {
        exec.damageMultiplier = scaled
        exec.damageMultiplierOverride = true
      }
    }
  }
  // 影画6追击视为连携伤害，同样吃额外能力连携增伤。
  if (cycle.additionalDmg > 0) {
    for (const exec of executions) {
      if (exec.moveId === '1321_c6_moonlight_followup') {
        exec.dmgBonus = (exec.dmgBonus ?? 0) + cycle.additionalDmg
      }
    }
  }
}

function applyEvelynPanel({ charResult, panel }: AgentSkillTransformInput): void {
  if (!panel) return
  if ((panel as Record<string, unknown>).__evelynPanelApplied) return
  ;(panel as Record<string, unknown>).__evelynPanelApplied = true
  const cycle = charResult.specResources?.evelyn_cycle as EvelynCycle | undefined
  if (!cycle) return
  if (cycle.coreCritRate > 0) panel.critRate = (panel.critRate ?? 0) + cycle.coreCritRate
  if (cycle.c4CritDmg > 0) panel.critDmg = (panel.critDmg ?? 0) + cycle.c4CritDmg
  if (cycle.c1DefIgnore > 0) panel.enemyDefReduction = (panel.enemyDefReduction ?? 0) + cycle.c1DefIgnore
}

function buildEvelynResourceResult({ cfg, state }: AgentResourceResultInput) {
  return { specResources: { evelyn_cycle: cycleFromInput({ cfg, state }) } }
}

function buildEvelynResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.evelyn_cycle as EvelynCycle | undefined
  if (!cycle) return []
  return [{
    id: 'evelyn-cycle',
    title: '伊芙琳·燎火与月辉丝',
    summary: `绞勒式 ${cycle.garroteCount} 次 · 追加月辉丝·绊 ${cycle.anchorChainCount} 次`,
    rows: [
      { label: '燎索点', value: `${cycle.anchorPoints} 点`, detail: `绞勒式(含C2返还)+终结技各+1；每${cycle.anchorCost}点换1次月辉丝·绊` },
      { label: '影画2燎火返还', value: `+${cycle.c2BonusGarrote} 次`, detail: '每25s返还50%燎火=白嫖一次绞勒式（计入燎索点）' },
      { label: '牵缠禁制暴击', value: `+${cycle.coreCritRate}%`, detail: '核心被动按覆盖率折算' },
      { label: '连携/终结增伤', value: `+${cycle.additionalDmg}%`, detail: cycle.additionalActive ? '额外能力已激活' : '未激活（需击破/支援队友）' },
      { label: '倍率×1.25', value: cycle.multiplierActive ? '生效' : '未生效', detail: '暴击率≥80%时月辉丝·绊/弦音倍率提升' },
      { label: '影画1无视防御', value: `+${cycle.c1DefIgnore}%`, detail: '攻击禁锢敌人，按覆盖率折算' },
      { label: '影画4暴伤', value: `+${cycle.c4CritDmg}%`, detail: '持弦音护盾，按覆盖率折算' },
      { label: '影画6追击', value: `${cycle.c6FollowUpCount} 次`, detail: '375%攻击力火伤，视为连携伤害' },
    ],
    footer: cycle.note,
  }]
}

export const evelynMechanic: AgentMechanicModule = {
  id: 'agent:evelyn',
  agentIds: [EVELYN_ID],
  name: '伊芙琳·缠丝',
  description: '牵缠禁制暴击、额外能力连携/终结增益、燎火/燎索点循环与影画1/4/6。',
  settings: [
    { id: 'evelyn.garroteCount', label: '绞勒式次数', description: '整局消耗燎火发动绞勒式的次数（燎火累积速率原文未给数值，显式输入）', default: 4, min: 0, max: 30, step: 1, suffix: '次' },
    { id: 'evelyn.restraintCoverage', label: '牵缠禁制覆盖率', description: '核心被动暴击率+25%的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'evelyn.c1DefIgnoreCoverage', label: '影画1无视防御覆盖率', description: '攻击禁锢敌人无视12%防御的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'evelyn.c4ShieldCoverage', label: '影画4持盾覆盖率', description: '连携/终结护盾持有期间暴伤+40%的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'evelyn.c6FollowUpCount', label: '影画6追击次数', description: '弦影绝锋期间月辉丝·弦追击的实际触发次数（每窗口上限16次）', default: 16, min: 0, max: 48, step: 1, suffix: '次' },
  ],
  buildCharConfig: buildEvelynCharConfig,
  buildExecutions: buildEvelynExecutions,
  patchExecutions: patchEvelynExecutions,
  transformSkillExecutions: applyEvelynPanel,
  buildResourceResult: buildEvelynResourceResult,
  resourceSections: buildEvelynResourceSections,
}

export default evelynMechanic
