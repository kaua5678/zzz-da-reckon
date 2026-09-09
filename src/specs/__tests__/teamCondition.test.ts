/**
 * 额外能力门控（声明式 teamConditions）——特化枚举必须与 catalog 对齐。
 *
 * 回归点（2026-09-09 用户指正）：1621/1101 的额外能力里写着不存在的 `edgeguard`，
 * 而全库唯一的锋御角色克拉蕾(1611) `specialty === 'sharpen'` → 「队伍存在锋御角色」永远不成立
 * （`matchTeamCondition` 直接 `cond.values.includes(agent.specialty)`）。
 * 现在 1101/1621 用 `sharpen`；本用例锁住「克拉蕾当队友时门控为真」。
 */
import { describe, expect, it } from 'vitest'
import { evalAdditionalAbility } from '@/specs/teamCondition'
import { getAgentSpec } from '@/specs/registry'
import type { Agent } from '@/types/catalog'
import type { MechanicTeamMember } from '@/mechanics/types'

const agent = (id: string, specialty: string): Agent => ({ id, specialty } as Agent)

function member(slot: number, id: string, specialty: string): MechanicTeamMember {
  return {
    slot,
    agentId: id,
    agent: agent(id, specialty),
    cinemaLevel: 0,
    potentialLevel: 0,
    wEngineId: '',
    wEngineModLevel: 1,
  }
}

describe('额外能力 teamConditions · 特化门控', () => {
  it('洛克茜(1621)：锋御队友（克拉蕾 sharpen）满足「强攻/锋御」', () => {
    const spec = getAgentSpec('1621')!.additionalAbility
    const withSharpen = [member(0, '1621', 'stun'), member(1, '1611', 'sharpen')]
    expect(evalAdditionalAbility(withSharpen, 0, agent('1621', 'stun'), spec)).toBe(true)
    // 负例：异常队友不满足
    const withAnomaly = [member(0, '1621', 'stun'), member(1, '1261', 'anomaly')]
    expect(evalAdditionalAbility(withAnomaly, 0, agent('1621', 'stun'), spec)).toBe(false)
  })

  it('珂蕾妲(1101)：锋御队友满足「命破/锋御」', () => {
    const spec = getAgentSpec('1101')!.additionalAbility
    const withSharpen = [member(0, '1101', 'attack'), member(1, '1611', 'sharpen')]
    expect(evalAdditionalAbility(withSharpen, 0, agent('1101', 'attack'), spec)).toBe(true)
    const withAnomaly = [member(0, '1101', 'attack'), member(1, '1261', 'anomaly')]
    expect(evalAdditionalAbility(withAnomaly, 0, agent('1101', 'attack'), spec)).toBe(false)
  })

  it('全库 spec 的 specialty 门控值都必须是 catalog 里真实存在的特化', () => {
    const VALID = new Set(['attack', 'stun', 'anomaly', 'support', 'defense', 'rupture', 'sharpen'])
    const offenders: string[] = []
    for (const id of ['1101', '1621', '1211', '1011']) {
      const spec = getAgentSpec(id)
      for (const cond of spec?.additionalAbility?.teamConditions ?? []) {
        if (cond.type !== 'specialty') continue
        for (const v of cond.values) if (!VALID.has(v)) offenders.push(`${id}: ${v}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
