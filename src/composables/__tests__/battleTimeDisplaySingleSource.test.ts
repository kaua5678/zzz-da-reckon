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
  it('RunArchivePage / ResourcePoolView：无 180 字面量，卡片传 total-time', () => {
    /**
     * T188（2026-11-03）：资源卡随「资源页那一整套」搬进共享视图 `components/ResourcePoolView.vue`
     * ⇒ 这条锁改钉**搬去的那个文件**（ResultPage 与各比较入口共用它 ⇒ 覆盖面变大，不是变小）。
     */
    for (const rel of ['views/RunArchivePage.vue', 'components/ResourcePoolView.vue']) {
      const src = code(rel)
      expect(src, rel).not.toMatch(/\b180\b/)
      expect(src, rel).toMatch(/:total-time="resourceResult\.totalTime"/)
    }
    // 「搬走了但没接回来」也必须是红的：结果页要真的挂上这个共享视图（且自己不再手写 180）
    const resultPage = code('views/ResultPage.vue')
    expect(resultPage).not.toMatch(/\b180\b/)
    expect(resultPage).toContain("import ResourcePoolView from '@/components/ResourcePoolView.vue'")
    expect(resultPage).toMatch(/<ResourcePoolView/)
  })
})
