import type {
  AgentCharConfigInput,
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
const HUG60_COST = 60
const HUG90_COST = 90

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
 * - 90 转大：没有连携窗口时，直接消耗 90 好评打出终结技（终结 +1）。
 * 每次转大消耗一次开窗机会（floor(好评总量/90) 为硬上限），60 次数默认按失衡次数、可调。
 * 返回的 hug60 即"被替换掉的连携数"，也是影画6 余音的触发次数来源之一。
 */
export function computeLiuyinHugCounts(
  goodReviewTotal: number,
  stunCount: number,
  hug60Setting: number,
  targetChainCountTotal = Number.POSITIVE_INFINITY,
) {
  const windows = Math.floor(Math.max(0, goodReviewTotal) / HUG90_COST)
  // 60 转大：消耗失衡赠送的连携窗口（有轴时由轴内连携块决定，可 2 次/失衡；无轴兜底 = 每失衡 1 次）
  const auto60 = Number.isFinite(targetChainCountTotal)
    ? Math.max(0, Math.floor(targetChainCountTotal))
    : Math.max(0, Math.floor(stunCount))
  const hug60 = Math.min(
    hug60Setting >= 0 ? Math.floor(hug60Setting) : auto60,
    windows,
    Math.max(0, Math.floor(targetChainCountTotal)),
  )
  const hug90 = Math.max(0, windows - hug60)
  const remainingGoodReview = Math.max(
    0,
    Math.max(0, goodReviewTotal) - hug60 * HUG60_COST - hug90 * HUG90_COST,
  )
  return { hug60, hug90, remainingGoodReview }
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
  frontlineTime: number
  cinemaLevel: number
  extraAbilityActive: boolean
  previousTeammateSlot: number
}

export function computeLiuyinSource(input: LiuyinSourceInput): LiuyinMechanicSource {
  const cinemaLevel = Math.max(0, Math.floor(input.cinemaLevel))
  const c1Mult = cinemaLevel >= 1 ? GOOD_REVIEW_C1_MULT : 1
  const perSec = GOOD_REVIEW_PER_SEC * c1Mult
  const perEx = GOOD_REVIEW_PER_EX * c1Mult
  const frontlineGain = Math.max(0, input.frontlineTime) * perSec
  const exGain = Math.max(0, Math.floor(input.exSpecialCount)) * perEx
  const gainTotal = frontlineGain + exGain
  const total = GOOD_REVIEW_INITIAL + gainTotal

  // 等效总量规则（用户确认）：
  // - 转大次数 = floor(好评总量 / 90)（好评满 90 开窗即可抱拳转大；60/90 分配在 promoteFixpoint 按连携窗口拆）
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
      '好评：进场60，接战每秒0.6、强特重击7.5（1命×1.16），整局口径不按120上限截断；' +
      '等效规则：转大次数=floor(好评/90)，抱拳次数=转大次数+琉音终结技次数（终结技送客诉→抱拳不转大）。',
  }
}

function applyLiuyinPanel({ slot, team, cinemaLevel, panel }: AgentPanelInput): void {
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

  // 影画4：好评如潮状态下琉音攻击力 +500，默认满覆盖（覆盖率在 helpers.ts 读取设置后折算）。
  if (cinemaLevel >= 4) {
    panel.liuyinGoodReviewAtkBonus = (panel.liuyinGoodReviewAtkBonus ?? 0) + CINEMA4_GOOD_REVIEW_ATK
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

function buildLiuyinExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const source = computeLiuyinSource({
    exSpecialCount: state.exSpecialCount,
    ultimateCount: state.ultimateCount,
    frontlineTime: state.frontlineTime,
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
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
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
      energyRecovery: 0,
      totalEnergyRecovery: 0,
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
      frontlineTime: state.frontlineTime,
      cinemaLevel: cfg.liuyinCinemaLevel ?? 0,
      extraAbilityActive: cfg.liuyinExtraAbilityActive ?? false,
      previousTeammateSlot: cfg.liuyinPreviousTeammateSlot ?? 0,
    }),
  }
}

function buildLiuyinResourceSections({ result }: AgentResourceSectionsInput) {
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
        { label: '转大次数', value: `+${fmt(source.promoteWindows)}`, detail: 'floor(好评总量 / 90)，每次满90好评抱拳转大' },
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
  buildExecutions: buildLiuyinExecutions,
  buildResourceResult: buildLiuyinResourceResult,
  resourceSections: buildLiuyinResourceSections,
  settings,
}
