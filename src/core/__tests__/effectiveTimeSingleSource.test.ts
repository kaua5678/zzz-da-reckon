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

describe('有效战斗时间单一来源（CC-216）', () => {
  it('除 core/effectiveTime.ts 外没有内联「战斗时间 − 无敌时间」', () => {
    const hits = walk(SRC)
      .map(p => relative(SRC, p).replace(/\\/g, '/'))
      .filter(rel => rel !== 'core/effectiveTime.ts' && PATTERN.test(readFileSync(join(SRC, rel), 'utf8')))
    expect(hits).toEqual([])
  })
})
