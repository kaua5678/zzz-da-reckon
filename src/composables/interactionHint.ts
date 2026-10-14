/**
 * **交互栏提示**（用户口径 2026-10-14）—— 纯函数，页面只负责渲染。
 *
 * ## 用户原话（逐字，改这里前先读）
 *
 * > 「如果是手动填充，需要在**交互栏旁边给个提示，平A时间被挤压成多少秒，合轴率提升，是软提示**，
 * >  **硬提示是你这个交互提升超过合轴上限后，招式因为超时而截断**。这样提醒用户填合适的交互次数，
 * >  **如果他硬填，那么就截断其他招式来换交互时间**。」
 *
 * ## 两条提示的分工（**判据不同，不许合并**）
 *
 * | 档 | 判据（引擎读数，非页面重算） | 含义 | 用户该做什么 |
 * |---|---|---|---|
 * | **软提示** `soft` | 装得下（无截断），但平A 池被挤得很小 / 合轴正在吸收 | 交互**正在**占用本该平A的时间，但**还装得下** | 可调；代价是少打平A |
 * | **硬提示** `hard` | `overflowSeconds > 容差`（装配期**真截断**） | 交互已超合轴能吸收的上限 ⇒ **招式被砍** | 减交互，或接受砍招 |
 *
 * ⚠ **为什么必须分两档**：软提示若也报红，用户会对"正常挤压"麻木；硬提示若不报，
 * 用户看到伤害掉了却不知道为什么（这正是 T166 诊断里 `banyue-jufufu-lucia` 的形态）。
 *
 * ## 「硬填就截断其他招式换交互时间」是**引擎既有行为**，本模块只做**如实上报**
 *
 * 用户裁决的硬填语义 = 「交互优先，装不下就砍别的」——这正是装配期截断
 * （`core/resource/timeTruncation.ts#truncateExecutionsToFrontline`：按比例 floor + 小数降序加回，
 * 砍到 0 的行整行消失）在做的事。**本模块不新增砍法**，只把「砍了谁」列出来。
 *
 * ⚠ **不区分「交互行」与「其他招式行」**（有意）：那需要一张 moveId → 交互 的表，而
 * 判据 26（id-literal gate）明令角色/招式 id 只许住 `src/data` / `src/mechanics/agents` / `src/specs`
 * ⇒ 本模块**不认 id**。用户口径要的是「招式因为超时而截断」，**一张完整的被砍清单**就满足它，
 * 且比按 id 猜分组更诚实（交互行本来也在可截断集合里，见 `truncateMoveRows` 的 `isTruncatable`）。
 *
 * ## 口径单一来源（规则 11）
 *
 * - 平A 池：`TimeAllocation.basicAttackTime`（iterate 分配结果）
 * - 合轴吸收：`TimeAllocation.dynamicComboAlignSeconds`（吸收的**实际**读数；页面按比例重算会与
 *   引擎闭式解分叉，见 `helpers.ts#solveComboAlignTakeFullCapacity`）
 * - 截断：`TeamResourceResult.overflowSeconds` / `truncationCuts`（超时判定与「被砍招式」同源）
 * - 战斗时间：`TeamResourceResult.totalTime`（⚠ 含无敌时间——`TeamResourceResult` 不带
 *   `invincibleTime`，故这里**不**调 `effectiveBattleTime` 假装精确；只拿它做量级判断）
 *
 * ## ⚠ 本模块**不**回答「平A 本该是多少」
 *
 * 「被挤压」的反事实基线（= 没有交互时池有多大）需要**重跑一次引擎**才能得到，页面里重算
 * 既贵又会与主路径分叉。故这里只如实报**当前池值**与**它占战斗时间的比例**——用户看到
 * 「平A 0.20s / 180s」自己就知道被挤干了，**不伪造一个算不出来的基线**。
 */
import type { TeamResourceResult, TruncationCut } from '@/types/resource'

/** 提示强度（页面据此上色；`none` 不渲染） */
export type InteractionHintLevel = 'none' | 'soft' | 'hard'

/** 被砍的一行（截断明细的精简投影，页面只读这几个字段） */
export interface InteractionHintCut {
  moveId: string
  label: string
  countBefore: number
  countAfter: number
  cutSeconds: number
}

export interface InteractionHint {
  level: InteractionHintLevel
  /** 一句话主提示（`level === 'none'` 时为空串） */
  text: string
  /** 该槽分到的平A时间（秒） */
  basicAttackTime: number
  /** 该槽被合轴吸收的秒数（`dynamicComboAlignSeconds` 实际读数） */
  absorbedSeconds: number
  /** 全队装配期被砍掉的秒数（= `overflowSeconds`，超时判定同一把尺） */
  truncatedSeconds: number
  /** 该槽被砍的行（按砍掉秒数降序） */
  cutRows: InteractionHintCut[]
}

const EMPTY: InteractionHint = {
  level: 'none', text: '', basicAttackTime: 0, absorbedSeconds: 0, truncatedSeconds: 0, cutRows: [],
}

/** `TruncationCut.moveName` 已是可读名（`招架支援：铁壁 #1`）⇒ 取冒号后那段并去括号与序号 */
function shortLabel(c: TruncationCut): string {
  const afterColon = c.moveName.includes('：') ? c.moveName.slice(c.moveName.indexOf('：') + 1) : c.moveName
  return afterColon.replace(/（[^）]*）/g, '').replace(/#\d+/, '').trim() || c.moveId
}

/** 前 N 条拼成 `铁壁 6→5、不动如山 15→14`，超出补「，等 N 条」 */
function joinCuts(rows: readonly InteractionHintCut[], topN: number): string {
  const head = rows.slice(0, topN).map(r => `${r.label} ${r.countBefore}→${r.countAfter}`).join('、')
  return rows.length > topN ? `${head}，等 ${rows.length} 条` : head
}

/**
 * 构造某槽的交互提示。
 *
 * @param rr 引擎资源结果（null = 未就绪 ⇒ `none`）
 * @param slot 目标**槽位号**（⚠ 不是下标——`characters` 按位置压缩，一律 `.find(c => c.slot === slot)`，见 AGENTS §2）
 * @param toleranceSeconds 硬提示容差（秒）。缺省 `1`（= 引擎 `TIME_BUDGET_TOLERANCE_SECONDS`）；
 *   调用方若要显式传，应与引擎同一把尺。
 */
export function buildInteractionHint(
  rr: TeamResourceResult | null,
  slot: number,
  toleranceSeconds = 1,
): InteractionHint {
  if (!rr) return EMPTY
  const ch = rr.characters.find(c => c.slot === slot)
  if (!ch) return EMPTY

  const t = ch.timeAllocation
  const basic = Math.max(0, t.basicAttackTime)
  const absorbed = Math.max(0, t.dynamicComboAlignSeconds ?? 0)
  const truncated = Math.max(0, rr.overflowSeconds ?? 0)
  const budget = Math.max(0, rr.totalTime)

  const cutRows = (rr.truncationCuts ?? [])
    .filter(c => c.slot === slot)
    .map(c => ({
      moveId: c.moveId, label: shortLabel(c),
      countBefore: c.countBefore, countAfter: c.countAfter, cutSeconds: c.cutSeconds,
    }))
    .sort((a, b) => b.cutSeconds - a.cutSeconds)

  const base = { basicAttackTime: basic, absorbedSeconds: absorbed, truncatedSeconds: truncated, cutRows }

  // ===== 硬提示：装配期真截断 ⇒ 招式被砍（= 用户口径的「超过合轴上限」）=====
  if (truncated > toleranceSeconds) {
    const parts = [`⚠ 交互超出合轴可吸收的上限：时间截断 ${truncated.toFixed(1)}s`]
    if (cutRows.length > 0) parts.push(`已砍招式：${joinCuts(cutRows, 4)}`)
    return { level: 'hard', text: parts.join('；'), ...base }
  }

  // ===== 软提示：装得下，但平A 被挤 / 合轴正在吸收 =====
  const soft: string[] = []
  if (budget > 0 && basic < budget * 0.05) soft.push(`平A 只剩 ${basic.toFixed(2)}s（交互已占满前台）`)
  else if (basic < 5) soft.push(`平A 仅 ${basic.toFixed(2)}s`)
  if (absorbed > 0.5) soft.push(`合轴已吸收 ${absorbed.toFixed(1)}s（可上调「合轴吸收上限」换更多前台）`)
  if (soft.length === 0) return { level: 'none', text: '', ...base }
  return { level: 'soft', text: soft.join('；'), ...base }
}
