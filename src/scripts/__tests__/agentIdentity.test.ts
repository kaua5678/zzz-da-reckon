import { describe, expect, it } from 'vitest'
// @ts-expect-error -- standalone JS report utility
import { scanIdentitySource, summarizeIdentity, reportIdentity } from '../../../scripts/report-agent-identity.mjs'
import { countAgentIdBranchLines } from '../../../scripts/check-guards.mjs'

interface Entry { field: string; identity: string | null; category: string; line: number; column: number }
const scan = (code: string): Entry[] => scanIdentitySource(code)

describe('T8 read-only identity inventory', () => {
  it('ignores comments and strings; detects multiline and reversed comparisons', () => {
    const entries = scan(`// agentId === '1431'
const text = "agent.id === '1431'";
/* a.teammateBuffId === 'remielle' */
if (agent?.id\n === '1431') work();
if ('1481' !== other['agentId']) work();`)
    expect(entries.map(e => [e.field, e.identity, e.category, e.line])).toEqual([
      ['id', '1431', 'business', 4], ['agentId', '1481', 'business', 6],
    ])
  })

  it('separates pure named definitions from business find callbacks', () => {
    const entries = scan(`function isAgent(a) { return a?.id === '1481' || a?.teammateBuffId === '1481' }
const isOther = a => a.id === '1481';
const slot = team.findIndex(c => { const a = get(c); return a.id === '1481' || a.teammateBuffId === '1481' });`)
    expect(entries.map(e => e.category)).toEqual(['definition', 'definition', 'definition', 'business', 'business'])
    expect(summarizeIdentity(entries)).toMatchObject({
      comparisons: 5, lines: 3,
      definition: { comparisons: 3, lines: 2 },
      business: { comparisons: 2, lines: 1 },
      definitionIdentities: ['1481'],
    })
  })

  it('keeps stored flags and dynamic values unknown instead of exempting them', () => {
    expect(scan(`const enabled = a.id === '1581';
const flags = { isAgent: a.teammateBuffId === 'remielle' };
if (a.agentId === targetId) work();`).map(e => e.category)).toEqual(['unknown', 'unknown', 'unknown'])
  })

  it('does not mistake unrelated string ids for characters; supports receiver aliases', () => {
    expect(scan(`if (row.id === 'row-name') work();
const alias = agent;
if (alias.id === '1431') work();`).map(e => e.identity)).toEqual(['1431'])
  })

  it('counts two shapes on one source line once in line totals', () => {
    const entries = scan(`if (a.id === '1581' || a.teammateBuffId === 'remielle') work();`)
    expect(summarizeIdentity(entries)).toMatchObject({ comparisons: 2, lines: 1, business: { comparisons: 2, lines: 1 } })
    expect(entries[0]!.column).not.toBe(entries[1]!.column)
  })

  it('reports deterministic repository output with legacy and classified measures separate', () => {
    const first = reportIdentity()
    expect(reportIdentity()).toEqual(first)
    expect(countAgentIdBranchLines("if (a.agentId === '1431') work();")).toBe(1)
    expect(Number.isInteger(first.legacyLines)).toBe(true)
    expect(first.summary.comparisons).toBe(first.entries.length)
    expect(first.summary.comparisons).toBe(first.summary.business.comparisons + first.summary.definition.comparisons + first.summary.unknown.comparisons)
  })
})
