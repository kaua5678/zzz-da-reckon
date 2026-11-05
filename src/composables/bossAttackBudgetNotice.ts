/**
 * **「计算失真」提示**（用户口径 2026-11-04）—— 用户硬填极端交互次数时**只提示、不拦**。
 *
 * 用户逐字：「关于用户硬填怎么算这个无所谓，**提醒了计算失真就行了，不用管错误计算的逻辑**。」
 * 「我们自动交互不能有这个情况，只有**用户主动填写极端数值**时才会失真。」
 *
 * ## 与「入场券」提示的分工（同一通道、不同语义）
 *
 * | 提示 | 回答的问题 | 判据 |
 * |---|---|---|
 * | `capabilityGateNotice` | 「这个机制为什么没生效」 | 能力门未满足（`activeOf` 为假） |
 * | 本文件 | 「**我填的数为什么没兑现**」 | 读入 > boss 出手预算（`capped`） |
 *
 * 两者都走同一条渲染通道（`ResourcePoolView` 顶部 alert）——不另开一套 UI
 * （交接 §五：「『计算失真』提示应复用这条通道，别另开一套」）。
 *
 * ## ⚠ 只提示，不拦（这是口径，不是疏漏）
 *
 * 引擎侧已经**只兑现装得下的量**（`core/bossAttackBudget` 的夹取），所以这里**不做任何否决**：
 * 计算照常完成、结果照常给出，只是如实说明「你填的 N 次里只有 M 次真的打得出来」。
 * 用户明确要求不要为此改变计算逻辑（「不用管错误计算的逻辑」）。
 */
import { bossAttackBudgetReadings, bossAttackBudgetTotals } from '@/core/bossAttackBudget'
import { effectiveBattleTime } from '@/core/effectiveTime'
import type { ActionCountField } from '@/stores/config'

/** 一条失真读数（逐字段；页面逐条渲染，自动交互 note 用单行版） */
export interface BossAttackBudgetMiss {
  field: ActionCountField
  /** 用户填的次数 */
  requested: number
  /** boss 出手预算（= floor(非失衡时间 / 2s)） */
  budget: number
  /** 实际兑现的次数 */
  delivered: number
  /** 非失衡秒数（预算分母，给用户看「为什么是这个预算」） */
  nonStunSeconds: number
}

export interface BossAttackBudgetNotice {
  show: boolean
  title: string
  detail: string
  misses: BossAttackBudgetMiss[]
}

const NONE: BossAttackBudgetNotice = { show: false, title: '', detail: '', misses: [] }

/** 提示所需的**快照**读数（不现读 store：比较入口那一档可能是差分重放出来的） */
export interface BossAttackBudgetNoticeInput {
  /** 有效战斗时间（秒）= 战斗时间 − 无敌时间 */
  effectiveTime: number
  /**
   * 真失衡秒数 —— **必须与引擎预算分母同源**：`plannedStunCount × windowDuration`
   * （引擎 `convergence` 的 `budgetWindows`，原样回传作 `resourceResult.plannedStunCount`）。
   *
   * ⚠ 别改用「覆盖率 × 有效时间」：那是**上一轮**派生量，与计划 K 不同源。旗舰夹具
   * `auto-1611-1141-1211` 填 99 实测 —— 引擎按计划 K（2.95 × 16s = 47.2s）兑现 **66** 次，
   * 覆盖率口径（35.6% × 180s = 64s）只算得出 **58** ⇒ 提示会对着用户宣称「实际兑现 58 次」，
   * 而结果页的闪反行写着 66（自相矛盾：提示比引擎更悲观 8 次）。
   * 便捷入口 `stunSecondsForBudget` 就是这条口径的唯一实现。
   */
  stunSeconds: number
  /** 该槽位的交互次数现状（用户可见的**输入**值） */
  requestedOf: (slot: number, field: ActionCountField) => number
  /** 参与判定的槽位数（0..n） */
  slotCount: number
  /** 槽位名（1-based，与 `ResourcePoolView` 的 `slotLabels` 同源） */
  slotLabels?: readonly string[]
}

/**
 * 算「计算失真」提示（纯函数，不碰 store、不改任何数）。
 *
 * ⚠ 反空洞三条（缺任何一条都会变成噪音，与 `capabilityGateNotice` 同款纪律）：
 * 1. **没有超出预算** ⇒ 不提示（`capped === false`）；
 * 2. **预算为 0**（非失衡时间不足 2s）⇒ 不提示——那是「整场都在失衡」的极端夹具，
 *    提示会变成常亮噪音；
 * 3. **该槽没填这个字段**（`requested <= 0`）⇒ 不提示。
 */
export function bossAttackBudgetNotice(input: BossAttackBudgetNoticeInput): BossAttackBudgetNotice {
  const eff = Math.max(0, Number(input.effectiveTime) || 0)
  const stun = Math.max(0, Math.min(eff, Number(input.stunSeconds) || 0))
  const nonStun = eff - stun
  const missing: BossAttackBudgetMiss[] = []
  for (let slot = 0; slot < Math.max(0, input.slotCount); slot++) {
    const readings = bossAttackBudgetReadings({ nonStunSeconds: nonStun, requestedOf: f => input.requestedOf(slot, f) })
    for (const total of bossAttackBudgetTotals(readings)) {
      if (!total.capped) continue
      if (!(total.budget > 0)) continue
      if (!(total.requested > 0)) continue
      missing.push({
        field: total.field, requested: total.requested, budget: total.budget,
        delivered: total.delivered, nonStunSeconds: nonStun,
      })
    }
  }
  if (missing.length === 0) return NONE
  return {
    show: true,
    title: missing.length === 1 ? '⚠ 有 1 项交互次数超出 Boss 出手频率，计算已按物理上限兑现'
      : '⚠ 有 ' + missing.length + ' 项交互次数超出 Boss 出手频率，计算已按物理上限兑现',
    detail: detailOf(missing, input.slotLabels),
    misses: missing,
  }
}

const FIELD_LABELS: Partial<Record<ActionCountField, string>> = {
  parryCount: '弹刀',
  dodgeCounterCount: '闪避反击',
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}
function lineOf(m: BossAttackBudgetMiss): string {
  const label = FIELD_LABELS[m.field] ?? m.field
  const budget = fmt(m.budget)
  const delivered = fmt(m.delivered)
  return label + '填了 ' + fmt(m.requested) + ' 次，但非失衡时间 ' + m.nonStunSeconds.toFixed(0)
    + 's 里 Boss 出手频率最多给 ' + budget + ' 次（按 2s/次估算）⇒ 实际兑现 ' + delivered + ' 次'
}

function detailOf(misses: readonly BossAttackBudgetMiss[], slotLabels?: readonly string[]): string {
  // ⚠ 纯文本，不要写 Markdown 记法（naive-ui alert 会原样显示星号，`axisFallbackNotice` 实测踩到）
  const body = misses.map((m, i) => (slotLabels?.[i] ? slotLabels[i] + '：' + lineOf(m) : lineOf(m))).join('；')
  return body + '。失衡期内 Boss 瘫痪、不出手，所以可交互的攻击只能来自非失衡时间；'
    + '超出部分不会被计入（不会伪造动作），其余计算照常完成。填多少由你决定，这里只说明差额。'
}

/** 单行版（自动交互 `note` 用；空数组 ⇒ 空串） */
export function bossAttackBudgetNoteText(misses: readonly BossAttackBudgetMiss[]): string {
  if (misses.length === 0) return ''
  return '计算失真：' + misses.map(lineOf).join('；')
}

/**
 * **预算分母的失衡秒数**（提示侧与引擎的**唯一**同源口径）。
 *
 * 引擎在 `convergence` 里用 `budgetWindows = stunCount`（本轮计划窗数）算预算，并把同一个数
 * 原样回传作 `resourceResult.plannedStunCount` ⇒ 提示侧读它 + 同一份 `windowDuration` 即可。
 *
 * `Math.min(eff, …)` 是**显示/文案层**的兜底（`nonStunSeconds` 自己也会夹，这里只是让
 * `nonStunSeconds` 读数不出现负值）；**不影响预算值**——引擎侧刻意不夹，因为 `min` 在
 * 「窗数顶满整场」时会把非失衡压成 0（反例见 `convergence.ts` 的 `budgetWindows` 注释）。
 *
 * ⚠ 缺字段（旧快照 / 探针手搓输入）⇒ 退回 0 ⇒ 非失衡 = 整场，预算**偏宽松**：
 * 提示宁可漏报（不误报），也绝不用另一把尺算出一个和引擎不一样的数。
 */
export function stunSecondsForBudget(args: {
  effectiveTime: number
  plannedStunCount?: number
  windowDuration?: number
}): number {
  const eff = Math.max(0, Number(args.effectiveTime) || 0)
  const k = Number(args.plannedStunCount)
  const w = Number(args.windowDuration)
  if (!Number.isFinite(k) || !Number.isFinite(w) || w <= 0) return 0
  return Math.min(eff, Math.max(0, k) * w)
}

/**
 * 便捷入口：**直接吃真实快照**（`ResourcePoolSnapshot` 的结构子集，页面与 e2e 共用）。
 *
 * ⚠ 参数刻意与快照同形（`resourceResult.plannedStunCount` 嵌在 `resourceResult` 下），
 * **不要**改成摊平字段的入参：摊平后调用方传整份快照时 `plannedStunCount` 取到 `undefined`，
 * `stunSecondsForBudget` 会静默退回「整场非失衡」⇒ 预算虚高（实测 66 → 90）而不报错。
 */
export function bossAttackBudgetNoticeOfSnapshot(snapshot: {
  battleTime: number
  invincibleTime: number
  windowDuration: number
  resourceResult: { plannedStunCount: number }
  slotLabels?: readonly string[]
  interactionCounts: ReadonlyArray<Partial<Record<ActionCountField, number>>>
}): BossAttackBudgetNotice {
  const eff = effectiveBattleTime({ battleTime: snapshot.battleTime, invincibleTime: snapshot.invincibleTime })
  return bossAttackBudgetNotice({
    effectiveTime: eff,
    stunSeconds: stunSecondsForBudget({
      effectiveTime: eff,
      plannedStunCount: snapshot.resourceResult.plannedStunCount,
      windowDuration: snapshot.windowDuration,
    }),
    slotCount: snapshot.interactionCounts.length,
    slotLabels: snapshot.slotLabels,
    requestedOf: (slot, field) => Number(snapshot.interactionCounts[slot]?.[field] ?? 0),
  })
}

/** 只要 miss 清单（自动交互只要这段） */
export function bossAttackBudgetMissesOf(input: BossAttackBudgetNoticeInput): BossAttackBudgetMiss[] {
  return bossAttackBudgetNotice(input).misses
}

