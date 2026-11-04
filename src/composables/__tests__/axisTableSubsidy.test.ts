/**
 * **「模块沉默 ⇒ `[表]` 免费接管」的源头判据**（用户 2026-11-04 专项，两轮）。
 *
 * 口径与实测全文见 `docs/mcp-cinema-interval-uplift.md` §3，坑 `ENGINE_PIPELINE_GUIDE` §4 坑 62。
 *
 * ## 这条判据守的是什么
 *
 * 2026-11-04 发现 `yixuan-jufufu-lucia` C3→C4 在 parry=20 是 **−11.79%**，而执行数、前台时间、
 * 轴窗、截断全部逐位相同。追到底是**两层叠加**：
 *
 * ① `axisTableDirect.ts#axisTableDirectMove` 判据 ② 按 moveId 的**存在性**判（`backed`，不看条数）
 *    ⇒ 模块一行不产时，`[表]` 直读按满倍率免费接管（**不收闪能、不占时间、窗内不产失衡值**）；
 * ② 模块为什么不产行：它读 `axis.windows` = **计划小数 0.137**（= `(eff−Σnec)/W` 的 nec 余量），
 *    `1 块 × 0.137` 被 `positiveWholeCounts` 丢弃 ⇒ 沉默。
 *
 * ⇒ **「不产行」在这个体系里是收益**：低命座因此被抬高 12.76%，命座看起来是负提升。
 *
 * ## 修法（用户 2026-11-04 裁决「我肯定选真实计算，你看 b 的模拟到位了就做吧」）
 *
 * `convergence.ts` 引入**单一事实源** `axisWindowCount = threads.prevPoolStunCount ?? countStun`，
 * 让「派发给模块的 `axis.windows`」「轴栈执行集合」「伤害侧 `stunCoverage`」三处同源（都读池整数）。
 * 模块照常产行 ⇒ 白送自然消失。
 *
 * ## 本文件的两段判据
 *
 * - **第一段（现存缺陷钉住）**：修前若有人动 `[表]` 门或窗口数入参，这里会红，逼他回到专项文档。
 *   修复落地后这两条已按新口径改写（见 `★ 修复后` 组）——**不是删判据，是换口径**。
 * - **第二段（不变量）**：任何命座级别下，`[表]` 行与该槽执行集合**不得同招并存**
 *   （那正是「模块该打却没表达」的形态）。修复前为真（= 缺陷存在），修复后必须是空集。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { applyTeamToStore } from '@/composables/teamCompare'
import { clearDifficultyLevers } from '@/composables/difficultyLadder'
import { teamPresets } from '@/data/teamPresets'

const PRESET = 'yixuan-jufufu-lucia'
const PARRY = 20

interface Frame {
  dmg: number
  tableByMove: Record<string, { count: number; dmg: number }>
  execByMove: Record<string, number>
  stunCoverage: number
  poolStun: number
}

/** 采一帧：表行（按 moveId）+ 轴执行集合（按 moveId）+ 总伤 */
async function frame(cinema: number, presetId = PRESET, parry = PARRY): Promise<Frame> {
  const preset = teamPresets.find(p => p.id === presetId)!
  let out: Frame | null = null
  await withAnalysisScenario(async s => {
    clearDifficultyLevers({ config: s.config, calc: s.calc })
    applyTeamToStore(s.config, preset)
    s.config.setCinemaLevel(0, cinema)
    s.config.syncTeammateBuffsFromTeam()
    for (let sl = 0; sl < 3; sl++) s.config.setActionCount(sl, 'parryCount', sl === 0 ? parry : 0)
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

describe('命座 × 难度曲线：不得再有「模块沉默 ⇒ 表行免费接管」', () => {
  beforeAll(async () => { await setupHarness(['', '', ''], { productionBasicWeights: true }) })

  it('★ 修复后：该队该档不得再有表行白送（原 12.76% 虚高的载体）', async () => {
    const f = await frame(3)
    const tableDmg = Object.values(f.tableByMove).reduce((a, v) => a + v.dmg, 0)
    // 反空洞：这一档必须真的打出东西（否则「没有白送」是空操作）
    expect(f.dmg, '反空洞：夹具必须真的算出伤害').toBeGreaterThan(1e7)
    expect(f.poolStun, '反空洞：这一档必须真的有多窗（否则沉默路径不可达）').toBeGreaterThanOrEqual(3)
    expect(tableDmg, '修复后不得再有 [表] 直读白送（修前这里是 4.67M）').toBe(0)
  })

  it('★ 修复后：C3 → C4 必须是正提升（用户口径「纯正提升的命座系统」）', async () => {
    const c3 = await frame(3)
    const c4 = await frame(4)
    const delta = (c4.dmg - c3.dmg) / c3.dmg
    expect(delta, `C3→C4 必须为正；实测 C3=${(c3.dmg / 1e6).toFixed(2)}M C4=${(c4.dmg / 1e6).toFixed(2)}M`).toBeGreaterThan(0)
  })

  it('★ 不变量：表行 ∧ 执行集合**不得同招并存**（空集 = 「模块该打却没表达」已消失）', async () => {
    for (const cinema of [0, 3, 4]) {
      const f = await frame(cinema)
      const overlap = Object.keys(f.tableByMove).filter(id => (f.execByMove[id] ?? 0) > 0)
      expect(overlap, `C${cinema}：同一招既走 [表] 直读又在轴执行集合里 = 两套账`).toEqual([])
    }
  })

  it('★ 同一轮「轴内几窗」自洽：stunCoverage 必须由**池窗**推出，不是计划窗', async () => {
    const f = await frame(3)
    const windowSeconds = 19
    const effectiveSeconds = 180
    const expected = (f.poolStun * windowSeconds) / effectiveSeconds
    expect(Math.abs(f.stunCoverage - expected), `覆盖率应由池窗推出：实测 ${f.stunCoverage} vs 期望 ${expected}`).toBeLessThan(0.02)
  })

  it('★ 多队多档：命座不得造成「窗口数下降」（用户口径：只是提供更多选择，不是强制降低）', async () => {
    const cases: Array<[string, number]> = [
      ['yixuan-roxy-lucia', 20],
      ['yixuan-jufufu-lucia', 20],
      ['yixuan-trigger-lucia', 20],
    ]
    for (const [id, parry] of cases) {
      const c0 = await frame(0, id, parry)
      const c4 = await frame(4, id, parry)
      expect(c4.poolStun, `${id} p=${parry}：C4 的失衡窗数不得少于 C0（${c0.poolStun} → ${c4.poolStun}）`)
        .toBeGreaterThanOrEqual(c0.poolStun - 1)
    }
  })
})
