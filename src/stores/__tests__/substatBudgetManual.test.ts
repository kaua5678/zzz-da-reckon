/**
 * 副词条预算设置（单属性上限 / 总步数档）变化时，**只重算自动分配的槽位**，不覆盖用户手改的。
 *
 * 用户 2026-10-18 裁决：「百暴算是一种优化，防止溢出 0 收益的优化。这些你得分类处理，
 * 不是说什么时候都开，改了就用，之前静默乱用导致暴击溢出和词条实现错误就是例子。」
 * 对应 ENGINE_PIPELINE_GUIDE §4 坑 53 的 B 档（估算级）纪律：**自动逻辑不得静默替用户改配置**。
 *
 * 修前实测：手改成 暴击3/爆伤20/攻击20 → 把「副词条单属性上限」20 调到 15 → 分配被整份重置成
 * {critRate:6, critDmg:15, atkPct:15, penFlat:7}，页面上没有任何提示。
 */
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'

describe('副词条预算设置不覆盖用户手改的分配', () => {
  it('手改后改预算：手改的槽位保持原样，未手改的槽位跟随预算重算', async () => {
    const { catalog } = await setupHarness([{ agentId: '1591' }, { agentId: '1571' }, { agentId: '1211' }])
    const cfg = useConfigStore()
    await catalog.loadBuildRecommendations()
    for (let i = 0; i < 3; i++) cfg.applyBuildRecommendationForSlot(i)

    // 槽 0：用户手改
    cfg.setSubStatCount(0, 'critRate', 3)
    cfg.setSubStatCount(0, 'atkPct', 20)
    const manualBefore = JSON.stringify(cfg.team[0]!.driveDisc.subStatAllocation)
    // 槽 1：保持自动
    const autoBefore = JSON.stringify(cfg.team[1]!.driveDisc.subStatAllocation)

    cfg.setMechanicSetting('optimizer.substatCap', 15)
    await nextTick()
    await nextTick()

    expect(JSON.stringify(cfg.team[0]!.driveDisc.subStatAllocation), '手改过的槽位被预算变更覆盖了').toBe(manualBefore)
    expect(JSON.stringify(cfg.team[1]!.driveDisc.subStatAllocation), '自动槽位应跟随新预算重算').not.toBe(autoBefore)
  }, 120000)

  it('显式「一键应用推荐」后回到自动档：再改预算会跟随', async () => {
    const { catalog } = await setupHarness([{ agentId: '1591' }, { agentId: '1571' }, { agentId: '1211' }])
    const cfg = useConfigStore()
    await catalog.loadBuildRecommendations()
    cfg.applyBuildRecommendationForSlot(0)
    cfg.setSubStatCount(0, 'critRate', 3)
    cfg.applyBuildRecommendationForSlot(0) // 用户显式恢复推荐
    const autoAlloc = JSON.stringify(cfg.team[0]!.driveDisc.subStatAllocation)
    cfg.setMechanicSetting('optimizer.substatCap', 15)
    await nextTick()
    await nextTick()
    expect(JSON.stringify(cfg.team[0]!.driveDisc.subStatAllocation), '显式应用推荐后应回到自动档').not.toBe(autoAlloc)
  }, 120000)
})
