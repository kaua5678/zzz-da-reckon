import { describe, expect, it } from 'vitest'
import { agentSpecs } from '@/specs/registry'
import { verifyAllSpecs } from '@/specs/verify'

describe('spec verifications', () => {
  it('passes every user-confirmed spec verification', () => {
    const results = verifyAllSpecs(agentSpecs)
    const failed = results.filter(result => !result.pass)

    expect(results.length).toBeGreaterThanOrEqual(3)
    expect(failed).toEqual([])
  })
})
