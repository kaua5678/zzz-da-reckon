/**
 * 回归：异常积蓄利用率默认 1（所有专精）——支援/防护不得默认 ÷10。
 *
 * 用户 2026-09-03 报告：丽娜(支援)结算总积蓄仅 ~300，而单招（EX 471.62%×次数）已超 3000
 * → 根因 getAnomalyUtilizationRate 对 support/defense 硬编码 0.1（初始提交起存的启发式）。
 * 断言：丽娜 EX 积蓄行 baseBuildUp = 倍率表真值 471.62（÷10 会变 47.16）；
 * 滑块覆盖（0.5）仍按比例生效。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

async function setup() {
  const result = await setupHarness([
    { agentId: '1211', cinemaLevel: 6, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: '1181', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: '1031', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

describe('异常积蓄利用率默认值（支援/防护不再 ÷10）', () => {
  it('丽娜(支援)电积蓄：EX 行 baseBuildUp = 471.62 倍率表真值、总积蓄 = 真值×次数（旧启发式 ÷10 判红）', async () => {
    await setup()
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const ap: any = (calc as any).anomalyPoolResult?.value
    const electric = ap?.perElement.find((p: any) => p.element === 'electric')
    expect(electric).toBeTruthy()
    const rina = electric.contributions.find((c: any) => c.moveId === '1211009')
    expect(rina).toBeTruthy()
    // 倍率表真值 471.62/次；旧 0.1 默认会把 baseBuildUp 压缩为 47.16
    expect(rina.baseBuildUp).toBeCloseTo(471.62, 1)
    const rinaChar = calc.resourceResult.value!.characters.find(c => c.agentId === '1211')!
    const exRow = rinaChar.executions.find(e => e.moveId === '1211009')!
    expect(exRow.count).toBeGreaterThan(0)
    // 总积蓄 = 真值 × 次数 × perHit 效率系数（≥0.9 容差；旧启发式只有 ~10% 即必红）
    expect(rina.totalBuildUp).toBeGreaterThan(471.62 * exRow.count * 0.9)
    // 全队总积蓄不再被支援压缩：丽娜槽位贡献 ≫ 单发（旧启发式全队仅 ~400-500 假象）
    const slot0 = electric.contributions.filter((c: any) => c.slot === 0).reduce((s: number, c: any) => s + c.totalBuildUp, 0)
    expect(slot0).toBeGreaterThan(471.62 * exRow.count * 0.9)
  })

  it('滑块覆盖仍生效：0.5 → 丽娜槽位积蓄减半', async () => {
    const { config } = await setup()
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const ap: any = (calc as any).anomalyPoolResult?.value
    const electric = ap?.perElement.find((p: any) => p.element === 'electric')
    const before = electric.contributions.filter((c: any) => c.slot === 0).reduce((s: number, c: any) => s + c.totalBuildUp, 0)
    config.setAnomalyUtilizationRate(0, 0.5)
    await new Promise(r => setTimeout(r, 50))
    const ap2: any = (calc as any).anomalyPoolResult?.value
    const electric2 = ap2?.perElement.find((p: any) => p.element === 'electric')
    const after = electric2.contributions.filter((c: any) => c.slot === 0).reduce((s: number, c: any) => s + c.totalBuildUp, 0)
    expect(after).toBeCloseTo(before * 0.5, 1)
  })
})
