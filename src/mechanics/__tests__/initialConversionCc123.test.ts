/**
 * CC-123（第 150 轮）：原文「初始 X」类属性转化读**局外**面板（与 CC-118 卢西娅同口径）。
 * - 南宫羽 1511：「每超过1点初始异常掌控会使自身的冲击力提升1点」（阈值 110）
 * - 琉音 1481：「初始暴击率超过50%时，每超过1%，冲击力提升」2 点（上限 100）
 * 阳性对照：局内 ≠ 局外时，结果只随局外变化。回退点：spec sourcePanelPhase 改回 inCombat 即本测试变红。
 */
import { describe, expect, it } from 'vitest'
import { emptyPanel } from '@/core/panel'
import { nangongMechanic } from '@/mechanics/agents/nangong'
import { liuyinMechanic } from '@/mechanics/agents/liuyin'

type PanelIn = Parameters<NonNullable<typeof nangongMechanic.applyPanel>>[0]
type CharIn = Parameters<NonNullable<typeof nangongMechanic.buildCharConfig>>[0]

describe('CC-123：「初始」转化读局外面板', () => {
  it('南宫羽：局外掌控 130 → 冲击 +20（局内 150 不参与）', () => {
    const panel = emptyPanel()
    panel.anomalyMastery = 150
    const outOfCombatPanel = emptyPanel()
    outOfCombatPanel.anomalyMastery = 130
    nangongMechanic.applyPanel!({ panel, outOfCombatPanel, cinemaLevel: 0, settings: {} } as unknown as PanelIn)
    expect(panel.impact).toBeCloseTo(20)
  })

  it('琉音：局外暴击 60% → 冲击 +20（局内 90% 不参与）', () => {
    const panel = emptyPanel()
    panel.critRate = 90
    panel.additionalAbilityActive = 1
    const outOfCombatPanel = emptyPanel()
    outOfCombatPanel.critRate = 60
    liuyinMechanic.applyPanel!({ slot: 0, team: [], agent: { id: '1481' }, cinemaLevel: 0, panel, outOfCombatPanel, settings: {} } as unknown as PanelIn)
    expect(panel.impact).toBeCloseTo(20)
  })

  it('南宫羽展示值：buildCharConfig 记录局外掌控', () => {
    const panel = emptyPanel()
    panel.anomalyMastery = 150
    const outOfCombatPanel = emptyPanel()
    outOfCombatPanel.anomalyMastery = 130
    const cfg = { panel } as Record<string, unknown>
    nangongMechanic.buildCharConfig!({ skills: [], cinemaLevel: 0, cfg, panel, outOfCombatPanel, getRowValue: () => 0 } as unknown as CharIn)
    expect(cfg.nangongInitialMastery).toBe(130)
  })
})
