/**
 * CC-426 锁：展示层不再手写战斗总时间 180。
 * 此前 ResourceResultCard 时间分配条分母 `const total = 180`、ResultPage「总时间」输入按 `180 − v` 反算无敌时间：
 * 分析器经 impactVars 改 `enemy.battleTime` 后，卡片占比与反算都静默按 180 算（CC-216 只收了读侧 effectiveTime，没收这两处写侧/分母）。
 * 单源：`TeamResourceResult.totalTime`（卡片 prop）/ `configStore.enemy.battleTime`（store 必填 number，无需兜底）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const code = (rel: string) =>
  readFileSync(resolve(__dirname, '../../', rel), 'utf-8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l)).join('\n')

describe('CC-426 展示层战斗总时间单源', () => {
  it('ResourceResultCard：无 180 字面量，分母走 totalTime prop', () => {
    const src = code('components/ResourceResultCard.vue')
    expect(src).not.toMatch(/\b180\b/)
    expect(src).toMatch(/\n  totalTime: number\n/) // 必填：不许在卡内用 前台+后台 推（CC-252 锁）
    expect(src).toMatch(/time \/ props\.totalTime/)
  })
  it('ResultPage / RunArchivePage：无 180 字面量，卡片传 total-time', () => {
    for (const rel of ['views/ResultPage.vue', 'views/RunArchivePage.vue']) {
      const src = code(rel)
      expect(src, rel).not.toMatch(/\b180\b/)
      expect(src, rel).toMatch(/:total-time="resourceResult\.totalTime"/)
    }
  })
})
