/**
 * CC-405 锁：队友在队招式变体（data/moveVariants.ts）
 *
 * 口径：本（1121）在队时，珂蕾妲（1101）强化普攻二段 1101006→1101007、沸腾熔炉引爆 1101105→1101106、
 * 终结技 1101401→1101402（替换非叠加，只换倍率行；actionCode/moveName/actionTime 仍是原段）。
 * 本不在队 = 原值（守住既有 koleda 融合口径不被变体表污染）。
 * 原文：nanoka full/1101.json「当珂蕾妲与本同时出战…会由双方配合发动协同攻击，进一步提升招式的威力」。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { fusedRowValue, getRowValue, findMoveById } from '@/composables/resourceCalc/helpers'
import { segmentSwapped } from '@/data/moveTableQueries'
import { TEAMMATE_MOVE_VARIANTS, teammateSegmentResolver } from '@/data/moveVariants'

import type { AgentSkills } from '@/types/catalog'

type Skills = AgentSkills | undefined
const d = (skills: Skills, id: string) => getRowValue(findMoveById(skills, id), 'damage')

describe('CC-405 teammateSegmentResolver（纯函数）', () => {
  it('登记表形状：珂蕾妲×本三段替换，替换目标都是不同的 moveId', () => {
    const v = TEAMMATE_MOVE_VARIANTS.find(x => x.agentId === '1101' && x.teammateId === '1121')!
    expect(v.swaps).toEqual({ '1101006': '1101007', '1101105': '1101106', '1101401': '1101402' })
    for (const [from, to] of Object.entries(v.swaps)) expect(from).not.toBe(to)
  })

  it('本不在队 / 本角色不是珂蕾妲 → null（调用方零开销）', () => {
    expect(teammateSegmentResolver('1101', ['1101', '1031', '1131'])).toBeNull()
    expect(teammateSegmentResolver('1121', ['1101', '1121', '1031'])).toBeNull()
    expect(teammateSegmentResolver('1031', ['1101', '1121', '1031'])).toBeNull()
  })

  it('本在队 → 登记段被替换、未登记段原样返回；segmentSwapped 对融合主段也为 true', () => {
    const r = teammateSegmentResolver('1101', ['1101', '1121', '1031'])!
    expect(r('1101006')).toBe('1101007')
    expect(r('1101105')).toBe('1101106')
    expect(r('1101401')).toBe('1101402')
    expect(r('1101005')).toBe('1101005')
    expect(r('1101104')).toBe('1101104')
    // 融合主段 1101104 自己没换，但组内引爆段换了 ⇒ 视为被替换（行备注用）
    expect(segmentSwapped('1101104', r)).toBe(true)
    expect(segmentSwapped('1101005', r)).toBe(true)
    expect(segmentSwapped('1101401', r)).toBe(true)
    expect(segmentSwapped('1101001', r)).toBe(false)
  })
})

describe('CC-405 fusedRowValue(segmentOf)：融合组内段替换', () => {
  it('沸腾熔炉：无替换 = 打击+引爆；本在队 = 打击+协同引爆', async () => {
    const { catalog } = await setupHarness([{ agentId: '1101' }])
    const skills = catalog.getAgentSkills('1101')
    const r = teammateSegmentResolver('1101', ['1101', '1121'])!
    expect(fusedRowValue(skills, '1101104', 'damage')).toBeCloseTo(d(skills, '1101104') + d(skills, '1101105'), 6)
    expect(fusedRowValue(skills, '1101104', 'damage', r)).toBeCloseTo(d(skills, '1101104') + d(skills, '1101106'), 6)
    expect(fusedRowValue(skills, '1101005', 'damage', r)).toBeCloseTo(d(skills, '1101005') + d(skills, '1101007'), 6)
    // 协同段严格大于原段（原文「进一步提升招式的威力」）
    expect(d(skills, '1101007')).toBeGreaterThan(d(skills, '1101006'))
    expect(d(skills, '1101106')).toBeGreaterThan(d(skills, '1101105'))
    expect(d(skills, '1101402')).toBeGreaterThan(d(skills, '1101401'))
  })
})

describe('CC-405 真引擎回填（enrichExecutionPlan）', () => {
  it('珂蕾妲+本+妮可：强化普攻/沸腾熔炉/终结技执行行取协同段倍率，actionCode 仍是原段', async () => {
    const { catalog } = await setupHarness([{ agentId: '1101' }, { agentId: '1121' }, { agentId: '1031' }])
    const skills = catalog.getAgentSkills('1101')
    const { resourceResult } = useResourceCalc()
    const exs = resourceResult.value?.characters.find(c => c.agentId === '1101')?.executions ?? []
    const enhanced = exs.find(e => e.moveId === '1101005')
    const ex = exs.find(e => e.moveId === '1101104')
    const ult = exs.find(e => e.moveId === '1101401')
    expect(enhanced && ex && ult).toBeTruthy()
    expect(enhanced!.damageMultiplier).toBeCloseTo(d(skills, '1101005') + d(skills, '1101007'), 3)
    expect(ex!.damageMultiplier).toBeCloseTo(d(skills, '1101104') + d(skills, '1101106'), 3)
    expect(ult!.damageMultiplier).toBeCloseTo(d(skills, '1101402'), 3)
    expect(ult!.dazeMultiplier).toBeCloseTo(getRowValue(findMoveById(skills, '1101402'), 'daze'), 3)
    expect(ult!.actionCode).toBe('1101401')
    expect(ult!.skillTableNote).toContain('CC-405')
    // 协同段不单独成行（替换非叠加）
    expect(exs.some(e => ['1101007', '1101106', '1101402'].includes(e.moveId))).toBe(false)
  })

  it('珂蕾妲+妮可+苍角（无本）：原值不变，备注无 CC-405', async () => {
    const { catalog } = await setupHarness([{ agentId: '1101' }, { agentId: '1031' }, { agentId: '1131' }])
    const skills = catalog.getAgentSkills('1101')
    const { resourceResult } = useResourceCalc()
    const exs = resourceResult.value?.characters.find(c => c.agentId === '1101')?.executions ?? []
    const enhanced = exs.find(e => e.moveId === '1101005')
    const ex = exs.find(e => e.moveId === '1101104')
    const ult = exs.find(e => e.moveId === '1101401')
    expect(enhanced!.damageMultiplier).toBeCloseTo(d(skills, '1101005') + d(skills, '1101006'), 3)
    expect(ex!.damageMultiplier).toBeCloseTo(d(skills, '1101104') + d(skills, '1101105'), 3)
    expect(ult!.damageMultiplier).toBeCloseTo(d(skills, '1101401'), 3)
    expect(ult!.skillTableNote ?? '').not.toContain('CC-405')
  })

  it('本自己的行不受变体表影响（变体只登记在珂蕾妲名下）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1101' }, { agentId: '1121' }, { agentId: '1031' }])
    const skills = catalog.getAgentSkills('1121')
    const { resourceResult } = useResourceCalc()
    const exs = resourceResult.value?.characters.find(c => c.agentId === '1121')?.executions ?? []
    for (const e of exs) {
      if (e.moveId === 'basic_attack' || e.source === 'gift' || e.chainGift) continue
      expect(e.skillTableNote ?? '').not.toContain('CC-405')
      const own = fusedRowValue(skills, e.moveId, 'damage') ?? d(skills, e.moveId)
      if (!e.damageMultiplierOverride && e.skillTableResolved) expect(e.damageMultiplier).toBeCloseTo(own, 3)
    }
  })
})
