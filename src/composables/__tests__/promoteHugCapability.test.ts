/**
 * CC-43c：琉音「好评 → 转大次数」算法改由模块能力 `promoteHugCounts` 提供，编排层经 `promoteHugCountsOf` 取用。
 * 锁：①有琉音的队取得到算法：不传覆盖 = 读 store 里的设置（未设 = 声明 -1），传 `hug60Cap`（轴声明的 60 次数）= 覆盖优先，
 *   结果都与直接调 computeLiuyinHugCounts 逐位相同；②无琉音的队取不到。
 * r752 CC-535：60 档上限改由模块钩子自己读，钩子不再是 computeLiuyinHugCounts 本体，原「挂的是本体」用例删除。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { computeLiuyinHugCounts } from '@/mechanics/agents/liuyin'
import { promoteHugCountsOf } from '@/composables/resourceCalc/ultimatePromote'

describe('CC-43c promoteHugCounts 能力接线', () => {
  it('有琉音（赠大提供者）的队：不传覆盖读设置，传 hug60Cap 覆盖优先，结果与直接调用一致', async () => {
    await setupHarness([{ agentId: '1591' }, { agentId: '1481' }, { agentId: '1211' }], { recommendedBuild: true })
    const fn = promoteHugCountsOf(useConfigStore())!
    expect(fn({ goodReviewTotal: 390, stunCount: 6 })).toEqual(computeLiuyinHugCounts(390, 6, -1))
    expect(fn({ goodReviewTotal: 390, stunCount: 6, hug60Cap: 2 })).toEqual(computeLiuyinHugCounts(390, 6, 2))
  }, 60000)

  it('无琉音的队：promoteHugCountsOf 为 undefined', async () => {
    await setupHarness([{ agentId: '1591' }, { agentId: '1311' }, { agentId: '1211' }], { recommendedBuild: true })
    expect(promoteHugCountsOf(useConfigStore())).toBeUndefined()
  }, 60000)
})
