/**
 * 探针：终局「小数次数」体检（C7 计数投影统一 / 坑25 双源失衡 的测量仪器，2026-09-10 立）。
 *
 * 用户 2026-09-10 追问「小数次数的来源是缝合 180s 吗」→ 先量再答。**实测（127 预设，静态权重）**：
 * 计数槽位样本 1143 · **非整数 269（23.5%）**，且**主战场是 `chain`（连携次数）**：
 * 1411=24 队、1311=20、1561=17、1481/1511=13…（`ex` 只有 1031/1621 等零星，`ult` 只有 1051/1591）。
 *
 * **两类根因（改这里前必读）**：
 *  ① **外层失衡计划值是实数**（`useResourceCalc.ts` 外层不动点：净失衡按非失衡占比缩放 +
 *     超出可容纳窗口数的残失衡按残差时间系数折成小数 + 非失衡时间不足时 `(有效−必要)/窗长` 反解
 *     ⇒ "为让时间账装得下而折成小数"）→ `chainCountTotal = chainCountPerStun × 小数失衡`
 *     （`resource.ts:309`、`useResourceCalc.ts:846/986`）⇒ **连携次数大面积带小数**。
 *  ② **实数化松弛**（有意为之，用户批过）：整数阶梯=环增益>1 的振荡源，故迭代期用实数
 *     （1431 轮数 / 1531 链数 / 1051 强特 @fact 在册）；1051/1531 在终局投影回整数，其余没有。
 *
 * 运行：PROBE_COUNT_FRAC=1 npx vitest run src/composables/__tests__/countFractionProbe.test.ts
 * 不设 env 时空跑（普通 vitest run 不受影响）。
 */
import { describe, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'

const active = process.env.PROBE_COUNT_FRAC === '1'

describe.runIf(active)('探针：终局小数次数', () => {
  it('全预设扫描', async () => {
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)

    const frac: { id: string; slot: number; agent: string; field: string; value: number; dev: number }[] = []
    let total = 0
    const byAgent: Record<string, { n: number; maxDev: number; fields: Set<string> }> = {}

    for (const p of presets) {
      for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
      config.applyTeamPreset(p.team as [string, string, string])
      const rr = calc.resourceResult.value
      if (!rr) continue
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
            const key = `${config.team[slot]?.agentId ?? '?'}/${f}`
            byAgent[key] = byAgent[key] ?? { n: 0, maxDev: 0, fields: new Set() }
            byAgent[key].n++
            byAgent[key].maxDev = Math.max(byAgent[key].maxDev, dev)
            byAgent[key].fields.add(f)
          }
        }
      })
    }

    // eslint-disable-next-line no-console
    console.log([
      `预设 ${presets.length} · 次数槽位样本 ${total} · 非整数 ${frac.length}（${(frac.length / Math.max(1, total) * 100).toFixed(1)}%）`,
      '按 角色/字段 汇总（出现队数 · 最大偏离）：',
      ...Object.entries(byAgent).sort((a, b) => b[1].n - a[1].n)
        .map(([k, v]) => `  ${k}: ${v.n} 队 · maxDev=${v.maxDev.toFixed(4)}`),
      '样例 12 条：',
      ...frac.slice(0, 12).map(f => `  ${f.id} 槽${f.slot + 1}(${f.agent}).${f.field} = ${f.value.toFixed(4)}`),
    ].join('\n'))
  }, 600_000)
})
