import type {
  AgentCharConfigInput,
  AgentDamageResolutionInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
  MechanicTeamMember,
} from '../types'
import type { Agent, AgentSkills, SkillMove } from '@/types/catalog'
import type {
  CharacterOperationConfig,
  IterationState,
  SpecialResourceSection,
} from '@/types/resource'
import { fmt } from '@/utils/format'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'

const MIYABI_AGENT_ID = '1091'
/** 烈霜元素（独立元素，可在紊乱中与冰互紊） */
const FROSTFIRE = 'frostfire'
/** 霜月架势三段（最赚，消耗6落霜） */
const FROST_MOON_MOVE_ID = '1091029'
/** 0命且无风队时冰焰覆盖率的自动默认：手法上总是打出霜寒后才够6豆，三段蓄力全打在[霜寒]上，全吃不到 80% 加成（用户口径） */
const MIYABI_C0_ICEFLAME_DEFAULT_COVERAGE = 0
/** 霜月架势三段动作时间（秒） */
const FROST_MOON_ACTION_TIME = 3.434
/** 霜月架势三段消耗落霜 */
const FROST_MOON_COST = 6
/** 冰焰积蓄效率 = 暴击率×100%，上限80% */
const ICE_FLAME_BUILDUP_MAX = 80
/** 额外能力：霜月伤害+60% */
const FROST_MOON_DMG_BONUS = 60
/** 额外能力：霜月架势期间无视30%冰抗（每次紊乱触发） */
const FROST_MOON_ICE_RES_IGNORE = 30
/** 霜灼·破倍率（Lv.7 最高，毕业终局战斗） */
const FROSTBURN_BREAK_MULTIPLIER = 1500
/** C2：暴击率+15% */
const C2_CRIT_RATE = 15
/** C2：风花/闪避反击伤害+30% */
const C2_NA_AND_DODGE_COUNTER_DMG = 30
/** C4：霜灼·破伤害+30% */
const C4_FROSTBURN_DMG = 30
/** C4：霜灼·破额外喧响 */
const C4_FROSTBURN_DECIBEL = 250
/** C6：极意霜月伤害+30% */
const C6_FROST_MOON_DMG = 30
/** 霜月 #1 move id（C6 赠送） */
const FROST_MOON_1_MOVE_ID = '1091027'
/** 霜月 #2 move id（C6 赠送） */
const FROST_MOON_2_MOVE_ID = '1091028'
/** 霜月 #1 actionTime（秒） */
const FROST_MOON_1_ACTION_TIME = 0.4
/** 霜月 #2 actionTime（秒） */
const FROST_MOON_2_ACTION_TIME = 0.567
/** 霜月 #3 合轴锁定时间（秒）：非6命蓄力1秒后即可合轴 */
const FROST_MOON_3_LOCK_SECONDS = 1.0

function findMoveById(skills: AgentSkills | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const cat of skills.categories) {
    const move = cat.moves.find(m => m.id === moveId)
    if (move) return move
  }
  return null
}

/** 额外能力：队伍中存在「支援」或同阵营或「异常」角色 */
function isAdditionalAbilityActive(team: MechanicTeamMember[], slot: number, agent: Agent): boolean {
  return team.some(member => {
    if (member.slot === slot || !member.agent) return false
    return member.agent.specialty === 'support'
      || member.agent.specialty === 'anomaly'
      || member.agent.id === agent.id
  })
}

/** 队伍中是否有风属性角色（影响霜灼状态覆盖率） */
function hasWindTeammate(team: MechanicTeamMember[], slot: number): boolean {
  return team.some(m => m.slot !== slot && m.agent?.damageElement === 'wind')
}

function getFrostFallResource(
  cfg: CharacterOperationConfig,
  state: IterationState,
): { frostFall: number; frostMoonCount: number } | null {
  const spec = getAgentSpec(MIYABI_AGENT_ID)
  if (!spec) return null
  const res = computeSpecResources(spec, cfg, state).get('miyabi_frost_fall')
  if (!res) return null
  const frostMoonCount = Math.max(0, Math.floor(res.total / FROST_MOON_COST))
  return { frostFall: res.total, frostMoonCount }
}

// ============ applyPanel ============

function applyMiyabiPanel({ slot, agent, cinemaLevel, team, panel, settings }: AgentPanelInput): void {
  const aa = isAdditionalAbilityActive(team, slot, agent)
  const hasWind = hasWindTeammate(team, slot)
  panel.miyabiEnabled = 1
  panel.miyabiAdditionalAbilityActive = aa ? 1 : 0
  panel.miyabiCinema2 = cinemaLevel >= 2 ? 1 : 0
  panel.miyabiCinema4 = cinemaLevel >= 4 ? 1 : 0
  panel.miyabiCinema6 = cinemaLevel >= 6 ? 1 : 0
  // 标记风队伍状态（用于霜灼buff覆盖率）
  panel.miyabiHasWindTeammate = hasWind ? 1 : 0

  // 面板级机制全部在 applyPanel 静态算（2026-09-01 架构修复：面板静态、循环只算招式/资源；
  // 曾由 transformSkillExecutions 每轮写面板 → 收敛轮间累积成 anomalyBuildUpEfficiency 600）。
  // 额外能力：紊乱触发霜月无视 30% 冰抗（面板近似；原 transform 判 frostFall 资源存在——
  // 紊乱正常发生时落霜必存在，静态化以 AA 激活为准）
  if (aa) {
    panel.enemyIceResReduction = (panel.enemyIceResReduction ?? 0) + FROST_MOON_ICE_RES_IGNORE
  }

  // 额外能力：霜月伤害+60%（限定基本攻击，通过 targetSkillType 机制）
  if (aa) {
    panel['skillDmgBonus__basic'] = (panel['skillDmgBonus__basic'] ?? 0) + FROST_MOON_DMG_BONUS
  }

  // C2：暴击率+15%；风花/闪避反击伤害+30%
  if (cinemaLevel >= 2) {
    panel.critRate = (panel.critRate ?? 0) + C2_CRIT_RATE
    panel.miyabiCinema2EntryFrostFall = 6
    // 风花（普攻）与闪避反击：通过 targetSkillType 定向增伤
    panel['skillDmgBonus__basic'] = (panel['skillDmgBonus__basic'] ?? 0) + C2_NA_AND_DODGE_COUNTER_DMG
    panel['skillDmgBonus__dodgeCounter'] = (panel['skillDmgBonus__dodgeCounter'] ?? 0) + C2_NA_AND_DODGE_COUNTER_DMG
  }

  // C4：霜灼·破伤害+30%
  if (cinemaLevel >= 4) {
    panel.miyabiFrostburnDmgBonus = C4_FROSTBURN_DMG
  }

  // C6：极意霜月伤害+30%（限定基本攻击）
  if (cinemaLevel >= 6) {
    panel['skillDmgBonus__basic'] = (panel['skillDmgBonus__basic'] ?? 0) + C6_FROST_MOON_DMG
  }

  // 冰焰积蓄效率：min(80, 暴击率) × 覆盖率（冰焰与霜灼互斥）。
  // 覆盖率自动默认：有风队友或≥影画1（霜寒后保留冰焰）→ 100%；0命无风队 → 0%
  // （蓄力斩打在霜寒上吃不到加成）；显式设为非 100% 的滑块值优先。
  // 原 buildCharConfig 算 coverage + transform 施加——静态化后都在 applyPanel（C2 暴击已加）。
  const coverageRaw = Number(settings?.['miyabi.iceFlameCoverage'])
  const autoDefault = hasWind || cinemaLevel >= 1 ? 1 : MIYABI_C0_ICEFLAME_DEFAULT_COVERAGE
  const coverage = Number.isFinite(coverageRaw) && coverageRaw !== 1
    ? Math.max(0, Math.min(1, coverageRaw))
    : autoDefault
  panel.miyabiIceFlameCoverage = coverage
  const iceFlameBonus = Math.min(ICE_FLAME_BUILDUP_MAX, panel.critRate ?? 0) * coverage
  if (iceFlameBonus > 0) {
    panel.anomalyBuildUpEfficiency = (panel.anomalyBuildUpEfficiency ?? 0) + iceFlameBonus
  }
  // 霜灼状态全队积蓄效率 +20%（风队除外：风化状态不被覆盖，霜灼无法触发）
  if (!hasWind) {
    panel.anomalyBuildUpEfficiency = (panel.anomalyBuildUpEfficiency ?? 0) + 20
  }
}

// ============ buildCharConfig ============

function buildMiyabiCharConfig({ skills: _skills, cfg, panel, cinemaLevel }: AgentCharConfigInput): void {
  cfg.miyabiEnabled = true
  cfg.miyabiFrostMoonMoveId = FROST_MOON_MOVE_ID
  cfg.miyabiFrostMoonCount = FROST_MOON_COST
  cfg.miyabiFrostMoonActionTime = FROST_MOON_ACTION_TIME
  cfg.miyabiCinemaLevel = cinemaLevel
  // 冰焰覆盖率已由 applyPanel 静态算好（settings + 队伍/命座自动默认），buildCharConfig 只读
  void panel
}

// ============ buildExecutions ============

function buildMiyabiExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const res = getFrostFallResource(cfg, state)
  if (!res || res.frostMoonCount <= 0) return

  const frostMoonCount = res.frostMoonCount
  const actionTime = cfg.miyabiFrostMoonActionTime ?? FROST_MOON_ACTION_TIME
  // 影画1（招式限定）：三段蓄力的每一段按已消耗落霜无视防御——#1(2豆)=12%、#2(4豆)=24%、#3(6豆)=36%
  const cinemaLevel = Math.max(0, Math.floor(Number((cfg as unknown as Record<string, unknown>).miyabiCinemaLevel ?? 0)))
  const m1DefShred = cinemaLevel >= 1

  // 霜月架势三段
  // 合轴：蓄力1秒后即可合轴，totalComboAlignTime = count × 1.0
  executions.push({
    moveId: FROST_MOON_MOVE_ID,
    moveName: '普通攻击：霜月 #3（蓄力三段，烈霜）',
    category: 'basic',
    count: frostMoonCount,
    actionTime: actionTime,
    // 用户口径：三段蓄力只有 1s 锁定窗口在前台，其余时间全部合轴
    comboAlignRatio: (actionTime - FROST_MOON_3_LOCK_SECONDS) / actionTime,
    totalTime: frostMoonCount * actionTime,
    totalComboAlignTime: frostMoonCount * (actionTime - FROST_MOON_3_LOCK_SECONDS),
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    ...(m1DefShred ? { defIgnore: 36 } : {}),
  })

  // C6：消耗落霜释放霜月#3时，额外赠送一次霜月#1 与 #2
  // 非C6只有霜月#3；C6固定额外赠送#1（910.1%）和#2（1717.2%），各随次数翻倍
  // 前台时间：霜月#1（0.4s完整动作，不合轴）+霜月#2（0.567s完整动作，不合轴）
  // +霜月#3（仅 1s 锁定在前台，其余合轴）= 每次前台合计 1.967s
  const hasC6 = Boolean((cfg.panel as any)?.miyabiCinema6)
  if (hasC6 && frostMoonCount > 0) {
    for (const gift of [
      { moveId: FROST_MOON_1_MOVE_ID, moveName: '普通攻击：霜月 #1（C6赠送）', at: FROST_MOON_1_ACTION_TIME },
      { moveId: FROST_MOON_2_MOVE_ID, moveName: '普通攻击：霜月 #2（C6赠送）', at: FROST_MOON_2_ACTION_TIME },
    ]) {
      executions.push({
        moveId: gift.moveId,
        moveName: gift.moveName,
        category: 'basic',
        count: frostMoonCount,
        actionTime: gift.at,
        comboAlignRatio: 0,
        totalTime: frostMoonCount * gift.at,
        totalComboAlignTime: 0,
        energyConsume: 0,
        totalEnergyConsume: 0,
        decibelRecovery: 0,
        totalDecibelRecovery: 0,
        energyRecovery: 0,
        totalEnergyRecovery: 0,
        ...(m1DefShred ? { defIgnore: gift.moveId === FROST_MOON_1_MOVE_ID ? 12 : 24 } : {}),
      })
    }
  }

  // 霜灼·破直伤执行（倍率固定1500%×（1+C4），毕业终局）
  // 次数：默认按紊乱次数估算（每次紊乱伴随烈霜异常触发，贴近霜灼·破频率），用户可调上限
  const frostburnCountSetting = Number((cfg as unknown as Record<string, unknown>)['setting:miyabi.frostburnBreakCount'] ?? 0)
  const frostburnRate = Number((cfg as unknown as Record<string, unknown>)['setting:miyabi.frostburnBreakRate'] ?? 1)
  const safeRate = Math.max(0, Math.min(2, Number.isFinite(frostburnRate) ? frostburnRate : 1))
  const baseCount = frostburnCountSetting > 0
    ? frostburnCountSetting
    : Math.max(0, Math.floor((state.exSpecialCount ?? 0) * safeRate))
  const frostbreakCount = baseCount
  if (frostbreakCount > 0) {
    const hasC4 = Boolean((cfg.panel as any)?.miyabiCinema4)
    const perDecibel = hasC4 ? C4_FROSTBURN_DECIBEL : 0
    executions.push({
      moveId: 'miyabi_frostburn_break',
      moveName: '霜灼·破',
      category: 'basic',
      count: frostbreakCount,
      actionTime: 0,
      comboAlignRatio: 0,
      totalTime: 0,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: perDecibel,
      totalDecibelRecovery: perDecibel * frostbreakCount,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      damageMultiplier: FROSTBURN_BREAK_MULTIPLIER,
    })
  }
}

// ============ transformSkillExecutions ============

function transformMiyabiSkillExecutions(input: AgentSkillTransformInput): void {
  const {
    slot,
    agent: _agent,
    skills,
    charResult,
    panel: _panel,
    cinemaLevel: _cinemaLevel,
    team: _team,
    dazeCoef,
    stunExecs,
    anomalyExecs,
    getRowValue,
    normalizeResourceSkillType,
  } = input
  // 本钩子只做 exec 构建（烈霜归并/锁定）；面板写入一律在 applyPanel（静态，2026-09-01 架构修复）

  // ---- 生成 stun/anomaly execs ----
  for (const exec of charResult.executions) {
    if (exec.count <= 0 && exec.totalTime <= 0) continue
    if (exec.moveId === 'basic_attack') continue

    const foundMove = findMoveById(skills, exec.moveId)
    if (!foundMove) continue
    const count = exec.count
    const daze = getRowValue(foundMove, 'daze')
    const anomaly = getRowValue(foundMove, 'anomaly_buildup')
    const moveName = exec.moveName.replace(/（.*）/g, '').trim()
    // 雅的所有招式积蓄/失衡都归为烈霜（独立元素）
    const element = FROSTFIRE

    if (daze > 0 && count > 0) {
      stunExecs.push({
        moveId: exec.moveId,
        moveName,
        slot,
        count,
        baseDaze: daze * dazeCoef,
        element,
        skillType: normalizeResourceSkillType(foundMove, exec.moveId),
      })
    }

if (anomaly > 0 && count > 0) {
	      anomalyExecs.push({
	        moveId: exec.moveId,
	        moveName,
	        slot,
	        count,
	        baseBuildUp: anomaly,
	        element,
	      })
	    }
	  }

	  // 修正 generic 路径推入的 basic_attack 元素：从 fallbackElement(ice) 改为 FROSTFIRE
	  for (const exec of stunExecs) {
	    if (exec.moveId === 'basic_attack') exec.element = FROSTFIRE
	  }
	  for (const exec of anomalyExecs) {
	    if (exec.moveId === 'basic_attack') exec.element = FROSTFIRE
	  }
}

// ============ resolveExecutionDamage ============

function resolveMiyabiExecutionDamage(input: AgentDamageResolutionInput): { element: string; source?: string; note?: string } | null {
  const { move, exec, cinemaLevel } = input
  if (!move) return null

  // 霜灼·破直伤（从buildExecutions推入的自定义执行）
  if (exec.moveId === 'miyabi_frostburn_break') {
    const dmgBonus = (cinemaLevel >= 4 ? C4_FROSTBURN_DMG : 0)
    return {
      element: FROSTFIRE,
      source: '霜灼·破',
      note: `霜灼·破直伤，固定倍率 ${FROSTBURN_BREAK_MULTIPLIER}% ATK（Lv.7 毕业终局）${dmgBonus > 0 ? `，C4 额外+${dmgBonus}%` : ''}；吃双爆不吃精通。`,
    }
  }

  // 所有雅招式元素 -> 烈霜
  return {
    element: FROSTFIRE,
    note: '雅的所有伤害均为烈霜（独立元素，可在紊乱中与冰互紊）。',
  }
}

// ============ buildResourceResult / resourceSections ============

function buildMiyabiResourceResult({ cfg, state }: AgentResourceResultInput): Partial<import('@/types/resource').CharacterResourceResult> {
  const res = getFrostFallResource(cfg, state)
  return {
    miyabiFrostFallSource: res ? { total: res.frostFall, frostMoonCount: res.frostMoonCount } : undefined,
  }
}

function buildMiyabiResourceSections({ result }: AgentResourceSectionsInput): SpecialResourceSection[] {
  const src = (result as any)?.miyabiFrostFallSource
  if (!src) return []
  return [{
    id: 'miyabi-frost-fall',
    title: '雅·落霜',
    summary: `剩余 ${fmt(src.total, 1)} / 霜月三段 ${src.frostMoonCount} 次`,
    rows: [
      { label: '落霜总量', value: `${fmt(src.total, 1)}`, detail: '紊乱×2 + 霜灼·破×1 + C2入场6' },
      { label: '霜月三段消耗', value: `${src.frostMoonCount} 次`, detail: `${FROST_MOON_COST} 落霜/次 → 4282.8% 烈霜直伤` },
    ],
  }]
}

// ============ module export ============

export const miyabiMechanic: AgentMechanicModule = {
  id: 'agent:miyabi',
  agentIds: [MIYABI_AGENT_ID],
  name: '雅',
  description: '烈霜独立元素、冰焰积蓄效率、落霜状态机、霜月架势三段、霜灼·破直伤与命座机制。',
  applyPanel: applyMiyabiPanel,
  buildCharConfig: buildMiyabiCharConfig,
  buildExecutions: buildMiyabiExecutions,
  anomalyBuildupElement: FROSTFIRE,
  replaceSkillExecutionExtraction: true,
  transformSkillExecutions: transformMiyabiSkillExecutions,
  resolveExecutionDamage: resolveMiyabiExecutionDamage,
  buildResourceResult: buildMiyabiResourceResult,
  resourceSections: buildMiyabiResourceSections,
  settings: [
    {
      id: 'miyabi.iceFlameCoverage',
      label: '雅·冰焰覆盖率',
      description: '冰焰（烈霜积蓄效率+80%上限）的覆盖率。自动默认：有风队友或≥影画1（霜寒后保留冰焰）= 100%；0命无风队 = 60%（蓄力斩打在霜寒上吃不到加成）。显式设为非 100% 的值优先。',
      default: 1.0,
      min: 0,
      max: 1,
      step: 0.05,
      suffix: '%',
    },
    {
      id: 'miyabi.frostburnBreakCount',
      label: '雅·霜灼·破次数',
      description: '霜灼·破直伤触发次数。默认 0 表示按强特次数估算；填正数则直接指定次数。',
      default: 0,
      min: 0,
      max: 60,
      step: 1,
      suffix: '次',
    },
    {
      id: 'miyabi.frostburnBreakRate',
      label: '雅·霜灼·破利用率',
      description: '霜灼·破默认次数（强特估算）的利用率，默认 100%。',
      default: 1,
      min: 0,
      max: 2,
      step: 0.05,
      suffix: '%',
    },
  ],
}