/**
 * CC-80：mechanics/teamVeil.ts 帷幕来源写死集合 → 模块能力 teamVeilCount。
 * 对照 = 原实现逐字复刻（legacy）；catalog 全角色单人 + 多人组合 × 若干 ex/ult/战斗时长。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { computeTeamVeilCountTotal } from '@/mechanics/teamVeil'
import { computeZhaoVeilCount } from '@/mechanics/agents/zhao'
import { getRegisteredAgentMechanics } from '@/mechanics'
import type { CharacterOperationConfig } from '@/types/resource'

function legacy(chars: CharacterOperationConfig[], exCounts: number[], ultimateCounts: number[], combatTime = 180): number {
  const ULT = new Set(['1501', '1431'])
  const EX = new Set(['1491'])
  let total = 0
  chars.forEach((mate, index) => {
    const ex = Math.max(0, Math.floor(exCounts[index] ?? 0))
    const ult = Math.max(0, Math.floor(ultimateCounts?.[index] ?? 0))
    if (mate.agentId === '1341') total += computeZhaoVeilCount(ex, ult, combatTime)
    else if (ULT.has(mate.agentId)) total += ult
    else if (EX.has(mate.agentId)) total += ex
  })
  return total
}
const cfg = (agentId: string) => ({ agentId }) as unknown as CharacterOperationConfig

describe('CC-80 帷幕来源 → teamVeilCount', () => {
  it('声明者 = 1341 / 1431 / 1491 / 1501', () => {
    const ids = getRegisteredAgentMechanics().filter(m => !!m.teamVeilCount).flatMap(m => m.agentIds).sort()
    expect(ids).toEqual(['1341', '1431', '1491', '1501'])
  })

  it('全注册角色单人 + 多人组合 × ex/ult/时长 == 原实现', () => {
    const ids = [...new Set(getRegisteredAgentMechanics().flatMap(m => m.agentIds)), '', '9999']
    const counts: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [3, 2], [7.9, 4.2], [-1, 2], [12, 6]]
    let n = 0
    for (const id of ids) {
      for (const [ex, ult] of counts) {
        for (const t of [60, 180, 300]) {
          expect(computeTeamVeilCountTotal([cfg(id)], [ex], [ult], t), `${id} ${ex}/${ult}/${t}`).toBe(legacy([cfg(id)], [ex], [ult], t))
          n++
        }
      }
    }
    const teams = [['1341', '1431', '1491'], ['1501', '1341', '1211'], ['1491', '1501', '1431'], ['1141', '1211', '1041']]
    for (const team of teams) {
      const chars = team.map(cfg)
      for (const [ex, ult] of counts) {
        const exs = team.map((_, i) => ex + i)
        const ults = team.map((_, i) => ult + 2 * i)
        expect(computeTeamVeilCountTotal(chars, exs, ults, 180), team.join('-')).toBe(legacy(chars, exs, ults, 180))
      }
    }
    expect(n).toBeGreaterThan(300)
  })

  it('源码锁：teamVeil.ts 不再含带引号的四位角色 id', () => {
    const src = readFileSync(resolve(__dirname, '../teamVeil.ts'), 'utf-8')
    expect(src).not.toMatch(/['"]1\d{2}1['"]/)
    expect(src).toContain('teamVeilCount?.(')
  })
})
