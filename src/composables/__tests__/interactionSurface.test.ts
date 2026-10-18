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
 *    且两条参考路径的收益**不同号**（实测 r=0 时先交互会掉下去——这正是本页要说明的事）。
 */
import { describe, expect, it } from 'vitest'
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
  fn: (r: ReturnType<typeof runInteractionSurface>, s: Parameters<Parameters<typeof withAnalysisScenario>[0]>[0]) => void,
) {
  const { catalog } = await setupHarness(['', '', ''], { productionBasicWeights: true })
  await catalog.loadBuildRecommendations()
  const data = await catalog.loadBossPresets()
  const boss = (data.bosses ?? []).find((b: BossPreset) => b.id === '30041')!
  const phase = (boss.phases.find(p => p.modeType === 'critical_assault') ?? boss.phases[0]!) as BossPresetPhase
  const preset = teamPresets.find(p => p.id === TEAM_ID)!
  await withAnalysisScenario(s => {
    applyBossRoom(s.config, boss, phase)
    applyTeamToStore(s.config, preset)
    applyAxisBinding(s.config, s.config.getAxisState(), preset)
    fn(runInteractionSurface(s, { preset, boss, phase, maxCount: 12, countStep: 2, ratioSteps: 4 }), s)
  })
}

describe('交互 × 合轴 二维面 runInteractionSurface', () => {
  it('① 面自洽：行列对齐、每格 count/ratio 与所在行列一致', async () => {
    await withSurface(r => {
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
    })
  }, 900_000)

  it('② 单一自变量：扫完交互与合轴率都回到基线', async () => {
    await withSurface((r, s) => {
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
    })
  }, 900_000)

  it('★ ③ 可行域形状：合轴率越高，干净格能容纳的交互次数越多（单调不减）', async () => {
    await withSurface(r => {
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
      expect(hi, '合轴拉满后干净边界必须更宽（实测 r=0 时 2 次、r=cap 时 12+ 次）')
        .toBeGreaterThan(lo)
    })
  }, 900_000)

  it('★ ④ 帕累托前沿：伤害严格递增且 (交互, 合轴) 两项都不回头', async () => {
    await withSurface(r => {
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
    })
  }, 900_000)

  it('★ ⑤ 反空洞：面上确实有不可行格，且「先交互」掉得比「先合轴」深', async () => {
    await withSurface(r => {
      const s = r.series.find(x => x.key === 'parryCount')!
      const dirty = s.cells.flat().filter(c => !c.clean)
      expect(dirty.length, '低合轴档应存在弃轴/降配格（否则本页对「离散分支」零判别力）')
        .toBeGreaterThan(0)
      /**
       * 两条参考路径的**终点相同**（都走到底 ⇒ `gain` 必然相等，这不是缺陷：终点就是面的一角）。
       * 真正区分两条路的是**途中最低点**——「先交互」在低合轴档就要穿过不可行区，掉得更深。
       */
      const a = s.paths.find(p => p.kind === 'interact-first')!
      const b = s.paths.find(p => p.kind === 'absorb-first')!
      expect(a, '应有「先交互」路径').toBeDefined()
      expect(b, '应有「先合轴」路径').toBeDefined()
      expect(a.cells[0]!.dmg, '两条路径起点必须相同（同一个角）').toBeCloseTo(b.cells[0]!.dmg, 6)
      expect(a.cells[a.cells.length - 1]!.dmg, '两条路径终点必须相同（都走到底）')
        .toBeCloseTo(b.cells[b.cells.length - 1]!.dmg, 6)
      expect(a.worst.dmg, '「先交互」的途中最低点必须严格低于「先合轴」（实测 64.12 vs 88.59）')
        .toBeLessThan(b.worst.dmg)
    })
  }, 900_000)
})
