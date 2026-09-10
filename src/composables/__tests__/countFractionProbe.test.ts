/**
 * 探针：终局「小数次数」体检 + **失衡计划值投影的 A/B**（C7 计数投影统一的测量仪器，2026-09-10 立）。
 *
 * 用户 2026-09-10 追问「小数次数的来源是缝合 180s 吗」→ 先量再答。**实测（127 预设，静态权重）**：
 * 计数槽位样本 1143 · **非整数 269（23.5%）**，且**主战场是 `chain`（连携次数）**：
 * `chain` 246 / `ex` 20 / `ult` 3（角色明细见下）。**两类根因**：
 *  ① **外层失衡计划值是实数**（`useResourceCalc.ts` 外层不动点：净失衡按非失衡占比缩放 + 超窗口数残失衡
 *     按残差时间系数折成小数 + 非失衡时间不足时 `(有效−必要)/窗长` 反解 ⇒ "为让时间账装得下而折小数"）
 *     → `chainCountTotal = chainCountPerStun × 小数失衡`（`resource.ts` 种子 / `useResourceCalc.ts` 三处）
 *     ⇒ **连携次数大面积带小数**。
 *  ② **实数化松弛**（有意为之，用户批过）：整数阶梯 = 环增益 >1 的振荡源（1431 轮数 / 1531 链数 / 1051 强特，
 *     模块内已登记口径注释）；1051/1531 在终局投影回整数，其余没有。
 *
 * **A/B**：`PROBE_STUN_PROJ=floor|round|ceil` 打开 `time.stunPlanProjection`（见 `core/stunPlanProjection.ts`），
 * 把「计数通道」的计划值投影成整数（时间账与迭代仍用实数），对照 非整数样本 / 留白 / 超预算 / 伤害合计。
 * 四态（不设 = off）各跑一次即为「做前先量」的 δ 表。
 *
 * 运行：PROBE_COUNT_FRAC=1 [PROBE_STUN_PROJ=floor] npx vitest run src/composables/__tests__/countFractionProbe.test.ts
 * 不设 env 时空跑（普通 vitest run 不受影响）。
 */
import { describe, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { buildTeamTimeSummary } from '@/composables/teamTimeSummary'
import { teamPresets } from '@/data/teamPresets'
import { STUN_PLAN_PROJECTION_MODES } from '@/core/stunPlanProjection'

const active = process.env.PROBE_COUNT_FRAC === '1'
const PROJ = (process.env.PROBE_STUN_PROJ ?? '').trim()
const PROJ_CODE = Math.max(0, STUN_PLAN_PROJECTION_MODES.indexOf(PROJ as never))

describe.runIf(active)('探针：终局小数次数（+ 失衡计划值投影 A/B）', () => {
  it('全预设扫描', async () => {
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    config.setMechanicSetting('time.stunPlanProjection', PROJ_CODE)
    const calc = useResourceCalc()
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)

    const frac: { id: string; slot: number; agent: string; field: string; value: number; dev: number }[] = []
    const byField: Record<string, number> = { ex: 0, ult: 0, chain: 0 }
    let total = 0
    const byAgent: Record<string, { n: number; maxDev: number }> = {}
    let sumSlack = 0
    let sumOver = 0
    let sumDmg = 0
    const worst: { id: string; slack: number }[] = []

    for (const p of presets) {
      for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
      config.applyTeamPreset(p.team as [string, string, string])
      const rr = calc.resourceResult.value
      if (!rr) continue
      sumDmg += calc.teamTotalDamage.value
      const t = buildTeamTimeSummary({
        rr, battleTime: rr.totalTime,
        invincibleTime: config.enemy.invincibleTime ?? 0,
        nameOf: (_a, slot) => `槽${slot}`,
      })
      sumSlack += Math.max(0, t.slack)
      sumOver += Math.max(0, -t.slack)
      worst.push({ id: p.id, slack: t.slack })
      rr.characters.forEach((c, slot) => {
        const fields: [string, number][] = [
          ['ex', c.exSpecialCount ?? 0],
          ['ult', c.ultimateCount ?? 0],
          ['chain', c.chainCountTotal ?? 0],
        ]
        for (const [f, v] of fields) {
          total++
          const dev = Math.abs(v - Math.round(v))
          if (dev > 1e-6) {
            frac.push({ id: p.id, slot, agent: config.team[slot]?.agentId ?? '?', field: f, value: v, dev })
            byField[f]++
            const key = `${config.team[slot]?.agentId ?? '?'}/${f}`
            byAgent[key] = byAgent[key] ?? { n: 0, maxDev: 0 }
            byAgent[key].n++
            byAgent[key].maxDev = Math.max(byAgent[key].maxDev, dev)
          }
        }
      })
    }

    worst.sort((a, b) => a.slack - b.slack)
    // eslint-disable-next-line no-console
    console.log([
      `【投影模式 = ${PROJ || 'off'}（${PROJ_CODE}）】`,
      `预设 ${presets.length} · 计数槽位样本 ${total} · 非整数 ${frac.length}（${(frac.length / Math.max(1, total) * 100).toFixed(1)}%）`
        + ` · 字段分布 chain=${byField.chain} ex=${byField.ex} ult=${byField.ult}`,
      `留白合计 ${sumSlack.toFixed(1)}s · 超预算合计 ${sumOver.toFixed(1)}s · 伤害合计 ${(sumDmg / 1e6).toFixed(1)}M`,
      `最差 5 队（slack）：${worst.slice(0, 5).map(w => `${w.id}=${w.slack.toFixed(2)}`).join(' ')}`,
      '按 角色/字段 汇总（前 12，出现队数 · 最大偏离）：',
      ...Object.entries(byAgent).sort((a, b) => b[1].n - a[1].n).slice(0, 12)
        .map(([k, v]) => `  ${k}: ${v.n} 队 · maxDev=${v.maxDev.toFixed(4)}`),
    ].join('\n'))
  }, 600_000)
})
