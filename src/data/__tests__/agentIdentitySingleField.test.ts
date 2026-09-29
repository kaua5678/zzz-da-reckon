/**
 * CC-276（第 291 轮）：角色身份单字段锁。
 *
 * catalog.json 的 `agents[].teammateBuffId`（原「队友 buff 归属别名」）在数据面只有 5 个取值，且全部等于自身 id；
 * teammate-buffs.json 的组 id 本来就是 agent.id，buff 拥有者也已在 catalog 加载处归一到组 id（CC-275）。
 * ⇒ 别名字段退役：Agent 类型删掉该字段，src 里 15 处「`agent.id === X || agent.teammateBuffId === X`」双臂判定收成单臂。
 * 原先各处保留的「数据面守卫」右臂改由本锁在数据入口一处拦：数据若给出 ≠ id 的别名，① 红，
 * 正确修法是在 catalog 加载处归一（照 CC-275），而不是把别名臂加回各消费点。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === '__tests__') continue
      walk(p, out)
    } else if (/\.(ts|vue)$/.test(name)) out.push(p)
  }
  return out
}

describe('CC-276 角色身份只有 agent.id 一个字段', () => {
  it('① catalog.json：teammateBuffId 缺省或等于自身 id', () => {
    const catalog = JSON.parse(readFileSync(join(ROOT, 'public/static/catalog.json'), 'utf-8')) as { agents: Array<{ id: string; teammateBuffId?: string }> }
    expect(catalog.agents.length).toBeGreaterThan(50)
    const bad = catalog.agents.filter(a => a.teammateBuffId !== undefined && a.teammateBuffId !== a.id).map(a => `${a.id}→${a.teammateBuffId}`)
    expect(bad).toEqual([])
  })

  it('② src（不含测试）不读 teammateBuffId（注释除外）', () => {
    const files = walk(join(ROOT, 'src'))
    expect(files.length).toBeGreaterThan(100)
    const hits: string[] = []
    for (const f of files) {
      readFileSync(f, 'utf-8').split('\n').forEach((line, i) => {
        const t = line.trim()
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
        if (/teammateBuffId/.test(line)) hits.push(`${f.slice(ROOT.length + 1)}:${i + 1}`)
      })
    }
    expect(hits).toEqual([])
  })
})
