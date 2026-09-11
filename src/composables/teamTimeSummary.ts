/**
 * 全队时间分配汇总（纯函数，结果页「时间分配汇总」卡的唯一事实源）。
 *
 * 为什么单独成模块：这张卡历史上只报**账本口径**（Σ necessaryTime），而角色卡的时间条画的是
 * **物化执行行**。折叠循环（坑12/19）会把未计入 estimate 的模块行折进 necessaryTime，于是
 * 「卡说 166.9/180 快满了、角色条却只打了 86s」——同一件事两个数，用户只能猜。本模块把两套
 * 口径并列输出并做留白归因（账本虚高 / 平A行缩水），页面只负责渲染。
 *
 * 口径对齐：
 * - 物化净占用走 `netFrontlineOccupation`（超时判定单一事实源，与轴退化/降配、队伍对比同源）；
 * - 合轴抵扣只算 `comboAlignCredit`（含在 necessary 内的部分；NET 约定模块已剔除，不重复抵）。
 */
import { netFrontlineOccupation } from '@/core/resource/helpers'
import { isFrontlineExecution } from '@/types/resource'
import type { SkillExecution, TeamResourceResult, TruncationCut } from '@/types/resource'

export interface TeamTimeSlotSummary {
  slot: number
  name: string
  /** 账本必要前台（扣合轴抵扣） */
  requiredFrontline: number
  /** 物化必要动作行净占用（不含平A行） */
  necRows: number
  /** 分到的平A池（账本） */
  basic: number
  /** 物化平A行净占用 */
  basicRows: number
}

export interface TeamTimeSummary {
  battleTime: number
  invincibleTime: number
  /** 时间预算 = 战斗时间 − 无敌时间（iterate 平A池按此收费） */
  budget: number
  /** 账本：Σ 必要前台毛值（含折叠残差，未扣合轴） */
  actionFrontline: number
  /** 账本：Σ 合轴抵扣 */
  comboAlignDeduction: number
  /** 账本：必要前台净占用 = actionFrontline − comboAlignDeduction */
  requiredFrontline: number
  /** 账本：Σ 平A时间（可分配池实际分出去的量） */
  basicTotal: number
  /** 账本口径下尚未被必要动作吃掉的池 = budget − requiredFrontline */
  remainingFrontlinePool: number
  /** 物化：前台净占用（必要行 + 平A行，扣合轴分摊） */
  rowsNet: number
  /** 时间留白 = budget − rowsNet（正 = 打不满，负 = 超预算） */
  slack: number
  /** 账本虚高 = requiredFrontline − 物化必要行（estimate 高估 + timeBudgetExcess 折叠残差） */
  ledgerInflation: number
  /** 平A行缩水 = basicTotal − 物化平A行（模块改写/挤给转大赠送行，时间守恒） */
  basicShrink: number
  /** 合轴抵扣后净占用仍超预算的量（引擎 overflowSeconds）——**就是装配期真被砍掉的秒数** */
  overflow: number
  /**
   * 装配期被砍掉的招式行清单（按砍掉秒数降序，Σ `cutSeconds` == `overflow`）：资源池「被砍招式」显示源。
   * 为什么要有它：截断此前只报总量，用户看不出砍了什么（2026-09-11 实测般岳+诺姆+卢西娅全关档砍了 66.8s /
   * 21 条行，池子里却显示「已打满」）。
   */
  truncatedRows: TruncationCut[]
  /** 时间预算外层诊断（负残差/回填量/轮数/是否收敛） */
  idle: number
  refund: number
  timeBudgetConverged: boolean
  timeBudgetPasses: number
  perSlot: TeamTimeSlotSummary[]
}

export function buildTeamTimeSummary(args: {
  rr: TeamResourceResult | null
  battleTime: number
  invincibleTime: number
  nameOf: (agentId: string, slot: number) => string
}): TeamTimeSummary {
  const { rr, battleTime, invincibleTime } = args
  const chars = rr?.characters ?? []
  const overlap = rr?.axisOverlapByAction ?? {}
  /** 该槽物化前台行（扣轴内合轴分摊），拆「必要动作行」与「平A行」两段 */
  const slotRows = (slot: number, executions: SkillExecution[]) => {
    let nec = 0
    let basic = 0
    for (const e of executions) {
      if (!isFrontlineExecution(e)) continue
      const net = Math.max(0, (e.totalTime ?? 0) - (overlap[`${slot}:${e.moveId}`] ?? 0))
      if (e.moveId === 'basic_attack') basic += net
      else nec += net
    }
    return { nec, basic }
  }

  const budget = Math.max(0, battleTime - invincibleTime)
  const actionFrontline = chars.reduce((sum, c) => sum + c.timeAllocation.necessaryTime, 0)
  const comboAlignDeduction = chars.reduce((sum, c) => sum + (c.timeAllocation.comboAlignCredit ?? 0), 0)
  const requiredFrontline = Math.max(0, actionFrontline - comboAlignDeduction)
  const basicTotal = chars.reduce((sum, c) => sum + c.timeAllocation.basicAttackTime, 0)
  const rowsNet = rr ? netFrontlineOccupation(rr) : 0
  const rowsNecNet = chars.reduce((sum, c) => sum + slotRows(c.slot, c.executions).nec, 0)
  const rowsBasicNet = chars.reduce((sum, c) => sum + slotRows(c.slot, c.executions).basic, 0)

  return {
    battleTime,
    invincibleTime,
    budget,
    actionFrontline,
    comboAlignDeduction,
    requiredFrontline,
    basicTotal,
    remainingFrontlinePool: Math.max(0, budget - requiredFrontline),
    rowsNet,
    slack: budget - rowsNet,
    ledgerInflation: requiredFrontline - rowsNecNet,
    basicShrink: basicTotal - rowsBasicNet,
    overflow: rr?.overflowSeconds ?? 0,
    truncatedRows: [...(rr?.truncationCuts ?? [])].sort((a, b) => b.cutSeconds - a.cutSeconds),
    idle: rr?.convergence?.timeBudgetIdleSeconds ?? 0,
    refund: rr?.convergence?.timeBudgetRefundedSeconds ?? 0,
    timeBudgetConverged: rr?.convergence?.timeBudgetConverged ?? true,
    timeBudgetPasses: rr?.convergence?.timeBudgetPasses ?? 0,
    perSlot: chars.map(c => {
      const rows = slotRows(c.slot, c.executions)
      return {
        slot: c.slot,
        name: args.nameOf(c.agentId, c.slot),
        requiredFrontline: Math.max(0, c.timeAllocation.necessaryTime - (c.timeAllocation.comboAlignCredit ?? 0)),
        necRows: rows.nec,
        basic: c.timeAllocation.basicAttackTime,
        basicRows: rows.basic,
      }
    }),
  }
}

/** 平A池分出去了多少（池为 0 = 必要动作已占满预算，不显示百分比） */
export function poolFillText(t: TeamTimeSummary): string {
  if (t.remainingFrontlinePool <= 0.05) return '池已被必要动作占满'
  return `${((t.basicTotal / t.remainingFrontlinePool) * 100).toFixed(0)}%`
}

/** 招式短名（列表用）：`强化特殊技：论道（山威·论道连段）` → `论道` */
export function shortMoveName(moveName: string, moveId: string): string {
  const afterColon = moveName.includes('：') ? moveName.slice(moveName.indexOf('：') + 1) : moveName
  const noParen = afterColon.replace(/（[^）]*）/g, '').trim()
  return noParen || moveId
}

/**
 * 截断归因一句话（用户 2026-09-11：池子必须让人看见「砍了什么」）：
 * `被砍 66.8s / 21 条行：论道 10→7、不动如山 25→17、撼天动地 3→2，等 21 条`。
 * 末尾固定提示「被砍招式的回能/喧响仍在账本里」——这是 A 项（截断回灌资源循环）未落地前的已知不一致。
 */
export function truncationHint(t: TeamTimeSummary, fmt: (v: number, d?: number) => string, topN = 3): string {
  const rows = t.truncatedRows
  if (rows.length === 0) return ''
  const head = rows.slice(0, topN)
    .map(r => `${shortMoveName(r.moveName, r.moveId)} ${fmt(r.countBefore, 0)}→${fmt(r.countAfter, 0)}`)
    .join('、')
  const more = rows.length > topN ? `，等 ${rows.length} 条` : ''
  return `砍掉 ${fmt(t.overflow, 1)}s / ${rows.length} 条行：${head}${more}；被砍招式的回能/喧响仍计在账本里（待 A 项修）`
}

/** 留白归因一句话：打满 / 超预算 / 未打满（拆成账本虚高 + 平A行缩水） */
export function slackHint(t: TeamTimeSummary, fmt: (v: number, d?: number) => string): string {
  if (t.slack < -1) return `动作比战斗时间还多 ${fmt(-t.slack, 1)}s（轴/交互太厚）`
  if (t.slack <= 1) return '战斗时间已打满'
  return `未打满 = 账本虚高 ${fmt(Math.max(0, t.ledgerInflation), 1)}s + 平A行缩水 ${fmt(Math.max(0, t.basicShrink), 1)}s`
}
