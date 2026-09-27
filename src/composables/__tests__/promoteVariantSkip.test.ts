/**
 * CC-46（2026-09-27）：锁「队里没有 promoteVariant 声明者（模块能力 ownsPromoteVariantAxisBlocks，现唯一 = 琉音 1481）
 * 时，轴里的 60/90 转大块被跳过，不当作普通终结技执行」——roundInputs.ts `buildStackAxes`
 * （2026-08 修复；CC-43e 改为模块声明）。此前只靠 rowsnap 兜底（CC-43e 反向变异在单测层全绿）。
 *
 * 直测 buildStackAxes，不走整轮求解：只含转大块的探针轴在有琉音队伍里会被求解器判不可行 ⇒
 * forceNoAxis 退回非轴态、resolvedAxes 清空，整管线断言测不到本判定（第 66 轮实测）。
 * 对照：同轴放一个同 moveId 的**普通**终结技块，两队都必须保留 ⇒ 证明跳过只针对 promoteVariant。
 */
import { computed } from 'vue'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { createConvergenceRoundInputs } from '@/composables/resourceCalc/roundInputs'
import type { StunAxis } from '@/types/resource'

const BANYUE_ULT = '1471021'

async function stackActionsFor(team: string[]) {
  const { config, catalog } = await setupHarness(team.map(agentId => ({ agentId })))
  const calc = useResourceCalc()
  const inputs = createConvergenceRoundInputs({ configStore: config, catalogStore: catalog,
    panels: calc.panels, resourceConfig: calc.resourceConfig, globalAnomalyMultiplier: computed(() => 1) })
  const axes: StunAxis[] = [{
    name: '转大块探针',
    actions: [
      { slot: 0, moveId: BANYUE_ULT, count: 1, startTime: 0 },
      { slot: 0, moveId: BANYUE_ULT, count: 1, startTime: 3, promoteVariant: '60' },
    ],
  }]
  const built = inputs.buildStackAxes(axes)
  expect(built).toHaveLength(1)
  return built[0].actions.filter(a => a.slot === 0 && a.moveId === BANYUE_ULT)
}

describe('CC-46 无转大块声明者时跳过 promoteVariant 轴块', () => {
  it('有琉音（1481）：普通块 + 转大块都保留；转大块不扣喧响', async () => {
    const acts = await stackActionsFor(['1471', '1481', '1211'])
    expect(acts.map(a => a.startTime)).toEqual([0, 3])
    expect(acts[1].decibelCost).toBe(0)
    expect(acts[0].decibelCost).toBeGreaterThan(0)
  }, 60000)

  it('无琉音：转大块被跳过，普通块保留', async () => {
    const acts = await stackActionsFor(['1471', '1311', '1211'])
    expect(acts.map(a => a.startTime)).toEqual([0])
    expect(acts[0].decibelCost).toBeGreaterThan(0)
  }, 60000)
})
