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
import { optimizeTeamTimeWeights } from '@/composables/teamTimeline'
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

    // 平A池权重：默认（静态 0/1）vs 边际均衡（仓库自带 `optimizeTeamTimeWeights`，见 docs 坑35）
    const balance = process.env.PROBE_CONV_BALANCE === '1'

    for (const p of presets) {
      for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
      config.applyTeamPreset(p.team as [string, string, string])
      if (balance) optimizeTeamTimeWeights(calc, config, { maxIter: 2 })
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
      `留白合计 ${sumSlack.toFixed(1)}s · 超预算合计 ${sumOver.toFixed(1)}s · 权重模式=${balance ? '边际均衡（optimizeTeamTimeWeights maxIter=2）' : '默认静态'}`,
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
describe.runIf(teamIds.length > 0)('探针：单队收敛报告口径', () => {  it('冷/热/换队回来 三读数 + 装配后逐槽重算', async () => {
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
      // 逐槽账本明细（只打「被接受那次」= 报告读数所属调用的末轮三槽）
      const gs = globalThis as unknown as { __foldSlots?: Record<string, number | string>[] }
      const slots = (gs.__foldSlots ?? []).filter(s => Number(s.call) === traceMark - 1)
      if (slots.length > 0) {
        const last = slots.slice(-3)
        lines.push(`    ↳ 逐槽（末轮）：${last.map(s => `槽${s.slot}(${s.agent}) 行=${f(Number(s.rows), 2)} 账本=${f(Number(s.nec) + Number(s.basic), 2)}(nec ${f(Number(s.nec), 2)}+basic ${f(Number(s.basic), 2)}) 差=${f(Number(s.excess), 2)}`).join(' | ')}`)
      }
      // 逐行明细（env PROBE_CONV_ROWS=1；只打缺口最大的槽 = 留白来源）
      if (process.env.PROBE_CONV_ROWS === '1') {
        const rrRows = calc.resourceResult.value
        const worst = (rrRows?.characters ?? []).map(ch => ({
          ch,
          gap: (ch.executions ?? []).reduce((s, e) => s + Math.max(0, e.totalTime ?? 0) * (isFrontlineExecution(e) ? 1 : 0), 0)
            - (ch.timeAllocation.necessaryTime + ch.timeAllocation.basicAttackTime),
        })).sort((a, b) => a.gap - b.gap)[0]
        if (worst?.ch) {
          lines.push(`    ↳ 行明细 槽${worst.ch.slot}(${worst.ch.agentId}) ex=${worst.ch.exSpecialCount} ult=${worst.ch.ultimateCount} 账本nec=${f(worst.ch.timeAllocation.necessaryTime, 2)} basic=${f(worst.ch.timeAllocation.basicAttackTime, 2)}`)
          for (const e of worst.ch.executions ?? []) {
            lines.push(`       ${e.moveId} ×${f(e.count, 2)} 单次${f(e.actionTime, 3)} 计${f(e.totalTime, 2)} ${isFrontlineExecution(e) ? '前台' : '后台'}${e.source ? ` src=${e.source}` : ''}`)
          }
        }
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
      // 平A池权重扫描（env PROBE_CONV_WEIGHTS="3,2,1;0,2,1;…"）：证伪闸门——把池子从厚槽转给
      // 队友后留白是否下降。不降 = 该队本来就填不满 180s（留白是正确的），「按容量分配」无余量可赚。
      const patterns = (process.env.PROBE_CONV_WEIGHTS ?? '').split(';').map(s => s.trim()).filter(Boolean)
      for (const pat of patterns) {
        const w = pat.split(',').map(s => Number(s.trim()))
        if (w.length !== p.team.length || w.some(n => !Number.isFinite(n))) continue
        apply(p.team as string[])
        for (let i = 0; i < w.length; i++) {
          const slot = config.team[i] as { slot: number; agentId: string; basicAttackTimeWeight?: number } | undefined
          if (slot) slot.basicAttackTimeWeight = w[i]
        }
        snapshot(id, `权重 ${pat}`)
      }
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

/**
 * 平A池分配的杠杆度量（2026-09-10，阶段4 尾巴）：留白到底是「求解器补丁」问题还是「池分配」问题？
 * 逐个预设比较 默认权重 vs 把某个槽的 `basicAttackTimeWeight` 置 0 后的留白——纯测量、不改引擎。
 *   PROBE_CONV_WEIGHTS_SWEEP=1 npx vitest run src/composables/__tests__/convergenceProbe.test.ts
 */
describe.runIf(process.env.PROBE_CONV_WEIGHTS_SWEEP === '1')('探针：平A池权重的留白杠杆', () => {
  it('逐队 默认 vs 单槽置零 的留白对照', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    const f = (n: number) => n.toFixed(2)
    const slackOf = (id: string) => {
      const rr = calc.resourceResult.value
      if (!rr) return null
      const t = buildTeamTimeSummary({
        rr, battleTime: rr.totalTime,
        invincibleTime: config.enemy.invincibleTime ?? 0,
        nameOf: (_a, slot) => `槽${slot}`,
      })
      return { slack: t.slack, rr, id, dmg: calc.teamTotalDamage.value }
    }
    const rows: { id: string; base: number; best: number; bestLabel: string; over: number; baseDmg: number; bestDmg: number }[] = []
    for (const p of presets) {
      for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
      config.applyTeamPreset(p.team as [string, string, string])
      const base = slackOf(p.id)
      if (!base) continue
      let best = base.slack
      let bestLabel = '默认'
      let bestOver = Math.max(0, -base.slack)
      let bestDmg = base.dmg
      for (let zero = 0; zero < 3; zero++) {
        for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
        config.applyTeamPreset(p.team as [string, string, string])
        const slot = config.team[zero] as { basicAttackTimeWeight?: number } | undefined
        if (slot) slot.basicAttackTimeWeight = 0
        const got = slackOf(p.id)
        if (!got) continue
        if (got.slack < best) { best = got.slack; bestLabel = `槽${zero}权重0`; bestDmg = got.dmg }
        bestOver = Math.max(bestOver, Math.max(0, -got.slack))
      }
      rows.push({ id: p.id, base: base.slack, best, bestLabel, over: bestOver, baseDmg: base.dmg, bestDmg })
    }
    const sumBase = rows.reduce((a, r) => a + Math.max(0, r.base), 0)
    const sumBest = rows.reduce((a, r) => a + Math.max(0, r.best), 0)
    const improved = rows.filter(r => r.base > r.best + 0.05).sort((a, b) => (a.best - a.base) - (b.best - b.base))
    const lines = [
      `预设数 ${rows.length}`,
      `留白合计：默认 ${f(sumBase)}s → 逐队「单槽权重置零」最优 ${f(sumBest)}s（差 ${f(sumBase - sumBest)}s）`,
      `可改善队数 ${improved.length}`,
      '改善 top15：',
      ...improved.slice(0, 15).map(r => `  ${r.id} 留白 ${f(r.base)} → ${f(r.best)}（${r.bestLabel}，${f(r.best - r.base)}s）伤害 ${(r.baseDmg / 1e6).toFixed(1)}M → ${(r.bestDmg / 1e6).toFixed(1)}M（${((r.bestDmg / Math.max(1, r.baseDmg) - 1) * 100).toFixed(1)}%）超预算上界 ${f(r.over)}`),
    ]
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))
  }, 900_000)
})

/**
 * 边际均衡的**成本**与**主C能量约束**实测（2026-09-10）：
 * ① 逐队计时 `optimizeTeamTimeWeights`（对照：不均衡时一次全队求值 ≈ 0.17s，见全库扫描 21.5s/127 队）；
 * ② 对照三态下**主C（槽0）**的能量/强特次数——验证「主C 失衡期能量需求必须靠平A池时间」这条约束
 *    在引擎里是否成立（若成立，则「把槽0权重压 0 降留白」就是在饿死主C的爆发能量）。
 *   PROBE_CONV_BALANCE_COST=1 npx vitest run src/composables/__tests__/convergenceProbe.test.ts
 */
describe.runIf(process.env.PROBE_CONV_BALANCE_COST === '1')('探针：边际均衡成本 + 主C能量约束', () => {
  it('逐队计时 + 三态对照（默认 / 均衡 / 槽0权重0）', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    const f = (n: number | undefined, d = 1) => (n ?? 0).toFixed(d)
    const apply = (team: string[]) => {
      for (let i = 0; i < 3; i++) config.setAgent(i, team[i])
      config.applyTeamPreset(team as [string, string, string])
    }
    const snap = () => {
      const rr = calc.resourceResult.value
      const c0 = rr?.characters?.[0]
      return {
        dmg: calc.teamTotalDamage.value,
        ex0: c0?.exSpecialCount ?? 0,
        basic0: c0?.timeAllocation?.basicAttackTime ?? 0,
        dmg0: c0?.timeAllocation?.necessaryTime ?? 0,
      }
    }
    const costs: number[] = []
    let sumEvalCost = 0
    let baseCostSum = 0
    const detail: string[] = []
    for (const p of presets) {
      apply(p.team as string[])
      const t0 = Date.now()
      void calc.resourceResult.value
      const baseMs = Date.now() - t0
      baseCostSum += baseMs
      const a = snap()
      const t1 = Date.now()
      optimizeTeamTimeWeights(calc, config, { maxIter: 2 })
      const balMs = Date.now() - t1
      costs.push(balMs)
      sumEvalCost += balMs
      const b = snap()
      apply(p.team as string[])
      const slot0 = config.team[0] as { basicAttackTimeWeight?: number } | undefined
      if (slot0) slot0.basicAttackTimeWeight = 0
      const c = snap()
      if (p.id.startsWith('auto-1191') || p.id.startsWith('auto-1401') || p.id === 'billy-liuyin-lucia' || p.id === 'auto-1181-1511-1411') {
        detail.push(`  ${p.id} 默认 dmg=${(a.dmg / 1e6).toFixed(1)}M ex0=${f(a.ex0)} bat0=${f(a.basic0)}s 留白→ 均衡 dmg=${(b.dmg / 1e6).toFixed(1)}M ex0=${f(b.ex0)}（${balMs}ms）→ 槽0权重0 dmg=${(c.dmg / 1e6).toFixed(1)}M ex0=${f(c.ex0)} bat0=${f(c.basic0)}s`)
      }
    }
    costs.sort((x, y) => x - y)
    const lines = [
      `预设数 ${presets.length}`,
      `一次全队求值（不均衡）平均 ${f(baseCostSum / presets.length)}ms —— 作为「一次 evaluate」的成本基准`,
      `边际均衡（maxIter=2）每队：均值 ${f(sumEvalCost / presets.length)}ms · 中位 ${costs[Math.floor(costs.length / 2)]}ms · p90 ${costs[Math.floor(costs.length * 0.9)]}ms · 最大 ${costs[costs.length - 1]}ms`,
      `→ 折算 evaluate 次数 ≈ ${f((sumEvalCost / presets.length) / Math.max(0.01, baseCostSum / presets.length))} 次/队（均衡器是坐标上升：每轮每槽 ~2 次有限差分）`,
      '主C（槽0）三态对照：',
      ...detail,
    ]
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))
  }, 900_000)
})

/**
 * 边际均衡的**价值**度量（2026-09-10）：默认权重（强攻/异常/击破=1、支援/防护=0）是否给主C 分够了平A？
 * 逐队对照 默认 vs 边际均衡：团队总伤 / 主C 平A池时间 / 主C 强特次数 / 留白 / 超预算。
 *   PROBE_CONV_BALANCE_VALUE=1 npx vitest run src/composables/__tests__/convergenceProbe.test.ts
 */
describe.runIf(process.env.PROBE_CONV_BALANCE_VALUE === '1')('探针：边际均衡的价值（主C 平A/能量）', () => {
  it('逐队 默认 vs 均衡', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    const f = (n: number | undefined, d = 1) => (n ?? 0).toFixed(d)
    const apply = (team: string[]) => {
      for (let i = 0; i < 3; i++) config.setAgent(i, team[i])
      config.applyTeamPreset(team as [string, string, string])
    }
    const snap = () => {
      const rr = calc.resourceResult.value
      const t = rr ? buildTeamTimeSummary({ rr, battleTime: rr.totalTime, invincibleTime: config.enemy.invincibleTime ?? 0, nameOf: (_a, s) => `槽${s}` }) : null
      return {
        dmg: calc.teamTotalDamage.value,
        ex0: rr?.characters?.[0]?.exSpecialCount ?? 0,
        bat0: rr?.characters?.[0]?.timeAllocation?.basicAttackTime ?? 0,
        slack: t?.slack ?? 0,
        w: [0, 1, 2].map(s => Number(config.team[s]?.basicAttackTimeWeight ?? 0)),
      }
    }
    let sumBase = 0
    let sumBal = 0
    let improved = 0
    let unchanged = 0
    let moreBasic = 0
    const rows: { id: string; base: number; bal: number; ex0a: number; ex0b: number; bat0a: number; bat0b: number }[] = []
    for (const p of presets) {
      apply(p.team as string[])
      const a = snap()
      optimizeTeamTimeWeights(calc, config, { maxIter: 2 })
      const b = snap()
      sumBase += a.dmg
      sumBal += b.dmg
      if (b.dmg > a.dmg + 1) improved++
      else unchanged++
      if (b.bat0 > a.bat0 + 0.05) moreBasic++
      rows.push({ id: p.id, base: a.dmg, bal: b.dmg, ex0a: a.ex0, ex0b: b.ex0, bat0a: a.bat0, bat0b: b.bat0 })
    }
    const byGain = [...rows].sort((x, y) => (y.bal - y.base) - (x.bal - x.base))
    const lines = [
      `预设数 ${rows.length}`,
      `团队总伤合计：默认 ${(sumBase / 1e6).toFixed(0)}M → 均衡 ${(sumBal / 1e6).toFixed(0)}M（${((sumBal / Math.max(1, sumBase) - 1) * 100).toFixed(2)}%）`,
      `伤害提升队数 ${improved} · 无变化 ${unchanged} · 均衡后主C 平A池增加的队数 ${moreBasic}`,
      '增益 top10：',
      ...byGain.slice(0, 10).map(r => `  ${r.id} ${(r.base / 1e6).toFixed(1)}M → ${(r.bal / 1e6).toFixed(1)}M（${((r.bal / Math.max(1, r.base) - 1) * 100).toFixed(1)}%）主C 平A ${f(r.bat0a)}→${f(r.bat0b)}s 强特 ${f(r.ex0a)}→${f(r.ex0b)}`),
      '主C 平A 被削减最多的 5 队（均衡判定「给队友更值」）：',
      ...[...rows].sort((x, y) => (x.bat0b - x.bat0a) - (y.bat0b - y.bat0a)).slice(0, 5)
        .map(r => `  ${r.id} 平A ${f(r.bat0a)}→${f(r.bat0b)}s 强特 ${f(r.ex0a)}→${f(r.ex0b)} 伤害 ${((r.bal / Math.max(1, r.base) - 1) * 100).toFixed(1)}%`),
    ]
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))
  }, 900_000)
})

/**
 * 分配规则证伪闸门（2026-09-10，用户口径）：击破位拿「刚好打满失衡次数」的量，其余全给主C。
 * 做法：固定主C 权重=1、支援=0，**只扫击破位权重**，看 失衡次数 / 总伤 / 两槽平A时间 怎么变。
 * 若「超过打满次数的击破位时间」确实一分不值（伤害不再上升），用户规则与伤害曲面同构。
 *   PROBE_CONV_GRID=auto-1521-1361-1311,auto-1501-1511-1311 npx vitest run …convergenceProbe
 */
describe.runIf(!!process.env.PROBE_CONV_GRID)('探针：击破位时间扫描（分配规则闸门）', () => {
  it('逐队扫击破位权重', async () => {
    const ids = (process.env.PROBE_CONV_GRID ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const lines: string[] = []
    for (const id of ids) {
      const p = teamPresets.find(x => x.id === id)
      if (!p) { lines.push(`### ${id} ← 预设未命中`); continue }
      const { catalog } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const config = useConfigStore()
      const calc = useResourceCalc()
      lines.push(`\n---- ${id}（${p.name}）`)
      for (const w1 of [0, 0.5, 1, 2, 4, 8]) {
        for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
        config.applyTeamPreset(p.team as [string, string, string])
        const base = [0, 1, 2].map(s => Number(config.team[s]?.basicAttackTimeWeight ?? 0))
        for (const [s, w] of [[0, base[0] || 1], [1, w1], [2, 0]] as const) {
          const slot = config.team[s] as { basicAttackTimeWeight?: number } | undefined
          if (slot) slot.basicAttackTimeWeight = w
        }
        const rr = calc.resourceResult.value
        const t = rr ? buildTeamTimeSummary({ rr, battleTime: rr.totalTime, invincibleTime: config.enemy.invincibleTime ?? 0, nameOf: (_a, s) => `槽${s}` }) : null
        const stun = calc.stunPoolResult.value?.stunCount ?? 0
        const dmg = calc.teamTotalDamage.value
        const bat = (rr?.characters ?? []).map(c => c.timeAllocation.basicAttackTime)
        lines.push(`  击破位权重=${w1} → 失衡 ${stun} 次 · 总伤 ${(dmg / 1e6).toFixed(1)}M · 留白 ${(t?.slack ?? 0).toFixed(2)}s · 平A 主C ${(bat[0] ?? 0).toFixed(1)}s / 击破 ${(bat[1] ?? 0).toFixed(1)}s / 支援 ${(bat[2] ?? 0).toFixed(1)}s`)
      }
    }
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))
  }, 900_000)
})

/**
 * 静态分配规则的全库度量（2026-09-10，用户口径）：**伤害特化（强攻/异常/命破）拿平A池，其余为 0**。
 * 依据：实测击破位平A=0 时失衡次数与给它时间时**相同**（`PROBE_CONV_GRID`：5=5、3=3）——
 * 失衡值来自必做动作的 daze，不靠平A池；而现行默认给击破位 1（50/50）实测单队 −23.9%。
 * 该规则是静态的（零运行时成本），故作为「烘预设」的合法替代候选（不是烘均衡值，而是烘规则）。
 *   PROBE_CONV_RULE=1 npx vitest run src/composables/__tests__/convergenceProbe.test.ts
 */
describe.runIf(process.env.PROBE_CONV_RULE === '1')('探针：静态规则「只有伤害特化拿平A池」', () => {
  it('逐队 默认 vs 规则', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    const damageSpecialty = new Set(['attack', 'anomaly'])
    const isCarry = (id: string) => {
      const sp = catalog.getAgent(id)?.specialty ?? ''
      // 命破（rupture）也吃平A池；支援/防护/击破不吃
      return damageSpecialty.has(sp) || sp === 'rupture'
    }
    const apply = (team: string[]) => {
      for (let i = 0; i < 3; i++) config.setAgent(i, team[i])
      config.applyTeamPreset(team as [string, string, string])
    }
    let sumBase = 0
    let sumRule = 0
    let better = 0
    let worse = 0
    let stunChanged = 0
    const rows: { id: string; base: number; rule: number; stunA: number; stunB: number }[] = []
    for (const p of presets) {
      apply(p.team as string[])
      const dmgA = calc.teamTotalDamage.value
      const stunA = calc.stunPoolResult.value?.stunCount ?? 0
      const ruleWeights = p.team.map(id => (isCarry(id) ? 1 : 0))
      for (let i = 0; i < 3; i++) {
        const slot = config.team[i] as { basicAttackTimeWeight?: number } | undefined
        if (slot) slot.basicAttackTimeWeight = ruleWeights[i]
      }
      const dmgB = calc.teamTotalDamage.value
      const stunB = calc.stunPoolResult.value?.stunCount ?? 0
      sumBase += dmgA
      sumRule += dmgB
      if (dmgB > dmgA + 1) better++
      else if (dmgB < dmgA - 1) worse++
      if (stunB !== stunA) stunChanged++
      rows.push({ id: p.id, base: dmgA, rule: dmgB, stunA, stunB })
    }
    const byDelta = [...rows].sort((x, y) => (y.rule - y.base) - (x.rule - x.base))
    const lines = [
      `预设数 ${rows.length}`,
      `团队总伤合计：默认 ${(sumBase / 1e6).toFixed(0)}M → 规则「只有伤害特化拿池」 ${(sumRule / 1e6).toFixed(0)}M（${((sumRule / Math.max(1, sumBase) - 1) * 100).toFixed(2)}%）`,
      `提升 ${better} 队 · 变差 ${worse} 队 · 失衡次数发生变化的队数 ${stunChanged}`,
      '增益 top8：',
      ...byDelta.slice(0, 8).map(r => `  ${r.id} ${(r.base / 1e6).toFixed(1)}M → ${(r.rule / 1e6).toFixed(1)}M（${((r.rule / Math.max(1, r.base) - 1) * 100).toFixed(1)}%）失衡 ${r.stunA}→${r.stunB}`),
      '损失 top5：',
      ...[...rows].sort((x, y) => (x.rule - x.base) - (y.rule - y.base)).slice(0, 5)
        .map(r => `  ${r.id} ${(r.base / 1e6).toFixed(1)}M → ${(r.rule / 1e6).toFixed(1)}M（${((r.rule / Math.max(1, r.base) - 1) * 100).toFixed(1)}%）失衡 ${r.stunA}→${r.stunB}`),
    ]
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))
  }, 900_000)
})

/**
 * 平A daze 是否随平A池时间缩放（2026-09-10，用户提问「平a的失衡没有回填吗？」）：
 * 同一队三种权重配置（默认 / 全 0 = 完全没有平A池 / 全给击破位），比 失衡次数 + 毛攒条 +
 * `basic_attack` 行自身的 totalStun。若毛攒条与 basic_attack 贡献**不随池时间变**，则平A daze 未按时间回填。
 *   PROBE_STUN_SCALE=auto-1521-1361-1311 npx vitest run …convergenceProbe
 */
describe.runIf(!!process.env.PROBE_STUN_SCALE)('探针：平A daze 是否随平A池缩放', () => {
  it('逐队三配置对照', async () => {
    const ids = (process.env.PROBE_STUN_SCALE ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const lines: string[] = []
    type SP = {
      stunCount: number; grossStunBuildUp: number; totalStunBuildUp: number
      contributions?: { slot: number; moveId: string; count: number; totalStun: number }[]
    }
    for (const id of ids) {
      const p = teamPresets.find(x => x.id === id)
      if (!p) continue
      const { catalog } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const config = useConfigStore()
      const calc = useResourceCalc()
      lines.push(`\n---- ${id}（${p.name}）`)
      for (const [tag, ws] of [['默认权重', null], ['全 0（无平A池）', [0, 0, 0]], ['全给击破位', [0, 1, 0]]] as const) {
        for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
        config.applyTeamPreset(p.team as [string, string, string])
        if (ws) {
          for (let i = 0; i < 3; i++) {
            const slot = config.team[i] as { basicAttackTimeWeight?: number } | undefined
            if (slot) slot.basicAttackTimeWeight = ws[i]
          }
        }
        const rr = calc.resourceResult.value
        const sp = calc.stunPoolResult.value as unknown as SP | null
        const bat = (rr?.characters ?? []).map(c => c.timeAllocation.basicAttackTime).map(v => v.toFixed(1)).join('/')
        const basicContrib = (sp?.contributions ?? []).filter(c => c.moveId === 'basic_attack')
        lines.push(`  ${tag}：失衡 ${sp?.stunCount ?? 0} 次 · 毛攒条 ${(sp?.grossStunBuildUp ?? 0).toFixed(0)} · 有效 ${(sp?.totalStunBuildUp ?? 0).toFixed(0)} · 平A池 ${bat}s · basic_attack 行 ${basicContrib.map(c => `槽${c.slot}×${c.count.toFixed(2)} 总${c.totalStun.toFixed(0)}`).join(' | ') || '无'}`)
      }
    }
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))
  }, 900_000)
})

/**
 * 边际均衡会不会**拿失衡次数换伤害**（2026-09-10，用户口径：「失衡次数只是第一个决策」→ 应是约束）。
 * 逐队比 均衡前后 的失衡次数；掉次数的队要列出来（当前 `optimizeTeamTimeWeights` 只最大化伤害，无约束）。
 *   PROBE_CONV_BALANCE_STUN=1 npx vitest run …convergenceProbe
 */
describe.runIf(process.env.PROBE_CONV_BALANCE_STUN === '1')('探针：均衡是否改变了失衡次数', () => {
  it('逐队 均衡前后 失衡次数对照', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    const apply = (team: string[]) => {
      for (let i = 0; i < 3; i++) config.setAgent(i, team[i])
      config.applyTeamPreset(team as [string, string, string])
    }
    const changed: string[] = []
    let same = 0
    let up = 0
    let down = 0
    let sumBase = 0
    let sumBal = 0
    for (const p of presets) {
      apply(p.team as string[])
      const stunA = calc.stunPoolResult.value?.stunCount ?? 0
      const dmgA = calc.teamTotalDamage.value
      optimizeTeamTimeWeights(calc, config, { maxIter: 2 })
      const stunB = calc.stunPoolResult.value?.stunCount ?? 0
      const dmgB = calc.teamTotalDamage.value
      sumBase += dmgA
      sumBal += dmgB
      if (stunB === stunA) same++
      else if (stunB > stunA) up++
      else down++
      if (stunB !== stunA) {
        changed.push(`  ${p.id} 失衡 ${stunA}→${stunB} · 伤害 ${(dmgA / 1e6).toFixed(1)}M→${(dmgB / 1e6).toFixed(1)}M（${((dmgB / Math.max(1, dmgA) - 1) * 100).toFixed(1)}%）`)
      }
    }
    const lines = [
      `预设数 ${presets.length}`,
      `失衡次数：不变 ${same} 队 · 上升 ${up} 队 · **下降 ${down} 队**`,
      `伤害合计 ${(sumBase / 1e6).toFixed(0)}M → ${(sumBal / 1e6).toFixed(0)}M`,
      '失衡次数发生变化的队：',
      ...changed,
    ]
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))
  }, 900_000)
})

/**
 * 打失衡的**手段效率**对照（2026-09-10，用户口径）：「此处打失衡的手段必须换成更高效的方式，比如弹刀」
 * ——同队三种手段各扫一遍，比「每单位失衡的伤害代价」：
 *   A. 给击破位平A池时间（低性能击破位=低效，实测掉次数又掉伤害）
 *   B. 提高弹刀次数（per-slot 交互输入，不吃平A池）
 *   C. 提高主C 的平A池（主C 自身招式行就是主要攒条源）
 *   PROBE_STUN_LEVER=auto-1521-1361-1311 npx vitest run …convergenceProbe
 */
describe.runIf(!!process.env.PROBE_STUN_LEVER)('探针：打失衡的手段效率', () => {
  it('逐队 击破位平A vs 弹刀 vs 主C 平A', async () => {
    const ids = (process.env.PROBE_STUN_LEVER ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const lines: string[] = []
    for (const id of ids) {
      const p = teamPresets.find(x => x.id === id)
      if (!p) continue
      const { catalog } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const config = useConfigStore()
      const calc = useResourceCalc()
      const base = [0, 1, 2].map(s => Number(p.team[s] ? 1 : 0))
      const read = () => {
        const rr = calc.resourceResult.value
        return {
          stun: calc.stunPoolResult.value?.stunCount ?? 0,
          dmg: calc.teamTotalDamage.value,
          bat: (rr?.characters ?? []).map(c => c.timeAllocation.basicAttackTime.toFixed(1)).join('/'),
        }
      }
      const apply = (mut: (cfg: ReturnType<typeof useConfigStore>) => void) => {
        for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
        config.applyTeamPreset(p.team as [string, string, string])
        void base
        mut(config)
      }
      lines.push(`\n---- ${id}（${p.name}）`)
      const cases: [string, (cfg: ReturnType<typeof useConfigStore>) => void][] = [
        ['基线（预设权重/交互）', () => {}],
        ['A 击破位权重 2', cfg => cfg.setBasicAttackTimeWeight(1, 2)],
        ['A 击破位权重 8', cfg => cfg.setBasicAttackTimeWeight(1, 8)],
        ['B 弹刀 0', cfg => cfg.setParryCount(0, 0)],
        ['B 弹刀 4', cfg => cfg.setParryCount(0, 4)],
        ['B 弹刀 8', cfg => cfg.setParryCount(0, 8)],
        ['B 弹刀 12', cfg => cfg.setParryCount(0, 12)],
        ['C 主C 权重 2', cfg => cfg.setBasicAttackTimeWeight(0, 2)],
      ]
      for (const [tag, mut] of cases) {
        apply(mut)
        const r = read()
        lines.push(`  ${tag}：失衡 ${r.stun} 次 · 总伤 ${(r.dmg / 1e6).toFixed(1)}M · 平A 主C/击破/支援 ${r.bat}s`)
      }
    }
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))
  }, 900_000)
})

/**
 * 联合策略（多杠杆）的全库价值度量（2026-09-10）：默认 vs 联合（平A 权重 + 弹刀，带「不发生截断」硬门）。
 *   PROBE_CONV_JOINT=1 npx vitest run …convergenceProbe
 */
describe.runIf(process.env.PROBE_CONV_JOINT === '1')('探针：联合杠杆策略的全库价值', () => {
  it('逐队 默认 vs 联合', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    const { applyTimeWeightAllocation } = await import('@/composables/timeWeightAllocation')
    let sumBase = 0
    let sumJoint = 0
    let improved = 0
    let same = 0
    let noChange = 0
    let baselineTruncated = 0
    let parryChanged = 0
    let stunChanged = 0
    let infeasibleAfter = 0
    const truncatedAfter: string[] = []
    const truncatedBefore: string[] = []
    let energyFed = 0
    let energyRolledBack = 0
    let cornerMoved = 0
    const rows: { id: string; base: number; joint: number; note: string }[] = []
    for (const p of presets) {
      for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
      config.applyTeamPreset(p.team as [string, string, string])
      // 可选：模拟「已应用 boss 预设」的强制弹刀托底（PROBE_CONV_BOSS_PARRY=13 = 叶释渊那种量级），
      // 只置 appliedBoss（不动敌人面板），以隔离「弹刀下限」对收益的影响。
      const bossParry = Number(process.env.PROBE_CONV_BOSS_PARRY ?? 0)
      if (bossParry > 0) {
        config.appliedBoss = { presetId: 'probe', phaseId: 'p', at: Date.now(), parryTotal: bossParry }
      } else {
        config.appliedBoss = null
      }
      const dmgA = calc.teamTotalDamage.value
      const truncBefore = calc.resourceResult.value!.convergence?.timeTruncatedSeconds ?? 0
      if (truncBefore > 1e-6) {
        baselineTruncated++
        truncatedBefore.push(`${p.id}(${truncBefore.toFixed(1)}s)`)
      }
      const stunA = calc.stunPoolResult.value?.stunCount ?? 0
      const parryA = [0, 1, 2].map(s => config.team[s]!.parryCount).join('/')
      const r = applyTimeWeightAllocation({ calc, configStore: config })
      const dmgB = calc.teamTotalDamage.value
      if ((r.note ?? '').includes('能量驱动')) energyFed++
      if ((r.note ?? '').includes('权重已还原')) energyRolledBack++
      if ((r.note ?? '').includes('角点解：')) cornerMoved++
      const stunB = calc.stunPoolResult.value?.stunCount ?? 0
      const parryB = [0, 1, 2].map(s => config.team[s]!.parryCount).join('/')
      const trunc = calc.resourceResult.value!.convergence?.timeTruncatedSeconds ?? 0
      if (trunc > 1e-6) {
        infeasibleAfter++
        truncatedAfter.push(`${p.id}(${trunc.toFixed(1)}s)`)
      }
      sumBase += dmgA
      sumJoint += dmgB
      if (dmgB > dmgA + 1) improved++
      else same++
      if (!r.applied) noChange++
      if (parryA !== parryB) parryChanged++
      if (stunA !== stunB) stunChanged++
      rows.push({ id: p.id, base: dmgA, joint: dmgB, note: `${parryA}→${parryB} 失衡 ${stunA}→${stunB}${r.applied ? '' : ' 未应用'}${trunc > 1e-6 ? ` 截断 ${trunc.toFixed(2)}` : ''}` })
    }
    const byGain = [...rows].sort((x, y) => (y.joint - y.base) - (x.joint - x.base))
    // eslint-disable-next-line no-console
    console.log([
      `预设数 ${rows.length}`,
      `团队总伤合计：默认 ${(sumBase / 1e6).toFixed(0)}M → 联合 ${(sumJoint / 1e6).toFixed(0)}M（${((sumJoint / Math.max(1, sumBase) - 1) * 100).toFixed(2)}%）`,
      `提升 ${improved} 队 · 无变化 ${noChange} 队 · 基线本身已超时的队 ${baselineTruncated}（相对门：允许优化但不许更差）· 弹刀被改动 ${parryChanged} 队 · 失衡次数变化 ${stunChanged} 队 · 结束时仍截断 ${infeasibleAfter} 队`,
      `  能量驱动（A2）：喂能 ${energyFed} 队 · 守卫还原基线 ${energyRolledBack} 队 · 角点解（A3）出手 ${cornerMoved} 队`,
      `  基线超时清单（${truncatedBefore.length}）：${truncatedBefore.join(' ')}`,
      `  结束后仍截断清单（${truncatedAfter.length}）：${truncatedAfter.join(' ')}`,
      '增益 top10：',
      ...byGain.slice(0, 10).map(r => `  ${r.id} ${(r.base / 1e6).toFixed(1)}M → ${(r.joint / 1e6).toFixed(1)}M（${((r.joint / Math.max(1, r.base) - 1) * 100).toFixed(1)}%）${r.note}`),
      '损失 top5：',
      ...[...rows].sort((x, y) => (x.joint - x.base) - (y.joint - y.base)).slice(0, 5).map(r => `  ${r.id} ${(r.base / 1e6).toFixed(1)}M → ${(r.joint / 1e6).toFixed(1)}M（${((r.joint / Math.max(1, r.base) - 1) * 100).toFixed(1)}%）${r.note}`),
    ].join('\n'))
  }, 1_800_000)
})

/**
 * 一次弹刀在引擎里的账（2026-09-10，用户提问「引擎把一次弹刀怎么算的？」）：
 * 逐槽打印 轻弹刀/支援突击 的 cfg 参数（动作时间、免费次数、喧响回报）与**物化行**（count/时间/喧响），
 * 外加每次弹刀的净时间成本与回报，供人工核对「弹刀+支援突击是否亏」。
 *   PROBE_PARRY_ACCOUNT=auto-1521-1361-1311 npx vitest run …convergenceProbe
 */
describe.runIf(!!process.env.PROBE_PARRY_ACCOUNT)('探针：一次弹刀的账', () => {
  it('逐队逐槽打表', async () => {
    const ids = (process.env.PROBE_PARRY_ACCOUNT ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const lines: string[] = []
    for (const id of ids) {
      const p = teamPresets.find(x => x.id === id)
      if (!p) continue
      const { catalog } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const config = useConfigStore()
      const calc = useResourceCalc()
      for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
      config.applyTeamPreset(p.team as [string, string, string])
      const cfg = calc.resourceConfig.value
      const rr = calc.resourceResult.value
      lines.push(`\n---- ${id}（${p.name}）`)
      for (const c of cfg?.characters ?? []) {
        const row = (mid: string) => (rr?.characters ?? []).find(ch => ch.slot === c.slot)?.executions.find(e => e.moveId === mid)
        lines.push(`  槽${c.slot}(${c.agentId}) 弹刀=${c.parryCount} 无突击弹刀=${c.parryNoFollowUpCount ?? 0} 时间豁免=${c.parryTimeFreeCount ?? 0}`)
        lines.push(`    轻弹刀：单次 ${c.defensiveAssistActionTime.toFixed(3)}s · 喧响/次 ${c.defensiveAssistDecibelRecovery} · 合轴率 ${c.defensiveAssistComboAlignRatio}`)
        lines.push(`    支援突击：单次 ${c.assistFollowUpActionTime.toFixed(3)}s · 喧响/次 ${c.assistFollowUpDecibelRecovery} · 合轴率 ${c.assistFollowUpComboAlignRatio}`)
        const da = row(c.defensiveAssistMoveId)
        const fu = row(c.assistFollowUpMoveId)
        lines.push(`    物化行 轻弹刀：×${da?.count ?? 0} 计时间 ${(da?.totalTime ?? 0).toFixed(2)}s 喧响 ${(da?.totalDecibelRecovery ?? 0).toFixed(0)} | 支援突击：×${fu?.count ?? 0} 计时间 ${(fu?.totalTime ?? 0).toFixed(2)}s 喧响 ${(fu?.totalDecibelRecovery ?? 0).toFixed(0)}`)
        const charged = Math.max(0, c.parryCount - Math.floor(c.parryTimeFreeCount ?? 0))
        lines.push(`    ⇒ 每 1 次弹刀（计费制）：时间 ${((c.defensiveAssistActionTime + c.assistFollowUpActionTime)).toFixed(3)}s × 计费次数 ${charged}/${c.parryCount} · 喧响 ${(c.defensiveAssistDecibelRecovery + c.assistFollowUpDecibelRecovery).toFixed(0)}`)
      }
    }
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))
  }, 900_000)
})
