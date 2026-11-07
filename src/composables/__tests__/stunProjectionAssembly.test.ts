/**
 * **装配层的计数投影口径**：缺省回落这条路到底走不走得到（2026-11-07 立）。
 *
 * ## 为什么要这条判据
 *
 * 上一轮交接报过一个 P0：「`applyTeamToStore` 把 `time.stunPlanProjection` 写成 0 ⇒
 * 『机制设置查不到 ⇒ 回落缺省 4 = physical』从未生效、全库 105 预设生效投影全是 off」。
 * **该结论是探针口径造成的假象**：`.zc/perf/projCensus.probe.perf.ts` 在 `applyTeamToStore`
 * **之前**调了 `clearDifficultyLevers`，而后者**有意**把投影设成 0（难度曲线「全关」基线）。
 *
 * 实测（本文件判据①）：
 *
 * | 装配顺序 | 生效投影 | 机制设置原始值 |
 * |---|---|---|
 * | `applyTeamToStore`（生产路径） | **105/105 `physical`** | 105×**4**（= 缺省，从未被写） |
 * | 先 `clearDifficultyLevers` 再 `applyTeamToStore` | 105/105 `off` | 105×0 |
 *
 * `applyTeamToStore` **不是**这个键的写入方（`git log -S"stunPlanProjection" -- src/composables/teamCompare.ts` 零提交）。
 * 全仓写它的只有两处，且都带明确语义：
 * - `clearDifficultyLevers`（`difficultyLadder.ts`）= 「全关」基线，`@fact engine:难度曲线/全关基线`；
 * - `timeWeightAllocation.ts` 的 `timeWeightStrategy==='zero'` 分支。
 *
 * ⇒ 本文件把**两个口径**钉成机器事实。没有它，同一个误判会被下一轮重新「发现」一次，
 * 而按它去「修」会大面积改 `timeGolden`（实际无缺陷）。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { applyTeamToStore } from '@/composables/teamCompare'
import { clearDifficultyLevers } from '@/composables/difficultyLadder'
import { teamPresets } from '@/data/teamPresets'
import { DEFAULT_STUN_PLAN_PROJECTION_CODE, stunPlanProjectionFromCode } from '@/core/stunPlanProjection'

/** 装配一队并读回「生效投影 + 机制设置原始值」 */
function projectionOf(presetId: string, mode: 'production' | 'allLeversOff', presetCode?: number) {
  const preset = teamPresets.find(p => p.id === presetId)
  if (!preset) throw new Error(`预设不存在：${presetId}`)
  return withAnalysisScenario(s => {
    if (presetCode !== undefined) s.config.setMechanicSetting('time.stunPlanProjection', presetCode)
    if (mode === 'allLeversOff') clearDifficultyLevers({ config: s.config, calc: s.calc })
    applyTeamToStore(s.config, preset)
    return {
      proj: (s.calc.resourceConfig.value as { stunPlanProjection?: unknown } | null)?.stunPlanProjection,
      raw: s.config.getMechanicSetting('time.stunPlanProjection', DEFAULT_STUN_PLAN_PROJECTION_CODE),
    }
  })
}

describe('判据①：生产路径 105/105 走「缺省回落」= physical（不是 off）', () => {
  beforeAll(async () => {
    await setupHarness(['', '', ''], { productionBasicWeights: true })
  })

  it('applyTeamToStore 之后：生效投影 physical、机制设置原始值 == 缺省（从未被写）', async () => {
    const off: string[] = []
    let total = 0
    for (const p of teamPresets) {
      const f = await projectionOf(p.id, 'production')
      total++
      if (f.proj !== 'physical' || f.raw !== DEFAULT_STUN_PLAN_PROJECTION_CODE) {
        off.push(`${p.id}: 生效投影=${String(f.proj)} / 原始值=${f.raw}（期望 physical / ${DEFAULT_STUN_PLAN_PROJECTION_CODE}）`)
      }
    }
    expect(total, '反空洞：一个预设都没装配到').toBeGreaterThan(100)
    expect(off, `生产路径没有走缺省回落（${off.length}/${total}）：\n${off.slice(0, 8).join('\n')}`).toHaveLength(0)
    // 反空洞：缺省编码本身必须是 physical，否则本判据在测另一条口径
    expect(stunPlanProjectionFromCode(DEFAULT_STUN_PLAN_PROJECTION_CODE)).toBe('physical')
  }, 240_000)
})

describe('判据②：「全关」基线（难度曲线）仍然把投影关掉 = off', () => {
  beforeAll(async () => {
    await setupHarness(['', '', ''], { productionBasicWeights: true })
  })

  it('clearDifficultyLevers + applyTeamToStore 之后：生效投影 off、原始值 0', async () => {
    const notOff: string[] = []
    let total = 0
    for (const p of teamPresets) {
      const f = await projectionOf(p.id, 'allLeversOff')
      total++
      if (f.proj !== 'off' || f.raw !== 0) {
        notOff.push(`${p.id}: 生效投影=${String(f.proj)} / 原始值=${f.raw}（期望 off / 0）`)
      }
    }
    expect(total).toBeGreaterThan(100)
    // 这条不是「应该有」而是「必须有」：难度曲线的 y 轴口径依赖它（@fact engine:难度曲线/全关基线）
    expect(notOff, `「全关」基线没关掉计数投影（${notOff.length}/${total}）：\n${notOff.slice(0, 8).join('\n')}`).toHaveLength(0)
  }, 240_000)
})

describe('判据③：applyTeamToStore **不是**这个键的写入方（负控）', () => {
  beforeAll(async () => {
    await setupHarness(['', '', ''], { productionBasicWeights: true })
  })

  /**
   * 把机制设置预置成**第三种**投影（2 = round）再装配：若 `applyTeamToStore` 会写它，
   * 读数就会被改成 0（off）或 4（physical）。保持 2 ⇒ 它只读不写。
   * 这条是判据①的反空洞：①只证明「结果是 physical」，本判据证明「physical 来自缺省、不是被谁写成的」。
   */
  it('预置 round(2) 装配后仍是 round(2)，投影 = round', async () => {
    for (const id of ['auto-1431-1481-1491', 'banyue-liuyin-lucia', 'auto-1591-1481-1211']) {
      const f = await projectionOf(id, 'production', 2)
      expect(f.raw, `${id}: applyTeamToStore 改写了 time.stunPlanProjection（${f.raw} ≠ 2）`).toBe(2)
      expect(f.proj, `${id}: 生效投影应为 round`).toBe('round')
    }
  }, 120_000)
})
