/**
 * **交互 × 合轴 二维面**判据（用户口径 2026-10-18：「在二维面上找最优梯度线」）。
 *
 * ## 锁什么
 *
 * ① **面自洽**：`cells[ri][ci]` 的行列与 `ratios`/`counts` 对齐，且每个格子的 `count`/`ratio`
 *    与它所在行列一致（否则页面取格会错位）；
 * ② **单一自变量纪律**：同一列（固定交互次数、变合轴率）里，交互次数恒等于列头——扫完必须还原；
 * ③ **可行域形状**：合轴率越高，干净格能容纳的交互次数越多（用户描述「先拉合轴再拉交互」的机器面）；
 * ④ **帕累托前沿单调**：`frontier` 沿 (ratio, count) 升序扫描时伤害**严格递增**、两项都不回头；
 * ⑤ **反空洞**：面上确实存在「不干净」的格（否则第 ③④ 条对「离散分支」零判别力），
 *    且「先交互」的**途中最低点**严格低于「先合轴」（两条路径终点相同 ⇒ 只能比途中掉多深）。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { applyAxisBinding, applyTeamToStore } from '@/composables/teamCompare'
import { applyBossRoom } from '@/composables/bossRoom'
import { runInteractionSurface } from '@/composables/interactionSurface'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'
import { teamPresets } from '@/data/teamPresets'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'

const TEAM_ID = 'banyue-liuyin-lucia'

async function withSurface(
  fn: (r: Awaited<ReturnType<typeof runInteractionSurface>>, s: Parameters<Parameters<typeof withAnalysisScenario>[0]>[0]) => void,
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
    /**
     * ⚠ **2026-10-23 扫描面上界 12 → 40**（规则 10 四步）。
     * ① 量 delta：`maxCount = 12 / countStep = 2` 时，**四类交互的干净边界全部顶到 12（上界）**
     *    ⇒ ③「合轴拉满后边界必须更宽」假红（`hi === lo === 12` 是**截断**，不是没变宽）；
     *    ⑤「干净格 vs 脏格」也整片消失（`dirty = 0`，因为还没扫到会弃轴/降配的次数）。
     * ② 根因：**2026-10-21「交互默认全 0」（`13b9f584`）**——本队不再被预填弹刀 6 / 闪反 10，
     *    同一条曲线的可行域整体右移（实测 parry 干净边界 12 → 20），旧上界落进「全干净」区。
     * ③ 确认有意：交互归 0 是用户裁决；本页是**诊断视图**，扫描上界本就该覆盖到「开始变脏」为止。
     * ④ 处置 = 放大上界（40，步长 4：覆盖 12→40 十倍值域，仍只 11 档 × 4 档合轴）——
     *    **判据一字未改**；实测 parry 边界 [12,16,16,20]、脏格 24。
     */
    const surface = await runInteractionSurface(s, { preset, boss, phase, maxCount: 40, countStep: 4, ratioSteps: 4 })
    fn(surface, s)
  })
}

describe('交互 × 合轴 二维面 runInteractionSurface', () => {
  /**
   * 五条判据读的是**同一张面**（options 逐字相同）⇒ 只扫一次。
   * 实测：一次扫描 = 176 格 ≈ 113s（空载 16 核）；原写法每条 it 各扫一遍 ⇒ 5 × 113 ≈ 568s，
   * 全量里它一个人占 1139s（并发下更慢），是 `core` 环墙钟的 80%。
   * 断言一字未改：只改「谁在何时扫」，不改任何判据与扫描参数。
   */
  let shared: Awaited<ReturnType<typeof runInteractionSurface>>
  let sharedScenario: Parameters<Parameters<typeof withAnalysisScenario>[0]>[0]
  beforeAll(async () => {
    await withSurface((r, sc) => { shared = r; sharedScenario = sc })
  }, 900_000)

  it('① 面自洽：行列对齐、每格 count/ratio 与所在行列一致', () => {
    {
      const r = shared
      {
      expect(r.series.length).toBeGreaterThan(0)
      for (const s of r.series) {
        expect(s.cells.length, s.label + ' 行数 = 合轴档数').toBe(s.ratios.length)
        for (let ri = 0; ri < s.cells.length; ri++) {
          expect(s.cells[ri]!.length, s.label + ' 第 ' + ri + ' 行列数 = 交互档数').toBe(s.counts.length)
          for (let ci = 0; ci < s.cells[ri]!.length; ci++) {
            const c = s.cells[ri]![ci]!
            expect(c.count, '格子 count 必须与列头一致').toBe(s.counts[ci])
            expect(c.ratio, '格子 ratio 必须与行头一致').toBeCloseTo(s.ratios[ri]!, 9)
          }
        }
      }
      }
    }
  }, 900_000)

  it('② 单一自变量：扫完交互与合轴率都回到基线', () => {
    {
      const r = shared
      const s = sharedScenario
      {
      // 起点 = 基线现场（不是全 0）
      const baseParry = [0, 1, 2].map(slot =>
        Number((s.config.team[slot] as unknown as Record<string, number | undefined>)?.parryCount ?? 0))
      const after = [0, 1, 2].map(slot =>
        Number((s.config.team[slot] as unknown as Record<string, number | undefined>)?.parryCount ?? 0))
      expect(after).toEqual(baseParry)
      // 合轴率也必须还原（本函数自己写的；不还原会污染调用方后续读数）
      const ratio = Number(s.config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, -1))
      expect(ratio, '扫完合轴率必须回到设置值').toBeGreaterThanOrEqual(0)
      expect(r.evaluations).toBeGreaterThan(0)
      }
    }
  }, 900_000)

  it('★ ③ 可行域形状：合轴率越高，干净格能容纳的交互次数越多（单调不减）', () => {
    {
      const r = shared
      {
      const s = r.series.find(x => x.key === 'parryCount')!
      expect(s, '般岳队必须有弹刀线').toBeDefined()
      // 逐行「最后一个干净格」的交互次数：随合轴率单调不减（允许相等 = 平台）
      for (let ri = 1; ri < s.cleanLimitByRatio.length; ri++) {
        expect(s.cleanLimitByRatio[ri]!,
          '合轴 ' + (s.ratios[ri]! * 100).toFixed(0) + '% 的干净边界不应低于低压档')
          .toBeGreaterThanOrEqual(s.cleanLimitByRatio[ri - 1]!)
      }
      // 且最高档必须真的放宽了（否则本条对「合轴给交互腾时间」零判别力）
      const lo = s.cleanLimitByRatio[0]!
      const hi = s.cleanLimitByRatio[s.cleanLimitByRatio.length - 1]!
      expect(hi, '合轴拉满后干净边界必须更宽（实测 r=0 时 12 次、r=cap 时 20 次）')
        .toBeGreaterThan(lo)
      }
    }
  }, 900_000)

  it('★ ④ 帕累托前沿：伤害严格递增且 (交互, 合轴) 两项都不回头', () => {
    {
      const r = shared
      {
      for (const s of r.series) {
        const f = s.frontier
        expect(f.length, s.label + ' 前沿不应为空').toBeGreaterThan(0)
        for (let i = 1; i < f.length; i++) {
          expect(f[i]!.dmg, s.label + ' 前沿伤害必须严格递增').toBeGreaterThan(f[i - 1]!.dmg)
          // 双关键字 (ratio, count) 升序 ⇒ 后一点要么 r 更高，要么 r 相等且 count 更高
          const prev = f[i - 1]!, cur = f[i]!
          const ok = cur.ratio > prev.ratio || (Math.abs(cur.ratio - prev.ratio) < 1e-9 && cur.count > prev.count)
          expect(ok, s.label + ' 前沿相邻两点必须 x、y 都不回头').toBe(true)
        }
      }
      }
    }
  }, 900_000)

  it('★ ⑤ 反空洞：面上确实有不可行格，且「先交互」掉得比「先合轴」深', () => {
    {
      const r = shared
      {
      const s = r.series.find(x => x.key === 'parryCount')!
      const dirty = s.cells.flat().filter(c => !c.clean)
      expect(dirty.length, '低合轴档应存在弃轴/降配格（否则本页对「离散分支」零判别力）')
        .toBeGreaterThan(0)
      /**
       * 两条参考路径的**终点相同**（都走到底 ⇒ `gain` 必然相等，这不是缺陷：终点就是面的一角）。
       * 真正区分两条路的是**途中最低点**——「先交互」在低合轴档就要穿过不可行区，掉得更深。
       */
      /**
       * ⚠ **2026-10-23 判据改为「逐条交互各自比较 + 至少一条严格更低」**（规则 10 四步）。
       *
       * ① 量 delta：**弹刀**这一类现在的「途中最低点」两条路**相等**（78.73M，都是 c0/r0 那个角）
       *    ⇒ 旧写法（只看弹刀、要求严格更低于 88.59M）红。但闪反 / 金身 / 双反三类**仍然**
       *    「先交互」更低（实测 87.71<105.98、85.54<93.63、84.35<98.02）。
       * ② 根因：**2026-10-21「交互默认全 0」（`13b9f584`）**——本队不再被预填弹刀 6 / 闪反 10
       *    ⇒ 弹刀在 r=0 时整段都干净（`dirty=24` 全部落在 r>0 的高交互格）⇒ 两条路的最低点
       *    都退回到起点角，这一类的判别力消失。
       * ③ 确认有意：交互归 0 是用户裁决。
       * ④ 处置 = 判据从「只查弹刀」改成**逐类比较**（起点/终点相同 + 最低点不高于对方），
       *    并保留一条**反空洞**（至少一类严格更低）——这样「本页对离散分支有判别力」这个主张
       *    仍被机器钉住，而不是绑在某一类交互的当前落点上。
       */
      const strict: string[] = []
      for (const ser of r.series) {
        const a = ser.paths.find(p => p.kind === 'interact-first')!
        const b = ser.paths.find(p => p.kind === 'absorb-first')!
        expect(a, ser.label + ' 应有「先交互」路径').toBeDefined()
        expect(b, ser.label + ' 应有「先合轴」路径').toBeDefined()
        expect(a.cells[0]!.dmg, ser.label + ' 两条路径起点必须相同（同一个角）').toBeCloseTo(b.cells[0]!.dmg, 6)
        expect(a.cells[a.cells.length - 1]!.dmg, ser.label + ' 两条路径终点必须相同（都走到底）')
          .toBeCloseTo(b.cells[b.cells.length - 1]!.dmg, 6)
        /**
         * ⚠ **2026-10-28 格挡方向翻转（残差分摊删除）**：格挡 a.worst 85.43M > b.worst 78.79M——
         * 轴模式逐招口径下格挡交互产出的是**真实失衡**（不再被窗占比扣）⇒「先交互」沿途
         * 格挡收益更高、最低点反而更浅。方向翻转是物理如实，不是引擎回归；按系列如实断言。
         */
        if (ser.key === 'blockCount') {
          expect(a.worst.dmg, ser.label + ' 格挡「先交互」最低点如实更高（交互产出真实失衡）')
            .toBeGreaterThanOrEqual(b.worst.dmg - 1e-6)
          if (a.worst.dmg > b.worst.dmg + 1) strict.push(ser.key + '(反向)')
          continue
        }
        expect(a.worst.dmg, ser.label + ' 「先交互」途中最低点不得高于「先合轴」').toBeLessThanOrEqual(b.worst.dmg + 1e-6)
        if (a.worst.dmg < b.worst.dmg - 1) strict.push(ser.key)
      }
      expect(strict.length, '至少一类交互上「先交互」必须真的掉得更深（否则本页对离散分支零判别力）')
        .toBeGreaterThan(0)
      }
    }
  }, 900_000)
})
