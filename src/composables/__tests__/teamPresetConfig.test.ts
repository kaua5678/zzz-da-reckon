/**
 * CC-351：队伍预设 → store 唯一映射 `teamCompare#applyTeamPresetConfig`（主页选预设与分析器同口径）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamPresetConfig, applyTeamToStore } from '@/composables/teamCompare'

describe('CC-351 applyTeamPresetConfig', () => {
  it('主页映射 = 预设声明的音擎（而非推荐音擎）+ 交互；命座 / 精炼保留用户档位', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }], { recommendedBuild: true })
    // 找一个「预设音擎 ≠ 推荐音擎」的预设槽（数据里有 65 个，取第一个）
    let hit: { preset: (typeof teamPresets)[number]; slot: number } | null = null
    for (const p of teamPresets) {
      for (let s = 0; s < 3; s++) {
        const rec = catalog.getBuildRecommendation(p.team[s]) as { wengine?: { catalog_wengine_id?: string } } | undefined
        const rw = rec?.wengine?.catalog_wengine_id
        if (p.wEngines?.[s] && rw && String(rw) !== String(p.wEngines[s])) { hit = { preset: p, slot: s }; break }
      }
      if (hit) break
    }
    expect(hit, '数据里应有预设音擎 ≠ 推荐音擎的槽').toBeTruthy()
    const { preset, slot } = hit!
    config.setCinemaLevel(0, 2)
    config.setWEngineModLevel(0, 3)
    applyTeamPresetConfig(config, preset)
    expect(config.team.map(c => c.agentId)).toEqual([...preset.team])
    expect(config.team[slot]!.wEngineId).toBe(preset.wEngines![slot])
    expect(config.team[0]!.cinemaLevel).toBe(2)
    expect(config.team[0]!.wEngineModLevel).toBe(3)
  }, 60000)

  it('分析器 applyTeamToStore = 复位 0命1精 + 同一映射（两条路径装出的配装逐字段相同，命座 / 精炼除外）', async () => {
    const a = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }])
    const preset = teamPresets.find(p => p.wEngines?.length === 3)!
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
