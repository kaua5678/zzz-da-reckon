/**
 * CC-238：spec 默认启用的行融合规则（生产开箱即生效）与模块取值的一致性。
 *
 * 背景：`logicEditor/defaults.ts` 把 `specs/agents/*.json#rowFusions` 灌成默认规则，启动入口激活。
 * 原「逻辑编辑」页 2026-10-26 下线后，spec 声明是规则唯一来源；`useCalculatorStartup` 与
 * `setupHarness` 走同一入口，两边同为默认规则（r697）。本文件不走 harness，自己激活。
 * CC-237 把焰烈的 `rawRowValue` 误并入 `getRowValue`，测试全绿、生产态搅拌式倍率 591.4% → ≈716.7%（重复计入
 * `burnice_stirring_fusion` ×1.2689）。本文件在「生产默认规则」下验模块读数。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultRowFusionRules } from '@/logicEditor/defaults'
import { setActiveRowFusionRules } from '@/logicEditor/fusion'
import { findMoveById, rawRowValue } from '@/data/moveTableQueries'
import { burniceMechanic } from '@/mechanics/agents/burnice'
import type { AgentSkills } from '@/types/catalog'

afterEach(() => setActiveRowFusionRules([]))

function skillsOf(agentId: string) {
  const catalog = JSON.parse(readFileSync(join(process.cwd(), 'public/static/catalog.json'), 'utf-8'))
  return (catalog.agentSkills as AgentSkills[]).find(s => s.agentId === agentId)
}

describe('CC-238 spec 默认启用的行规则', () => {
  it('绊线：默认启用的行规则只有 burnice_stirring_fusion（新增时须逐一检查读该 moveId/rowId 的模块是自算融合还是取整值，自算的用 rawRowValue）', () => {
    const enabled = defaultRowFusionRules().filter(r => r.enabled).map(r => `${r.id}@${r.moveId}/${r.rowId}`)
    expect(enabled).toEqual(['burnice_stirring_fusion@1171007/damage'])
  })

  it('回归：生产默认规则生效时，焰烈搅拌式倍率 = 原始 Blend#1×0.5 + 原始 Blend#2（≈591.4%，不重复乘 ×1.2689）', () => {
    const skills = skillsOf('1171')
    expect(skills).toBeTruthy()
    const raw1 = rawRowValue(findMoveById(skills, '1171006'), 'damage')
    const raw2 = rawRowValue(findMoveById(skills, '1171007'), 'damage')
    expect(raw1).toBeGreaterThan(0)
    expect(raw2).toBeGreaterThan(0)
    setActiveRowFusionRules(defaultRowFusionRules())
    const cfg: Record<string, unknown> = {}
    burniceMechanic.buildCharConfig!({ skills, cinemaLevel: 0, cfg } as never)
    expect(Number(cfg.burniceStirringDamageRatio)).toBeCloseTo(raw1 * 0.5 + raw2, 9)
    expect(Number(cfg.burniceStirringDamageRatio)).toBeCloseTo(591.4, 1)
  })
})
