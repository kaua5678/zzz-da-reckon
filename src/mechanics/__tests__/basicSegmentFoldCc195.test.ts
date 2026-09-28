/**
 * CC-195：普攻只有一条汇总行（`basic_attack`，按时长）⇒ 模块按段 id 数命中永远落空。
 * 通用折算：命中次数 = floor(汇总时长 / 同名 #N 连段整套时长)。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useCatalogStore } from '@/stores/catalog'
import { basicComboCycleSeconds } from '@/data/moveTableQueries'
import { basicSummarySeconds } from '@/types/resource'

describe('CC-195 普攻汇总行 → 段命中折算', () => {
  it('basicComboCycleSeconds：同名连段整套时长；不带 #N / 不存在 ⇒ 0', async () => {
    await setupHarness([{ agentId: '1491' }, { agentId: '' }, { agentId: '' }])
    const skills = useCatalogStore().agentSkillsByAgentMap.get('1491')
    // 鬼马流星锤 #1–#4 = 0.25 + 1.053 + 1.135 + 2.329（坏猫出没不带 #N，不计）
    expect(basicComboCycleSeconds(skills, '1491004')).toBeCloseTo(4.767, 3)
    expect(basicComboCycleSeconds(skills, '1491005')).toBe(0)
    expect(basicComboCycleSeconds(skills, 'nope')).toBe(0)
  }, 60000)

  it('千夏：普攻 #4 进入凝视标记供给（真管线）', async () => {
    await setupHarness(["1491", "1031", "1211"].map(agentId => ({ agentId })), { recommendedBuild: true })
    const rr = useResourceCalc().resourceResult.value
    const ch = rr?.characters.find(c => c.agentId === '1491')
    const execs = ch?.executions ?? []
    const basic = basicSummarySeconds(execs)
    expect(basic).toBeGreaterThan(5)
    // CC-198：1491008 特别拍照技巧（引擎额外强特行）经 patchExecutions / prePatchExecutions 计入（原 §24.42 已知缺口）
    const cardHits = execs.filter(e => ['1491007', '1491008', '1491018', '1491019'].includes(e.moveId ?? ''))
      .reduce((s, e) => s + Math.floor(e.count ?? 0), 0)
    const skills = useCatalogStore().agentSkillsByAgentMap.get('1491')
    const expected = cardHits + Math.floor(basic / basicComboCycleSeconds(skills, '1491004'))
    const supply = (ch as any)?.specResources?.qianxia_gaze?.markSupply
    expect(supply).toBe(expected)
    expect(supply).toBeGreaterThan(cardHits)
  }, 120000)
})
