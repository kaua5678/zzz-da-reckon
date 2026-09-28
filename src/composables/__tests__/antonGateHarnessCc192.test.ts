/**
 * CC-192（lead 2026-09-28）：安东额外能力「通力合作」生产接线的集成覆盖。
 * 背景：1111.json 缺 additionalAbility 声明 ⇒ panelPhases 从不置 additionalAbilityActive ⇒ 感电追加事件恒不触发；
 * 模块单测直构 `panel: { additionalAbilityActive: 1 }`，看不见这条接线。本测试走 harness 真队伍，只断言门控。
 * catalog 原文：队伍中存在与自身属性或阵营相同的角色时触发。
 * 注：总伤是否随触发率滑块变化另有阻塞——生产计划里安东没有爆发状态招式行（普攻是通用 basic_attack 行），
 * 模块按 moveId 匹配的电钻次数为 0（第 215 轮实测），见 stun-dual-source §24.39 / CC-193。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'

const gate = () => computePanelPhases(0, useConfigStore(), useCatalogStore())!.inCombat.additionalAbilityActive

describe('CC-192 安东通力合作门控接线', () => {
  it('同属性/同阵营队友在队 ⇒ 门控置 1', async () => {
    // 格莉丝 1181：电属性、白祇重工（与安东同属性且同阵营）
    await setupHarness(['1111', '1181', '1191'].map(agentId => ({ agentId })), { recommendedBuild: true })
    expect(gate()).toBe(1)
  }, 60000)

  it('无同属性/同阵营队友 ⇒ 门控为 0', async () => {
    // 艾莲 1191 / 星见雅 1091：冰属性，非白祇重工
    await setupHarness(['1111', '1191', '1091'].map(agentId => ({ agentId })), { recommendedBuild: true })
    expect(gate()).toBe(0)
  }, 60000)
})
