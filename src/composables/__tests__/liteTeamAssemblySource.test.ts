/**
 * CC-256：分析器「轻量装配」（setAgent 兜底 → 同步 buff → 清 4/6 号主词条与副词条 → 命座 / 精炼 / 音擎 →
 * 交互基准 → 快支 3 / 连携 1）唯一实现 = `teamTimelineStore#applyTeamToStore(…, autoBuild=false)`。
 * 修前另有 pullPlannerEngine#applyTeamLite（逐行同义）与 charIncrement#applyBaseTeamLite（同义，入参为 members），
 * 三份各自维护交互基准——CC-255 的 noGenericInteraction 漏洞就是在这种副本里各漏一次。
 * 标志性写法「清副词条分配 `subStatAllocation = {}`」在 composables 下只许出现在 teamTimelineStore。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

describe('CC-256 轻量装配单一来源', () => {
  it('composables 非测试文件里清副词条分配只在 teamTimelineStore.ts', () => {
    const root = resolve(__dirname, '..')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); continue }
        if (!/\.(ts|vue)$/.test(name) || name.endsWith('.test.ts')) continue
        readFileSync(p, 'utf-8').split('\n').forEach((l) => {
          if (!/^\s*(\/\/|\*)/.test(l) && /subStatAllocation\s*=\s*\{\s*\}/.test(l)) hits.push(relative(root, p).replace(/\\/g, '/'))
        })
      }
    }
    walk(root)
    expect(hits).toEqual(['teamTimelineStore.ts'])
  })
})
