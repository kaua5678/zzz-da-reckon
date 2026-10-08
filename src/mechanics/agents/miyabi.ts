import type {
  AgentCharConfigInput,
  AgentDamageResolution,
  AgentDamageResolutionInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
  AgentTeamPanelEffectInput,
  ExtraNecessaryAction,
  ReadonlyTeam,
} from '../types'
import type {
  CharacterOperationConfig,
  IterationState,
  SpecialResourceSection,
} from '@/types/resource'
import { fmt } from '@/utils/format'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import { additionalAbilityActiveOf } from '@/core/additionalAbilityActive'
import { findMoveById } from '@/data/moveTableQueries'
import { mechanicSettingReader } from '@/utils/mechanicSettingCfg'
import { cfgMoveActionTime } from '@/utils/moveActionTimeCfg'
import { moduleExecRow, RECOVERY_OFF, ENERGY_RECOVERY_OFF } from '@/mechanics/moduleExecRow'
import { cinemaLevelOf } from '@/data/cinemaLevel'

const setting = mechanicSettingReader(() => miyabiMechanic.settings)
const MIYABI_AGENT_ID = '1091'
/** 烈霜元素（独立元素，可在紊乱中与冰互紊） */
const FROSTFIRE = 'frostfire'
/** 霜月架势三段（最赚，消耗6落霜） */
const FROST_MOON_MOVE_ID = '1091029'
/** 0命且无风队时冰焰覆盖率的自动默认：手法上总是打出霜寒后才够6豆，三段蓄力全打在[霜寒]上，全吃不到 80% 加成（用户口径） */
const MIYABI_C0_ICEFLAME_DEFAULT_COVERAGE = 0
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
/** 核心被动「寒炎」：霜灼状态下所有单位（全队）属性异常积蓄效率 +20%（Lv.7，F2 裁决 2026-09-25 改全队） */
const FROSTBURN_TEAM_BUILDUP_BONUS = 20
/** C6：极意霜月伤害+30% */
const C6_FROST_MOON_DMG = 30
/** 霜月 #1 move id（C6 赠送） */
const FROST_MOON_1_MOVE_ID = '1091027'
/** 霜月 #2 move id（C6 赠送） */
const FROST_MOON_2_MOVE_ID = '1091028'
/** 霜月 #3 合轴锁定时间（秒）：非6命蓄力1秒后即可合轴 */
const FROST_MOON_3_LOCK_SECONDS = 1.0

/** 队伍中是否有风属性角色（影响霜灼状态覆盖率） */
function hasWindTeammate(team: ReadonlyTeam, slot: number): boolean {
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

function applyMiyabiPanel({ slot, cinemaLevel, team, panel, settings }: AgentPanelInput): void {
  // 额外能力·同沐霜雪（支援 / 同阵营 / 异常任一在队）：面板阶段按 spec 1091 additionalAbility 求值写入面板标记，这里只读标记
  // （原手写判定把同阵营臂写成同角色 id 的漂移史见 miyabiAdditionalAbility.test.ts）。
  const aa = additionalAbilityActiveOf(panel)
  const hasWind = hasWindTeammate(team, slot)

  // 面板级机制全部在 applyPanel 静态算（2026-09-01 架构修复：面板静态、循环只算招式/资源；
  // 曾由 transformSkillExecutions 每轮写面板 → 收敛轮间累积成 anomalyBuildUpEfficiency 600）。
  // 额外能力：紊乱触发霜月无视 30% 冰抗（面板近似；原 transform 判 frostFall 资源存在——
  // 紊乱正常发生时落霜必存在，静态化以 AA 激活为准）
  if (aa) {
    panel.enemyIceResReduction = panel.enemyIceResReduction + FROST_MOON_ICE_RES_IGNORE
  }

  // 额外能力：霜月伤害+60%（限定基本攻击，通过 targetSkillType 机制）
  if (aa) {
    panel['skillDmgBonus__basic'] = (panel['skillDmgBonus__basic'] ?? 0) + FROST_MOON_DMG_BONUS
  }

  // C2：暴击率+15%；风花/闪避反击伤害+30%
  if (cinemaLevel >= 2) {
    panel.critRate = panel.critRate + C2_CRIT_RATE
    // 风花（普攻）与闪避反击：通过 targetSkillType 定向增伤
    panel['skillDmgBonus__basic'] = (panel['skillDmgBonus__basic'] ?? 0) + C2_NA_AND_DODGE_COUNTER_DMG
    panel['skillDmgBonus__dodgeCounter'] = (panel['skillDmgBonus__dodgeCounter'] ?? 0) + C2_NA_AND_DODGE_COUNTER_DMG
  }

  // C4：霜灼·破伤害+30% —— 在执行级结算（本文件 `C4_FROSTBURN_DMG` 的 resolveExecutionDamage 读者），面板无字段。
  // r400：原在此写 `panel.miyabiFrostburnDmgBonus`，全仓零读者，只会让命座自检误判「面板有变化」（docs/mcp-panel-fields.md §2）。

  // C6：极意霜月伤害+30%（限定基本攻击）
  if (cinemaLevel >= 6) {
    panel['skillDmgBonus__basic'] = (panel['skillDmgBonus__basic'] ?? 0) + C6_FROST_MOON_DMG
  }

  // 冰焰积蓄效率：min(80, 暴击率) × 覆盖率（冰焰与霜灼互斥）。
  // 覆盖率自动默认：有风队友或≥影画1（霜寒后保留冰焰）→ 100%；0命无风队 → 0%
  // （蓄力斩打在霜寒上吃不到加成）；显式设为非 100% 的滑块值优先。
  // 原 buildCharConfig 算 coverage + transform 施加——静态化后都在 applyPanel（C2 暴击已加）。
  const coverageRaw = Number(settings['miyabi.iceFlameCoverage'])
  const autoDefault = hasWind || cinemaLevel >= 1 ? 1 : MIYABI_C0_ICEFLAME_DEFAULT_COVERAGE
  const coverage = Number.isFinite(coverageRaw) && coverageRaw !== 1
    ? Math.max(0, Math.min(1, coverageRaw))
    : autoDefault
  panel.miyabiIceFlameCoverage = coverage
  const iceFlameBonus = Math.min(ICE_FLAME_BUILDUP_MAX, panel.critRate) * coverage
  if (iceFlameBonus > 0) {
    panel.anomalyBuildUpEfficiency = panel.anomalyBuildUpEfficiency + iceFlameBonus
  }
  // 核心被动「霜灼状态：所有单位积蓄 +20%」已迁到 `teamPanelEffects`（F2 裁决 2026-09-25：
  // 原文「所有单位」= 全队，不是只写雅本人）；风队门控在那里直接调 `hasWindTeammate`。
}

// ============ buildCharConfig ============

function buildMiyabiCharConfig({ cfg, panel, cinemaLevel }: AgentCharConfigInput): void {
  // 霜月架势三段 actionTime 读 cfg.moveActionTimes（catalog，CC-409）
  cfg.miyabiCinemaLevel = cinemaLevel
  // 冰焰覆盖率已由 applyPanel 静态算好（settings + 队伍/命座自动默认），buildCharConfig 只读
  void panel
}

// ============ buildExecutions ============

/**
 * 霜月时间的账本预留（CC-202）：走通用 `extraNecessaryAction`，**不带 moveId** ⇒ 引擎只预留时间（含合轴抵扣）、
 * 不补行；行仍由 buildMiyabiExecutions 产出。原先霜月 #3（3.434s，仅 1s 锁定、其余合轴）的时间全靠
 * timeBudgetExcess 事后折叠，行上的合轴抵扣因此丢失（≈ 次数 × 2.434s 挤了平A池，§24.48 预筛）。
 * 次数来自 spec 资源「落霜」（cfg + state），不依赖当前执行行 ⇒ 无滞后。
 * 与产行逐项对齐：`miyabiFrostMoonReserveCc202.test.ts`。回退：删模块登记里的 extraNecessaryAction。
 */
function hasMiyabiCinema6(cfg: CharacterOperationConfig, cinemaLevel?: number): boolean {
  const c = cinemaLevel ?? cinemaLevelOf(cfg.miyabiCinemaLevel)
  return c >= 6
}

export function miyabiFrostMoonReserve(cfg: CharacterOperationConfig, state?: Readonly<IterationState>): ExtraNecessaryAction[] | null {
  if (!state) return null
  const res = getFrostFallResource(cfg, state)
  if (!res || res.frostMoonCount <= 0) return null
  const count = res.frostMoonCount
  const actionTime = cfgMoveActionTime(cfg, FROST_MOON_MOVE_ID)
  const out: ExtraNecessaryAction[] = [{
    count, moveName: '霜月 #3（账本预留）', actionTime,
    comboAlignRatio: (actionTime - FROST_MOON_3_LOCK_SECONDS) / actionTime, decibelRecovery: 0,
  }]
  if (hasMiyabiCinema6(cfg)) {
    out.push({ count, moveName: '霜月 #1（C6赠送，账本预留）', actionTime: cfgMoveActionTime(cfg, FROST_MOON_1_MOVE_ID), comboAlignRatio: 0, decibelRecovery: 0 })
    out.push({ count, moveName: '霜月 #2（C6赠送，账本预留）', actionTime: cfgMoveActionTime(cfg, FROST_MOON_2_MOVE_ID), comboAlignRatio: 0, decibelRecovery: 0 })
  }
  return out
}

function buildMiyabiExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const res = getFrostFallResource(cfg, state)
  if (!res || res.frostMoonCount <= 0) return

  const frostMoonCount = res.frostMoonCount
  const actionTime = cfgMoveActionTime(cfg, FROST_MOON_MOVE_ID)
  // 影画1（招式限定）：三段蓄力的每一段按已消耗落霜无视防御——#1(2豆)=12%、#2(4豆)=24%、#3(6豆)=36%
  const cinemaLevel = cinemaLevelOf(cfg.miyabiCinemaLevel)
  const m1DefShred = cinemaLevel >= 1

  // 霜月架势三段
  // 合轴：蓄力1秒后即可合轴，totalComboAlignTime = count × 1.0
  executions.push(moduleExecRow({
    moveId: FROST_MOON_MOVE_ID,
    moveName: '普通攻击：霜月 #3（蓄力三段，烈霜）',
    category: 'basic',
    count: frostMoonCount,
    actionTime: actionTime,
    // 用户口径：三段蓄力只有 1s 锁定窗口在前台，其余时间全部合轴
    comboAlignRatio: (actionTime - FROST_MOON_3_LOCK_SECONDS) / actionTime,
    totalTime: frostMoonCount * actionTime,
    totalComboAlignTime: frostMoonCount * (actionTime - FROST_MOON_3_LOCK_SECONDS),
    ...(m1DefShred ? { defIgnore: 36 } : {}),
  }))

  // C6：消耗落霜释放霜月#3时，额外赠送一次霜月#1 与 #2
  // 非C6只有霜月#3；C6固定额外赠送#1（910.1%）和#2（1717.2%），各随次数翻倍
  // 前台时间：霜月#1（0.4s完整动作，不合轴）+霜月#2（0.567s完整动作，不合轴）
  // +霜月#3（仅 1s 锁定在前台，其余合轴）= 每次前台合计 1.967s
  const hasC6 = hasMiyabiCinema6(cfg, cinemaLevel)
  if (hasC6 && frostMoonCount > 0) {
    for (const gift of [
      { moveId: FROST_MOON_1_MOVE_ID, moveName: '普通攻击：霜月 #1（C6赠送）', at: cfgMoveActionTime(cfg, FROST_MOON_1_MOVE_ID) },
      { moveId: FROST_MOON_2_MOVE_ID, moveName: '普通攻击：霜月 #2（C6赠送）', at: cfgMoveActionTime(cfg, FROST_MOON_2_MOVE_ID) },
    ]) {
      executions.push(moduleExecRow({
        moveId: gift.moveId,
        moveName: gift.moveName,
        category: 'basic',
        count: frostMoonCount,
        actionTime: gift.at,
        totalTime: frostMoonCount * gift.at,
        ...RECOVERY_OFF,
        ...(m1DefShred ? { defIgnore: gift.moveId === FROST_MOON_1_MOVE_ID ? 12 : 24 } : {}),
      }))
    }
  }

  // 霜灼·破直伤执行（倍率固定1500%×（1+C4），毕业终局）
  // 次数：默认按紊乱次数估算（每次紊乱伴随烈霜异常触发，贴近霜灼·破频率），用户可调上限
  const frostburnCountSetting = setting(cfg, 'miyabi.frostburnBreakCount')
  const safeRate = Math.max(0, Math.min(2, setting(cfg, 'miyabi.frostburnBreakRate')))
  const baseCount = frostburnCountSetting > 0
    ? frostburnCountSetting
    : Math.max(0, Math.floor(state.exSpecialCount * safeRate))
  const frostbreakCount = baseCount
  if (frostbreakCount > 0) {
    const hasC4 = cinemaLevel >= 4
    const perDecibel = hasC4 ? C4_FROSTBURN_DECIBEL : 0
    executions.push(moduleExecRow({
      moveId: 'miyabi_frostburn_break',
      moveName: '霜灼·破',
      category: 'basic',
      count: frostbreakCount,
      decibelRecovery: perDecibel,
      totalDecibelRecovery: perDecibel * frostbreakCount,
      ...ENERGY_RECOVERY_OFF,
      damageMultiplier: FROSTBURN_BREAK_MULTIPLIER,
    }))
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

function resolveMiyabiExecutionDamage(input: AgentDamageResolutionInput): AgentDamageResolution | null {
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
  const src = result.miyabiFrostFallSource
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
  /**
   * 核心被动「寒炎」：霜灼状态下，**所有单位**对目标累积的属性异常积蓄值 +20%（Lv.7）。
   *
   * F2 用户裁决 2026-09-25：原文「所有单位」= 全队，不是只写雅本人——从 `applyPanel`
   * （只写雅面板）迁入本钩子，对全队每个槽位统一 +20%（含雅本人：雅在 `team` 里，
   * 派发到自己槽位时同吃）。风队门控沿用（风化状态不被覆盖，霜灼无法触发 ⇒ 覆盖率为 0），
   * 与 `applyPanel` 同源调 `hasWindTeammate(team, slot)`（`slot` 是雅自己的槽位，见下方 CC-335 注）。
   *
   * 与 spec teamBuff `miyabi_c1_team_buildup`（影画一 +20%）是**两条独立 +20%**，可叠加：
   * 无风队里 C1 激活时每名队友与雅本人各 +40%（F1 裁决：核心被动与影画一在雅身上叠加为 +40）。
   * 契约见 `AgentTeamPanelEffectInput`（本钩子只允许可交换的加法 `+=`）。
   */
  teamPanelEffects: ({ slot, team, panel }: AgentTeamPanelEffectInput): void => {
    // CC-335：panel 是 targetSlot 的面板，原先读的风队标记只写在雅自己的面板上 ⇒ 有风队时队友误吃 +20%。
    // 改为与 applyMiyabiPanel 同源调 hasWindTeammate(team, slot)。r762 删掉那个面板标记：它只剩这里一个读者，且恒被前一条蕴含。
    if (hasWindTeammate(team, slot)) return
    panel.anomalyBuildUpEfficiency = panel.anomalyBuildUpEfficiency + FROSTBURN_TEAM_BUILDUP_BONUS
  },
  buildCharConfig: buildMiyabiCharConfig,
  buildExecutions: buildMiyabiExecutions,
  // CC-202：霜月时间进账本（只预留、不补行，合轴抵扣随之生效）
  extraNecessaryAction: miyabiFrostMoonReserve,
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
      description: '冰焰（烈霜积蓄效率+80%上限）的覆盖率。自动默认：有风队友或≥影画1（霜寒后保留冰焰）= 100%；0命无风队 = 0%（手法上总是先打霜寒才够 6 豆，三段蓄力全打在霜寒上，吃不到加成）。显式设为非 100% 的值优先。',
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

/**
 * D2（CC-359）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不再堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 星见雅命座等级（影画1 招式限定减防等按此门控） */
    miyabiCinemaLevel?: number
  }
}

/**
 * D2（CC-359/360）：本模块私有的结果字段——只有本文件读写，声明随模块走，不堆在 `types/resource/agentResources.ts`。
 * 仍是 `CharacterResourceResult` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 雅落霜资源明细 */
    miyabiFrostFallSource?: MiyabiFrostFallSource
  }
}

// ===== 本模块私有的结果类型（D2 / CC-360：原在 types/resource/agentResources.ts，只有本文件引用）=====

/** 雅落霜资源明细 */
export interface MiyabiFrostFallSource {
  total: number
  frostMoonCount: number
}

/**
 * D2（r402 CC-376，`docs/mcp-panel-fields.md` §4 S2+S4）：本模块私有的面板字段——只有本文件读写（测试读不算引用者），声明随模块走。
 * 仍是 `PanelValues` 的成员（模块扩充，纯类型、零运行时）；出现第二个**生产**引用者时迁回 `types/catalog.ts`。
 */
declare module '@/types/catalog' {
  interface PanelValues {
    /** 冰焰覆盖率：与积蓄效率增量同块写入；测试读 */
    miyabiIceFlameCoverage?: number
  }
}
