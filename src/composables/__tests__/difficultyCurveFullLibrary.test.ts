/**
 * T140c 卡 §6.5 的**全库判据**：④ 点伤害 ≥ ① 点伤害（97 队逐队）。
 *
 * > 「④ 点伤害 ≥ ① 点伤害（**全库 97 队逐队断言**）——这是『难度上升 ⇒ 总伤上升』的机器判据。」
 *
 * ## 为什么单独一个文件（而不是塞进 `difficultyCurve.test.ts`）
 *
 * 全库 97 队 × 每队一条曲线（含一次 `joint-levers` 联合搜索 + ②③ 网格）**实测约 5~7 分钟**，
 * 远超市级单测的量级。`difficultyCurve.test.ts` 是**单队/纯函数**判据（~60s），
 * 把它拖成全库会让「改一行跑一次」的反馈环失效。
 *
 * ⇒ 本文件**默认不跑**（`describe.runIf`），由验收/回归时显式开启：
 * ```bash
 * PROBE_DIFF_FULL=1 npx vitest run src/composables/__tests__/difficultyCurveFullLibrary.test.ts
 * ```
 * ⚠ 卡 §6 的验收条目就是「全库逐队断言」⇒ **合并前必须跑一次这个开关**，不能只看单队用例。
 *
 * ## 这条判据为什么值得单独存在（它抓过一次真缺陷）
 *
 * 卡 §3.1 字面把 ④ 定义为「现状 G2+G4+G5 全开」，实测**2 队违例**
 * （`auto-1521-1251-1311` −2.158M、`auto-1401-1411-1031` −3.528M）。
 * 逐杠杆消融定位元凶 = **G4（计数投影）**：它单独作用于 ① 时 **21/97 队为负**（最坏 −12.476M）
 * ⇒ 它不是单调增益的难度旋钮，而是计数口径。去掉 G4 后本判据 0 队违例。
 * 证据：`.zc/perf/T140cPredict{3,4,5}.perf.ts`；否决记录见 `docs/ENGINE_PIPELINE_GUIDE.md` §4。
 *
 * ## 判据的三态（不只看「没红」）
 *
 * ① **覆盖面**：扫到的队数必须 == `teamPresets.length`（防扫描面塌陷成"全绿"）；
 * ② **非平凡性**：必须有相当比例的队 ④ > ①（若全体 Δ=0，说明旋钮整体失效而判据假绿）；
 * ③ **逐队 ④ ≥ ①**（负控：任何一队为负即红，并打印队名与数值）。
 */
import { describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { computeDifficultyCurves } from '@/composables/difficultyCurve'
import { teamPresets } from '@/data/teamPresets'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'

/** 默认不跑（~5-7 分钟）；验收时 `PROBE_DIFF_FULL=1` 开启 */
const ENABLED = process.env.PROBE_DIFF_FULL === '1'

describe.runIf(ENABLED)('T140c §6.5 全库：④ ≥ ①（难度上升 ⇒ 总伤上升）', () => {
  it('97 队逐队：④ ≥ ①，且覆盖面/非平凡性自证', async () => {
    newPinia()
    mockStaticFetch()
    const { catalog } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    // Boss = 最新期里第一个（与页面 `TeamComparePage` onMounted 同口径；卡的数字就在这个面上量的）
    const data = await catalog.loadBossPresets()
    const sorted = [...(data.bosses ?? [])].sort((a, b) =>
      String(b.phases[0]?.begin ?? '').localeCompare(String(a.phases[0]?.begin ?? '')))
    const boss = sorted[0]! as BossPreset
    const phase = boss.phases[0]! as BossPresetPhase

    const violations: string[] = []
    const errors: string[] = []
    let scanned = 0
    let improved = 0
    let axisMissing = 0
    let totalPoints = 0

    for (const preset of teamPresets) {
      try {
        const [row] = await withAnalysisScenario(s =>
          computeDifficultyCurves(s, { presets: [preset], boss, phase }))
        const L = row!.ladder
        scanned++
        totalPoints += L.points.length
        if (L.axisPointMissing) axisMissing++
        // ①④ 恒存在（卡 §4）
        expect(L.points[0]!.point, `${preset.id}: 首点必须是 baseline`).toBe('baseline')
        expect(L.points[L.points.length - 1]!.point, `${preset.id}: 末点必须是 max`).toBe('max')
        // 点数 1~4（卡 §6.2）
        expect(L.points.length, `${preset.id}: 点数必须 1~4`).toBeLessThanOrEqual(4)
        if (L.gain > 1e-6) improved++
        if (L.gain < -1e-6) {
          violations.push(`${preset.id}: ①=${(L.base / 1e6).toFixed(3)}M ④=${(L.final / 1e6).toFixed(3)}M Δ=${(L.gain / 1e6).toFixed(3)}M`)
        }
      } catch (e) {
        errors.push(`${preset.id}: ${(e as Error).message.slice(0, 120)}`)
      }
    }

    // ② 覆盖面自证（防扫描面塌陷成"全绿"）
    expect(scanned, `必须扫完全库 ${teamPresets.length} 队`).toBe(teamPresets.length)
    expect(errors, `逐队求值不得抛错：\n${errors.join('\n')}`).toEqual([])
    // ③ 非平凡性：若 ④ 相对 ① 全体零增益，说明旋钮整体失效而判据假绿
    expect(improved, '必须有相当比例的队 ④ > ①（否则判据对"旋钮失效"零判别力）')
      .toBeGreaterThan(teamPresets.length * 0.3)
    // ④ 核心判据：逐队 ④ ≥ ①
    expect(violations, `④ < ① 的队（难度上升却没涨伤害）：\n${violations.join('\n')}`).toEqual([])

    // 诊断输出（跑一次就能看到全库形态；失败时也打印）
    console.log(`T140C_FULL scanned=${scanned} improved=${improved} axisPointMissing=${axisMissing} `
      + `avgPoints=${(totalPoints / Math.max(1, scanned)).toFixed(2)}`)
  }, 3_600_000)
})
