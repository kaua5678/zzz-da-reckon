/**
 * 探针：逐目标贪心阶梯（调用真模块 `composables/difficultyLadder.ts`，本文件只做扫描与打印）。
 *
 * 用户 2026-09-10 口径：「每个队伍的 x 不一定对齐，他是根据最优化算法提升操作难度的同时提升伤害」。
 *
 * 运行：
 *   PROBE_DIFF_LADDER=1 npx vitest run src/composables/__tests__/difficultyLadderProbe.test.ts
 *   PROBE_DIFF_LADDER=1 PROBE_DIFF_TEAMS=auto-1431-1341-1311,banyue-norma-lucia npx vitest run ...
 *   PROBE_DIFF_LADDER=1 PROBE_DIFF_ALL=1 npx vitest run ...   # 全 127 预设（慢）
 * 不设 env 时空跑（普通 vitest run 不受影响）。
 */
import { describe, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { climbDifficultyLadder, summarizeLadder } from '@/composables/difficultyLadder'

const active = process.env.PROBE_DIFF_LADDER === '1'
const TEAM_IDS = (process.env.PROBE_DIFF_TEAMS ?? '').split(',').map(s => s.trim()).filter(Boolean)
const ALL = process.env.PROBE_DIFF_ALL === '1'

const SAMPLE = [
  'auto-1521-1361-1311', 'auto-1311-1521-1361', 'auto-1521-1481-1311', 'auto-1461-1521-1031',
  'auto-1431-1341-1311', 'banyue-norma-lucia', 'auto-1471-1571-1451',
  'auto-1041-1571-1031', 'auto-1531-1451-1481', 'auto-1221-1511-1211',
  'auto-1501-1511-1311', 'yixuan-jufufu-lucia',
]

describe.runIf(active)('探针：逐目标贪心阶梯（每队自己的难度曲线）', () => {
  it('扫描并打印每队曲线', async () => {
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const ctx = { config, calc }

    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    const targets = ALL ? presets
      : (TEAM_IDS.length > 0 ? presets.filter(p => TEAM_IDS.includes(p.id)) : presets.filter(p => SAMPLE.includes(p.id)))

    const rows: string[] = []
    for (const p of targets) {
      const r = climbDifficultyLadder(ctx, p.team as [string, string, string])
      const s = summarizeLadder(r)
      rows.push([
        `${p.id}: ${(s.base / 1e6).toFixed(1)}M → ${(s.final / 1e6).toFixed(1)}M (+${s.gainPct.toFixed(1)}%)`
        + ` · 难度 ${s.totalCost} 点 · 斜率 ${s.slope.toFixed(1)}%/点`,
        `  录取 ${r.opened.join('→') || '(无)'}${r.dropped.length ? ` · 丢弃 ${r.dropped.map(d => `${d.id}(${(d.gain / 1e6).toFixed(1)}M)`).join(',')}` : ''}`,
        `  点 ${r.points.map(pt => `(${pt.x},${(pt.dmg / 1e6).toFixed(1)})`).join(' ')}`,
      ].join('\n'))
    }

    // eslint-disable-next-line no-console
    console.log(`目标代价 G1=1 G2=3 G3=2 G4=0（占位口径）· 只录取 Δ≥0\n${rows.join('\n')}`)
  }, 900_000)
})
