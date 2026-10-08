/**
 * CC-495：前台净占用的几何口径只写一份（`timeOccupation.ts#slotNetFrontline` / `axisOverlapBySlot`）。
 * 占用拆解（装配后超时判定）与欠打试探门控测量此前各手抄一份，靠注释「完全同口径」维持（曾差出 164s）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { axisOverlapBySlot, slotNetFrontline } from '@/core/resource/timeOccupation'
import { frontlineRowSeconds } from '@/types/resource'

const RES = join(__dirname, '..', 'resource')
const read = (f: string) => readFileSync(join(RES, f), 'utf8')

describe('slotNetFrontline / axisOverlapBySlot（CC-495）', () => {
  it('axisOverlapBySlot：按槽号合计，键或值非有限跳过，undefined → {}', () => {
    expect(axisOverlapBySlot(undefined)).toEqual({})
    expect(axisOverlapBySlot({ '0:a': 1.5, '0:b': 2, '2:c': 4, 'x:d': 9, '1:e': Number.NaN })).toEqual({ 0: 3.5, 2: 4 })
  })
  it('轴内分摊按槽整额扣（地板为前台行合计）；extraSeconds 逐项追加；招式合轴只再扣超出分摊的增量 ⇒ 每槽抵扣 = max', () => {
    const rows = [
      { totalTime: 10 },
      { totalTime: 4, timeBucket: 'backstage' as const },
      { totalTime: 3, timeBucket: 'basic' as const },
    ]
    const r = slotNetFrontline(rows, 7, 9, [1, 2])
    expect(r.rowNet).toBe(13 - 7 + 1 + 2)
    expect(r.net).toBe(9 - Math.max(0, 9 - 7))   // = 13 − max(9, 7) + extras
    expect(r.axisCut).toBe(7)
    expect(frontlineRowSeconds(rows)).toBe(13)   // 后台行不计（r738 单一实现）
    // r709：分摊不再按 `slot:moveId` 匹配行——栈键是轴块 id（连段块），行是展开招式，原先整段漏扣
    expect(slotNetFrontline(rows, 7, undefined).rowNet).toBe(6)
    // 分摊超过前台行合计 ⇒ 扣到 0 为止
    expect(slotNetFrontline(rows, 20, undefined).rowNet).toBe(0)
    // 抵扣不超过 rowNet（地板 0）
    expect(slotNetFrontline(rows, 0, 99).net).toBe(0)
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
    expect(occ.includes('isFrontlineExecution(')).toBe(false)   // 前台求和走 frontlineRowSeconds（r738），不再手抄
  })
})
