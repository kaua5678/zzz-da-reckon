/**
 * **喧响贡献账**（2026-10-20，通用贡献账的第三个适配器）。
 *
 * ## 用户口径
 * > 「不仅仅是属性计算，你的倍率求和、喧响求和其实都是这样算的。最好把能通用的全通用起来，
 * >   这种计算逻辑不要分太多小部件相加，矩阵的延展性也很好，有新数据了直接加一列就行。」
 *
 * ## 为什么这里特别适合
 * `DecibelSource`（`types/resource/energy.ts`）**已经有天然的来源分类**：
 * 开局赠送 / 招式回复 / 奖励 / 时光切片 / 特殊动作 / 异常奖励 / 队友伴随 / 不可分享 / 烧血。
 * 但此前它们只是「一堆数字字段」，玩家看不出「我这 8000 喧响是从哪来的」。
 *
 * ⇒ 本模块把**同一份字段**摊成贡献（不重算、不新造数据源）：
 * - **列** = 喧响的「性质」（可分享 / 不可分享），对应引擎 `shareableTotal` vs `total` 的口径分界；
 * - **行（提供者）= 来源类别**；
 * - **第三维** = 细分（`来源:skillRegen` 等），保证唯一落位。
 *
 * ⚠ **数值直接取字段，不做二次推导**：这些字段是引擎逐项累加出来的，
 * 本模块只负责「摊开展示」。任何重算都会与引擎漂移（本仓反复踩的坑）。
 */
import {
  buildLedgerTable,
  type Contribution,
  type LedgerTable,
} from '@/core/contributionLedger'
import type { DecibelSource } from '@/types/resource'

/** 喧响来源的类别（= 矩阵的行） */
export type DecibelSourceKind =
  | '开局赠送' | '招式回复' | '奖励回复' | '时光切片' | '特殊动作'
  | '异常奖励' | '队友伴随' | '不可分享' | '自身烧血'

/**
 * 各字段属于「可分享」还是「不可分享」。
 *
 * 口径来源 = 引擎 `DecibelSource` 的注释与 `shareableTotal` 的定义：
 * 「总计（不含开局赠送，用于分给队友）」⇒ 开局赠送不可分享；
 * `unshareableBonus` / `selfBurnDecibel` 按字段名即字面意义不可分享。
 */
const SHAREABLE: Record<DecibelSourceKind, boolean> = {
  开局赠送: false,
  招式回复: true,
  奖励回复: true,
  时光切片: true,
  特殊动作: true,
  异常奖励: true,
  队友伴随: true,
  不可分享: false,
  自身烧血: false,
}

/** 字段 → 来源类别（`DecibelSource` 的每个数值字段都要在此登记，漏一个就会静默少算） */
const FIELD_TO_KIND: { field: keyof DecibelSource; kind: DecibelSourceKind }[] = [
  { field: 'initialGift', kind: '开局赠送' },
  { field: 'skillRegen', kind: '招式回复' },
  { field: 'bonusRegen', kind: '奖励回复' },
  { field: 'timeSliceDecibel', kind: '时光切片' },
  { field: 'specialActionBonus', kind: '特殊动作' },
  { field: 'anomalyBonus', kind: '异常奖励' },
  { field: 'teammateShare', kind: '队友伴随' },
  { field: 'unshareableBonus', kind: '不可分享' },
  { field: 'selfBurnDecibel', kind: '自身烧血' },
]

/** 不参与求和的派生字段（`shareableTotal` / `total` 是**结果**，不是来源） */
export const DECIBEL_DERIVED_FIELDS = new Set<keyof DecibelSource>(['shareableTotal', 'total'])

export interface DecibelLedgerBreakdown {
  table: LedgerTable<string>
  /** 账本合计（各来源之和） */
  sum: number
  /** 引擎给出的 `total`（含开局赠送） */
  engineTotal: number
  /** 差额：账本没覆盖到的部分（应当为 0；非 0 = 有新字段没登记进 `FIELD_TO_KIND`） */
  uncovered: number
}

/**
 * 把 `DecibelSource` 摊成贡献账。
 *
 * 列 = 可分享 / 不可分享（与引擎 `shareableTotal` 的口径分界一致）。
 */
export function buildDecibelLedger(source: DecibelSource | null | undefined): DecibelLedgerBreakdown {
  const contributions: Contribution[] = []
  let sum = 0
  if (source) {
    for (const { field, kind } of FIELD_TO_KIND) {
      const amount = Number(source[field] ?? 0)
      if (!Number.isFinite(amount) || amount === 0) continue
      sum += amount
      contributions.push({
        key: SHAREABLE[kind] ? '可分享' : '不可分享',
        amount,
        mode: 'flat',
        origin: { key: `decibel|${kind}`, label: kind, kind: 'decibel', slot: -1 },
        slotKey: `来源:${String(field)}`,
        detail: kind,
      })
    }
  }
  const table = buildLedgerTable(contributions, {
    keyOf: c => c.key,
    amountOf: c => c.amount,
    modeOf: c => c.mode,
    originOf: c => c.origin,
    detailOf: c => c.detail ?? '',
    idOf: c => `${c.origin?.key}|${c.slotKey ?? ''}`,
    slotKeyOf: c => c.slotKey ?? '',
    orderKey: key => (key === '可分享' ? 0 : 1),
  })
  const engineTotal = Number(source?.total ?? 0)
  return { table, sum, engineTotal, uncovered: engineTotal - sum }
}
