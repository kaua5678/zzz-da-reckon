/**
 * CC-216 源码锁：有效战斗时间（战斗时间 − 无敌时间）只在 `core/effectiveTime.ts#effectiveBattleTime` 计算。
 * CC-216 前另有 7 份内联副本（stores/config 写死 180、useResourceCalc ×2、teamTimeSummary、yixuan、yuzuha ×2）。
 * 新写 `battleTime ?? 180) - …` 或 `180 - …invincibleTime` 会让本测试变红：改调 effectiveBattleTime / minusInvincibleTime。
 * 不在锁内：core 内部以 `ctx.totalTime - invincibleTime` 形式按参数计算的几处（foldLoop / underfillProbe / anomalyPool），
 * 它们不读 store、没有写死 180，且 foldLoop 不夹 0 下限，改动会改变病态输入下的行为，CC-216 不动。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(__dirname, '..', '..')
const PATTERN = /battleTime\s*\?\?\s*180\)?\s*-\s|\b180\s*-\s*[\w.?]*invincibleTime/

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

const WINDOW_FRACTION = /[sS]tunCount\s*\*\s*[\w.()]*(?:[wW]indow|Dur)[\w.()]*\s*(?:-\s*\w+\s*)?\)?\s*\/|Math\.min\(1,\s*\w*[sS]tunSeconds\s*\//

const WINDOW_DURATION = /\?\?\s*12\)\s*\+\s*4\b/
const MINUS_INVINCIBLE = /Math\.max\(0,\s*[\w.]+\s*-\s*\([\w.]*invincibleTime\s*\?\?\s*0\)\)/

describe('失衡窗口时长 / 扣无敌秒单一来源（CC-218）', () => {
  it('除 core/effectiveTime.ts 外没有内联「失衡时间 + 4 + 延时加成」', () => {
    const hits = walk(SRC)
      .map(p => relative(SRC, p).replace(/\\/g, '/'))
      .filter(rel => rel !== 'core/effectiveTime.ts' && WINDOW_DURATION.test(readFileSync(join(SRC, rel), 'utf8')))
    expect(hits).toEqual([])
  })
  it('除 core/effectiveTime.ts 外没有内联「max(0, 秒数 − 无敌时间)」', () => {
    const hits = walk(SRC)
      .map(p => relative(SRC, p).replace(/\\/g, '/'))
      .filter(rel => rel !== 'core/effectiveTime.ts' && MINUS_INVINCIBLE.test(readFileSync(join(SRC, rel), 'utf8')))
    expect(hits).toEqual([])
  })
})

describe('失衡窗口占比单一来源（CC-217）', () => {
  it('除 core/effectiveTime.ts 外没有内联「失衡次数 × 单窗 ÷ 有效时长」', () => {
    const hits = walk(SRC)
      .map(p => relative(SRC, p).replace(/\\/g, '/'))
      .filter(rel => rel !== 'core/effectiveTime.ts' && WINDOW_FRACTION.test(readFileSync(join(SRC, rel), 'utf8')))
    expect(hits).toEqual([])
  })
})

describe('有效战斗时间单一来源（CC-216）', () => {
  it('除 core/effectiveTime.ts 外没有内联「战斗时间 − 无敌时间」', () => {
    const hits = walk(SRC)
      .map(p => relative(SRC, p).replace(/\\/g, '/'))
      .filter(rel => rel !== 'core/effectiveTime.ts' && PATTERN.test(readFileSync(join(SRC, rel), 'utf8')))
    expect(hits).toEqual([])
  })
})

// CC-252：前台 + 后台 求和（无论是否带 `?? 0`）= 全战斗时间，只许在 core/effectiveTime.ts#effectiveCombatTime 里算
const COMBAT_TIME_SUM = /frontlineTime(?:\s*\?\?\s*0\))?\s*\+\s*\(?\s*[\w.]*backstageTime/

describe('全战斗有效时间单一来源（CC-252）', () => {
  it('除 core/effectiveTime.ts 外没有内联「前台时间 + 后台时间」', () => {
    const hits = walk(SRC)
      .map(p => relative(SRC, p).replace(/\\/g, '/'))
      .filter(rel => rel !== 'core/effectiveTime.ts' && COMBAT_TIME_SUM.test(readFileSync(join(SRC, rel), 'utf8')))
    expect(hits).toEqual([])
  })
})
