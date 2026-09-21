import type {
  AgentCharConfigInput,
  AgentExSpecialTimeInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  MechanicTeamMember,
} from '../types'
import type { AgentSkills, SkillMove } from '@/types/catalog'
import type { CharacterResourceResult, LiuyinMechanicSource, MechanicSetting } from '@/types/resource'
import { fmt } from '@/utils/format'

const LIUYIN_AGENT_ID = '1481'

function findMoveById(skills: AgentSkills | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const category of skills.categories) {
    const move = category.moves.find(item => item.id === moveId)
    if (move) return move
  }
  return null
}

// —— 好评（Good Review）——
const GOOD_REVIEW_INITIAL = 60
const GOOD_REVIEW_PER_SEC = 0.6
const GOOD_REVIEW_PER_EX = 7.5
const GOOD_REVIEW_C1_MULT = 1.16
/** 60 档转大消耗的好评（导出：编排层按「轴声明 60 + 剩余好评默认 90」推导转大次数时同源引用，规则 11） */
export const HUG60_COST = 60
/** 90 档转大消耗的好评（导出理由同上） */
export const HUG90_COST = 90

// —— 核心被动：暴击率转冲击力 ——
const CRIT_TO_IMPACT_THRESHOLD = 50
const CRIT_TO_IMPACT_PER_PCT = 2
const CRIT_TO_IMPACT_CAP = 100

// —— 额外能力：强化特殊技暴伤 ——
const EX_SPECIAL_CRIT_DMG_BONUS = 50

// —— 影画4：进场能量 ——
const CINEMA4_ENERGY_GIFT = 20
// —— 影画4：好评如潮状态下攻击力 +500（默认满覆盖）——
export const CINEMA4_GOOD_REVIEW_ATK = 500

// —— 影画6：余音额外物理伤害 ——
export const CINEMA6_ECHO_RATIO = 480
export const CINEMA6_ECHO_MAX = 12

// —— 三个强特（石头→剪刀→布），耗能均 25，按 1→3 顺序连打，越靠后数值越高 ——
const EX_SPECIAL_ENERGY = 25
const FAREWELL_MOVE_ID = '1481009' // 送客长按（客诉抱拳）
// —— 强化A：普通攻击：猜拳把戏 #1-#4（每次布！之后可打一轮，占用平A时间）——
const JANKEN_MOVE_IDS = ['1481005', '1481006', '1481007', '1481008']
const JANKEN_DEFAULT_TIMES = [0.55, 0.7, 0.633, 0.617]
const EX_MOVES = [
  { id: '1481011', name: '强化特殊技：石头', actionTime: 0.617 },
  { id: '1481012', name: '强化特殊技：剪刀', actionTime: 0.867 },
  { id: '1481013', name: '强化特殊技：布！', actionTime: 1.383 },
] as const
export const LIUYIN_EX_MOVE_IDS: Set<string> = new Set(EX_MOVES.map(m => m.id))

/**
 * 解析"下一位出场角色"槽位（好评转大的目标队友）：
 * - 自动（-1）：取队伍顺序中琉音上一个槽位（环绕），排除自己。
 * - 手动：直接使用用户设置。
 */
export function resolveUltimateTargetSlot(ownSlot: number, teamLength: number, setting: number): number {
  if (setting >= 0 && setting < teamLength && setting !== ownSlot) return setting
  const prev = (ownSlot - 1 + teamLength) % teamLength
  return prev === ownSlot ? (ownSlot + 1) % teamLength : prev
}

/**
 * 好评 60/90 抱拳次数拆分（抱拳→转大因果链）：
 * 抱拳（消耗客诉的送客长按）命中后检查好评是否 ≥90，达到才能打开大招选择窗口。
 * - 60 转大：目标队友有连携窗口（可连携的敌人）时，只消耗 60 好评把这次连携升级为终结技（连携 -1、终结 +1）。
 *   默认 = **每次失衡 1 次**（用户口径 2026-09-19，原「默认 = 连携总数」废止：每失衡 2 连携的队默认 2 次是错的）。
 * - 90 转大：没有连携窗口时，直接消耗 90 好评打出终结技（终结 +1）。
 * **开窗次数 = 阈值结转口径**（原文逐字：「当[好评]**满90点**且琉音…打开[连携技]窗口时…消耗60点」/
 * 「当[好评]**满90点**且…命中未打开[连携技]窗口的敌人时，将消耗90点」）——
 * 每次开窗都要求**当刻**好评 ≥90，扣 60（有连携窗口）或 90（无窗口），剩余好评**结转**到下一次开窗。
 * ⇒ 计数 = 贪心推进：`while (好评 ≥ 90) { 有窗口扣60否则扣90 }`。
 *
 * ⚠ 2026-09-15 修（原为 `floor(好评总量/90)` 的**预算上限**模型）：两者在 60 档上不等价——
 * 好评 390 时旧模型 4 次、结转口径 **6 次**（= 90 + 60×5，正是用户需求链③「4喧响+6好评转大，
 * 好评≥390=90+60×5 阈值结转口径」的算式）。旧模型把「预算」当成了「次数」，
 * 在好评落在 [90+60k, 90(k+1)) 区间时少算。**无连携窗口时两者一致**（全走 90 ⇒ floor(G/90)），
 * 故差异只出现在有连携窗口的队。
 * 60 转大默认 = 每次失衡 1 次（用户口径 2026-09-19），上限每次失衡 2 次（用户口径 2026-09），可调。
 * 返回的 hug60 即"被替换掉的连携数"，也是影画6 余音的触发次数来源之一。
 */
// @fact agent:1481/60转大上限 口径: 60 转大默认=每次失衡 1 次（2026-09-19 修正；原「默认=连携总数」废止），上限每次失衡 2 次，liuyin.hug60Count 可调总转大数 | 据 用户@2026-09-19「该默认1失衡提供一次连携转大的机会」 | 验 src/mechanics/__tests__/liuyin.test.ts | 锚 src/mechanics/agents/liuyin.ts#computeLiuyinHugCounts | 信 确认
// @fact agent:1481/开窗次数 口径: 阈值结转——每次开窗要求当刻好评≥90，有连携窗口扣60/无窗口扣90，余额结转；故计数为贪心推进（好评390+连携窗口⇒6窗=90+60×5），**不是** floor(总量/90) 的预算上限模型（后者在好评落在 [90+60k,90(k+1)) 区间时少算；无连携窗口时两者一致） | 据 原文核心被动「当[好评]满90点且…」+ 用户需求链③@2026-09-13 | 验 src/mechanics/__tests__/liuyin.test.ts | 锚 src/mechanics/agents/liuyin.ts#computeLiuyinHugCounts | 信 确认
// ⟳复核: 若琉音原文改版（好评消耗值 60/90 或开窗条件变动）则复核本口径；另「连携/破阵按实际失衡次数」改造（坑19未落地·有裁决A）开工时一并复核 | 到期 2026-12-31
export function computeLiuyinHugCounts(
  goodReviewTotal: number,
  stunCount: number,
  hug60Setting: number,
  targetChainCountTotal = Number.POSITIVE_INFINITY,
) {
  const G = Math.max(0, goodReviewTotal)
  // 60 转大：默认**每次失衡 1 次**转大机会（用户口径 2026-09-19「该默认1失衡提供一次连携转大的机会」；
  // 原「默认 = 连携总数」废止——每失衡 2 连携的队连携窗口是它的 2 倍，但用户确认的舞台分配仍按 1 次/失衡）。
  // 消耗失衡赠送的连携窗口（有轴时由轴内连携块决定；无轴兜底 = 每失衡 1 次）；上限仍每失衡 2 次（用户口径 2026-09）。
  const chainWindows = Number.isFinite(targetChainCountTotal)
    ? Math.max(0, Math.floor(targetChainCountTotal))
    : Math.max(0, Math.floor(stunCount))
  const auto60 = Math.min(Math.max(0, Math.floor(stunCount)), chainWindows)
  // 本次可用的 60 档次数上限（三重夹紧：设置值 / 连携窗口数 / 每失衡 2 次）
  const cap60 = Math.min(
    hug60Setting >= 0 ? Math.floor(hug60Setting) : auto60,
    chainWindows,
    2 * Math.max(0, Math.floor(stunCount)),
  )
  /**
   * 阈值结转贪心：每次开窗要求**当刻** ≥90，优先用 60 档（有连携窗口 + 未超 cap60），
   * 否则用 90 档。**预算安全**由循环条件保证（花 60 或 90 都 ≤ 当刻余额）。
   */
  let hug60 = 0
  let hug90 = 0
  let rest = G
  while (rest >= HUG90_COST) {
    if (hug60 < cap60) { rest -= HUG60_COST; hug60++ }
    else { rest -= HUG90_COST; hug90++ }
  }
  return { hug60, hug90, remainingGoodReview: rest }
}

function cfgNum(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const value = record[`setting:${id}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 判断队伍中是否存在强攻或命破角色（触发琉音额外能力） */
function hasAttackOrRuptureTeammate(team: MechanicTeamMember[], ownSlot: number): boolean {
  return team.some(m => m.slot !== ownSlot && m.agent && (m.agent.specialty === 'attack' || m.agent.specialty === 'rupture'))
}

/**
 * 解析“上一位队友”槽位：
 * - 自动（-1）：取队伍顺序中琉音前一个槽位（环绕），排除自己。
 * - 手动：直接使用用户设置。
 */
function resolvePreviousTeammateSlot(ownSlot: number, teamLength: number, setting: number): number {
  if (setting >= 0 && setting < teamLength && setting !== ownSlot) return setting
  const prev = (ownSlot - 1 + teamLength) % teamLength
  return prev === ownSlot ? (ownSlot + 1) % teamLength : prev
}

interface LiuyinSourceInput {
  exSpecialCount: number
  ultimateCount: number
  /** 接战时长（秒）= 整场战斗时长，不是琉音自己的前线时间（2026-09 用户口径） */
  combatTime: number
  cinemaLevel: number
  extraAbilityActive: boolean
  previousTeammateSlot: number
}

export function computeLiuyinSource(input: LiuyinSourceInput): LiuyinMechanicSource {
  const cinemaLevel = Math.max(0, Math.floor(input.cinemaLevel))
  const c1Mult = cinemaLevel >= 1 ? GOOD_REVIEW_C1_MULT : 1
  const perSec = GOOD_REVIEW_PER_SEC * c1Mult
  const perEx = GOOD_REVIEW_PER_EX * c1Mult
  const combatGain = Math.max(0, input.combatTime) * perSec
  const exGain = Math.max(0, Math.floor(input.exSpecialCount)) * perEx
  const gainTotal = combatGain + exGain
  const total = GOOD_REVIEW_INITIAL + gainTotal

  // 等效总量规则（用户确认）：
  // - 转大次数 = 阈值结转贪心（每次开窗当刻需满 90；60/90 分配在 promoteFixpoint 按连携窗口拆，见 computeLiuyinHugCounts）
  // - 抱拳次数（送客长按 1481009 执行）= 转大次数 + 琉音终结技次数
  //   （好评满90 → 抱拳转大；琉音终结技送 1 客诉 → 抱拳不转大，纯伤害）
  const promoteWindows = Math.floor(total / 90)
  const ownUltimateCount = Math.max(0, Math.floor(input.ultimateCount))
  const farewellCount = promoteWindows + ownUltimateCount

  return {
    goodReviewInitial: GOOD_REVIEW_INITIAL,
    goodReviewPerSec: perSec,
    goodReviewPerEx: perEx,
    goodReviewC1Multiplier: c1Mult,
    goodReviewGainTotal: gainTotal,
    goodReviewTotal: total,
    exHeavyCount: Math.max(0, Math.floor(input.exSpecialCount)),
    promoteWindows,
    ownUltimateCount,
    farewellCount,
    extraAbilityActive: input.extraAbilityActive,
    previousTeammateSlot: input.previousTeammateSlot,
    cinemaLevel,
    note:
      '好评：进场60，接战(整场战斗时长)每秒0.6、强特重击7.5（1命×1.16），整局口径不按120上限截断；' +
      '等效规则：转大次数=阈值结转（每次开窗当刻需满90，扣60/90后余额结转），抱拳次数=转大次数+琉音终结技次数（终结技送客诉→抱拳不转大）。',
  }
}

function applyLiuyinPanel({ slot, team, agent, cinemaLevel, panel, settings }: AgentPanelInput): void {
  // 额外能力触发条件由 spec.additionalAbility 声明式统一判定写入 panel.additionalAbilityActive；
  // 兜底走硬编码（spec 未声明时）。
  const extraAbilityActive = (panel.additionalAbilityActive ?? 0) > 0
    || (panel.additionalAbilityActive === undefined && hasAttackOrRuptureTeammate(team, slot))

  // 核心被动·恶意投诉：敌人进入失衡后的失衡持续时间 +2 秒（角色级失衡时长延长，引擎按全队求和计入失衡覆盖率）。
  panel.stunDurationBonusSeconds = (panel.stunDurationBonusSeconds ?? 0) + 2

  // 核心被动：初始暴击率超过 50% 时，每超过 1% 冲击力 +2，最多 +100（100% 暴击时封顶）。
  const critRate = panel.critRate ?? 0
  const over = Math.max(0, critRate - CRIT_TO_IMPACT_THRESHOLD)
  const impactBonus = Math.min(CRIT_TO_IMPACT_CAP, over * CRIT_TO_IMPACT_PER_PCT)
  if (impactBonus > 0) panel.impact = (panel.impact ?? 0) + impactBonus

  // 额外能力：强化特殊技伤害暴击伤害 +50%（技能专属 buff，仅强化特殊技生效）。
  if (extraAbilityActive) {
    panel.critDmg__exSpecial = (panel.critDmg__exSpecial ?? 0) + EX_SPECIAL_CRIT_DMG_BONUS
  }

  // 影画4：好评如潮状态下琉音攻击力 +500，默认满覆盖（覆盖率从已解析滑块折算）。
  if (cinemaLevel >= 4) {
    panel.liuyinGoodReviewAtkBonus = (panel.liuyinGoodReviewAtkBonus ?? 0) + CINEMA4_GOOD_REVIEW_ATK
  }

  // 影画4 折算（规则 6 迁入，2026-09-17 round 20 R20-h1 批次 1 / A11）。
  //
  // 原住在 `helpers.ts#computePanelPhases` 的 `if (agent.id === '1481' || agent.teammateBuffId === '1481')`
  // 块。同槽自身面板（只在琉音自己面板上折算**她自己**的 `liuyinGoodReviewAtkBonus`）⇒ 不触 P2 跨槽陷阱。
  //
  // ⚠ **顺序约束**：本折算必须在上面 `cinemaLevel >= 4` 的 bonus 写入**之后**（同一函数内），
  // 否则读到的 `liuyinGoodReviewAtkBonus` 恒 0 ⇒ 面板静默少 500×覆盖率（既有判据会红）。
  //
  // ⚠ **右臂 `teammateBuffId === '1481'` 是死分支、逐位保留不删**（分诊报告 §3.2 已证：`'1481'`
  // 不在 catalog 的 5 个 `teammateBuffId` —— 1261/1581/1411/1171/1511 —— 里）。删它是**语义变更**，
  // 不是清理：将来数据面若给琉音填上 `teammateBuffId`，该臂会复活。为守住这一点，此处**原样保留
  // 原判据的整条析取**（`agent.id === '1481' || agent.teammateBuffId === '1481'`）——虽然
  // `applyPanel` 派发点已按 `agent.id` 寻址、右臂当前恒 false，但它作为**数据面守卫**继续生效：
  // 一旦 catalog 给某角色填上 `teammateBuffId: '1481'`，该角色的面板也会走这段折算（与迁移前一致）。
  if (agent.id === '1481' || agent.teammateBuffId === '1481') {
    const atkBonus = panel.liuyinGoodReviewAtkBonus ?? 0
    if (atkBonus > 0) {
      const coverage = settings['liuyin.goodReviewAtkCoverage'] ?? 1
      panel.atk = (panel.atk ?? 0) + atkBonus * coverage
    }
  }
}

function buildLiuyinCharConfig({ slot, cinemaLevel, team, skills, cfg, panel, getRowValue }: AgentCharConfigInput): void {
  const teamLength = Math.max(1, team.length)
  const prevSetting = cfgNum(cfg, 'liuyin.previousTeammateSlot', -1)
  cfg.liuyinCinemaLevel = cinemaLevel
  // 额外能力触发条件：优先读声明式判定（panel.additionalAbilityActive），兜底硬编码。
  cfg.liuyinExtraAbilityActive = (panel.additionalAbilityActive ?? 0) > 0
    || (panel.additionalAbilityActive === undefined && hasAttackOrRuptureTeammate(team, slot))
  cfg.liuyinPreviousTeammateSlot = resolvePreviousTeammateSlot(slot, teamLength, prevSetting)
  cfg.liuyinHug60Count = Math.floor(cfgNum(cfg, 'liuyin.hug60Count', -1))
  // 三个强特由本模块按 1→3 顺序生成，跳过通用强特执行；强特次数必须为整数（真实次数，非期望值模型）。
  cfg.skipGenericExSpecial = true
  cfg.exSpecialCountFloor = true
  cfg.exSpecialEnergyConsume = EX_SPECIAL_ENERGY

  // 送客长按（1481009，客诉抱拳）倍率行：damage/daze/anomaly/喧响/动作时间，供执行计划完整调用。
  const farewell = findMoveById(skills, FAREWELL_MOVE_ID)
  cfg.liuyinFarewellMoveId = FAREWELL_MOVE_ID
  cfg.liuyinFarewellDamage = getRowValue(farewell, 'damage')
  cfg.liuyinFarewellActionTime = farewell?.actionTime ?? 0
  cfg.liuyinFarewellDecibel = getRowValue(farewell, 'decibel_recovery')

  // 强化A（普通攻击：猜拳把戏 #1-#4）：每段 actionTime 从倍率表读取，一轮总时长 = 4 段之和。
  const jankenTimes = JANKEN_MOVE_IDS.map(id => findMoveById(skills, id)?.actionTime ?? 0)
  cfg.liuyinJankenActionTimes = jankenTimes
  cfg.liuyinJankenRoundSeconds = jankenTimes.reduce((a, b) => a + b, 0)

  // 影画4：进入战场回复 20 点能量。
  if (cinemaLevel >= 4) cfg.initialEnergyGift = (cfg.initialEnergyGift ?? 0) + CINEMA4_ENERGY_GIFT
}

/**
 * 必做前台时间估计（2026-09-06 补，sigrid/青衣同款）：三个强特（石头→剪刀→布）按 1→3 轮转
 * 各带真实 actionTime，送客（客诉抱拳）= 转大次数 + 琉音终结技次数——通用公式「次数×单段」
 * 只按石头 0.617s 计，缺口（剪刀/布/送客 ≈15s）全靠折叠 `+=` 残差兜底 → 积分器风卷进
 * timeBudgetExcess（1591 系修复时实测琉音 pass0 excess 15.1s 的原产地）。强化A（猜拳把戏
 * #1-4）从平A池 carve，不进必要时间（与 buildExecutions 同口径）。
 * 配套（同一轮）：折叠环收敛判据从 1e-6 放宽到量化残差容差——精确估时把 excess 压到 ~5e-4s
 * 量级，1e-6 判据 8 轮耗尽 → timeBudgetConverged=false 而 allAgentsSweep 硬断言恒 true。
 */
// @fact agent:1481/强特计划估时 口径: 琉音必要时间 = 三强特（石头0.617/剪刀0.867/布1.383 × 轮转次数）+ 送客（转大次数+终结技次数 × farewellActionTime），由 estimateExSpecialTime 计账——通用公式只按单段计会漏 剪刀/布/送客 ≈15s，折叠积分器把漏差风卷成必要时间虚高（1591/1481 队 pass0 excess 15.1s 的来源）；强化A（猜拳把戏）从平A池 carve 不进必要时间 | 据 实测@2026-09-06 + sigrid 同款修复·复核@2026-09-08 | 验 src/mechanics/__tests__/liuyin.test.ts#强特计划估时 | 锚 src/mechanics/agents/liuyin.ts#liuyinExSpecialTime | 信 高
function liuyinExSpecialTime({ cfg, exSpecialCount, ultimateCount }: AgentExSpecialTimeInput): { necessaryTime: number; comboAlignTime: number } {
  // 轴模式回落：轴模式经 chainCountTotalOverride 注入窗口加权的最终连携次数（engine 口径），
  // 轴内 60/90 转大次数由轴预设 promoteVariant 块决定、不随好评推导——通用公式 + 折叠残差是
  // 轴态的既有口径（钩子只对非轴生效；轴模式诚实收费会把比利轴队的量化均衡推开 4.1s，实测
  // 2026-09-06）
  if (cfg.chainCountTotalOverride !== undefined) {
    return { necessaryTime: Math.max(0, exSpecialCount) * (cfg.exSpecialActionTime ?? 0), comboAlignTime: 0 }
  }
  const exTotal = Math.max(0, Math.floor(exSpecialCount))
  // 与 buildLiuyinExecutions 同一轮转拆分（1→3 顺序连打，越靠后数值越高）
  const counts = [Math.floor((exTotal + 2) / 3), Math.floor((exTotal + 1) / 3), Math.floor(exTotal / 3)]
  let exTime = 0
  for (let k = 0; k < EX_MOVES.length; k++) exTime += counts[k] * EX_MOVES[k].actionTime
  // 送客（客诉抱拳）：与 buildLiuyinExecutions 同一求解（computeLiuyinSource）
  const source = computeLiuyinSource({
    exSpecialCount: exTotal,
    ultimateCount: Math.max(0, Math.floor(ultimateCount)),
    combatTime: cfg.battleTime ?? 180,
    cinemaLevel: cfg.liuyinCinemaLevel ?? 0,
    extraAbilityActive: cfg.liuyinExtraAbilityActive ?? false,
    previousTeammateSlot: cfg.liuyinPreviousTeammateSlot ?? 0,
  })
  const farewellTime = Math.max(0, Math.floor(source.farewellCount)) * (cfg.liuyinFarewellActionTime ?? 0)
  return { necessaryTime: exTime + farewellTime, comboAlignTime: 0 }
}

function buildLiuyinExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const source = computeLiuyinSource({
    exSpecialCount: state.exSpecialCount,
    ultimateCount: state.ultimateCount,
    combatTime: cfg.battleTime ?? 180,
    cinemaLevel: cfg.liuyinCinemaLevel ?? 0,
    extraAbilityActive: cfg.liuyinExtraAbilityActive ?? false,
    previousTeammateSlot: cfg.liuyinPreviousTeammateSlot ?? 0,
  })

  // 三个强特（石头→剪刀→布）按 1→3 顺序生成；失衡内/非失衡的易伤拆分在伤害池按失衡次数处理。
  const exTotal = Math.max(0, Math.floor(state.exSpecialCount))
  const counts = [Math.floor((exTotal + 2) / 3), Math.floor((exTotal + 1) / 3), Math.floor(exTotal / 3)]
  for (let k = 0; k < EX_MOVES.length; k++) {
    if (counts[k] <= 0) continue
    const mv = EX_MOVES[k]
    executions.push({
      moveId: mv.id,
      moveName: mv.name,
      category: 'special',
      count: counts[k],
      actionTime: mv.actionTime,
      comboAlignRatio: 0,
      totalTime: counts[k] * mv.actionTime,
      totalComboAlignTime: 0,
      energyConsume: EX_SPECIAL_ENERGY,
      totalEnergyConsume: counts[k] * EX_SPECIAL_ENERGY,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      skillDamageTarget: 'exSpecial',
    })
  }

  // 客诉抱拳（送客长按 1481009）：次数 = 转大次数 + 琉音终结技次数（等效规则）。
  // 完整倍率行由 buildCharConfig 从倍率表读取，直接覆盖，不依赖回填。
  const farewellCount = Math.max(0, Math.floor(source.farewellCount))
  if (farewellCount > 0) {
    executions.push({
      moveId: cfg.liuyinFarewellMoveId ?? FAREWELL_MOVE_ID,
      moveName: '强化特殊技：送客！（客诉抱拳）',
      category: 'special',
      count: farewellCount,
      actionTime: cfg.liuyinFarewellActionTime ?? 0,
      comboAlignRatio: 0,
      totalTime: farewellCount * (cfg.liuyinFarewellActionTime ?? 0),
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.liuyinFarewellDecibel ?? 0,
      totalDecibelRecovery: farewellCount * (cfg.liuyinFarewellDecibel ?? 0),
      damageMultiplier: cfg.liuyinFarewellDamage ?? 0,
      damageMultiplierOverride: (cfg.liuyinFarewellDamage ?? 0) > 0,
      skillDamageTarget: 'exSpecial',
      skillTableNote: '客诉抱拳：消耗 1 客诉发动送客长按，倍率行 1481009',
    })
  }

  // 强化A（普通攻击：猜拳把戏 #1-#4）：布（1481013）次数 × 一轮 4 段，占用平A时间。
  // 平A总时长 = basic_attack 行的 totalTime（含合轴扣除前）；优先打强化A，时间不够按整轮截断（不拆半轮）。
  const paperCount = counts[2]
  const roundSeconds = cfg.liuyinJankenRoundSeconds ?? JANKEN_DEFAULT_TIMES.reduce((a, b) => a + b, 0)
  const jankenTimes = cfg.liuyinJankenActionTimes ?? JANKEN_DEFAULT_TIMES
  const basicExec = executions.find(e => e.moveId === 'basic_attack')
  const basicTimeTotal = basicExec?.totalTime ?? 0
  if (paperCount > 0 && roundSeconds > 0) {
    const maxFullRounds = Math.floor(basicTimeTotal / roundSeconds)
    const rounds = Math.max(0, Math.min(paperCount, maxFullRounds))
    if (rounds > 0) {
      const usedTime = rounds * roundSeconds
      for (let s = 0; s < JANKEN_MOVE_IDS.length; s++) {
        const at = jankenTimes[s] ?? JANKEN_DEFAULT_TIMES[s] ?? 0
        executions.push({
          moveId: JANKEN_MOVE_IDS[s],
          moveName: `普通攻击：猜拳把戏 #${s + 1}（强化A）`,
          category: 'basic',
          count: rounds,
          actionTime: at,
          comboAlignRatio: 0,
          totalTime: rounds * at,
          totalComboAlignTime: 0,
          energyConsume: 0,
          totalEnergyConsume: 0,
          decibelRecovery: 0,
          totalDecibelRecovery: 0,
          energyRecovery: 0,
          totalEnergyRecovery: 0,
          skillTableNote: `强化A：布×${paperCount}，平A时间 ${basicTimeTotal.toFixed(2)}s 够打 ${rounds} 轮（整轮截断）`,
        })
      }
      // 扣减普通平A时间（强化A占用平A时间，优先打）
      if (basicExec) basicExec.totalTime = Math.max(0, basicExec.totalTime - usedTime)
    }
  }
}

function buildLiuyinResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return {
    liuyinMechanicSource: computeLiuyinSource({
      exSpecialCount: state.exSpecialCount,
      ultimateCount: state.ultimateCount,
      combatTime: cfg.battleTime ?? 180,
      cinemaLevel: cfg.liuyinCinemaLevel ?? 0,
      extraAbilityActive: cfg.liuyinExtraAbilityActive ?? false,
      previousTeammateSlot: cfg.liuyinPreviousTeammateSlot ?? 0,
    }),
  }
}

function buildLiuyinResourceSections({ result, liuyinHug }: AgentResourceSectionsInput) {
  const source = result.liuyinMechanicSource
  if (!source) return []
  return [
    {
      id: 'liuyin-good-review',
      title: '琉音·好评',
      summary: `总量 ${fmt(source.goodReviewTotal)}（初始 ${fmt(source.goodReviewInitial)} + 回复 ${fmt(source.goodReviewGainTotal)}）`,
      rows: [
        { label: '接战每秒', value: `+${fmt(source.goodReviewPerSec)}`, detail: source.goodReviewC1Multiplier !== 1 ? '1命×1.16' : '基础0.6' },
        { label: '强特重击每次', value: `+${fmt(source.goodReviewPerEx)}`, detail: `强特重击 × ${fmt(source.exHeavyCount)} 次` },
        { label: '60抱拳', value: `-${HUG60_COST}/次`, detail: '好评满90后经连携窗口，把队友连携升级为终结技' },
        { label: '90抱拳', value: `-${HUG90_COST}/次`, detail: '送客命中未开窗敌人，直接释放队友终结技' },
      ],
      footer: '好评整局口径，不按单条 120 上限截断；60/90 抱拳次数按失衡次数拆分、用户可调（见设置）。',
    },
    {
      id: 'liuyin-farewell',
      title: '琉音·抱拳（送客长按）',
      summary: `抱拳 ${fmt(source.farewellCount)} 次（转大 ${fmt(source.promoteWindows)} + 终结技 ${fmt(source.ownUltimateCount)}）`,
      rows: [
        { label: '转大次数', value: `+${fmt(source.promoteWindows)}`, detail: '阈值结转：每次开窗当刻需满90好评，扣60（有连携窗口）/90（无窗口）后余额结转' },
        // 收敛后的 60/90 拆分（不动点终值，仅结果页注入 liuyinHug 时显示；`N 次` 格式同时进难度曲线关键次数解析器）
        ...(liuyinHug ? [
          { label: '　├ 60转大（吃连携窗口）', value: `${fmt(liuyinHug.hug60)} 次`, detail: '好评满90后经连携窗口：目标队友连携−1、终结技+1；也是影画6余音触发次数来源之一' },
          { label: '　└ 90转大（白送终结技）', value: `${fmt(liuyinHug.hug90)} 次`, detail: '无连携窗口：送客命中未开窗敌人，直接释放目标队友终结技' },
        ] : []),
        { label: '终结技送客诉', value: `+${fmt(source.ownUltimateCount)}`, detail: '琉音终结技每次送 1 客诉 → 抱拳不转大（纯伤害）' },
        { label: '抱拳总数', value: `${fmt(source.farewellCount)} 次 × 1481009`, detail: '转大次数 + 终结技次数；每次造成物理伤害并触发上一位角色快速支援' },
      ],
      footer: '等效规则（用户确认）：抱拳次数 = 转大次数 + 终结技次数；客诉单条上限 1 不限制整局，整局按总量结算。',
    },
  ]
}

const settings: MechanicSetting[] = [
  {
    id: 'liuyin.previousTeammateSlot',
    label: '琉音专属直伤·上一位队友',
    description: '专属直伤读取的队友槽位；-1 表示自动取队伍顺序中琉音前一位（环绕），0/1/2 手动指定。',
    default: -1,
    min: -1,
    max: 2,
    step: 1,
    suffix: '',
  },
  {
    id: 'liuyin.hug60Count',
    label: '琉音 60 好评抱拳次数',
    description: '按失衡次数自动（-1），或手动指定 60 抱拳次数；剩余好评按 90 抱拳结算。',
    default: -1,
    min: -1,
    max: 200,
    step: 1,
    suffix: '次',
  },
  {
    id: 'liuyin.goodReviewAtkCoverage',
    label: '琉音影画4·好评如潮攻击力覆盖率',
    description: '好评如潮状态下攻击力 +500 的覆盖率，默认满覆盖（100%）。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: 'liuyin.ultimateTargetSlot',
    label: '琉音好评转大·目标队友',
    description: '好评 60/90 抱拳把队友连携升级为终结技的目标槽位；-1 表示自动取上一位角色（环绕），0/1/2 手动指定。',
    default: -1,
    min: -1,
    max: 2,
    step: 1,
    suffix: '',
  },
  {
    id: 'liuyin.c6EchoMax',
    label: '琉音影画6·余音每转大触发次数',
    description: '每次转大触发余音的次数上限，默认 12（全打满）；调低可模拟余音浪费/命中限制。',
    default: 12,
    min: 0,
    max: 12,
    step: 1,
    suffix: '次',
  },
]

export const liuyinMechanic: AgentMechanicModule = {
  id: 'agent:liuyin',
  agentIds: [LIUYIN_AGENT_ID],
  name: '琉音',
  description: '好评/客诉资源、暴击转冲击、额外能力强特暴伤、4命进场能量、按上一位队友特性的专属直伤。',
  applyPanel: applyLiuyinPanel,
  buildCharConfig: buildLiuyinCharConfig,
  /**
   * 跨槽位供给：好评转大 → 送给目标队友的**终结技行**（规则 6 在引擎层的落点）。
   *
   * 迁移自 `core/resource.ts#liuyinGiftChainInfo`（2026-09-13，数值逐位保留）。三处口径要点：
   * ① **轴模式抑制**（`axisSuppressed`）：轴内 60/90 转大次数由轴预设 `promoteVariant` 块决定
   *    （+ 用户 2026-09-20 口径「剩余好评默认 90」，两者都在编排层算好后经 `axisLiuyinPromote` 注入）
   *    ⇒ 本供给在轴模式下不出数（恒 0）。引擎的**四处**消费点（`iterate` 账本预留 / S2 折叠环
   *    `rowTime` 测量 / `frontlineRowsOf` 试探测量 / `giftTimeOfSlot` 截断上限）统一走
   *    `ultimateGiftOf` 取轴计数（单一事实源，见 `@fact engine:赠送时间/轴模式四处同源`）。
   *    ⚠ 旧注释「通用公式会算出另一个数 ⇒ 预留会让 4 队留白变差 +0.27~2.70s」已作废：那是
   *    **只有单处**消费轴计数时的读数；四处同源后守恒成立（实测 `timeLedgerInvariants` 全绿）。
   * ② 落点缺省 = 上一位队友（`resolveUltimateTargetSlot`，用户可经 `liuyin.ultimateTargetSlot` 覆盖）。
   * ③ 单位耗时 = 落点槽的 `ultimateActionTime`（转大是把队友的**连携**升级为**终结技**）。
   */
  crossAgentSupply: {
    kind: 'gift-chain:ultimate',
    axisSuppressed: true,
    supply: ({ cfg, state, targetCfg, stunCount, totalTime }) => {
      if (!targetCfg) return 0
      const src = computeLiuyinSource({
        exSpecialCount: state.exSpecialCount,
        ultimateCount: state.ultimateCount,
        combatTime: cfg.battleTime ?? totalTime,
        cinemaLevel: cfg.liuyinCinemaLevel ?? 0,
        extraAbilityActive: cfg.liuyinExtraAbilityActive ?? false,
        previousTeammateSlot: cfg.liuyinPreviousTeammateSlot ?? 0,
      })
      // 目标槽的连携总数（60 转大吃掉的是**目标槽的连携窗口**）
      const targetChainTotal = Math.min(
        (targetCfg.chainCountPerStun ?? 0) * stunCount,
        targetCfg.chainCountTotalOverride ?? (targetCfg.chainCountPerStun ?? 0) * stunCount,
      )
      const hug = computeLiuyinHugCounts(
        src.goodReviewTotal,
        stunCount,
        Math.floor(cfgNum(cfg, 'liuyin.hug60Count', -1)),
        targetChainTotal,
      )
      return hug.hug60 + hug.hug90
    },
    targetSlot: ({ ownSlot, teamSize, cfg }) =>
      resolveUltimateTargetSlot(ownSlot, teamSize, Math.floor(cfgNum(cfg, 'liuyin.ultimateTargetSlot', -1))),
    secondsPerUnit: ({ targetCfg }) => targetCfg.ultimateActionTime ?? 0,
  },
  estimateExSpecialTime: liuyinExSpecialTime,
  buildExecutions: buildLiuyinExecutions,
  buildResourceResult: buildLiuyinResourceResult,
  resourceSections: buildLiuyinResourceSections,
  settings,
}
