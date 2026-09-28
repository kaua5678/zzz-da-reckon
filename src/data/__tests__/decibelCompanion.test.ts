/**
 * CC-230 锁：喧响「队友伴随 50%」规则单一来源 data/decibelCompanion。
 * 此前 core/anomalyPool/helpers（异常）、core/anomalyPool（特殊动作）、ResourceResultCard（拆解）各写一份。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { withCompanionShare, DECIBEL_COMPANION_RATIO } from '@/data/decibelCompanion'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

const SRC = resolve(__dirname, '../..')
const code = (rel: string) => readFileSync(resolve(SRC, rel), 'utf-8')
  .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

describe('CC-230 喧响队友伴随', () => {
  it('规则：自己 + 其余队友 × 50%', () => {
    expect(DECIBEL_COMPANION_RATIO).toBe(0.5)
    expect(withCompanionShare([170, 340, 0])).toEqual([340, 425, 255])
    expect(withCompanionShare([])).toEqual([])
  })

  it('真队：perSlotBonus = withCompanionShare(perSlotOwnBonus)，own 之和 = decibelBonus', async () => {
    await setupHarness([{ agentId: '1261' }, { agentId: '1401' }, { agentId: '1331' }], { recommendedBuild: true })
    const pool = useResourceCalc().anomalyPoolResult.value!
    expect(pool.perSlotOwnBonus.length).toBe(pool.perSlotBonus.length)
    expect(pool.perSlotBonus).toEqual(withCompanionShare(pool.perSlotOwnBonus))
    expect(pool.perSlotOwnBonus.reduce((a, b) => a + b, 0)).toBeCloseTo(pool.decibelBonus, 6)
    expect(pool.perSlotOwnBonus.some(v => v > 0)).toBe(true)
  })

  it('源码锁：伴随累加只在 data/decibelCompanion；卡片不再自算 170/85 × 次数', () => {
    for (const rel of ['core/anomalyPool.ts', 'core/anomalyPool/helpers.ts', 'components/ResourceResultCard.vue']) {
      expect(code(rel), rel).not.toMatch(/companion\s*\+=/)
    }
    expect(code('components/ResourceResultCard.vue')).not.toMatch(/DECIBEL_BONUS/)
    expect(code('components/ResourceResultCard.vue')).toMatch(/perSlotOwnBonus/)
  })
})
