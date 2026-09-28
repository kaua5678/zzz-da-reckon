/**
 * CC-236 源码锁：按招式 id 查招式只有 `data/moveTableQueries.ts#findMoveById` 一份实现。
 *
 * 此前 25 个角色模块各抄一份（findMoveById / findMove，写法 5 种、语义相同），理由是「避免 mechanics → composables
 * 运行时依赖」——该理由在实现下沉 data 层后已失效。新代码直接 `import { findMoveById } from '@/data/moveTableQueries'`。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { findMoveById } from '../moveTableQueries'

const SRC = resolve(__dirname, '../..')
const OWNER = 'data/moveTableQueries.ts'
const DEF = /^\s*(?:export\s+)?(?:function\s+(?:findMove|findMoveById)\s*[<(]|const\s+(?:findMove|findMoveById)\s*=)/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') walk(p, out)
    } else if (/\.(ts|vue)$/.test(name) && !/\.(test|d)\.ts$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

describe('CC-236 findMoveById 单一来源', () => {
  it('除 data/moveTableQueries.ts 外，非测试源码不定义 findMove / findMoveById', () => {
    const hits: string[] = []
    for (const p of walk(SRC)) {
      const rel = relative(SRC, p).split('\\').join('/')
      if (rel === OWNER) continue
      readFileSync(p, 'utf-8').split('\n').forEach((line, i) => {
        if (DEF.test(line)) hits.push(`${rel}:${i + 1}`)
      })
    }
    expect(hits).toEqual([])
  })

  it('语义：分类顺序中的第一个；缺失 / skills 为空返回 null；接受结构化窄类型', () => {
    const skills = {
      categories: [
        { moves: [{ id: 'a', actionTime: 1 }, { id: 'b', actionTime: 2 }] },
        { moves: [{ id: 'b', actionTime: 3 }] },
      ],
    }
    expect(findMoveById(skills, 'b')?.actionTime).toBe(2)
    expect(findMoveById(skills, 'zz')).toBeNull()
    expect(findMoveById(undefined, 'a')).toBeNull()
    expect(findMoveById({ categories: [] }, 'a')).toBeNull()
    // 运行时容错：缺 categories / moves 返回 null（nangong 夹具即此形状）
    expect(findMoveById({} as never, 'a')).toBeNull()
    expect(findMoveById({ categories: [{}] } as never, 'a')).toBeNull()
  })
})
