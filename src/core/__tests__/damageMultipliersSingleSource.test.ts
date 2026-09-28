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

describe('失衡易伤区单一来源（CC-220）', () => {
  // 来源：core/anomalyPool/helpers.ts#calcStunMultiplier。CC-220 前 remielle 耀变手写 `stunned ? max(0, vuln + bonus/100) : 1`，
  // 把覆盖率当布尔 ⇒ 覆盖率 > 0 即吃满额易伤。叶瞬光帷幕 veilStunBase 是另一套封顶机制（min(…, 2.1/3.0)），不在此列。
  const STUN_OWNER = 'core/anomalyPool/helpers.ts'
  const STUN_RE = /Math\.max\(\s*0\s*,\s*[\w.]*[sS]tun\w*\s*\+\s*[\w.]*\s*\/\s*100\s*\)|stunned\s*\?\s*Math\.max/
  it(`除 ${STUN_OWNER} 外没有内联失衡易伤区`, () => {
    const hits = walk(SRC)
      .map(p => relative(SRC, p).replace(/\\/g, '/'))
      .filter(rel => rel !== STUN_OWNER && STUN_RE.test(code(readFileSync(join(SRC, rel), 'utf8'))))
    expect(hits).toEqual([])
  })
})

describe('暴击期望单一来源（CC-222）', () => {
  // 来源：src/data/critMultiplier.ts（clampCritRatePct / expectedCritMultiplier）。CC-222 前 6 份期望算式 + 2 份钳制。
  const CRIT_OWNER = 'data/critMultiplier.ts'
  const CRIT_RE = /Math\.min\(\s*100\s*,\s*(?:Math\.max\(\s*0\s*,\s*)?[\w.]*[cC]rit|[cC]rit\w*Rate\w*\s*\/\s*100\s*\)?\s*\*/  // 「必暴」1 + 暴伤/100 是百分比换算，不算副本
  it(`除 ${CRIT_OWNER} 外没有内联暴击率钳制 / 期望暴击算式`, () => {
    const hits = walk(SRC)
      .map(p => relative(SRC, p).replace(/\\/g, '/'))
      .filter(rel => rel !== CRIT_OWNER && CRIT_RE.test(code(readFileSync(join(SRC, rel), 'utf8'))))
    expect(hits).toEqual([])
  })
  it('数值口径（与 CC-222 前引擎实现逐位一致）', async () => {
    const { expectedCritMultiplier, clampCritRatePct } = await import('@/data/critMultiplier')
    for (const [r, d] of [[65, 150], [120, 88.8], [-5, 100], [37.3, 211.7]]) {
      const old = 1 + (Math.min(100, Math.max(0, r)) / 100) * (d / 100)
      expect(expectedCritMultiplier(r, d)).toBe(old)
    }
    expect(clampCritRatePct(130)).toBe(100)
    expect(clampCritRatePct(-3)).toBe(0)
  })
})
