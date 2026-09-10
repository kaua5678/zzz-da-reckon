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
    const notConverged: { id: string; passes: number; residual: number; idle: number; refund: number; exit: string; slack: number }[] = []

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
      const tbConvFalseThis = conv?.timeBudgetConverged === false
      if (tbConvFalseThis) tbConvFalse++
      if ((conv?.timeBudgetRefundedSeconds ?? 0) > 0) refundTeams++
      if ((conv?.timeBudgetResidualSeconds ?? 0) > 1) residualTeams++
      const t = buildTeamTimeSummary({
        rr, battleTime: rr.totalTime,
        invincibleTime: config.enemy.invincibleTime ?? 0,
        nameOf: (_a, slot) => `槽${slot}`,
      })
      sumSlack += Math.max(0, t.slack)
      sumOver += Math.max(0, -t.slack)
      if (tbConvFalseThis) {
        notConverged.push({
          id: p.id, passes, residual: conv?.timeBudgetResidualSeconds ?? 0,
          idle: conv?.timeBudgetIdleSeconds ?? 0, refund: conv?.timeBudgetRefundedSeconds ?? 0,
          exit, slack: t.slack,
        })
      }
      worst.push({ id: p.id, slack: t.slack, over: Math.max(0, -t.slack), passes, exit, conv: conv?.timeBudgetConverged !== false })
    }

    // 失衡池内部对账（PROBE_STUN_TEAM=<预设id>）：攒条量/无效量/占比/贡献明细
    const stunTeam = process.env.PROBE_STUN_TEAM
    if (stunTeam) {
      const p = presets.find(x => x.id === stunTeam)
      if (p) {
        for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
        config.applyTeamPreset(p.team as [string, string, string])
        const rr = calc.resourceResult.value!
        const sp = calc.stunPoolResult.value as unknown as {
          stunCount: number; bossStunValue: number; grossStunBuildUp: number
          totalStunBuildUp: number; inAxisStunTotal: number
          contributions?: { slot: number; moveId: string; count: number; totalStun: number; inAxisFraction: number; effectiveStun: number }[]
        } | null
        if (sp) {
          const win = calc.windowDuration.value
          const eff = Math.max(1, rr.totalTime - (config.enemy.invincibleTime ?? 0))
          // eslint-disable-next-line no-console
          console.log(`[stun] ${stunTeam} 次数=${sp.stunCount} 窗长=${win.toFixed(2)}s 有效=${eff}s 占比=${(sp.stunCount * win / eff).toFixed(3)} boss阈值=${sp.bossStunValue}`)
          // eslint-disable-next-line no-console
          console.log(`[stun] 毛攒条=${sp.grossStunBuildUp.toFixed(0)} 窗内无效=${sp.inAxisStunTotal.toFixed(0)} 有效=${sp.totalStunBuildUp.toFixed(0)}（= ${(sp.totalStunBuildUp / Math.max(1, sp.bossStunValue)).toFixed(2)} 次阈值）`)
          const top = [...(sp.contributions ?? [])].filter(c => c.totalStun > 0)
            .sort((a, b) => b.totalStun - a.totalStun).slice(0, 10)
          // eslint-disable-next-line no-console
          console.log(`[stun] 贡献 top10：${top.map(c => `槽${c.slot}:${c.moveId}×${c.count.toFixed(1)} 总${c.totalStun.toFixed(0)} 窗内占比${(c.inAxisFraction * 100).toFixed(0)}% 有效${c.effectiveStun.toFixed(0)}`).join(' | ')}`)
        }
      }
    }
    worst.sort((a, b) => Math.max(b.slack, b.over) - Math.max(a.slack, a.over))
    // 失衡窗口时间占用比 = 次数 × 窗时长 / 有效战斗时间（>1 = 窗口本身装不进战斗时间）
    const winOcc: { id: string; ratio: number; stun: number; win: number; eff: number }[] = []
    for (const p of presets) {
      for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
      config.applyTeamPreset(p.team as [string, string, string])
      const rr = calc.resourceResult.value
      const sp = calc.stunPoolResult.value
      if (!rr || !sp) continue
      const win = calc.windowDuration.value
      const eff = Math.max(1, rr.totalTime - (config.enemy.invincibleTime ?? 0))
      winOcc.push({ id: p.id, ratio: (sp.stunCount * win) / eff, stun: sp.stunCount, win, eff })
    }
    winOcc.sort((a, b) => b.ratio - a.ratio)
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
      `失衡窗口时间占用 top5（次数×窗时长/有效时间）：${winOcc.slice(0, 5).map(w => `${w.id}=${w.ratio.toFixed(3)}(${w.stun}×${w.win.toFixed(0)}s/${w.eff}s)`).join(' ')}`,
      `窗口占用 >0.8 的队：${winOcc.filter(w => w.ratio > 0.8).length} ·  >1 的队：${winOcc.filter(w => w.ratio > 1).length}`,
      `不收敛队（${notConverged.length}）：`,
      ...notConverged.sort((a, b) => b.residual - a.residual)
        .map(n => `  ${n.id} passes=${n.passes} residual=${n.residual.toFixed(3)} idle=${n.idle.toFixed(2)} refund=${n.refund.toFixed(2)} slack=${n.slack.toFixed(2)} exit=${n.exit}`),
    ]
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))
  }, 900_000)
})
