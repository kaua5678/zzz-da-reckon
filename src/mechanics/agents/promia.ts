/**
 * 普罗米娅（1541）—— 异常掌控转精通、寒蚀值口径与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1541.json，按核心被动 Lv.7。
 * - 核心被动盗火：初始异常掌控>150时每超1点提升1.5异常精通（等价复现 spec
 *   attributeConversions prometheus_mastery_to_proficiency，模块注册后由其承接）。
 * - 影画2 信念飘摇：异常精通提升40点计入面板。
 * - 额外能力饮冰：其他异常/支援队友激活；发动强化特殊技时冰异常积蓄效率+30%（30秒窗口
 *   按整局常驻近似，计入通用 anomalyBuildUpEfficiency，普罗米娅仅积蓄冰异常）；
 *   有罪推定全队异放无视40%防御按自身 enemyDefReduction+40 近似（沿用旧 guilty 模块口径）。
 *
 * 明确未建模（异常结算区/状态机，calcAnomalyDamage 已内置精通乘区，直接叠加会重复计入精通）：
 * - 核心被动异放：处刑式·绝裁终结一击命中异常敌人触发异放，固定结算635%倍率对应属性异常伤害、
 *   消耗1点霜刑；寒蚀值积累（冻结/紊乱/乱流/强特/队友异放回复）与霜刑转化（50寒蚀→1霜刑）逐时序。
 * - 核心被动「每超1点掌控提升0.35%全队异放伤害」：全队向异放增伤，模块仅作用自身面板。
 * - 额外能力霜寒持续+3秒（全队/敌方状态）；有罪推定为全队异放限定，这里近似为自身全伤害减防。
 * - 影画1 有罪推定额外无视20%防御、影画4 异放回寒蚀值、影画6 特殊异放200%与无视15%全抗。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceResultInput,
  AgentEventInput,
  AgentResourceInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
  ReleaseModifierInput,
} from '../types'

export const PROMIA_ID = '1541'
export const PROMIA_MASTERY_THRESHOLD = 150
export const PROMIA_PROF_PER_MASTERY = 1.5
export const PROMIA_TEAM_RELEASE_PER_MASTERY = 0.35
export const PROMIA_C2_PROFICIENCY = 40
export const PROMIA_ADDITIONAL_BUILDUP_EFF = 30
export const PROMIA_GUILTY_DEF_IGNORE = 40
export const PROMIA_C1_DEF_IGNORE = 20
export const PROMIA_C6_ALL_RES_IGNORE = 15
/** 影画4：触发异放回 5 寒蚀（0.5s CD；异放自身已受 CD 约束，按异放次数计） */
export const PROMIA_C4_RELEASE_FROST = 5
/** 核心被动：异放回 100 喧响（0.5s CD） */
export const PROMIA_RELEASE_DECIBEL = 100
/** 影画6：特殊异放 200%（15s CD） */
export const PROMIA_C6_SPECIAL_RELEASE_MULT = 200
export const PROMIA_C6_SPECIAL_CD_SECONDS = 15
/** 影画6 特殊异放启动时间（第一次霜刑异放不可能 0s 就触发，取一个绝裁强特的起手时间） */
export const PROMIA_C6_SPECIAL_STARTUP_SECONDS = 2

export interface PromiaCycle {
  cinemaLevel: number
  anomalyMastery: number
  additionalActive: boolean
  masteryExcess: number
  proficiencyFromMastery: number
  c2Proficiency: number
  totalProficiency: number
  teamReleaseDmg: number
  additionalBuildUpEff: number
  guiltyDefIgnore: number
  note: string
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function whole(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))
}

export function computePromiaCycle(input: {
  cinemaLevel: number
  anomalyMastery: number
  additionalActive: boolean
}): PromiaCycle {
  const cinemaLevel = whole(input.cinemaLevel)
  const anomalyMastery = Math.max(0, Number.isFinite(input.anomalyMastery) ? input.anomalyMastery : 0)
  const masteryExcess = Math.max(0, anomalyMastery - PROMIA_MASTERY_THRESHOLD)
  const proficiencyFromMastery = masteryExcess * PROMIA_PROF_PER_MASTERY
  const c2Proficiency = cinemaLevel >= 2 ? PROMIA_C2_PROFICIENCY : 0
  return {
    cinemaLevel,
    anomalyMastery,
    additionalActive: input.additionalActive,
    masteryExcess,
    proficiencyFromMastery,
    c2Proficiency,
    totalProficiency: proficiencyFromMastery + c2Proficiency,
    teamReleaseDmg: masteryExcess * PROMIA_TEAM_RELEASE_PER_MASTERY,
    additionalBuildUpEff: input.additionalActive ? PROMIA_ADDITIONAL_BUILDUP_EFF : 0,
    guiltyDefIgnore: input.additionalActive ? PROMIA_GUILTY_DEF_IGNORE : 0,
    note: '寒蚀值/霜刑/异放结算与全队异放增伤属异常结算区/全队向，未建模。',
  }
}

function buildPromiaCharConfig({ cinemaLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.promiaCinemaLevel = cinemaLevel
  record.promiaAnomalyMastery = panel.anomalyMastery ?? 0
  record.promiaAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
}

function cycleFromCfg(cfg: unknown): PromiaCycle {
  const record = cfg as Record<string, unknown>
  return computePromiaCycle({
    cinemaLevel: Number(record.promiaCinemaLevel ?? 0),
    anomalyMastery: Number(record.promiaAnomalyMastery ?? 0),
    additionalActive: record.promiaAdditionalActive === true,
  })
}

/** 面板层：异常掌控转精通（复现 attributeConversions）+ 影画2精通+40 + 影画6自身异常/紊乱无视全抗。 */
function applyPromiaPanel({ cinemaLevel, outOfCombatPanel, panel }: AgentPanelInput): void {
  const mastery = Math.max(0, outOfCombatPanel?.anomalyMastery ?? 0)
  const excess = Math.max(0, mastery - PROMIA_MASTERY_THRESHOLD)
  panel.anomalyProficiency = (panel.anomalyProficiency ?? 0) + excess * PROMIA_PROF_PER_MASTERY
  if (cinemaLevel >= 2) {
    panel.anomalyProficiency = (panel.anomalyProficiency ?? 0) + PROMIA_C2_PROFICIENCY
  }
  if (cinemaLevel >= 6) {
    // 影画6：普罗米娅自身属性异常/紊乱伤害无视 15% 全属性抗性（挂面板 enemyResReduction，异放走 releaseModifier）
    panel.enemyResReduction = (panel.enemyResReduction ?? 0) + PROMIA_C6_ALL_RES_IGNORE
  }
  // releaseModifier 用（异放限定减防需读普罗米娅命座与额外能力门控）
  panel.promiaCinemaLevel = cinemaLevel
  panel.promiaAdditionalActive = panel.additionalAbilityActive ?? 0
}

/** 提取层：额外能力冰异常积蓄效率+30%（需 additionalAbilityActive 门控）。有罪推定无视防御已改走 releaseModifier（异放限定）。 */
function applyPromiaBuildUp({ charResult, panel }: AgentSkillTransformInput): void {
  if (!panel) return
  if ((panel as Record<string, unknown>).__promiaBuildUpApplied) return
  ;(panel as Record<string, unknown>).__promiaBuildUpApplied = true
  const cycle = charResult.specResources?.promia_cycle as PromiaCycle | undefined
  if (!cycle) return
  if (cycle.additionalBuildUpEff > 0) {
    panel.anomalyBuildUpEfficiency = (panel.anomalyBuildUpEfficiency ?? 0) + cycle.additionalBuildUpEff
  }
}

/** 异放限定减防（有罪推定 40% + 影画1 20%）：releaseModifier 只作用于异放结算，不作用于普通直伤/异常。 */
function promiaReleaseModifier({ panels }: ReleaseModifierInput): { enemyResReduction: number; enemyDefReduction?: number; note: string } {
  const promia = panels.find(p => (p as Record<string, unknown>).promiaCinemaLevel !== undefined)
  if (!promia) return { enemyResReduction: 0, note: '' }
  const cinema = Number((promia as Record<string, unknown>).promiaCinemaLevel ?? 0)
  const additionalActive = Number((promia as Record<string, unknown>).promiaAdditionalActive ?? 0)
  const defIgnore = (additionalActive > 0 ? PROMIA_GUILTY_DEF_IGNORE : 0) + (cinema >= 1 ? PROMIA_C1_DEF_IGNORE : 0)
  return defIgnore > 0
    ? { enemyResReduction: 0, enemyDefReduction: defIgnore, note: `；有罪推定/C1：异放无视 ${defIgnore}% 防御（releaseModifier 异放限定）` }
    : { enemyResReduction: 0, note: '' }
}

function buildPromiaResourceResult({ cfg }: AgentResourceResultInput) {
  return { specResources: { promia_cycle: cycleFromCfg(cfg) } }
}

function buildPromiaResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.promia_cycle as PromiaCycle | undefined
  if (!cycle) return []
  return [{
    id: 'promia-cycle',
    title: '普罗米娅·掌控转精通',
    summary: `异常精通 +${cycle.totalProficiency}（掌控${cycle.anomalyMastery}）`,
    rows: [
      { label: '掌控转精通', value: `+${cycle.proficiencyFromMastery}`, detail: `掌控${cycle.anomalyMastery}，超${PROMIA_MASTERY_THRESHOLD}部分×${PROMIA_PROF_PER_MASTERY}` },
      { label: '影画2精通', value: `+${cycle.c2Proficiency}`, detail: '信念飘摇' },
      { label: '全队异放增伤', value: `+${cycle.teamReleaseDmg}%`, detail: '全队向，未接面板（仅展示）' },
      { label: '冰异常积蓄效率', value: `+${cycle.additionalBuildUpEff}%`, detail: cycle.additionalActive ? '额外能力已激活' : '未激活' },
      { label: '有罪推定无视防御', value: `+${cycle.guiltyDefIgnore}%`, detail: '全队异放限定，近似为自身减防' },
    ],
    footer: cycle.note,
  }]
}

/** 绝裁异放固定倍率（原文「固定结算635%倍率的对应属性异常伤害」）；C2 倍率提升120% = 加120个百分点（用户口供 2026-08-24：635→755） */
export const PROMIA_EXECUTION_RELEASE_MULTIPLIER = 635
export const PROMIA_C2_RELEASE_BONUS = 120
/** 绝裁本体直伤 moveId（异放载体；用户口径 2026-08-26：绝裁是普通招式，必须打、失衡吃易伤） */
export const PROMIA_VERDICT_MOVE_ID = '1541014'
/** 坠霜 moveId（强特普通终结段：封喉霜径+坠霜） */
export const PROMIA_ZHUISHUANG_MOVE_ID = '1541010'

/**
 * 计算绝裁（霜刑异放）次数：回复端驱动（总量计算器不管单条持有上限，来多少打多少）。
 *   寒蚀收入 = 冻结/紊乱/乱流触发×5（池口径 totalTriggerCount）+ 自身强特×10 + 队友异放×15
 *            + 匿影×10 + 攻击数据 attackFrost + 影画4/6异放回寒蚀×5
 *   次数 = 进场2 + C1终结技1 + floor(寒蚀收入 / 50)；C4/C6 回寒蚀反馈环收敛。
 * 同时返回影画6 特殊异放次数（15s CD，启动 2s）。
 */
function computePromiaVerdict({ cfg, state, battleTime }: { cfg: AgentCharConfigInput['cfg']; state: { exSpecialCount?: number }; battleTime: number }): {
  count: number; specialCount: number; baseFrostGain: number; initial: number
} {
  const record = cfg as unknown as Record<string, unknown>
  const cinemaLevel = Math.max(0, Math.floor(Number(record.promiaCinemaLevel ?? 0)))
  const override = Math.max(0, Math.floor(setting(cfg, 'promia.releaseCountOverride', 0)))
  const triggerHits = Math.max(0, Math.floor(Number(record.promiaTriggerHitCount ?? 0)))
  const teammateReleases = Math.max(0, Math.floor(Number(record.promiaTeammateReleaseCount ?? 0)))
  const exCasts = Math.max(0, Math.floor(Number(state.exSpecialCount ?? 0)))
  const attackFrost = Math.max(0, Math.floor(Number(record.promiaAttackFrostGain ?? 0)))
  const niying = Math.max(0, Math.min(99, Math.floor(Number(record.promiaNiyingCount ?? 0))))
  const baseFrostGain = triggerHits * 5 + exCasts * 10 + niying * 10 + teammateReleases * 15 + attackFrost
  const initial = 2 + (cinemaLevel >= 1 ? 1 : 0)

  const specialCdCount = cinemaLevel >= 6
    ? Math.max(0, Math.floor((battleTime - PROMIA_C6_SPECIAL_STARTUP_SECONDS) / PROMIA_C6_SPECIAL_CD_SECONDS) + 1)
    : 0

  let count = override > 0 ? override : initial + Math.floor(baseFrostGain / 50)
  if (override <= 0 && cinemaLevel >= 4) {
    for (let i = 0; i < 12; i++) {
      const special = cinemaLevel >= 6 ? Math.min(count, specialCdCount) : 0
      const frostBonus = PROMIA_C4_RELEASE_FROST * count + (cinemaLevel >= 6 ? PROMIA_C4_RELEASE_FROST * special : 0)
      const next = initial + Math.floor((baseFrostGain + frostBonus) / 50)
      if (next === count) break
      count = next
    }
  }
  const specialCount = cinemaLevel >= 6 ? Math.min(count, specialCdCount) : 0
  return { count, specialCount, baseFrostGain, initial }
}

/**
 * 处刑式·绝裁终结一击异放（核心被动）：命中异常状态敌人触发，固定结算 635%（C2=755%）倍率
 * 的对应属性异常伤害，发动时消耗 1 点[霜刑]。
 * 结算语义与全角色一致：基础者=该元素异常主施加者、结算者=普罗米娅（dominant 分支自动）。
 * 绝裁本体直伤（1541014）在 buildExecutions 单独生成（普通招式，失衡吃易伤）。
 */
function buildPromiaAnomalyEvents({ cfg, state, events, totalTime }: AgentEventInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinemaLevel = Math.max(0, Math.floor(Number(record.promiaCinemaLevel ?? 0)))
  const niying = Math.max(0, Math.min(99, Math.floor(Number(record.promiaNiyingCount ?? 0))))
  const attackFrost = Math.max(0, Math.floor(Number(record.promiaAttackFrostGain ?? 0)))
  const { count, specialCount, baseFrostGain, initial } = computePromiaVerdict({ cfg, state, battleTime: totalTime })
  // 绝裁异放失衡内占比：绑定绝裁块（-1=自动按事件计数器）
  const inStunRatio = setting(cfg, 'promia.releaseInStunRatio', -1)

  if (count <= 0) return
  const mult = PROMIA_EXECUTION_RELEASE_MULTIPLIER + (cinemaLevel >= 2 ? PROMIA_C2_RELEASE_BONUS : 0)
  events.push({
    eventId: 'promia_execution_release',
    eventName: '处刑式·绝裁终结一击·异放',
    eventType: 'release',
    element: 'dominant',
    carrierMoveName: '强化特殊技：处刑式·绝裁（终结一击）',
    count,
    formula: `releaseMultiplier=${mult}（固定倍率${cinemaLevel >= 2 ? '，C2=635+120' : ''}）`,
    fields: [`releaseMultiplier=${mult}`, `frostGain=${baseFrostGain}`, `attackFrost=${attackFrost}`, `niying=${niying}`, `casts=${count}`],
    ...(inStunRatio >= 0 ? { releaseInStunRatio: inStunRatio } : {}),
    note: `回复端：初始${initial} + 寒蚀${baseFrostGain}/50（含攻击数据 ${attackFrost}、匿影×10×${niying}${cinemaLevel >= 4 ? `、影画4异放回寒蚀 ×5×${count}` : ''}${cinemaLevel >= 6 ? `、影画6特殊异放回寒蚀 ×5×${specialCount}` : ''}）→ ${count} 次；元素按目标当前异常分配。`,
  })
  if (cinemaLevel >= 6 && specialCount > 0) {
    events.push({
      eventId: 'promia_c6_special_release',
      eventName: '影画6·特殊异放',
      eventType: 'release',
      element: 'dominant',
      carrierMoveName: '处刑式·绝裁（霜刑异放）',
      count: specialCount,
      formula: `releaseMultiplier=${PROMIA_C6_SPECIAL_RELEASE_MULT}`,
      fields: [`releaseMultiplier=${PROMIA_C6_SPECIAL_RELEASE_MULT}`, `cd=${PROMIA_C6_SPECIAL_CD_SECONDS}s`, `casts=${specialCount}`],
      ...(inStunRatio >= 0 ? { releaseInStunRatio: inStunRatio } : {}),
      note: `影画6：消耗霜刑异放额外触发特殊异放 200%（${PROMIA_C6_SPECIAL_CD_SECONDS}s CD，启动 ${PROMIA_C6_SPECIAL_STARTUP_SECONDS}s）→ ${specialCount} 次（min(绝裁异放 ${count}, CD 上限)）；元素随目标当前异常。`,
    })
  }
}

/**
 * 攻击数据回复端（用户补充 2026-08-24）：她的不同攻击命中回复一定[寒蚀值]（倍率表 attack_data 行，
 * 引擎已收集为 totalSpecialResourceRecovery）——计入霜刑收入。
 */
function buildPromiaExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const attackFrost = executions.reduce((s, e) => s + (e.totalSpecialResourceRecovery ?? 0), 0)
  ;(cfg as unknown as Record<string, unknown>).promiaAttackFrostGain = Math.max(0, Math.floor(attackFrost))
  const record = cfg as unknown as Record<string, unknown>
  const niying = Math.max(0, Math.min(99, Math.floor(Number(record.promiaNiyingCount ?? 0))))
  const exCasts = Math.max(0, Math.floor(Number(state.exSpecialCount ?? 0)))

  // 强特 = 封喉霜径(起手，资源池已生成) + 坠霜(普通终结) / 重霜(匿影终结)。
  // 坠霜 = 强特次数 − 匿影次数（匿影的强特终结是重霜，不是坠霜）
  const zhuishuangCount = Math.max(0, exCasts - niying)
  if (zhuishuangCount > 0) {
    executions.push({
      moveId: PROMIA_ZHUISHUANG_MOVE_ID,
      moveName: '特殊技：处刑式·坠霜（强特终结）',
      category: 'special',
      element: 'ice',
      count: zhuishuangCount,
      actionTime: 1.116,
      comboAlignRatio: 0,
      totalTime: 1.116 * zhuishuangCount,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
    })
  }
  // 匿影后解锁特殊技「处刑式·重霜」：每次匿影可接一次（真实 moveId，前台时间由引擎时间预算外层折算）
  if (niying > 0) {
    executions.push({
      moveId: '1541011',
      moveName: '特殊技：处刑式·重霜（匿影后接）',
      category: 'special',
      element: 'ice',
      count: niying,
      actionTime: 2.35,
      comboAlignRatio: 0,
      totalTime: 2.35 * niying,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      skillTableNote: `处刑式·重霜 ×${niying}（匿影后解锁；#2 子段 24.2% 未单列）`,
    })
  }
  // 绝裁本体直伤（异放载体）：普通招式，失衡吃易伤；次数 = 霜刑（绝裁异放）次数
  const verdict = computePromiaVerdict({ cfg, state, battleTime: Number(record.battleTime ?? 180) })
  if (verdict.count > 0) {
    executions.push({
      moveId: PROMIA_VERDICT_MOVE_ID,
      moveName: '强化特殊技：处刑式·绝裁（异放载体）',
      category: 'special',
      element: 'ice',
      count: verdict.count,
      actionTime: 0.85,
      comboAlignRatio: 0,
      totalTime: 0.85 * verdict.count,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
    })
  }
}

function setting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const v = Number((cfg as unknown as Record<string, unknown>)[`setting:${id}`])
  return Number.isFinite(v) ? v : fallback
}

export const promiaMechanic: AgentMechanicModule = {
  id: 'agent:promia',
  agentIds: [PROMIA_ID],
  name: '普罗米娅·盗火',
  description: '异常掌控转精通、影画2精通、额外能力冰异常积蓄效率；绝裁异放已接（霜刑上限钳制），全队异放增伤 0.35%/点未接面板。',
  applyPanel: applyPromiaPanel,
  buildCharConfig: buildPromiaCharConfig,
  transformSkillExecutions: applyPromiaBuildUp,
  buildExecutions: buildPromiaExecutions,
  buildAnomalyEvents: buildPromiaAnomalyEvents,
  buildResourceResult: buildPromiaResourceResult,
  resourceSections: buildPromiaResourceSections,
  releaseModifier: promiaReleaseModifier,
  settings: [
    {
      id: 'promia.releaseCountOverride',
      label: '普罗米娅·绝裁异放次数覆盖',
      description: '手动指定整局绝裁异放次数；0=自动（回复端计数：初始霜刑+寒蚀收入/50，实战约20次）。',
      default: 0,
      min: 0,
      max: 60,
      step: 1,
      suffix: '次',
    },
    {
      id: 'promia.releaseInStunRatio',
      label: '普罗米娅·绝裁异放失衡内占比',
      description: '绝裁异放在失衡窗口内的占比（异放绑定绝裁块：绝裁在失衡内打、异放也在失衡内）。-1=自动按事件计数器（失衡内异常触发占比）。',
      default: -1,
      min: -1,
      max: 1,
      step: 0.05,
      suffix: '%',
    },
  ],
}

export default promiaMechanic
