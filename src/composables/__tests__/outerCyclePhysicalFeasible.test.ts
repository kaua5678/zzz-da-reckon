/**
 * CC-153（第 176 轮）：physical 外层 2-环「池 < 读入」一侧（CC-150 残差）。
 * yixuan-trigger-lucia：环成员 A 读入 4 → 池 3、B 读入 3 → 池 4。修前规范点落 A ⇒ 资源行连携（按读入 4 分配）= 4，
 * 池 / 轴栈 = 3，同源破（坑36）。修后 A 不可行不参选（纯函数 ⓪″），落 B 再由 CC-150 钳到 3 ⇒ 三处同为 3。
 * 判据只钉**同源**（不变量，模式无关），外加现值 3。
 * 反向验证：`outerCycle.ts#pickOuterCycleMember` 的 ⓪″ 过滤改为恒可行（`members[i].feasible !== false` → `true`）⇒ 本条红
 * （{ pool: 3, stack: 3, row: 4 }，第 176 轮实测）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'

const YIXUAN_CHAIN_MOVE_ID = '1371013'

describe('CC-153 physical 外层 2-环：不可行成员不参选', () => {
  it('yixuan-trigger-lucia：池 == 轴栈连携 == 资源行连携', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const p = teamPresets.find(x => x.id === 'yixuan-trigger-lucia')!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    const calc = useResourceCalc()
    const pool = calc.stunPoolResult.value?.stunCount ?? -1
    const stack = (calc.stackTraversalResult.value as { executed?: Record<string, { count: number }> } | null)?.executed?.[`0:${YIXUAN_CHAIN_MOVE_ID}`]?.count ?? -1
    const row = calc.resourceResult.value?.characters?.[0]?.executions?.find(e => e.moveId === YIXUAN_CHAIN_MOVE_ID)?.count ?? -1
    expect({ pool, stack, row }, '池 / 轴栈 / 资源行必须同源').toEqual({ pool: row, stack: row, row })
    // r652 CC-469′：轴态逐招份额与未覆盖窗口份额复合扣除（不再双重扣除）+ N 二分自洽后本队失衡 3→4（同源断言不变，只是现值变）
    expect(row, 'physical 现值').toBe(4)
  })

  /**
   * 1401/1511/1411（棘轮同路径：只 setAgent）：环成员 A 读入 3 → 池 2（不可行）、B 读入 2 → 池 3（规划 stunIn 0.015）。
   * 修前 B 被 ⓪ 按规划值误判零窗剔除 ⇒ 落 A：三人连携各 3、池 2。修后 ⓪ 按读入物理次数（windowsIn）判窗 ⇒ 落 B 钳 2。
   * 反向验证：outerCycle.ts ⓪ 的 `members[i].windowsIn ?? ` 删掉 ⇒ 本条红（连携 3 vs 池 2）。
   */
  it('1401-1511-1411：每人连携次数 == 池（⓪ 零窗按读入物理次数判）', async () => {
    await setupHarness(['', '', ''])
    const config = useConfigStore()
    const team = ['1401', '1511', '1411']
    for (let i = 0; i < 3; i++) config.setAgent(i, team[i])
    const calc = useResourceCalc()
    const pool = calc.stunPoolResult.value?.stunCount ?? -1
    const chains = team.map((a, i) => calc.resourceResult.value?.characters?.[i]?.executions?.find(e => e.moveId === `${a}${a === '1401' ? '015' : '011'}`)?.count ?? -1)
    expect({ pool, chains }, '每人连携必须与池同源').toEqual({ pool, chains: [pool, pool, pool] })
    // CC-154（第 177 轮）：模块计数改读计数通道后本队收敛到 3（同源断言不变、仍通过；只是现值变）
    expect(pool, 'physical 现值').toBe(3)
  })
})
