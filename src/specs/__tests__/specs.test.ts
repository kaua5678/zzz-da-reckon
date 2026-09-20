import { describe, expect, it } from 'vitest'
import { createDefaultLogicEditorState } from '@/logicEditor/defaults'
import { emptyPanel } from '@/core/panel'
import { agentSpecs, getAgentSpec } from '@/specs/registry'
import { applySpecAttributeConversions } from '@/specs/runtime'

describe('agent mechanic specs', () => {
  it('registers structured specs for known agent mechanics', () => {
    expect(agentSpecs.length).toBeGreaterThanOrEqual(2)
    expect(getAgentSpec('1561')?.id).toBe('agent:velina')
    expect(getAgentSpec('1401')?.id).toBe('agent:alice')
  })

  it('keeps agent ids unique across the registry', () => {
    const ids = agentSpecs.flatMap(spec => spec.agentIds)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('drives logic editor defaults from spec data', () => {
    const state = createDefaultLogicEditorState()
    const velinaFusion = state.rowFusions.find(rule => rule.id === 'velina_broad_damage')

    expect(velinaFusion?.moveId).toBe('1561007')
    expect(velinaFusion?.multiplier).toBe(10)
    expect(velinaFusion?.enabled).toBe(false)
    expect(state.objects.some(object => object.id === 'velina_corrosion')).toBe(true)
    expect(state.attributeConversions.some(rule => rule.id === 'alice_mastery_to_proficiency')).toBe(true)
  })

  it('executes Velina regen conversion from spec data', () => {
    const panel = emptyPanel()
    panel.energyRegenOutOfCombat = 1.5

    applySpecAttributeConversions(panel, getAgentSpec('1561')?.attributeConversions ?? [])

    expect(panel.dmgBonus).toBeCloseTo(6.3)
    expect(panel.anomalyMastery).toBeCloseTo(15)
  })

  it('caps attribute conversion values', () => {
    const panel = emptyPanel()
    panel.energyRegenOutOfCombat = 10

    applySpecAttributeConversions(panel, getAgentSpec('1561')?.attributeConversions ?? [])

    expect(panel.dmgBonus).toBe(35)
    expect(panel.anomalyMastery).toBe(84)
  })

  it('executes Alice mastery conversion from spec data', () => {
    const panel = emptyPanel()
    panel.anomalyMastery = 150

    applySpecAttributeConversions(panel, getAgentSpec('1401')?.attributeConversions ?? [])

    expect(panel.anomalyProficiency).toBeCloseTo(16)
  })

  it('records comprehensive mechanic notes for newly onboarded characters', () => {
    const ids = ['1261', '1581', '1411', '1171', '1511']
    for (const id of ids) {
      const spec = getAgentSpec(id)
      expect(spec?.notes.length ?? 0, `${id} notes`).toBeGreaterThanOrEqual(10)
      expect(spec?.resources.length ?? 0, `${id} resources`).toBeGreaterThanOrEqual(1)
    }
  })

  it('keeps spec team buffs at full coverage by default', () => {
    // ⚠ 2026-09-20 R64：原写法是**硬编码 4 个样本** `['1561','1401','1181','1501']`，其中 `1561`
    // 已因「侵染区是风队通用机制、不是维琳娜的拐力」而**正确地**撤掉 `teamBuffs`
    // （见 `src/mechanics/__tests__/specTeamBuffSingleSource.test.ts`）⇒ 该样本恒空、测试恒红。
    // 修法**不是**把它从样本里删掉（那会顺手削弱判据），而是改成**全库不变量**：
    // 凡是声明了 `teamBuffs` 的 spec，其每条默认覆盖率必须是 1。全库 20 个 spec 逐条覆盖，
    // 比原来 4 个样本**更强**，且不会随某个 spec 的 teamBuffs 增删而腐化。
    const specsWithBuffs = agentSpecs.filter(spec => (spec.teamBuffs?.length ?? 0) > 0)

    // 反空洞下限（R62 第七句：探针的「绿」可能是「没跑起来」）——
    // 若哪天过滤条件写错导致集合为空，本断言必须红，而不是让下面的循环空转通过。
    expect(specsWithBuffs.length,
      '全库应有多个 spec 声明 teamBuffs；若为 0 说明本判据已空转（不是「全库都合规」）'
    ).toBeGreaterThanOrEqual(10)

    for (const spec of specsWithBuffs) {
      for (const buff of spec.teamBuffs ?? []) {
        expect(buff.coverage, `${spec.id}/${buff.id} coverage`).toBe(1)
      }
    }
  })
})
