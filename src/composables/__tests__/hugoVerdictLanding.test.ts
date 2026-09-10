/**
 * 回归：雨果决算「轴内块数」落地一致（坑36，.claude/task-ledger-stun-vuln.md Open #1）。
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

    const calc = useResourceCalc()
    const poolCount = calc.stunPoolResult.value?.stunCount ?? 0
    expect(poolCount).toBeGreaterThanOrEqual(5)

    // 轴栈 executed 是「轴认领块数 × 窗口数」的展示/归因源（stunPoolResult.stunCount = 池整数）
    const stackExec = (calc.stackTraversalResult.value as { executed?: Record<string, { count: number }> } | null)?.executed
    const stackVerdict = stackExec?.[`0:${HUGO_EX_VERDICT_MOVE_ID}`]?.count ?? 0
    expect(stackVerdict).toBe(5)

    // 资源池执行行必须与轴栈同源一致（坑36：实测 1 vs 5）
    const execs = calc.resourceResult.value?.characters?.[0]?.executions ?? []
    const verdictRow = execs.find(e => e.moveId === HUGO_EX_VERDICT_MOVE_ID)
    expect(verdictRow?.count ?? 0).toBe(stackVerdict)
    expect(verdictRow?.count ?? 0).toBe(5)

    // 守恒：强特总数 = 决算 + 普通终结（模块内 cycle 口径）
    const exSpecial = execs.find(e => e.moveId === HUGO_EX_OPEN_MOVE_ID)?.count ?? 0
    const normalRow = execs.find(e => e.moveId === HUGO_EX_NORMAL_MOVE_ID)?.count ?? 0
    expect(verdictRow?.count ?? 0 + normalRow).toBeLessThanOrEqual(exSpecial)
    expect(exSpecial).toBeGreaterThanOrEqual(verdictRow?.count ?? 0 + normalRow)
  })
})
