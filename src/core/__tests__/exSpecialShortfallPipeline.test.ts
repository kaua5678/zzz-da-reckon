/**
 * 管线出口：`CharacterResourceResult.exSpecialEnergyShortfall` 真的被写进资源结果（不是死字段）。
 *
 * `exSpecialShortfallOf` 自己的数值口径由 `src/core/__tests__/exSpecialShortfall.test.ts` 判；
 * 本文件只判**接线**：字段存在、有限、落在合理区间，且在「次数走通用 floor 通道」的角色上
 * 与「收敛能量 + 该槽消耗」是同一口账（同一门槛序列）。
 *
 * ⚠ 不拿 `config.team[slot]` 复算做判据：引擎装配期用的是编排层写回后的 cfg（机制模块可能已写
 * `freeExSpecialCount` / `exReservedCount` / `exSpecialEnergyConsume`），与 store 里那份不必逐位相同。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

/** 抽 8 个覆盖不同职业/资源类型的角色（闪能用户、能量用户、模块接管者都在内） */
const SAMPLE = ['1471', '1041', '1371', '1451', '1581', '1101', '1591', '1091']

describe('exSpecialEnergyShortfall 接线（资源结果侧）', () => {
  it('每个角色都有该字段：有限、非负、不超过一次强特消耗', async () => {
    for (const agentId of SAMPLE) {
      const { } = await setupHarness([{ agentId }])
      const calc = useResourceCalc()
      const me = calc.resourceResult.value?.characters.find(c => c.slot === 0)
      expect(me, `${agentId} 资源结果缺槽位 0`).toBeTruthy()
      const shortfall = me!.exSpecialEnergyShortfall
      expect(typeof shortfall, `${agentId} 字段缺失（未接线）`).toBe('number')
      expect(Number.isFinite(shortfall), `${agentId} 门槛读数非有限：${shortfall}`).toBe(true)
      expect(shortfall, `${agentId} 门槛读数为负`).toBeGreaterThanOrEqual(0)
      const consume = me!.exSpecialEnergyConsume
      if (consume > 0) {
        // 门槛序列每 consume 一档 ⇒ 读数至多一发消耗（已够 = 0，故上界 ≤ consume）
        expect(shortfall, `${agentId} 门槛读数 ${shortfall} 超过一次强特消耗 ${consume}`)
          .toBeLessThanOrEqual(consume + 1e-9)
      } else {
        expect(shortfall, `${agentId} 不耗闪能（consume=0）时读数应为 0`).toBe(0)
      }
    }
  })

  it('次数走通用 floor 通道的角色：读数与该槽「收敛能量 ÷ 消耗」的残差是同一口账', async () => {
    let checked = 0
    for (const agentId of SAMPLE) {
      const { } = await setupHarness([{ agentId }])
      const calc = useResourceCalc()
      const me = calc.resourceResult.value?.characters.find(c => c.slot === 0)
      if (!me) continue
      const consume = me.exSpecialEnergyConsume
      if (!(consume > 0)) continue
      // 只认「通用 floor 通道」。⚠ 判据必须是**通路本身**（`skipGenericExSpecial` / `exSpecialCountFractional` /
      // `exContinuous`），不能是「次数恰好等于 floor(能量/消耗)」——后者会把模块接管的角色（如 1371）
      // 在某个能量点上误收进来：它的次数由模块给，与该式的巧合相等 ≠ 门槛成立。
      const cfg = (calc.resourceConfig.value?.characters ?? []).find(c => c.slot === 0)
      if (!cfg) continue
      if (cfg.skipGenericExSpecial === true || cfg.exSpecialCountFractional === true || cfg.exContinuous === true) continue
      if (me.exSpecialCount !== Math.floor(me.derivedEnergy / consume)) continue
      checked++
      const rem = me.derivedEnergy % consume
      // 恰在门槛上（残差 0）⇒ 0；否则 = 距下一档还差多少
      const expected = Math.abs(rem) < 1e-9 ? 0 : consume - rem
      expect(me.exSpecialEnergyShortfall, `${agentId} 门槛读数与次数通道不同源`)
        .toBeCloseTo(expected, 6)
      // 门槛可达：补上读数，次数恰好 +1（这就是「再补 1 点就多打一次」的可达性）
      expect(Math.floor((me.derivedEnergy + me.exSpecialEnergyShortfall) / consume))
        .toBe(Math.floor(me.derivedEnergy / consume) + 1)
    }
    // 反空洞：至少要有角色真的落进「通用 floor 通道」分支，否则本判据什么都没验
    expect(checked, '没有角色落进通用 floor 通道 ⇒ 判据没验到东西').toBeGreaterThan(0)
  })
})
