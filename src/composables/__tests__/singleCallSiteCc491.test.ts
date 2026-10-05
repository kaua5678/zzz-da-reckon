/**
 * CC-491 / CC-492 源码锁：
 * - roundInputs.ts 里按槽位抽 execs 的循环只有一份（`extractSkillExecutions(` 恰 1 处；异常/失衡两个出口都转调 extractExecsFrom）
 * - teamConfigPresetIO.ts 里草稿加金步只算一处（`buildGoldStepsFromConfig(` 恰 1 处；预览计数与写回 JSON 共用 draftGoldSteps）
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const count = (src: string, needle: string) => src.split(needle).length - 1

describe('同一循环/同一调用只写一份（CC-491 / CC-492）', () => {
  it('roundInputs：extractSkillExecutions 只在 extractExecsFrom 里调一次，两个出口各转调一次', () => {
    const src = read('../resourceCalc/roundInputs.ts')
    expect(count(src, 'extractSkillExecutions(')).toBe(1)
    expect(count(src, 'return extractExecsFrom(res, skipGift).anomalyExecs')).toBe(1)
    expect(count(src, 'return extractExecsFrom(res, skipGift).stunExecs')).toBe(1)
  })
  it('teamConfigPresetIO：buildGoldStepsFromConfig 只在 draftGoldSteps 里调一次，两个消费方读 draftGoldSteps.value', () => {
    const src = read('../teamConfigPresetIO.ts')
    expect(count(src, 'buildGoldStepsFromConfig(')).toBe(1)
    expect(count(src, '= draftGoldSteps.value')).toBe(2)
  })
})
