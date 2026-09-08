/**
 * 非轴失衡不动点（`promoteFixpoint` 的窗口占比回灌）回归。
 *
 * 2026-09-08 用户实测 bug：实战对比部署 雅/南宫/柚叶 vs 基塔布鲁·滞变畸兽 显示「失衡 0 次」。
 * 根因：非轴模式下窗口占比 x = 窗口时长/有效时间是连续量，计数映射 N ↦ floor(G(1−xN)) 是单调递减
 * 阶梯函数，会在相邻两条阶梯间来回跳（实测 0↔6、2↔4）；旧实现「检测到重复即停、保留最后一次池」
 * 返回循环里的任意一支 → 同一配置冷启动 4 次、热启动（缓存命中）0 次。
 * 现口径：解连续不动点闭式 N* = (g + gf − r)/((1 − r) + g·x)，floor(N*) 即物理次数。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { promoteFixpoint } from '@/composables/resourceCalc/liuyinPromote'
import { stunWindowDuration, stunWindowFraction } from '@/core/effectiveTime'
import { emptyPanel } from '@/core/panel'
import type { StunSkillExecution } from '@/core/stunPool'

/** 单个招式、冲击力 100 的合成 execs：gross 失衡值 = baseDaze × count（面板不做任何折算） */
function syntheticExecs(baseDaze: number, count = 1): StunSkillExecution[] {
  return [{ moveId: 'm', moveName: 'M', slot: 0, count, baseDaze, element: 'physical', skillType: 'basic' }]
}

describe('promoteFixpoint 非轴：连续不动点（不再返回 2-循环里的任意一支）', () => {
  it('阶梯 2-循环（旧实现返回 4）→ 连续不动点 floor 3', async () => {
    const { config } = await setupHarness([{ agentId: '1091' }])
    config.setEnemy({ stunValue: 1000, stunTime: 12, battleTime: 180, invincibleTime: 0 })
    const panel = emptyPanel()
    panel.impact = 100
    const windowDur = stunWindowDuration(config.enemy.stunTime, 0) // 12 + 4 = 16
    const x = windowDur / 180 // 0.0889
    // G = 6.02 条 → N* = 6.02/(1+6.02x) = 3.92 → floor 3
    const pool = promoteFixpoint(
      syntheticExecs(6020), 0, null, null, false,
      { configStore: config, panels: [panel] },
    ).pool
    expect(pool).not.toBeNull()
    expect(pool!.grossStunBuildUp).toBeCloseTo(6020, 6)
    expect(pool!.stunCount).toBe(3)
    // 池内窗口占比 = 连续不动点推出的占比（不是任一阶梯端点）
    const fixed = 6.02 / (1 + 6.02 * x)
    expect(pool!.contributions[0].inAxisFraction).toBeCloseTo(stunWindowFraction(fixed, windowDur, 180), 9)
  })

  it('失衡值不足一条 → 0 次（不因闭式解出现负值/假次数）', async () => {
    const { config } = await setupHarness([{ agentId: '1091' }])
    config.setEnemy({ stunValue: 1000, stunTime: 12, battleTime: 180, invincibleTime: 0 })
    const panel = emptyPanel()
    panel.impact = 100
    const pool = promoteFixpoint(
      syntheticExecs(400), 0, null, null, false,
      { configStore: config, panels: [panel] },
    ).pool
    expect(pool!.stunCount).toBe(0)
  })

  it('整数不动点：3.5 条 → N* = 2.67 → 2 次（与旧离散迭代同一落点）', async () => {
    const { config } = await setupHarness([{ agentId: '1091' }])
    config.setEnemy({ stunValue: 1000, stunTime: 12, battleTime: 180, invincibleTime: 0 })
    const panel = emptyPanel()
    panel.impact = 100
    const pool = promoteFixpoint(
      syntheticExecs(3500), 0, null, null, false,
      { configStore: config, panels: [panel] },
    ).pool
    expect(pool!.stunCount).toBe(2)
  })
})
