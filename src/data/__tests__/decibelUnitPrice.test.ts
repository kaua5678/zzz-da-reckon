/**
 * CC-232 锁：喧响单价单一来源 data/anomalyDecibelBonuses；ResultPage 特殊动作卡说明文字不再手写单价。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as D from '@/data/anomalyDecibelBonuses'
import { PARRY_DECIBEL_BONUS as CORE_PARRY, calcSpecialActionBonus } from '@/core/anomalyPool'

const code = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf-8')
  .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

describe('CC-232 喧响单价', () => {
  it('core 原名转出与 data 同值；calcSpecialActionBonus 用 data 单价', () => {
    expect(CORE_PARRY).toBe(D.PARRY_DECIBEL_BONUS)
    const r = calcSpecialActionBonus([1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0])
    expect(r.parry).toBe(D.PARRY_DECIBEL_BONUS)
    expect(r.chain).toBe(D.CHAIN_DECIBEL_BONUS)
    expect(r.dodgeCounter).toBe(D.DODGE_COUNTER_DECIBEL_BONUS)
    expect(r.quickAssist).toBe(D.QUICK_ASSIST_DECIBEL_BONUS)
  })
  it('源码锁：core/anomalyPool 不再以字面量乘单价；ResultPage 不再手写「N/次 · 伴随」', () => {
    const core = code('core/anomalyPool.ts')
    expect(core).not.toMatch(/PARRY_DECIBEL_BONUS\s*=\s*215/)
    expect(core).not.toMatch(/\*\s*(10|20)\s*$/m)
    expect(code('views/ResultPage.vue')).not.toMatch(/\d+\/次 · 伴随/)
  })
})
