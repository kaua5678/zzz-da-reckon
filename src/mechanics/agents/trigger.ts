/**
 * 「扳机」（1361）—— 绝意、协奏狙杀与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1361.json（Nanoka zh，抓于 2026-08-19）。
 * - 协奏狙杀：全队 3 秒内最多 1 次（影画1 降至 2 秒）——按战斗时长全局吃满
 *   （2026-08-25 用户口供：次数由 CD 反推，不建逐秒状态机）。
 * - 协奏狙杀·冥狱：队友强化特殊技/支援突击/终结技重击命中触发，同一类型招式
 *   20 秒内最多 2 次——次数 = 队友可用次数（强特/终结收敛值 + 支援突击≈招架数）
 *   并受每类限速钳制。队友次数经 applyTeamConfig postRound 注入（下一轮生效）。
 * - 绝意：回复端按需——「需要多少就回复多少」，消耗全额支付，狙击命中数由消耗
 *   反推（滑块>0 时改为手动命中数，供给按存量上限封顶）。
 * - 协战免费协奏：强特进入协战送 4 次、终结技送 6 次（免绝意免CD，整局总量近似）。
 * - 协奏狙杀/冥狱为后台追击（actionTime=null 不占前台）：真实 moveId 行进执行计划，
 *   伤害/失衡/积蓄由倍率表回填；额外能力灵目银灯的失衡加成落到这三条载体行上。
 *   倍率融合（用户口供 2026-08-25）：一次协奏狙杀 = 1361008 行×2发；一次冥狱 =
 *   1361020×3连射 + 1361022×1终结——执行行按发数推 count。
 * - 绝意回复效率（用户口供）：狙击姿态一轮（1361005 起）最多4发命中回100绝意约2秒，
 *   随后接 1361004 收尾——回复远快于消耗，支撑「回复端按需」口径；协战免费协奏
 *   无CD、0.8秒一发，默认全数打完。
 * - C4 每次进入/延长协战，使下一次协奏触发断离：200%攻击力伤害行 + 120%冲击力失衡
 *   经 transformSkillExecutions 注入失衡池（合成假 moveId 走专用注入，不经倍率表）；
 *   断离原文未标追加攻击，不吃额外能力失衡加成。
 * - C6 进场5枚破甲凶弹；每消耗25绝意补1枚；狙击姿态命中消耗1枚，造成1200%攻击力
 *   电伤且本行增伤+50%。整局按“消耗与补弹交错、无库存溢出”近似。「上限5枚」为弹仓
 *   存量上限（用户口供 2026-08-25：满仓须先消耗才能再获得），总量口径下消耗与获取
 *   始终交错、不构成约束，故不对补弹数做封顶。0.2秒触发CD与总量无关，不建模。
 *
 * 可调项：狙击命中 / 协奏狙杀次数 / 冥狱次数，均 0=自动（CD·来源·需求反推）。
 * - 轴内易伤（2026-09-03 用户口径：自动后台攻击有 CD，好算招式总量与失衡内易伤招式量）：
 *   协奏/冥狱/断离/破甲凶弹均为 CD 驱动后台自动行（autoSplitByStun，猫又同款通用机制）——
 *   不按捏轴认领，轴模式按失衡时间占比拆「占比内吃满易伤 / 其余无易伤」，非轴按全局覆盖率。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
  AgentTeamConfigInput,
} from '../types'
import { minusInvincibleTime } from '@/core/effectiveTime'

export const TRIGGER_AGENT_ID = '1361'
export const TRIGGER_ADDITIONAL_MOVE_IDS = new Set(['1361008', '1361020', '1361022'])
export const TRIGGER_DUANLI_MOVE_ID = '1361_c4_duanli'
export const TRIGGER_CRIT_THRESHOLD = 40
export const TRIGGER_STUN_BUILD_PER_CRIT = 1.5
export const TRIGGER_STUN_BUILD_CAP = 75
export const TRIGGER_C4_DAMAGE_MULTIPLIER = 200
export const TRIGGER_C4_DAZE_MULTIPLIER = 120
export const TRIGGER_C6_DAMAGE_MULTIPLIER = 1200
export const TRIGGER_C6_DMG_BONUS = 50
export const TRIGGER_NORMAL_CD_SECONDS = 3
export const TRIGGER_NORMAL_CD_C1_SECONDS = 2
export const TRIGGER_HELL_RATE_WINDOW_SECONDS = 20
export const TRIGGER_HELL_RATE_PER_WINDOW = 2
export const TRIGGER_RESOLVE_PER_NORMAL = 3
export const TRIGGER_RESOLVE_PER_HELL = 5
export const TRIGGER_COOP_FREE_PER_EX_SPECIAL = 4
export const TRIGGER_COOP_FREE_PER_ULTIMATE = 6
export const TRIGGER_COORDINATED_MOVE_ID = '1361008'
export const TRIGGER_HELL_MOVE_IDS = ['1361020', '1361022'] as const
/** 倍率融合口径（用户口供 2026-08-25）：一次协奏狙杀把 1361008 倍率行调用2次（96.3%×2） */
export const TRIGGER_COORDINATED_SHOTS_PER_CAST = 2
/** 一次冥狱 = 连射3次（1361020 45.7%×3）+ 终结一击1次（1361022 91.4%×1） */
export const TRIGGER_HELL_BURST_SHOTS_PER_CAST = 3

export interface TriggerCycle {
  cinemaLevel: number
  battleTime: number
  /** 协奏狙杀全队冷却（影画1 后降为 2 秒） */
  normalCdSeconds: number
  /** 由绝意支付的协奏狙杀次数（自动=CD 吃满） */
  normalPaidCount: number
  normalAuto: boolean
  /** 协战免费协奏（强特×4 + 终结×6，免绝意免CD） */
  freeCoordinatedCount: number
  /** 协奏狙杀总触发次数 = 付费 + 免费 */
  coordinatedCount: number
  /** 冥狱次数（自动=队友来源受每类限速钳制） */
  hellCount: number
  hellAuto: boolean
  hellRateCapPerType: number
  mateExCount: number
  mateUltimateCount: number
  mateAssistCount: number
  /** 绝意需求 = 协奏×3 + 冥狱×5 */
  resolveRequested: number
  /** 绝意供给：自动=按需全额；手动命中时受存量上限封顶 */
  resolveSupply: number
  resolveSpent: number
  resolveGainPerSniperHit: number
  resolveCap: number
  /** 狙击姿态有效命中（自动=由消耗反推） */
  sniperHitCount: number
  sniperAuto: boolean
  c4DuanliCount: number
  c6BulletCount: number
  c6BulletGainFromSpend: number
  note: string
}

function intAtLeast0(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))
}

function cfgSetting(cfg: AgentCharConfigInput['cfg'], id: string): number {
  const value = (cfg as unknown as Record<string, unknown>)[`setting:${id}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function computeTriggerCycle(input: {
  cinemaLevel: number
  battleTime: number
  normalCountOverride: number
  hellCountOverride: number
  sniperHitCountOverride: number
  mateExCount: number
  mateUltimateCount: number
  mateAssistCount: number
  ownExSpecialCount: number
  ownUltimateCount: number
}): TriggerCycle {
  const cinema = intAtLeast0(input.cinemaLevel)
  const battleTime = Math.max(0, Number(input.battleTime) || 0)
  const resolveGainPerSniperHit = cinema >= 1 ? 31.25 : 25
  const resolveCap = cinema >= 1 ? 125 : 100

  // 协奏狙杀：全队 CD 吃满（次数由战斗时长反推）
  const normalCdSeconds = cinema >= 1 ? TRIGGER_NORMAL_CD_C1_SECONDS : TRIGGER_NORMAL_CD_SECONDS
  const normalAuto = !(intAtLeast0(input.normalCountOverride) > 0)
  const normalPaidCount = normalAuto
    ? Math.floor(battleTime / normalCdSeconds)
    : intAtLeast0(input.normalCountOverride)

  // 冥狱：队友强特/支援突击/终结技重击触发，每类 20 秒内最多 2 次
  const hellRateCapPerType = TRIGGER_HELL_RATE_PER_WINDOW
    * Math.ceil(battleTime / TRIGGER_HELL_RATE_WINDOW_SECONDS)
  const hellAuto = !(intAtLeast0(input.hellCountOverride) > 0)
  const mateExCount = intAtLeast0(input.mateExCount)
  const mateUltimateCount = intAtLeast0(input.mateUltimateCount)
  const mateAssistCount = intAtLeast0(input.mateAssistCount)
  const hellCount = hellAuto
    ? Math.min(mateExCount, hellRateCapPerType)
      + Math.min(mateUltimateCount, hellRateCapPerType)
      + Math.min(mateAssistCount, hellRateCapPerType)
    : intAtLeast0(input.hellCountOverride)

  // 协战免费协奏：强特进入协战送4次、终结技送6次（整局总量近似，不建逐秒窗口）
  const ownEx = intAtLeast0(input.ownExSpecialCount)
  const ownUlt = intAtLeast0(input.ownUltimateCount)
  const freeCoordinatedCount = ownEx * TRIGGER_COOP_FREE_PER_EX_SPECIAL
    + ownUlt * TRIGGER_COOP_FREE_PER_ULTIMATE
  const coordinatedCount = normalPaidCount + freeCoordinatedCount

  // 绝意：回复端按需——自动模式下消耗全额支付；手动命中数时供给受存量上限封顶
  const resolveRequested = normalPaidCount * TRIGGER_RESOLVE_PER_NORMAL
    + hellCount * TRIGGER_RESOLVE_PER_HELL
  const sniperAuto = !(intAtLeast0(input.sniperHitCountOverride) > 0)
  const sniperManualHits = intAtLeast0(input.sniperHitCountOverride)
  const resolveSupply = sniperAuto
    ? resolveRequested
    : Math.min(resolveCap, sniperManualHits * resolveGainPerSniperHit)
  const resolveSpent = Math.min(resolveSupply, resolveRequested)
  const sniperHitCount = sniperAuto
    ? Math.ceil(resolveSpent / resolveGainPerSniperHit)
    : sniperManualHits

  // C4 断离：每次进入/延长协战标记下一次协奏（狙杀或冥狱）
  const c4DuanliCount = cinema >= 4
    ? Math.min(ownEx + ownUlt, coordinatedCount + hellCount)
    : 0

  // C6 破甲凶弹：进场5枚 + 每消耗25绝意补1枚；总消耗受狙击命中数限制（弹仓存量上限不入总量口径）
  const c6BulletGainFromSpend = cinema >= 6 ? Math.floor(resolveSpent / 25) : 0
  const c6BulletCount = cinema >= 6
    ? Math.min(sniperHitCount, 5 + c6BulletGainFromSpend)
    : 0

  return {
    cinemaLevel: cinema,
    battleTime,
    normalCdSeconds,
    normalPaidCount,
    normalAuto,
    freeCoordinatedCount,
    coordinatedCount,
    hellCount,
    hellAuto,
    hellRateCapPerType,
    mateExCount,
    mateUltimateCount,
    mateAssistCount,
    resolveRequested,
    resolveSupply,
    resolveSpent,
    resolveGainPerSniperHit,
    resolveCap,
    sniperHitCount,
    sniperAuto,
    c4DuanliCount,
    c6BulletCount,
    c6BulletGainFromSpend,
    note: '整局总量：协奏按全队CD吃满（影画1缩短）、冥狱按队友来源受每类限速；绝意回复端按需，狙击命中数由消耗反推。',
  }
}

function applyTriggerPanel({ panel }: AgentPanelInput): void {
  if ((panel.additionalAbilityActive ?? 0) <= 0) return
  const overCrit = Math.max(0, (panel.critRate ?? 0) - TRIGGER_CRIT_THRESHOLD)
  panel.triggerAdditionalStunBuildUp = Math.min(
    TRIGGER_STUN_BUILD_CAP,
    overCrit * TRIGGER_STUN_BUILD_PER_CRIT,
  )
}

function buildTriggerCharConfig({ cinemaLevel, cfg }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.triggerCinemaLevel = cinemaLevel
  record.triggerNormalCountOverride = intAtLeast0(cfgSetting(cfg, 'trigger.normalCoordinatedCount'))
  record.triggerHellCountOverride = intAtLeast0(cfgSetting(cfg, 'trigger.hellCoordinatedCount'))
  record.triggerSniperHitOverride = intAtLeast0(cfgSetting(cfg, 'trigger.sniperHitCount'))
}

/** postRound：本轮全队强特/终结已收敛 → 写入冥狱触发源（下一轮 buildExecutions 生效） */
function applyTriggerTeamConfig(input: AgentTeamConfigInput): void {
  if (input.phase !== 'postRound') return
  const own = input.characters.find(c => c.slot === input.slot)
  if (!own) return
  let mateExCount = 0
  let mateUltimateCount = 0
  let mateAssistCount = 0
  input.characters.forEach((mate, index) => {
    if (!mate?.agentId || mate.slot === input.slot) return
    mateExCount += Math.max(0, Math.floor(input.exCounts[index] ?? 0))
    mateUltimateCount += Math.max(0, Math.floor(input.ultimateCounts?.[index] ?? 0))
    // 支援突击跟随招架支援规划（引擎按 parryCount 生成 assist follow-up 行）
    mateAssistCount += Math.max(0, Math.floor(mate.parryCount ?? 0))
  })
  const record = own as unknown as Record<string, unknown>
  record.triggerMateExCount = mateExCount
  record.triggerMateUltimateCount = mateUltimateCount
  record.triggerMateAssistCount = mateAssistCount
}

function cycleFromInput({ cfg, state }: Pick<AgentResourceInput, 'cfg' | 'state'>): TriggerCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computeTriggerCycle({
    cinemaLevel: Number(record.triggerCinemaLevel ?? 0),
    // 协奏狙杀/冥狱 CD 折算按有效战斗时间（扣 boss 无敌，core/effectiveTime.ts）
    battleTime: minusInvincibleTime(Number(record.battleTime ?? 180), cfg),
    normalCountOverride: Number(record.triggerNormalCountOverride ?? 0),
    hellCountOverride: Number(record.triggerHellCountOverride ?? 0),
    sniperHitCountOverride: Number(record.triggerSniperHitOverride ?? 0),
    mateExCount: Number(record.triggerMateExCount ?? 0),
    mateUltimateCount: Number(record.triggerMateUltimateCount ?? 0),
    mateAssistCount: Number(record.triggerMateAssistCount ?? 0),
    ownExSpecialCount: state.exSpecialCount,
    ownUltimateCount: state.ultimateCount,
  })
}

function pushSyntheticExecution(executions: AgentResourceInput['executions'], input: {
  moveId: string
  moveName: string
  count: number
  damageMultiplier: number
  dmgBonus?: number
  element?: string
  dazeMultiplier?: number
}): void {
  if (input.count <= 0) return
  executions.push({
    moveId: input.moveId,
    moveName: input.moveName,
    category: 'special',
    count: input.count,
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
    damageMultiplier: input.damageMultiplier,
    damageMultiplierOverride: true,
    ...(input.dmgBonus != null ? { dmgBonus: input.dmgBonus } : {}),
    ...(input.element ? { element: input.element } : {}),
    ...(input.dazeMultiplier != null
      ? { dazeMultiplier: input.dazeMultiplier, dazeMultiplierOverride: true }
      : {}),
    // 断离/破甲凶弹由协奏/狙击命中触发（CD 驱动后台自动行）：轴模式按失衡时间占比拆
    // （autoSplitByStun，与协奏/冥狱载体行同口径——2026-09-03 用户口径：CD 好算总量与失衡内易伤量）。
    autoSplitByStun: true,
  })
}

/** 协奏狙杀/冥狱为真实 moveId 的后台追击行：数值全部由倍率表 enrich 回填 */
function pushTableExecution(executions: AgentResourceInput['executions'], input: {
  moveId: string
  moveName: string
  count: number
}): void {
  if (input.count <= 0) return
  executions.push({
    moveId: input.moveId,
    moveName: input.moveName,
    category: 'basic',
    count: input.count,
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
    timeBucket: 'backstage',
    // 2026-09-03（用户口径：自动后台攻击有 CD，好算总量与失衡内易伤量）：CD 驱动后台自动行，
    // 不按捏轴认领/无放置语义——轴模式按失衡时间占比拆「占比内吃满易伤 / 其余无易伤」
    // （猫又超凶爪印同款 autoSplitByStun 通用机制），非轴按全局覆盖率。
    autoSplitByStun: true,
  })
}

function buildTriggerExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  // 倍率融合：一次协奏狙杀 = 1361008 行×2发；一次冥狱 = 1361020×3连射 + 1361022×1终结
  pushTableExecution(executions, {
    moveId: TRIGGER_COORDINATED_MOVE_ID,
    moveName: '普通攻击：协奏狙杀',
    count: cycle.coordinatedCount * TRIGGER_COORDINATED_SHOTS_PER_CAST,
  })
  for (const moveId of TRIGGER_HELL_MOVE_IDS) {
    pushTableExecution(executions, {
      moveId,
      moveName: '普通攻击：协奏狙杀·冥狱',
      count: moveId === '1361020'
        ? cycle.hellCount * TRIGGER_HELL_BURST_SHOTS_PER_CAST
        : cycle.hellCount,
    })
  }
  pushSyntheticExecution(executions, {
    moveId: TRIGGER_DUANLI_MOVE_ID,
    moveName: '断离（影画4）',
    count: cycle.c4DuanliCount,
    damageMultiplier: TRIGGER_C4_DAMAGE_MULTIPLIER,
    dazeMultiplier: TRIGGER_C4_DAZE_MULTIPLIER,
  })
  pushSyntheticExecution(executions, {
    moveId: '1361_c6_armor_piercing',
    moveName: '破甲凶弹（影画6）',
    count: cycle.c6BulletCount,
    damageMultiplier: TRIGGER_C6_DAMAGE_MULTIPLIER,
    dmgBonus: TRIGGER_C6_DMG_BONUS,
    element: 'electric',
  })
}

function patchTriggerExecutions({ cfg, executions }: AgentResourceInput): void {
  const bonus = Math.max(0, Number(cfg.panel.triggerAdditionalStunBuildUp ?? 0))
  if (bonus <= 0) return
  for (const exec of executions) {
    if (!exec.moveId || !TRIGGER_ADDITIONAL_MOVE_IDS.has(exec.moveId)) continue
    exec.stunBuildUpBonus = (exec.stunBuildUpBonus ?? 0) + bonus
  }
}

// 断离的合成假 moveId 无倍率表行，通用提取会跳过；这里按执行行直接注入失衡池。
// 原文断离未标[追加攻击]，故不吃额外能力 stunBuildUpBonus，只吃面板冲击力乘区。
function injectTriggerDuanliStun({
  slot,
  agent,
  charResult,
  dazeCoef,
  stunExecs,
  normalizeResourceSkillType,
}: AgentSkillTransformInput): void {
  const cycle = charResult.specResources?.triggerResolve as TriggerCycle | undefined
  if (!cycle || cycle.c4DuanliCount <= 0) return
  stunExecs.push({
    moveId: TRIGGER_DUANLI_MOVE_ID,
    moveName: '断离（影画4）',
    slot,
    count: cycle.c4DuanliCount,
    baseDaze: TRIGGER_C4_DAZE_MULTIPLIER * dazeCoef,
    element: agent?.damageElement ?? 'electric',
    skillType: normalizeResourceSkillType(null, TRIGGER_DUANLI_MOVE_ID),
  })
}

function buildTriggerResourceResult({ cfg, state }: AgentResourceResultInput) {
  return { specResources: { triggerResolve: cycleFromInput({ cfg, state }) } }
}

function buildTriggerResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.triggerResolve as TriggerCycle | undefined
  if (!cycle) return []
  return [{
    id: 'trigger-resolve',
    title: '扳机·绝意与协奏',
    summary: `绝意消耗 ${cycle.resolveSpent} · 协奏 ${cycle.coordinatedCount} 次 · 冥狱 ${cycle.hellCount} 次`,
    rows: [
      {
        label: '协奏狙杀',
        value: `${cycle.coordinatedCount} 次`,
        detail: `付费 ${cycle.normalPaidCount}${cycle.normalAuto ? `（${cycle.battleTime}s÷${cycle.normalCdSeconds}s CD吃满）` : '（手动）'} + 免费 ${cycle.freeCoordinatedCount}；每发×2（96.3%×2）`,
      },
      {
        label: '冥狱',
        value: `${cycle.hellCount} 次`,
        detail: (cycle.hellAuto
          ? `队友强特 ${cycle.mateExCount} / 终结 ${cycle.mateUltimateCount} / 支援突击 ${cycle.mateAssistCount}，每类≤${cycle.hellRateCapPerType}（20s×2）`
          : '手动指定') + '；每次连射×3+终结×1',
      },
      {
        label: '绝意消耗',
        value: `-${cycle.resolveSpent}`,
        detail: cycle.sniperAuto
          ? `回复端按需，狙击命中反推 ${cycle.sniperHitCount} 次（单发+${cycle.resolveGainPerSniperHit}）`
          : `手动命中 ${cycle.sniperHitCount} 次，供给 ${cycle.resolveSupply}/${cycle.resolveCap}`,
      },
      { label: '破甲凶弹', value: `${cycle.c6BulletCount} 次`, detail: `进场5枚，消耗绝意补充 ${cycle.c6BulletGainFromSpend} 枚` },
    ],
    footer: cycle.note,
  }]
}

export const triggerMechanic: AgentMechanicModule = {
  id: 'agent:trigger',
  agentIds: [TRIGGER_AGENT_ID],
  name: '「扳机」',
  description: '失衡易伤拐、追加攻击定向失衡、协奏CD吃满与冥狱来源驱动、影画4断离（伤害+失衡入池）、影画6破甲凶弹。',
  settings: [
    { id: 'trigger.sniperHitCount', label: '狙击命中（0=自动）', description: '连续射击/蓄力反击的有效命中次数；0=按绝意需求自动反推', default: 0, min: 0, max: 60, step: 1, suffix: '次' },
    { id: 'trigger.normalCoordinatedCount', label: '协奏狙杀次数（0=自动）', description: '付费协奏次数；0=按全队CD吃满（3秒，影画1后2秒）', default: 0, min: 0, max: 120, step: 1, suffix: '次' },
    { id: 'trigger.hellCoordinatedCount', label: '冥狱次数（0=自动）', description: '0=按队友强特/终结/支援突击来源并受每类20秒2次限速', default: 0, min: 0, max: 60, step: 1, suffix: '次' },
  ],
  applyPanel: applyTriggerPanel,
  applyTeamConfig: applyTriggerTeamConfig,
  buildCharConfig: buildTriggerCharConfig,
  buildExecutions: buildTriggerExecutions,
  patchExecutions: patchTriggerExecutions,
  transformSkillExecutions: injectTriggerDuanliStun,
  buildResourceResult: buildTriggerResourceResult,
  resourceSections: buildTriggerResourceSections,
}
