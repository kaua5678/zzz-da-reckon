/**
 * CC-51 → CC-169（第 195 轮）：配置页「局外」面板 = 引擎局外面板 `computePanelPhases(slot).outOfCombat`。
 * 旧版本测的是「与原页面内联算法逐值相等（含事后叠加的全局 Buff）」；口径已改，见 composables/outOfCombatPanel.ts 头注释。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { computeOutOfCombatPanel } from '@/composables/outOfCombatPanel'

describe('computeOutOfCombatPanel', () => {
  it('与引擎局外面板逐值相等（三个槽位）；启用的全局 Buff 只进局内、不进局外', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1161' }, { agentId: '1311' }, { agentId: '1211' }], { recommendedBuild: true })
    const before = computeOutOfCombatPanel(0, config, catalog)!
    const inBefore = computePanelPhases(0, config, catalog)!.inCombat
    config.globalBuffs.push({ id: 't-on', name: '测试开', stat: 'atkPct', value: 20, enabled: true, targetSkillType: 'all' })
    config.globalBuffs.push({ id: 't-off', name: '测试关', stat: 'critRate', value: 50, enabled: false, targetSkillType: 'all' })

    for (const slot of [0, 1, 2]) expect(computeOutOfCombatPanel(slot, config, catalog)).toEqual(computePanelPhases(slot, config, catalog)!.outOfCombat)

    // 全局 Buff 是局内效果：局外不变、局内确实变了（否则上面的相等可能只是「都没施加」）
    expect(computeOutOfCombatPanel(0, config, catalog)).toEqual(before)
    expect(computePanelPhases(0, config, catalog)!.inCombat.atk).toBeGreaterThan(inBefore.atk)
  }, 60000)

  it('返回副本：改返回值不影响下一次计算', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1161' }, '', ''], { recommendedBuild: true })
    const a = computeOutOfCombatPanel(0, config, catalog)!
    const atk = a.atk
    a.atk = -1
    expect(computeOutOfCombatPanel(0, config, catalog)!.atk).toBe(atk)
  }, 60000)

  it('空槽 / 无角色 ⇒ null', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1161' }, '', ''])
    expect(computeOutOfCombatPanel(1, config, catalog)).toBeNull()
  }, 60000)
})
