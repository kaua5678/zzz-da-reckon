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
 * ③ 历史无关（2026-09-24）：同一个 store 走 B → A 与全新 store 直达 A，面板 / 资源结果 / 伤害 / 配置逐位相同。
 *    种子随机队伍（每个角色在 0/1/2 三个槽位各出场一次 ⇒ 跨槽联动全覆盖）+ 随机命座/潜能/音擎/精炼。
 *    红了 = 某处状态「记住了上一支队伍」（残留 cfg 键、watch 漏源、模块级变量、缓存键漏字段……）。
 *    ①③ 查的是**结果**漂移；「写了缓存却恰好没漂」由运行期深冻结兜底（`resourceCalc/freezeCached.ts`）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { setCalcOutputMemoEnabled, useResourceCalc } from '@/composables/useResourceCalc'
import { setRowFastPathsEnabled } from '@/core/resource/rowBuild'

const catalogData = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))
const agentIds: string[] = (catalogData.agents ?? []).map((a: { id: number | string }) => String(a.id))
const wEngineIds: string[] = (catalogData.wEngines ?? []).map((w: { id: number | string }) => String(w.id))

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

  it('历史无关：B → A 与全新直达 A 逐位相同（面板 / 资源结果 / 伤害 / 配置）', async () => {
    // 固定种子 LCG：失败可复现；改种子 = 换一批随机组合（不改判据）
    let seed = 20260924
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    type Slot = { agentId: string; cinemaLevel: number; potentialLevel: number; wEngineId: string; wEngineModLevel: number }
    const slotOf = (agentId: string): Slot => ({
      agentId, cinemaLevel: [0, 2, 6][rnd(3)]!, potentialLevel: 1 + rnd(6),
      wEngineId: wEngineIds[rnd(wEngineIds.length)] ?? '', wEngineModLevel: 1 + rnd(5),
    })
    const n = agentIds.length
    // 队伍 k = 轮转三元组 ⇒ 每个角色恰好在槽 0/1/2 各出场一次（n ≥ 3 时三者互异）
    const teamAt = (k: number) => [0, 1, 2].map(j => slotOf(agentIds[(k + j * Math.max(1, Math.floor(n / 3))) % n]!))
    const randomTeam = () => {
      const picked = new Set<string>()
      while (picked.size < Math.min(3, n)) picked.add(agentIds[rnd(n)]!)
      return [...picked].map(slotOf)
    }
    // 经 UI 同款 setter 切队（不走 harness 的整槽覆写）——这才是真实用户路径上的「历史」
    const apply = (config: Awaited<ReturnType<typeof setupHarness>>['config'], team: Slot[]) => {
      team.forEach((t, i) => config.setAgent(i, t.agentId))
      team.forEach((t, i) => {
        config.setCinemaLevel(i, t.cinemaLevel)
        config.setPotentialLevel(i, t.potentialLevel)
        config.setWEngine(i, t.wEngineId)
        config.setWEngineModLevel(i, t.wEngineModLevel)
      })
    }
    const start = [{ agentId: agentIds[0]! }, { agentId: agentIds[1 % n]! }, { agentId: agentIds[2 % n]! }]
    const snapshot = (calc: ReturnType<typeof useResourceCalc>, config: Awaited<ReturnType<typeof setupHarness>>['config']) =>
      enc([calc.teamTotalDamage.value, calc.panels.value, calc.resourceResult.value,
        // refreshTrigger 是失效计数器（历史长度），本身不是状态
        { ...config.$state, refreshTrigger: 0 }])
    const label = (t: Slot[]) => t.map(s => `${s.agentId}c${s.cinemaLevel}`).join('-')
    const drift: string[] = []
    for (let k = 0; k < n; k++) {
      const A = teamAt(k), B = randomTeam()
      const fresh = await setupHarness(start)
      const freshCalc = useResourceCalc()
      apply(fresh.config, A)
      const want = snapshot(freshCalc, fresh.config)
      const hist = await setupHarness(start)
      const histCalc = useResourceCalc()
      apply(hist.config, B)
      void histCalc.teamTotalDamage.value
      void histCalc.panels.value
      apply(hist.config, A)
      if (snapshot(histCalc, hist.config) !== want) drift.push(`${label(A)} ←经 ${label(B)}`)
    }
    expect(drift, `结果依赖上一支队伍（历史相关）：${drift.join('; ')}`).toEqual([])
  }, 600_000)
})
