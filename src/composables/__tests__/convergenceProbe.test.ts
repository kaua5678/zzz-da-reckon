/**
 * 收敛体检探针（阶段2「单一残差 + τ 单调求解」立项前的**度量**，2026-09-10）。
 *
 * 目的：阶段2 要替换「pass0 refund 冻结 + 折半试探」这套补丁式收敛。立项前先量清楚
 * 现状的痛点面：多少队 `timeBudgetConverged=false`、外层退出方式分布、折叠轮数分布、
 * 残差/留白量级、以及「欠打回填试探」实际命中的队数。
 *
 * 运行：PROBE_CONV_SCAN=1 npx vitest run src/composables/__tests__/convergenceProbe.test.ts
 * 不设 env 时空跑（普通 vitest run 不受影响）。
 */
import { describe, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { buildTeamTimeSummary } from '@/composables/teamTimeSummary'

const active = process.env.PROBE_CONV_SCAN === '1'

describe.runIf(active)('探针：收敛体检（阶段2 立项度量）', () => {
  it('全预设扫描：收敛态分布', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)

    const outerExit: Record<string, number> = {}
    const passesHist: Record<number, number> = {}
    let tbConvFalse = 0
    let refundTeams = 0
    let residualTeams = 0
    let sumSlack = 0
    let sumOver = 0
    const worst: { id: string; slack: number; over: number; passes: number; exit: string; conv: boolean }[] = []

    for (const p of presets) {
      for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
      config.applyTeamPreset(p.team as [string, string, string])
      const rr = calc.resourceResult.value
      if (!rr) continue
      const conv = rr.convergence
      const exit = conv?.outerExit ?? '—'
      outerExit[exit] = (outerExit[exit] ?? 0) + 1
      const passes = conv?.timeBudgetPasses ?? 0
      passesHist[passes] = (passesHist[passes] ?? 0) + 1
      if (conv?.timeBudgetConverged === false) tbConvFalse++
      if ((conv?.timeBudgetRefundedSeconds ?? 0) > 0) refundTeams++
      if ((conv?.timeBudgetResidualSeconds ?? 0) > 1) residualTeams++
      const t = buildTeamTimeSummary({
        rr, battleTime: rr.totalTime,
        invincibleTime: config.enemy.invincibleTime ?? 0,
        nameOf: (_a, slot) => `槽${slot}`,
      })
      sumSlack += Math.max(0, t.slack)
      sumOver += Math.max(0, -t.slack)
      worst.push({ id: p.id, slack: t.slack, over: Math.max(0, -t.slack), passes, exit, conv: conv?.timeBudgetConverged !== false })
    }

    worst.sort((a, b) => Math.max(b.slack, b.over) - Math.max(a.slack, a.over))
    const lines = [
      `预设数 ${presets.length}`,
      `outerExit 分布：${Object.entries(outerExit).map(([k, v]) => `${k}=${v}`).join(' ')}`,
      `timeBudgetConverged=false：${tbConvFalse} 队`,
      `refund>0（欠打回填命中）：${refundTeams} 队`,
      `残差 >1s：${residualTeams} 队`,
      `留白合计 ${sumSlack.toFixed(1)}s · 超预算合计 ${sumOver.toFixed(1)}s`,
      `折叠轮数分布：${Object.entries(passesHist).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => `${k}轮=${v}`).join(' ')}`,
      '最差 10 队：',
      ...worst.slice(0, 10).map(w => `  ${w.id} slack=${w.slack.toFixed(2)} over=${w.over.toFixed(2)} passes=${w.passes} exit=${w.exit} tbConv=${w.conv}`),
    ]
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))
  }, 900_000)
})
