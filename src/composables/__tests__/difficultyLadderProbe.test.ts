/**
 * 探针：逐目标贪心阶梯 / 难度曲线（**跑 UI 同款口径**：`composables/difficultyCurve.ts`
 * → 预设基础档（静态权重/交互）+ 最新期数 Boss + 静态权重分配；不含 buff/加金/自动下位）。
 *
 * 用户 2026-09-10 口径：「每个队伍的 x 不一定对齐，他是根据最优化算法提升操作难度的同时提升伤害」。
 *
 * 运行：
 *   PROBE_DIFF_LADDER=1 npx vitest run src/composables/__tests__/difficultyLadderProbe.test.ts
 *   PROBE_DIFF_LADDER=1 PROBE_DIFF_TEAMS=auto-1431-1341-1311,banyue-norma-lucia npx vitest run ...
 *   PROBE_DIFF_LADDER=1 PROBE_DIFF_ALL=1 npx vitest run ...   # 全 127 预设（慢，每队约 3~4s）
 * 不设 env 时空跑（普通 vitest run 不受影响）。
 *
 * ⚠️ 口径变更留痕（2026-09-10 晚，接 UI）：本探针此前直接用 `climbDifficultyLadder` 的**缺省基线**
 * （`applyTeamPreset` = agent 默认权重、无 Boss）⇒ 与页面看到的曲线**不是同一组数**。
 * 现在改成走 `computeDifficultyCurves`，探针数字 = 页面数字（页面口径的单源就是它）。
 */
import { readFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { buildCurveChart, computeDifficultyCurves } from '@/composables/difficultyCurve'
import { summarizeLadder } from '@/composables/difficultyLadder'
import type { BossPreset, BossPresetFile, BossPresetPhase } from '@/types/bossPreset'

const active = process.env.PROBE_DIFF_LADDER === '1'
const TEAM_IDS = (process.env.PROBE_DIFF_TEAMS ?? '').split(',').map(s => s.trim()).filter(Boolean)
const ALL = process.env.PROBE_DIFF_ALL === '1'
const DUMP_COUNTS = process.env.PROBE_DIFF_COUNTS_DUMP === '1'

const SAMPLE = [
  'auto-1521-1361-1311', 'auto-1311-1521-1361', 'auto-1521-1481-1311', 'auto-1461-1521-1031',
  'auto-1431-1341-1311', 'banyue-norma-lucia', 'auto-1471-1571-1451',
  'auto-1041-1571-1031', 'auto-1531-1451-1481', 'auto-1221-1511-1211',
  'auto-1501-1511-1311', 'yixuan-jufufu-lucia',
]

const BOSS_FILE = JSON.parse(
  readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8'),
) as BossPresetFile

/** 页面默认口径近似：最新期数（begin 最大）的危局 Boss（无危局则取该 Boss 第一个 phase） */
function latestBossPhase(): { boss: BossPreset; phase: BossPresetPhase } {
  const pairs: { boss: BossPreset; phase: BossPresetPhase }[] = []
  for (const boss of BOSS_FILE.bosses) {
    const ca = boss.phases.find(p => p.modeType === 'critical_assault')
    const phase = ca ?? boss.phases[0]
    if (phase) pairs.push({ boss, phase })
  }
  pairs.sort((a, b) => (b.phase.begin || b.phase.phaseId).localeCompare(a.phase.begin || a.phase.phaseId))
  return pairs[0]!
}

/** 把曲线点上的跃迁压成一行：`难度3: 大招 2→3、紊乱 1→2` */
function describeCountChanges(points: { cost: number; changes: { label: string; from: number; to: number }[] }[]): string {
  const steps = points
    .slice(1)
    .filter(p => p.changes.length > 0)
    .map(p => `难度${p.cost}: ${p.changes.map(c => `${c.label} ${c.from}→${c.to}`).join('、')}`)
  return steps.length > 0 ? steps.join(' | ') : '(无关键次数跃迁)'
}

describe.runIf(active)('探针：逐目标贪心阶梯（每队自己的难度曲线）', () => {
  it('扫描并打印每队曲线', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const { boss, phase } = latestBossPhase()
    const context = `Boss ${boss.name}(${boss.id}) · 期数 ${phase.label}(${phase.phaseId}) · hp ${(phase.hp / 1e4).toFixed(0)}万`

    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    const targets = ALL ? presets
      : (TEAM_IDS.length > 0 ? presets.filter(p => TEAM_IDS.includes(p.id)) : presets.filter(p => SAMPLE.includes(p.id)))

    const rows: string[] = []
    for (const p of targets) {
      const [row] = computeDifficultyCurves(calc, { presets: [p], boss, phase })
      const r = row!.ladder
      const s = summarizeLadder(r)
      rows.push([
        `${p.id}: ${(s.base / 1e6).toFixed(1)}M → ${(s.final / 1e6).toFixed(1)}M (+${s.gainPct.toFixed(1)}%)`
        + ` · ${(s.final / s.base).toFixed(2)}× · 难度 ${s.totalCost} 点 · 斜率 ${s.slope.toFixed(1)}%/点`,
        `  录取 ${r.opened.join('→') || '(无优化空间)'}${r.dropped.length ? ` · 丢弃 ${r.dropped.map(d => `${d.id}(${(d.gain / 1e6).toFixed(1)}M)`).join(',')}` : ''}`,
        `  点 ${r.points.map(pt => `(${pt.x},${(pt.dmg / 1e6).toFixed(1)})`).join(' ')}`,
        // 关键次数跃迁（用户口径：难度上升到关键变化要标注）——按「这一档相对上一档变多了什么」列
        `  关键变化 ${describeCountChanges(buildCurveChart([row!], phase.hp).series[0]!.points)}`,
        // 全关档的全部关键次数快照（诊断「某角色的专属项为什么没被采到」）
        ...(DUMP_COUNTS
          ? [`  全关快照 ${Object.entries(r.points[0]?.counts ?? {}).map(([k, v]) => `${k}=${String(v)}`).join('、')}`]
          : []),
      ].join('\n'))
    }

    // eslint-disable-next-line no-console
    console.log(`口径：${context}\n目标代价 G1=1 G2=3 G3=2 G4=0（占位）· 录取门槛 = Δ > max(0, 全关×1e-4)\n${rows.join('\n')}`)
  }, 1_800_000)
})
