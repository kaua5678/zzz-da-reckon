/**
 * 额外强特计划 + 强特成本类型化（2026-09 用户裁决「引擎别太窄」）护栏：
 * - 千夏(1491)：特别拍照技巧（协同）= 0 耗能的次要强特，每 [天使协律]（强特施加，40s）窗口 1 次
 *   且 ≤ 主强特次数；行值 = moveFusions 融合的 1491008+1491019（1905.0%）；喧响按窗口计入。
 * - 克拉蕾(1611)：锐能强特（catalog "Sharpness Cost":60）不再被 findExSpecial 当能量 60 计费；
 *   次数 = floor(锐能预算 / 60)，由模块资源账本同轮给出（模块自发行行）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { resolveExtraExCount, EXTRA_EX_PLANS } from '@/data/exSpecialPlans'

describe('额外强特计数 resolveExtraExCount（窗口 × 封顶）', () => {
  const qianxia = EXTRA_EX_PLANS['1491'][0]

  it('180s 每 40s 窗口 1 次 → 4 次；capByExCount 生效', () => {
    expect(resolveExtraExCount(qianxia, { battleSeconds: 180, exCount: 10 })).toBe(4)
    expect(resolveExtraExCount(qianxia, { battleSeconds: 180, exCount: 3 })).toBe(3)
    expect(resolveExtraExCount(qianxia, { battleSeconds: 180, exCount: 0 })).toBe(0)
  })

  it('窗口不整除向下取整（100s → 2 次）', () => {
    expect(resolveExtraExCount(qianxia, { battleSeconds: 100, exCount: 99 })).toBe(2)
  })
})

describe('千夏特别拍照技巧（免费强特，引擎额外行）', () => {
  it('执行行存在：0 耗能、≤ 主强特次数、倍率 = 协同融合 1905.0%', async () => {
    await setupHarness([{ agentId: '1491' }, { agentId: '1091' }, { agentId: '1031' }])
    const { resourceResult } = useResourceCalc()
    const exs = resourceResult.value?.characters.find(c => c.agentId === '1491')?.executions ?? []
    const ex1 = exs.find(e => e.moveId === '1491007')
    const photo = exs.find(e => e.moveId === '1491008')
    expect(ex1).toBeTruthy()
    expect(photo).toBeTruthy()
    // 主强特未被破坏：泡泡糖轰炸 = #1+#2（moveFusions 融合）
    expect(ex1?.damageMultiplier).toBeCloseTo(1827.4, 3)
    // 免费强特：不扣能量
    expect(photo?.energyConsume).toBe(0)
    expect(photo?.totalEnergyConsume).toBe(0)
    // 窗口计数：≤ floor(180/40)=4 且 ≤ 主强特次数；千夏能量池至少放 1 次主强特（70 能，初始 40+回复）
    expect(photo?.count).toBeGreaterThanOrEqual(1)
    expect(photo?.count).toBeLessThanOrEqual(4)
    expect(photo?.count).toBeLessThanOrEqual(ex1?.count ?? 0)
    // 行值 = 特别拍照技巧（协同）= #1+#2（1491008+1491019 融合）
    expect(photo?.damageMultiplier).toBeCloseTo(1905.0, 3)
    // 喧响按窗口计入（每发 100.3475）
    expect(photo?.totalDecibelRecovery).toBeCloseTo((photo?.count ?? 0) * 100.3475, 3)
  })
})

describe('克拉蕾秘血铸锋（锐能强特：成本类型化 + 模块自发行）', () => {
  it('不再按能量计费；行数 = floor(锐能预算/60)，预算不足不发行（旧引擎口径分裂修复）', async () => {
    await setupHarness([{ agentId: '1611' }, { agentId: '1091' }, { agentId: '1031' }])
    const { resourceResult } = useResourceCalc()
    const char = resourceResult.value?.characters.find(c => c.agentId === '1611')
    const exs = char?.executions ?? []
    const ex = exs.find(e => e.moveId === '1611010')
    const source = char?.claretSharpResourceSource
    expect(source).toBeTruthy()
    const affordable = Math.max(0, Math.floor((source?.sharpnessGain ?? 0) / 60))
    // 锐能账本：消费 = 应付次数 × 单价（无「行存在却零消费」的分裂）
    expect(source?.sharpnessSpend).toBe(affordable * 60)
    // 行数与账本一致（v12 口径：锐能进场 60 → 1 发；旧引擎曾按能量 60/发发行且锐能零消耗）
    if (affordable > 0) {
      expect(ex).toBeTruthy()
      expect(ex?.count).toBe(affordable)
      expect(ex?.damageMultiplier).toBeCloseTo(1249.6, 3)
    } else {
      expect(ex).toBeUndefined()
    }
    // 无论是否发行：任何执行行都不再被按能量 60 计费（全仓无 60 能量泄漏）
    for (const e of exs) {
      expect(e.totalEnergyConsume ?? 0).toBe(0)
    }
  })
})
