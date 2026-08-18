import type {
  AgentMechanicModule,
  AgentCharConfigInput,
  AgentExSpecialTimeInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { BillyChain, CharacterResourceResult, MechanicSetting } from '@/types/resource'
import type { SkillMove } from '@/types/catalog'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import { specToMechanicModule } from '@/specs/mechanics'
import { fmt } from '@/utils/format'

export type { BillyChain }

/**
 * 星徽·比利（1531）战斗逻辑（用户确认口径，2026-08）：
 * - 命破/物理：物理伤害均为贯穿伤害（引擎按贯穿力基底 atk×0.3+hp×0.1+sheerForceFlat 无视防御结算）；
 *   HP→贯穿力 0.1/点 是被动对基底公式的复述，不额外转模。
 * - 决意（用户确认）：缓慢回复固定 2 点/秒 × 全战斗时间（接战状态 = 整场战斗，180×2=360）；
 *   招式命中获得量 = 各招式倍率表 attack_data_0 行值（普攻不细分段数，秒均折算 ≈ 4.0 点/秒）；
 *   额外回复：孤轮特技命中 +8（按孤轮总次数）、连携 +15、格挡 +5（主页交互 blockCount）、极限闪避 +3；
 *   决意只用于释放最高马力星光：100 决意 → 普通攻击：最高马力星光（1531010，3.1s 计入前台时间）。
 *   注意：不镜像般岳（般岳是嗔火释放山威免费强特 + 倾山；比利没有免费强特，孤轮是免费衔接而非强特）。
 * - 主循环（用户确认：平时时间基本就是动力压制+孤轮就结束了，玩家很少平A）：
 *   动力压制（特殊技，0 闪能，烧血 16% 生命上限）→ 孤轮特技（0 闪能，自动衔接）→ 结束（脱缰不建模）；
 *   链数 = 动力压制数 = 孤轮数，只受 HP 池约束（烧血），尽量多打。
 * - 付费强特（用户确认：摇曳和抓地都是 60 闪能强特，次数有限）：
 *   闪能池只支付摇曳步伐与抓地轮毂：摇曳链数 R + 抓地次数 K ≤ E = floor(闪能总量/60)；
 *   失衡期经常打抓地（轴内捏），整局摇曳次数比较低（rockingRatio 默认 0.1，滑块可调）；
 *   摇曳链 = 动力压制+孤轮+摇曳（120 闪能，回血 15%）；抓地独立施放（60 闪能，回血 30%）。
 * - HP 池（用户确认：动力压制必须烧血才能打、不是无限释放，回血总量决定释放次数）：
 *   动力压制 -16%/次（生命≤25% 无法发动），回血 = 抓地 30%/摇曳 15% + 普攻 attack_data_1 秒均；
 *   普攻第四段衔接耗血减半（16%→8%）滑块 1531.driveSuppressionHpDiscountRatio（默认 0%）；
 *   链数 ≤ floor((75 + 回血总量)/平均耗血)；失衡轴模式轴内按捏轴执行不裁剪，血量不足仅展示提示。
 * - 银河横行（用户确认：闪避次数关联银河横行）：闪避反击次数 = 动力压制期间漂移触发极限闪避次数，
 *   每次 = 尾焰全旋（1531014）执行 + 自动衔接孤轮特技；次数 = min(闪反数, 动力压制数)（轴外），
 *   轴内由捏轴决定（可自行捏 1531014）；通用闪避反击（决斗之王 1531013）执行禁用。
 * - 交互次数默认值（用户确认，主页「战斗动作次数」预填展示 = 帮用户填好，getInteractionDefaults 同源）：
 *   格挡 5 / 招架 4 / 闪反 0。
 * - 未建模：生命≤25% 受伤-50%（防御向，只关注打 boss 不建模）；伊德海莉无回血联动（用户确认：
 *   其烧血→喧响只接卢西娅星光汇聚之地，Billy 自我回血不接入）。
 */

const AGENT_ID = '1531'

// 招式 moveId（catalog 倍率表编号）
const MOVE = {
  driveSuppression: '1531006', // 特殊技：动力压制 104.8% / 决意 4.0 / 耗血 16%（免费衔接）
  runWild: '1531007', // 特殊技：脱缰 144.7% / 决意 2.1321（不建模，用户口径）
  coolWheelie: '1531008', // 强化特殊技：孤轮特技 780.2% / 决意 2.0654 / 0 闪能（动力压制自动衔接）
  tractionWheels: '1531009', // 强化特殊技：抓地轮毂 1860.5% / 决意 8.4014 / 60 闪能 / 回血 30%
  fullThrottle: '1531010', // 普通攻击：最高马力星光 2087.1% / 决意 0
  rockingFootwork: '1531011', // 强化特殊技：摇曳步伐 1918.2% / 决意 9.2014 / 60 闪能 / 回血 15%
  chain: '1531015', // 连携技：骑士漫步 1326.2% / 决意 4.5334
  ultimate: '1531016', // 终结技：骑士飞踢 3184.9% / 决意 6.332
  dodgeCounter: '1531013', // 闪避反击：决斗之王 239.4% / 决意 3.5347（银河横行口径下不单独生成执行）
  afterfireSpin: '1531014', // 闪避反击：尾焰全旋 397.8% / 决意 2.8（银河横行漂移触发）
  defensiveAssist: '1531018', // 招架支援：英雄登台 #1（轻弹刀） / 决意 2.6654
  assistFollowUp: '1531021', // 支援突击：反派退场 459.5% / 决意 3.1321
  quickAssist: '1531017', // 快速支援：星徽-羁绊之力 184.4% / 决意 1.7674
} as const

// 星辉增伤目标（[连携技]/[终结技]/[强化特殊技]/[普通攻击：最高马力星光]）
const STAR_GLOW_MOVE_IDS = new Set<string>([
  MOVE.coolWheelie,
  MOVE.tractionWheels,
  MOVE.rockingFootwork,
  MOVE.chain,
  MOVE.ultimate,
  MOVE.fullThrottle,
])
// 影画2 增伤目标（最高马力星光/孤轮特技/骑士飞踢）
const C2_DMG_MOVE_IDS = new Set<string>([MOVE.fullThrottle, MOVE.coolWheelie, MOVE.ultimate])
// 影画6 贯穿增伤目标（骑士飞踢/最高马力星光）
const C6_DMG_MOVE_IDS = new Set<string>([MOVE.ultimate, MOVE.fullThrottle])

// 核心被动：动力压制暴伤（Lv.1-7 = 45/53/60/68/75/83/90，等级随动按满级处理）
const CORE_CRIT_DMG = 90
// 影画4：动力压制每次暴伤 +8%，至多 2 层
const C4_CRIT_DMG_PER_STACK = 8
const C4_CRIT_DMG_MAX_STACKS = 2
// 影画1：18% 物理抗性无视
const C1_RES_IGNORE = 18
// 影画2：三招式 +50%
const C2_DMG_BONUS = 50
// 影画2 涡轮增压：孤轮特技暴伤 +50%
const C2_TURBO_CRIT_DMG = 50
// 影画6：骑士飞踢/最高马力星光贯穿伤害 +18%
const C6_DMG_BONUS = 18
// 星辉：每层 +20%，至多 2 层
const STAR_GLOW_PER_STACK = 20
const STAR_GLOW_MAX_STACKS = 2
// 煊赫星辉：6 层封顶，每次施放至多消耗 2 层，每层 100% 贯穿力附伤
const RADIANT_MAX_STACKS = 6
const RADIANT_MAX_CONSUME_PER_CAST = 2
const RADIANT_DMG_PER_STACK = 100
// 付费强特单次闪能消耗（摇曳步伐/抓地轮毂；孤轮与动力压制免费）
const EX_FLASH_COST = 60
// 进场闪能（核心被动；影画1 额外 +60）
const ENTRY_FLASH = 60
// 决意：缓慢回复固定 2 点/秒 × 全战斗时间（用户确认）
const DETERMINATION_REGEN_PER_SEC = 2
// 决意：额外回复（文本数值，用户确认）
const EX_EXTRA_DETERMINATION = 8 // 孤轮特技命中（按孤轮总次数）
const CHAIN_EXTRA_DETERMINATION = 15 // 连携技发动
const PARRY_EXTRA_DETERMINATION = 5 // 动力压制期间格挡
const DODGE_EXTRA_DETERMINATION = 3 // 极限闪避
// HP 池（用户确认：动力压制必须烧血才能打、不是无限释放）
const HP_COST_PER_DRIVE = 16 // 动力压制消耗 %生命上限
const HP_DISCOUNT_HALVED = 8 // 普攻第四段衔接：耗血减半（16%→8%）
const HP_FLOOR_LIMIT = 25 // 生命≤25% 无法发动动力压制（初始可耗 75%）
const HEAL_TRACTION = 30 // 抓地轮毂回血 %（文本数值，不在数据行）
const HEAL_ROCKING = 15 // 摇曳步伐回血 %（文本数值，不在数据行）

// 摇曳链占付费单位（摇曳+抓地池）的比例：用户确认整局摇曳次数比较低，默认 0.1
const DEFAULT_ROCKING_RATIO = 0.1
const DEFAULT_HP_DISCOUNT_RATIO = 0 // 默认没有动力压制经过普攻四段耗血降低

const specBase = specToMechanicModule(getAgentSpec(AGENT_ID)!)

/**
 * EX 链结构（用户确认口径）：
 * - 付费单位 E = floor(闪能总量/60)，只支付 摇曳步伐 与 抓地轮毂（孤轮/动力压制免费）；
 * - 摇曳链 R（= 摇曳步伐次数，需动力压制+孤轮前置，120 闪能/条）；抓地 K = E − R（60 闪能/次）；
 * - 动力压制链总数 chain = 动力压制次数 = 孤轮次数（0 闪能，只受 HP 池约束），HP 收敛在 buildExecutions 完成；
 * - 银河横行 galaxy = min(闪反数, 动力压制数)（轴外）。
 */
export function computeBillyChain(
  paidEx: number,
  rockingRatio: number,
  fullThrottle: number,
  axisEx?: Record<string, number>,
  axisActive?: boolean,
  dodgeCount = 0,
): BillyChain {
  const ex = Math.max(0, Math.floor(paidEx))
  const full = Math.max(0, Math.floor(fullThrottle))
  if (axisActive && axisEx) {
    // 失衡轴模式：轴内动作按捏轴执行（孤轮/动力压制免费；摇曳/抓地各 60 闪能），轴外剩余闪能打抓地
    const rocking = Math.max(0, Math.floor(axisEx[MOVE.rockingFootwork] ?? 0))
    const tractionIn = Math.max(0, Math.floor(axisEx[MOVE.tractionWheels] ?? 0))
    const chainIn = Math.max(
      Math.max(0, Math.floor(axisEx[MOVE.coolWheelie] ?? 0)),
      Math.max(0, Math.floor(axisEx[MOVE.driveSuppression] ?? 0)),
    )
    const inUnits = rocking + tractionIn // 轴内付费单位（摇曳+抓地）
    const tractionOut = Math.max(0, ex - inUnits)
    return {
      paidEx: ex,
      rocking,
      traction: tractionIn + tractionOut,
      tractionOut,
      chain: chainIn,
      galaxy: 0, // 轴内银河横行由捏轴决定（可自行捏 1531014），不额外派生
      fullThrottle: full,
      axisMode: true,
    }
  }
  const r = Math.max(0, Math.min(1, Number.isFinite(rockingRatio) ? rockingRatio : DEFAULT_ROCKING_RATIO))
  // 摇曳链数 = floor(付费单位 × 占比)（≤ E，因摇曳链 2 单位/条，实际最多 floor(E/2) 条由 K = E − R 兜底）
  const rocking = Math.min(Math.floor(ex / 2), Math.floor(ex * r))
  const traction = Math.max(0, ex - rocking)
  const galaxy = Math.max(0, Math.min(Math.max(0, Math.floor(dodgeCount)), ex))
  return {
    paidEx: ex,
    rocking,
    traction,
    tractionOut: traction,
    chain: 0, // HP 收敛后由 buildExecutions 填充（动力压制数）
    galaxy,
    fullThrottle: full,
    axisMode: false,
  }
}

/**
 * HP 池收敛（用户确认）：动力压制必须烧血才能打、不是无限释放，回血总量决定释放次数。
 * 链数 chain（= 动力压制数 = 孤轮数）≤ floor((75 + 回血总量)/平均耗血)；
 * 摇曳链受同一预算约束（≤ chain）；失衡轴模式轴内动力压制按捏轴执行不裁剪，轴外补足剩余预算。
 */
export function computeBillyHpModel(
  paidEx: number,
  rocking: number,
  traction: number,
  axisDriveSuppression = 0,
  discountRatio = 0,
  basicHealPct = 0,
): { chain: number; hpCostPct: number; healPct: number; hpFloorPct: number } {
  const ratio = Math.max(0, Math.min(1, Number.isFinite(discountRatio) ? discountRatio : DEFAULT_HP_DISCOUNT_RATIO))
  const avgCost = HP_COST_PER_DRIVE - (HP_COST_PER_DRIVE - HP_DISCOUNT_HALVED) * ratio
  let r = Math.max(0, Math.floor(rocking))
  let k = Math.max(0, Math.floor(traction))
  let chain = Math.max(0, Math.floor(axisDriveSuppression))
  for (let iter = 0; iter < 8; iter++) {
    const healPct = k * HEAL_TRACTION + r * HEAL_ROCKING + basicHealPct
    // 初始可耗 75%（100 − 25 下限）+ 回血总量，除以平均单次耗血
    const budget = Math.floor(((100 - HP_FLOOR_LIMIT) + healPct) / avgCost)
    const nextR = Math.min(r, budget) // 摇曳链也是链，受同一预算约束
    if (nextR !== r) {
      // 摇曳链超预算时减少，多出的闪能转抓地
      r = nextR
      k = Math.max(0, Math.floor(paidEx) - r)
    }
    const nextChain = chain >= Math.floor(axisDriveSuppression)
      ? Math.max(chain, budget) // 轴模式：轴内不裁剪，预算不足仅展示
      : Math.max(chain, budget)
    if (nextChain === chain) break
    chain = nextChain
  }
  const hpCostPct = avgCost * chain
  const healPct = k * HEAL_TRACTION + r * HEAL_ROCKING + basicHealPct
  const hpFloorPct = Math.max(0, Math.min(100, 100 - hpCostPct + healPct))
  return { chain, hpCostPct, healPct, hpFloorPct }
}

function cfgNum(cfg: AgentCharConfigInput['cfg'], key: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const raw = Number(record[`setting:${key}`] ?? fallback)
  return Number.isFinite(raw) ? raw : fallback
}

function findMoveById(skills: { categories: { moves: SkillMove[] }[] } | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const cat of skills.categories) {
    for (const m of cat.moves) {
      if (m.id === moveId) return m
    }
  }
  return null
}

function rowValue(move: SkillMove | null, rowId: string): number {
  if (!move) return 0
  const row = move.rows.find(r => r.id === rowId)
  return row?.values?.[0] ?? 0
}

function readAxisEx(cfg: AgentCharConfigInput['cfg']): Record<string, number> {
  const record = cfg as unknown as Record<string, unknown>
  const raw = (record.billyAxisEx ?? {}) as Record<string, number>
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    const n = Math.max(0, Math.floor(Number(v) || 0))
    if (n > 0) out[k] = n
  }
  return out
}

function buildBillyCharConfig({ skills, cinemaLevel, cfg }: AgentCharConfigInput): void {
  specBase.buildCharConfig?.({ skills, cinemaLevel, cfg } as AgentCharConfigInput)

  // 进场闪能：核心被动 60（勘域模式 180s 一次，整局口径一次）+ 影画1 额外 60
  cfg.initialEnergyGift = ENTRY_FLASH + (cinemaLevel >= 1 ? ENTRY_FLASH : 0)
  // 付费强特（摇曳/抓地）由闪能池驱动：state.exSpecialCount = floor(闪能总量/60) = 付费单位 E
  cfg.skipGenericExSpecial = true
  cfg.exSpecialCountFloor = true
  cfg.exSpecialEnergyConsume = EX_FLASH_COST

  const record = cfg as unknown as Record<string, unknown>
  record.billyCinemaLevel = cinemaLevel

  // 交互次数默认值（用户确认，主页「战斗动作次数」预填展示，与 getInteractionDefaults 一致）：格挡 5 / 招架 4 / 闪反 0
  if (!cfg.parryCount) cfg.parryCount = 4
  if (!cfg.blockCount) cfg.blockCount = 5
  // 闪避次数 = 银河横行漂移触发（用户确认）：禁用通用闪避反击（决斗之王）执行，
  // 由模块生成 尾焰全旋（1531014）→ 衔接孤轮特技；喧响按尾焰全旋行值（银河横行数 ≤ 闪反数，略高估可接受）
  cfg.dodgeCounterActionTime = 0
  cfg.dodgeCounterDecibelRecovery = rowValue(findMoveById(skills, MOVE.afterfireSpin), 'decibel_recovery')

  // 预存倍率/动作时间/喧响回复/attack_data_0/attack_data_1（供 buildExecutions / estimateExSpecialTime / 决意 / 回血 / 喧响折算），键 = moveId
  const times: Record<string, number> = {}
  const dmg: Record<string, number> = {}
  const decibel: Record<string, number> = {}
  const attackData0: Record<string, number> = {}
  const attackData1: Record<string, number> = {}
  for (const [, id] of Object.entries(MOVE)) {
    const mv = findMoveById(skills, id)
    times[id] = mv?.actionTime ?? 0
    dmg[id] = rowValue(mv, 'damage')
    decibel[id] = rowValue(mv, 'decibel_recovery')
    attackData0[id] = rowValue(mv, 'attack_data_0')
    attackData1[id] = rowValue(mv, 'attack_data_1')
  }
  record.billyMoveTimes = times
  record.billyMoveDmg = dmg
  record.billyMoveDecibel = decibel
  record.billyAttackData0 = attackData0
  record.billyAttackData1 = attackData1
  cfg.billyMoveTimes = times
  cfg.billyMoveDmg = dmg
  cfg.billyMoveDecibel = decibel

  // 普攻秒均折算（用户确认：普攻不细分段数，秒均倍率 × 时间，与伤害同款模型）：
  // 决意 = attack_data_0 四段总和 ÷ 四段 actionTime 总和；回血 = attack_data_1 同上
  const BASIC_MOVE_IDS = ['1531001', '1531002', '1531003', '1531004']
  let basicAtk0Sum = 0
  let basicAtk1Sum = 0
  let basicTimeSum = 0
  for (const id of BASIC_MOVE_IDS) {
    const mv = findMoveById(skills, id)
    basicAtk0Sum += rowValue(mv, 'attack_data_0')
    basicAtk1Sum += rowValue(mv, 'attack_data_1')
    basicTimeSum += mv?.actionTime ?? 0
  }
  const basicDeterminationPerSec = basicTimeSum > 0 ? basicAtk0Sum / basicTimeSum : 0
  const basicHealPerSec = basicTimeSum > 0 ? basicAtk1Sum / basicTimeSum : 0
  record.billyBasicDeterminationPerSec = basicDeterminationPerSec
  record.billyBasicHealPerSec = basicHealPerSec
  cfg.billyBasicDeterminationPerSec = basicDeterminationPerSec
  cfg.billyBasicHealPerSec = basicHealPerSec

  // 喧响折算：付费强特 E 次 × 加权单次喧响（摇曳链 = 动力压制+孤轮+摇曳；抓地轮毂独立）
  const rockingRatio = cfgNum(cfg, '1531.rockingRatio', DEFAULT_ROCKING_RATIO)
  const avgDecibel = rockingRatio
    * (decibel[MOVE.driveSuppression] + decibel[MOVE.coolWheelie] + decibel[MOVE.rockingFootwork])
    + (1 - rockingRatio) * decibel[MOVE.tractionWheels]
  cfg.exSpecialDecibelRecovery = avgDecibel
}

function billyExSpecialTime({ cfg, exSpecialCount }: AgentExSpecialTimeInput): { necessaryTime: number; comboAlignTime: number } {
  const record = cfg as unknown as Record<string, unknown>
  const times = (record.billyMoveTimes ?? {}) as Record<string, number>
  const axisActive = Number(record.billyAxisActive ?? 0) === 1
  const chain = computeBillyChain(
    exSpecialCount,
    cfgNum(cfg, '1531.rockingRatio', DEFAULT_ROCKING_RATIO),
    Number(record.billyFullThrottleCount ?? 0),
    readAxisEx(cfg),
    axisActive,
    cfg.dodgeCounterCount ?? 0,
  )
  // 动力压制链数用上一轮 HP 收敛值（初始 0，不动点收敛）
  const chainFinal = axisActive
    ? chain.chain
    : Number(record.billyChainCount ?? 0)
  // 必做前台时间：动力压制+孤轮（链）+ 摇曳/抓地 + 银河横行（尾焰全旋+衔接孤轮）+ 最高马力星光（3.1s/次，上一轮收敛值）
  const exTime = chainFinal * ((times[MOVE.driveSuppression] ?? 0) + (times[MOVE.coolWheelie] ?? 0))
    + chain.rocking * (times[MOVE.rockingFootwork] ?? 0)
    + chain.traction * (times[MOVE.tractionWheels] ?? 0)
    + chain.galaxy * (times[MOVE.afterfireSpin] ?? 0)
  const fullThrottleTime = chain.fullThrottle * (times[MOVE.fullThrottle] ?? 0)
  return { necessaryTime: exTime + fullThrottleTime, comboAlignTime: 0 }
}

function pushChainExec(
  executions: CharacterResourceResult['executions'],
  moveId: string,
  moveName: string,
  count: number,
  times: Record<string, number>,
  dmg: Record<string, number>,
  decibel: Record<string, number>,
  energyConsume: number,
  note: string,
): void {
  if (count <= 0) return
  executions.push({
    moveId,
    moveName,
    category: moveId === MOVE.fullThrottle ? 'basic' : 'special',
    count,
    actionTime: times[moveId] ?? 0,
    comboAlignRatio: 0,
    totalTime: (times[moveId] ?? 0) * count,
    totalComboAlignTime: 0,
    energyConsume,
    totalEnergyConsume: energyConsume * count,
    decibelRecovery: decibel[moveId] ?? 0,
    totalDecibelRecovery: (decibel[moveId] ?? 0) * count,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    damageMultiplier: dmg[moveId] ?? 0,
    damageMultiplierOverride: true,
    skillTableNote: note,
  })
}

/** 招式命中决意合计 = Σ(执行次数 × attack_data_0)，平A按秒均折算（用户确认口径） */
function computeAttackDataDetermination(
  chain: BillyChain,
  state: { chainCountTotal: number; ultimateCount: number; dodgeCounterCount: number; basicAttackTime: number },
  cfg: AgentCharConfigInput['cfg'],
  parryCount: number,
  quickAssistCount: number,
): number {
  const record = cfg as unknown as Record<string, unknown>
  const atk0 = (record.billyAttackData0 ?? {}) as Record<string, number>
  const atk = (id: string) => atk0[id] ?? 0
  return Math.max(0,
    chain.chain * atk(MOVE.driveSuppression)
    + chain.chain * atk(MOVE.coolWheelie)
    + chain.rocking * atk(MOVE.rockingFootwork)
    + chain.traction * atk(MOVE.tractionWheels)
    + chain.galaxy * atk(MOVE.afterfireSpin)
    + Math.max(0, state.chainCountTotal) * atk(MOVE.chain)
    + Math.max(0, state.ultimateCount) * atk(MOVE.ultimate)
    + Math.max(0, state.dodgeCounterCount) * atk(MOVE.dodgeCounter)
    + parryCount * atk(MOVE.defensiveAssist)
    + parryCount * atk(MOVE.assistFollowUp)
    + quickAssistCount * atk(MOVE.quickAssist)
    + Math.max(0, state.basicAttackTime) * Number(record.billyBasicDeterminationPerSec ?? 0),
  )
}

/** 普攻命中回血总量 = attack_data_1 秒均 × 平A时间（用户确认：回血百分比 = attack_data_1） */
function computeBasicHealPct(
  state: { basicAttackTime: number },
  cfg: AgentCharConfigInput['cfg'],
): number {
  const record = cfg as unknown as Record<string, unknown>
  return Math.max(0, state.basicAttackTime) * Number(record.billyBasicHealPerSec ?? 0)
}

function buildBillyExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinemaLevel = Math.max(0, Math.floor(Number(record.billyCinemaLevel ?? 0)))
  const times = (record.billyMoveTimes ?? {}) as Record<string, number>
  const dmg = (record.billyMoveDmg ?? {}) as Record<string, number>
  const decibel = (record.billyMoveDecibel ?? {}) as Record<string, number>
  const axisActive = Number(record.billyAxisActive ?? 0) === 1
  const axisEx = readAxisEx(cfg)

  // EX 链结构（摇曳/抓地由闪能池定；动力压制链由 HP 池收敛）
  let chain = computeBillyChain(
    state.exSpecialCount,
    cfgNum(cfg, '1531.rockingRatio', DEFAULT_ROCKING_RATIO),
    Number(record.billyFullThrottleCount ?? 0),
    axisEx,
    axisActive,
    cfg.dodgeCounterCount ?? 0,
  )
  const hpDiscountRatio = cfgNum(cfg, '1531.driveSuppressionHpDiscountRatio', DEFAULT_HP_DISCOUNT_RATIO)
  const hp = computeBillyHpModel(
    state.exSpecialCount,
    chain.rocking,
    chain.traction,
    axisActive ? chain.chain : 0,
    hpDiscountRatio,
    computeBasicHealPct(state, cfg),
  )
  const galaxyFinal = axisActive ? 0 : Math.min(chain.galaxy, hp.chain)
  chain = {
    ...chain,
    chain: hp.chain,
    galaxy: galaxyFinal,
  }
  record.billyChainCount = hp.chain // 供 estimateExSpecialTime 下一轮计时间（收敛）
  record.billyChainHp = { hpCostPct: hp.hpCostPct, healPct: hp.healPct, hpFloorPct: hp.hpFloorPct, discountRatio: hpDiscountRatio }

  // 决意：招式命中（attack_data_0）+ 孤轮特技额外 +8（按孤轮总次数）写入 cfg，
  // spec 解释器按 cfgField 计入；随后 spec 事件生成最高马力星光
  record.billyAttackDataDetermination = computeAttackDataDetermination(
    chain,
    { chainCountTotal: state.chainCountTotal, ultimateCount: state.ultimateCount, dodgeCounterCount: cfg.dodgeCounterCount ?? 0, basicAttackTime: state.basicAttackTime },
    cfg,
    cfg.parryCount ?? 0,
    cfg.quickAssistCount ?? 0,
  )
  record.billyExExtraDetermination = chain.chain * EX_EXTRA_DETERMINATION
  record.billyCoolWheelieCount = chain.chain // 星辉/煊赫星辉的孤轮来源（含免费衔接的孤轮）
  specBase.buildExecutions?.({ cfg, state, executions })
  const resources = computeSpecResources(getAgentSpec(AGENT_ID)!, cfg, state)
  const fullThrottle = Math.max(0, Math.floor(resources.get('billy_determination')?.spendCounts['billy_max_power_spend'] ?? 0))
  record.billyFullThrottleCount = fullThrottle
  chain = { ...chain, fullThrottle }

  // 主循环执行：动力压制 → 孤轮特技（免费衔接），摇曳/抓地为付费强特，尾焰全旋为银河横行
  pushChainExec(executions, MOVE.driveSuppression, '特殊技：动力压制', chain.chain, times, dmg, decibel, 0,
    `动力压制 ×${chain.chain}：${fmt(dmg[MOVE.driveSuppression] ?? 0, 1)}%（耗 16% 生命上限，HP 池约束），自动衔接孤轮特技`)
  // 涡轮增压（影画2，用户口径：有限次数）：获得 = 摇曳发动 + 抓地发动 + 失衡动力压制命中（至多 1 层），
  // 消耗 = 动力压制 → 该次衔接的孤轮特技暴伤 +50%；buffed 孤轮数 = min(获得, 动力压制数)
  const turboGain = cinemaLevel >= 2
    ? chain.rocking + chain.traction + (axisActive ? chain.chain : Math.round(chain.chain * Math.max(0, Math.min(1, Number(cfg.billyStunCoverage ?? 0)))))
    : 0
  const turboBuffed = Math.max(0, Math.min(chain.chain, turboGain))
  pushChainExec(executions, MOVE.coolWheelie, '强化特殊技：孤轮特技（涡轮增压）', turboBuffed, times, dmg, decibel, 0,
    `孤轮特技 ×${turboBuffed}：${fmt(dmg[MOVE.coolWheelie] ?? 0, 1)}%（涡轮增压：摇曳/抓地/失衡动力压制获得，消耗后暴伤 +50%；命中回 8 决意）`)
  if (turboBuffed > 0) {
    const buffed = executions[executions.length - 1]
    buffed.critDmgBonus = (buffed.critDmgBonus ?? 0) + C2_TURBO_CRIT_DMG
  }
  pushChainExec(executions, MOVE.coolWheelie, '强化特殊技：孤轮特技', chain.chain - turboBuffed, times, dmg, decibel, 0,
    `孤轮特技 ×${chain.chain - turboBuffed}：${fmt(dmg[MOVE.coolWheelie] ?? 0, 1)}%（动力压制自动衔接，0 闪能；命中回 8 决意）`)
  pushChainExec(executions, MOVE.rockingFootwork, '强化特殊技：摇曳步伐', chain.rocking, times, dmg, decibel, EX_FLASH_COST,
    `摇曳步伐 ×${chain.rocking}：${fmt(dmg[MOVE.rockingFootwork] ?? 0, 1)}%，60 闪能/次（回 15% 生命上限）`)
  pushChainExec(executions, MOVE.tractionWheels, '强化特殊技：抓地轮毂', chain.traction, times, dmg, decibel, EX_FLASH_COST,
    `抓地轮毂 ×${chain.traction}：${fmt(dmg[MOVE.tractionWheels] ?? 0, 1)}%，60 闪能/次（回 30% 生命上限）`)
  pushChainExec(executions, MOVE.afterfireSpin, '闪避反击：尾焰全旋（银河横行）', chain.galaxy, times, dmg, decibel, 0,
    `尾焰全旋 ×${chain.galaxy}：${fmt(dmg[MOVE.afterfireSpin] ?? 0, 1)}%（动力压制期间漂移触发极限闪避，自动衔接孤轮特技）`)

  // 影画6：煊赫星辉附伤（合并一次执行；消耗层数 ≤ 2 × (终结技 + 最高马力星光) 次数）
  if (cinemaLevel >= 6) {
    const radiant = resources.get('billy_radiant_star')
    const layers = Math.min(RADIANT_MAX_STACKS, Math.floor(radiant?.total ?? 0))
    const consumable = Math.min(
      layers,
      Math.max(0, Math.floor(radiant?.spendCounts['billy_radiant_spend'] ?? 0)),
      RADIANT_MAX_CONSUME_PER_CAST * (Math.max(0, Math.floor(state.ultimateCount)) + fullThrottle),
    )
    if (consumable > 0) {
      executions.push({
        moveId: '1531_c6_radiant', // 非倍率表行：纯附伤，不进入失衡/异常积蓄池
        moveName: '6命附伤（煊赫星辉）',
        category: 'basic',
        count: 1,
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
        damageMultiplier: consumable * RADIANT_DMG_PER_STACK,
        damageMultiplierOverride: true,
        element: 'physical',
        skillTableNote: `煊赫星辉：消耗 ${consumable} 层（上限 6 层，≤2 层/次），最后一击附伤 = ${consumable} × 100% 贯穿力物理伤害`,
      })
    }
  }
}

function patchBillyExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinemaLevel = Math.max(0, Math.floor(Number(record.billyCinemaLevel ?? 0)))
  const spec = getAgentSpec(AGENT_ID)!
  const resources = computeSpecResources(spec, cfg, state)

  // 星辉：额外能力触发（队伍有击破/防护/支援，panel.additionalAbilityActive）才生效；
  // 2 层封顶，仅作用于 连携/终结/强化特殊技/最高马力星光 六个目标招式
  if ((cfg.panel?.additionalAbilityActive ?? 0) === 1) {
    const starTotal = Math.floor(resources.get('billy_star_glow')?.total ?? 0)
    const stacks = Math.min(STAR_GLOW_MAX_STACKS, starTotal)
    if (stacks > 0) {
      for (const exec of executions) {
        if (exec.moveId && STAR_GLOW_MOVE_IDS.has(exec.moveId)) {
          exec.dmgBonus = (exec.dmgBonus ?? 0) + stacks * STAR_GLOW_PER_STACK
        }
      }
    }
  }

  // 影画2：最高马力星光/孤轮特技/骑士飞踢 伤害 +50%（招式限定普通增伤，用户确认）；
  // 涡轮增压暴伤已由 buildExecutions 按有限次数拆分为 buffed 孤轮执行
  if (cinemaLevel >= 2) {
    for (const exec of executions) {
      if (exec.moveId && C2_DMG_MOVE_IDS.has(exec.moveId)) {
        exec.dmgBonus = (exec.dmgBonus ?? 0) + C2_DMG_BONUS
      }
    }
  }

  // 影画6：骑士飞踢/最高马力星光 贯穿伤害 +18%（招式限定贯穿增伤，进贯穿增伤乘区，用户确认）
  if (cinemaLevel >= 6) {
    for (const exec of executions) {
      if (exec.moveId && C6_DMG_MOVE_IDS.has(exec.moveId)) {
        exec.sheerDmgBonus = (exec.sheerDmgBonus ?? 0) + C6_DMG_BONUS
      }
    }
  }
}

function buildBillyResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const record = cfg as unknown as Record<string, unknown>
  const resources = computeSpecResources(getAgentSpec(AGENT_ID)!, cfg, state)
  const axisActive = Number(record.billyAxisActive ?? 0) === 1
  const chain = computeBillyChain(
    state.exSpecialCount,
    cfgNum(cfg, '1531.rockingRatio', DEFAULT_ROCKING_RATIO),
    Math.max(0, Math.floor(resources.get('billy_determination')?.spendCounts['billy_max_power_spend'] ?? 0)),
    readAxisEx(cfg),
    axisActive,
    cfg.dodgeCounterCount ?? 0,
  )
  const hp = (record.billyChainHp ?? {}) as { hpCostPct?: number; healPct?: number; hpFloorPct?: number; discountRatio?: number }
  return {
    specResources: Object.fromEntries(resources),
    billyChain: {
      ...chain,
      chain: Number(record.billyChainCount ?? 0),
      galaxy: axisActive ? 0 : Math.min(chain.galaxy, Number(record.billyChainCount ?? 0)),
      hpCostPct: Number(hp.hpCostPct ?? 0),
      healPct: Number(hp.healPct ?? 0),
      hpFloorPct: Number(hp.hpFloorPct ?? 100),
      hpDiscountRatio: Number(hp.discountRatio ?? 0),
    },
  }
}

function buildBillyResourceSections({ result }: AgentResourceSectionsInput) {
  const chain = result.billyChain
  const sections = specBase.resourceSections?.({ result }) ?? []
  if (!chain) return sections
  sections.push({
    id: 'billy-ex-chain',
    title: '星徽·比利·主循环（动力压制→孤轮）',
    summary: chain.axisMode
      ? `轴内捏轴 · 动力压制链 ${chain.chain} · 轴内摇曳 ${chain.rocking} · 轴外抓地 ${chain.tractionOut}`
      : `动力压制链 ${chain.chain} · 摇曳 ${chain.rocking} · 抓地 ${chain.traction}`,
    rows: [
      { label: '动力压制→孤轮', value: String(chain.chain), detail: '0 闪能，烧血 -16%/次（HP 池约束）；孤轮命中回 8 决意' },
      { label: '摇曳步伐', value: String(chain.rocking), detail: '60 闪能/次，回 15% 生命上限（整局次数低）' },
      { label: '抓地轮毂', value: String(chain.traction), detail: `60 闪能/次，回 30% 生命上限${chain.axisMode ? `（轴内 ${Math.max(0, chain.traction - chain.tractionOut)} + 轴外 ${chain.tractionOut}）` : ''}` },
      { label: '银河横行（尾焰全旋）', value: String(chain.galaxy), detail: '动力压制期间漂移触发极限闪避 → 尾焰全旋 → 衔接孤轮特技' },
      { label: '最高马力星光', value: String(chain.fullThrottle), detail: '100 决意/次，2087.1%（3.1s 计入前台时间）' },
      { label: '生命值', value: `${fmt(chain.hpFloorPct ?? 100, 0)}%`, detail: `消耗 ${fmt(chain.hpCostPct ?? 0, 0)}% · 回血 ${fmt(chain.healPct ?? 0, 0)}%（抓地30/摇曳15/普攻 attack_data_1）${(chain.hpDiscountRatio ?? 0) > 0 ? ` · 普攻四段衔接折扣 ${fmt((chain.hpDiscountRatio ?? 0) * 100, 0)}%` : ''}` },
    ],
    footer: chain.axisMode
      ? '失衡轴模式：轴内动作按捏轴执行（HP 不足仅提示不裁剪）；轴外剩余闪能打抓地，轴外动力压制链照常（HP 预算补足）。'
      : '平时时间基本就是动力压制+孤轮（HP 预算自动算满，玩家很少平A）；付费强特 = 摇曳/抓地（60 闪能），摇曳占比滑块可调。',
  })
  return sections
}

const settings: MechanicSetting[] = [
  {
    id: '1531.rockingRatio',
    label: '星徽·比利·摇曳步伐占比（付费强特）',
    description: '付费强特（摇曳/抓地，60 闪能/次）中打摇曳链（动力压制→孤轮→摇曳）的比例；用户确认整局摇曳次数比较低，默认 10%；失衡轴模式轴内按捏轴、此滑块不生效。',
    default: DEFAULT_ROCKING_RATIO,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: '1531.driveSuppressionCritDmgCoverage',
    label: '星徽·比利·动力压制暴伤覆盖率（核心被动）',
    description: '接战状态下每次动力压制后自身暴伤 +90%（Lv.7，45s 刷新）的覆盖率；默认 100%。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: '1531.c4CritDmgCoverage',
    label: '星徽·比利·审判底火暴伤覆盖率（影画4）',
    description: '每次动力压制后自身暴伤 +8%（至多 2 层 = 16%，45s 刷新）的覆盖率；默认 100%。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: '1531.c1ResIgnoreCoverage',
    label: '星徽·比利·物理抗性无视覆盖率（影画1）',
    description: '强化特殊技命中后自身攻击无视 18% 物理抗性（45s 刷新）的覆盖率；默认 100%。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: '1531.driveSuppressionHpDiscountRatio',
    label: '星徽·比利·动力压制耗血折扣占比（普攻第四段衔接）',
    description: '从普攻第四段衔接发动的动力压制耗血减半（16%→8%，普攻技能文本），询问有多少次动力压制经过该降低；默认 0%。',
    default: DEFAULT_HP_DISCOUNT_RATIO,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
]

export const starlightBillyMechanic: AgentMechanicModule = {
  id: 'agent:starlight_billy',
  agentIds: [AGENT_ID],
  name: '星徽·比利',
  description: '主循环（动力压制→孤轮，烧血刷决意）、HP 池约束、付费强特（摇曳/抓地 60 闪能）、决意→最高马力星光、星辉、影画1/2/4/6。',
  applyPanel: input => specBase.applyPanel?.(input),
  buildCharConfig: buildBillyCharConfig,
  estimateExSpecialTime: billyExSpecialTime,
  buildExecutions: buildBillyExecutions,
  patchExecutions: patchBillyExecutions,
  buildResourceResult: buildBillyResourceResult,
  resourceSections: buildBillyResourceSections,
  buildAnomalyEvents: input => specBase.buildAnomalyEvents?.(input),
  combos: {
    'billy-ex-chain': {
      label: '动力压制链（动力压制→孤轮特技→摇曳步伐）',
      energyCost: EX_FLASH_COST, // 只有摇曳步伐付费（动力压制/孤轮免费衔接）
      moves: [
        { moveId: MOVE.driveSuppression, count: 1 },
        { moveId: MOVE.coolWheelie, count: 1 },
        { moveId: MOVE.rockingFootwork, count: 1 },
      ],
    },
  },
  settings,
}
