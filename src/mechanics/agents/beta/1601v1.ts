/**
 * ⚠ beta 冻结副本（生成文件，勿手改——重跑 snapshot-agent.mjs 会整体覆盖）。
 * 冻结自 src/mechanics/agents/sunbringer.ts @ 645f0325（nanoka 3.4.1+19997538，2026-11-01T07:04:14.661Z）；
 * 角色 id 1601v1；由 scripts/snapshot-agent.mjs 生成，mechanics/index.ts 的 glob 自动注册。
 * 引擎共享件（chargeLock / moduleExecRow 等）不冻结——副本只锁角色自身逻辑。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
} from '../types'
import { getRowValue } from '@/data/moveTableQueries'
import { effectiveCombatTime } from '@/core/effectiveTime'
import { cinemaLevelOf } from '@/data/cinemaLevel'
import { moduleExecRow, RECOVERY_OFF, ENERGY_RECOVERY_OFF } from '@/mechanics/moduleExecRow'
import { allocateBossGashPool, GASH_PER_LAYER } from '@/mechanics/gashMaim'

/**
 * 挽昼（1601·锋御/燎源）——v1 测试服占位包（nanoka **3.4.1+19850203** 热更包），2026-10-25 第二刀 = **六条资源循环**。
 *
 * ## 面板层（已接线）
 * - 初始暴伤 → 初始暴击率：每 1% 初始暴伤 +0.35%（整 1% floor、只读局外面板，克拉蕾同口径）。
 * - 极昼：暴击率 +40、造成伤害无视目标 20% 防御力（15s 状态，后场不减 + 强特/聚锋刷新）；
 *   debt: 状态机未建模（满覆盖近似），等引擎有逐事件时间通道后落真窗口（DEBT_REGISTRY 已登记）。
 *
 * ## 资源循环（本文件 `buildExecutions`，口径逐条来自用户 2026-10-25 裁决）
 * | 环节 | 口径 | 数据来源 |
 * |---|---|---|
 * | 锐能 | 进场 +60；自动 1.5/s；强化特殊技 **30/发** | raw「锐能消耗 30点」×3 行；catalog `level60.sharpnessRegen` |
 * | 残痕 | 招式级 `gash_buildup` 积累，**600 点 = 1 层**，存量 ≤3 | catalog gash 行（gachabase 补入） |
 * | 毁伤 | 重击消耗层（每层 1 次），**伤害 = moveId 1601114（Lv12 336.3%）** | 3.4.1+19850203 热更新增行 |
 * | 愿力 | 每层 +40（上限 160）⇒ **每 3 层 = 1 次聚锋**（120） | raw 核心被动 Lv.7 |
 * | 链齿/旗令 | 每次聚锋各 +1；链齿 → 长暗终焉；**旗令优先终结技·此行共赴前路**（永昼之炬按 0 次） | 用户裁决 2026-10-25 |
 * | 愿核 | 终结技 A 消耗 1 旗令 → 1 愿核 → 解除 B（此愿，重塑万象） | raw |
 * | 烬痕 | 聚锋/长暗终焉/两个终结技**实际伤害的 75%**，存下来就是**固定数值**——不吃失衡易伤、不吃任何属性；B 清空时等量计入总伤害 | raw + 用户裁决 2026-10-25（"存下来的数字已经固定死了"） |
 *
 * ## 建模取舍（都写在行名/注释里，便于复核）
 * - **次数上限靠时间**：模块按 `combatTime` 顺序分配预算（EX → 聚锋 → 长暗终焉），超预算就少打；
 *   不挤平A 的秒数由折叠环自己收敛（与克拉蕾葬血强袭同款）。
 * - **终结技可行性**用 `floor(totalDecibel / ultimateCost)` 封顶（引擎对 1601 没有 ultimate 行 ——
 *   两个终结技的 `skillType` 都没标 ultimate）；两条终结技行一律 `RECOVERY_OFF`，不回填喧响，避免虚增。
 *   ⚠ 该封顶只约束**一段**（喧响大）；**二段由 [愿核] 购买、不耗喧响**（轴内见模块能力
 *   `axisMoveFreeOfDecibel` + `axisSwayFlow`，用户口径 2026-10-31）。
 * - 毁伤**不进时间**（附带事件，actionTime 0）；烬痕均摊到每次 B 的倍率上。
 * - 影画 1/2 文本已有（3.4.1+19850203）但**未实现**；C3–C6 仍占位。
 */
const SUNBRINGER_AGENT_ID = '1601v1'

/** 每 1% 初始暴击伤害 → 初始暴击率（核心被动 Lv.7） */
export const INITIAL_CRIT_DMG_TO_CRIT_RATE = 0.35
/** 极昼：暴击率 +40（满覆盖近似） */
export const POLAR_DAY_CRIT_RATE = 40
/** 极昼：造成伤害无视目标 20% 防御力（满覆盖近似） */
export const POLAR_DAY_DEF_IGNORE = 20
/** 锐能：进场 +60（勘域 180s 一次 ⇒ 每局一次） */
export const SHARPNESS_INITIAL = 60
/** 锐能：强化特殊技单发消耗（raw「锐能消耗 30点」） */
export const SHARPNESS_COST_PER_EX = 30
/** 愿力：每消除 1 层残痕 +40，上限 160 */
export const WISH_PER_MAIM = 40
export const WISH_MAX = 160
/** 愿力：一次聚锋消耗 120 */
export const JU_FENG_WISH_COST = 120
/** 烬痕：按实际伤害的 75% 累积并计入总伤害 */
export const EMBER_SCAR_RATE = 0.75
/**
 * [招架支援]造成的失衡值提升 50%（nanoka **3.4.1+19997538** 新包新增的一句，3.4.1+19850203 及更早没有）：
 * > 「德蕾琪娜发动[招架支援]**造成的失衡值提升50%**，艾尔妲与林德薇恩发动的[支援突击]残痕积蓄效率提升15%，
 * >  造成的伤害提升20%」
 * 落点 = **自身招架行（轻/重/连续三行）的 daze 倍率 ×1.5**，经 `dazeMultiplierOverride` 精确结算
 * （与琥珀 1272 影画4「招架支援失衡 +25%」同款，见 seth.ts#patchSethExecutions——引擎取哪一段
 * 由 `findDefensiveAssist` 决定，故三行一起放大，不押注引擎选哪一行）。
 */
export const PARRY_ASSIST_DAZE_BONUS = 50
/**
 * 耗能 30 的强化特殊技代表行 = 焚夜·曦生（1601106）。
 * 燃灯·晦尽（1601006，at 2.433）与它是**多形态对称数据**（收益公式相同，用户 2026-10-27
 * 「两段耗能 30 的 e 只需考虑一个」）⇒ 只走这一条线，不再另开。
 */
export const SUNBRINGER_EX_MOVE_ID = '1601106'

/** 招式元数据缓存（buildCharConfig 写，buildExecutions 读；单一来源 = 倍率表） */
interface SunbringerMoveMeta {
  moveId: string
  actionTime: number
  damage: number
  daze: number
  decibel: number
  gash: number
  sharpness: number
}
interface SunbringerMeta {
  basic: { damagePerSec: number; gashPerSec: number; sharpPerSec: number }
  ex: SunbringerMoveMeta
  jufeng: SunbringerMoveMeta
  changan: SunbringerMoveMeta
  /** 强化特殊技：燃灯·永昼之炬（消耗[旗令]；2026-10-27 补录，见 solveSunbringerLoops 的旗令分配） */
  torch: SunbringerMoveMeta
  ultA: SunbringerMoveMeta
  ultB: SunbringerMoveMeta
  maim: SunbringerMoveMeta
  chain: SunbringerMoveMeta
  sharpnessRegen: number
}

declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 挽昼招式元数据（本模块私有） */
    sunbringerMeta?: SunbringerMeta
    /** 命座等级（buildCharConfig 写；影画1/2 分支用） */
    sunbringerCinemaLevel?: number
    /** 招架支援行 moveId → 已 ×1.5 的失衡值（buildCharConfig 预存；见 PARRY_ASSIST_DAZE_BONUS） */
    sunbringerParryDazeById?: Record<string, number>
  }
}

export function applySunbringerPanel({ panel, outOfCombatPanel, cinemaLevel }: AgentPanelInput): void {
  // 核心被动·初始转化：只读局外面板，整 1% floor（与克拉蕾同口径）
  const initialCritDmg = outOfCombatPanel.critDmg
  if (initialCritDmg > 0) {
    panel.critRate = panel.critRate + Math.floor(initialCritDmg + 1e-9) * INITIAL_CRIT_DMG_TO_CRIT_RATE
  }
  // 极昼：满覆盖近似（见文件头）
  panel.critRate = panel.critRate + POLAR_DAY_CRIT_RATE
  panel.enemyDefReduction = panel.enemyDefReduction + POLAR_DAY_DEF_IGNORE
  // 影画1（隐世的虚狩）：造成伤害无视 15% 火属性抗性（满覆盖）
  if (cinemaLevel >= 1) panel.enemyFireResReduction = panel.enemyFireResReduction + 15
  // 影画2（继承者的叛旗）：锐化伤害无视 12% 防御力（满覆盖）
  if (cinemaLevel >= 2) panel.enemyDefReduction = panel.enemyDefReduction + 12
}

export function buildSunbringerCharConfig({ cfg, skills, agent, cinemaLevel }: AgentCharConfigInput): void {
  cfg.sunbringerCinemaLevel = cinemaLevel
  const all = skills.categories.flatMap(c => c.moves)
  const metaOf = (id: string): SunbringerMoveMeta => {
    const m = all.find(x => x.id === id)
    return {
      moveId: id,
      actionTime: m?.actionTime ?? 0,
      damage: getRowValue(m, 'damage'),
      daze: getRowValue(m, 'daze'),
      decibel: getRowValue(m, 'decibel_recovery'),
      gash: getRowValue(m, 'gash_buildup'),
      sharpness: getRowValue(m, 'sharpness_gain'),
    }
  }
  const basicId = agent.basicBenchmarkMoveId ?? '1601003'
  const basic = metaOf(basicId)
  const perSeconds = (v: number) => (basic.actionTime > 0 ? v / basic.actionTime : 0)
  cfg.sunbringerMeta = {
    basic: {
      damagePerSec: perSeconds(basic.damage),
      gashPerSec: perSeconds(basic.gash),
      sharpPerSec: perSeconds(basic.sharpness),
    },
    ex: metaOf('1601106'),
    jufeng: metaOf('1601015'),
    changan: metaOf('1601107'),
    torch: metaOf('1601007'),
    ultA: metaOf('1601111'),
    ultB: metaOf('1601011'),
    maim: metaOf('1601114'),
    chain: metaOf('1601110'),
    sharpnessRegen: agent.level60.sharpnessRegen ?? 0,
  }
  // 招架支援失衡 +50%（3.4.1+19997538 新增）：按**表值**预缩，patchExecutions 里打 override。
  // 认行口径 = 本角色的「招架支援」行（原文点的是德蕾琪娜的招架，即挽昼自己的招架段），
  // 不列 moveId 名单——角色自己的表结构变了也不会漏（规则 6 的同一取向：按数据认行）。
  const parryMoves = all.filter(m => m.skillType === 'assist' && /招架支援/.test(m.name.zhCN ?? ''))
  if (parryMoves.length > 0) {
    cfg.sunbringerParryDazeById = Object.fromEntries(parryMoves.map(m => [
      m.id,
      Math.round(getRowValue(m, 'daze') * (1 + PARRY_ASSIST_DAZE_BONUS / 100) * 1000) / 1000,
    ]))
  }
}

/**
 * 六条循环的**唯一求解入口**（executions 与测试都读它）：按时间预算顺序分配次数，
 * 口径见文件头表格。返回值为「本局各段次数 + 中间池」，全部为可展示/可断言的纯数。
 */
export function solveSunbringerLoops(input: {
  meta: SunbringerMeta
  combatTime: number
  basicTime: number
  chainCount: number
  totalDecibel: number
  ultimateCost: number
  /** 命座等级（影画1：进战 +120 愿力；影画2：其他招式 12% 烬痕） */
  cinemaLevel?: number
  /**
   * 本局反制支援次数（Boss 控制技组数，store 折算注入 `cfg.counterAssistCount`）。
   * 一次反制支援 = 1601204 希望堡垒 + 1601205 灯塔（融合成一次动作）；灯塔原文「重击命中敌人时，
   * **直接为目标添加 1 层[残痕]**」⇒ 每组**白送 1 层**（600 点），不吃积蓄效率倍率、受同时存量 3 层上限。
   * 与克拉蕾 1611028+1611030 的「琢形送层」同口径（`claret.ts#computeClaretSharpResource`）。
   */
  counterAssistCount?: number
}) {
  const { meta, combatTime, basicTime, chainCount, totalDecibel, ultimateCost } = input
  const sharpPool = SHARPNESS_INITIAL + meta.sharpnessRegen * combatTime + meta.basic.sharpPerSec * basicTime
  let budget = Math.max(0, combatTime)
  const exMax = meta.ex.actionTime > 0 ? Math.floor(budget / meta.ex.actionTime) : 0
  const exCount = Math.max(0, Math.min(Math.floor(sharpPool / SHARPNESS_COST_PER_EX), exMax))
  budget = Math.max(0, budget - exCount * meta.ex.actionTime)

  // 残痕来源：平A 秒均 + 强特/连携表值 + **反制支援灯塔送的层**（每组 +600 点，不吃积蓄效率）
  const counterGiftStacks = Math.max(0, Math.floor(input.counterAssistCount ?? 0))
  const gash = meta.basic.gashPerSec * basicTime + exCount * meta.ex.gash + chainCount * meta.chain.gash
    + counterGiftStacks * GASH_PER_LAYER
  // 消耗层：强化特殊技与连携技都会「重击命中后消耗」，每次最多 3 层
  const maimDemand = 3 * (exCount + chainCount)
  // 残痕池走**锋御通用池**（`mechanics/gashMaim#allocateBossGashPool`）：单槽调用 = min(层, 需求)，逐位不变；
  // 多锋御同队时由该函数把各槽贡献合并（当前未接线，见 gashMaim 的 debt 段）。
  const gashPool = allocateBossGashPool({
    contributions: [{ slot: 0, points: gash }],
    demand: [{ slot: 0, layers: maimDemand }],
    priority: [0],
  })
  const gashLayers = gashPool.layers
  const maimCount = gashPool.bySlot[0] ?? 0

  // 影画1：进入战场立即获得 120 愿力（勘域 180s 一次 ⇒ 每局一次）
  const wishFromEntry = cinemaLevelOf(input.cinemaLevel) >= 1 ? 120 : 0
  const wishTotal = maimCount * WISH_PER_MAIM + wishFromEntry
  /**
   * 愿力**上限 160**（raw 核心被动 Lv.7「每消除 1 层残痕获得 40 点愿力，最多 160 点」）：
   * 逐层入账、攒满 120 立刻转化一次聚锋（银行余量永远 < 120，故上限只防「攒过 160」这件不可能的事）。
   *
   * ⚠ 与闭式 `floor(wishTotal / 120)` 逐位等价（WISH_MAX = 160 > 120 + 40 ⇒ 钳制永不咬合）：
   *   这条钳制不是数值近似，而是把「上限」这个原文口径写进代码，避免下一个人再从注释里推断它。
   */
  let wishBank = 0
  let jufengFromWish = 0
  const depositWish = (amount: number) => {
    wishBank = Math.min(WISH_MAX, wishBank + Math.max(0, amount))
    if (wishBank >= JU_FENG_WISH_COST) {
      wishBank -= JU_FENG_WISH_COST
      jufengFromWish += 1
    }
  }
  // 顺序与原文一致：先进场（影画1 的 +120），再逐层消除残痕换愿力
  if (wishFromEntry > 0) depositWish(wishFromEntry)
  for (let i = 0; i < maimCount; i++) depositWish(WISH_PER_MAIM)
  const jufengMax = meta.jufeng.actionTime > 0 ? Math.floor(budget / meta.jufeng.actionTime) : 0
  const jufengCount = Math.max(0, Math.min(jufengFromWish, jufengMax))
  budget = Math.max(0, budget - jufengCount * meta.jufeng.actionTime)

  const changanMax = meta.changan.actionTime > 0 ? Math.floor(budget / meta.changan.actionTime) : 0
  const changanCount = Math.max(0, Math.min(jufengCount, changanMax))
  budget = Math.max(0, budget - changanCount * meta.changan.actionTime)

  const ultFeasible = ultimateCost > 0 ? Math.floor(Math.max(0, totalDecibel) / ultimateCost) : 0
  // 旗令优先给「此行，共赴前路」（产愿核）；二段「此愿，重塑万象」由引擎既有的终结技行承担
  const ultACount = Math.max(0, Math.min(jufengCount, ultFeasible))
  /**
   * **强化特殊技·永昼之炬（1601007，消耗[旗令]）必须建模**（用户口径 2026-10-27，逐字）：
   * > 「而**强化 e 两个都要建模**，消耗特殊资源的那个是挽昼自己独特的资源循环。」
   *
   * 「强化 E」= 不耗锐能、改耗**专属资源**的两发：长暗终焉（1601107，耗[链齿]）与
   * 永昼之炬（1601007，耗[旗令]）。raw 原文：「拥有[旗令]时，点按特殊技发动：消耗[旗令]，
   * ……造成大量燎源属性伤害」；长暗终焉同构（「拥有[链齿]时…消耗[链齿]」）。
   * 两种资源都由聚锋各发 1 个 ⇒ 互不挤占槽位，可以各打各的。
   *
   * 分配：旗令**先给**「此行，共赴前路」（产愿核；2026-10-25 裁决不变），**剩余旗令**才由
   * 永昼之炬消化——相对旧「永昼之炬按 0 次」，差别只在「旗令打不完时多打一发」，
   * 终结技次数一位不动。
   *
   * ⚠ 与「耗能 30 的 E」区分（同句）：「两段耗能 30 的 e **只需考虑一个**」——燃灯·晦尽
   * （1601006，at 2.433）与焚夜·曦生（1601106，at 2.5）是**多形态对称数据**（同收益公式）
   * ⇒ 只取已在轮换里的焚夜·曦生，不另开一条线。
   */
  const torchMax = meta.torch.actionTime > 0 ? Math.floor(budget / meta.torch.actionTime) : 0
  const torchCount = Math.max(0, Math.min(jufengCount - ultACount, torchMax))
  budget = Math.max(0, budget - torchCount * meta.torch.actionTime)
  return {
    sharpPool, sharpUsed: exCount * SHARPNESS_COST_PER_EX, exCount,
    gash, gashLayers, maimDemand, maimCount, counterGiftStacks,
    wishTotal, wishSpent: jufengCount * JU_FENG_WISH_COST, jufengCount,
    changanCount, ultFeasible, ultACount, torchCount,
  }
}

function buildSunbringerExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const meta = cfg.sunbringerMeta
  if (!meta) return
  const loops = solveSunbringerLoops({
    meta,
    cinemaLevel: cinemaLevelOf(cfg.sunbringerCinemaLevel),
    combatTime: effectiveCombatTime(state, cfg),
    basicTime: Math.max(0, state.basicAttackTime),
    chainCount: Math.max(0, Math.floor(state.chainCountTotal)),
    totalDecibel: Math.max(0, state.totalDecibel),
    ultimateCost: Number(cfg.ultimateCost),
    counterAssistCount: cfg.counterAssistCount,
  })
  const push = (row: Parameters<typeof moduleExecRow>[0]) => executions.push(moduleExecRow(row))

  if (loops.exCount > 0) {
    const t = meta.ex.actionTime
    push({
      moveId: meta.ex.moveId,
      moveName: '强化特殊技：焚夜·曦生（锐能 30/发）',
      category: 'special',
      count: loops.exCount,
      actionTime: t,
      totalTime: loops.exCount * t,
      damageMultiplier: meta.ex.damage,
      dazeMultiplier: meta.ex.daze,
      decibelRecovery: meta.ex.decibel,
      totalDecibelRecovery: loops.exCount * meta.ex.decibel,
      ...ENERGY_RECOVERY_OFF,
      timeBucket: 'necessary',
    })
  }
  if (loops.jufengCount > 0) {
    const t = meta.jufeng.actionTime
    push({
      moveId: meta.jufeng.moveId,
      moveName: '普通攻击：执旌·聚锋（愿力 120/次）',
      category: 'basic',
      count: loops.jufengCount,
      actionTime: t,
      totalTime: loops.jufengCount * t,
      damageMultiplier: meta.jufeng.damage,
      dazeMultiplier: meta.jufeng.daze,
      decibelRecovery: meta.jufeng.decibel,
      totalDecibelRecovery: loops.jufengCount * meta.jufeng.decibel,
      ...ENERGY_RECOVERY_OFF,
      timeBucket: 'necessary',
    })
  }
  if (loops.changanCount > 0) {
    const t = meta.changan.actionTime
    push({
      moveId: meta.changan.moveId,
      moveName: '强化特殊技：焚夜·长暗终焉（消耗链齿）',
      category: 'special',
      count: loops.changanCount,
      actionTime: t,
      totalTime: loops.changanCount * t,
      damageMultiplier: meta.changan.damage,
      dazeMultiplier: meta.changan.daze,
      decibelRecovery: meta.changan.decibel,
      totalDecibelRecovery: loops.changanCount * meta.changan.decibel,
      ...ENERGY_RECOVERY_OFF,
      timeBucket: 'necessary',
    })
  }
  if (loops.maimCount > 0) {
    // 毁伤 = 附带事件（不占时间）；倍率 = 3.4.1+19850203 新增行 1601114
    push({
      moveId: meta.maim.moveId,
      moveName: '毁伤（每消耗 1 层残痕触发 1 次）',
      category: 'basic',
      count: loops.maimCount,
      actionTime: 0,
      totalTime: 0,
      damageMultiplier: meta.maim.damage,
      ...RECOVERY_OFF,
      timeBucket: 'necessary',
    })
  }
  if (loops.torchCount > 0) {
    const t = meta.torch.actionTime
    push({
      moveId: meta.torch.moveId,
      moveName: '强化特殊技：燃灯·永昼之炬（消耗旗令）',
      category: 'special',
      count: loops.torchCount,
      actionTime: t,
      totalTime: loops.torchCount * t,
      damageMultiplier: meta.torch.damage,
      dazeMultiplier: meta.torch.daze,
      decibelRecovery: meta.torch.decibel,
      totalDecibelRecovery: loops.torchCount * meta.torch.decibel,
      ...ENERGY_RECOVERY_OFF,
      timeBucket: 'necessary',
    })
  }
  if (loops.ultACount > 0) {
    const t = meta.ultA.actionTime
    push({
      moveId: meta.ultA.moveId,
      moveName: '终结技：此行，共赴前路（旗令 → 愿核）',
      category: 'chain',
      count: loops.ultACount,
      actionTime: t,
      totalTime: loops.ultACount * t,
      damageMultiplier: meta.ultA.damage,
      dazeMultiplier: meta.ultA.daze,
      ...RECOVERY_OFF,
      timeBucket: 'necessary',
    })
  }
}

/**
 * 烬痕存量（纯函数，用户 2026-10-25 口径）：
 * **0.75 × 积攒招式的实际伤害之和**——存下来的数字是死数：不再吃失衡易伤、也不吃任何属性。
 * 引擎里以「同乘区倍率」承载（挂到终结技行上），因为积攒行与结算行共用同一套乘区
 * （同基底 def、同元素/防御/抗性/增伤，失衡易伤由引擎全局 coverage 统一供给）⇒
 * 「攒的时候吃到易伤、结算时不再追加」在总量上等价：总贡献 = 0.75 × Σ倍率 × 乘区 × 易伤(一次)。
 * ⚠ 前提：积攒行与结算行同乘区。若将来给某招挂招式级增伤/易伤差异，这里要改成按行加权。
 */
export function computeEmberScar(input: {
  meta: SunbringerMeta
  loops: { jufengCount: number; changanCount: number; ultACount: number }
  ultBCount: number
  /** 影画1：首次聚锋的烬痕量 = 原本 150%；影画2：其他招式按实际伤害 12% 也积攒 */
  cinemaLevel?: number
  exCount?: number
  chainCount?: number
}): number {
  const { meta, loops, ultBCount } = input
  const cinema = cinemaLevelOf(input.cinemaLevel)
  // 影画1：首次聚锋从 75% 提到 112.5%（其余聚锋不变）
  const jufengRate = cinema >= 1 && loops.jufengCount > 0
    ? ((loops.jufengCount - 1) * EMBER_SCAR_RATE + EMBER_SCAR_RATE * 1.5) / loops.jufengCount
    : EMBER_SCAR_RATE
  const qualifying = loops.jufengCount * meta.jufeng.damage * jufengRate
    + (loops.changanCount * meta.changan.damage + loops.ultACount * meta.ultA.damage + ultBCount * meta.ultB.damage) * EMBER_SCAR_RATE
  // 影画2：其他招式（EX/连携）按实际伤害 12% 也积攒
  const otherMoves = cinema >= 2
    ? ((input.exCount ?? 0) * meta.ex.damage + (input.chainCount ?? 0) * meta.chain.damage) * 0.12
    : 0
  return qualifying + otherMoves
}

/**
 * 烬痕结算（用户裁决 2026-10-25：计入总伤害）：
 * 聚锋 / 长暗终焉 / 此行共赴前路 / 此愿重塑万象 的**实际伤害 75%** 累积，被二段终结技消除时等量扣血。
 * 引擎对 1601 只发**一条**终结技行（moveId 1601011「此愿，重塑万象」，由既有的终结技通道认出），
 * 所以：① 本模块不再自己发二段行（否则双计，实测会多出 2 次 16146% 的虚增行）；
 * ② 烬痕按**已物化行的倍率**结算（同一基底，龙格等价），均摊进那次终结技的倍率并打 override。
 * 行名会带上烬痕数值，资源页与执行行都能复核。
 */
export function patchSunbringerExecutions({ cfg, state, executions }: AgentResourceInput): void {
  applySunbringerParryDaze(cfg, executions)
  const meta = cfg.sunbringerMeta
  if (!meta) return
  const ultRow = executions.find(e => e.moveId === meta.ultB.moveId && e.count > 0)
  if (!ultRow) return
  // 烬痕按**同一套循环解**结算（不读已物化行的倍率：patch 与 buildExecutions 的调用次序
  // 在不同轮次里不一致，实测会读到上一轮的次数）。同一基底 ⇒ 倍率空间等价。
  const loops = solveSunbringerLoops({
    meta,
    combatTime: effectiveCombatTime(state, cfg),
    basicTime: Math.max(0, state.basicAttackTime),
    chainCount: Math.max(0, Math.floor(state.chainCountTotal)),
    totalDecibel: Math.max(0, state.totalDecibel),
    ultimateCost: Number(cfg.ultimateCost),
    cinemaLevel: cinemaLevelOf(cfg.sunbringerCinemaLevel),
    // 反制支援送的残痕层会改毁伤次数 ⇒ 烬痕的同源解必须吃同一个输入（否则两处解法分叉）
    counterAssistCount: cfg.counterAssistCount,
  })
  const ember = computeEmberScar({
    meta,
    loops,
    ultBCount: ultRow.count,
    cinemaLevel: cinemaLevelOf(cfg.sunbringerCinemaLevel),
    exCount: loops.exCount,
    chainCount: Math.max(0, Math.floor(state.chainCountTotal)),
  })
  if (!(ember > 0)) return
  const perCast = ember / Math.max(1, ultRow.count)
  // 绝对写（不是 +=）：patch 每轮都会跑，累加会把烬痕重复计入（幂等口径）
  ultRow.damageMultiplier = meta.ultB.damage + perCast
  ultRow.damageMultiplierOverride = true
  ultRow.moveName = `终结技：此愿，重塑万象（愿核；烬痕消除 +${Math.round(ember)}%）`
}

/**
 * [招架支援]失衡值 ×1.5（3.4.1+19997538）：把 `buildCharConfig` 预缩好的值写到命中行上。
 *
 * ⚠ 绝对写 + `dazeMultiplierOverride`（不是 +=）：patch 每轮都会跑，累加会重复放大。
 * ⚠ 与烬痕那段共用同一个 patchExecutions ⇒ 必须**在 meta 早退之前**调用（本函数不依赖 meta）。
 */
function applySunbringerParryDaze(cfg: { sunbringerParryDazeById?: Record<string, number> }, executions: AgentResourceInput['executions']): void {
  const scaled = cfg.sunbringerParryDazeById
  if (!scaled) return
  for (const exec of executions) {
    const daze = scaled[exec.moveId]
    if (!(daze > 0)) continue
    exec.dazeMultiplier = daze
    exec.dazeMultiplierOverride = true
  }
}

/**
 * 兜底池（用户口径 2026-10-27）：「每失衡兜底可以放多个 e」。
 *
 * 窗尾秒数优先塞**耗能 30 的强化特殊技**（焚夜·曦生 1601106；与燃灯·晦尽 1601006 是多形态
 * 对称数据，只取一条线），塞不下的余量仍记 basic。这里**不自己算上限**：引擎
 * `roundInputs#expandExecutedToCounts` 会把认领量**逐招夹紧到本轮真物化的次数**
 * （`FillResourceBudget.executed`），夹掉的秒数退回平A ⇒ 角色一发强特都没打出来时，
 * 下面这个贪心不会抢走平A的轴内占比。
 */
export function expandSunbringerBasicFill(input: {
  fillSec: number
  actionTimeOf: (moveId: string) => number | undefined
}): ReadonlyArray<{ readonly moveId: string; readonly count: number }> {
  const fillSec = Math.max(0, Number(input.fillSec) || 0)
  if (!(fillSec > 0)) return []
  const exT = Math.max(0, input.actionTimeOf(SUNBRINGER_EX_MOVE_ID) ?? 0)
  const n = exT > 0 ? Math.floor(fillSec / exT) : 0
  return [
    { moveId: SUNBRINGER_EX_MOVE_ID, count: n },
    { moveId: 'basic', count: Math.max(0, fillSec - n * exT) },
  ]
}

/**
 * **第二段大招（此愿·重塑万象 1601011）的伤害段 = 1 秒**（用户口径 2026-10-30，逐字）：
 * > 「v1挽昼**第二段大招在第一秒就会把所有伤害打出来，后面3秒都是后摇**，所以这里大招后摇
 * >  放在失衡后面也应当算他所有伤害都吃到失衡易伤了……这个16s的失衡轴最后大招超出去了，
 * >  但你要算都吃到易伤」
 *
 * 落地 = 模块钩子 `axisMoveDamageSeconds`（引擎不认角色 id，判据 26）：轴栈把这一招的易伤折算
 * 分母从「动作全长 4.083s」换成「伤害段 1s」，而后摇照旧占满前台时间（`count`/时间/资源按整段）。
 *
 * ⚠ **只对 1601011 声明**：第一段 1601111（此行，共赴前路 2.883s）没有这句原文，按整段折算。
 * ⚠ 不声明成「窗口延长」：窗口一秒都不变长（那是佩洛伊斯决算 1551016 的口径，见 `stunWindowExtendOnEnd`）。
 */
export const SUNBRINGER_ULT_B_DAMAGE_SECONDS = 1
/** 第二段终结技·此愿，重塑万象（`meta.ultB` 的 moveId；轴内伤害段声明的键） */
export const SUNBRINGER_ULT_B_MOVE_ID = '1601011'
/**
 * 第一段终结技·此行，共赴前路（`meta.ultA` 的 moveId）：**由喧响购买**、消耗 [旗令] 并产出
 * **1 点 [愿核]**（spec 1601「愿核」段原文：「为此类招式消耗 1 点[旗令]」→「获得 1 点[愿核]」）。
 * 轴内它是唯一收费的终结点（`axisMoveFreeOfDecibel` 对二段返回 true）。
 */
export const SUNBRINGER_ULT_A_MOVE_ID = '1601111'
export const sunbringerMechanic: AgentMechanicModule = {
  id: 'agent:sunbringer',
  agentIds: [SUNBRINGER_AGENT_ID],
  name: '挽昼',
  description: 'v1 占位包（3.4.1+19997538 热更）：面板层（初始暴伤→暴击 0.35%/1%、极昼 +40% 暴击 / 无视 20% 防御）'
    + '+ 六条资源循环执行行（锐能→残痕→毁伤→愿火→聚锋→链齿/旗令→愿核→烬痕）+ 招架支援失衡 +50%；影画 1/2 未实现、C3–C6 占位。',
  applyPanel: applySunbringerPanel,
  // 兜底池：窗尾秒数优先塞耗能 30 的强化特殊技（见 expandSunbringerBasicFill 注释）
  expandBasicFill: expandSunbringerBasicFill,
  buildCharConfig: buildSunbringerCharConfig,
  buildExecutions: buildSunbringerExecutions,
  patchExecutions: patchSunbringerExecutions,
  // 轴内易伤折算：第二段大招伤害前置 1s、其余为后摇（用户口径 2026-10-30）
  axisMoveDamageSeconds: (moveId: string) =>
    (moveId === SUNBRINGER_ULT_B_MOVE_ID ? SUNBRINGER_ULT_B_DAMAGE_SECONDS : undefined),
  /**
   * ## 二段终结技**不是喧响大**（用户口径 2026-10-31，逐字）
   * > 「挽昼失衡轴第二个大招消耗的资源不是喧响，但却说我喧响不够只打了一个。」
   *
   * 原文链条：一段「此行，共赴前路」消耗 [旗令] → 产出 1 点 [愿核]；二段「此愿，重塑万象」
   * **消耗 [愿核]**（spec 1601「愿核」表：结果行写死「解除二段终结技（不耗喧响）」）。
   * ⇒ 轴栈里二段不得再收 3000 喧响，否则两段会被算成 6000：实测槽0 喧响 7577 只够
   * 一次「一段+二段」组合 ⇒ 第 2/3 窗两段一起被判 `decibel` 跳过（总量 2 发、轴内 1 发）。
   *
   * 两段的关系用**专属资源流向**表达（`axisSwayFlow`）：一段产 1 愿核、二段耗 1 —— 因此
   * 二段也不会在「一段没打出来」的窗口凭空执行（`producesSway` 未发生 ⇒ `swayLeft` 不足 ⇒ 跳过）。
   * ⚠ 只有二段免喧响：一段仍是真正的喧响大（模块资源解也按 `floor(喧响/单价)` 封顶）。
   */
  axisMoveFreeOfDecibel: (moveId: string) => moveId === SUNBRINGER_ULT_B_MOVE_ID,
  axisSwayFlow: (moveId: string) => {
    if (moveId === SUNBRINGER_ULT_A_MOVE_ID) return { produce: 1 }
    if (moveId === SUNBRINGER_ULT_B_MOVE_ID) return { cost: 1 }
    return undefined
  },
}
