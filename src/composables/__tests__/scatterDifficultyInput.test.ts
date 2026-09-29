/**
 * CC-259：散点 x 轴与难度曲线同一输入 = liveInteractions（引擎实打次数）。
 * 修前散点读预设声明（auto 预设 parry8/dodge4 = 未校准占位），同一个点的伤害却按实打次数算；
 * 97/104 个预设两图 x 不同（§24.100）。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

describe('CC-259 散点难度输入 = 引擎实打次数', () => {
  const root = resolve(__dirname, '../..')
  const tc = readFileSync(resolve(root, 'composables/teamCompare.ts'), 'utf-8')

  it('散点点生成把 liveInteractions 传给 computeDifficulty', () => {
    expect(tc).toContain('liveInteractions(configStore, preset, rrHere), preset.team')
  })

  it('团队聚合缩的散点专用副本已删除；teamCompare 不写死般岳类型名到引擎字段', () => {
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); continue }
        if (/\.(ts|vue)$/.test(name) && !name.endsWith('.test.ts') && /\b(shrinkInteractionsByTruncation|teamInteractionSurvival)\s*\(/.test(readFileSync(p, 'utf-8'))) hits.push(name)
      }
    }
    walk(root)
    expect(hits).toEqual([])
    expect(tc).not.toMatch(/case 'banyue/)
  })
})
