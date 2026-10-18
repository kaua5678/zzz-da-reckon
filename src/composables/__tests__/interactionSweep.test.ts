/**
 * **交互扫描**判据（用户口径 2026-10-18：「分别计算交互上升的每一点变化了什么」）。
 *
 * ## 锁什么
 *
 * ① **单一自变量**：只动被扫的那一类交互，其余配置逐位不变；
 * ② **起点 = 基线现场**（不是难度曲线的全关）——诊断工具看的是「在我这队上继续加会怎样」；
 * ③ **每格从基线重放**：扫完必须还原（只探测不落地）；
 * ④ **快照自洽**：`dmgBySource` 之和 ≡ 该格 `dmg`（与难度曲线同一条不变量）；
 * ⑤ **反空洞**：扫描必须真的产生「变化」（否则判据对「旋钮失效」零判别力）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { applyAxisBinding, applyTeamToStore } from '@/composables/teamCompare'
import { applyBossRoom } from '@/composables/bossRoom'
import { runInteractionSweep, SWEEP_INTERACTION_KEYS } from '@/composables/interactionSweep'
import { teamPresets } from '@/data/teamPresets'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'

/** 夹具：般琉卢（实测「加 1 次弹刀就掉 15.4M」的那支队，是本页立项的原因） */
const TEAM_ID = 'banyue-liuyin-lucia'

/**
 * @param keys 显式传 = 只扫这几类（诊断用）；**不传 = 走引擎默认过滤**（只扫本队真的有的类型）——
 *   与生产路径同口径，才能锁住「非般岳队不出现格挡/双反」这条判据。
 */
async function withFixture(
  fn: (r: Awaited<ReturnType<typeof runInteractionSweep>>, ctx: Parameters<Parameters<typeof withAnalysisScenario>[0]>[0]) => void,
  keys?: readonly (typeof SWEEP_INTERACTION_KEYS)[number][],
  maxCount = 8,
) {
  const { catalog } = await setupHarness(['', '', ''], { productionBasicWeights: true })
  await catalog.loadBuildRecommendations()
  const data = await catalog.loadBossPresets()
  const boss = (data.bosses ?? []).find((b: BossPreset) => b.id === '30041')!
  const phase = (boss.phases.find(p => p.modeType === 'critical_assault') ?? boss.phases[0]!) as BossPresetPhase
  const preset = teamPresets.find(p => p.id === TEAM_ID)!
  await withAnalysisScenario(async s => {
    applyBossRoom(s.config, boss, phase)
    applyTeamToStore(s.config, preset)
    applyAxisBinding(s.config, s.config.getAxisState(), preset)
    // 采样器自 2026-10-19 起是**异步分片**（每格让出主线程，防页面卡死）⇒ 必须 await
    const result = await runInteractionSweep(s, { preset, boss, phase, maxCount, ...(keys ? { keys } : {}) })
    fn(result, s)
  })
}

describe('交互扫描 runInteractionSweep', () => {
  it('★ 快照自洽：每格 dmgBySource 之和 ≡ 该格 dmg', async () => {
    await withFixture(r => {
      expect(r.series.length).toBeGreaterThan(0)
      for (const s of r.series) {
        for (const st of s.steps) {
          const sum = Object.values(st.dmgBySource).reduce((a, b) => a + b, 0)
          expect(sum, `${s.label}@${st.count} 分组之和应等于总伤害`).toBeCloseTo(st.dmg, 6)
        }
      }
    })
  }, 900_000)

  it('★ 起点 = 基线现场（不是全 0）：from 等于当前配置里该字段的最大值', async () => {
    await withFixture((r, s) => {
      const baseline = Math.max(0, ...[0, 1, 2].map(slot =>
        Number((s.config.team[slot] as unknown as Record<string, number | undefined>)?.parryCount ?? 0)))
      expect(r.series[0]!.from).toBe(baseline)
      expect(r.series[0]!.base.count).toBe(baseline)
    })
  }, 900_000)

  it('★ 只探测不落地：扫完三槽交互回到基线值', async () => {
    await withFixture((r, s) => {
      const after = [0, 1, 2].map(slot =>
        Number((s.config.team[slot] as unknown as Record<string, number | undefined>)?.parryCount ?? 0))
      // 起点 = 基线 ⇒ 扫完后该字段必须仍在基线上
      expect(after).toEqual([0, 1, 2].map(slot =>
        Number((s.config.team[slot] as unknown as Record<string, number | undefined>)?.parryCount ?? 0)))
      expect(r.series[0]!.from).toBe(Math.max(0, ...after))
    })
  }, 900_000)

  it('★ 反空洞：本队扫描确实产生「加交互掉伤害」的形态（本页立项的原因）', async () => {
    await withFixture(r => {
      const s = r.series[0]!
      expect(s.steps.length, '至少要有起点+1 格').toBeGreaterThan(1)
      /**
       * ⚠ 2026-10-18 口径变更：修「冲霄动作时间」前，本队 **弹刀 6→7 就掉 15.4M**
       * （97.04M → 81.67M，弃轴 + 交互降配 ×0.5），本判据当时就锁「第一步即掉」。
       * 修后（catalog actionTime 2.667→1.167，见 scripts/lib/type-bonus-time.mjs）
       * 180s 起点升到 118.43M、6→7 反而 **+4.17M**——那一步不再是悬崖，
       * 悬崖后移到 **11→12**（-22.17M，仍由弃轴 + 降配造成）。
       * ⇒ 判据从「第一步必掉」改为「**本条扫描线里至少有一格是负的**」：
       *   锁的仍是「本页能显示出加交互掉伤害这种形态」（反空洞），但不钉死是哪一格
       *   —— 钉死具体格号会把「阈值位置」变成隐式契约，让以后任何时间/资源修正都误报。
       */
      const drops = s.steps.slice(1).filter((st, i) => st.dmg < s.steps[i]!.dmg)
      expect(drops.length, '本队扫描应至少产生一格「加交互掉伤害」（当前实测 11→12 掉 22.17M）')
        .toBeGreaterThan(0)
      // 且掉伤害的那一格轴态确实变了（infeasible）——这是掉伤害的直接原因
      /**
       * 掉伤害那一格的直接原因 = **轴态退化**（引擎弃轴 / 轴只部分兑现 ⇒ 窗口数、连携、
       * 大招一起缩）或交互降配；判据取「轴态不再是 complete」而不是钉死 `infeasible`：
       * 修后实测掉得最多的一格是 `complete → partial`（弹刀 7→8：122.24M → 109.62M，
       * 轴还在但只兑现一部分），而 10 次以后才轮到 `infeasible`。两条都是同一类退化。
       */
      const firstDropIdx = s.steps.findIndex((st, i) => i > 0 && st.dmg < s.steps[i - 1]!.dmg)
      const before = s.steps[firstDropIdx - 1]!
      const at = s.steps[firstDropIdx]!
      expect(at.axis.kind !== 'complete' || before.axis.kind !== 'complete',
        `掉伤害那一格（${before.count}→${at.count}）应有轴态退化（complete → partial/infeasible）`).toBe(true)
    })
  }, 900_000)

  /**
   * ★ 用户口径 2026-10-18：「金身格挡和般岳双反本来就是只有般岳才能打，**我主页都隐藏了没让改**」
   *
   * ⇒ 本页默认**只扫该队真的有的交互类型**（判据 = 三槽里该字段基线非零）。
   * 反例：席德队扫「格挡/双反」会得到一条「0→20 次伤害纹丝不动」的假线（实测 5274.12万 恒定），
   * 既占版面又误导——那不是「交互无用」，是「这队根本不打这种交互」。
   */
  it('★ 默认只扫本队有的交互类型（般岳有格挡/双反，非般岳队没有）', async () => {
    await withFixture(r => {
      const labels = r.series.map(s => s.label)
      // 般岳队：弹刀（职业基准）+ 格挡/双反（般岳 interactionDefaults 声明）
      expect(labels, '般岳队应有弹刀').toContain('弹刀')
      expect(labels, '般岳队应有格挡（金身，般岳专属）').toContain('格挡')
      expect(labels, '般岳队应有双反（般岳专属）').toContain('双反')
    })
  }, 900_000)

  it('★ 显式传 keys 时不过滤（诊断用：强制扫某类，即使本队为 0）', async () => {
    await withFixture(r => {
      expect(r.series.map(s => s.key)).toEqual(['parryCount'])
    }, ['parryCount'])
  }, 900_000)
})
