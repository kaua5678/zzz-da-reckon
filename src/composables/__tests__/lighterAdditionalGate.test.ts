/**
 * 莱特额外能力「斗志昂扬」队友冰/火伤 buff（`lighter.additional_morale_ice_fire_dmg`）默认配置下的生效性回归。
 * 背景：census §5.34 记为未决 ——「莱特来源面板冲击 ×1.2→×1.3 dump 零差，buff 是否真的生效没核实」；§5.45 实测结论：
 *   ① 门控满足（队中有[强攻]或卡吕冬之子）时默认勾选并生效，推荐配装下莱特局内冲击力 ≈278 ≥ 270 ⇒ 公式顶在 75（硬顶），
 *     所以 ×1.2 与 ×1.3 都是 75，dump 零差是「已顶上限」而非「未生效」；
 *   ② 门控不满足时有两道闸：选择表默认不勾（deriveTeammateBuffEnabled），强行勾上后面板层 ADDITIONAL_GATE_BUFFS 仍拦住。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'

const BUFF_ID = 'lighter.additional_morale_ice_fire_dmg'

async function load(team: string[]) {
  await setupHarness(team.map(agentId => ({ agentId })), { recommendedBuild: true })
  const config = useConfigStore()
  const catalog = useCatalogStore()
  const selections = (config as unknown as { teammateBuffSelections: Record<string, { enabled: boolean }> }).teammateBuffSelections
  const panel = (slot: number) => computePanelPhases(slot, config, catalog)!.inCombat
  return { selections, panel }
}

describe('莱特额外能力队友冰火伤 buff：默认配置生效性（census §5.45）', () => {
  it('门控满足（艾莲 强攻）：默认勾选；关掉后艾莲冰伤/火伤各少 75（推荐配装冲击力已顶硬顶）', async () => {
    const { selections, panel } = await load(['1191', '1161', '1311'])
    expect(selections[BUFF_ID]?.enabled).toBe(true)
    expect(panel(1).impact).toBeGreaterThanOrEqual(270)
    const on = panel(0)
    selections[BUFF_ID]!.enabled = false
    const off = panel(0)
    expect(on.iceDmg - off.iceDmg).toBeCloseTo(75, 9)
    expect(on.fireDmg - off.fireDmg).toBeCloseTo(75, 9)
  }, 60000)

  it('门控不满足（青衣/苍角，无强攻、无卡吕冬）：默认不勾；强行勾上面板仍不变（面板层第二道门控）', async () => {
    const { selections, panel } = await load(['1251', '1161', '1131'])
    expect(selections[BUFF_ID]?.enabled).toBe(false)
    const before = [panel(0).iceDmg, panel(2).iceDmg]
    selections[BUFF_ID]!.enabled = true
    expect([panel(0).iceDmg, panel(2).iceDmg]).toEqual(before)
  }, 60000)
})
