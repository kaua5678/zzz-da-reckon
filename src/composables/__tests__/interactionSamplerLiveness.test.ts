/**
 * **采样器必须让出主线程**（2026-10-19 用户报「点进交互页面就卡死」的回归判据）。
 *
 * ## 锁什么
 *
 * 一次二维面 = 48~120 次全队求值 ≈ 20~60s。同步实现会独占主线程整段时间
 * ⇒ 页面渲染/点击/滚动全部停摆（不是崩溃，是**没有响应**）。
 * 本判据用「采样期间 setTimeout 能否被调度」来证明它确实让出了：
 * 同步实现下计时器一次都跑不了，异步实现下会跑很多次。
 *
 * ⚠ 这条判据**故意不看耗时**（机器快慢无关），只看「有没有让出」这个布尔事实。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { applyAxisBinding, applyTeamToStore } from '@/composables/teamCompare'
import { applyBossRoom } from '@/composables/bossRoom'
import { runInteractionSurface } from '@/composables/interactionSurface'
import { runInteractionSweep } from '@/composables/interactionSweep'
import { teamPresets } from '@/data/teamPresets'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'

const TEAM_ID = 'banyue-liuyin-lucia'

/** 采样期间数「计时器被调度的次数」——同步实现恒为 0 */
async function ticksWhile(fn: () => Promise<unknown>): Promise<number> {
  let ticks = 0
  const timer = setInterval(() => { ticks++ }, 0)
  try {
    await fn()
  } finally {
    clearInterval(timer)
  }
  return ticks
}

describe('交互采样器：让出主线程（防页面卡死）', () => {
  it('★ 二维面采样期间主线程可被调度（同步实现下计时器一次都跑不了）', async () => {
    const { catalog } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const data = await catalog.loadBossPresets()
    const boss = (data.bosses ?? []).find((b: BossPreset) => b.id === '30041')!
    const phase = (boss.phases.find(p => p.modeType === 'critical_assault') ?? boss.phases[0]!) as BossPresetPhase
    const preset = teamPresets.find(p => p.id === TEAM_ID)!

    const ticks = await ticksWhile(() => withAnalysisScenario(async s => {
      applyBossRoom(s.config, boss, phase)
      applyTeamToStore(s.config, preset)
      applyAxisBinding(s.config, s.config.getAxisState(), preset)
      // 最小网格：只要证明「每格都让出」，不需要大网格
      await runInteractionSurface(s, { preset, boss, phase, maxCount: 4, countStep: 2, ratioSteps: 2 })
    }))
    expect(ticks, '二维面采样期间主线程必须被让出（否则页面卡死）').toBeGreaterThan(0)
  }, 600_000)

  it('★ 一维扫描同样让出主线程', async () => {
    const { catalog } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const data = await catalog.loadBossPresets()
    const boss = (data.bosses ?? []).find((b: BossPreset) => b.id === '30041')!
    const phase = (boss.phases.find(p => p.modeType === 'critical_assault') ?? boss.phases[0]!) as BossPresetPhase
    const preset = teamPresets.find(p => p.id === TEAM_ID)!

    const ticks = await ticksWhile(() => withAnalysisScenario(async s => {
      applyBossRoom(s.config, boss, phase)
      applyTeamToStore(s.config, preset)
      applyAxisBinding(s.config, s.config.getAxisState(), preset)
      await runInteractionSweep(s, { preset, boss, phase, maxCount: 3, keys: ['parryCount'] })
    }))
    expect(ticks, '一维扫描期间主线程必须被让出').toBeGreaterThan(0)
  }, 600_000)

  it('★ 取消：中断后返回已算部分且 complete = false', async () => {
    const { catalog } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const data = await catalog.loadBossPresets()
    const boss = (data.bosses ?? []).find((b: BossPreset) => b.id === '30041')!
    const phase = (boss.phases.find(p => p.modeType === 'critical_assault') ?? boss.phases[0]!) as BossPresetPhase
    const preset = teamPresets.find(p => p.id === TEAM_ID)!

    const controller = new AbortController()
    // 算到第 3 格就取消（进度回调是每格一次，能可靠打断）
    const res = await withAnalysisScenario(async s => {
      applyBossRoom(s.config, boss, phase)
      applyTeamToStore(s.config, preset)
      applyAxisBinding(s.config, s.config.getAxisState(), preset)
      return runInteractionSurface(s, {
        preset, boss, phase, maxCount: 8, countStep: 2, ratioSteps: 3,
        control: { signal: controller.signal },
        onProgress: p => { if (p.pct > 0) controller.abort() },
      })
    })
    expect(res.complete, '被取消 ⇒ complete = false').toBe(false)
    // 全量 = 4 类 × 3 档 × 5 列 = 60 格；取消必须发生在跑完之前
    const full = res.series.length === 0 ? 60 : 4 * 3 * 5
    expect(res.evaluations, '取消后已算格数必须少于全量').toBeLessThan(full)
    expect(res.evaluations, '取消发生在第一格之后（不是零格）').toBeGreaterThan(0)
  }, 600_000)
})
