/**
 * **全部角色**自动护栏（扩展性护栏，2026-09-23）——catalog 枚举，**新角色零配置纳入**：
 *
 * ① 重算幂等：同配置强制重算两次结果逐位相同。模块钩子若改写缓存对象（面板/行/cfg）会在这里红。
 *    首例实锤：佩洛伊斯耀斑在 transformSkillExecutions 里 += 缓存面板，单次 +640% 且逐次累加（已修）。
 * ② 行物化快路径开/关逐位相同。两条快路径（`core/resource/rowBuild.ts`）依赖**角色模块的写法**：
 * - `feasibleRows` 单次 `iterate` 内单槽记忆：要求模块不在物化期间改写行、不跨调用改写 cfg；
 * - `materializeRows` 对模块新增的 cfg 缓存键置 undefined（不 delete）：要求没人用 `in`/`hasOwnProperty`
 *   区分「键不存在」与「值为 undefined」。
 * 每人 × 命座 0/6 × 交互加码，比较完整 resourceResult + 伤害。红了 = 模块打破前提：修模块写法，别关快路径。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { setCalcOutputMemoEnabled, useResourceCalc } from '@/composables/useResourceCalc'
import { setRowFastPathsEnabled } from '@/core/resource/rowBuild'
import { clearWarmStartCache } from '@/core/resource'

const catalogData = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))
const agentIds: string[] = (catalogData.agents ?? []).map((a: { id: number | string }) => String(a.id))

const enc = (v: unknown) => JSON.stringify(v, (_k, x) =>
  typeof x === 'number' ? (Number.isNaN(x) ? '#NaN' : !Number.isFinite(x) ? `#${x}` : Object.is(x, -0) ? '#-0' : x) : x)

describe(`全角色护栏（${agentIds.length} 角色 × 命座 0/6 × 交互加码）`, () => {
  it('重算幂等 + 行物化快路径开/关逐位相同', async () => {
    const { config } = await setupHarness([{ agentId: agentIds[0]! }])
    const calc = useResourceCalc()
    setCalcOutputMemoEnabled(false)
    const read = () => `${calc.teamTotalDamage.value}|${enc(calc.resourceResult.value)}`
    const arm = (on: boolean) => {
      setRowFastPathsEnabled(on)
      clearWarmStartCache()
      config.refreshTrigger++
      const base = read()
      const pc = config.team[0]!.parryCount, dc = config.team[0]!.dodgeCounterCount
      config.team[0]!.parryCount = (pc ?? 0) + 25
      config.team[0]!.dodgeCounterCount = (dc ?? 0) + 25
      const heavy = read()
      config.team[0]!.parryCount = pc
      config.team[0]!.dodgeCounterCount = dc
      return `${base}#${heavy}`
    }
    const notIdempotent: string[] = []
    const fastPathDiff: string[] = []
    try {
      for (const agentId of agentIds) {
        config.setAgent(0, agentId)
        for (const c of [0, 6]) {
          config.setCinemaLevel(0, c)
          const on1 = arm(true)
          const on2 = arm(true)
          if (on1 !== on2) notIdempotent.push(`${agentId} c${c}`)
          else if (arm(false) !== on1) fastPathDiff.push(`${agentId} c${c}`)
        }
      }
    } finally {
      setRowFastPathsEnabled(true)
      setCalcOutputMemoEnabled(true)
    }
    expect(notIdempotent, `同配置重算结果漂移（模块钩子改写了缓存对象）：${notIdempotent.join(', ')}`).toEqual([])
    expect(fastPathDiff, `快路径开/关结果不同（模块打破了 rowBuild.ts 快路径前提）：${fastPathDiff.join(', ')}`).toEqual([])
  }, 600_000)
})
