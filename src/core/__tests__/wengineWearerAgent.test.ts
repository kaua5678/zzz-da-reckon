/**
 * CC-103（R5 D18）：14155 日冕遗蜕的以太抗性无视只给佩洛伊斯（1551）。
 *
 * 数据：effect `effect_wiki_2031_self_ether_res_ignore`（enemyEtherResReduction 16）原本只有散文
 * condition「装备者为佩洛伊斯且处于日蚀效果」；CC-103 在同一 effect 上补机器可读的
 * `requirement.wearerAgentIds: ["1551"]`，引擎按数据通用判定（不在 core 写角色分支）。
 * 「处于日蚀效果」是状态，仍由覆盖率兜底。
 * 修前：朱鸢（1241，以太强攻）装 14155 也吃到 16。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calcPanel } from '@/core/panel'
import { wEngineEffectRequirementMet } from '@/core/wengineConditions'

const cat = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as any
const setsMap = new Map<string, any>(cat.driveDiscSets.map((s: any) => [String(s.id), s]))
const statRules = cat.statRules
const getAgent = (id: string) => cat.agents.find((a: any) => a.id === id)
const getWEngine = (id: string) => cat.wEngines.find((w: any) => String(w.id) === id)
const disc = (): any => ({ fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} })

function inCombat(agentId: string, wEngineId?: string) {
  return calcPanel(getAgent(agentId), wEngineId ? getWEngine(wEngineId) : undefined, disc(), setsMap, [], statRules, {
    cinemaLevel: 0,
    wEngineModLevel: 1,
  }).inCombat as unknown as Record<string, number>
}
function delta(agentId: string, key: string) {
  return (inCombat(agentId, '14155')[key] ?? 0) - (inCombat(agentId)[key] ?? 0)
}

describe('CC-103 音擎 effect 级 requirement.wearerAgentIds', () => {
  it('数据前提：14155 以太抗性无视 effect 限定 1551', () => {
    const eff = getWEngine('14155').effect.selfBuff.effects.find((e: any) => e.id === 'effect_wiki_2031_self_ether_res_ignore')
    expect(eff.stat).toBe('enemyEtherResReduction')
    expect(eff.requirement?.wearerAgentIds).toEqual(['1551'])
  })

  it('佩洛伊斯（1551）：以太抗性无视 +16，暴击率 +20', () => {
    expect(delta('1551', 'enemyEtherResReduction')).toBeCloseTo(16, 6)
    expect(delta('1551', 'critRate')).toBeCloseTo(20, 6)
  })

  it('★ 朱鸢（1241）：不吃以太抗性无视（修前 +16），暴击率 +20 照常', () => {
    expect(delta('1241', 'enemyEtherResReduction')).toBeCloseTo(0, 6)
    expect(delta('1241', 'critRate')).toBeCloseTo(20, 6)
  })

  it('判定函数：装备者 id 缺省不拦截；不在名单即拦截', () => {
    expect(wEngineEffectRequirementMet({ wearerAgentIds: ['1551'] }, {})).toBe(true)
    expect(wEngineEffectRequirementMet({ wearerAgentIds: ['1551'] }, { wearerAgentId: '1551' })).toBe(true)
    expect(wEngineEffectRequirementMet({ wearerAgentIds: ['1551'] }, { wearerAgentId: '1241' })).toBe(false)
  })
})
