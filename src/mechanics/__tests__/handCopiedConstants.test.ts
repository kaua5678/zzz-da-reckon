/**
 * CC-501：机制模块不手抄「有名字的数据常量」——终结技喧响消耗 / 弹刀喧响奖励 / spec spendRule 单价
 * 各有单一来源（`data/resourceDefaults`、`data/anomalyDecibelBonuses`、spec json），模块 import 或经 `specSpendCost` 读。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { specSpendCost } from '@/specs/resources'
import { getAgentSpec } from '@/specs/registry'
import { ULTIMATE_COST_DEFAULT } from '@/data/resourceDefaults'
import { PARRY_DECIBEL_BONUS } from '@/data/anomalyDecibelBonuses'

const AGENTS_DIR = join(__dirname, '..', 'agents')
const stripComments = (s: string) => s.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).map(l => l.replace(/\/\/.*$/, '')).join('\n')

describe('CC-501 手抄常量', () => {
  it('specSpendCost 读 spec spendRules：仪玄术法值 120；不存在的规则 0', () => {
    const spec = getAgentSpec('1371')!
    expect(specSpendCost(spec, 'yixuan_shufa_value', 'yixuan_extra_ult_spend')).toBe(120)
    expect(specSpendCost(spec, 'yixuan_shufa_value', 'nope')).toBe(0)
    expect(specSpendCost(spec, 'nope', 'nope')).toBe(0)
  })
  it('数据层来源仍是预期值（改这里 = 改口径，要同步 @fact）', () => {
    expect(ULTIMATE_COST_DEFAULT).toBe(3000)
    expect(PARRY_DECIBEL_BONUS).toBe(215)
  })
  it('源码锁：mechanics/agents 下没有 `= 3000` / `= 215` 的手抄常量', () => {
    for (const f of readdirSync(AGENTS_DIR).filter(f => f.endsWith('.ts'))) {
      const code = stripComments(readFileSync(join(AGENTS_DIR, f), 'utf8'))
      expect(code.match(/=\s*3000\b/g) ?? [], f).toEqual([])
      expect(code.match(/=\s*215\b/g) ?? [], f).toEqual([])
    }
  })
})
