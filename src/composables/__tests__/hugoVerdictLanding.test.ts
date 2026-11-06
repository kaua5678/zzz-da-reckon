/**
 * 回归：雨果决算「轴内块数」落地一致（坑36）。
 *
 * 现象（2026-09-10 探针实证）：0 命轴下轴栈 executed `1291_ex_verdict_final×5.00`（轴认领块 1 × 池窗口 5），
 * 而资源池执行行只落地 ×1——同一轮里轴分配用的是外层不动点的**连续小数**计划次数（实测 0.824），
 * 池算出**整数**；`computeHugoCycle` 对小数次数 Math.floor → 0/1。
 *
 * 判据（不依赖部署随机性，用 PROBE_HUGO_MATRIX 案例 B 同路径固化）：
 *   `resourceResult.characters[0].executions` 的 `1291_ex_verdict_final` count
 *   应等于轴认领块数 × 窗口数（= 轴栈 executed 同键计数）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { stunAxisPresets, cloneStunAxes } from '@/data/stunAxisPresets'
import { HUGO_EX_VERDICT_MOVE_ID, HUGO_EX_NORMAL_MOVE_ID, HUGO_EX_OPEN_MOVE_ID } from '@/mechanics/agents/hugo'

describe('雨果决算轴内块数落地（坑36 回归）', () => {
  it('0 命轴：决算行 count = 轴认领块数 × 窗口数（池同源整数）', async () => {
    const { config } = await setupHarness(
      [{ agentId: '1291' }, { agentId: '1481' }, { agentId: '1161' }],
      { recommendedBuild: true },
    )
    const preset = stunAxisPresets.find(p => p.id === 'hugo-c0-e')
    const axes = preset?.axes
    if (!axes) throw new Error('预设不存在或无轴：hugo-c0-e')
    config.autoYidhariAxis = false
    config.stunAxisPlans.splice(0)
    config.stunAxes.splice(0)
    config.useStunAxis = false
    config.setCinemaLevel(0, 0)
    config.stunAxes.push(...cloneStunAxes(axes))
    config.useStunAxis = true
    // CC-148（第 174 轮）：精确值 5 在 off 口径下核实，显式钉 off；physical 缺省见下一条用例（同源判据）
    config.setMechanicSetting('time.stunPlanProjection', 0)

    const calc = useResourceCalc()
    const poolCount = calc.stunPoolResult.value?.stunCount ?? 0
    expect(poolCount).toBeGreaterThanOrEqual(5)

    // 轴栈 executed 是「轴认领块数 × 窗口数」的展示/归因源（stunPoolResult.stunCount = 池整数）
    const stackExec = (calc.stackTraversalResult.value as { executed?: Record<string, { count: number }> } | null)?.executed
    const stackVerdict = stackExec?.[`0:${HUGO_EX_VERDICT_MOVE_ID}`]?.count ?? 0
    /**
     * ⚠ **2026-11-06 锚值 11 → 10**（规则 10 四步）。
     * ① 量 delta：`stackVerdict` / `poolCount` / 资源行三者同步 11 → **10**（同源等式 `pool == stack == row`
     *    一字未改，仍逐位成立）。
     * ② 根因：**`6efc333c`「属性乘区唯一写入口」**——本队槽2 是 1161 莱特，他的「喷发耗士气冲击 +20%」
     *    从「整块局内冲击力 ×1.2」改成「局外基数 ×20% 的增量」（`statZone#applyInCombatPct`）⇒
     *    面板冲击 291.81 → **282.08**（−9.73 = 局内固定 48.632 × 20%）。冲击力降 ⇒ 失衡蓄积降 ⇒
     *    池窗口 11 → 10。
     * ③ 确认有意：用户 2026-11-06 逐字口径「一切属性都是在自己的乘区影响总属性」；旧写法把「局内
     *    固定加成」也乘了百分比，是本条订正要消掉的误差。判据形状（同源 / 守恒）一条未动。
     * ④ 处置 = 只改锚值。
     */
    expect(stackVerdict).toBe(10)

    // 资源池执行行必须与轴栈同源一致（坑36：实测 1 vs 5）
    const execs = calc.resourceResult.value?.characters?.[0]?.executions ?? []
    const verdictRow = execs.find(e => e.moveId === HUGO_EX_VERDICT_MOVE_ID)
    expect(verdictRow?.count ?? 0).toBe(stackVerdict)
    // 2026-11-06：与上行 stackVerdict 同锚 11 → 10（同一根因，见上）；同源等式仍逐位成立。
    expect(verdictRow?.count ?? 0).toBe(10)

    // 守恒：强特总数 = 决算 + 普通终结（模块内 cycle 口径）
    const exSpecial = execs.find(e => e.moveId === HUGO_EX_OPEN_MOVE_ID)?.count ?? 0
    const normalRow = execs.find(e => e.moveId === HUGO_EX_NORMAL_MOVE_ID)?.count ?? 0
    expect(verdictRow?.count ?? 0 + normalRow).toBeLessThanOrEqual(exSpecial)
    expect(exSpecial).toBeGreaterThanOrEqual(verdictRow?.count ?? 0 + normalRow)
  })

  /**
   * physical 缺省（CC-150，第 174 轮）：该轴外层 2-环、整数物理次数无不动点（读入 5 → 池 4、读入 4 → 池 5）。
   * 修前：资源行决算 4（引擎按读入 4 分配），池 / 轴栈 5 ⇒ 坑36 同源破。修后池钳到读入值 ⇒ 三处同为 4。
   * 判据只钉**同源**（池 == 轴栈 == 资源行），外加现值 4。反向验证：删 `solveTeam.ts` 的 CC-150 块 ⇒ 本条红（4 vs 5）。
   */
  it('physical 缺省：池 == 轴栈 == 资源行（CC-150 同源）', async () => {
    const { config } = await setupHarness(
      [{ agentId: '1291' }, { agentId: '1481' }, { agentId: '1161' }],
      { recommendedBuild: true },
    )
    const axes = stunAxisPresets.find(p => p.id === 'hugo-c0-e')!.axes!
    config.autoYidhariAxis = false
    config.stunAxisPlans.splice(0)
    config.stunAxes.splice(0)
    config.useStunAxis = false
    config.setCinemaLevel(0, 0)
    config.stunAxes.push(...cloneStunAxes(axes))
    config.useStunAxis = true
    const calc = useResourceCalc()
    const pool = calc.stunPoolResult.value?.stunCount ?? -1
    const stack = (calc.stackTraversalResult.value as { executed?: Record<string, { count: number }> } | null)?.executed?.[`0:${HUGO_EX_VERDICT_MOVE_ID}`]?.count ?? -1
    const row = calc.resourceResult.value?.characters?.[0]?.executions?.find(e => e.moveId === HUGO_EX_VERDICT_MOVE_ID)?.count ?? -1
    expect({ pool, stack, row }, '池 / 轴栈 / 资源行必须同源').toEqual({ pool: row, stack: row, row })
    // r652 CC-469′：轴态逐招份额与未覆盖窗口份额复合扣除（不再双重扣除）+ N 二分自洽后本队失衡 4→5（同源断言不变，只是现值变）
    /**
     * ⚠ **2026-10-23 现值 5 → 4**（规则 10 四步）。
     *
     * ① 量 delta：`pool = stack = row = 4`（**同源断言仍成立**），旧锚值 5 不再成立。
     * ② 根因：**2026-10-21「交互默认全 0」（`13b9f584`）**——本用例走 `setupHarness` 的推荐配装，
     *    弹刀/闪反不再被职业基准预填 6/10 ⇒ 失衡蓄积少一档 ⇒ 池 5→4（实测 cont 4.2x ⇒ floor 4 自洽）。
     * ③ 确认有意：用户裁决「交互次数全设 0，最优次数由难度曲线给，不由默认值给」，不是回归。
     * ④ 处置 = **只改锚值**；「池 == 轴栈 == 资源行」这条同源判据一字未改。
     */
    // ⚠ 2026-10-28 现值 4→10：轴模式残差分摊通道删除 ⇒ 非轴行失衡不再被窗占比扣 ⇒ 物理次数
    // 5→4→10（同源断言 pool==stack==row 一字未改；CC-150 规范化把环态钳到最大自洽整数）。
    expect(row, 'physical 现值').toBe(10)
  })
})
