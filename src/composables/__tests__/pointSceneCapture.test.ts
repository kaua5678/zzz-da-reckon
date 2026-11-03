/**
 * **各比较入口的「这一档资源池」判据**（T189，用户 2026-11-03）。
 *
 * 用户逐字：
 * > 「**每个点都代表一个金，只有这个能看资源池了**」（散点）
 * > 「**显示整队的好，单一角色分析是从整队数据挑选部分数据来分析的**」（选第三人）
 *
 * ⇒ 散点的**一个点 = 一个金档**、选第三人的**一名候选 = 一档整队**，都要能就地打开完整资源池
 * （同一个 `useCurvePointPool` + 同一个 `ResourcePoolView`，与难度曲线同一条链）。
 *
 * 这条链唯一的失效方式是**显示的不是那一档的资源池**（不报错，只是让人拿着别的档的数字下结论）：
 * 判据 = 每一点带上「现场差分」，把它重放回独立场景**必须复现该点自己的读数**：
 *   ① 散点：`point.scene` 重放后 `teamTotalDamage` ≡ 该点 `damage`（逐位相等），且**每个点都带 scene**；
 *   ② 选第三人：候选的 `scene` 重放后伤害 ≡ 该候选行 `damage`；
 *   ③ 不污染 UI 现场（跑在独立场景上，跑完 store 逐字节不变）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { restoreStateDelta } from '@/composables/configDelta'
import { computeTeamComparePoints } from '@/composables/teamCompare'
import { computeSlotSweepPoints } from '@/composables/teamTimeline'
import { teamPresets } from '@/data/teamPresets'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'
import type { PointScene } from '@/types/configDelta'

const res20 = { physical: 20, fire: 20, ice: 20, electric: 20, ether: 20, wind: 20 }
const FAKE_BOSS: BossPreset = {
  id: '40009', name: '异构·基塔布鲁', nameEn: 'x', aliases: [], icon: null, iconSource: null,
  isCriticalAssault: true,
  monster: { stunVuln: 1.5, stunTime: 12, name: '异构·基塔布鲁' },
  defaults: { battleTime: 180, shieldCount: 0, energyShield: 0 },
  phases: [],
}
const FAKE_PHASE: BossPresetPhase = {
  phaseId: '690461', zoneKey: '69046201', version: '3.2', label: '3.2', begin: '2026-07-30 04:00:00',
  modeType: 'critical_assault', stageName: 'x', stageNum: 1, level: 70, hp: 31_900_305,
  stunValue: 18933.95, defense: 953, bossAnomalyCoeff: 1.1,
  damageResistances: { ...res20 }, stunResistances: { ...res20 }, anomalyResistances: { ...res20 },
  weakness: [], resistance: [],
}

/** 把一份现场差分重放回**独立场景**并读出该档伤害（展示层点开某一档时走的就是这条链） */
async function replayDamage(scene: PointScene): Promise<number> {
  return withAnalysisScenario(s => {
    restoreStateDelta(s.config, scene.base, scene.delta)
    return s.calc.teamTotalDamage.value
  })
}

describe('散点：一个点 = 一个金档 ⇒ 该点现场可重放（重放伤害逐位相等）', () => {
  it('★ 每个点都带现场差分，且重放伤害 ≡ 该点 damage；UI 现场不被污染', async () => {
    const { catalog } = await setupHarness([{ agentId: '1611' }, { agentId: '1141' }, { agentId: '1211' }], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const preset = teamPresets.find(p => p.id === 'auto-1611-1141-1211')!
    const config = useConfigStore()
    const beforeTeam = JSON.stringify(config.team)
    const points = await withAnalysisScenario(s => computeTeamComparePoints(s, {
      presets: [preset],
      goldLevels: [0, 1, 2, 4],
      boss: FAKE_BOSS,
      phase: FAKE_PHASE,
      collectScenes: true,
    }))
    expect(points.length, '本队至少一个金档可查').toBeGreaterThan(0)
    for (const p of points) {
      expect(p.scene, `${p.presetName} ${p.goldLabel} 必须带现场差分`).toBeTruthy()
      const replay = await replayDamage(p.scene!)
      expect(replay, `${p.presetName} ${p.goldCount}金：重放伤害必须与该点逐位相等`).toBe(p.damage)
    }
    expect(JSON.stringify(config.team), 'UI 现场必须逐字节不变（跑在独立场景上）').toBe(beforeTeam)
  }, 600_000)

  it('缺省不采现场 ⇒ 零开销且不带 scene（不许默认背着 2.1KB/点）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1611' }, { agentId: '1141' }, { agentId: '1211' }], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const preset = teamPresets.find(p => p.id === 'auto-1611-1141-1211')!
    const points = await withAnalysisScenario(s => computeTeamComparePoints(s, {
      presets: [preset], goldLevels: [0, 2], boss: FAKE_BOSS, phase: FAKE_PHASE,
    }))
    expect(points.length).toBeGreaterThan(0)
    for (const p of points) expect(p.scene).toBeUndefined()
  }, 600_000)
})

describe('选第三人：一名候选 = 一档整队 ⇒ 该候选现场可重放', () => {
  it('★ 每名候选都带现场差分，且重放伤害 ≡ 该候选行 damage', async () => {
    const { catalog } = await setupHarness([{ agentId: '1371' }, { agentId: '1451' }, { agentId: '1481' }])
    await catalog.loadBuildRecommendations()
    const res = await withAnalysisScenario(s => computeSlotSweepPoints(s, {
      slot: 1, fixed: ['1371', '1451'], boss: FAKE_BOSS, phase: FAKE_PHASE, budget: 6,
      candidateIds: ['1481', '1571', '1021'], collectScenes: true,
    }))
    expect(res.points.length).toBeGreaterThan(0)
    for (const p of res.points) {
      expect(p.scene, `${p.candidateName} 必须带现场差分`).toBeTruthy()
      expect(await replayDamage(p.scene!), `${p.candidateName}：重放伤害必须与该候选行逐位相等`).toBe(p.damage)
    }
  }, 900_000)
})
