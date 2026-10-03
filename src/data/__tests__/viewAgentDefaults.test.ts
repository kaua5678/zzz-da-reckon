/**
 * CC-431 锁：展示层默认角色 id 单一来源 `data/viewAgentDefaults.ts`。
 * ① 每个 id 都在 catalog 里（角色下架 / 改 id 时这里先红，而不是页面静默指向空角色）；
 * ② 时间线相关 id 都在 AGENT_RELEASE_NODE 里，候选池不含主 C；
 * ③ `src/views` / `src/components` / `src/composables` / `src/stores` 下零 `'1xx1'` 角色 id 字面量（注释行除外）——新页面默认值加到 data 层。
 *    （CC-432 把范围从 .vue 扩到 composables/stores 的 .ts；`specs/additionalGate.ts` 之类按 id 键入的引擎配置表不在范围内）
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  ALL_VIEW_DEFAULT_AGENT_IDS, TIMELINE_DEFAULT_MAIN_AGENT_ID, TIMELINE_DEFAULT_CANDIDATE_POOL, LOGIC_EDITOR_DEFAULT_FUSION,
} from '@/data/viewAgentDefaults'
import { AGENT_RELEASE_NODE } from '@/data/versionTimeline'

const catalog = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as { agents: { id: string }[] }
const catalogIds = new Set(catalog.agents.map(a => a.id))

describe('CC-431 展示层默认角色 id 单源', () => {
  it('① 全部默认 id 都在 catalog 里', () => {
    const missing = ALL_VIEW_DEFAULT_AGENT_IDS.filter(id => !catalogIds.has(id))
    expect(missing).toEqual([])
    expect(ALL_VIEW_DEFAULT_AGENT_IDS.length).toBeGreaterThanOrEqual(12)
    expect(LOGIC_EDITOR_DEFAULT_FUSION.moveId.startsWith(LOGIC_EDITOR_DEFAULT_FUSION.agentId)).toBe(true)
    for (const id of catalogIds) expect(id, 'catalog 角色 id 形态变了 ⇒ 同步改 ③ 的正则').toMatch(/^1[0-9]{2}1$/)
  })
  it('② 时间线默认主 C 与候选池都在 AGENT_RELEASE_NODE 里，且候选池不含主 C', () => {
    expect(AGENT_RELEASE_NODE[TIMELINE_DEFAULT_MAIN_AGENT_ID]).toBeTruthy()
    for (const id of TIMELINE_DEFAULT_CANDIDATE_POOL) expect(AGENT_RELEASE_NODE[id], id).toBeTruthy()
    expect(TIMELINE_DEFAULT_CANDIDATE_POOL).not.toContain(TIMELINE_DEFAULT_MAIN_AGENT_ID)
    expect(new Set(TIMELINE_DEFAULT_CANDIDATE_POOL).size).toBe(TIMELINE_DEFAULT_CANDIDATE_POOL.length)
  })
  it('③ 源码锁：views / components / composables / stores 下零角色 id 字面量', () => {
    const SRC = join(__dirname, '..', '..')
    // 全部 62 个 catalog 角色 id 都是 1xx1 形态（① 里同时断言），借此避开模板里 :step="1000" 之类的数字
    const RE = /['"]1[0-9]{2}1['"]/
    const hits: string[] = []
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n)
        if (statSync(f).isDirectory()) { if (n !== '__tests__') walk(f); continue }
        if (!n.endsWith('.vue') && !n.endsWith('.ts')) continue
        readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
          const t = line.trim()
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--')) return
          if (RE.test(line.replace(/\/\/.*$/, ''))) hits.push(`${relative(SRC, f).replace(/\\/g, '/')}:${i + 1}`)
        })
      }
    }
    walk(join(SRC, 'views'))
    walk(join(SRC, 'components'))
    walk(join(SRC, 'composables'))
    walk(join(SRC, 'stores'))
    expect(hits).toEqual([])
  })
})
