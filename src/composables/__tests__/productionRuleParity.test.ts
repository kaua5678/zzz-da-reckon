/**
 * CC-249：测试态 / 生产态行规则一致性（§24.85 未决项裁决）。
 *
 * 背景：`logicEditor/defaults.ts` 把 `specs/agents/*.json#rowFusions` 灌成默认规则，`stores/logicEditor.ts`
 * 初始化即 `setActiveRowFusionRules` ⇒ 生产开箱即生效；而 harness 不实例化逻辑编辑器 store ⇒ 测试态规则为空。
 * 过去靠人工纪律「涉及 getRowValue 的改动须在默认规则下补验」（CC-237 误并即因此漏网）。
 *
 * 裁决：**不让 harness 全局加载默认规则**（要改十余个 `afterEach(set([]))` 复位口径，且 rowValueSource 等
 * 单元锁本就断言原始值），改为本文件在 verify 里自动做那次「补验」：对每个**拥有默认规则**的角色
 * （moveId 前 4 位 = agentId，动态推导 ⇒ 新增默认规则自动纳入）组一队，断言空规则与生产默认规则下
 * teamTotalDamage 逐位相同。
 * 若日后某条默认规则**有意**改变整队读数：把该队的期望改为显式记录差值并注明规则 id，不要删本锁。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { createDefaultLogicEditorState } from '@/logicEditor/defaults'
import { setActiveRowFusionRules } from '@/logicEditor/fusion'

beforeEach(() => { newPinia(); mockStaticFetch() })
afterEach(() => setActiveRowFusionRules([]))

const DEFAULT_RULES = createDefaultLogicEditorState().rowFusions
const RULE_AGENTS = [...new Set(DEFAULT_RULES.map(r => String(r.moveId).slice(0, 4)))].sort()
const FILLERS = ['1211', '1311', '1481']

function teamFor(agentId: string): string[] {
  return [agentId, ...FILLERS.filter(f => f !== agentId)].slice(0, 3)
}

async function totalDamage(team: string[], rules: typeof DEFAULT_RULES): Promise<number> {
  setActiveRowFusionRules(rules)
  await setupHarness(team.map(agentId => ({ agentId })), { recommendedBuild: false })
  return useResourceCalc().teamTotalDamage.value
}

describe('CC-249 测试态（空规则）与生产态（spec 默认行规则）整队读数一致', () => {
  it('默认规则覆盖的角色集合非空（反空洞）', () => {
    expect(DEFAULT_RULES.length).toBeGreaterThan(0)
    expect(RULE_AGENTS.length).toBeGreaterThan(0)
    for (const a of RULE_AGENTS) expect(a).toMatch(/^\d{4}$/)
  })

  it.each(RULE_AGENTS)('拥有默认规则的角色 %s：teamTotalDamage 空规则 ≡ 生产默认规则', async (agentId) => {
    const team = teamFor(agentId)
    const empty = await totalDamage(team, [])
    const prod = await totalDamage(team, DEFAULT_RULES)
    expect(empty).toBeGreaterThan(0)
    expect(prod).toBe(empty)
  })
})
