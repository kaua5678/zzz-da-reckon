import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { moduleExecRow } from '@/mechanics/moduleExecRow'

const AGENTS_DIR = join(__dirname, '..', 'agents')

/**
 * CC-463（r582，完成 CC-440 剩余 105/110）：模块自造执行行一律走 `moduleExecRow({...})`。
 * 锁①键序契约（零差基准按 JSON 键序哈希）；锁②源码残留清单——`agents/` 里仍手写账本零行的只剩下表这几处
 * （形态不规则：一行多键 / `count` 在账本后 / `count` 与账本之间夹 `dmgBonus` / 头部靠 spread），
 * 新增手写行会让计数上升 ⇒ 红；顺手迁掉一处则把这里的数字调小。
 */
describe('CC-463 moduleExecRow 单一来源', () => {
  it('键序：调用方键按书写顺序，账本六键整组落在 count 之后', () => {
    const row = moduleExecRow({ moveId: 'm', moveName: 'n', category: 'special', element: 'fire', count: 2, decibelRecovery: 0, timeBucket: 'basic' } as never)
    expect(Object.keys(row)).toEqual([
      'moveId', 'moveName', 'category', 'element', 'count',
      'actionTime', 'comboAlignRatio', 'totalTime', 'totalComboAlignTime', 'energyConsume', 'totalEnergyConsume',
      'decibelRecovery', 'timeBucket',
    ])
    expect(row.actionTime).toBe(0)
    expect(row.totalEnergyConsume).toBe(0)
    expect(row.decibelRecovery).toBe(0)
    expect('energyRecovery' in row).toBe(false) // 可选回能字段三态：骨架不替调用方决定
  })
  it('键序：调用方自己写了账本键时，整组落在它第一次出现的位置、值覆盖默认 0', () => {
    const row = moduleExecRow({ moveId: 'm', moveName: 'n', category: 'basic', count: 3, actionTime: 1.5, totalTime: 4.5, skillTableNote: 'x' } as never)
    expect(Object.keys(row)).toEqual([
      'moveId', 'moveName', 'category', 'count',
      'actionTime', 'comboAlignRatio', 'totalTime', 'totalComboAlignTime', 'energyConsume', 'totalEnergyConsume',
      'skillTableNote',
    ])
    expect(row.actionTime).toBe(1.5)
    expect(row.comboAlignRatio).toBe(0)
    expect(row.totalTime).toBe(4.5)
  })
  it('agents/ 手写账本零行残留清单（新增手写行 ⇒ 用 moduleExecRow）', () => {
    const RESIDUAL: Record<string, number> = { 'orphie.ts': 1, 'roxy.ts': 3, 'sigrid.ts': 1, 'soldier11.ts': 3, 'starlightBilly.ts': 1 }
    const actual: Record<string, number> = {}
    for (const f of readdirSync(AGENTS_DIR).filter(f => f.endsWith('.ts'))) {
      const n = (readFileSync(join(AGENTS_DIR, f), 'utf-8').match(/\btotalComboAlignTime:\s*0\b/g) ?? []).length
      if (n > 0) actual[f] = n
    }
    expect(actual).toEqual(RESIDUAL)
  })
})
