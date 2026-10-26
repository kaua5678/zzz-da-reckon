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
import { moduleExecRow, RECOVERY_OFF } from '@/mechanics/moduleExecRow'
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentTeamPanelEffectInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentTeamConfigInput,
} from '../types'
import type { CharacterOperationConfig, CharacterResourceResult, SkillExecution } from '@/types/resource'
import { effectiveCombatTime } from '@/core/effectiveTime'
import { findMoveById as findMove, getRowValue as rowVal } from '@/data/moveTableQueries'
import { cinemaLevelOf } from '@/data/cinemaLevel'
import { additionalAbilityActiveOf } from '@/core/additionalAbilityActive'
import { mechanicSettingPanelReader } from '@/utils/mechanicSettingCfg'

const settingOf = mechanicSettingPanelReader(() => yaojiayinMechanic.settings)
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
  /**
   * @deprecated 不再当上限（用户裁决 2026-10-22：入场次数只作诊断读数）。
   * 保留字段是为了诊断/回归对照，**不参与次数推导**。
   */
  entryCount: number
  combatTime: number
  cinemaLevel: number
  additionalActive: boolean
  /** 引擎通用强特通道给出的付费震音次数（= `state.exSpecialCount`）；缺省时按能量自算（纯函数兜底） */
  paidCount?: number
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
 * 震音/音簇次数纯函数（**只算「额外」部分**：音簇 / C2 / C6）。
 *
 * **付费震音次数 = 通用强特通道给的 `state.exSpecialCount`**（用户裁决 2026-10-22：「这个不就是
 * 强特逻辑么，有能量就放完」）——`buildCharConfig` 设了 `exSpecialMoveId = 1311008`（和弦 #1，
 * 无 actionTime）+ `exSpecialEnergyConsume = 25`，引擎 `resolveExSpecialCount` 自动算成
 * `⌊总能量/25⌋` 并**把能量扣完**。本函数不再自己除 25。
 * 原文（"和弦"）：「每拥有25点能量，耀嘉音将拥有1点[和弦]」＋「队伍中其他角色通过[快速支援]、
 * [连携技]、[招架支援]或[回避支援]入场时，**耀嘉音将消耗25点能量**，并追加释放1道[震音]」。
 *
 * ⚠ 修前实现是 `min(⌊能量/25⌋, 入场次数)`，把「队友快支次数」当成上限 —— 两个错：
 * ① 她不靠前台放强特耗能（`exSpecialEnergyConsume = 0`），能量唯一出口就是和弦震音 ⇒ 有能量就该扣完；
 * ② 入场机会是**她自己**造的（和弦：操作中角色攻击命中 3s/重击 1s 即可触发快速支援），
 *    不依赖队友填快支次数 ⇒ 默认队（没人填快支）修前震音恒 0、499 能量全废。
 * ⇒ 现在入场次数不再当上限，它只是**诊断读数**（每次付费震音 = 一次入场）。
 *
 * 额外能力：每次付费震音 +1 震音 +3 音簇
 * C2：入场额外 +1 震音 +3 音簇，3s CD（入场 = 付费震音事件，故按付费震音计）
 * C6 随想曲追加次数在外层按精准次数与 10s CD 再算
 */
export function computeYaojiayinTremolos(input: YaojiayinTremoloInput): YaojiayinTremoloResult {
  const cinema = cinemaLevelOf(input.cinemaLevel)
  const t = Math.max(0, Number(input.combatTime) || 0)
  // 付费震音 = 引擎通用强特通道的次数（= ⌊能量/25⌋，能量已扣完）。
  // 外部直调（纯函数测试）没传 paidCount 时回落自算——**仅作兜底**。
  const paidTremolos = input.paidCount !== undefined
    ? Math.max(0, Math.floor(Number(input.paidCount) || 0))
    : Math.floor(Math.max(0, Number(input.totalEnergy) || 0) / YAOJIAYIN_ENERGY_PER_TREMOLO)
  // 入场次数 = 付费震音次数（一次和弦入场合一次扣能震音）；保留入参做诊断/回归对照
  const entries = paidTremolos
  let freeTremolos = 0
  let clusters = 0
  if (input.additionalActive && paidTremolos > 0) {
    freeTremolos += paidTremolos
    clusters += paidTremolos * 3
  }
  let c2Extra = 0
  if (cinema >= 2 && paidTremolos > 0) {
    c2Extra = Math.min(paidTremolos, Math.floor(t / YAOJIAYIN_C2_ENTRY_CD))
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
    skillDamageTarget?: SkillExecution['skillDamageTarget']
    /**
     * 行级能量消耗总量（**整局**，不是单次）：和弦震音只有「付费」部分扣能量（25/次），
     * 而本行 count 含免费震音 ⇒ 不能用 count × 单次值，必须由调用方直接给总量。
     */
    totalEnergyConsume?: number
  },
) {
  if (count <= 0 || dmg <= 0) return
  executions.push(moduleExecRow({
    moveId,
    moveName,
    category: opts?.category ?? 'special',
    count,
    ...RECOVERY_OFF,
    damageMultiplier: dmg,
    damageMultiplierOverride: opts?.damageMultiplierOverride ?? true,
    element: 'ether',
    skillTableNote: note,
    skillDamageTarget: opts?.skillDamageTarget ?? 'exSpecial',
    ...(opts?.dmgBonus ? { dmgBonus: opts.dmgBonus } : {}),
    ...(opts?.critRateBonus ? { critRateBonus: opts.critRateBonus } : {}),
    ...(opts?.totalEnergyConsume ? {
      energyConsume: 0,
      totalEnergyConsume: opts.totalEnergyConsume,
    } : {}),
  }))
}

/**
 * 入场触发次数：全队招架/回避支援 + 全队连携（编排注入 yaojiayinTeamChainTotal）。
 * 耀嘉音本人连携/终结进华彩不额外计「队友入场」，但队友连携入场会计入。
 *
 * ⚠ 2026-10-26：原式还有一项「全队快速支援次数」，来自 `quickAssistCount`——该字段随手动快支
 * 整体删除（用户裁决「手动快支全都删了」）⇒ 快支不再是一个可填的入场来源。她自己的和弦造的
 * 快速支援本来也从来没进过这一项（见下面「次数上限只由能量决定」），故读数无变化。
 */
/**
 * 入场次数诊断读数（用户裁决 2026-10-22：**不再当震音上限**）。
 *
 * 原文口径：入场 = 队伍其他角色通过[快速支援]/[连携技]/[招架支援]/[回避支援]入场时触发一次和弦。
 * 而和弦震音的次数上限**只由能量决定**（每 25 点一次，能量自动扣完）——她自己的和弦也能造快速支援
 * （操作中角色攻击命中 3s CD / 重击 1s CD），所以「队友填了几次快支」不是她的天花板。
 * 本函数只留作**诊断/展示**（资源区块「入场」一栏），不参与次数推导。
 */
function estimateYaojiayinEntries(yj: CharacterOperationConfig, characters: CharacterOperationConfig[]): number {
  let entries = 0
  for (const ch of characters) {
    entries += Math.max(0, Math.floor(ch.parryCount))
  }
  // 连携入场：编排写入 yaojiayinTeamChainTotal（全队 chainCountPerStun × 失衡次数）
  const injectedChains = Math.max(0, Math.floor(Number(yj.yaojiayinTeamChainTotal ?? 0)))
  entries += injectedChains
  return entries
}

function applyYaojiayinTeamFlags(yj: CharacterOperationConfig, characters: CharacterOperationConfig[]): void {
  const entries = estimateYaojiayinEntries(yj, characters)
  yj.yaojiayinEntryCount = entries
}

/**
 * 队伍级机制（原先由 useResourceCalc 手工调用 + 在编排层内联写 cfg 字段）：
 * 入场次数 = 招架（build 阶段即可算）+ 全队连携（需要失衡次数 → converge 阶段）。
 * 连携总数原本由 useResourceCalc 直接写进 cfg（`yaojiayinTeamChainTotal`），现在在模块内自算，
 * 编排层不再有 1311 特判分支。（快支入场数那一臂随 `quickAssistCount` 一起删除，2026-10-26。）
 */
function applyYaojiayinTeamHook(input: AgentTeamConfigInput): void {
  // （CC-383：本人 = 派发器给的 `cfg`；派发器只对在队模块、按 cfg.agentId 取模块调用，不再在 characters 里自找）
  const { cfg: yj, characters, phase, stunCount } = input
  if (phase !== 'build' && phase !== 'converge') return
  if (phase === 'converge') {
    let teamChains = 0
    for (const c of characters) {
      teamChains += Math.max(0, c.chainCountPerStun * stunCount)
    }
    yj.yaojiayinTeamChainTotal = teamChains
  }
  applyYaojiayinTeamFlags(yj, characters)
}

function applyPanel({ cinemaLevel, panel }: AgentPanelInput): void {
  // C4 异常/击破分支的面板加成是**队伍级**（随目标槽不同）⇒ 见下方 teamPanelEffects；
  // 此处只处理「给自己面板」的量，目前没有。
  void cinemaLevel
  void panel
}

/**
 * 队伍级面板效果（2026-09-17 round 20 R20-h3 自 `helpers.ts#computePanelPhases`
 * 的 `if (agent.id === '1311')` 跨槽硬编码块迁入，规则 6）。语义逐位保留：
 *
 * ① **咏叹华彩**（全队增伤/暴伤，**含耀嘉音自己**）：按特殊技等级 12/14/16
 *    （= `12 + (C5?4 : C3?2 : 0)`）查公式 `min(24,max(9,lv+8))` / `min(31,max(8.5,lv*1.5+7))`，
 *    乘覆盖率滑块 `yaojiayin.ariaCoverage`。原块**无自排除** ⇒ 本钩子亦然。
 * ② **影画4 职业分支**（**排除耀嘉音自己**，原 `agent.id !== '1311'`）：
 *    强攻分支走执行行（`buildExecutions`，不在面板）；异常 → 异常积蓄效率 +50%、
 *    击破 → 失衡提升 +50%，均按 `覆盖率 × 0.5`（分支 CD 3s 近似「下次快支」窗口）。
 *
 * ⚠ 两者都随**目标槽**变化 ⇒ 只能写在本钩子（写进自己的 `applyPanel` 只会加到耀嘉音本人面板）。
 * 契约与顺序纪律见 `AgentTeamPanelEffectInput`。
 */
function applyYaojiayinTeamPanelEffects({
  cinemaLevel, targetAgent, panel, settings, report,
}: AgentTeamPanelEffectInput): void {
  const cinema = cinemaLevelOf(cinemaLevel)
  const cov = Math.max(0, Math.min(1, settingOf(settings, 'yaojiayin.ariaCoverage')))
  if (cov > 0) {
    // ⚠ 复用本模块既有的单一事实源（`yaojiayinSkillLevel` + `computeAriaBonuses`），
    // 不在此重写公式——否则与该模块别处的同类折算会漂移（规则 11）。
    const { dmgBonus, critDmg } = computeAriaBonuses(yaojiayinSkillLevel(cinema))
    const dmg = dmgBonus * cov
    const crit = critDmg * cov
    panel.dmgBonus = panel.dmgBonus + dmg
    panel.critDmg = panel.critDmg + crit
    // 结构化记账（2026-10-20）：写入与上报共用同一份结果
    report?.({ stat: 'dmgBonus', value: dmg, mode: 'flat' })
    report?.({ stat: 'critDmg', value: crit, mode: 'flat' })
  }
  if (cinema >= 4 && targetAgent.id !== YAOJIAYIN_ID) {
    const branchCov = cov * 0.5
    const branch = 50 * branchCov
    if (targetAgent.specialty === 'anomaly') {
      panel.anomalyBuildUpEfficiency = panel.anomalyBuildUpEfficiency + branch
      report?.({ stat: 'anomalyBuildUpEfficiency', value: branch, mode: 'flat' })
    }
    if (targetAgent.specialty === 'stun') {
      panel.stunBuildUpBonus = panel.stunBuildUpBonus + branch
      report?.({ stat: 'stunBuildUpBonus', value: branch, mode: 'flat' })
    }
  }
}

function buildCharConfig({ skills, cinemaLevel, cfg, team }: AgentCharConfigInput): void {
  const cinema = cinemaLevelOf(cinemaLevel)
  cfg.yaojiayinCinemaLevel = cinema
  /**
   * 2026-10-23：删掉 `yaojiayinTremoloDmg`（判据 cfgWriteOnlyKeys 报「只写不读」）。
   * 和弦震音自 2026-10-22 用户裁决起走**通用强特通道**（`exSpecialMoveId = 1311008`，
   * 倍率由引擎按招表取），本字段零读者 ⇒ 重构遗留。
   */
  cfg.yaojiayinClusterDmg = rowVal(findMove(skills, MOVE_CLUSTER), 'damage')
  cfg.yaojiayinCapriccioDmg = rowVal(findMove(skills, MOVE_CAPRICCIO_CHARGED), 'damage')

  /**
   * **和弦震音 = 通用强特通道**（用户裁决 2026-10-22：「这个不就是强特逻辑么，有能量就放完，
   * 这个招式只有倍率没有时间」）。
   *
   * 走 `exSpecialMoveId = 1311008`（和弦 #1，92.2% / 无 actionTime）+ `exSpecialEnergyConsume = 25`：
   * 引擎的 `resolveExSpecialCount` 自动给出 `exSpecialCount = ⌊总能量/25⌋`，**能量自动扣完**、
   * 通用强特行自动物化（actionTime = 0 ⇒ 不占前台，正是原文「只有倍率没有时间」）。
   * 不再手写 `computeYaojiayinTremolos` 的「energy/25」那一段。
   *
   * ⚠ 与「她不靠前台放强特耗能」不矛盾：所谓「不走强特」是指**不另外打一次普通强特**；
   * 和弦震音本身就是「有能量就自动放出」的强特型动作，用它走通用通道才是同一件事的通用表达。
   */
  cfg.exSpecialMoveId = MOVE_TREMOLO
  cfg.exSpecialEnergyConsume = YAOJIAYIN_ENERGY_PER_TREMOLO

  // 影画1：开场额外 1000 喧响（默认已有 1000 → 2000）
  if (cinema >= 1) {
    cfg.initialDecibelGift = cfg.initialDecibelGift + YAOJIAYIN_C1_DECIBEL
  }

  // 影画4：标记队内职业（供 helpers / 执行）
  const specs = new Set(
    team.filter(m => m.agentId && m.agentId !== YAOJIAYIN_ID).map(m => m.agent?.specialty).filter(Boolean),
  )
  cfg.yaojiayinTeamHasAttack = specs.has('attack') ? 1 : 0
}

function yaojiayinTremolosOf(
  cfg: AgentResourceInput['cfg'],
  state: AgentResourceInput['state'],
): YaojiayinTremoloResult {
  const cinema = cinemaLevelOf(cfg.yaojiayinCinemaLevel)
  const additionalActive = additionalAbilityActiveOf(cfg.panel)
  return computeYaojiayinTremolos({
    totalEnergy: Math.max(0, state.totalEnergy),
    entryCount: Math.max(0, Math.floor(Number(cfg.yaojiayinEntryCount ?? 0))),
    // 付费震音次数由通用强特通道给（= ⌊能量/25⌋）；exSpecialCount 在模块钩子里已可读
    paidCount: Math.max(0, Math.floor(Number(state.exSpecialCount) || 0)),
    combatTime: effectiveCombatTime(state, cfg),
    cinemaLevel: cinema,
    additionalActive,
  })
}

function buildExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cinema = cinemaLevelOf(cfg.yaojiayinCinemaLevel)
  const combatTime = effectiveCombatTime(state, cfg)
  const result = yaojiayinTremolosOf(cfg, state)

  const clusterDmg = Number(cfg.yaojiayinClusterDmg ?? 0) || 0
  const c6Mult = cinema >= 6 ? 2 : 1
  const c6Crit = cinema >= 6 ? 80 : 0

  // 震音本体（1311008）= **通用强特行**（buildCharConfig 已设 exSpecialMoveId/exSpecialEnergyConsume=25）
  // ⇒ 次数 = ⌊能量/25⌋、能量自动扣完、actionTime 0 不占前台。本模块**不再自建震音行**（防双计）。
  // 下面只补「额外」部分：音簇（额外能力/C2 赠送）、C6 随想曲、C4 强攻分支。

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
    const capDmg = Number(cfg.yaojiayinCapriccioDmg ?? 0) || 0
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
  // 入场次数 = 付费震音次数（能量驱动，用户裁决 2026-10-22）——不再读「队友快支次数」：
  // 她的和弦自己就能造快速支援（操作中角色命中即可），队友填不填快支不是她的上限。
  if (cinema >= 4 && Number(cfg.yaojiayinTeamHasAttack ?? 0) > 0) {
    const triggers = Math.min(result.paidTremolos, Math.floor(combatTime / YAOJIAYIN_C4_BRANCH_CD))
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

function buildResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const result = yaojiayinTremolosOf(cfg, state)
  return {
    yaojiayinTremolo: result,
    specResources: {
      yaojiayin_chord: {
        id: 'yaojiayin_chord',
        name: '和弦/震音',
        initialValue: 0,
        maxValue: null,
        totalGain: Math.floor(Math.max(0, state.totalEnergy) / YAOJIAYIN_ENERGY_PER_TREMOLO),
        gains: { energy: Math.max(0, state.totalEnergy) },
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
  const tr = result.yaojiayinTremolo
  if (!tr || tr.totalTremolos <= 0 && tr.clusters <= 0) return []
  return [{
    id: 'yaojiayin-tremolo',
    title: '耀嘉音·震音/音簇',
    summary: `震音 ${tr.totalTremolos} · 音簇 ${tr.clusters} · 入场 ${tr.entries}`,
    rows: [
      { label: '入场触发', value: String(tr.entries), detail: '全队招架+回避支援+连携' },
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
  // CC-35c-B：咏叹华彩公式用 dynamicSkillLevel（s），来源面板需写入 3/5 命技能等级加成（原 panelPhases 按 '1311' 写死，逐字迁入）
  adjustTeammateBuffSource: ({ source, cinemaLevel }) => {
    const skillBonus = cinemaLevel >= 5 ? 4 : cinemaLevel >= 3 ? 2 : 0
    if (source.outOfCombat) {
      source.outOfCombat = {
        ...source.outOfCombat,
        skillLevelBonus: Math.max(source.outOfCombat.skillLevelBonus, skillBonus),
      }
    }
    if (source.inCombat) {
      source.inCombat = {
        ...source.inCombat,
        skillLevelBonus: Math.max(source.inCombat.skillLevelBonus, skillBonus),
      }
    }
  },
  applyTeamConfig: applyYaojiayinTeamHook,
  id: 'agent:yaojiayin',
  agentIds: [YAOJIAYIN_ID],
  /**
   * 耀嘉音**不能打通用平A**（用户裁决 2026-10-22：「嘉音不能a，妮可可以a」）。
   * 她的前台时间只用来放歌/和弦（`applyTeamConfig` + 模块行），所以：
   * ① 新上阵默认权重 = 0（本来就是支援职业缺省 0，此处置为**机制口径**）；
   * ② 引擎平A池的**第二层兜底**（`core/resource/helpers.ts#iterate`）按本字段排除她
   *    —— 否则主C 贴顶后剩余池会摊到她身上，凭空给她凭空造出平A回能/喧响。
   */
  defaultBasicAttackTimeWeight: 0,
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
  teamPanelEffects: applyYaojiayinTeamPanelEffects,
  buildCharConfig,
  buildExecutions,
  /**
   * 震音本体走通用强特行（`exSpecialMoveId = 1311008`）⇒ 它的倍率/暴击由**这里**按命座修正：
   * 影画6「华彩震音/音簇倍率×2、暴击 +80%」（原文）。
   * （C6 前：倍率表值原样，不动。）
   */
  patchExecutions: ({ cfg, executions }: AgentResourceInput) => {
    const cinema = cinemaLevelOf(cfg.yaojiayinCinemaLevel)
    if (cinema < 6) return
    for (const exec of executions) {
      if (exec.moveId !== MOVE_TREMOLO) continue
      exec.damageMultiplier = (exec.damageMultiplier ?? 0) * 2
      exec.damageMultiplierOverride = true
      exec.critRateBonus = (exec.critRateBonus ?? 0) + 80
      exec.skillTableNote = `${exec.skillTableNote ?? ''}；影画6 倍率×2/暴击+80%`
    }
  },
  buildResourceResult,
  resourceSections,
}


/**
 * D2（CC-359/362）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
/**
 * r406：本模块 `buildResourceResult` 写、`resourceSections` 等读的结果字段（模块扩充，纯类型、零运行时）。
 * 此前未声明 ⇒ 写端无类型、读端 `as any`，拼错键两头都不报错。
 */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 耀嘉音颤音明细 */
    yaojiayinTremolo?: YaojiayinTremoloResult
  }
}

declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 写入：rowVal(findMove(skills, MOVE_CAPRICCIO_CHARGED), 'damage') */
    yaojiayinCapriccioDmg?: number
    /** 写入：cinema */
    yaojiayinCinemaLevel?: number
    /** 写入：rowVal(findMove(skills, MOVE_CLUSTER), 'damage') */
    yaojiayinClusterDmg?: number
    /** 写入：entries */
    yaojiayinEntryCount?: number
    /** 写入：teamChains（编排期全队 chainCountPerStun × 失衡次数）；estimateYaojiayinEntries 读作连携入场 */
    yaojiayinTeamChainTotal?: number
    /** 写入：specs.has('attack') ? 1 : 0 */
    yaojiayinTeamHasAttack?: number
  }
}
