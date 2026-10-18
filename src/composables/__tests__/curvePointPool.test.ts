/**
 * 难度曲线「点开某档 → 看它的资源池」判据（T181，用户 2026-10-16）。
 *
 * 这条链的**唯一风险**是「显示的不是那个点的资源池」——它不会报错，只会让人拿着别的档的数字
 * 去解释「为什么伤害低」。故判据不测「能不能跑」，测**数值归属**：
 *
 * ① **逐位相等**：`load(point.scene)` 拿到的伤害 == 该点的 `dmg`（真实曲线跑出来的点，**含被轴砍掉的档**）；
 * ② **同源**：三份结果来自**同一次**求值（`stunPool.stunCount` ≡ 该点快照的「失衡」）；
 * ③ **不污染 UI 现场**：重算前后 UI store 的 `$state` 逐字节不变（跑在独立场景上）；
 * ④ **竞态：后发者胜**——先发的慢结果不得覆盖后发的（否则面板显示另一个档的资源池而无提示）；
 * ⑤ **无现场 ⇒ 不编数据**（清空 + 不 loading，由调用方显示「该档未采现场」）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { computeDifficultyCurves } from '@/composables/difficultyCurve'
import { useCurvePointPool } from '@/composables/curvePointPool'
import { cloneConfigState, withAnalysisScenario } from '@/composables/analysisScenario'
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

/** 跑一遍真实曲线（开 collectScenes）并返回该道的全部档（含被轴砍掉的档） */
async function curveRow() {
  const { catalog } = await setupHarness([{ agentId: '1611' }, { agentId: '1141' }, { agentId: '1211' }], { recommendedBuild: false })
  await catalog.loadBuildRecommendations()
  const preset = teamPresets.find(p => p.id === TEAM)!
  const [row] = await withAnalysisScenario(s => computeDifficultyCurves(s, {
    presets: [preset], boss: FAKE_BOSS, phase: FAKE_PHASE, collectScenes: true,
  }))
  return row!
}

describe('难度曲线某一点的资源池（按需重算）', () => {
  it('★ 点开每档 ⇒ 重算伤害与该点 dmg 逐位相等，且失衡次数与快照对账（含被轴砍掉的档）', async () => {
    const row = await curveRow()
    const all = [...row.ladder.points, ...row.ladder.axisTruncated]
    expect(all.length, '本队要有若干档可查').toBeGreaterThan(0)
    /**
     * ⚠ **2026-10-18 口径变更**：用户裁决「残疾轴的综合易伤超过非轴的默认均匀易伤后，就可以认为
     * 残疾轴也是有轴易伤上的贡献，可以不隐藏」（`difficultyAxis#partialAxisContributes`）⇒
     * 本队原本被砍的档现在**放行**了，`axisTruncated` 从「有」变「空」⇒ 原「反空洞」断言失去样本。
     *
     * ⇒ 判据改成**条件式**（与 `difficultyCurve.test.ts` 同一处理）：本队要么有被砍档、要么有放行的
     * 残疾轴档——两条路都覆盖「点开档位能查资源池」这个主题，不再把「恰好有被砍档」当前提
     * （那正是本仓库反复记录的假红病根：判据绑在某个落点细节上）。
     */
    const partialPoints = row.ladder.points.filter(p => p.axis.kind === 'partial')
    expect(
      row.ladder.axisTruncated.length + partialPoints.length,
      '反空洞：本队要么有被轴砍的档、要么有放行的残疾轴档（否则本判据对两种形态都零判别力）',
    ).toBeGreaterThan(0)

    const { pool, load } = useCurvePointPool()
    for (const p of all) {
      await load(p.scene)
      const got = pool.value
      expect(got, `${p.point} 档应有资源池结果`).toBeTruthy()
      // ① 逐位相等：重算伤害 ≡ 该点读数（这是「显示的就是那个点的资源池」的全部依据）
      expect(got!.damage, `${p.point} 档重算伤害必须与该点 dmg 逐位相等`).toBe(p.dmg)
      // ② 同源：三份结果与关键次数快照来自同一次求值（截断档没有 counts 快照，跳过该对账）
      const counts = 'counts' in p ? p.counts : undefined
      if (counts && got!.stunPool) {
        expect(got!.stunPool.stunCount, `${p.point} 档失衡次数与快照对账`).toBe(counts['失衡'])
      }
      // 资源池本身可用（面板要渲染三张卡）
      expect(got!.resourceResult.characters.length).toBeGreaterThan(0)
    }
  }, 900_000)

  it('③ 重算不改 UI 现场（跑在独立场景上）', async () => {
    const row = await curveRow()
    const config = useConfigStore()
    const uiCalc = useResourceCalc()
    const before = JSON.stringify(cloneConfigState(config.$state))
    const uiDmg = uiCalc.teamTotalDamage.value
    const { load } = useCurvePointPool()
    await load(row.ladder.points[0]!.scene)
    expect(JSON.stringify(cloneConfigState(config.$state)), 'UI 现场必须逐字节不变').toBe(before)
    expect(uiCalc.teamTotalDamage.value).toBe(uiDmg)
  }, 600_000)

  it('④ 竞态：后发者胜（慢的先发结果不得覆盖后发的）', async () => {
    const row = await curveRow()
    const all = [...row.ladder.points, ...row.ladder.axisTruncated]
    expect(all.length).toBeGreaterThan(1)
    const { pool, load } = useCurvePointPool()
    // 同时发两个（不 await 第一个）⇒ 面板最终必须是**后发**那档
    const first = load(all[0]!.scene)
    const second = load(all[1]!.scene)
    await Promise.all([first, second])
    expect(pool.value?.damage, '面板显示的必须是后发那档的伤害').toBe(all[1]!.dmg)
  }, 600_000)

  it('⑤ 无现场 ⇒ 不编数据（清空、不 loading）', async () => {
    const { pool, loading, load } = useCurvePointPool()
    await load(undefined)
    expect(pool.value).toBeNull()
    expect(loading.value).toBe(false)
  })
})
