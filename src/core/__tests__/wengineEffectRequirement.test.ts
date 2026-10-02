/**
 * CC-102（R5 D19）：音擎 effect 级 `requirement` 必须生效。
 *
 * 数据：14150 壳中之灵 selfBuff 的三条 effect 带 `requirement: { attribute: "ether" }`
 * （etherDmg / anomalyDmgBonus / disorderDamageBonus）。
 * 修前：`core/buff.ts#collectWEngineBuffs` 只看组级 condition，effect 级 requirement 零读取
 * ⇒ 非以太的异常角色（如 简 1261 物理）也吃到 +10% 属性异常增伤、+10% 紊乱增伤。
 * 口径：requirement 按「装备者」判定（与驱动盘 discRequirementMet 同口径）；
 * 无 requirement 的 effect（异常精通 +90）不受影响。
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
  return (inCombat(agentId, '14150')[key] ?? 0) - (inCombat(agentId)[key] ?? 0)
}

describe('CC-102 音擎 effect 级 requirement', () => {
  it('数据前提：14150 三条 effect 带 requirement.attribute=ether', () => {
    const effs = getWEngine('14150').effect.selfBuff.effects
    const req = effs.filter((e: any) => e.requirement).map((e: any) => [e.stat, e.requirement.attribute])
    expect(req).toEqual([['etherDmg', 'ether'], ['anomalyDmgBonus', 'ether'], ['disorderDamageBonus', 'ether']])
  })

  it('以太异常（爱芮 1501）：+10 异常增伤、+10 紊乱增伤、+90 异常精通', () => {
    expect(delta('1501', 'anomalyDmgBonus')).toBeCloseTo(10, 6)
    expect(delta('1501', 'disorderDamageBonus')).toBeCloseTo(10, 6)
    expect(delta('1501', 'anomalyProficiency')).toBeCloseTo(90, 6)
  })

  it('★ 物理异常（简 1261）：不吃以太限定的两条（修前各 +10），异常精通 +90 照常', () => {
    expect(delta('1261', 'anomalyDmgBonus')).toBeCloseTo(0, 6)
    expect(delta('1261', 'disorderDamageBonus')).toBeCloseTo(0, 6)
    expect(delta('1261', 'anomalyProficiency')).toBeCloseTo(90, 6)
  })

  it('判定函数：未知装备者不拦截；specialty/attribute 任一不符即拦截', () => {
    expect(wEngineEffectRequirementMet(undefined, {})).toBe(true)
    expect(wEngineEffectRequirementMet({ attribute: 'ether' }, {})).toBe(true)
    expect(wEngineEffectRequirementMet({ attribute: 'ether' }, { wearerAttribute: 'ether' })).toBe(true)
    expect(wEngineEffectRequirementMet({ attribute: 'ether' }, { wearerAttribute: 'fire' })).toBe(false)
    expect(wEngineEffectRequirementMet({ specialty: 'attack' }, { wearerSpecialty: 'stun' })).toBe(false)
  })
})
