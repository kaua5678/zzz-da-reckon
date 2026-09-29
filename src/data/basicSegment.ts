/**
 * 普攻「普通 #N 段」判定——**单一事实源**（CC-320），**零 import**（core / mechanics / 编排层共用）。
 *
 * 口径：英文名带 `#N`、不含 `dash` / `dodge`、`actionTime > 0`。CC-320 之前这三条在 4 处逐字重复
 * （`moveTableQueries#pickThirdNamedBasicSegment`、`skillRows#getBasicComboMoves`、
 * `core/resource/moveLookup#calcBasicAttackRegenPerSec`、`alice#calcSwordWillPerSec`）。
 *
 * ⚠ `#N` 是命名启发式：1631 赛维里安 / 1641 菲欧妮的新版 catalog 普攻段名不带 `#N`，一个段都选不出
 * （CC-193 修了基准段；CC-320 修了秒均回复，改走基准段兜底）。启发式再要改，只改这里。
 */
export function isNumberedBasicSegment(move: { readonly name?: { readonly en?: string }; readonly actionTime?: number | null }): boolean {
  const name = move.name?.en || ''
  if (!name.match(/#\d+/)) return false
  if (name.toLowerCase().includes('dash') || name.toLowerCase().includes('dodge')) return false
  return !!move.actionTime && move.actionTime > 0
}
