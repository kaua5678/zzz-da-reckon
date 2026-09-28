/**
 * CC-241：spec 事件载体行值（specs/mechanics.ts buildCharConfig → cfg.mechanicRowValues）吃逻辑编辑器行规则。
 *
 * 修前取原始 values[0]：维琳娜 spec 默认规则「赋彩广域·伤害 2 段」（1561020/damage ×2，默认 enabled=false）
 * 正是 spec 事件 velina_broad_cyclone_wind_release 的载体行，用户在编辑器里启用它对该事件毫无作用。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setActiveRowFusionRules } from '@/logicEditor/fusion'
import { createDefaultLogicEditorState } from '@/logicEditor/defaults'
import { getAgentSpec } from '@/specs/registry'
import { specToMechanicModule } from '@/specs/mechanics'
import type { AgentSkills } from '@/types/catalog'

afterEach(() => setActiveRowFusionRules([]))

function skillsOf(agentId: string): AgentSkills | undefined {
  const catalog = JSON.parse(readFileSync(join(process.cwd(), 'public/static/catalog.json'), 'utf-8'))
  return (catalog.agentSkills as AgentSkills[]).find(s => s.agentId === agentId)
}

describe('CC-241 spec 事件载体行值吃行规则', () => {
  it('行为：启用维琳娜默认规则 1561020/damage ×2 ⇒ mechanicRowValues[1561020] ×2；保持默认（禁用）⇒ 不变', () => {
    const mod = specToMechanicModule(getAgentSpec('1561')!)
    const skills = skillsOf('1561')
    const rowOf = () => {
      const cfg: Record<string, unknown> = {}
      mod.buildCharConfig!({ skills, cfg } as never)
      return Number((cfg.mechanicRowValues as Record<string, number> | undefined)?.['1561020'])
    }
    const defaults = createDefaultLogicEditorState().rowFusions
    setActiveRowFusionRules(defaults)
    const base = rowOf()
    expect(base).toBeGreaterThan(0)
    const enabled = defaults.map(r => (r.moveId === '1561020' && r.rowId === 'damage' ? { ...r, enabled: true } : r))
    expect(enabled.some(r => r.moveId === '1561020' && r.enabled)).toBe(true)
    setActiveRowFusionRules(enabled)
    expect(rowOf()).toBeCloseTo(base * 2, 9)
  })

  it('源码：specs/ 非测试 ts 不含内联原始行读取（.values[0]）——取值一律走 data getRowValue', () => {
    const dir = resolve(__dirname, '..')
    const hits: string[] = []
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts')) continue
      readFileSync(join(dir, name), 'utf-8').split('\n').forEach((l, i) => {
        if (!/^\s*(\/\/|\*|\/\*)/.test(l) && /\.values\??\.?\[0\]/.test(l)) hits.push(`${name}:${i + 1}`)
      })
    }
    expect(hits).toEqual([])
  })
})
