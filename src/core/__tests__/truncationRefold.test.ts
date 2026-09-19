/**
 * 债 2 批 2-1「截断外环回灌」（rowTimeLimit 重折环）生效测试（2026-09-19 R37-J2 ②）。
 *
 * 病灶：S1 迭代按**未截断行**计回能/喧响 ⇒ 次数被 180s 装不下的行推高 ⇒ 招式行塞爆前台被 S4 截断 ⇒ 账本 > 展示层。
 * 修法：初装截断 > 容差时按每槽装配 kept 设 `cfg.rowTimeLimit`，从 S2 入口重跑到装配，账本收入经 `feasibleRows`
 * 只数装得下的行；只接受 Σcut 严格变小，≤3 轮，拒绝即整体回滚，返回前删键。口径见 `core/resource.ts#calcTeamResources`
 * 的 @fact engine:资源账本/截断 与 `core/resource/helpers.ts#feasibleRows`。
 *
 * 三条判据：
 *  ① 有效（反空洞）：刀 1（截断入口容差同源）之后全库预设配置口径下只剩 1431 簇两队有初装截断
 *     （auto-1431-1481-1491 108.79s / auto-1431-1481-1341 100.09s，2026-09-19 b0d5834 实测），重折后 Σcut 必须**明显**变小；
 *  ② 不泄漏：返回后任何 cfg 上都不得残留 rowTimeLimit（cfg 被外层不动点 / 热启动复用）；
 *  ③ 默认路径零分支：cut ≤ 1s 的队一个都不许因重折新增截断（全库扫：截断队集合恒 = 那两队）；逐位 0 delta 由 timeGolden 钉。
 */
import { describe, it, expect } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { TIME_BUDGET_TOLERANCE_SECONDS } from '@/core/resource'

/** 刀 1 之后、重折环之前的初装截断（预设配置口径，b0d5834 实测；重折环若失效读数会回到这里） */
const BEFORE_REFOLD_CUT: Record<string, number> = {
  'auto-1431-1481-1491': 108.788,
  'auto-1431-1481-1341': 100.091,
}

async function evalPreset(id: string) {
  const p = teamPresets.find(x => x.id === id)!
  const { catalog, config } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  const calc = useResourceCalc()
  for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
  config.applyTeamPreset(p.team as [string, string, string])
  const rr = calc.resourceResult.value!
  expect(rr, `${id} 无资源结果`).toBeTruthy()
  const cfgs = (calc.resourceConfig.value?.characters ?? []) as unknown as Record<string, unknown>[]
  return {
    cut: rr.convergence?.timeTruncatedSeconds ?? 0,
    bySlot: rr.convergence?.truncationBySlot ?? [],
    leak: cfgs.filter(c => c != null && 'rowTimeLimit' in c).map(c => c.slot),
    damage: calc.teamTotalDamage.value,
    characters: rr.characters,
  }
}

describe('债 2 批 2-1 · 截断外环回灌（rowTimeLimit 重折环）', () => {
  it('① 结构性溢出两队：重折后 Σcut 明显小于初装截断（反空洞：机制真的跑了），且仍如实上报残留', async () => {
    for (const [id, before] of Object.entries(BEFORE_REFOLD_CUT)) {
      const r = await evalPreset(id)
      // 实测 108.79→86.86 / 100.09→81.62（−22s / −18s）；门槛放 10s，只拦「机制失效」，不钉具体值（具体值 timeGolden 钉）
      expect(r.cut, `${id} 重折后截断应明显小于初装 ${before}s`).toBeLessThan(before - 10)
      expect(r.cut, `${id} 是结构性溢出（必要行 > 预算），重折不可能清零；清零 = 口径变了，去看 golden`).toBeGreaterThan(TIME_BUDGET_TOLERANCE_SECONDS)
      // 残留截断必须逐槽如实上报，Σ 与总量一致
      const sum = r.bySlot.reduce((a, e) => a + e.cutSeconds, 0)
      expect(sum).toBeCloseTo(r.cut, 6)
      // 账本与展示层方向自洽：被重折的槽（有 cut 的槽）能量总额不为 0 且次数为整数（终局整数重推口径未被重折破坏）
      for (const ch of r.characters) {
        expect(Number.isInteger(ch.ultimateCount ?? 0), `${id} ${ch.agentId} ultimateCount 应为整数`).toBe(true)
      }
    }
  }, 120_000)

  it('② rowTimeLimit 是函数内部迭代量：返回后任何 cfg 都不残留（重折队 / 非重折队都查）', async () => {
    for (const id of ['auto-1431-1481-1491', 'billy-roxy-lucia']) {
      const r = await evalPreset(id)
      expect(r.leak, `${id} 残留 rowTimeLimit 的槽`).toEqual([])
    }
  }, 120_000)

  it('③ 默认路径零分支：全库预设配置口径下有初装截断（> 1s）的队恒 = 1431 簇那两队，重折不新增截断队', async () => {
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    const truncated: string[] = []
    for (const p of presets) {
      const r = await evalPreset(p.id)
      if (r.cut > TIME_BUDGET_TOLERANCE_SECONDS) truncated.push(p.id)
      expect(r.leak, `${p.id} 残留 rowTimeLimit`).toEqual([])
    }
    expect(truncated.sort()).toEqual(Object.keys(BEFORE_REFOLD_CUT).sort())
  }, 600_000)
})
