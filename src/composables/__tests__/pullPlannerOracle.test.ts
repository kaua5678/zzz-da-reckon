/** Acceptance of the real oracle/cache boundary; deterministic evaluators isolate cache semantics. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { createEngineOracle, freePoolRepresentatives } from '@/composables/pullPlannerEngine'
import { scoreForDamageRatio } from '@/core/deadlyAssaultScore'
import type { BossPresetFile } from '@/types/bossPreset'

const bosses = (JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile).bosses
const boss = bosses.find(b => b.phases.some(p => p.modeType === 'defense'))!
const phase = boss.phases.find(p => p.modeType === 'defense')!
const room = { bossId: boss.id, phaseId: phase.phaseId, bossName: boss.name, hp: 10_000_000 }
const pool = ['1021', '1031', '1131']
async function boot() { return setupHarness(pool.map(agentId => ({ agentId }))) }

function instrument(damage: (lead: string) => number = () => 1_000_000, outerExit = 'stable') {
  const config = useConfigStore()
  return {
    resourceResult: { value: { convergence: { outerExit } } },
    teamTotalDamage: { get value() { return damage(config.team[0]!.agentId) } },
  } as unknown as ReturnType<typeof useResourceCalc>
}
function oracle(calc = instrument(), candidatePool = pool) {
  return createEngineOracle({ calc, bosses: [boss], periodViews: [], candidatePool })
}

describe('planner free-member chain', () => {
  it('representative pruning preserves the explicitly free special members', async () => {
    await boot()
    const catalog = useCatalogStore()
    const representatives = freePoolRepresentatives(catalog.displayAgents.map(a => a.id), catalog, 1)
    expect(representatives).toContain('1551')
    expect(representatives).toContain('1421')
    const counts = new Map<string, number>()
    for (const id of representatives.filter(id => !['1551', '1421'].includes(id))) {
      const specialty = catalog.getAgent(id)!.specialty
      counts.set(specialty, (counts.get(specialty) ?? 0) + 1)
    }
    expect([...counts.values()].every(n => n <= 1)).toBe(true)
    expect(new Set(representatives).size).toBe(representatives.length)
  })

  it('gifted S is available with zero holdings in the real damage pipeline', async () => {
    await boot()
    const engine = oracle(useResourceCalc(), ['1551', '1021', '1031'])
    const candidates = engine.oracle.candidates(room, {})
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.every(c => c.team.includes('1551') && c.score > 0)).toBe(true)
    expect(engine.stats().evaluations).toBeGreaterThan(0)
  })
})

describe('planner oracle cache contracts', () => {
  it('real-engine warm slot scores match independent cold evaluations', async () => {
    await boot()
    const unsaturatedRoom = { ...room, hp: 1_000_000_000 }
    const candidates = oracle(useResourceCalc()).oracle.candidates(unsaturatedRoom, {})
    expect(candidates).toHaveLength(3)
    const readings: Array<{ team: string[]; warm: number; cold: number }> = []
    for (const candidate of candidates) {
      await boot()
      const cold = oracle(useResourceCalc(), [...candidate.team]).oracle.candidates(unsaturatedRoom, {})
        .find(c => c.team.join(',') === candidate.team.join(','))!
      expect(cold).toBeDefined()
      expect(candidate.score).toBeGreaterThan(0)
      expect(candidate.score).toBeLessThan(60000) // capped scores would hide slot-sensitive errors
      expect(candidate.score).toBeCloseTo(cold.score, 6)
      readings.push({ team: candidate.team, warm: candidate.score, cold: cold.score })
    }
    console.log('ORACLE-SLOT-ACCEPTANCE', JSON.stringify(readings))
  })

  it('preserves ordered slots rather than reusing another lead\'s evaluation', async () => {
    await boot()
    const damage = (lead: string) => (pool.indexOf(lead) + 1) * 1_000_000
    const engine = oracle(instrument(damage))
    const candidates = engine.oracle.candidates(room, {})
    expect(candidates).toHaveLength(3)
    for (const c of candidates) expect(c.score).toBe(scoreForDamageRatio(damage(c.team[0]) / room.hp))
    expect(engine.stats().evaluations).toBe(3)
  })

  it('maxIter is always excluded, including reused team-cache entries', async () => {
    await boot()
    const engine = oracle(instrument(() => 1_000_000, 'maxIter'), [...pool, '1091'])
    expect(engine.oracle.candidates(room, {})).toEqual([])
    const next = engine.oracle.candidates(room, { '1091': 1 })
    expect(next).toEqual([]) // existing triples recur in a new holding-set evaluation
  })

  it('room HP participates in both cache levels because it changes the score', async () => {
    await boot()
    const engine = oracle()
    const first = engine.oracle.candidates(room, {})
    const larger = { ...room, hp: room.hp * 2 }
    const second = engine.oracle.candidates(larger, {})
    expect(first[0]!.score).toBe(scoreForDamageRatio(1_000_000 / room.hp))
    expect(second[0]!.score).toBe(scoreForDamageRatio(1_000_000 / larger.hp))
    expect(second[0]!.score).toBeLessThan(first[0]!.score)
  })

  it('ignores holdings outside the candidate pool without growing either cache', async () => {
    await boot()
    const engine = oracle()
    const first = engine.oracle.candidates(room, {})
    const before = engine.stats()
    const again = engine.oracle.candidates(room, { '1091': 3 })
    const after = engine.stats()
    expect(again).toBe(first)
    expect(after.evaluations).toBe(before.evaluations)
    expect(after.cacheSize).toBe(before.cacheSize)
    expect(after.cacheHits).toBe(before.cacheHits + 1)
  })

  it('zero score is valid and identical inputs reuse cached results', async () => {
    await boot()
    const engine = oracle(instrument(() => 0))
    const first = engine.oracle.candidates(room, {})
    const before = engine.stats()
    expect(first).toHaveLength(3)
    expect(first.every(c => c.score === 0)).toBe(true)
    expect(engine.oracle.candidates({ ...room }, {})).toBe(first)
    expect(engine.stats().evaluations).toBe(before.evaluations)
  })
})
