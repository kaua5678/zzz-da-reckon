/**
 * CC-254：「把 TeamPreset 装进 configStore」只有 teamCompare.ts#applyTeamToStore 一份实现。
 * 修前 positionCompare.ts 有逐行私有副本，且已漂移：漏了 `tauntCancel`（般岳嘲讽取消）交互分支。
 * 注：teamTimelineStore.ts#applyTeamToStore 是**同名不同义**的另一个函数（入参 = 队伍 id + 金档状态，走推荐配装 /
 * 交互基准），不在本锁范围——本锁只认签名里带 `preset: TeamPreset` 的定义。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

describe('CC-254 applyTeamToStore(TeamPreset) 单一来源', () => {
  it('签名带 preset: TeamPreset 的 applyTeamToStore 只在 composables/teamCompare.ts 定义', () => {
    const root = resolve(__dirname, '../..')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); continue }
        if (!/\.(ts|vue)$/.test(name) || name.endsWith('.test.ts')) continue
        const src = readFileSync(p, 'utf-8')
        for (const m of src.matchAll(/function\s+applyTeamToStore\s*\(([^)]*)\)/g)) {
          if (/preset\s*:\s*TeamPreset/.test(m[1])) hits.push(relative(root, p).replace(/\\/g, '/'))
        }
      }
    }
    walk(root)
    expect(hits).toEqual(['composables/teamCompare.ts'])
  })
})
