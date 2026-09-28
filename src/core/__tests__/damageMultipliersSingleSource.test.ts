/**
 * CC-219 源码锁：防御乘区（794 等级基数）与抗性乘区只在 `core/damageMultipliers.ts` 计算。
 * CC-219 前有 3 份：core/damage.ts、core/anomalyPool/helpers.ts、mechanics/agents/remielle.ts（外加写死的等级系数 2）。
 * 新写 `794 / (794 + …)`、`LEVEL_COEFF_60 = …` 或 `1 - (… - …) / 100` 形式的抗性区会让本测试变红：改调 damageMultipliers。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defenseMultiplierDetail, resistanceMultiplierDetail } from '@/core/damageMultipliers'

const SRC = join(__dirname, '..', '..')
const OWNER = 'core/damageMultipliers.ts'
/** 去掉注释行（JSDoc 里保留公式说明是允许的） */
const code = (t: string) => t.split('\n').filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
const PATTERNS: Array<[string, RegExp]> = [
  ['防御区 794', /794\s*\/\s*\(\s*794|LEVEL_COEFF_60\s*\/\s*\(|LEVEL_COEFF_60\s*=\s*\d/],
  // 伤害抗性区的独立写法；异常积蓄抗性区（anomalyPool/helpers 的 `afterEff * (1 - effectiveRes / 100)`）
  // 与失衡抗性区（stunPool）是另一套游戏机制，式子同形但口径独立，不归一、不在锁内（CC-219 裁决）
  ['伤害抗性区', /(?:=|return)\s*1\s*-\s*\(\s*[\w.]*[rR]es\w*\s*-\s*[\w.]*\s*\)\s*\/\s*100|(?:=|return)\s*1\s*-\s*effectiveRes\s*\/\s*100/],
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      walk(p, out)
    } else if (/\.(ts|vue)$/.test(name)) out.push(p)
  }
  return out
}

describe('通用乘区单一来源（CC-219）', () => {
  for (const [label, re] of PATTERNS) {
    it(`除 ${OWNER} 外没有内联「${label}」`, () => {
      const hits = walk(SRC)
        .map(p => relative(SRC, p).replace(/\\/g, '/'))
        .filter(rel => rel !== OWNER && re.test(code(readFileSync(join(SRC, rel), 'utf8'))))
      expect(hits).toEqual([])
    })
  }

  it('数值口径（与 CC-219 前的三份实现逐位一致）', () => {
    const d = defenseMultiplierDetail(953, 20, 36, 24, 100)
    const eff = Math.max(0, 953 * (1 - 24 / 100) * (1 - 20 / 100) - (100 + 36))
    expect(d.effectiveDef).toBe(eff)
    expect(d.multiplier).toBe(794 / (794 + eff))
    expect(resistanceMultiplierDetail(20, 35).multiplier).toBe(1 - (20 - 35) / 100)
    expect(resistanceMultiplierDetail(20, 10, 5).effectiveRes).toBe(5)
  })
})
