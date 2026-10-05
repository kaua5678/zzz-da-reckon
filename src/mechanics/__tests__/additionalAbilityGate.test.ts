/**
 * CC-192（lead 2026-09-28）结构守卫：模块读面板门控 `panel.additionalAbilityActive` ⇒ 该角色 spec 必须声明
 * `additionalAbility.teamConditions`。门控只由 panelPhases 按 spec 声明置位（无声明 ⇒ 恒 0）；
 * 单测直构 `panel: { additionalAbilityActive: 1 }` 看不见这条接线——安东通力合作即因此在生产路径恒不触发。
 * 自带判定的模块（velina/alice/miyabi 的 isAdditionalAbilityActive）不读面板标记，不受此约束。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getAgentSpec } from '@/specs/registry'

const DIR = new URL('../agents/', import.meta.url)
// CC-507（r689）：读法统一为 `additionalAbilityActiveOf(panel)`（core/additionalAbilityActive.ts），两种写法都算「读面板门控」
const PANEL_GATE = /panel\??\.additionalAbilityActive|additionalAbilityActiveOf\(/

function agentIdsOf(src: string): string[] {
  const m = src.match(/agentIds:\s*\[([^\]]*)\]/)
  if (!m) return []
  const consts = new Map([...src.matchAll(/const (\w+)\s*=\s*'(\d{4})'/g)].map(x => [x[1]!, x[2]!]))
  return m[1]!.split(',').map(t => t.trim()).filter(Boolean)
    .map(t => /^'(\d{4})'$/.exec(t)?.[1] ?? consts.get(t) ?? `?${t}`)
}

describe('额外能力门控接线', () => {
  it('读 panel.additionalAbilityActive 的模块，其角色 spec 均声明 additionalAbility', () => {
    const readers: string[] = []
    const missing: string[] = []
    for (const f of readdirSync(DIR).filter(n => n.endsWith('.ts'))) {
      const src = readFileSync(new URL(f, DIR), 'utf8')
      if (!PANEL_GATE.test(src)) continue
      const ids = agentIdsOf(src)
      readers.push(f)
      if (!ids.length) missing.push(`${f}: 解析不到 agentIds`)
      for (const id of ids) {
        if (!getAgentSpec(id)?.additionalAbility?.teamConditions?.length) missing.push(`${f}: ${id}`)
      }
    }
    expect(readers.length).toBeGreaterThan(10)
    expect(missing).toEqual([])
  })
})
