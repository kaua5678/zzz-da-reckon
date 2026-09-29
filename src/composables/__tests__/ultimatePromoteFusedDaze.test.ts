/**
 * CC-244：琉音转大赠送的「一次完整终结技」失衡值取融合组整段（与伤害 fusedOf、helpers 主执行、chainGift 同口径）。
 * 修前 ultimatePromote.ts 只取主段 getRowValue(ultMove,'daze')：照 1341014（兔兔连斩 #1+#2）只送出半招失衡。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { buildPromoteParams } from '@/composables/resourceCalc/ultimatePromote'
import { findMoveById, fusedRowValue, getRowValue } from '@/data/moveTableQueries'

describe('CC-244 转大赠送终结技失衡值取融合组整段', () => {
  it('照 1341014：ultDaze = Σ 融合组 daze > 主段 daze', async () => {
    await setupHarness([{ agentId: '1341' }, { agentId: '1481' }, { agentId: '1211' }], { recommendedBuild: true })
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value!
    const catalog = useCatalogStore()
    const p = buildPromoteParams(useConfigStore(), catalog, rr, calc.resourceConfig.value!.characters)!
    expect(p.ultimateMoveId).toBe('1341014')
    const skills = catalog.agentSkillsByAgentMap.get('1341')
    const fused = fusedRowValue(skills, '1341014', 'daze')!
    const head = getRowValue(findMoveById(skills, '1341014'), 'daze')
    expect(fused).toBeGreaterThan(head)
    expect(p.ultDaze).toBeCloseTo(fused, 9)
  })
})
