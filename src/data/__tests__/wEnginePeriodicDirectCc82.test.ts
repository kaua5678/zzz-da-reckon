/**
 * CC-82：helpers.ts 加农转子 id 判定 → 数据表 wEnginePeriodicDirect。
 * 对照 = 原内联判定逐字复刻（legacy）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findWEnginePeriodicDirect } from '@/data/wEnginePeriodicDirect'

type E = { id: string; legacyIds?: string[]; specialty: string } | null

function legacy(wEngine: E, agentSpecialty: string, modLevel: number | undefined) {
  const wEngineMatchesSpecialty = !!wEngine && wEngine.specialty === agentSpecialty
  const cannonRotorCooldowns = [8, 7.5, 7, 6.5, 6]
  const idx = Math.max(0, Math.min(4, (modLevel ?? 1) - 1))
  const has = wEngineMatchesSpecialty && !!wEngine
    && (wEngine.id === '14001' || (wEngine.legacyIds ?? []).includes('14001'))
  return [has ? 200 : 0, has ? cannonRotorCooldowns[idx] : 0]
}
function next(wEngine: E, agentSpecialty: string, modLevel: number | undefined) {
  const match = !!wEngine && wEngine.specialty === agentSpecialty
  const spec = findWEnginePeriodicDirect(wEngine)
  const has = !!spec && (!spec.requiresSpecialtyMatch || match)
  const idx = Math.max(0, Math.min(4, (modLevel ?? 1) - 1))
  return [has ? spec!.damageMultiplier : 0, has ? spec!.cooldownByModLevel[idx] : 0]
}

describe('CC-82 音擎周期直伤 → 数据表', () => {
  it('id / legacyIds / 职业 / 精修 全组合 == 原判定', () => {
    const engines: E[] = [null]
    for (const id of ['14001', '14002', '13005', 'zzz_wiki_1']) {
      for (const legacyIds of [undefined, [], ['zzz_wiki_9'], ['14001']]) {
        for (const specialty of ['attack', 'anomaly', 'stun']) engines.push({ id, legacyIds, specialty })
      }
    }
    let n = 0
    for (const e of engines) {
      for (const sp of ['attack', 'anomaly']) {
        for (const mod of [undefined, 0, 1, 2, 3, 4, 5, 6]) {
          expect(next(e, sp, mod), JSON.stringify([e, sp, mod])).toEqual(legacy(e, sp, mod))
          n++
        }
      }
    }
    expect(n).toBeGreaterThan(700)
  })

  it('源码锁：helpers.ts 不再写死音擎 id 14001', () => {
    const src = readFileSync(resolve(__dirname, '../../composables/resourceCalc/helpers.ts'), 'utf-8')
    expect(src).not.toContain("'14001'")
    expect(src).toContain('findWEnginePeriodicDirect(wEngine)')
  })
})
