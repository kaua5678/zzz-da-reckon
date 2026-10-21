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
  /**
   * ⚠ 2026-10-19 口径对齐（与 `convergence.ts` 的 `supplyCap` 同源）：
   * 剩余时间按**净占用**算——合轴吸收掉的时间（`comboAlignCredit`）本来就不占前台，
   * 用毛额会把它算成占用 ⇒ 上限自锁（后台墨痕化形写真实耗时后实测 pairs 23 → 0）。
   */
  const netUsed = (ta.necessaryTime ?? 0) - (ta.comboAlignCredit ?? 0) + (ta.basicAttackTime ?? 0)
  const supplyCap = Math.floor(Math.max(0, 180 - netUsed) / decl.minPeriodSeconds)
  return { pairs, supplyCap, N: sp.stunCount }
}
describe('CC-475 后台合轴自动填充：缺口按目标次数的扣除口径算', () => {
  it('① 目标不可达 ⇒ 自动对数 == 供给上限（不再是算在当前 N 上的欠估值）', async () => {
    /**
     * ⚠ **2026-10-21 round 29：提高 Boss 失衡值来造「目标不可达」**（原写法靠裸装默认值）。
     *
     * 轴态降配臂落地后，该队默认配置的 `N` 从 3 升到 **4** ⇒ 「目标不可达」前提消失。
     * 但这条用例要锁的语义（**目标不可达时自动对数老实给满 supplyCap**）仍然必要。
     * ⇒ 显式把 `stunValue` 调高（每对能攒的失衡值变少 ⇒ 到 4 次需要更多对 > 供给上限）。
     *
     * 实测：默认 `stunValue` 下 N=4（可达）；调到 3× 后 N < 4（不可达）。
     */
    // 实测：默认 stunValue 下 N=4（可达）；调到 30000 后 N=2（不可达）
    const hard = await run(30000)
    expect(hard.N, '前提：调高 Boss 失衡值后目标 4 次不可达').toBeLessThan(4)
    expect(hard.supplyCap).toBeGreaterThan(0)
    expect(hard.pairs, '目标不可达 ⇒ 自动对数老实给满供给上限').toBe(hard.supplyCap)
  }, 60_000)
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
