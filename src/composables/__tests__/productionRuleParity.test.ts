/**
 * CC-249：spec 默认行规则只用于展示、不改整队读数（原名「测试态 / 生产态行规则一致性」，§24.85 未决项裁决）。
 *
 * 背景：`logicEditor/defaults.ts` 把 `specs/agents/*.json#rowFusions` 灌成默认规则，`stores/logicEditor.ts`
 * 建立即 `setActiveRowFusionRules`。CC-249 当时 harness 不建立该 store ⇒ 测试态规则为空、生产态不为空，
 * 靠人工纪律「涉及 getRowValue 的改动须在默认规则下补验」（CC-237 误并即因此漏网）。
 *
 * CC-249 的裁决「不让 harness 全局加载默认规则」已于 r697 推翻：`setupHarness` 与生产启动入口 `useCalculatorStartup`
 * 一样建立该 store ⇒ harness 用例全部在生产默认规则下跑。当时顾虑的代价实测为零：十余个 `afterEach(set([]))`
 * 不用改（每次 setupHarness 新建 store 即重新激活默认规则），rowValueSource 等单元锁不走 harness。
 * 本锁保留：对每个**拥有默认规则**的角色（moveId 前 4 位 = agentId，动态推导 ⇒ 新增默认规则自动纳入）组一队，
 * 断言空规则与默认规则下 teamTotalDamage 逐位相同。规则必须在 setupHarness **之后**设——它会重置为默认规则
 * （r697 前本文件先设后建；r697 后那样写两侧都是默认规则，比较落空）。
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
  await setupHarness(team.map(agentId => ({ agentId })), { recommendedBuild: false })
  setActiveRowFusionRules(rules)
  return useResourceCalc().teamTotalDamage.value
}

describe('CC-249 空规则与 spec 默认行规则下整队读数一致（默认规则只用于展示）', () => {
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
