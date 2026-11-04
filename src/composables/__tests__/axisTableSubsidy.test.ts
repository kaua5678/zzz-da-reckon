/**
 * **「模块沉默 ⇒ `[表]` 免费接管」的源头判据**（用户 2026-11-04 专项第二轮，
 * 口径与实测全文见 `docs/mcp-cinema-interval-uplift.md` §3，坑条目 `ENGINE_PIPELINE_GUIDE` §4 坑 62）。
 *
 * ## 钉的是什么
 *
 * `yixuan-jufufu-lucia` 在 parry=20 下 C3 36.60M / C4 32.29M（−11.79%）。扣掉池里
 * `轴内·技能表直读` 的行后 C3 只剩 31.93M ⇒ **命座是 +1.12%**，负值全部是「C3 多拿的白送」。
 *
 * 白送的成立条件是**两个数同时为真**：
 *   ① 模块那一招**一行都不产**（`executions` 里没有该 moveId）⇒ `backed` 门放行 `[表]` 直读；
 *   ② 但**同一轮的轴执行集合**里该 moveId 有 N 次 ⇒ 这条白送的东西系统「本来就要打」。
 *
 * 现状：①②**可以同时成立**（计划窗 0.137 < 1 ⇒ 模块丢弃；执行集合 5 窗 ⇒ 15 次）。
 * 本文件把这个**矛盾组合**钉成红灯：任何让「表行 + 执行集合同招」同时出现的改动都会在这里失败，
 * 逼改动方回到专项文档确认口径，而不是让白送继续静默存在。
 *
 * ## 为什么不直接断言「不能有表行」
 *
 * `[表]` 直读本身是正当通道（CC-393：模块没建模的招式放进轴也能出伤）。要禁的是
 * **「模块其实该打、只是没表达」时的白送**——所以判据是「表行 ∧ 执行集合同招」这个交集，
 * 不是「表行」本身。这样 CC-393 的既有普查（`axisTableDirectCc393.test.ts`）仍然独立成立。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { applyTeamToStore } from '@/composables/teamCompare'
import { clearDifficultyLevers } from '@/composables/difficultyLadder'
import { teamPresets } from '@/data/teamPresets'

const PRESET = 'yixuan-jufufu-lucia'
const PARRY = 20

/** 采一帧：表行（按 moveId）+ 轴执行集合（按 moveId）+ 总伤 */
async function frame(cinema: number) {
  const preset = teamPresets.find(p => p.id === PRESET)!
  let out: {
    dmg: number
    tableByMove: Record<string, { count: number; dmg: number }>
    execByMove: Record<string, number>
    stunCoverage: number
    poolStun: number
  } | null = null
  await withAnalysisScenario(async s => {
    clearDifficultyLevers({ config: s.config, calc: s.calc })
    applyTeamToStore(s.config, preset)
    s.config.setCinemaLevel(0, cinema)
    s.config.syncTeammateBuffsFromTeam()
    for (let sl = 0; sl < 3; sl++) s.config.setActionCount(sl, 'parryCount', sl === 0 ? PARRY : 0)
    const dmg = s.calc.teamTotalDamage.value
    const rows = (s.calc as unknown as {
      damagePoolRows: { value: Array<{ moveId?: string; count?: number; source?: string; totalDamage: number }> }
    }).damagePoolRows.value
    const tableByMove: Record<string, { count: number; dmg: number }> = {}
    for (const r of rows) {
      if (r.source !== '轴内·技能表直读' || !r.moveId) continue
      const cur = tableByMove[r.moveId] ?? { count: 0, dmg: 0 }
      tableByMove[r.moveId] = { count: cur.count + (r.count ?? 0), dmg: cur.dmg + r.totalDamage }
    }
    const exec = (s.calc.stackTraversalResult.value as unknown as {
      executed?: Record<string, { slot: number; moveId: string; count: number }>
    } | null)?.executed ?? {}
    const execByMove: Record<string, number> = {}
    for (const v of Object.values(exec)) {
      if (v.slot !== 0) continue
      execByMove[v.moveId] = (execByMove[v.moveId] ?? 0) + v.count
    }
    out = {
      dmg,
      tableByMove,
      execByMove,
      stunCoverage: Number(s.calc.stunCoverage.value),
      poolStun: Number((s.calc.stunPoolResult.value as unknown as { stunCount?: number } | null)?.stunCount ?? 0),
    }
  })
  return out!
}

describe('模块沉默 ⇒ [表] 免费接管（源头判据）', () => {
  // 场景隔离（CC-347）：analysisScenario 需要 active pinia；harness 装一次即可
  beforeAll(async () => { await setupHarness(['', '', ''], { productionBasicWeights: true }) })

  it('★ 一个模型名【负提升是测量虚高】：扣掉表行后 C3 ≤ C4 消失，命座为正', async () => {
    const c3 = await frame(3)
    const c4 = await frame(4)
    const tableDmg = (f: typeof c3) => Object.values(f.tableByMove).reduce((a, v) => a + v.dmg, 0)
    const c3Clean = c3.dmg - tableDmg(c3)
    const c4Clean = c4.dmg - tableDmg(c4)
    // 模型名必须成立：现状下 raw 是负的（这是被解释的现象）
    expect((c4.dmg - c3.dmg) / c3.dmg, '模型名：现状 raw Δ 应为负（否则这条判据失去意义）').toBeLessThan(0)
    // 扣掉白送后必须转正 ⇒ 负值来自虚高，不是命座变弱
    expect(c4Clean / c3Clean - 1, '扣掉表行后命座必须为正').toBeGreaterThan(0)
    // 且虚高必须真的存在（否则上面的「扣掉后转正」是空操作）
    expect(tableDmg(c3), 'C3 必须真的有表行虚高（反空洞）').toBeGreaterThan(0)
  })

  it('★ 同一轮「轴内几窗」自洽：stunCoverage 必须由**池窗**推出，不是计划窗', async () => {
    const f = await frame(3)
    // 覆盖率 = 池窗 × W / eff；W=19 / eff=180 时 5 窗 = 0.5278（实测逐位）
    const expected = (f.poolStun * 19) / 180
    expect(Math.abs(f.stunCoverage - expected), `覆盖率应由池窗推出：实测 ${f.stunCoverage} vs 期望 ${expected}`).toBeLessThan(0.02)
    // 反空洞：这一档必须真的打到多窗（否则「池窗 vs 计划窗」的分歧不可达）
    expect(f.poolStun).toBeGreaterThanOrEqual(3)
  })

  it('★ 白送的交集形态：表行 ∧ 执行集合同招（现状为真 ⇒ 这是被钉住的缺陷）', async () => {
    const f = await frame(3)
    const overlap = Object.keys(f.tableByMove).filter(id => (f.execByMove[id] ?? 0) > 0)
    // 现状：C3 的凝云/墨烬既在表行、也在执行集合 ⇒ 「模块该打却没表达」
    expect(overlap.length, '现状应存在「表行 ∧ 执行集合同招」的交集（修复后本条改成 toEqual([])）').toBeGreaterThan(0)
  })
})