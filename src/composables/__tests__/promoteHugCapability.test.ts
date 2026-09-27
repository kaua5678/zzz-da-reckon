/**
 * CC-43c：琉音「好评 → 转大次数」算法改由模块能力 `promoteHugCounts` 提供，编排层经 `promoteHugCountsOf` 取用。
 * 锁：①琉音模块挂的就是 computeLiuyinHugCounts（逐位同一函数 ⇒ 零差依据）；②有琉音的队取得到算法，无琉音的队取不到。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { computeLiuyinHugCounts, liuyinMechanic } from '@/mechanics/agents/liuyin'
import { promoteHugCountsOf } from '@/composables/resourceCalc/ultimatePromote'

describe('CC-43c promoteHugCounts 能力接线', () => {
  it('琉音模块挂的是 computeLiuyinHugCounts 本体', () => {
    expect(liuyinMechanic.promoteHugCounts).toBe(computeLiuyinHugCounts)
  })

  it('有琉音（赠大提供者）的队：promoteHugCountsOf 返回该算法，结果与直接调用一致', async () => {
    await setupHarness([{ agentId: '1591' }, { agentId: '1481' }, { agentId: '1211' }], { recommendedBuild: true })
    const fn = promoteHugCountsOf(useConfigStore())
    expect(fn).toBe(computeLiuyinHugCounts)
    expect(fn!(390, 6, -1)).toEqual(computeLiuyinHugCounts(390, 6, -1))
  }, 60000)

  it('无琉音的队：promoteHugCountsOf 为 undefined', async () => {
    await setupHarness([{ agentId: '1591' }, { agentId: '1311' }, { agentId: '1211' }], { recommendedBuild: true })
    expect(promoteHugCountsOf(useConfigStore())).toBeUndefined()
  }, 60000)
})
