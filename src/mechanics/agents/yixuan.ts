import type { AgentMechanicModule, AgentCharConfigInput, AgentPanelInput, AgentResourceInput, AgentResourceResultInput, AgentResourceSectionsInput } from '../types'
import type { CharacterResourceResult, MechanicSetting, YixuanExChain } from '@/types/resource'
import type { SkillMove } from '@/types/catalog'
import { getAgentSpec } from '@/specs/registry'
import { specToMechanicModule } from '@/specs/mechanics'
import { computeSpecResources } from '@/specs/resources'
import { fmt } from '@/utils/format'

/**
 * 仪玄·云岿山（1371）战斗逻辑（用户确认口径）：
 * - 命破/以太：全部伤害走引擎命破基底（贯穿力 atk×0.3+hp×0.1+sheerForceFlat、无视防御），
 *   核心被动 HP→贯穿力 0.1/点只是复述基底，不额外转模。
 * - 进场闪能 120（用户确认）；其他闪能回复（文本明确）：完美格挡+10/次、极限闪避+5/次、
 *   额外能力·队友终结技+20/次（iterate 补算）、影画1落雷+5/次（6s CD 战斗时间驱动）、
 *   玄墨异常触发+10/次（10s CD，外层收敛反馈注入 cfg.yixuanAnomalyTriggerFlash）。
 * - 强特链（用户确认口径，主页交互栏填写次数）：
 *   2连墨痕化形（#1 40闪能 → #3 免费）= 40 闪能/次；
 *   3连墨痕化形（#1 → #3 → #4 20闪能）= 60 闪能/次；
 *   完美格挡次数（#2 赠送招式，免费，回 10 闪能/次）；
 *   3连/完美格挡 ≤0 = 自动（2026-08 用户口径）：完美格挡 = 弹刀次数（全完美）；
 *   总闪能先打完失衡内（轴内凝云等）消耗，剩余闪能全部轴外打 3 连墨痕化形 → 轴外凝云清零；
 *   影画4 静心（增伤载体=凝云/墨烬影消）：自动口径下留 1 轮凝云（60 闪能）当载体，不归零。
 *   手填 ≥1 覆盖自动值（此时剩余闪能用于凝云术链：墨烬影消 20 → 凝云术蓄力 0-2s/0-40 耗能/倍率随时间），
 *   轴外凝云默认满蓄 2s（秒均折算）；失衡轴内凝云次数/时长由轴决定（可延长缩短：轴 action 的
 *   duration 字段覆盖倍率表 actionTime，模块按秒均折算倍率/耗能/daze）。
 * - 失衡强特增伤（额外能力·玄墨暗涌）：凝云术/墨烬影消命中失衡敌人伤害+30%——
 *   轴模式读取失衡轴内强特（轴内行直接 +30）；非轴模式已弃用（默认 0，滑块兜底自调）。
 * - 凝神（额外能力）：发动终结技后 15s 暴伤+40%——非 6 命轴模式用失衡 buff 轴扫描（般岳明王模式，
 *   大招块触发后 15s 窗口内动作加权暴伤），非轴模式已弃用（默认 0，滑块兜底自调）；
 *   6 命因调息赠送大量符法千重，凝神（暴伤+40% + 贯穿+20%）默认满覆盖（用户口径，不走轴扫描），
 *   yixuan.c6NingshenCoverage 滑块可调（默认 100%），pushDirect 按执行折算。
 * - 极限支援换场落雷（额外能力）：225% 贯穿力 + 5 闪能/次，默认次数 = 队友正常弹刀次数求和
 *   （上限），主页可录入（用户口径）。
 * - 玄墨异常独立积蓄槽：所有执行 element = 'ether_ink'（anomalyPool VARIANT_ELEMENT_TO_BASE
 *   已注册变种，独立分桶、与以太互紊；直伤元素仍走倍率表 ether，不受影响）。
 * - 核心被动 Lv.7 招式限定增伤 60%（用户确认）：patchExecutions moveId 级 dmgBonus。
 * - 墨影凝云合轴（用户口径）：主页输入合轴次数 N；玄墨值 M（= 符法千重总次数）会把合轴招式替换为
 *   玄墨极阵(1371021)+青溟震击(1371007)：min(N, M) 次打玄墨极阵+青溟震击（吃核心被动60%），
 *   超出部分 max(0, N−M) 次打墨影凝云(1371005)+霄云劲#5(1371006)；全部 actionTime=0（合轴不占战场时间）。
 * - 术法值/玄墨值资源由 spec 解释（specBase）承载；玄墨极阵执行由本模块按合轴逻辑生成（spec 不再生成）。
 * - 术法值驱动的符法千重次数（用户口径，资源利用率页文本框 yixuan.shufaUltCount）：默认 -1 = 自动
 *   = 全部（术法值理论可打次数 floor(术法值/120)）；手动填则封顶于理论可打次数；
 *   下游玄墨值/合轴/聚墨/静心按实际次数结算。
 * - 影画2/4/6 已实现（见下方常量与 spec notes）。
 */

const AGENT_ID = '1371'
const specBase = specToMechanicModule(getAgentSpec(AGENT_ID)!)

// 招式 moveId（catalog 倍率表行）
const MOVE = {
  ink1: '1371009', // 强化特殊技：墨痕化形 #1 600.6% / 40闪能 / 1.083s
  ink2: '1371024', // 强化特殊技：墨痕化形 #2 299.2% / 完美格挡赠送（免费） / 0.2s
  ink3: '1371023', // 强化特殊技：墨痕化形 #3 741.3% / 免费（跟随#1） / 1.567s
  ink4: '1371025', // 强化特殊技：墨痕化形 #4 853.2% / 20闪能（跟随#3） / 0.966s
  cloud: '1371022', // 强化特殊技：凝云术 1343.9%（满蓄）/ 40闪能（满蓄）/ 2s 满蓄，倍率随时间
  ashen: '1371026', // 强化特殊技：墨烬影消 468.6% / 20闪能（凝云术前置） / 0.3s
  extraUlt: '1371020', // 终结技：符法千重（术法值/调息赠送）
} as const

// 影画2·符法千重-破（聚墨消耗，倍率行被隐藏；数值为用户提供）
const C2_PO_MOVE_ID = '1371_fufa_po'

// 用户确认数值
const ENTRY_FLASH = 120 // 进场恢复全部闪能（= flashEnergyMax）
const INK1_COST = 40 // 墨痕化形 #1
const INK4_COST = 20 // 墨痕化形 #4
const INK2_COST = 40 // 2连墨痕化形（#1+#3）= 40 闪能
const INK3_COST = 60 // 3连墨痕化形（#1+#3+#4）= 60 闪能
const ASHEN_COST = 20 // 墨烬影消（凝云术前置）
const CLOUD_MAX_COST = 40 // 凝云术满蓄耗能
const CLOUD_MAX_SECONDS = 2 // 凝云术满蓄时长
const CLOUD_CYCLE_COST = 60 // 凝云术链满状态（墨烬影消 20 + 凝云满蓄 40）
const INK2_SECONDS = 0.2 // 墨痕化形 #2（完美格挡赠送）
const INK2_CHAIN_SECONDS = 1.083 + 1.567 // #1+#3 = 2.65s
const ASHEN_SECONDS = 0.3 // 墨烬影消动作时间
const CORE_DMG_BONUS = 60 // 核心被动 Lv.7 招式限定增伤
const STUN_EX_BONUS = 30 // 额外能力：凝云术/墨烬影消命中失衡敌人伤害+30%
const NINGSHEN_CRIT_DMG = 40 // 额外能力：终结技后凝神 15s 暴伤+40%
const NINGSHEN_SECONDS = 15 // 凝神持续
const ANOMALY_TRIGGER_FLASH = 10 // 玄墨异常触发回闪能（10s 最多一次）
const ANOMALY_TRIGGER_MAX = Math.floor(180 / 10) // 10s CD 封顶次数（180s 战斗）

// 核心被动 Lv.7 增伤目标 moveId（用户确认招式限定范围）
const CORE_DMG_MOVE_IDS = new Set<string>([
  MOVE.ink1, MOVE.ink2, MOVE.ink3, MOVE.ink4, MOVE.cloud, MOVE.ashen,
  '1371021', // 普通攻击：玄墨极阵
  '1371007', // 普通攻击：青溟震击
  '1371019', // 支援突击：霄云迅击
  '1371013', // 连携技：玄墨迅击
  '1371014', // 终结技：青溟云影
  '1371020', // 终结技：符法千重（术法值事件）
  C2_PO_MOVE_ID, // 强化特殊技：符法千重-破（影画2·聚墨）
])

// 影画2 减抗目标（[终结技]或[强化特殊技]）：终/强特全部行 + 符法千重-破
const C2_RES_IGNORE_MOVE_IDS = new Set<string>([
  '1371014', '1371020', // 终结技
  MOVE.ink1, MOVE.ink2, MOVE.ink3, MOVE.ink4, MOVE.cloud, MOVE.ashen, // 强化特殊技
  C2_PO_MOVE_ID, // 符法千重-破
])

// 后台合轴招式（墨影凝云 + 霄云劲#5，不占战场时间但有倍率行调用）
const BACKSTAGE_INK_MOVE = '1371005' // 普通攻击：墨影凝云
const BACKSTAGE_STRIKE_MOVE = '1371006' // 普通攻击：霄云劲 #5

// 闪能回复（文本明确数值）
const PERFECT_BLOCK_FLASH = 10 // 完美格挡（墨痕化形 #2 蓄力/上挑触发）回复闪能，0.5s 最多一次
const DODGE_FLASH = 5 // 极限闪避回复闪能，1s 最多一次
const TEAM_ULT_FLASH = 20 // 额外能力：队友终结技回 2 闪能/s×10s = 20/次
const C1_LIGHTNING_RATIO = 50 // 影画1 落雷 50% 贯穿力伤害
const C1_LIGHTNING_MOVE_ID = '1371_c1_lightning' // 假 id（不进失衡/异常池）
const C1_CRIT_DMG = 20 // 影画1 进场暴击率+10%（用户口径：改为等效爆伤+20%，防暴击溢出）
const C1_SHUFA_INITIAL = 120 // 影画1 进场 +120 术法值

// 极限支援换场落雷（额外能力·玄墨暗涌，用户口径）：默认次数 = 队友正常弹刀次数求和（上限），主页可录入
const EXTREME_ASSIST_LIGHTNING_RATIO = 225 // 225% 贯穿力伤害
const EXTREME_ASSIST_MOVE_ID = '1371_extreme_assist_lightning' // 假 id（不进失衡/异常池）

// 非轴模式（用户口径：弃用自动近似，默认 0；滑块保留供用户自行调节兜底）
const DEFAULT_STUN_EX_COVERAGE = 0 // 失衡强特 +30% 覆盖率（非轴模式，默认不算）
const DEFAULT_NINGSHEN_COVERAGE = 0 // 凝神暴伤覆盖率（非轴模式，默认不算）

// 影画2·消灾渡厄（用户确认）
const C2_RES_IGNORE = 15 // [终结技]或[强化特殊技]无视 15% 以太伤害抗性（招式限定）
const C2_PO_DMG = 1200 // 最多 1200% 贯穿力
const C2_PO_DAZE = 374.055 // 失衡
const C2_PO_DECIBEL = 62.3425 // 喧响
const C2_PO_ANOMALY = 226.7 // 异常积蓄（用户提供数值）

// 影画4·术道归一：发动终结技获得[静心]（≤2 层），每层使下一次凝云术/墨烬影消伤害+30%；
// 次数口径（用户确认）：增伤次数 = 大招次数，摊入凝云/墨消全部执行（期望加权）
const C4_STUN_EX_BONUS = 30

// 影画6·动静相宜：
const C6_GIFT_INTERVAL = 30 // [调息] 30s CD 最多获得一次（封顶 floor(战斗时间/30)）
const DEFAULT_C6_GIFT_ULT_COUNT = -1 // 调息赠送符法千重次数：-1 = 自动取大招次数（喧响大的次数），滑块可调

// 术法值驱动的符法千重实际次数（用户口径，文本框可填）：
// -1 = 自动 = 全部（术法值理论可打次数 floor(术法值/120)）；手动填则封顶于理论可打次数。
const DEFAULT_SHUFA_ULT_COUNT = -1
const SHUFA_ULT_COST = 120 // 术法值单次符法千重消耗（与 spec spendRules 一致）

/** 强特链分解（用户确认口径；纯函数便于测试） */
export function computeYixuanExChain(
  income: number,
  ink2Count: number,
  ink3Count: number,
  perfectBlockCount: number,
  axisCloudCount: number,
  axisCloudSeconds: number,
): YixuanExChain {
  const incomeSafe = Math.max(0, income)
  const ink2 = Math.max(0, Math.floor(ink2Count))
  const ink3 = Math.max(0, Math.floor(ink3Count))
  const perfectBlocks = Math.max(0, Math.floor(perfectBlockCount))
  const axisCloud = Math.max(0, Math.floor(axisCloudCount))
  const axisSec = Math.max(0, Math.min(CLOUD_MAX_SECONDS, axisCloudSeconds))

  const ink1 = ink2 + ink3
  const ink3Follow = ink2 + ink3 // #3 跟随 #1（2连/3连都有）
  const ink4 = ink3 // #4 仅 3连
  const ink2Move = perfectBlocks // #2 完美格挡赠送

  // 轴内凝云消耗 = 墨烬影消 20 + 凝云 t×20/次
  const axisCloudCostPer = ASHEN_COST + axisSec * (CLOUD_MAX_COST / CLOUD_MAX_SECONDS)
  const axisCloudSpent = axisCloud * axisCloudCostPer
  // 墨痕化形消耗 = #1×40 + #4×20
  const inkSpent = ink1 * INK1_COST + ink4 * INK4_COST
  // 剩余闪能全部用于凝云术链（轴外满蓄 60/循环）
  const remaining = Math.max(0, incomeSafe - inkSpent - axisCloudSpent)
  const cloudOut = Math.floor(remaining / CLOUD_CYCLE_COST)
  const ashenTotal = axisCloud + cloudOut
  const cloudTotal = axisCloud + cloudOut

  const flashSpent = inkSpent + axisCloudSpent + cloudOut * CLOUD_CYCLE_COST
  const chainSeconds = ink1 * INK2_CHAIN_SECONDS + ink4 * 0.966 + ink2Move * INK2_SECONDS
    + axisCloud * (ASHEN_SECONDS + axisSec) + cloudOut * (ASHEN_SECONDS + CLOUD_MAX_SECONDS)

  return {
    cycles: ink1 + ink4 + ashenTotal + cloudTotal,
    inkCycles: ink2 + ink3,
    cloudCycles: cloudTotal,
    ink1,
    ink2: ink2Move,
    ink3: ink3Follow,
    ink4,
    ashen: ashenTotal,
    cloud: cloudTotal,
    cloudChargeSeconds: axisCloud > 0 && cloudTotal === axisCloud ? axisSec : CLOUD_MAX_SECONDS,
    flashSpent,
    chainSeconds,
    axisCloud,
    cloudOut,
    axisCloudSeconds: axisSec,
    ink2Count: ink2,
    ink3Count: ink3,
    perfectBlockCount: perfectBlocks,
  }
}

/**
 * 凝神时间轴覆盖（失衡轴内，般岳明王模式；用户口径）：
 * - 触发块 = 仪玄终结技（1371014 青溟云影 / 1371020 符法千重）——发动终结技后进入[凝神]；
 * - 触发后 15s 窗口内该槽位动作享受暴伤+40%（触发块自身不享受）；
 * - 返回每个 moveId 的实例加权平均暴伤（0-40），非轴模式由调用方按覆盖率滑块近似。
 */
export function computeYixuanNingshenBonus(
  slot: number,
  axes: { actions: { slot: number; moveId: string; count: number; startTime?: number }[] }[],
  _cinemaLevel = 0,
): Map<string, { critDmg: number; sheerDmg: number }> {
  const triggerIds = new Set<string>(['1371014', '1371020'])
  const actions = axes
    .flatMap(axis => axis.actions ?? [])
    .filter(a => a.slot === slot)
    .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0))
  const windowSeconds = NINGSHEN_SECONDS

  let windowEnd = Number.NEGATIVE_INFINITY
  const weighted: Map<string, { critTotal: number; count: number }> = new Map()
  for (const act of actions) {
    const start = act.startTime ?? 0
    const count = Math.max(0, Math.floor(act.count) || 1)
    if (triggerIds.has(act.moveId)) {
      windowEnd = start + windowSeconds
      continue // 触发块自身不享受（凝神在终结技后生效）
    }
    const active = start <= windowEnd
    if (!active) continue
    const prev = weighted.get(act.moveId) ?? { critTotal: 0, count: 0 }
    weighted.set(act.moveId, { critTotal: prev.critTotal + NINGSHEN_CRIT_DMG * count, count: prev.count + count })
  }
  const result = new Map<string, { critDmg: number; sheerDmg: number }>()
  for (const [moveId, w] of weighted) {
    result.set(moveId, {
      critDmg: w.count > 0 ? w.critTotal / w.count : 0,
      // 影画6 凝神贯穿+20% 已按用户口径改 panel 级全覆盖（applyPanel），不再走 buff 轴
      sheerDmg: 0,
    })
  }
  return result
}

/**
 * 凝神轴块标注（轴编辑器可视化用）：返回 `${axisIndex}:${actionIndex}` → { trigger, active }。
 * 触发块（终结技）标 trigger=true（自身不享受）；落窗动作标 active=true（暴伤+40%）。
 */
export function computeYixuanNingshenBlocks(
  axes: { actions: { slot: number; moveId: string; count: number; startTime?: number }[] }[],
  yixuanSlot: number,
): Map<string, { trigger: boolean; active: boolean }> {
  const out = new Map<string, { trigger: boolean; active: boolean }>()
  const triggerIds = new Set<string>(['1371014', '1371020'])
  axes.forEach((axis, ai) => {
    let windowEnd = Number.NEGATIVE_INFINITY
    const indexed = axis.actions
      .map((a, aii) => ({ a, aii }))
      .filter(x => x.a.slot === yixuanSlot)
      .sort((x, y) => (x.a.startTime ?? 0) - (y.a.startTime ?? 0))
    for (const { a, aii } of indexed) {
      const start = a.startTime ?? 0
      const key = `${ai}:${aii}`
      if (triggerIds.has(a.moveId)) {
        windowEnd = start + NINGSHEN_SECONDS
        out.set(key, { trigger: true, active: false })
      } else {
        out.set(key, { trigger: false, active: start <= windowEnd })
      }
    }
  })
  return out
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

function cfgNum(cfg: AgentCharConfigInput['cfg'], key: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const raw = Number(record[`setting:${key}`] ?? fallback)
  return Number.isFinite(raw) ? raw : fallback
}

function readAxisEx(cfg: AgentCharConfigInput['cfg']): Record<string, number> {
  const record = cfg as unknown as Record<string, unknown>
  const raw = (record.yixuanAxisEx ?? {}) as Record<string, number>
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    const n = Math.max(0, Math.floor(Number(v) || 0))
    if (n > 0) out[k] = n
  }
  return out
}

function buildYixuanCharConfig({ skills, cinemaLevel, team, cfg }: AgentCharConfigInput): void {
  // 进场恢复全部闪能（用户确认 120）
  cfg.initialEnergyGift = ENTRY_FLASH
  // 强特全部由模块生成（墨痕化形链/凝云术链）；exSpecialCount 仅作喧响估算（60 闪能/循环当量）
  cfg.skipGenericExSpecial = true
  cfg.exSpecialCountFloor = true
  cfg.exSpecialEnergyConsume = CLOUD_CYCLE_COST

  const record = cfg as unknown as Record<string, unknown>
  record.yixuanCinemaLevel = cinemaLevel

  // 喧响收入常量（倍率表 decibel_recovery，用户口径 2026-09-07：4 失衡 ⇒ 主C 4 喧响）。
  // 此前模块行显式 0 且未设常量 → 喧响收入近零（仪玄 8030/12000）。
  // 强特链口径 = 凝云链主口径（墨烬影消+凝云术 = 60 闪能整链 232.4；2 连链 40 闪能份额近似并入），
  // 连携 = 玄墨迅击 239.7；终结技（青溟云影/符法千重）倍率表无 decibel 行 → 0（数据如此，勿脑补）。
  cfg.exSpecialDecibelRecovery = rowValue(findMoveById(skills, MOVE.ashen), 'decibel_recovery')
    + rowValue(findMoveById(skills, MOVE.cloud), 'decibel_recovery')
  cfg.chainDecibelRecovery = rowValue(findMoveById(skills, '1371013'), 'decibel_recovery')
  // 后台合轴行喧响表（buildExecutions 按 N 结算进 cfg.yixuanBackstageDecibel）
  record.yixuanMoveDecibel = Object.fromEntries(
    ['1371021', '1371007', '1371005', '1371006'].map(id => [id, rowValue(findMoveById(skills, id), 'decibel_recovery')]),
  )

  // 额外能力·玄墨暗涌：队伍存在[击破]/[支援]/[防护]角色时触发 → 队友终结技回 20 闪能/次
  const hasStun = team?.some(m => m.agent?.specialty === 'stun')
  const hasSupport = team?.some(m => m.agent?.specialty === 'support')
  const hasDefense = team?.some(m => m.agent?.specialty === 'defense')
  if (hasStun || hasSupport || hasDefense) {
    cfg.teamUltimateFlashBonus = TEAM_ULT_FLASH
  }

  // 额外闪能总账（文本明确数值，次数按现有交互输入近似）：
  // 完美格挡 +10/次（yixuanPerfectBlockCount，≤0=自动=弹刀次数全完美）、极限闪避 +5/次（dodgeCounterCount）、
  // 影画1 落雷 +5/次（6s CD 战斗时间驱动）、玄墨异常触发 +10/次（外层收敛注入 cfg.yixuanAnomalyTriggerFlash）
  const pbRaw = Number(record.yixuanPerfectBlockCount ?? 0)
  const perfectBlocks = pbRaw >= 1
    ? Math.floor(pbRaw)
    : Math.max(0, Math.floor(Number((cfg as unknown as Record<string, unknown>).parryCount ?? 0)))
  const dodges = Math.max(0, Math.floor(cfg.dodgeCounterCount ?? 0))
  const anomalyFlash = Math.min(ANOMALY_TRIGGER_MAX, Math.max(0, Math.floor(Number(record.yixuanAnomalyTriggerFlash ?? 0))))
  // 极限支援换场落雷（额外能力，用户口径）：默认次数 = 队友正常弹刀次数求和（上限），主页可录入；
  // 次数由 useResourceCalc merged 注入 cap 后在本模块 buildExecutions 结算（闪能已在 merged 注入计入总账）
  record.yixuanExtremeAssistCountInput = Number(record.yixuanExtremeAssistCount ?? -1)
  // 影画1·追加落雷：次数与闪能由 useResourceCalc merged 按 CD 注入（轴模式轴内时间/6，非轴战斗时间/6）
  const flashBonus = perfectBlocks * PERFECT_BLOCK_FLASH + dodges * DODGE_FLASH + anomalyFlash * ANOMALY_TRIGGER_FLASH
  cfg.yixuanFlashBonus = flashBonus

  // 影画1：进场立即获得 120 术法值（spec 术法值 initialValueSource=cfgField 读取）
  if (cinemaLevel >= 1) cfg.yixuanShufaInitial = C1_SHUFA_INITIAL

  // 预存动作时间与行值（双键：常量名供 estimate/push，moveId 供按行查表）
  const times: Record<string, number> = {}
  const dmg: Record<string, number> = {}
  const daze: Record<string, number> = {}
  for (const [key, id] of Object.entries(MOVE)) {
    const mv = findMoveById(skills, id)
    times[key] = mv?.actionTime ?? 0
    times[id] = mv?.actionTime ?? 0
    dmg[key] = rowValue(mv, 'damage')
    dmg[id] = rowValue(mv, 'damage')
    daze[key] = rowValue(mv, 'daze')
    daze[id] = rowValue(mv, 'daze')
  }
  record.yixuanMoveTimes = times
  cfg.yixuanMoveTimes = times
  record.yixuanMoveDmg = dmg
  record.yixuanMoveDaze = daze

  // spec 侧：mechanicRowValues 预存（术法值事件倍率行；符法千重实际执行由本模块按次数生成）
  specBase.buildCharConfig?.({ skills, cinemaLevel, cfg } as AgentCharConfigInput)
}

function applyYixuanPanel({ panel, cinemaLevel }: AgentPanelInput): void {
  // 影画1·清灵道心：进入战场时暴击率提升 10% → 用户口径改为等效暴伤+20%（防暴击溢出）
  if (cinemaLevel >= 1) {
    panel.critDmg = (panel.critDmg ?? 0) + C1_CRIT_DMG
  }
  // 影画2·青溟云影：终结技使失衡敌人失衡持续时间 +3 秒（原 spec teamBuffs 全队应用导致
  // computeWindowDuration 按角色求和多计；改 applyPanel 只加本角色一次，与琉音/般岳/诺姆口径一致）
  if (cinemaLevel >= 2) {
    panel.stunDurationBonusSeconds = (panel.stunDurationBonusSeconds ?? 0) + 3
  }
  // 影画6 凝神（暴伤+40%/贯穿+20%）不在面板层施加：满覆盖+滑块由 pushDirect 按执行折算（能读 configStore）
  specBase.applyPanel?.({ panel, cinemaLevel } as AgentPanelInput)
}

/**
 * 哨兵自动口径（用户口径 2026-08）：3连墨痕化形 / 完美格挡 次数 ≤0（缺省/清空）= 自动——
 * 总闪能先打完失衡内（轴内凝云等）消耗，剩余闪能全部在轴外打 3连墨痕化形（60/次）；
 * 完美格挡按「全完美」= 弹刀次数（每次 +10 闪能进收入）。手填 ≥1 覆盖自动值。
 */
function resolveYixuanAutoInputs(
  record: Record<string, unknown>,
  cfg: AgentCharConfigInput['cfg'],
  income: number,
  ink2: number,
  axisCloudSpent: number,
): { ink3: number; perfectBlocks: number } {
  const ink3Raw = Number(record.yixuanInk3Count ?? 0)
  const ink3 = ink3Raw >= 1
    ? Math.floor(ink3Raw)
    : Math.floor(Math.max(0, income - ink2 * INK2_COST - axisCloudSpent) / INK3_COST)
  const pbRaw = Number(record.yixuanPerfectBlockCount ?? 0)
  const perfectBlocks = pbRaw >= 1
    ? Math.floor(pbRaw)
    : Math.max(0, Math.floor(Number((cfg as unknown as Record<string, unknown>).parryCount ?? 0)))
  // 影画4 静心（增伤载体=凝云/墨烬影消）：自动口径下留 1 轮凝云（60 闪能）当载体，
  // 否则轴外凝云全被 3 连吃掉 → C4 0 增幅 —— 用户口径 2026-08
  const cinemaLevel = Math.max(0, Math.floor(Number(record.yixuanCinemaLevel ?? 0)))
  if (cinemaLevel >= 4 && ink3 > 0) {
    const reserved = Math.min(ink3, 1) // 留 1 轮凝云 = 少打 1 次 3 连
    return { ink3: ink3 - reserved, perfectBlocks }
  }
  return { ink3, perfectBlocks }
}

/** 从 cfg 读链输入并分解（buildExecutions/estimate/resourceSections 共用） */
function resolveYixuanChain(cfg: AgentCharConfigInput['cfg'], exSpecialCount: number): YixuanExChain {
  const record = cfg as unknown as Record<string, unknown>
  const ink2 = Math.max(0, Math.floor(Number(record.yixuanInk2Count ?? 0)))
  const axisEx = readAxisEx(cfg)
  const axisCloud = axisEx[MOVE.cloud] ?? 0
  const axisSec = Number(record.yixuanAxisCloudSeconds ?? CLOUD_MAX_SECONDS) || CLOUD_MAX_SECONDS
  // 池子隐含收入（上轮口径）：exSpecialCount × 循环当量 60 —— 收敛后 ≈ 闪能总收入（含队友终结/异常触发）
  const income = Math.max(0, exSpecialCount) * CLOUD_CYCLE_COST
  const axisCloudSpent = axisCloud * (ASHEN_COST + axisSec * (CLOUD_MAX_COST / CLOUD_MAX_SECONDS))
  const { ink3, perfectBlocks } = resolveYixuanAutoInputs(record, cfg, income, ink2, axisCloudSpent)
  return computeYixuanExChain(income, ink2, ink3, perfectBlocks, axisCloud, axisSec)
}

function buildYixuanExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const chain = resolveYixuanChain(cfg, state.exSpecialCount ?? 0)
  record.yixuanExChain = chain
  // spec 术法值按 cfgField 读取实际总耗闪能
  record.yixuanFlashEnergySpent = chain.flashSpent

  const axisActive = Boolean(record.yixuanAxisActive)
  const stunExCov = axisActive ? 0 : cfgNum(cfg, 'yixuan.stunExCoverage', DEFAULT_STUN_EX_COVERAGE)
  const axisCloud = chain.axisCloud ?? 0
  const cloudOut = chain.cloudOut ?? 0
  const cinemaLevel = Math.max(0, Math.floor(Number(record.yixuanCinemaLevel ?? 0)))
  const ultCount = Math.max(0, Math.floor(state.ultimateCount ?? 0))
  // 玄墨值 M = 符法千重总次数（术法值消耗 + 影画6 调息赠送）——合轴替换/聚墨破/C4 静心共用
  const shufaResources = computeSpecResources(getAgentSpec(AGENT_ID)!, cfg, state)
  const theoreticalShufaUlts = Math.max(0, Math.floor(shufaResources.get('yixuan_shufa_value')?.spendCounts['yixuan_extra_ult_spend'] ?? 0))
  // 术法值驱动的符法千重实际次数（用户口径，文本框可填）：默认 -1 = 自动 = 全部（理论可打次数）；
  // 手动填则封顶于理论可打次数。
  const shufaSlider = Math.floor(cfgNum(cfg, 'yixuan.shufaUltCount', DEFAULT_SHUFA_ULT_COUNT))
  const shufaUlts = Math.max(0, Math.min(shufaSlider >= 0 ? shufaSlider : theoreticalShufaUlts, theoreticalShufaUlts))
  record.yixuanShufaUltCount = shufaUlts
  // 影画6·调息：青溟云影后获得一层，可无视术法值发动一次符法千重；30s CD 封顶；
  // 赠送次数默认 = 大招次数（喧响大的次数，用户口径），滑块可调
  const giftSlider = Math.floor(cfgNum(cfg, 'yixuan.c6GiftUltCount', DEFAULT_C6_GIFT_ULT_COUNT))
  const giftCap = Math.max(0, Math.floor((cfg.battleTime ?? 180) / C6_GIFT_INTERVAL))
  const giftUlts = cinemaLevel >= 6
    ? Math.max(0, Math.min(giftSlider >= 0 ? giftSlider : ultCount, giftCap))
    : 0
  const totalFuFaUlts = shufaUlts + giftUlts
  record.yixuanXuanmoGain = totalFuFaUlts

  // 影画4·静心：层数来源 = 全部终结技（青溟云影 ultimateCount + 符法千重 totalFuFaUlts，用户口径），
  // 每次终结 +1 层；增伤次数 = min(大招总次数, 凝云墨消总数)，摊入凝云/墨消全部执行（期望加权）
  const cloudTotal = chain.ashen
  const totalUltCount = ultCount + totalFuFaUlts
  const c4Bonus = cinemaLevel >= 4 && cloudTotal > 0
    ? Math.round(C4_STUN_EX_BONUS * Math.min(totalUltCount, cloudTotal) / cloudTotal)
    : 0

  const times = (record.yixuanMoveTimes ?? {}) as Record<string, number>
  const dmgRows = (record.yixuanMoveDmg ?? {}) as Record<string, number>
  const dazeRows = (record.yixuanMoveDaze ?? {}) as Record<string, number>
  const push = (moveId: string, name: string, count: number, category: string, note: string, energyConsume = 0, dmgBonus = 0) => {
    if (count <= 0) return
    executions.push({
      moveId,
      moveName: name,
      category,
      count,
      actionTime: times[moveId] ?? 0,
      comboAlignRatio: 0,
      totalTime: (times[moveId] ?? 0) * count,
      totalComboAlignTime: 0,
      energyConsume,
      totalEnergyConsume: energyConsume * count,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      ...(dmgBonus ? { dmgBonus } : {}),
      skillTableNote: note,
      // 不设 damageMultiplierOverride：enrichExecutionPlan 按 moveId 从倍率表回填（自动含 3/5 命等级）
    })
  }

  // 墨痕化形链：2连（#1+#3，40）/ 3连（#1+#3+#4，60）；#2 完美格挡赠送（免费，回 10 闪能/次）
  push(MOVE.ink1, '强化特殊技：墨痕化形 #1', chain.ink1, 'special', `墨痕化形链 ×${chain.ink1}（2连×${chain.ink2Count ?? 0} + 3连×${chain.ink3Count ?? 0}）`, INK1_COST)
  push(MOVE.ink3, '强化特殊技：墨痕化形 #3', chain.ink3, 'special', `跟随#1（免费）×${chain.ink3}`, 0)
  push(MOVE.ink4, '强化特殊技：墨痕化形 #4', chain.ink4, 'special', `跟随#3 ×${chain.ink4}：20闪能/次`, INK4_COST)
  push(MOVE.ink2, '强化特殊技：墨痕化形 #2', chain.ink2, 'special', `完美格挡赠送 ×${chain.ink2}（免费，回10闪能/次）`, 0)

  // 凝云术链：墨烬影消（轴内命中失衡 +30%）+ 凝云术（轴内按轴时长秒均折算；轴外满蓄回填）
  const axisAshenBonus = (axisActive ? STUN_EX_BONUS : Math.round(STUN_EX_BONUS * stunExCov)) + c4Bonus
  const outAshenBonus = (axisActive ? 0 : Math.round(STUN_EX_BONUS * stunExCov)) + c4Bonus
  push(MOVE.ashen, '强化特殊技：墨烬影消（轴内）', axisCloud, 'special', `轴内凝云术链 ×${axisCloud}：20闪能/次（命中失衡+30%${c4Bonus ? `，静心+${c4Bonus}%` : ''}）`, ASHEN_COST, axisAshenBonus)
  push(MOVE.ashen, '强化特殊技：墨烬影消（轴外）', cloudOut, 'special', `轴外凝云术链 ×${cloudOut}：20闪能/次${axisActive ? '' : '（+30%×覆盖率）'}${c4Bonus ? `（静心+${c4Bonus}%）` : ''}`, ASHEN_COST, outAshenBonus)

  const axisSec = chain.axisCloudSeconds ?? CLOUD_MAX_SECONDS
  if (axisCloud > 0) {
    const full = axisSec >= CLOUD_MAX_SECONDS - 1e-9
    executions.push({
      moveId: MOVE.cloud,
      moveName: '强化特殊技：凝云术（轴内）',
      category: 'special',
      count: axisCloud,
      actionTime: axisSec,
      comboAlignRatio: 0,
      totalTime: axisSec * axisCloud,
      totalComboAlignTime: 0,
      energyConsume: Math.round(axisSec * (CLOUD_MAX_COST / CLOUD_MAX_SECONDS)),
      totalEnergyConsume: Math.round(axisSec * (CLOUD_MAX_COST / CLOUD_MAX_SECONDS)) * axisCloud,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      dmgBonus: axisAshenBonus,
      ...(full
        ? {}
        : {
            damageMultiplier: Math.round((dmgRows[MOVE.cloud] ?? 0) * (axisSec / CLOUD_MAX_SECONDS) * 10) / 10,
            damageMultiplierOverride: true,
            dazeMultiplier: Math.round((dazeRows[MOVE.cloud] ?? 0) * (axisSec / CLOUD_MAX_SECONDS) * 10) / 10,
            dazeMultiplierOverride: true,
          }),
      skillTableNote: full
        ? `凝云术（轴内）×${axisCloud}：满蓄 ${axisSec}s（倍率表回填，命中失衡+30%）`
        : `凝云术（轴内）×${axisCloud}：蓄力 ${axisSec}s（轴内时长，秒均折算；命中失衡+30%）`,
    })
  }
  if (cloudOut > 0) {
    executions.push({
      moveId: MOVE.cloud,
      moveName: '强化特殊技：凝云术（轴外）',
      category: 'special',
      count: cloudOut,
      actionTime: CLOUD_MAX_SECONDS,
      comboAlignRatio: 0,
      totalTime: CLOUD_MAX_SECONDS * cloudOut,
      totalComboAlignTime: 0,
      energyConsume: CLOUD_MAX_COST,
      totalEnergyConsume: CLOUD_MAX_COST * cloudOut,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      dmgBonus: outAshenBonus,
      skillTableNote: `凝云术（轴外）×${cloudOut}：满蓄（倍率表回填）${axisActive ? '' : '（+30%×覆盖率）'}${c4Bonus ? `（静心+${c4Bonus}%）` : ''}`,
    })
  }

  // 墨影凝云合轴（用户口径）：合轴次数 N；玄墨值 M 把合轴招式替换为玄墨极阵+青溟震击
  // （N ≤ M 全打玄墨极阵+青溟震击；N > M 超出部分打墨影凝云+A5）；全部 actionTime=0 不占战场时间
  // 合轴次数：手动输入 >0 优先；否则吃自动填充（useResourceCalc 反推至保底4失衡，
  // 用户口径 2026-09-07：合轴可自动填充、不占前台不计难度）
  const manualBackstage = Math.max(0, Math.floor(Number(record.yixuanBackstageComboCount ?? 0)))
  const backstageCount = manualBackstage > 0
    ? manualBackstage
    : Math.max(0, Math.floor(Number(record.yixuanBackstageAutoCount ?? 0)))
  const backstageDb: Record<string, number> = (record.yixuanMoveDecibel ?? {}) as Record<string, number>
  // 后台合轴喧响（不占前台但有收入）：Σ 招式喧响 × 次数 → cfg 进喧响账本（通用加项）
  cfg.yixuanBackstageDecibel = ['1371021', '1371007', '1371005', '1371006']
    .reduce((sum, id) => sum + (backstageDb[id] ?? 0) * backstageCount, 0)
  if (backstageCount > 0) {
    const xuanmoStrike = Math.min(backstageCount, totalFuFaUlts)
    const inkCombo = Math.max(0, backstageCount - totalFuFaUlts)
    for (const [mid, mname, cnt] of [
      ['1371021', '普通攻击：玄墨极阵（合轴·玄墨值替换）', xuanmoStrike],
      ['1371007', '普通攻击：青溟震击（合轴·玄墨值替换）', xuanmoStrike],
      [BACKSTAGE_INK_MOVE, '普通攻击：墨影凝云（合轴）', inkCombo],
      [BACKSTAGE_STRIKE_MOVE, '普通攻击：霄云劲 #5（合轴）', inkCombo],
    ] as const) {
      if (cnt <= 0) continue
      executions.push({
        moveId: mid,
        moveName: mname,
        category: 'basic',
        count: cnt,
        actionTime: 0,
        comboAlignRatio: 1,
        totalTime: 0,
        totalComboAlignTime: 0,
        energyConsume: 0,
        totalEnergyConsume: 0,
        /*@KEEP0@*/
        energyRecovery: 0,
        totalEnergyRecovery: 0,
        skillTableNote: `合轴 ×${cnt}${xuanmoStrike > 0 && mid === '1371021' ? `（玄墨值替换，总 ${totalFuFaUlts}）` : ''}`,
      })
    }
  }

  // 影画1·落雷（队伍任意角色命中，6s 最多一次 → 战斗时间驱动）：50% 贯穿力附加伤害，
  // 假 id 不进失衡/异常池（坑5 约定），伤害池按 damageMultiplierOverride 消费
  const c1Lightnings = Math.max(0, Math.floor(Number(record.yixuanC1LightningCount ?? 0)))
  if (c1Lightnings > 0) {
    executions.push({
      moveId: C1_LIGHTNING_MOVE_ID,
      moveName: '落雷（影画1·清灵道心）',
      category: 'assist',
      count: c1Lightnings,
      actionTime: 0,
      comboAlignRatio: 0,
      totalTime: 0,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      damageMultiplier: C1_LIGHTNING_RATIO,
      damageMultiplierOverride: true,
      skillTableNote: `落雷 ×${c1Lightnings}：50% 贯穿力（6s 最多一次，战斗时间驱动）`,
    })
  }

  // 额外能力·极限支援换场落雷：225% 贯穿力 + 5 闪能/次（默认队友弹刀和上限，主页可录入；假 id 不进失衡/异常池）
  const assistCap = Math.max(0, Math.floor(Number(record.yixuanExtremeAssistCap ?? 0)))
  const assistInput = Math.floor(Number(record.yixuanExtremeAssistCountInput ?? -1)) // -1 = 默认取上限
  const extremeAssists = (cfg.teamUltimateFlashBonus ?? 0) > 0 ? Math.min(assistInput >= 0 ? assistInput : assistCap, assistCap) : 0
  record.yixuanExtremeAssistCount = extremeAssists
  if (extremeAssists > 0) {
    executions.push({
      moveId: EXTREME_ASSIST_MOVE_ID,
      moveName: '落雷（极限支援换场）',
      category: 'assist',
      count: extremeAssists,
      actionTime: 0,
      comboAlignRatio: 0,
      totalTime: 0,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      // 落雷假 id 无倍率表行，喧响显式 0（不回填）
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      damageMultiplier: EXTREME_ASSIST_LIGHTNING_RATIO,
      damageMultiplierOverride: true,
      skillTableNote: `落雷 ×${extremeAssists}：225% 贯穿力（极限支援换场，+5闪能/次）`,
    })
  }

  // 影画6：赠送的符法千重执行（真实 moveId 回填，不耗术法值/喧响；施放时间同本体 2.267s）
  if (giftUlts > 0) {
    const giftAt = times[MOVE.extraUlt] ?? 0
    executions.push({
      moveId: MOVE.extraUlt,
      moveName: '终结技：符法千重（影画6·调息赠送）',
      category: 'chain',
      count: giftUlts,
      actionTime: giftAt,
      comboAlignRatio: 0,
      totalTime: giftAt * giftUlts,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      skillTableNote: `符法千重 ×${giftUlts}（调息赠送：30s CD，默认=大招次数）`,
    })
  }

  // 影画2·聚墨：每发动一次符法千重获得一层（最多 1 层）→ 消耗发动符法千重-破（1200% 贯穿力，倍率行被隐藏，
  // 数值为用户提供：伤害 1200 / 失衡 374.055 / 喧响 62.3425 / 异常 226.7；假 id 不进失衡/异常池，daze/异常走执行字段）
  if (cinemaLevel >= 2 && totalFuFaUlts > 0) {
    const poAt = times[MOVE.extraUlt] ?? 0 // 符法千重-破 = 符法千重的破版，施放时长同本体（2.267s，用户口径 2026-08）
    executions.push({
      moveId: C2_PO_MOVE_ID,
      moveName: '强化特殊技：符法千重-破',
      category: 'special',
      count: totalFuFaUlts,
      actionTime: poAt,
      comboAlignRatio: 0,
      totalTime: poAt * totalFuFaUlts,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: C2_PO_DECIBEL,
      totalDecibelRecovery: C2_PO_DECIBEL * totalFuFaUlts,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      damageMultiplier: C2_PO_DMG,
      damageMultiplierOverride: true,
      dazeMultiplier: C2_PO_DAZE,
      dazeMultiplierOverride: true,
      anomalyBuildUp: C2_PO_ANOMALY,
      skillTableNote: `符法千重-破 ×${totalFuFaUlts}：1200% 贯穿力（聚墨，影画2；吃核心被动60%/影画2减抗）`,
    })
  }

  // 术法值驱动的符法千重（真实 moveId 回填，不设 override）：次数 = min(术法值可打次数, 文本框/自动默认)；
  // 施放时间 = 本体 2.267s 计前台（用户口径 2026-08，曾 0 时间不计）
  // 玄墨值/合轴/聚墨/静心等下游已在上面按 totalFuFaUlts（实际次数）结算。
  if (shufaUlts > 0) {
    const shufaAt = times[MOVE.extraUlt] ?? 0
    executions.push({
      moveId: MOVE.extraUlt,
      moveName: '终结技：符法千重（术法值）',
      category: 'special',
      count: shufaUlts,
      actionTime: shufaAt,
      comboAlignRatio: 0,
      totalTime: shufaAt * shufaUlts,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      skillTableNote: `符法千重 ×${shufaUlts}（术法值 120/次）`,
    })
  }
}

function patchYixuanExecutions({ cfg, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinemaLevel = Math.max(0, Math.floor(Number(record.yixuanCinemaLevel ?? 0)))
  for (const exec of executions) {
    if (!exec.moveId) continue
    // 玄墨异常独立积蓄槽：异常分桶到 ether_ink（直伤元素仍走倍率表 ether，不受影响）
    if (exec.element !== 'ether_ink') exec.element = 'ether_ink'
    // 核心被动 Lv.7 招式限定 +60%（用户确认）：moveId 级 dmgBonus
    if (CORE_DMG_MOVE_IDS.has(exec.moveId)) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + CORE_DMG_BONUS
    }
    // 影画2：终结技/强化特殊技无视 15% 以太伤害抗性（招式限定，pushDirect 按 resIgnore 消费）
    if (cinemaLevel >= 2 && C2_RES_IGNORE_MOVE_IDS.has(exec.moveId)) {
      exec.resIgnore = (exec.resIgnore ?? 0) + C2_RES_IGNORE
    }
  }
}

function buildYixuanResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const spec = getAgentSpec(AGENT_ID)!
  const resources = computeSpecResources(spec, cfg, state)
  const record = cfg as unknown as Record<string, unknown>
  // 术法值实际消耗 = 文本框/自动决定的符法千重次数（buildExecutions 已写入 cfg.yixuanShufaUltCount）；
  // 资源卡「消耗/剩余」按实际打出的次数展示，而非理论可打次数。
  const shufaActualRaw = Number(record.yixuanShufaUltCount ?? NaN)
  const shufaRes = resources.get('yixuan_shufa_value')
  if (shufaRes && Number.isFinite(shufaActualRaw) && shufaActualRaw >= 0) {
    const shufaActual = Math.floor(shufaActualRaw)
    shufaRes.spendCounts['yixuan_extra_ult_spend'] = shufaActual
    shufaRes.spendCosts['yixuan_extra_ult_spend'] = shufaActual * SHUFA_ULT_COST
    shufaRes.remaining = Math.max(0, shufaRes.total - shufaActual * SHUFA_ULT_COST)
  }
  return {
    specResources: Object.fromEntries(resources),
    yixuanExChain: (record.yixuanExChain as YixuanExChain) ?? resolveYixuanChain(cfg, state.exSpecialCount ?? 0),
  }
}

function buildYixuanResourceSections({ result }: AgentResourceSectionsInput) {
  const chain = result.yixuanExChain as YixuanExChain | undefined
  const specSections = specBase.resourceSections?.({ result }) ?? []
  if (!chain) return specSections
  const axisCloud = chain.axisCloud ?? 0
  const cloudOut = chain.cloudOut ?? 0
  const axisSec = chain.axisCloudSeconds ?? CLOUD_MAX_SECONDS
  return [
    {
      id: 'yixuan-ex-chain',
      title: '仪玄·强特链',
      summary: `耗闪能 ${fmt(chain.flashSpent, 0)} · 前台 ${fmt(chain.chainSeconds, 1)}s`,
      rows: [
        { label: '墨痕化形链', value: `#1×${chain.ink1} + #3×${chain.ink3} + #4×${chain.ink4}`, detail: `2连×${chain.ink2Count ?? 0}（40闪能）+ 3连×${chain.ink3Count ?? 0}（60闪能）` },
        { label: '墨痕化形 #2', value: `×${chain.ink2}`, detail: '完美格挡赠送（免费，回10闪能/次）' },
        { label: '凝云术链（轴内）', value: `墨烬影消×${axisCloud} + 凝云术×${axisCloud}`, detail: `蓄力 ${axisSec}s/次（轴内时长，命中失衡+30%）` },
        { label: '凝云术链（轴外）', value: `墨烬影消×${cloudOut} + 凝云术×${cloudOut}`, detail: '剩余闪能全打凝云，满蓄 2s/次（60闪能/循环）' },
        { label: '总耗闪能', value: String(fmt(chain.flashSpent, 0)), detail: '术法值 = 耗闪能 × 0.667' },
        { label: '链前台时间', value: `${fmt(chain.chainSeconds, 1)}s`, detail: '2连 2.65s；3连 3.616s；凝云 0.3s+蓄力/循环' },
      ],
      footer: '2连/3连墨痕化形与完美格挡次数在主页交互栏填写；剩余闪能全打凝云（轴外满蓄）。失衡强特+30% 轴模式按轴内行、非轴模式按覆盖率滑块；凝神暴伤+40% 轴模式按 buff 轴扫描、非轴模式按覆盖率滑块。',
    },
    ...specSections,
  ]
}

const settings: MechanicSetting[] = [
  {
    id: 'yixuan.shufaUltCount',
    label: '仪玄·术法值终结技（符法千重）次数',
    description: '用术法值（120/次）打出的终结技：符法千重次数。默认 -1 = 自动 = 全部（术法值理论可打次数 floor(术法值/120)）；手动填则封顶于理论可打次数。',
    default: DEFAULT_SHUFA_ULT_COUNT,
    min: -1,
    max: 20,
    step: 1,
    suffix: '次',
  },
  {
    id: 'yixuan.stunExCoverage',
    label: '仪玄·失衡强特增伤覆盖率（非轴模式）',
    description: '额外能力：凝云术/墨烬影消命中失衡敌人伤害+30%；失衡轴模式按轴内行精确计算，非轴模式已弃用（默认 0，需要近似可自行调高）。',
    default: DEFAULT_STUN_EX_COVERAGE,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: 'yixuan.ningshenCoverage',
    label: '仪玄·凝神暴伤覆盖率（非轴模式）',
    description: '额外能力：发动终结技后[凝神]15s 暴击伤害+40%；失衡轴模式按 buff 轴扫描（大招触发后 15s 窗口），非轴模式已弃用（默认 0，需要近似可自行调高）。',
    default: DEFAULT_NINGSHEN_COVERAGE,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: 'yixuan.c6GiftUltCount',
    label: '仪玄·影画6 调息赠送符法千重次数',
    description: '调息：青溟云影后获得一层，可无视术法值发动一次符法千重（30s CD 封顶）；默认 -1 = 自动取大招次数（喧响大的次数，用户口径），可手动填次数。',
    default: DEFAULT_C6_GIFT_ULT_COUNT,
    min: -1,
    max: 99,
    step: 1,
    suffix: '次',
  },
  {
    id: 'yixuan.c6NingshenCoverage',
    label: '仪玄·影画6 凝神覆盖率（满覆盖默认）',
    description: '影画6 因调息赠送大量符法千重，凝神（暴伤+40% + 贯穿+20%）默认满覆盖（100%），不走失衡 buff 轴扫描；可调低模拟覆盖率不足。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
]

export const yixuanMechanic: AgentMechanicModule = {
  id: 'agent:yixuan',
  agentIds: [AGENT_ID],
  name: '仪玄',
  description: '进场全回闪能(120)、交互式强特链（2连/3连墨痕化形 + 完美格挡 + 剩余全凝云，轴内凝云时长可调）、玄墨异常独立积蓄槽、失衡强特+30%、凝神 buff 轴、核心被动 60% 招式限定增伤、术法值/玄墨值 spec 资源与符法千重/玄墨极阵事件。',
  applyPanel: applyYixuanPanel,
  buildCharConfig: buildYixuanCharConfig,
  estimateExSpecialTime: ({ cfg, exSpecialCount }) => {
    const chain = resolveYixuanChain(cfg, exSpecialCount ?? 0)
    return { necessaryTime: chain.chainSeconds, comboAlignTime: 0 }
  },
  buildExecutions: buildYixuanExecutions,
  patchExecutions: patchYixuanExecutions,
  buildResourceResult: buildYixuanResourceResult,
  resourceSections: buildYixuanResourceSections,
  // 墨影凝云合轴自动填充（用户口径 2026-09-07）：合轴可自动填充、不占前台不计难度，反推至
  // 保底4失衡。声明式（编排层通用执行，无 agentId 分支）：moveIds=合轴招式行（实测每对失衡），
  // perPairBase=每对基础失衡（玄墨极阵440.8+青溟震击160.2；超出玄墨值的墨影凝云版 600.4 近似同值），
  // cfgField=自动次数写回字段（消费端：buildExecutions 手动输入 ≤0 时取它），manualField=手动输入字段。
  backstageAutoFill: {
    // 主招式行（后台独占，基础轮转的青溟震击/霄云劲行不混入实测）
    moveIds: ['1371021', '1371005'],
    // 每对基础失衡（玄墨极阵 440.8 + 青溟震击 160.2；墨影凝云版 440.8+159.6 近似同值）
    perPairBase: 601,
    cfgField: 'yixuanBackstageAutoCount',
    manualField: 'yixuanBackstageComboCount',
    // 一对合轴的最短节奏（秒）——供给上限分母 [猜测·待校准]
    minPeriodSeconds: 3,
  },
  buildAnomalyEvents: input => specBase.buildAnomalyEvents?.(input),
  settings,
}
