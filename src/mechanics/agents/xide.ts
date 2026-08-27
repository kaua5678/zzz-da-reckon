import type { AgentCharConfigInput, AgentMechanicModule, AgentPanelInput, AgentResourceInput, AgentResourceResultInput, AgentResourceSectionsInput, AgentTeamConfigInput } from '../types'
import type { AgentSkills, SkillMove } from '@/types/catalog'
import type { SkillExecution } from '@/types/resource'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import { specToMechanicModule } from '@/specs/mechanics'

/**
 * 「席德」（1461，电·强攻，新艾利都防卫军）—— 正兵拐 + 自身机制 + 钢能消耗出口模块。
 * 机制文本来源：nanoka 3.2.3+18244196 zh character/1461.json。
 *
 * 正兵拐主体在 teammate-buffs.json 1461 组（明攻攻击/暴伤、围杀增伤、影画2 无视防御，
 * 按 spec.additionalAbility「其他强攻」门控，见 computePanelPhases 过滤链）。
 *
 * 额外能力·奇兵轰临（additionalAbilityActive 门控）——**全部招式限定**（patchExecutions 执行级）：
 * - 落华·重戮（1461006）/落华·崩坠一式（1461007）/二式（1461008）/终结技（1461015）
 *   增伤 +30% → 执行级 dmgBonus（不再走 skillDmgBonus__basic 面板级，避免霜蕊轮舞多吃）；
 * - 上述招式无视 25% 电抗 → 执行级 resIgnore（不再走 enemyElectricResReduction 面板级）。
 *
 * 影画4·芳香调（围杀条件门控）：终结技伤害+20%（skillDmgBonus__ultimate 定向，已招式限定）、
 * 喧响值获取效率+10%（decibelGainEfficiency）。
 * 影画6·有心论：自身暴伤+50%（面板直加）；落华·重戮额外3道165%攻击力激光
 *   （3秒至多1次 → 近似每次重戮触发1次，patchExecutions moveId 限定 flatDamageBonus）。
 *
 * 钢能资源循环（spec resource xide_steel_energy）：初始60上限150。
 * 获取 = ①席德自身耗能×0.5（energySpent）②正兵实际耗能×0.5（严格读正兵，非近似）
 *       ③终结技+60 ④影画1 进场+40/终结技额外+20 ⑤招式攻击数据（attack_data，见下）。
 * 消耗 = 崩坠一套120点（影画1→100 由模块后处理重算）。
 *
 * 钢能招式攻击数据（用户口径 2026-08：钢能回复还包含招式的 attack_data）：
 *   取各招式 attack_data_0（kind=special 第一行；attack_data_1/2 是其他通道如回血，不混入——
 *   观察：attack_data_0 秒均 ≈ 11 钢能/s，与普通招式一致）；
 *   平A不细分段数，按秒均折算 = 四段 attack_data_0 总和 ÷ 四段 actionTime 总和（≈11/s） × 平A时间；
 *   铁萼雨幕（1461009）单次 29.6964、连携（1461014）单次 29.5204。buildCharConfig 预存、buildExecutions 统一求和。
 *
 * 钢能消耗出口（buildExecutions，用户口径 2026-08「每足够打1式+2式就连着打三招落华」）：
 *   每 floor(钢能总量/单次消耗) 个周期打三招——落华·重戮（钢能阈值快速释放，不耗钢能）+
 *   落华·崩坠一式（60钢能）+ 落华·崩坠二式（60钢能），真实 moveId 倍率/失衡由倍率表回填。
 *
 * 铁萼雨幕（强化特殊技）：
 * - 耗能固定 60（catalog 无 energyCost，原文「一次飞行消耗60点能量」，buildCharConfig 写入；
 *   用户口径 2026-08：每 60 能量释放一次铁萼雨幕 1461009，不单独建模影画2 的 60→120 延长）。
 * - 每次铁萼雨幕消耗60能量自动发动一次落华·重戮（铁萼雨幕衔接），时间已含在 EX 2.7s 内
 *   （actionTime 0，不再另计前台时间）。
 * - 影画2 衔接落华·重戮增伤 = 每5点能量 +5% → 每发 60 能量 = +60%（dmgBonus 招式限定，
 *   只挂铁萼雨幕衔接的那一次重戮，钢能快速释放的重戮不吃）。
 *
 * 影画1：落华·崩坠暴伤+30%（patchExecutions 执行级 critDmgBonus，moveId 1461007/1461008，
 *   一式与二式都吃）。原文未写 CD，按每套崩坠计（用户确认）。
 *
 * 未建模：影画2 铁萼雨幕 60→120 延长（用户口径按固定 60 能量简化）。
 */

const XIDE_AGENT_ID = '1461'
const XIDE_AA_SKILL_DMG = 30
const XIDE_AA_ELECTRIC_RES_IGNORE = 25
const XIDE_C4_ULTIMATE_DMG = 20
const XIDE_C4_DECIBEL_EFFICIENCY = 10
const XIDE_C6_CRIT_DMG = 50
/** 落华·重戮（1461006：倍率 333.8%、失衡 217.4%、actionTime 1.316s） */
const XIDE_ZHONGLU_MOVE_ID = '1461006'
const XIDE_ZHONGLU_ACTION_TIME = 1.316
/** 落华·崩坠一式（1461007：倍率 1057.4%、actionTime 0.617s） */
const XIDE_BENGZHUI_1_MOVE_ID = '1461007'
const XIDE_BENGZHUI_1_ACTION_TIME = 0.617
/** 落华·崩坠二式（1461008：倍率 1979.4%、actionTime 1.534s） */
const XIDE_BENGZHUI_2_MOVE_ID = '1461008'
const XIDE_BENGZHUI_2_ACTION_TIME = 1.534
/** 终结技：机芯花园·绽放！ */
const XIDE_ULTIMATE_MOVE_ID = '1461015'
/** 影画1 落华·崩坠暴伤 +30%（一式/二式都吃） */
const XIDE_C1_BENGZHUI_CRIT_DMG = 30
/** 影画6 激光载体：落华·重戮，3 道 × 165% 攻击力 */
const XIDE_C6_LASER_RATIO = 3 * 165
/** 铁萼雨幕基础耗能（原文「一次飞行消耗60点能量」；catalog 无 energyCost，模块补） */
const XIDE_EX_ENERGY = 60
/** 影画2 衔接落华·重戮增伤：每消耗5点能量 +5% → 每发铁萼雨幕 60 能量 = +60% */
const XIDE_C2_RAIN_PETALS_DMG = 60
/** 钢能常量（原文：落华·崩坠描述）：上限150、初始60、崩坠一套消耗120（影画1→100） */
const XIDE_STEEL_INITIAL = 60
const XIDE_STEEL_C1_ENTRY_BONUS = 40
const XIDE_STEEL_C1_ULTIMATE_BONUS = 20
const XIDE_STEEL_BENGZHUI_COST = 120
const XIDE_STEEL_BENGZHUI_COST_C1 = 100
const XIDE_STEEL_RESOURCE_ID = 'xide_steel_energy'
/** 钢能 attack_data 平A四段（用于平A秒均折算） */
const XIDE_BASIC_MOVE_IDS = ['1461001', '1461002', '1461003', '1461004']

function findMove(skills: AgentSkills | undefined, moveId: string): SkillMove | null {
  for (const cat of skills?.categories ?? []) {
    const m = cat.moves.find(m => m.id === moveId)
    if (m) return m
  }
  return null
}

/** 招式钢能 = attack_data_0（kind=special 第一行；attack_data_1/2 是其他通道，不混入；秒均 ≈ 11） */
function getAttackData0(move: SkillMove | null | undefined): number {
  if (!move) return 0
  for (const row of (move.rows ?? []) as any[]) {
    if (String((row as any).kind ?? '') === 'special') return Number(row.values?.[0] ?? 0)
  }
  return 0
}

function applyXidePanel({ panel, cinemaLevel }: AgentPanelInput): void {
  if ((panel.additionalAbilityActive ?? 0) > 0) {
    // 影画4：围杀条件门控，终结技+20%（已招式限定）、喧响效率+10%
    if (cinemaLevel >= 4) {
      panel['skillDmgBonus__ultimate'] = (panel['skillDmgBonus__ultimate'] ?? 0) + XIDE_C4_ULTIMATE_DMG
      panel.decibelGainEfficiency = (panel.decibelGainEfficiency ?? 0) + XIDE_C4_DECIBEL_EFFICIENCY
    }
  }
  if (cinemaLevel >= 6) {
    panel.critDmg = (panel.critDmg ?? 0) + XIDE_C6_CRIT_DMG
  }
}

function buildXideCharConfig({ cfg, cinemaLevel, panel, skills }: AgentCharConfigInput): void {
  cfg.xideCinemaLevel = cinemaLevel
  // 影画6 激光附加伤害按「局内最终攻击力 × 百分比」进基础区（flatDamageBonus，奥菲丝先例）
  cfg.xideAtk = Math.max(0, panel?.atk ?? 0)
  // 额外能力门控（patchExecutions 招式限定增伤/电抗无视用）
  cfg.xideAAActive = (panel?.additionalAbilityActive ?? 0) > 0 ? 1 : 0
  // 铁萼雨幕耗能：固定 60（每 60 能量释放一次铁萼雨幕 1461009，用户口径 2026-08）
  cfg.exSpecialEnergyConsume = XIDE_EX_ENERGY

  // 钢能招式攻击数据：统一对「所有倍率页」取 attack_data_0（钢能）建映射，
  // 平A不细分段数、按秒均（四段 attack_data_0 总和 ÷ 四段 actionTime 总和 ≈ 11/s）折算。
  const attackDataMap: Record<string, number> = {}
  for (const cat of skills?.categories ?? []) {
    for (const mv of cat.moves) {
      attackDataMap[mv.id] = getAttackData0(mv)
    }
  }
  cfg.xideAttackDataMap = attackDataMap
  let basicSteelSum = 0
  let basicTimeSum = 0
  for (const id of XIDE_BASIC_MOVE_IDS) {
    basicSteelSum += attackDataMap[id] ?? 0
    basicTimeSum += findMove(skills, id)?.actionTime ?? 0
  }
  cfg.xideBasicSteelPerSec = basicTimeSum > 0 ? basicSteelSum / basicTimeSum : 0
}

/**
 * 额外能力·为正兵回能：席德作为操作角色造成伤害时为正兵回 2 能量/秒（1秒至多1次）。
 * 操作时间 = 前台时间 − 合轴时间（后台与自动追加攻击不计）。build 阶段确定正兵槽位 =
 * 初始攻击（level60.atkBase）最高的强攻队友，写入席德自身 cfg；
 * 能量结算在 core/resource/helpers.ts calcCrossAgentEnergy（单一事实源）。
 */
function applyXideTeamConfig({ characters, team, phase }: AgentTeamConfigInput): void {
  if (phase !== 'build') return
  let vanguardSlot = -1
  let bestAtk = -1
  for (const m of team) {
    if (m.agentId === XIDE_AGENT_ID) continue
    if (m.agent?.specialty !== 'attack') continue
    const atk = m.agent.level60?.atkBase ?? 0
    if (atk > bestAtk) {
      bestAtk = atk
      vanguardSlot = m.slot
    }
  }
  for (const c of characters) {
    if (c.agentId === XIDE_AGENT_ID) c.xideVanguardSlot = vanguardSlot
  }
}

/** 钢能招式攻击数据回复：统一对「所有执行行」求和（moveId → attack_data × 次数；平A按秒均 × 时间） */
function computeXideAttackSteelFromExecutions(cfg: AgentResourceInput['cfg'], executions: SkillExecution[]): number {
  const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? Math.max(0, x) : 0 }
  const map = ((cfg as any).xideAttackDataMap ?? {}) as Record<string, number>
  const basicPerSec = num((cfg as any).xideBasicSteelPerSec)
  let total = 0
  for (const e of executions) {
    if (e.moveId === 'basic_attack') total += basicPerSec * num(e.totalTime)
    else total += num(map[e.moveId] ?? 0) * num(e.count)
  }
  return total
}

/** 钢能总量 = 初始 + spec 获取（耗能/终结技/影画1）+ 招式攻击数据（正兵耗能已由 calcCrossAgentEnergy 写入 cfg） */
function computeXideSteelTotal(cfg: AgentResourceInput['cfg'], state: AgentResourceInput['state'], attackSteel: number): number {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).xideCinemaLevel ?? 0)))
  ;(cfg as any).xideInitialSteel = XIDE_STEEL_INITIAL + (cinema >= 1 ? XIDE_STEEL_C1_ENTRY_BONUS : 0)
  ;(cfg as any).xideC1UltSteel = cinema >= 1 ? XIDE_STEEL_C1_ULTIMATE_BONUS : 0
  const spec = getAgentSpec(XIDE_AGENT_ID)
  if (!spec) return 0
  const steel = computeSpecResources(spec, cfg, state).get(XIDE_STEEL_RESOURCE_ID)
  const base = steel ? steel.initialValue + steel.totalGain : 0
  return base + attackSteel
}

/** 钢能消耗出口：三招落华（重戮快速释放 + 崩坠一式 + 崩坠二式）+ 铁萼雨幕衔接重戮 */
function buildXideExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).xideCinemaLevel ?? 0)))
  // 统一对当前执行行求和（通用行 + 后续追加的落华/崩坠行 attack_data 均为 0，不影响）
  const attackSteel = computeXideAttackSteelFromExecutions(cfg, executions)
  ;(cfg as any).xideAttackSteel = attackSteel
  const totalSteel = computeXideSteelTotal(cfg, state, attackSteel)
  const cost = cinema >= 1 ? XIDE_STEEL_BENGZHUI_COST_C1 : XIDE_STEEL_BENGZHUI_COST
  const cycle = Math.floor(totalSteel / cost)

  const mkRow = (moveId: string, moveName: string, count: number, actionTime: number, extra: Partial<SkillExecution> = {}): SkillExecution => ({
    moveId,
    moveName,
    category: 'basic',
    count,
    actionTime,
    comboAlignRatio: 0,
    totalTime: count * actionTime,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    timeBucket: 'necessary',
    ...extra,
  })

  if (cycle > 0) {
    executions.push(mkRow(XIDE_ZHONGLU_MOVE_ID, '落华·重戮（钢能快速释放）', cycle, XIDE_ZHONGLU_ACTION_TIME))
    executions.push(mkRow(XIDE_BENGZHUI_1_MOVE_ID, '落华·崩坠一式', cycle, XIDE_BENGZHUI_1_ACTION_TIME))
    executions.push(mkRow(XIDE_BENGZHUI_2_MOVE_ID, '落华·崩坠二式', cycle, XIDE_BENGZHUI_2_ACTION_TIME))
  }

  // 铁萼雨幕每次消耗60能量自动发动一次落华·重戮（时间已含在 EX 2.7s 内，actionTime 0）
  const ex = Math.max(0, Math.floor(state.exSpecialCount ?? 0))
  if (ex > 0) {
    executions.push(mkRow(XIDE_ZHONGLU_MOVE_ID, '落华·重戮（铁萼雨幕衔接）', ex, 0, {
      dmgBonus: cinema >= 2 ? XIDE_C2_RAIN_PETALS_DMG : 0,
    }))
  }
}

function patchXideExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).xideCinemaLevel ?? 0)))
  const atk = Math.max(0, Number((cfg as any).xideAtk ?? 0))
  const aaActive = Number((cfg as any).xideAAActive ?? 0) > 0
  for (const exec of executions) {
    // 额外能力·奇兵轰临（招式限定）：落华·重戮/崩坠/终结技 增伤+30% + 无视25%电抗
    if (aaActive && (
      exec.moveId === XIDE_ZHONGLU_MOVE_ID ||
      exec.moveId === XIDE_BENGZHUI_1_MOVE_ID ||
      exec.moveId === XIDE_BENGZHUI_2_MOVE_ID ||
      exec.moveId === XIDE_ULTIMATE_MOVE_ID
    )) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + XIDE_AA_SKILL_DMG
      exec.resIgnore = (exec.resIgnore ?? 0) + XIDE_AA_ELECTRIC_RES_IGNORE
    }
    // 影画1：落华·崩坠暴伤+30%（执行级 critDmgBonus，一式/二式都吃）
    if (cinema >= 1 && (exec.moveId === XIDE_BENGZHUI_1_MOVE_ID || exec.moveId === XIDE_BENGZHUI_2_MOVE_ID)) {
      exec.critDmgBonus = (exec.critDmgBonus ?? 0) + XIDE_C1_BENGZHUI_CRIT_DMG
      exec.skillTableNote = `${exec.skillTableNote ?? ''}；影画1 崩坠暴伤 +${XIDE_C1_BENGZHUI_CRIT_DMG}%`
    }
    // 影画6：落华·重戮额外3道激光 ×165% 攻击力（每招一次用次数算，3秒以上才第二招故不计 ICD）
    if (cinema >= 6 && atk > 0 && exec.moveId === XIDE_ZHONGLU_MOVE_ID) {
      exec.flatDamageBonus = (exec.flatDamageBonus ?? 0) + atk * XIDE_C6_LASER_RATIO / 100
      exec.skillTableNote = `${exec.skillTableNote ?? ''}；影画6 附加 3 道激光 +${XIDE_C6_LASER_RATIO}% 攻击力`
    }
  }
}

/** 钢能资源：影画1 相关量写入 cfg 后委托 spec 解释器；攻击数据钢能 + 崩坠次数后处理重算 */
function buildXideResourceResult({ cfg, state }: AgentResourceResultInput) {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).xideCinemaLevel ?? 0)))
  // 攻击数据钢能已由 buildExecutions 统一求和写入 cfg.xideAttackSteel（单测直接调时显式传入）
  const attackSteel = Math.max(0, Number((cfg as any).xideAttackSteel ?? 0))
  ;(cfg as any).xideInitialSteel = XIDE_STEEL_INITIAL + (cinema >= 1 ? XIDE_STEEL_C1_ENTRY_BONUS : 0)
  ;(cfg as any).xideC1UltSteel = cinema >= 1 ? XIDE_STEEL_C1_ULTIMATE_BONUS : 0
  const spec = getAgentSpec(XIDE_AGENT_ID)
  if (!spec) return {}
  const resources = new Map(computeSpecResources(spec, cfg, state))
  // 攻击数据钢能并入总获取 + 崩坠次数按动态 cost 重算（120 / 影画1 100）
  const steel = resources.get(XIDE_STEEL_RESOURCE_ID)
  if (steel) {
    const total = steel.initialValue + steel.totalGain + attackSteel
    const cost = cinema >= 1 ? XIDE_STEEL_BENGZHUI_COST_C1 : XIDE_STEEL_BENGZHUI_COST
    const count = Math.floor(total / cost)
    resources.set(XIDE_STEEL_RESOURCE_ID, {
      ...steel,
      totalGain: steel.totalGain + attackSteel,
      spendCounts: { ...steel.spendCounts, xide_bengzhui_spend: count },
      spendCosts: { ...steel.spendCosts, xide_bengzhui_spend: count * cost },
      remaining: Math.max(0, total - count * cost),
    })
  }
  return { specResources: Object.fromEntries(resources) }
}

function buildXideResourceSections(input: AgentResourceSectionsInput) {
  const spec = getAgentSpec(XIDE_AGENT_ID)
  return spec ? specToMechanicModule(spec).resourceSections?.(input) ?? [] : []
}

export const xideMechanic: AgentMechanicModule = {
  id: 'agent:seed',
  agentIds: [XIDE_AGENT_ID],
  name: '「席德」',
  description: '正兵拐在 teammate-buffs（明攻/围杀，按其他强攻门控）；额外能力增伤/电抗无视招式限定在 patchExecutions（1461006/07/08/1015）；影画1 崩坠暴伤/影画6 激光在 patchExecutions；钢能消耗出口（三招落华）+ 铁萼雨幕衔接重戮在 buildExecutions；钢能资源循环（耗能/攻击数据/正兵耗能）走 spec resource + calcCrossAgentEnergy。',
  applyPanel: applyXidePanel,
  buildCharConfig: buildXideCharConfig,
  applyTeamConfig: applyXideTeamConfig,
  buildExecutions: buildXideExecutions,
  patchExecutions: patchXideExecutions,
  buildResourceResult: buildXideResourceResult,
  resourceSections: buildXideResourceSections,
  // 轴内动作块：崩坠 = 重戮 + 一式 + 二式三连（中间自动衔接，连着一块放；钢能 120/影画1 100 由资源循环扣，轴栈不扣闪能）
  combos: {
    'xide-bengzhui': {
      label: '崩坠（重戮+一式+二式三连）',
      energyCost: 0,
      moves: [
        { moveId: XIDE_ZHONGLU_MOVE_ID, count: 1 },
        { moveId: XIDE_BENGZHUI_1_MOVE_ID, count: 1 },
        { moveId: XIDE_BENGZHUI_2_MOVE_ID, count: 1 },
      ],
    },
  },
}
