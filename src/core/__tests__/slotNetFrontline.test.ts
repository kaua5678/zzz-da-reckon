/**
 * CC-495：前台净占用的几何口径只写一份（`timeOccupation.ts#slotNetFrontline` / `axisOverlapBySlot`）。
 * 占用拆解（装配后超时判定）与欠打试探门控测量此前各手抄一份，靠注释「完全同口径」维持（曾差出 164s）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { axisOverlapBySlot, slotNetFrontline } from '@/core/resource/timeOccupation'

const RES = join(__dirname, '..', 'resource')
const read = (f: string) => readFileSync(join(RES, f), 'utf8')

describe('slotNetFrontline / axisOverlapBySlot（CC-495）', () => {
  it('axisOverlapBySlot：按槽号合计，键或值非有限跳过，undefined → {}', () => {
    expect(axisOverlapBySlot(undefined)).toEqual({})
    expect(axisOverlapBySlot({ '0:a': 1.5, '0:b': 2, '2:c': 4, 'x:d': 9, '1:e': Number.NaN })).toEqual({ 0: 3.5, 2: 4 })
  })
  it('rowNet 只算前台行、扣逐行分摊并地板 0；extraSeconds 逐项追加；抵扣只扣超出槽内分摊的增量', () => {
    const rows = [
      { moveId: 'a', totalTime: 10 },
      { moveId: 'b', totalTime: 4, timeBucket: 'backstage' as const },
      { moveId: 'c', totalTime: 3, timeBucket: 'basic' as const },
    ]
    const overlap = { '0:a': 2, '0:c': 5 }
    const tally = { gross: 0, axisOverlap: 0 }
    const r = slotNetFrontline(rows, 0, overlap, 7, 9, [1, 2], tally)
    expect(r.rowNet).toBe(8 + 0 + 1 + 2)   // max(0,10−2) + max(0,3−5) + extras
    expect(r.net).toBe(11 - Math.max(0, 9 - 7))
    expect(tally).toEqual({ gross: 13, axisOverlap: 7 })
    // 别的槽：overlap 键不命中 ⇒ 不扣
    expect(slotNetFrontline(rows, 1, overlap, 0, undefined).rowNet).toBe(13)
    // 抵扣不超过 rowNet（地板 0）
    expect(slotNetFrontline(rows, 1, overlap, 0, 99).net).toBe(0)
  })
  it('源码锁：拆解 / 试探 / 预算 relief 都走 helper，不再手抄', () => {
    const occ = read('timeOccupation.ts')
    const probe = read('underfillProbe.ts')
    const helpers = read('helpers.ts')
    for (const src of [occ, probe, helpers]) {
      expect(src.split("key.slice(0, key.indexOf(':'))").length - 1).toBe(src === occ ? 1 : 0)
    }
    expect(probe.includes('slotNetFrontline(')).toBe(true)
    expect(probe.includes('comboAlignCredit ?? 0) -')).toBe(false)
    expect(helpers.includes('axisOverlapBySlot(')).toBe(true)
    expect(occ.split('isFrontlineExecution(').length - 1).toBe(1)
  })
})
