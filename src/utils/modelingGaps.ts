/**
 * 建模缺口提示工具（2026-09-05 用户需求：让「为什么这个队低」可读）
 *
 * 两个用途：
 * 1. 套装下拉未建模标记——驱动盘套装的 2pc/4pc 若只有文本没有数值效果（selfBuff/teamBuff
 *    均空），选了也是白板，给用户一个角标提示；
 * 2. 实战对比页部署后的建模缺口清单——按队伍 agentId 列出未接线的命座/机制条目 +
 *    邦布未建模的固定提示。纯信息展示，不做拦截（归档不作误差判据的用户裁决不变）。
 */

export interface SetGapInfo {
  twoPieceUnmodeled: boolean
  fourPieceUnmodeled: boolean
}

interface SetPieceLike {
  effects?: unknown[] | null
}

interface SetLike {
  twoPiece?: SetPieceLike | null
  fourPiece?: {
    effectText?: unknown
    selfBuff?: SetPieceLike | null
    teamBuff?: SetPieceLike | null
  } | null
}

/** 套装缺口判定：effectText 有文本但 selfBuff/teamBuff 均无数值效果 = 4pc 未建模；twoPiece 空 = 2pc 未建模 */
export function describeDriveDiscSetGaps(set: SetLike): SetGapInfo {
  const four = set?.fourPiece
  const fourPieceUnmodeled = !!four?.effectText && !(four.selfBuff?.effects?.length) && !(four.teamBuff?.effects?.length)
  const twoPieceUnmodeled = !set?.twoPiece?.effects?.length
  return { twoPieceUnmodeled, fourPieceUnmodeled }
}

/** 套装下拉的角标文案，如「（4pc未建模）」；已建模返回空串 */
export function discSetGapLabel(set: SetLike): string {
  const g = describeDriveDiscSetGaps(set)
  const parts: string[] = []
  if (g.twoPieceUnmodeled) parts.push('2pc未建模')
  if (g.fourPieceUnmodeled) parts.push('4pc未建模')
  return parts.length ? `（${parts.join('，')}）` : ''
}

// ---------- 部署缺口清单 ----------

export interface ModelingGapHint {
  kind: 'cinema' | 'mechanic' | 'system'
  agentName: string
  text: string
}

interface CinemaLedgerEntry {
  name?: { zhCN?: string; en?: string }
  cinemas?: Array<{
    cinema?: number
    status?: string
    pending?: string[]
  }>
}

interface MechanicLedgerEntry {
  name?: { zhCN?: string; en?: string }
  mechanics?: Array<{
    name?: string | { zhCN?: string }
    implementation?: string
    pending?: string[]
  }>
}

const isRealGapStatus = (status?: string) =>
  /not_described_not_implemented|^pending$|not_implemented/i.test(status ?? '')

/** 命座账本 → 未接线命座提示（只列 not_described/pending 类真缺口；implemented_approximation 的注记不列） */
export function collectCinemaGaps(
  ledger: Record<string, CinemaLedgerEntry> | undefined,
  agentIds: string[],
): ModelingGapHint[] {
  const hints: ModelingGapHint[] = []
  for (const id of agentIds) {
    const ch = ledger?.[id]
    if (!ch) continue
    const agentName = ch.name?.zhCN ?? ch.name?.en ?? id
    for (const c of ch.cinemas ?? []) {
      if (!isRealGapStatus(c.status)) continue
      hints.push({
        kind: 'cinema',
        agentName,
        text: `C${c.cinema ?? '?'} 未接入计算：${(c.pending ?? []).join('；') || '效果未描述'}`,
      })
    }
  }
  return hints
}

/** 机制账本 → 未接线机制提示 */
export function collectMechanicGaps(
  ledger: Record<string, MechanicLedgerEntry> | undefined,
  agentIds: string[],
): ModelingGapHint[] {
  const hints: ModelingGapHint[] = []
  for (const id of agentIds) {
    const ch = ledger?.[id]
    if (!ch) continue
    const agentName = ch.name?.zhCN ?? ch.name?.en ?? id
    for (const m of ch.mechanics ?? []) {
      if (!isRealGapStatus(m.implementation)) continue
      const name = typeof m.name === 'string' ? m.name : m.name?.zhCN ?? ''
      hints.push({
        kind: 'mechanic',
        agentName,
        text: `${name || '机制'} 未接入计算：${(m.pending ?? []).join('；') || '效果未描述'}`,
      })
    }
  }
  return hints
}

/** 邦布系统未建模（归档含邦布，引擎无此位）——固定提示，部署对比时永远列出 */
export const BANGBOO_GAP_HINT: ModelingGapHint = {
  kind: 'system',
  agentName: '全队',
  text: '邦布未建模：归档投稿含邦布输出/增益，计算器无此位，理论值系统性偏低一块',
}
