/**
 * **倍率贡献账**（2026-10-20，通用贡献账的第二个适配器）。
 *
 * ⚠ **落点必须在 `composables/`，不能在 `core/`**（2026-10-20 分层判据实测）：
 * 本模块要读 `data/moveTableQueries`（倍率表唯一取值口），而它经 `logicEditor/fusion` 触达编辑层；
 * `coreRuntimeDeps.test`（CC-247）明令 core 的运行时依赖闭包**不得进入 logicEditor**。
 * ⇒ core 只放「与数据无关的纯结构」（`contributionLedger` / `attributeLedger`），
 *   凡需要读 `data/` 的适配器一律住 `composables/`。
 *
 * ## 用户口径
 * > 「不仅仅是属性计算，你的倍率求和、喧响求和其实都是这样算的。最好把能通用的全通用起来，
 * >   这种计算逻辑不要分太多小部件相加，矩阵的延展性也很好，有新数据了直接加一列就行。」
 *
 * ## 与属性账的关系
 * 属性账回答「面板上的攻击 4872 是谁给的」；倍率账回答「这个招式的 1194.5% 是怎么拼出来的」。
 * 两者共用 `core/contributionLedger`，**不重写求和逻辑**——这正是「加维度只改适配器」的验证。
 *
 * ## 数据从哪来（不新造）
 * 倍率只有一个事实源：**倍率表**（`agentSkills` 的 move rows）。
 * - 单段招式：倍率 = 该 move 的 `damage` 行值；
 * - 融合招式（`data/moveFusions.ts` 登记）：倍率 = Σ(各段行值 × 段数)，与 `fusedRowValue` 同式。
 *
 * ⇒ 本模块把**同一份来源**摊成贡献：每段一条 `Contribution`。
 * 这样「1194.5% 由哪几段组成」与「引擎实际取的值」永远同源（都用 `getRowValue`）。
 */
import { findMoveById, getRowValue } from '@/data/moveTableQueries'
import { moveFusionByMoveId } from '@/data/moveFusions'
import {
  buildLedgerTable,
  type Contribution,
  type LedgerTable,
} from '@/core/contributionLedger'
import type { AgentSkills } from '@/types/catalog'
import { localized } from '@/utils/format'

/** 倍率账里被拆解的「行类型」（倍率表 kind；与引擎取值的 rowId 一致） */
export type MultiplierRowKind = 'damage' | 'daze' | 'anomaly_buildup'

export interface MoveSegment {
  moveId: string
  name: string
  /** 融合组内该段的次数（单段招式恒为 1） */
  count: number
  /** 单次倍率（`getRowValue` 原值） */
  valuePerCast: number
  /** 本段合计 = 单次 × 次数 */
  amount: number
}

export interface MultiplierContributionRow {
  /** 招式 id（融合组取组头 id） */
  moveId: string
  moveName: string
  /** 该招式在本账里的总倍率（各段之和） */
  total: number
  segments: MoveSegment[]
}

/**
 * 拆一个招式在某个行类型上的倍率构成。
 *
 * ⚠ **单一来源**：每段单次值走 `getRowValue`（与引擎填入 `SkillExecution.damageMultiplier`
 * 的是同一个函数），段数走 `moveFusions` 登记的 `count`（与 `fusedRowValue` 同一份数据）。
 * 不要在这里另写「按 moveId 查表求和」——那正是本仓反复踩的两处实现漂移。
 *
 * @returns 段明细 + 合计；招式不存在或无该行 ⇒ null
 */
export function splitMoveMultiplier(
  skills: AgentSkills | undefined,
  moveId: string,
  rowKind: MultiplierRowKind,
): MultiplierContributionRow | null {
  if (!skills) return null
  const group = moveFusionByMoveId.get(moveId)
  const terms = group?.terms ?? [{ moveId, count: 1 }]
  const head = findMoveById(skills, moveId)
  const moveName = head ? localizedMoveName(head) : moveId

  const segments: MoveSegment[] = []
  for (const term of terms) {
    const member = findMoveById(skills, term.moveId)
    if (!member) continue
    const valuePerCast = getRowValue(member, rowKind)
    if (!valuePerCast) continue
    segments.push({
      moveId: term.moveId,
      name: localizedMoveName(member),
      count: term.count,
      valuePerCast,
      amount: valuePerCast * term.count,
    })
  }
  if (!segments.length) return null

  const total = segments.reduce((a, s) => a + s.amount, 0)
  return { moveId, moveName, total, segments }
}

/**
 * 招式显示名：走仓库单一事实源 `utils/format#localized`（规则 11）。
 * 不要自己写 `name as { zhCN?… }` —— 那是判据 27 拦的类型字面量断言，
 * 且会重造一份与 `localized` 可能漂移的实现。
 */
function localizedMoveName(move: { id: string; name?: unknown }): string {
  return localized(move.name, move.id)
}

/** 行类型的显示名（倍率账列头用） */
export const MULTIPLIER_ROW_LABELS: Record<MultiplierRowKind, string> = {
  damage: '伤害倍率',
  daze: '失衡倍率',
  anomaly_buildup: '异常积蓄',
}

const ROW_KIND_ORDER: MultiplierRowKind[] = ['damage', 'daze', 'anomaly_buildup']

/**
 * 把一组招式摊成**倍率贡献账**（提供者 × 行类型 × 段）。
 *
 * 维度选择（与属性账对齐）：
 * - **列（key）** = 行类型——倍率的「属性区」；
 * - **行（origin）** = 招式（融合组取组名）；
 * - **第三维（slotKey）** = 具体段（`段:<moveId>×<count>`），区分融合组里谁贡献多少。
 */
export function buildMultiplierLedger(
  skills: AgentSkills | undefined,
  moveIds: readonly string[],
  rowKinds: readonly MultiplierRowKind[] = ROW_KIND_ORDER,
): LedgerTable<string> {
  const contributions: Contribution[] = []
  for (const moveId of moveIds) {
    for (const rowKind of rowKinds) {
      const split = splitMoveMultiplier(skills, moveId, rowKind)
      if (!split) continue
      for (const seg of split.segments) {
        contributions.push({
          key: rowKind,
          amount: seg.amount,
          mode: 'pct',
          origin: { key: `move|${split.moveId}`, label: split.moveName, kind: 'move', slot: -1 },
          slotKey: `段:${seg.moveId}×${seg.count}`,
          detail: seg.count > 1 ? `${seg.name} ×${seg.count}` : seg.name,
        })
      }
    }
  }
  return buildLedgerTable(contributions, {
    keyOf: c => c.key,
    amountOf: c => c.amount,
    modeOf: c => c.mode,
    originOf: c => c.origin,
    detailOf: c => c.detail ?? '',
    idOf: c => `${c.origin?.key}|${c.key}|${c.slotKey ?? ''}`,
    slotKeyOf: c => c.slotKey ?? '',
    orderKey: key => ROW_KIND_ORDER.indexOf(key as MultiplierRowKind),
  })
}
