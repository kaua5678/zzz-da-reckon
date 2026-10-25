import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
} from '../types'
import { getRowValue } from '@/data/moveTableQueries'
import { moduleExecRow, RECOVERY_OFF, ENERGY_RECOVERY_OFF } from '@/mechanics/moduleExecRow'

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
 * | 烬痕 | 聚锋/长暗终焉/两个终结技**实际伤害的 75%**；B 清空时**等量计入总伤害** | raw + 用户裁决 2026-10-25 |
 *
 * ## 建模取舍（都写在行名/注释里，便于复核）
 * - **次数上限靠时间**：模块按 `combatTime` 顺序分配预算（EX → 聚锋 → 长暗终焉），超预算就少打；
 *   不挤平A 的秒数由折叠环自己收敛（与克拉蕾葬血强袭同款）。
 * - **终结技可行性**用 `floor(totalDecibel / ultimateCost)` 封顶（引擎对 1601 没有 ultimate 行 ——
 *   两个终结技的 `skillType` 都没标 ultimate）；两条终结技行一律 `RECOVERY_OFF`，不回填喧响，避免虚增。
 * - 毁伤**不进时间**（附带事件，actionTime 0）；烬痕均摊到每次 B 的倍率上。
 * - 影画 1/2 文本已有（3.4.1+19850203）但**未实现**；C3–C6 仍占位。
 */
const SUNBRINGER_AGENT_ID = '1601'

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
/** 残痕：每 600 点 = 1 层（用户裁决：沿用克拉蕾口径） */
export const GASH_PER_LAYER = 600
/** 残痕：敌人身上同时存量上限 3 层 */
export const GASH_MAX_STACKS = 3
/** 愿力：每消除 1 层残痕 +40，上限 160 */
export const WISH_PER_MAIM = 40
export const WISH_MAX = 160
/** 愿力：一次聚锋消耗 120 */
export const JU_FENG_WISH_COST = 120
/** 烬痕：按实际伤害的 75% 累积并计入总伤害 */
export const EMBER_SCAR_RATE = 0.75

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
  }
}

export function applySunbringerPanel({ panel, outOfCombatPanel }: AgentPanelInput): void {
  // 核心被动·初始转化：只读局外面板，整 1% floor（与克拉蕾同口径）
  const initialCritDmg = outOfCombatPanel.critDmg
  if (initialCritDmg > 0) {
    panel.critRate = panel.critRate + Math.floor(initialCritDmg + 1e-9) * INITIAL_CRIT_DMG_TO_CRIT_RATE
  }
  // 极昼：满覆盖近似（见文件头）
  panel.critRate = panel.critRate + POLAR_DAY_CRIT_RATE
  panel.enemyDefReduction = panel.enemyDefReduction + POLAR_DAY_DEF_IGNORE
}

function buildSunbringerCharConfig({ cfg, skills, agent }: AgentCharConfigInput): void {
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
    ultA: metaOf('1601111'),
    ultB: metaOf('1601011'),
    maim: metaOf('1601114'),
    chain: metaOf('1601110'),
    sharpnessRegen: agent.level60.sharpnessRegen ?? 0,
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
}) {
  const { meta, combatTime, basicTime, chainCount, totalDecibel, ultimateCost } = input
  const sharpPool = SHARPNESS_INITIAL + meta.sharpnessRegen * combatTime + meta.basic.sharpPerSec * basicTime
  let budget = Math.max(0, combatTime)
  const exMax = meta.ex.actionTime > 0 ? Math.floor(budget / meta.ex.actionTime) : 0
  const exCount = Math.max(0, Math.min(Math.floor(sharpPool / SHARPNESS_COST_PER_EX), exMax))
  budget = Math.max(0, budget - exCount * meta.ex.actionTime)

  const gash = meta.basic.gashPerSec * basicTime + exCount * meta.ex.gash + chainCount * meta.chain.gash
  const gashLayers = Math.max(0, Math.floor(gash / GASH_PER_LAYER))
  // 消耗层：强化特殊技与连携技都会「重击命中后消耗」，每次最多 3 层
  const maimDemand = 3 * (exCount + chainCount)
  const maimCount = Math.max(0, Math.min(gashLayers, maimDemand))

  const wishTotal = maimCount * WISH_PER_MAIM
  const jufengMax = meta.jufeng.actionTime > 0 ? Math.floor(budget / meta.jufeng.actionTime) : 0
  const jufengCount = Math.max(0, Math.min(Math.floor(wishTotal / JU_FENG_WISH_COST), jufengMax))
  budget = Math.max(0, budget - jufengCount * meta.jufeng.actionTime)

  const changanMax = meta.changan.actionTime > 0 ? Math.floor(budget / meta.changan.actionTime) : 0
  const changanCount = Math.max(0, Math.min(jufengCount, changanMax))
  budget = Math.max(0, budget - changanCount * meta.changan.actionTime)

  const ultFeasible = ultimateCost > 0 ? Math.floor(Math.max(0, totalDecibel) / ultimateCost) : 0
  // 旗令优先给「此行，共赴前路」（产愿核）；二段「此愿，重塑万象」由引擎既有的终结技行承担
  const ultACount = Math.max(0, Math.min(jufengCount, ultFeasible))
  return {
    sharpPool, sharpUsed: exCount * SHARPNESS_COST_PER_EX, exCount,
    gash, gashLayers, maimDemand, maimCount,
    wishTotal, wishSpent: jufengCount * JU_FENG_WISH_COST, jufengCount,
    changanCount, ultFeasible, ultACount,
  }
}

function buildSunbringerExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const meta = cfg.sunbringerMeta
  if (!meta) return
  const loops = solveSunbringerLoops({
    meta,
    combatTime: Math.max(0, state.frontlineTime + state.backstageTime),
    basicTime: Math.max(0, state.basicAttackTime),
    chainCount: Math.max(0, Math.floor(state.chainCountTotal)),
    totalDecibel: Math.max(0, state.totalDecibel),
    ultimateCost: Number(cfg.ultimateCost),
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
 * 烬痕结算（用户裁决 2026-10-25：计入总伤害）：
 * 聚锋 / 长暗终焉 / 此行共赴前路 / 此愿重塑万象 的**实际伤害 75%** 累积，被二段终结技消除时等量扣血。
 * 引擎对 1601 只发**一条**终结技行（moveId 1601011「此愿，重塑万象」，由既有的终结技通道认出），
 * 所以：① 本模块不再自己发二段行（否则双计，实测会多出 2 次 16146% 的虚增行）；
 * ② 烬痕按**已物化行的倍率**结算（同一基底，龙格等价），均摊进那次终结技的倍率并打 override。
 * 行名会带上烬痕数值，资源页与执行行都能复核。
 */
function patchSunbringerExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const meta = cfg.sunbringerMeta
  if (!meta) return
  const ultRow = executions.find(e => e.moveId === meta.ultB.moveId && e.count > 0)
  if (!ultRow) return
  // 烬痕按**同一套循环解**结算（不读已物化行的倍率：patch 与 buildExecutions 的调用次序
  // 在不同轮次里不一致，实测会读到上一轮的次数）。同一基底 ⇒ 倍率空间等价。
  const loops = solveSunbringerLoops({
    meta,
    combatTime: Math.max(0, state.frontlineTime + state.backstageTime),
    basicTime: Math.max(0, state.basicAttackTime),
    chainCount: Math.max(0, Math.floor(state.chainCountTotal)),
    totalDecibel: Math.max(0, state.totalDecibel),
    ultimateCost: Number(cfg.ultimateCost),
  })
  const totalMultiplier = loops.jufengCount * meta.jufeng.damage
    + loops.changanCount * meta.changan.damage
    + loops.ultACount * meta.ultA.damage
    + ultRow.count * meta.ultB.damage
  const ember = totalMultiplier * EMBER_SCAR_RATE
  if (!(ember > 0)) return
  const perCast = ember / Math.max(1, ultRow.count)
  // 绝对写（不是 +=）：patch 每轮都会跑，累加会把烬痕重复计入（幂等口径）
  ultRow.damageMultiplier = meta.ultB.damage + perCast
  ultRow.damageMultiplierOverride = true
  ultRow.moveName = `终结技：此愿，重塑万象（愿核；烬痕消除 +${Math.round(ember)}%）`
}

export const sunbringerMechanic: AgentMechanicModule = {
  id: 'agent:sunbringer',
  agentIds: [SUNBRINGER_AGENT_ID],
  name: '挽昼',
  description: 'v1 占位包（3.4.1+19850203）：面板层（初始暴伤→暴击 0.35%/1%、极昼 +40% 暴击 / 无视 20% 防御）'
    + '+ 六条资源循环执行行（锐能→残痕→毁伤→愿力→聚锋→链齿/旗令→愿核→烬痕）；影画 1/2 未实现、C3–C6 占位。',
  applyPanel: applySunbringerPanel,
  buildCharConfig: buildSunbringerCharConfig,
  buildExecutions: buildSunbringerExecutions,
  patchExecutions: patchSunbringerExecutions,
}
