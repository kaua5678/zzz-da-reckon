/**
 * CC-141（第 165 轮）：赠送供给（琉音赠大 `ultimateGiftOf` / 诺姆赠链 `crossAgentSupplyAt`）属计数通道，
 * 必须与连携数同读 `stunCountForCountChannel`。
 *
 * 缺陷（CC-140 落地时漏改）：`'physical'` 模式下连携数改读物理次数，但账本预留、折叠环测量、欠打探针、
 * 装配截断上限、赠行规格这五处仍读计划值 `config.stunCount`；而装配侧 `promoteFixpoint` 按池物理次数
 * 给赠大次数 ⇒ 物化赠行比账本多一整次终结技（auto-1321-1481-1491：4 → 5 次，+2.37s 超预算）。
 * 这份超出与交互降配档无关（S3 八档试算净占用全部 182.367s），S3 没有杠杆，只能在源头对齐口径。
 * 修复后 104 队 physical：超预算 13 队 / 15.86s → 3 队 / 0.49s；缺省 off 逐位不变。
 * 详见 docs/mcp-stun-dual-source.md §6。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { buildTeamTimeSummary } from '@/composables/teamTimeSummary'
import { stunCountForCountChannel } from '@/core/stunPlanProjection'

describe('stunCountForCountChannel', () => {
  it('off 恒等；physical 读物理次数，缺省回落计划值；floor 走投影', () => {
    expect(stunCountForCountChannel({ stunCount: 0.69 })).toBe(0.69)
    expect(stunCountForCountChannel({ stunCount: 0.69, stunPlanProjection: 'off', stunCountPhysical: 4 })).toBe(0.69)
    expect(stunCountForCountChannel({ stunCount: 0.69, stunPlanProjection: 'physical', stunCountPhysical: 4 })).toBe(4)
    expect(stunCountForCountChannel({ stunCount: 0.69, stunPlanProjection: 'physical' })).toBe(0.69)
    expect(stunCountForCountChannel({ stunCount: 2.6, stunPlanProjection: 'floor', stunCountPhysical: 4 })).toBe(2)
    expect(stunCountForCountChannel({})).toBe(0)
  })
})

async function overBudget(presetId: string, projectionCode: number) {
  const p = teamPresets.find(x => x.id === presetId)
  expect(p, `预设 ${presetId} 缺失：换一个含琉音、physical 下失衡 ≥1 的队并更新文档 §6`).toBeTruthy()
  const { catalog, config } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  const calc = useResourceCalc()
  for (let i = 0; i < 3; i++) config.setAgent(i, p!.team[i])
  config.applyTeamPreset(p!.team as [string, string, string])
  config.setMechanicSetting('time.stunPlanProjection', projectionCode)
  const rr = calc.resourceResult.value
  expect(rr).toBeTruthy()
  const tt = buildTeamTimeSummary({ rr: rr!, battleTime: rr!.totalTime, invincibleTime: config.enemy.invincibleTime ?? 0, nameOf: () => '' })
  return { over: -tt.slack, stun: calc.stunPoolResult.value?.stunCount ?? 0 }
}

describe('physical 模式：琉音赠大账本与物化同口径（不超预算）', () => {
  for (const id of ['auto-1321-1481-1491', 'auto-1381-1481-1311']) {
    it(id, async () => {
      const r = await overBudget(id, 4)
      expect(r.stun).toBeGreaterThanOrEqual(1)
      // 修复前 +2.37s / +2.52s；修复后 0.00。阈值取 0.05（与分析脚本「超预算」判定同口径）
      expect(r.over).toBeLessThan(0.05)
    }, 60000)
  }
})
