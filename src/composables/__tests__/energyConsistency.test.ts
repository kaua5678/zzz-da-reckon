/**
 * 能量轮差护栏（2026-09-03 修复）：驱动次数的能量（derivedEnergy）必须与展示明细
 * （energySource.total）同源——
 * 曾出现固定 Δ=+55.5（雅/莱卡恩）：state.totalEnergy 是 iterate 上一轮输出（用 prev 状态
 * 计算），最终装配重算 energySrc.total（最终状态）后二者分裂 → 「能量明细只够 9.25 次强特
 * 却显示 10 次」。修复：装配内用最终能量重解 exSpecialCount（core/resource.ts stateEff）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

describe('能量轮差：derivedEnergy = energySource.total（次数与展示同源）', () => {
  it('雅/莱卡恩/妮可队：全槽位 Δ=0，强特次数 = floor(最终能量/40)', async () => {
    await setupHarness([{ agentId: '1091' }, { agentId: '1141' }, { agentId: '1031' }])
    const { resourceResult } = useResourceCalc()
    for (const c of resourceResult.value?.characters ?? []) {
      const ch = c as unknown as { energySource: { total: number }; derivedEnergy: number; exSpecialCount: number }
      // Δ = 0（修复前雅 Δ=+55.5）
      expect(Math.abs(ch.derivedEnergy - ch.energySource.total)).toBeLessThan(1e-6)
    }
    const ya = resourceResult.value?.characters.find(c => c.agentId === '1091') as unknown as { energySource: { total: number }; exSpecialCount: number }
    // 雅强特 40 能量：次数 = floor(最终能量/40)（修复前 370.15 能量却出 10 次）
    const expectCount = Math.floor(ya.energySource.total / 40)
    expect(ya.exSpecialCount).toBeGreaterThanOrEqual(expectCount - 0.01)
    expect(ya.exSpecialCount).toBeLessThanOrEqual(expectCount + 0.01)
  })
})
