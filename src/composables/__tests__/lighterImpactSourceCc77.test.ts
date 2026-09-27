/**
 * CC-77：莱特 1161 `adjustTeammateBuffSource`（来源面板局内冲击 ×1.2，喷发耗士气）的集成覆盖。
 * 背景（census §5.45 / :1238–1241）：×1.2→×1.3 dump 零差 = 推荐配装下公式已顶 75，无法证明 ×1.2 生效。
 * 本测试改用「×1.0 vs ×1.2」与「按比例缩放钩子」：在测试里包一层钩子，记录来源冲击 S，
 * 再逐个比例断言艾莲冰/火伤增量 == teammate-buffs.json 公式 min(75, 25 + floor(max(0, S·k − 170)/10)·5)。
 * 第 96 轮实测（HEAD 4d4b66e，推荐配装）：S·1.2 ≈ 278.49（= 莱特自身局内面板冲击）；×1.0 → +55，×1.2 → +75（顶）；
 * 无推荐配装（白板）时 S·1.2 < 180 ⇒ 恒 +25，比例只在 ×2 附近才起作用。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { getAgentMechanic } from '@/mechanics'
import type { AgentMechanicModule } from '@/mechanics/types'

const BUFF_ID = 'lighter.additional_morale_ice_fire_dmg'
const formula = (x: number) => Math.min(75, 25 + Math.floor(Math.max(0, x - 170) / 10) * 5)
type Hook = AgentMechanicModule['adjustTeammateBuffSource']
const mod = () => getAgentMechanic('1161')! as AgentMechanicModule
let orig: Hook | undefined
afterEach(() => { if (orig) mod().adjustTeammateBuffSource = orig; orig = undefined })

describe('CC-77 莱特来源面板冲击 ×1.2 集成覆盖', () => {
  it('推荐配装：×1.2 真实生效（×1.0 少 20），各比例增量 == 数据表公式', async () => {
    await setupHarness(['1191', '1161', '1311'].map(agentId => ({ agentId })), { recommendedBuild: true })
    const config = useConfigStore()
    const catalog = useCatalogStore()
    const sel = (config as unknown as { teammateBuffSelections: Record<string, { enabled: boolean }> }).teammateBuffSelections
    expect(sel[BUFF_ID]?.enabled).toBe(true)
    const panel = (slot: number) => computePanelPhases(slot, config, catalog)!.inCombat
    orig = mod().adjustTeammateBuffSource
    expect(orig).toBeTypeOf('function')

    // 包一层：记录进入钩子前的来源冲击 S，再交给原钩子
    let S = Number.NaN
    mod().adjustTeammateBuffSource = (input) => { S = input.source.inCombat?.impact ?? Number.NaN; orig!(input) }
    const on = panel(0)
    expect(Number.isFinite(S)).toBe(true)
    // 来源 S × 1.2 == 莱特自身局内面板冲击（applyPanel 的 +20% 与本钩子同一口径）
    expect(S * 1.2).toBeCloseTo(panel(1).impact, 6)
    sel[BUFF_ID]!.enabled = false
    const off = panel(0)
    sel[BUFF_ID]!.enabled = true
    expect(on.iceDmg - off.iceDmg).toBeCloseTo(formula(S * 1.2), 9)
    expect(on.fireDmg - off.fireDmg).toBeCloseTo(formula(S * 1.2), 9)

    for (const k of [1.0, 1.05, 1.1, 1.15, 1.3]) {
      mod().adjustTeammateBuffSource = ({ source }) => {
        if (source.inCombat) source.inCombat = { ...source.inCombat, impact: (source.inCombat.impact ?? 0) * k }
      }
      expect(panel(0).iceDmg - off.iceDmg, `k=${k}`).toBeCloseTo(formula(S * k), 9)
    }
    // 关键区分：推荐配装下没有 ×1.2 就到不了 75——若此条因配装数据变动失效，换一个 formula(S) < 75 的配装
    expect(formula(S)).toBeLessThan(formula(S * 1.2))
  }, 60000)
})
