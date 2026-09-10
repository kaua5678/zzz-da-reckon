/**
 * 探针：**伤害-难度曲线的两端（全关 / 全开）**（用户 2026-09-10 提案的第一份实测数据）。
 *
 * 用户口径：「一个队伍可以延申很多情况，比如根据操作难度不同延申出不同的伤害……**档位每个队伍都是不一样的**，
 * 每个队伍的 x 不一定对齐，他是根据最优化算法提升操作难度的同时提升伤害……或者**直接全开和全关算两次**」。
 *
 * 本探针只做**两端点**（最小版）：同一队跑两次，看提升幅度分布 —— 提升大的队 = "吃优化/吃操作"，
 * 提升小的队 = 下限型。**不做全局档位**（x 不对齐是特性）。中间档（逐目标贪心）留待下一步。
 *
 * 全关 / 全开 的**当前取值（草案，待用户确认目标清单）**：
 * | 维度 | 全关 | 全开 |
 * |---|---|---|
 * | 权重分配 | 不跑策略（静态默认/预设值） | 联合策略 C（`joint-levers`） |
 * | 保底 | `guarantee.stun/ultimate/fury = 0` | 全 = 1 |
 * | 取整（失衡→计数投影） | `time.stunPlanProjection = off` | `= ceil` |
 *
 * 运行：PROBE_DIFF_CURVE=1 npx vitest run src/composables/__tests__/difficultyCurveProbe.test.ts
 * 不设 env 时空跑（普通 vitest run 不受影响）。
 */
import { describe, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyTimeWeightAllocation } from '@/composables/timeWeightAllocation'
import { teamPresets } from '@/data/teamPresets'

const active = process.env.PROBE_DIFF_CURVE === '1'

describe.runIf(active)('探针：伤害-难度曲线两端（全关/全开）', () => {
  it('全预设扫描', async () => {
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)

    const rows: { id: string; off: number; on: number }[] = []
    for (const p of presets) {
      // ===== 全关：静态权重 + 无保底 + 不取整 =====
      config.setMechanicSetting('guarantee.stun', 0)
      config.setMechanicSetting('guarantee.fury', 0)
      config.setMechanicSetting('guarantee.ultimate', 0)
      config.setMechanicSetting('time.stunPlanProjection', 0)
      for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
      config.applyTeamPreset(p.team as [string, string, string]) // 重新套预设 ⇒ 权重回到静态值
      const off = calc.teamTotalDamage.value

      // ===== 全开：联合策略 + 全保底 + ceil 取整 =====
      config.setMechanicSetting('guarantee.stun', 1)
      config.setMechanicSetting('guarantee.fury', 1)
      config.setMechanicSetting('guarantee.ultimate', 1)
      config.setMechanicSetting('time.stunPlanProjection', 3)
      applyTimeWeightAllocation({ calc, configStore: config }, 'joint-levers')
      const on = calc.teamTotalDamage.value

      rows.push({ id: p.id, off, on })
    }

    const sumOff = rows.reduce((a, r) => a + r.off, 0)
    const sumOn = rows.reduce((a, r) => a + r.on, 0)
    const gain = rows.map(r => ({ ...r, pct: (r.on - r.off) / Math.max(1, r.off) * 100 }))
    gain.sort((a, b) => b.pct - a.pct)
    const buckets = { '≥+30%': 0, '+10~30%': 0, '+2~10%': 0, '0~2%': 0, '<0': 0 }
    for (const g of gain) {
      if (g.pct >= 30) buckets['≥+30%']++
      else if (g.pct >= 10) buckets['+10~30%']++
      else if (g.pct >= 2) buckets['+2~10%']++
      else if (g.pct >= 0) buckets['0~2%']++
      else buckets['<0']++
    }
    const med = gain[Math.floor(gain.length / 2)]?.pct ?? 0
    // eslint-disable-next-line no-console
    console.log([
      `预设 ${rows.length} · 全关 ${(sumOff / 1e6).toFixed(1)}M → 全开 ${(sumOn / 1e6).toFixed(1)}M（${((sumOn - sumOff) / sumOff * 100).toFixed(2)}%）`,
      `提升幅度分布：${Object.entries(buckets).map(([k, v]) => `${k}=${v}队`).join(' ')} · 中位数 ${med.toFixed(1)}%`,
      '提升最大 top8（吃优化型）：',
      ...gain.slice(0, 8).map(g => `  ${g.id}: ${(g.off / 1e6).toFixed(1)}M → ${(g.on / 1e6).toFixed(1)}M (+${g.pct.toFixed(1)}%)`),
      '提升最小 bottom8（下限型/已饱和）：',
      ...gain.slice(-8).map(g => `  ${g.id}: ${(g.off / 1e6).toFixed(1)}M → ${(g.on / 1e6).toFixed(1)}M (${g.pct >= 0 ? '+' : ''}${g.pct.toFixed(1)}%)`),
    ].join('\n'))
  }, 900_000)
})
