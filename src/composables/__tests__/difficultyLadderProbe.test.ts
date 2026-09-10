/**
 * 探针：**逐目标贪心阶梯**（难度曲线的 N 点版，用户 2026-09-10 口径）。
 *
 * 形态（用户原话）：「每个队伍的 x 不一定对齐，他是**根据最优化算法提升操作难度的同时提升伤害**」。
 * ⇒ 从「全关」出发，每一步**试开每一个还没开的目标**，按「Δ伤害 / 难度代价」最高者**贪心**录取，
 *   得到该队自己的一串点：**（累积难度, 伤害）**。x 不对齐是特性；曲线形状 = 该队的难度-收益画像。
 *
 * **当前目标集（草案，全部是现成旋钮，不用新引擎通道）**：
 * | 目标 | 旋钮 | 代价（暂定 1） |
 * |---|---|---|
 * | G1 权重均衡 | 策略 `marginal-equalize`（B） | 1 |
 * | G2 弹刀/交互调优 | 策略 `joint-levers`（C） | 1 |
 * | G3 保底达成 | `guarantee.stun/.fury/.ultimate = 1` | 1 |
 * | G4 取整（失衡→计数投影） | `time.stunPlanProjection = ceil` | 1 |
 *
 * 代价口径是**占位**（用户裁决项）：每个目标先按 1 计，后续可换成「交互增量」或用户自填权重。
 *
 * 运行：
 *   PROBE_DIFF_LADDER=1 npx vitest run src/composables/__tests__/difficultyLadderProbe.test.ts
 *   PROBE_DIFF_LADDER=1 PROBE_DIFF_TEAMS=auto-1431-1341-1311,banyue-norma-lucia npx vitest run ...
 * 不设 env 时空跑（普通 vitest run 不受影响）。
 */
import { describe, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyTimeWeightAllocation } from '@/composables/timeWeightAllocation'
import { teamPresets } from '@/data/teamPresets'

const active = process.env.PROBE_DIFF_LADDER === '1'
/** G4 用的投影档（ceil=3 / round=2 / floor=1；默认 ceil） */
const PROJ_CODE = Number(process.env.PROBE_DIFF_PROJ_CODE ?? '3') || 3
const TEAM_IDS = (process.env.PROBE_DIFF_TEAMS ?? '').split(',').map(s => s.trim()).filter(Boolean)

const GUARANTEE_KEYS = ['guarantee.stun', 'guarantee.fury', 'guarantee.ultimate'] as const

describe.runIf(active)('探针：逐目标贪心阶梯（每队自己的难度曲线）', () => {
  it('贪心录取并输出每队曲线点', async () => {
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()

    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    const targets = TEAM_IDS.length > 0
      ? presets.filter(p => TEAM_IDS.includes(p.id))
      : presets.filter(p => [
        // 默认样本：提升最大 4 + 负收益 3 + 下限型 3 + 中间 2
        'auto-1521-1361-1311', 'auto-1311-1521-1361', 'auto-1521-1481-1311', 'auto-1461-1521-1031',
        'auto-1431-1341-1311', 'banyue-norma-lucia', 'auto-1471-1571-1451',
        'auto-1041-1571-1031', 'auto-1531-1451-1481', 'auto-1221-1511-1211',
        'auto-1501-1511-1311', 'yixuan-jufufu-lucia',
      ].includes(p.id))

    /** 应用一队（回到静态权重）并清掉所有目标 */
    const reset = (ids: string[]) => {
      for (const k of GUARANTEE_KEYS) config.setMechanicSetting(k, 0)
      config.setMechanicSetting('time.stunPlanProjection', 0)
      for (let i = 0; i < 3; i++) config.setAgent(i, ids[i])
      config.applyTeamPreset(ids as [string, string, string])
      return calc.teamTotalDamage.value
    }
    const snapshot = () => ({
      w: [0, 1, 2].map(s => config.team[s]!.basicAttackTimeWeight),
      p: [0, 1, 2].map(s => config.team[s]!.parryCount ?? 0),
    })
    const restore = (snap: { w: number[]; p: number[] }) => {
      for (let s = 0; s < 3; s++) {
        config.setBasicAttackTimeWeight(s, snap.w[s])
        config.setParryCount(s, snap.p[s])
      }
    }

    const out: string[] = []
    for (const p of targets) {
      const base = reset(p.team as string[])
      let dmg = base
      const opened: string[] = []
      const points: { x: number; dmg: number }[] = [{ x: 0, dmg: base }]
      const remaining = new Set(['G1', 'G2', 'G3', 'G4'])

      while (remaining.size > 0) {
        let best: { id: string; gain: number; dmg: number } | null = null
        for (const id of remaining) {
          const snap = snapshot()
          if (id === 'G1') applyTimeWeightAllocation({ calc, configStore: config }, 'marginal-equalize')
          else if (id === 'G2') applyTimeWeightAllocation({ calc, configStore: config }, 'joint-levers')
          else if (id === 'G3') for (const k of GUARANTEE_KEYS) config.setMechanicSetting(k, 1)
          else config.setMechanicSetting('time.stunPlanProjection', PROJ_CODE)
          const d = calc.teamTotalDamage.value
          if (id === 'G1' || id === 'G2') restore(snap)
          else if (id === 'G3') for (const k of GUARANTEE_KEYS) config.setMechanicSetting(k, 0)
          else config.setMechanicSetting('time.stunPlanProjection', 0)
          const gain = d - dmg
          if (!best || gain > best.gain) best = { id, gain, dmg: d }
        }
        if (!best) break
        // 正式录取：重开一遍该目标（连同已开目标一起生效）
        if (best.id === 'G1') applyTimeWeightAllocation({ calc, configStore: config }, 'marginal-equalize')
        else if (best.id === 'G2') applyTimeWeightAllocation({ calc, configStore: config }, 'joint-levers')
        else if (best.id === 'G3') for (const k of GUARANTEE_KEYS) config.setMechanicSetting(k, 1)
        else config.setMechanicSetting('time.stunPlanProjection', PROJ_CODE)
        dmg = calc.teamTotalDamage.value
        opened.push(best.id)
        remaining.delete(best.id)
        points.push({ x: opened.length, dmg })
      }

      out.push([
        `${p.id}  (base ${(base / 1e6).toFixed(1)}M → ${(dmg / 1e6).toFixed(1)}M, ${((dmg - base) / Math.max(1, base) * 100).toFixed(1)}%)`,
        `  顺序: ${opened.join(' → ')}`,
        `  点: ${points.map(pt => `(${pt.x},${(pt.dmg / 1e6).toFixed(1)}M)`).join(' ')}`,
      ].join('\n'))
    }

    // eslint-disable-next-line no-console
    console.log(`目标集 G1 均衡 / G2 弹刀(联合) / G3 保底 / G4 取整（代价各 1，占位）\n${out.join('\n')}`)
  }, 900_000)
})
