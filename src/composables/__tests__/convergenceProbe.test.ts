/**
 * 收敛体检探针（阶段2「单一残差 + τ 单调求解」立项前的**度量**，2026-09-10）。
 *
 * 目的：阶段2 要替换「pass0 refund 冻结 + 折半试探」这套补丁式收敛。立项前先量清楚
 * 现状的痛点面：多少队 `timeBudgetConverged=false`、外层退出方式分布、折叠轮数分布、
 * 残差/留白量级、以及「欠打回填试探」实际命中的队数。
 *
 * 运行：PROBE_CONV_SCAN=1 npx vitest run src/composables/__tests__/convergenceProbe.test.ts
 * 不设 env 时空跑（普通 vitest run 不受影响）。
 *
 * 第二用途（2026-09-10，尾巴专项）：`PROBE_CONV_TEAM=<预设id,...>` 逐队对照三读数——
 * 冷跑 / 同队热跑 / 换队后回来。用来区分「扫描报的收敛量」是**队内禀**还是**管线口径**
 * （`ConvergenceReport` 的五个字段分别由折叠环 / 规范重跑 / 比利重推 / 欠打回填试探 /
 * 编排层降配探测写入，见 `core/resource.ts` 与 `useResourceCalc.ts` 注释）。
 *   PROBE_CONV_TEAM=billy-roxy-lucia npx vitest run src/composables/__tests__/convergenceProbe.test.ts
 */
import { describe, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { buildTeamTimeSummary } from '@/composables/teamTimeSummary'
import { isFrontlineExecution } from '@/types/resource'

const active = process.env.PROBE_CONV_SCAN === '1'
const teamIds = (process.env.PROBE_CONV_TEAM ?? '').split(',').map(s => s.trim()).filter(Boolean)

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

/**
 * 单队三读数对照（尾巴专项）：同一队 冷跑 / 同队热跑 / 换队回来 三次读 `ConvergenceReport`，
 * 外加「装配后逐槽 行净占用 vs 账本」重算——用来判定报告里的 residual/idle/refund
 * 各自出自哪条管线（折叠环 vs 比利重推 vs 欠打回填试探 vs 编排层降配探测）。
 */
describe.runIf(teamIds.length > 0)('探针：单队收敛报告口径', () => {
  it('冷/热/换队回来 三读数 + 装配后逐槽重算', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const lines: string[] = []
    const f = (n: number | undefined | null, d = 3) => (n ?? 0).toFixed(d)
    // 多管线轨迹（需 PROBE_TRACE_FOLD=1 让 core 侧推入；每个快照打印「自上次以来」的调用序列）
    let traceMark = 0
    const drainTrace = (tag: string) => {
      const g = globalThis as unknown as { __foldTrace?: Record<string, number | boolean | string>[] }
      const all = g.__foldTrace ?? []
      const fresh = all.slice(traceMark)
      traceMark = all.length
      if (fresh.length === 0) { lines.push(`  [管线] ${tag}：无 calcTeamResources 调用记录（未设 PROBE_TRACE_FOLD=1？）`); return }
      lines.push(`  [管线] ${tag}：${fresh.length} 次调用`)
      fresh.forEach((t, i) => lines.push(`    #${i} ${String(t.team)} passes=${t.passes} tbConv=${t.conv} residual=${f(Number(t.residual))} idle=${f(Number(t.idle))} refund=${f(Number(t.refund))} 截断=${f(Number(t.truncated))}`))
      // 逐轮残差轨迹（按调用分组；缺 pass0 = 冻结 refund 那轮 `continue` 跳过尾部记录）
      const gp = globalThis as unknown as { __foldPasses?: Record<string, number | boolean>[] }
      const passes = gp.__foldPasses ?? []
      const byCall = new Map<number, Record<string, number | boolean>[]>()
      for (const r of passes) {
        const k = Number(r.call)
        if (!byCall.has(k)) byCall.set(k, [])
        byCall.get(k)!.push(r)
      }
      const base = traceMark - fresh.length
      for (const k of [...byCall.keys()].sort((a, b) => a - b)) {
        if (k < base || k >= traceMark) continue
        const rs = byCall.get(k)!
        lines.push(`    ↳ #${k} 残差轨迹=[${rs.map(r => f(Number(r.maxExcess))).join(' → ')}] 判据停滞计数=[${rs.map(r => r.stagnant).join(',')}] conv=${rs[rs.length - 1]?.conv}`)
      }
    }

    const snapshot = (id: string, tag: string) => {
      const rr = calc.resourceResult.value
      if (!rr) { lines.push(`### ${id} 【${tag}】 ← 无结果`); return }
      const c = rr.convergence
      const t = buildTeamTimeSummary({
        rr, battleTime: rr.totalTime,
        invincibleTime: config.enemy.invincibleTime ?? 0,
        nameOf: (_a, slot) => `槽${slot}`,
      })
      lines.push(`\n---- ${id} 【${tag}】`)
      lines.push(`residual=${f(c?.timeBudgetResidualSeconds)} idle=${f(c?.timeBudgetIdleSeconds)} refund=${f(c?.timeBudgetRefundedSeconds)} passes=${c?.timeBudgetPasses} tbConv=${c?.timeBudgetConverged} exit=${c?.outerExit ?? '—'} outerRounds=${c?.outerRounds ?? '—'} outerConverged=${c?.outerConverged ?? '—'} axisFallback=${c?.axisFallback ?? '—'} interactionScale=${c?.interactionScale == null ? '—' : f(c.interactionScale)}`)
      lines.push(`slack=${f(t.slack)} over=${f(Math.max(0, -t.slack))} totalTime=${rr.totalTime} 失衡=${calc.stunPoolResult.value?.stunCount ?? '—'} 截断=${f(c?.timeTruncatedSeconds)}`)
      // 装配后逐槽重算（与 frontlineRowsOf 同式：行全额 − 该行合轴分摊，只计前台行；
      // 差 = 装配态下该槽「行净占用 − 账本」，正 = 超账本、负 = 欠打）
      const overlap = rr.axisOverlapByAction ?? {}
      for (const ch of rr.characters) {
        const netRows = (ch.executions ?? []).reduce((s, e) =>
          s + Math.max(0, (e.totalTime ?? 0) - (overlap[`${ch.slot}:${e.moveId}`] ?? 0)) * (isFrontlineExecution(e) ? 1 : 0), 0)
        const ledger = ch.timeAllocation.necessaryTime + ch.timeAllocation.basicAttackTime
        const giftRows = (ch.executions ?? []).filter(e => e.source === 'gift')
        lines.push(`  槽${ch.slot}(${ch.agentId}) 账本=${f(ledger, 2)} 装配净行=${f(netRows, 2)} 差=${f(netRows - ledger)} 前台上限=${f(ch.timeAllocation.frontlineTime, 2)} 赠行=${giftRows.length} 行数=${(ch.executions ?? []).length}`)
      }
      drainTrace(tag)
    }

    const apply = (team: string[]) => {
      for (let i = 0; i < 3; i++) config.setAgent(i, team[i])
      config.applyTeamPreset(team as [string, string, string])
    }

    for (const id of teamIds) {
      const p = teamPresets.find(x => x.id === id)
      if (!p) { lines.push(`### ${id} ← 预设未命中`); continue }
      apply(p.team as string[])
      snapshot(id, '冷跑（本进程首次）')
      apply(p.team as string[])
      snapshot(id, '同队热跑（紧接第二次）')
      const other = teamPresets.find(x => x.id !== id && Array.isArray(x.team) && x.team.length === 3)
      if (other) {
        apply(other.team as string[])
        apply(p.team as string[])
        snapshot(id, `换队回来（先跑 ${other.id}）`)
      }
    }
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))
  }, 900_000)
})
