/**
 * Chart 2「多队并存强度」的强度带计算（纯函数，2026-09-12 评审 #14 第五刀）。
 *
 * 这是该图**唯一的算法**（Top-K 淘汰），此前内联在 3052 行的页面里、**没有任何单测**——
 * 而它带着一条血泪注释（见下「不许提前 break」）。抽出来后可对边界直接断言。
 *
 * 口径（与抽取前逐条一致）：
 * - 每节点对「已实装且未被淘汰」的队按伤害取前 K，**第 K+1 名即淘汰**（淘汰是永久的）；
 * - 可达集合只增 ⇒ 排名单调不升 ⇒ 淘汰永久，这条性质是该算法成立的前提；
 * - ⚠ **不许在可达集合为空时提前 break**：首期新队友尚未实装/全被收敛排除时可达集合可能为空，
 *   提前退出会让后续所有期的 Top-K 裁剪都不执行 ⇒ 弱队全部「存活到最后」。
 *   （历史事故：淘汰标注整片失效。）
 * - 返回的带按 `endIndex < startIndex` 过滤（即从未真正存活的队不产生带）。
 */
import type { TeamStrengthSeed } from '@/composables/teamTimeline'

export interface StrengthBand {
  seed: TeamStrengthSeed
  startIndex: number
  endIndex: number
  /** 首次跌出 Top-K 的节点下标（null = 存活到最后） */
  eliminatedAt: number | null
}

/**
 * 计算各队的存活带。
 * @param seeds 池内全部收敛组合（含各自 startIndex）
 * @param nodeCount 版本节点数
 * @param k 并存约束（游戏机制，非显示选项）；会被钳到 ≥1 的整数
 */
export function computeStrengthBands(
  seeds: ReadonlyArray<TeamStrengthSeed>,
  nodeCount: number,
  k: number,
): StrengthBand[] {
  const topK = Math.max(1, Math.floor(k || 1))
  if (seeds.length === 0 || nodeCount === 0) return []

  const eliminatedAt = new Map<string, number>()
  for (let n = 0; n < nodeCount; n++) {
    const reachable = seeds.filter(s => s.startIndex <= n && !eliminatedAt.has(s.key))
    reachable.sort((a, b) => b.damage - a.damage)
    for (let r = topK; r < reachable.length; r++) eliminatedAt.set(reachable[r].key, n)
  }

  return seeds
    .map(seed => {
      const cut = eliminatedAt.get(seed.key)
      const endIndex = cut == null ? nodeCount - 1 : cut - 1
      return { seed, startIndex: seed.startIndex, endIndex, eliminatedAt: cut ?? null }
    })
    .filter(b => b.endIndex >= b.startIndex)
}

/** 悬浮卡标题：队名｜伤害（血量%）｜存活区间｜淘汰说明 */
export function strengthBandTitle(
  band: StrengthBand,
  opts: {
    k: number
    nameOf: (agentId: string) => string
    labelOf: (nodeIndex: number) => string | undefined
    fmtCompact: (n: number) => string
    fmtRatio: (n: number, digits: number) => string
  },
): string {
  const { k, nameOf, labelOf, fmtCompact, fmtRatio } = opts
  const team = band.seed.team.map(nameOf).join('+')
  const span = `${labelOf(band.startIndex) ?? ''} ~ ${labelOf(band.endIndex) ?? ''}`
  const cutLabel = band.eliminatedAt != null ? labelOf(band.eliminatedAt) : undefined
  const elim = band.eliminatedAt != null && cutLabel
    ? `｜${cutLabel} 起跌出 Top-${k} 淘汰`
    : '｜存活到最后'
  return `${team}｜伤害 ${fmtCompact(band.seed.damage)}（${fmtRatio(band.seed.hpRatio, 1)}%）｜${span}${elim}`
}
