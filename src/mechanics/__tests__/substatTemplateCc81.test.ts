/**
 * CC-81：core/substatOptimizer.ts AGENT_TEMPLATES 角色特例 → 模块声明 substatTemplate。
 * 对照 = 原表逐字复刻（LEGACY）；非表内角色 = 职业兜底（与 id 无关）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getTemplate, type SubstatTemplate } from '@/core/substatOptimizer'
import { getRegisteredAgentMechanics } from '@/mechanics'
import type { Agent } from '@/types/catalog'

const LEGACY: Record<string, SubstatTemplate> = {
  '1401': {
    stats: ['anomalyProficiency', 'atkPct'],
    dmgBonusRelevant: true,
    anomalyRelevant: true,
    anomalyRatio: 0.7,
  },
  '1581': {
    stats: ['anomalyProficiency', 'atkPct'],
    dmgBonusRelevant: true,
    anomalyRelevant: true,
    anomalyRatio: 0.95,
    teamAtkTransfer: { ratios: [0.06, 0.12, 0.40], cap: 1600 },
    atkWeightInAnomaly: 0.1,
    minGainRatio: 0.15,
  },
  '1261': {
    stats: ['anomalyProficiency', 'atkPct'],
    dmgBonusRelevant: true,
    anomalyRelevant: true,
    anomalyRatio: 0.9,
  },
  '1561': {
    stats: ['anomalyProficiency', 'atkPct'],
    dmgBonusRelevant: true,
    anomalyRelevant: true,
    anomalyRatio: 0.75,
  },
  '1171': {
    stats: ['anomalyProficiency', 'atkPct'],
    dmgBonusRelevant: true,
    anomalyRelevant: true,
    anomalyRatio: 0.9,
  },
  '1451': {
    stats: ['hpPct', 'atkPct', 'defPct'],
    dmgBonusRelevant: false,
    anomalyRelevant: false,
    anomalyRatio: 0,
  },
  '1621': {
    stats: ['defPct', 'atkPct', 'critRate'],
    dmgBonusRelevant: true,
    anomalyRelevant: false,
    anomalyRatio: 0,
  },
  '1221': {
    stats: ['anomalyProficiency', 'atkPct'],
    dmgBonusRelevant: true,
    anomalyRelevant: true,
    anomalyRatio: 0.9,
  },
}
const SPECS = ['attack', 'anomaly', 'support', 'stun', 'defense', 'rupture', 'sharpen', undefined]
const mock = (id: string, specialty?: string) => ({ id, specialty }) as unknown as Agent

describe('CC-81 副词条模板 → 模块 substatTemplate', () => {
  it('声明者 = 原表 8 个角色', () => {
    const ids = getRegisteredAgentMechanics().filter(m => !!m.substatTemplate).flatMap(m => m.agentIds).sort()
    expect(ids).toEqual(Object.keys(LEGACY).sort())
  })

  it('全注册角色 × 各职业：表内 == 原表，表外 == 职业兜底', () => {
    const ids = [...new Set(getRegisteredAgentMechanics().flatMap(m => m.agentIds)), '9999', '']
    let n = 0
    for (const id of ids) {
      for (const spec of SPECS) {
        const want = LEGACY[id] ?? getTemplate(mock('9999', spec))
        expect(getTemplate(mock(id, spec)), `${id}/${spec}`).toEqual(want)
        n++
      }
    }
    expect(n).toBeGreaterThan(300)
  })

  it('源码锁：substatOptimizer.ts 不再有按角色 id 为键的模板', () => {
    const src = readFileSync(resolve(__dirname, '../../core/substatOptimizer.ts'), 'utf-8')
    expect(src).not.toMatch(/'\d{4}':/)
    expect(src).toContain('?.substatTemplate')
  })
})
