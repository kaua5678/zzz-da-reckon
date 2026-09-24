import { describe, expect, it } from 'vitest'
import { attributeCounterMet, wEngineConditionMet } from '@/core/wengineConditions'

describe('w-engine condition gate', () => {
  it('does not gate when weakness is missing or empty', () => {
    expect(attributeCounterMet('electric', undefined)).toBe(true)
    expect(attributeCounterMet('electric', [])).toBe(true)
    expect(wEngineConditionMet('attributeCounter', { wearerAttribute: 'electric' })).toBe(true)
  })

  it('matches the wearer attribute against declared Chinese weakness', () => {
    expect(attributeCounterMet('electric', ['冰', '电'])).toBe(true)
    expect(attributeCounterMet('electric', ['冰', '以太'])).toBe(false)
    expect(attributeCounterMet('lumiflux', ['流明'])).toBe(true)
    expect(attributeCounterMet('lumiflux', ['冰'])).toBe(false)
  })

  it('accepts the raw English token as well as the Chinese label', () => {
    expect(attributeCounterMet('ice', ['ice'])).toBe(true)
  })

  it('fails closed when a weakness is declared but the wearer attribute is unknown', () => {
    expect(attributeCounterMet(undefined, ['电'])).toBe(false)
    expect(attributeCounterMet('not-a-stat', ['电'])).toBe(false)
  })

  it('leaves unknown or prose conditions ungated', () => {
    expect(wEngineConditionMet(undefined, { enemyWeakness: ['冰'] })).toBe(true)
    expect(wEngineConditionMet('twoStacksAfterWindExSpecialDamage', {
      wearerAttribute: 'wind',
      enemyWeakness: ['冰'],
    })).toBe(true)
  })
})
