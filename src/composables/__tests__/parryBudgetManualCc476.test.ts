/**
 * §20.5-3 锁：**用户主动调高弹刀 ⇒ 保底4失衡反推链必须启动**（不看有没有 Boss）。
 *
 * ## 锁的是什么（口径）
 *
 * 用户口径 2026-10-05：
 * > 「`parryTotal` 只是说他**默认没有强制弹刀**，但**你想弹还是有普通弹刀的**。
 * >  所以四舍五入应该能做到，**做不到就是 bug**，这又不是**禁用**了弹刀。
 * >  我设置的弹刀数值是**机制所必要的最低值，在这之上可以任意增加**。」
 *
 * ⇒ `parryTotal`（`configStore.appliedBoss?.parryTotal`）= 「Boss 预设**强制反推的下限**」，
 * **不是**「是否允许反推」的开关。旧实现把它当开关：
 * 无 Boss（或 Boss 未声明 `parryTotal`——全库 23 个里 **17 个**如此）⇒ `parryTotal = 0`
 * ⇒ `parrySplitActive = false` ⇒ 即使用户手填弹刀 12/20 次，反推链也不启动。
 *
 * 实测（般岳队，`guarantee.stun=1`，**无 Boss**，手填 `parryCount`）：
 * ```
 * 手填   旧实现          新实现
 *   0   3次/42.51M      3次/42.51M
 *   6   3次/43.63M      3次/44.59M
 *  12   3次/41.66M      4次/48.45M   ← ★（旧实现 12 次比 0 次还低：弹刀占前台却不进反推链）
 *  20   3次/43.34M      4次/51.18M
 * ```
 *
 * ## 判据为什么这么写（关键：必须扣掉职业基准）
 *
 * `stores/config.ts:634` 在换人时把 `interactionBaselineFor(...)` 的 `parry`
 * （非支援/防护 = **6**）**预填**进 `parryCount` ⇒ 直接判 `parryCount > 0` 对**几乎所有队**成立。
 * 实测过宽版本：**29/104 队变动、失衡 3→5**（`auto-1591-1481-1311` +29.5%）⇒ 已废弃。
 *
 * 故本锁断言的是**「相对职业基准的偏离」**，并同时验证「未改弹刀的队零变动」。
 *
 * ## 反证（去掉手填判据后本测试确实变红）
 *
 * 把 `parrySplitActive` 的 `|| manualParryAboveBaseline > 0` 去掉 ⇒
 * 「手填 12 次 ⇒ 4 次失衡」那条**当场红**（回到 3 次）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore } from '@/composables/teamCompare'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'

const tick = () => new Promise(r => setTimeout(r, 55))

describe('§20.5-3 保底4失衡：用户调高弹刀即启动反推（无 Boss 亦然）', () => {
  it('无 Boss 手填弹刀：0/6 次 = 3 失衡；12/20 次 ⇒ 4 失衡且单调', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === 'banyue-trigger-lucia')
    expect(p, '预设 banyue-trigger-lucia 存在').toBeTruthy()

    const run = async (parry: number) => {
      applyTeamToStore(config, p!)
      config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0.4)
      config.setMechanicSetting('guarantee.stun', 1)
      expect(config.appliedBoss, '本用例前提：无 Boss（appliedBoss 为空）').toBeFalsy()
      if (parry > 0) {
        config.setActionCount(0, 'parryCount', parry)
        config.setActionCount(1, 'parryCount', parry)
      }
      await tick()
      const sp = calc.stunPoolResult.value as unknown as Record<string, number>
      expect(sp, '失衡池有结果').toBeTruthy()
      return { stun: sp.stunCount, dmg: calc.teamTotalDamage.value / 1e6 }
    }

    const r0 = await run(0)
    const r6 = await run(6)
    const r12 = await run(12)
    const r20 = await run(20)

    // ★ 反证点：旧实现下这里恒为 3（弹刀不进反推链）
    expect(r12.stun, '手填 12 次弹刀 ⇒ 应达成保底 4 失衡（旧实现为 3）').toBeGreaterThanOrEqual(4)
    expect(r20.stun, '手填 20 次弹刀 ⇒ 应达成保底 4 失衡').toBeGreaterThanOrEqual(4)

    // 未达门槛的档位不受影响（防「一律抬高」的过宽修法）
    expect(r0.stun, '不填弹刀 ⇒ 仍 3 次（不应被抬高）').toBe(3)
    expect(r6.stun, '填 6 次（= 职业基准）⇒ 仍 3 次').toBe(3)

    // ★ 单调性：旧实现下 12 次(41.66) < 0 次(42.51)，加弹刀反而降伤
    expect(r0.dmg, '加弹刀不应降低伤害（旧实现 12 次比 0 次低）').toBeLessThanOrEqual(r12.dmg)
    expect(r12.dmg).toBeLessThanOrEqual(r20.dmg)
  }, 900_000)
})
