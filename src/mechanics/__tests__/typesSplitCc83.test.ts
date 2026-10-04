/**
 * CC-83：mechanics/types.ts 拆分护栏。卫星类型移至 typesRows.ts / typesHooks.ts，由 types.ts 转出。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXTRA_ANOMALY_ROW_ORDER as viaTypes } from '@/mechanics/types'
import { EXTRA_ANOMALY_ROW_ORDER as viaRows } from '@/mechanics/typesRows'

describe('CC-83 mechanics/types.ts 拆分', () => {
  it('EXTRA_ANOMALY_ROW_ORDER 经 types.ts 转出 = 同一对象', () => {
    expect(viaTypes).toBe(viaRows)
    expect(Object.keys(viaTypes).length).toBeGreaterThan(0)
  })

  it('types.ts < 1400 行且保留三条转出（新卫星类型进 typesRows / typesHooks / typesView）', () => {
    // CC-451（2026-10-04）：CC-444/445/446/448 的展示层声明把本预算顶到 1483，红了 15 小时才被全量 vitest 抓到——
    // 展示层声明一律进 typesView.ts（允许 `| null`）；引擎钩子契约进 typesHooks.ts（禁 `| null`，CC-435）；行类型进 typesRows.ts。
    const src = readFileSync(resolve(__dirname, '../types.ts'), 'utf-8')
    expect(src.split('\n').length).toBeLessThan(1400)
    expect(src).toContain("from './typesRows'")
    expect(src).toContain("from './typesHooks'")
    expect(src).toContain("from './typesView'")
    expect(src).toContain('export interface AgentMechanicModule')
  })
})
