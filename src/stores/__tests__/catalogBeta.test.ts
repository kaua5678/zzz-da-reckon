/**
 * beta 冻结角色旁挂（2026-10-24）：beta-agents.json 只在开关打开时 fetch + 合并进 catalog 索引。
 *
 * 口径（见 stores/catalog.ts beta 段注释）：默认关 = 整库不放出 beta id（displayAgents / agentsMap /
 * skills / wEngines 全看不见）；打开才合并。切换走 setBetaEnabled 落 localStorage（本套件跑在 node
 * 环境，真 localStorage 不存在 ⇒ 用 stubGlobal 注入假实现；生产浏览器侧由 try/catch 兜底）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import type { BetaAgentsFile } from '@/types/catalog'

const catalogData = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))

/** 从真实 catalog 切一份 1011 的 beta 副本（id/名字后缀，跑真实的索引合并路径）。 */
function betaFixture(): BetaAgentsFile {
  const agent = JSON.parse(JSON.stringify(catalogData.agents.find((a: { id: string }) => a.id === '1011')))
  agent.id = '1011v1'
  agent.name = { zhCN: `${agent.name.zhCN} v1`, en: `${agent.name.en} v1` }
  const skills = JSON.parse(JSON.stringify(catalogData.agentSkills.find((s: { agentId: string }) => s.agentId === '1011')))
  skills.id = '1011v1'
  skills.agentId = '1011v1'
  return {
    schemaVersion: 1,
    agents: [agent],
    agentSkills: [skills],
    wEngines: [],
    snapshots: [{ agentId: '1011', betaId: '1011v1', tag: 'v1', sourceVersion: 'test', gitTag: 'agent/1011/test', createdAt: '2026-10-24T00:00:00Z' }],
  }
}

function stubLocalStorage(): void {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
}

beforeEach(() => {
  newPinia()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('beta 冻结角色合并门', () => {
  it('开关关（默认）：不 fetch 旁挂文件，全索引无 beta id', async () => {
    stubLocalStorage()
    mockStaticFetch({ betaAgents: betaFixture() })
    const catalog = useCatalogStore()
    await catalog.load()

    expect(catalog.betaEnabled).toBe(false)
    expect(catalog.betaAgentsFile).toBeNull() // 连 fetch 都没发（load 只在 enabled 时拉旁挂）
    expect(catalog.displayAgents.some(a => a.id === '1011v1')).toBe(false)
    expect(catalog.getAgent('1011v1')).toBeUndefined()
    expect(catalog.getAgentSkills('1011v1')).toBeUndefined()
  })

  it('开关开：fetch 旁挂并合并——displayAgents / getAgent / skills 都放行', async () => {
    stubLocalStorage()
    localStorage.setItem('zzz-beta-agents', '1')
    mockStaticFetch({ betaAgents: betaFixture() })
    const catalog = useCatalogStore()
    await catalog.load()

    expect(catalog.betaEnabled).toBe(true)
    expect(catalog.betaAgentsFile?.snapshots).toHaveLength(1)
    expect(catalog.displayAgents.some(a => a.id === '1011v1')).toBe(true)
    expect(catalog.getAgent('1011v1')?.name.zhCN).toBe(`${catalog.getAgent('1011')?.name.zhCN} v1`)
    expect(catalog.getAgentSkills('1011v1')?.agentId).toBe('1011v1')
  })

  it('开关开但文件缺失（还没有快照）：不算错误，索引正常', async () => {
    stubLocalStorage()
    localStorage.setItem('zzz-beta-agents', '1')
    mockStaticFetch() // 默认 beta-agents.json 404
    const catalog = useCatalogStore()
    await expect(catalog.load()).resolves.toBeDefined()
    expect(catalog.catalogStatus).toBe('ready')
    expect(catalog.betaAgentsFile).toBeNull()
    expect(catalog.displayAgents.length).toBe(catalogData.agents.filter((a: { hidden?: boolean }) => !a.hidden).length)
  })

  it('setBetaEnabled 落/清 localStorage', () => {
    stubLocalStorage()
    const catalog = useCatalogStore()
    catalog.setBetaEnabled(true)
    expect(localStorage.getItem('zzz-beta-agents')).toBe('1')
    catalog.setBetaEnabled(false)
    expect(localStorage.getItem('zzz-beta-agents')).toBeNull()
  })
})
