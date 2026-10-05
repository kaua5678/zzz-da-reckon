/**
 * CC-475（r656）：后台合轴自动填充的缺口在**目标次数**（保底 4）的扣除口径下算（`sp1.poolAt(4)`），不再在当前 N 的池上
 * 算完再 ×1.2。两个端点锁住语义：
 *  ① 目标不可达（裸装队：每对净失衡 ≈ 284、到 4 次需 ≈70 对，供给上限 ≈25）⇒ 自动对数 == supplyCap（老实给满，不再像旧式
 *    那样算出 11 对后外层 2-环钳回 3）；
 *  ② 基线自身已 ≥ 4（降低 Boss 失衡值）⇒ 自动对数 == 0（保底是地板不是最大化，用户口径 2026-09-07）。
 * 探针与数字：calc-arch/arenaF/r655-bs.out、zzbs.test.ts。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getAgentMechanic } from '@/mechanics'
beforeEach(() => { newPinia(); mockStaticFetch() })
function teamChar(slot: number, agentId: string) {
  return { slot, agentId, cinemaLevel: 0, wEngineId: '', wEngineModLevel: 1, driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {} as never, subStatAllocation: {} }, parryCount: 6, blockCount: 0, dodgeCounterCount: 10, quickAssistCount: 3, chainCountPerStun: 1, basicAttackTimeWeight: 1 } as never
}
async function run(stunValue?: number) {
  const catalog = useCatalogStore(); await catalog.load(); await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  if (stunValue !== undefined) config.enemy.stunValue = stunValue
  config.team[0] = teamChar(0, '1371'); config.team[1] = teamChar(1, '1251'); config.team[2] = teamChar(2, '1271')
  const calc = useResourceCalc()
  const sp = calc.stunPoolResult.value!
  const rr = calc.resourceResult.value!
  const decl = getAgentMechanic('1371')!.backstageAutoFill!
  const pairs = sp.contributions.filter(r => r.slot === 0 && decl.moveIds.slice(0, 2).includes(String(r.moveId))).reduce((s, r) => s + (r.count ?? 0), 0)
  const ta = rr.characters[0]!.timeAllocation
  const supplyCap = Math.floor(Math.max(0, 180 - ((ta.necessaryTime ?? 0) + (ta.basicAttackTime ?? 0))) / decl.minPeriodSeconds)
  return { pairs, supplyCap, N: sp.stunCount }
}
describe('CC-475 后台合轴自动填充：缺口按目标次数的扣除口径算', () => {
  it('① 目标不可达 ⇒ 自动对数 == 供给上限（不再是算在当前 N 上的欠估值）', async () => {
    const r = await run()
    expect(r.N, '前提：裸装队靠合轴到不了 4（到 4 需 ≈70 对 > 上限）').toBeLessThan(4)
    expect(r.supplyCap).toBeGreaterThan(0)
    expect(r.pairs).toBe(r.supplyCap)
  }, 60000)
  it('② 基线自身 ≥ 4 ⇒ 自动对数 0（保底是地板）', async () => {
    const r = await run(9000)
    expect(r.N).toBeGreaterThanOrEqual(4)
    expect(r.pairs).toBe(0)
  }, 60000)
  it('③ 源码：反推块不再有 ×1.2 冗余，缺口来自 poolAt(保底次数)', () => {
    const src = readFileSync(resolve(__dirname, '../resourceCalc/convergence.ts'), 'utf8')
    const i = src.indexOf('const BACKSTAGE_FLOOR_STUNS = 4')
    expect(i).toBeGreaterThan(0)
    const block = src.slice(i, src.indexOf('backstageAutoNext = backstageNext', i))
    expect(block).toContain('sp1.poolAt(BACKSTAGE_FLOOR_STUNS)')
    expect(block).not.toMatch(/\*\s*1\.2\)/)
  })
})
