/**
 * CC-35b（2026-09-27）：仪玄 5 项 / 普罗米娅 1 项交互栏次数由各自模块的 `buildCharConfig` 从 `char` 读入
 * （原为 `resourceCalc/helpers.ts#buildCharConfig` 的 cfg 字面量对每个槽都拷一遍）。
 * perf 语料只用缺省输入，且读取方的兜底值与缺省值相同，dump 覆盖不到 ⇒ 这里用非缺省输入走真实管线锁住接线。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { buildCharConfig } from '@/composables/resourceCalc/helpers'

describe('CC-35b：交互栏次数经 char 进模块 cfg', () => {
  it('仪玄：5 项原样进 cfg；极限支援经 yixuanExtremeAssistCountInput 转交', async () => {
    const { config, catalog } = await setupHarness([
      { agentId: '1371', yixuanInk2Count: 3, yixuanInk3Count: 2, yixuanPerfectBlockCount: 4, yixuanExtremeAssistCount: 5, yixuanBackstageComboCount: 6 },
      { agentId: '1331' },
    ] as never)
    const cfg = buildCharConfig(0, config, catalog)! as unknown as Record<string, unknown>
    expect(cfg.yixuanInk2Count).toBe(3)
    expect(cfg.yixuanInk3Count).toBe(2)
    expect(cfg.yixuanPerfectBlockCount).toBe(4)
    expect(cfg.yixuanExtremeAssistCount).toBe(5)
    expect(cfg.yixuanExtremeAssistCountInput).toBe(5)
    expect(cfg.yixuanBackstageComboCount).toBe(6)
    // 非仪玄槽不再带这些字段
    const mate = buildCharConfig(1, config, catalog)! as unknown as Record<string, unknown>
    expect(mate.yixuanInk2Count).toBeUndefined()
    expect(mate.promiaNiyingCount).toBeUndefined()
  })

  it('仪玄：极限支援缺省为 -1（自动）', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1371' }, { agentId: '1331' }] as never)
    const cfg = buildCharConfig(0, config, catalog)! as unknown as Record<string, unknown>
    expect(cfg.yixuanExtremeAssistCount).toBe(-1)
    expect(cfg.yixuanExtremeAssistCountInput).toBe(-1)
  })

  it('普罗米娅：匿影次数原样进 cfg', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1541', promiaNiyingCount: 4 }, { agentId: '1331' }] as never)
    const cfg = buildCharConfig(0, config, catalog)! as unknown as Record<string, unknown>
    expect(cfg.promiaNiyingCount).toBe(4)
  })
})
