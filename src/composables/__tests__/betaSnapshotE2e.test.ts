/**
 * beta 冻照端到端（2026-10-24 首个真实快照：1601 挽昼 → 1601v1，nanoka 3.4.1+19836465）。
 *
 * 断言面（不断言 v1 与正主伤害相等——正主被新一版覆盖后必然分叉，等值断言会腐）：
 * ① 开关关：1601v1 全库不可见（选人列表/按 id 查）；② 开关开：进 displayAgents、
 * getAgent/getAgentSkills 放行、能组队计算（伤害 > 0）、机制注册表有模块（spec 兜底注册路径）。
 * beta 数据读仓库真实 public/static/beta-agents.json（快照脚本生成的 1601v1 切片）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getAgentMechanic } from '@/mechanics/registry'

const betaFile = JSON.parse(readFileSync(new URL('../../../public/static/beta-agents.json', import.meta.url), 'utf8')) as {
  agents: Array<{ id: string }>
  agentSkills: Array<{ agentId: string }>
  snapshots: Array<{ agentId: string; betaId: string }>
}

beforeEach(() => {
  newPinia()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('beta 冻结快照 e2e：1601 挽昼 v1', () => {
  it('beta-agents.json 里有 1601v1 切片（快照脚本产物）', () => {
    expect(betaFile.agents.some(a => a.id === '1601v1')).toBe(true)
    expect(betaFile.agentSkills.some(s => s.agentId === '1601v1')).toBe(true)
    expect(betaFile.snapshots.some(s => s.betaId === '1601v1' && s.agentId === '1601')).toBe(true)
  })

  it('机制注册表有 1601v1 的模块（spec 兜底注册：specs/agents/1601v1.json → specToMechanicModule）', () => {
    expect(getAgentMechanic('1601v1')).toBeDefined()
    expect(getAgentMechanic('1601v1')?.agentIds).toContain('1601v1')
  })

  it('开关关：1601v1 在 displayAgents 不可见', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    mockStaticFetch({ betaAgents: betaFile })
    const { catalog } = await setupHarness([{ agentId: '1601' }])
    expect(catalog.displayAgents.some(a => a.id === '1601v1')).toBe(false)
    expect(catalog.getAgent('1601v1')).toBeUndefined()
  })

  it('开关开：1601v1 与正主同队可算（同屏对比的最小证明）', async () => {
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'zzz-beta-agents' ? '1' : null), setItem: () => {}, removeItem: () => {} })
    await setupHarness([{ agentId: '1601' }, { agentId: '1601v1' }], { betaAgents: betaFile })
    const calc = useResourceCalc()
    expect(calc.resourceResult.value).not.toBeNull()
    const live = calc.resourceResult.value!.characters.find(c => c.agentId === '1601')
    const frozen = calc.resourceResult.value!.characters.find(c => c.agentId === '1601v1')
    expect(frozen, '1601v1 槽位被空槽压缩（beta 未合并）').toBeDefined()
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)
    // v1 时代两者同数据 ⇒ 平A秒均倍率同源（v2 覆盖正主后本条仍成立——冻结包自身的倍率不会归零）
    const frozenBasic = frozen!.executions?.find(e => e.moveId === 'basic_attack')
    expect((frozenBasic?.damageMultiplier ?? 0), '冻结槽平A秒均倍率缺失（基准段未随切片带走）').toBeGreaterThan(0)
    expect(live).toBeDefined()
  })
})
