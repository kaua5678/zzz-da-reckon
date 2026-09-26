/**
 * CC-19a（2026-09-26）`flattenAnomalyRowGroups` 纯函数判据（设计稿
 * `docs/mcp-cc19-extra-anomaly-rows.md` §4「顺序反向」）。
 *
 * 存在理由：`damagePoolAnomaly.ts` 尾段的角色块序决定 `damagePoolRows` 数组顺序，而 rowsnap
 * 按数组顺序求 sha256 ⇒ 顺序错 = 零差验收失效。派发点跨全队收集分组后按 `order` 稳定排序，
 * 这里锁「order 升序 + 同 order 保持入队顺序」两件事。
 */
import { describe, expect, it } from 'vitest'
import { flattenAnomalyRowGroups } from '@/composables/resourceCalc/damagePoolAnomaly'
import type { ExtraAnomalyRowGroup } from '@/mechanics'

const row = (id: string) => ({ id } as never)

describe('CC-19a：flattenAnomalyRowGroups 稳定排序 + 展开', () => {
  it('order 20、10、10 → 输出 10(先来)、10(后来)、20', () => {
    const groups: ExtraAnomalyRowGroup[] = [
      { order: 20, rows: [row('b20')] },
      { order: 10, rows: [row('a10-first')] },
      { order: 10, rows: [row('a10-second')] },
    ]
    expect(flattenAnomalyRowGroups(groups).map(r => r.id)).toEqual(['a10-first', 'a10-second', 'b20'])
  })

  it('不修改入参数组的元素顺序（返回新数组）', () => {
    const groups: ExtraAnomalyRowGroup[] = [
      { order: 30, rows: [row('c')] },
      { order: 10, rows: [row('a')] },
    ]
    flattenAnomalyRowGroups(groups)
    expect(groups.map(g => g.order)).toEqual([30, 10])
  })
})
