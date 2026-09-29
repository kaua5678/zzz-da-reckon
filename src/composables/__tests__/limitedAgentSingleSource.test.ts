/**
 * CC-270：「限定 S 角色」单一定义（limitedGold.isLimitedSAgentId）。
 * 修前两套：limitedGold 按「时间线收录 ∧ 非常驻」（把 A 级特例潘引壶算成限定金），teamCompare 按 catalog 稀有度。
 * 本锁从 catalog 全员出发：限定判定 = catalog「S 级 ∧ 非常驻」（新 S 角色漏录进 AGENT_RELEASE_NODE 时这里先红）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isLimitedSAgentId, isLimitedSWengineId, memberLimitedGold } from '@/composables/limitedGold'
import { STANDARD_S_AGENT_IDS, STANDARD_S_WENGINE_IDS } from '@/data/standardMultiplierTable'
import { setupHarness } from '@/test/harness'
import { isLimitedWEngine } from '@/composables/teamCompare'
import { A_RANK_RELEASE_SPECIAL_IDS, AGENT_RELEASE_NODE } from '@/data/versionTimeline'

const catalog = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))

describe('CC-270 限定 S 角色单一定义', () => {
  it('catalog 全员：isLimitedSAgentId = S 级 ∧ 非常驻', () => {
    const bad: string[] = []
    for (const a of catalog.agents as { id: string; rarity: string; name?: { zhCN?: string } }[]) {
      const want = a.rarity === 'S' && !STANDARD_S_AGENT_IDS.has(a.id)
      if (isLimitedSAgentId(a.id) !== want) bad.push(`${a.id} ${a.name?.zhCN ?? ''} rarity=${a.rarity} 判定=${isLimitedSAgentId(a.id)}`)
    }
    expect(bad).toEqual([])
  })

  it('A 级特例在时间线收录表里，但不计限定金（潘引壶 M6 = 0 金）', () => {
    for (const id of A_RANK_RELEASE_SPECIAL_IDS) expect(AGENT_RELEASE_NODE[id], id).toBeTruthy()
    expect(memberLimitedGold({ agentId: '1421', mindscape: 6 })).toBe(0)
    expect(memberLimitedGold({ agentId: '1421', mindscape: 6, weaponId: '14109', phase: 1 })).toBe(1)
  })

  it('源码锁：限定角色判定只在 limitedGold 定义（不再另写 rarity === \'S\' && !STANDARD_S_AGENT_IDS）', () => {
    const src = readFileSync(new URL('../teamCompare.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/rarity === 'S' && !STANDARD_S_AGENT_IDS/)
  })

  it('CC-271 catalog 全部音擎：前缀判定 isLimitedSWengineId = S 级 ∧ 非常驻', () => {
    const bad: string[] = []
    for (const w of catalog.wEngines as { id: string; rarity: string }[]) {
      const want = w.rarity === 'S' && !STANDARD_S_WENGINE_IDS.has(w.id)
      if (isLimitedSWengineId(w.id) !== want) bad.push(`${w.id} rarity=${w.rarity}`)
    }
    expect(bad).toEqual([])
  })

  it('CC-271 别名 id（legacyIds）与主 id 判定一致（常驻 S 别名不算限定）', async () => {
    await setupHarness(['', '', ''], { recommendedBuild: false })
    const bad: string[] = []
    let n = 0
    for (const w of catalog.wEngines as { id: string; legacyIds?: string[] }[]) {
      for (const old of w.legacyIds ?? []) {
        n++
        if (isLimitedWEngine(old) !== isLimitedWEngine(w.id)) bad.push(`${old}→${w.id}`)
      }
    }
    expect(n).toBeGreaterThan(0)
    expect(bad).toEqual([])
    expect(isLimitedWEngine('zzz_wiki_218')).toBe(false) // = 14121 啜泣摇篮（常驻）
  })

  it('CC-272 源码锁：抽卡分层特例集合只在 versionTimeline 定义（pullValue / pullPlannerEngine 不再写字面量 id 集合）', () => {
    for (const f of ['../pullValue.ts', '../pullPlannerEngine.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8')
      expect(src, f).not.toMatch(/new Set\(\[\s*'1(551|421)'/)
    }
  })
})
