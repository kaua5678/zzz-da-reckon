/**
 * **难度曲线的「算什么难度」判据**（T190，用户 2026-11-03）。
 *
 * 用户逐字：「**他的默认操作模式算什么难度**？总不能没有自动调整吧，比如你把交互全硬编码为 0 还不能改」
 *
 * 缺口：曲线点只有 `x`（总数），**看不出交互是引擎搜出来的还是写死的** ⇒ 补 `costDetail`
 * （哪几项交互 × 多少次 × 什么权重 + 时间压力秒；单一来源 = `teamCompare#computeDifficulty.detail`）。
 *
 * 判据 = **明细与该点的现场同源**：把该点的现场差分重放回独立场景，用同一个量法复算
 * · `x`（`measureOperationalDifficulty`）**与原点逐位相等**；
 * · 明细（`measureOperationalDifficultyDetail().detail`）**与原点逐字相等**。
 * ⇒ 谁把明细和数值拆成两把尺（或忘了同刻采），这里就红。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { restoreStateDelta } from '@/composables/configDelta'
import { computeDifficultyCurves, measureOperationalDifficulty, measureOperationalDifficultyDetail } from '@/composables/difficultyCurve'
import { teamPresets } from '@/data/teamPresets'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'

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
const TEAM = 'auto-1611-1141-1211'

describe('难度曲线：每一档的「难度构成」与该档现场同源', () => {
  it('★ costDetail 存在；重放该点现场 ⇒ x 逐位相等、明细逐字相等', async () => {
    const { catalog } = await setupHarness([{ agentId: '1611' }, { agentId: '1141' }, { agentId: '1211' }], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const preset = teamPresets.find(p => p.id === TEAM)!
    const [row] = await withAnalysisScenario(s => computeDifficultyCurves(s, {
      presets: [preset], boss: FAKE_BOSS, phase: FAKE_PHASE, collectScenes: true,
    }))
    expect(row, '本队要有曲线').toBeTruthy()
    const points = row!.ladder.points
    expect(points.length, '反空洞：至少两个点才谈得上「难度构成随档变」').toBeGreaterThan(1)
    for (const p of points) {
      expect(p.costDetail, `${p.point} 档必须带难度构成明细`).toBeTruthy()
      expect(p.scene, `${p.point} 档必须带现场差分（collectScenes 开着）`).toBeTruthy()
      const again = await withAnalysisScenario(s => {
        restoreStateDelta(s.config, p.scene!.base, p.scene!.delta)
        return {
          x: measureOperationalDifficulty(s, preset),
          detail: measureOperationalDifficultyDetail(s, preset).detail,
        }
      })
      expect(again.x, `${p.point} 档：重放现场的 x 必须与原点逐位相等`).toBe(p.x)
      expect(again.detail, `${p.point} 档：重放现场的难度构成必须与原点逐字相等`).toBe(p.costDetail)
    }
    // 反空洞：明细必须真的由「每一项 × 权重」拼出来（不是一句空话 / 不是 '无交互' 常量）
    expect(points.map(p => p.costDetail).join(' ')).toMatch(/×/)
  }, 900_000)
})
