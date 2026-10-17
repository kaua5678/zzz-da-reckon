/**
 * 副词条「百暴」基线必须与真实面板同口径（2026-10-18，用户报「希格莉德 20 暴击 20 爆伤 3 攻击」）。
 *
 * 症状：推荐配装给希格莉德 20 步暴击（+48%），实际面板 133.4%，超 100% 封顶 33.4 个点、**13 步白扔**；
 * 「优化词条」重排后总伤 +14.4%。
 *
 * 根因：`core/substatOptimizer.ts#computeNoSubstatPanel` 的基线走 `calcPanel`（纯 buff 管线），
 * 而角色模块的 `applyPanel`（核心被动/额外能力/影画面板段）与 3/5 命技能等级通用规则在**编排层**
 * `panelPhases.ts#computePanelPhases` 才派发 ⇒ 基线面板少了角色自己的暴击。
 * 实测修前 62 个角色里 8 个过配：1591(13 步) / 1321(10) / 1521(7) / 1431(7) / 1301(4) / 1291(4) / 1441(4) / 1611(1)。
 *
 * 修法：`DefaultSubStatInput.panelHooks` ⇒ `core/agentPanelPhases.ts#applyAgentPanelHooks`（与编排层同序）。
 * 本测试锁两件事：① 全角色「分配后真实暴击 ≤ 模板封顶」；② 基线面板与真实面板的暴击率一致
 * （≥ 100% 封顶的角色除外——那种角色缺口本来就是 0，基线再准也只能给 0 步）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { computePanel } from '@/composables/resourceCalc/panelPhases'
import { getTemplate } from '@/core/substatOptimizer'

const CRIT_STEP = 2.4

describe('副词条百暴基线 = 真实面板（角色 applyPanel 不得漏算）', () => {
  it('全角色：推荐配装的暴击率不越过模板封顶（修前 8 人溢出）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1591' }, '', ''])
    const cfg = useConfigStore()
    await catalog.loadBuildRecommendations()
    const agents = catalog.displayAgents.filter(a => !a.hidden)
    expect(agents.length).toBeGreaterThan(50)
    const bad: string[] = []
    for (const a of agents) {
      cfg.setAgent(0, a.id, { defer: true })
      cfg.syncTeammateBuffsFromTeam()
      cfg.applyBuildRecommendationForSlot(0)
      const char = cfg.team[0]!
      const steps = char.driveDisc.subStatAllocation?.critRate ?? 0
      if (steps === 0) continue
      const keep = char.driveDisc.subStatAllocation
      char.driveDisc.subStatAllocation = {}
      const noSubs = computePanel(0, cfg, catalog)?.critRate ?? 0
      char.driveDisc.subStatAllocation = keep
      const cap = getTemplate(catalog.getAgent(a.id)!).critRateCap ?? 100
      const after = noSubs + steps * CRIT_STEP
      // 2.4% 一步的取整误差允许 1 步（floor 到步数上限）
      if (after - cap > CRIT_STEP) {
        bad.push(`${a.id} ${a.name.zhCN}: 无副词条 ${noSubs.toFixed(1)}% + ${steps} 步 = ${after.toFixed(1)}% > 封顶 ${cap}%`)
      }
    }
    expect(bad, `暴击词条过配（白扔的步数）：\n${bad.join('\n')}`).toEqual([])
  }, 300000)

  it('希格莉德（1591）：核心被动 +66% 暴击必须进基线 ⇒ 分配不再是满 20 步', async () => {
    const { catalog } = await setupHarness([{ agentId: '1591' }, { agentId: '1571' }, { agentId: '1211' }])
    const cfg = useConfigStore()
    await catalog.loadBuildRecommendations()
    cfg.applyBuildRecommendationForSlot(0)
    const char = cfg.team[0]!
    // 修前：基线 19.4%（只有 buff 管线）⇒ floor((100-19.4)/2.4)=20 步封顶
    expect(char.driveDisc.subStatAllocation.critRate, '满 20 步 = 基线漏了核心被动的 +66%').toBeLessThan(20)
    const panel = computePanel(0, cfg, catalog)!
    const cap = getTemplate(catalog.getAgent('1591')!).critRateCap ?? 100
    expect(panel.critRate, `分配后真实暴击 ${panel.critRate.toFixed(1)}% 不应越封顶 ${cap}%`).toBeLessThanOrEqual(cap + CRIT_STEP)
    // 溢出被消掉的那部分必须换成有效词条（总步数不变）
    const total = Object.values(char.driveDisc.subStatAllocation).reduce((s, n) => s + n, 0)
    expect(total, '预算仍是 43 步（4 词条档），只是从暴击挪给了爆伤/攻击').toBe(43)
  }, 120000)
})
