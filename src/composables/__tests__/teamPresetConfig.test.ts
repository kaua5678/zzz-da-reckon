/**
 * CC-351：队伍预设 → store 唯一映射 `teamCompare#applyTeamPresetConfig`（主页选预设与分析器同口径）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamPresetConfig, applyTeamToStore } from '@/composables/teamCompare'
import { presetBaseEngines } from '@/composables/goldStepsFromCatalog'

describe('CC-351 applyTeamPresetConfig', () => {
  it('主页映射 = presetBaseEngines 派生的基础音擎 + 交互；命座 / 精炼保留用户档位', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }], { recommendedBuild: true })
    // 2026-10-26 起预设只带 team：基础音擎由 catalog 派生（= 主页「配装推荐·一键应用」同口径）。
    // 找一支「派生基础音擎 ≠ 该槽 setAgent 推荐音擎」的队来证明是**预设口径**覆盖了 store：
    // 现数据里这种槽 = 无专武的限定角色（catalog 没给 ownerAgentId）→ 派生成不占金的同职业音擎。
    let hit: { preset: (typeof teamPresets)[number]; slot: number; derived: string } | null = null
    for (const p of teamPresets) {
      const derived = presetBaseEngines(p, catalog)
      for (let s = 0; s < 3; s++) {
        const rec = catalog.getBuildRecommendation(p.team[s]) as { wengine?: { catalog_wengine_id?: string } } | undefined
        const rw = rec?.wengine?.catalog_wengine_id
        if (rw && String(rw) !== derived[s]) { hit = { preset: p, slot: s, derived: derived[s]! }; break }
      }
      if (hit) break
    }
    // 数据里可能暂时没有这种槽（所有角色都有推荐专武）——那就是空转，改用派生值本身做判据
    const preset = hit?.preset ?? teamPresets[0]!
    const derived = presetBaseEngines(preset, catalog)
    config.setCinemaLevel(0, 2)
    config.setWEngineModLevel(0, 3)
    applyTeamPresetConfig(config, preset)
    expect(config.team.map(c => c.agentId)).toEqual([...preset.team])
    for (let s = 0; s < 3; s++) expect(config.team[s]!.wEngineId, `槽${s} 音擎应等于 presetBaseEngines`).toBe(derived[s])
    expect(config.team[0]!.cinemaLevel).toBe(2)
    expect(config.team[0]!.wEngineModLevel).toBe(3)
  }, 60000)

  it('分析器 applyTeamToStore = 复位 0命1精 + 同一映射（两条路径装出的配装逐字段相同，命座 / 精炼除外）', async () => {
    const a = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }])
    const preset = teamPresets[0]!
    applyTeamToStore(a.config, preset)
    const viaAnalyzer = JSON.stringify(a.config.team)
    const b = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }])
    for (let s = 0; s < 3; s++) { b.config.setCinemaLevel(s, 0); b.config.setWEngineModLevel(s, 1) }
    applyTeamPresetConfig(b.config, preset)
    expect(JSON.stringify(b.config.team)).toBe(viaAnalyzer)
  }, 60000)

  it('源码锁：TeamConfigPage 不再自己拼预设装配（不直调 applyTeamPreset / applyPresetInteractions）', () => {
    const page = readFileSync(join(__dirname, '..', '..', 'views', 'TeamConfigPage.vue'), 'utf8')
    expect(page).not.toMatch(/configStore\.applyTeamPreset\(/)
    expect(page).not.toMatch(/applyPresetInteractions\(/)
    expect(page).toMatch(/applyTeamPresetConfig\(configStore, preset\)/)
  })
})
