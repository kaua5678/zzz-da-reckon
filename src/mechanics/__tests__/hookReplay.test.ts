/**
 * CC-292：会在同一份 cfg 上被重复调用的模块钩子必须「重放一致」。
 *
 * 背景（CC-288 / CC-291）：buildExecutions / materializePhaseState / patchExecutions / buildAnomalyEvents
 * 会被内层迭代、underfillProbe、装配在同一份 cfg 上重复调用。如果钩子的 cfg 写入依赖自己上一次写入的结果
 * （自累加、提前 return 留旧值、由上次写的键推新键……），结果就取决于调用次数。
 * idempotentCfgWrite.test 的 AST 锁只抓「自引用累加」一种写法、只认特定变量名；本锁按行为判定，不看写法：
 *
 * 做法：包住全部注册模块的上述钩子。每次生产调用照常执行；调用前深拷贝 cfg / state / 行 / 事件，调用后
 * 在「调用后 cfg 的拷贝」上用「调用前的行 / 事件 / state 拷贝」再调一次（= 模拟紧接着的第二次调用），
 * 比较两次调用后的 cfg（逐键 JSON）。不同 ⇒ 钩子不幂等。重放只作用于拷贝，不影响生产结果。
 * 场景 = 全角色 × 命座 0/6 单人 + 全部三人预设（与 timeGolden 同一批）。每个场景里每个「模块:钩子」最多重放 REPLAY_CAP 次。
 * ② 陈旧值探针：分别在「调用前 cfg」和「调用后 cfg」的拷贝上，用空行 / 空事件输入各调一次，比较结果。
 *    本钩子写过的键若在两份上不同 ⇒ 空输入那条路径没覆盖它，留下了上一次调用的旧值（CC-288 南宫羽地雷撞套数型）。
 * 有牙：把 grace / orphie 换回 CC-291 之前、nangong 换回 CC-288 之前，①② 分别会红。
 */
import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { getRegisteredAgentMechanics } from '@/mechanics/registry'

const HOOKS = ['buildExecutions', 'materializePhaseState', 'patchExecutions', 'buildAnomalyEvents'] as const
/** 允许名单：`模块id:钩子:键`，每条写明为什么不影响结果 */
const ALLOW = new Set<string>([]) // ①② 共用

const catalogData = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))
const agentIds: string[] = (catalogData.agents ?? []).map((a: { id: number | string }) => String(a.id))

const diffs = new Map<string, number>()
const restores: Array<() => void> = []
let replays = 0
const staleB = new Map<string, number>()
/** 每个场景里每个「模块:钩子」最多重放次数（控制耗时；非幂等在头几次调用就会暴露） */
const REPLAY_CAP = 6
const replayCount = new Map<string, number>()

function keyed(obj: Record<string, unknown>): Map<string, string> {
  const m = new Map<string, string>()
  for (const k of Object.keys(obj)) {
    let v: string
    try { v = JSON.stringify(obj[k]) ?? 'undefined' } catch { v = String(obj[k]) }
    m.set(k, v)
  }
  return m
}

function clone<T>(v: T): T | null {
  try { return structuredClone(v) } catch { return null }
}

function wrapAll(): number {
  let n = 0
  for (const mod of getRegisteredAgentMechanics()) {
    for (const hook of HOOKS) {
      const orig = (mod as any)[hook] as ((input: any) => unknown) | undefined
      if (typeof orig !== 'function') continue
      n++
      const wrapped = (input: any) => {
        const capKey = `${mod.id}:${hook}`
        const used = replayCount.get(capKey) ?? 0
        if (used >= REPLAY_CAP) return orig(input)
        replayCount.set(capKey, used + 1)
        const pre = clone({ state: input.state, executions: input.executions, events: input.events })
        const cfgBefore = clone(input.cfg)
        const out = orig(input)
        const cfgAfter = clone(input.cfg)
        if (pre && cfgAfter) {
          const replayInput = { ...input, cfg: cfgAfter, state: pre.state, executions: pre.executions, events: pre.events }
          const first = keyed(input.cfg)
          orig(replayInput)
          replays++
          const second = keyed(cfgAfter)
          // 探针 B：空行 / 空事件输入下，「有历史」与「无历史」两份 cfg 的结果是否相同
          const hA = clone(input.cfg), hB = cfgBefore && clone(cfgBefore)
          const st = clone(input.state)
          if (hA && hB && st) {
            try {
              orig({ ...input, cfg: hA, state: st, executions: [], events: [] })
              orig({ ...input, cfg: hB, state: clone(input.state), executions: [], events: [] })
              const a = keyed(hA), b = keyed(hB), f0 = keyed(cfgBefore as any)
              for (const k of new Set([...a.keys(), ...b.keys()])) {
                if (a.get(k) === b.get(k)) continue
                // 只算本钩子写过的键：第一次调用前后变化过
                if (f0.get(k) === first.get(k)) continue
                const id = `${mod.id}(${mod.agentIds.join('/')}):${hook}:${k}`
                if (ALLOW.has(id)) continue
                staleB.set(id, (staleB.get(id) ?? 0) + 1)
              }
            } catch { /* 空输入不合法的钩子跳过 */ }
          }
          for (const k of new Set([...first.keys(), ...second.keys()])) {
            if (first.get(k) === second.get(k)) continue
            const id = `${mod.id}(${mod.agentIds.join('/')}):${hook}:${k}`
            if (ALLOW.has(id)) continue
            diffs.set(id, (diffs.get(id) ?? 0) + 1)
          }
        }
        return out
      }
      ;(mod as any)[hook] = wrapped
      restores.push(() => { (mod as any)[hook] = orig })
    }
  }
  return n
}

afterAll(() => { for (const r of restores) r() })

describe('CC-292 重复调用钩子重放一致', () => {
  it('全角色 × 命座 0/6 + 全部三人预设：① 重放一致 ② 无陈旧值', async () => {
    await setupHarness(['', '', ''])
    expect(wrapAll(), '没有包住任何钩子').toBeGreaterThan(10)
    for (const agentId of agentIds) {
      for (const cinemaLevel of [0, 6]) {
        replayCount.clear()
        await setupHarness([{ agentId, cinemaLevel }] as any)
        expect(useResourceCalc().resourceResult.value, `${agentId} C${cinemaLevel}`).toBeTruthy()
      }
    }
    for (const p of teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)) {
      replayCount.clear()
      const { catalog, config } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
      config.applyTeamPreset(p.team as [string, string, string])
      expect(calc.resourceResult.value, p.id).toBeTruthy()
    }
    expect(replays, '一次重放都没发生').toBeGreaterThan(500)
    const found = [...diffs].map(([id, c]) => `${id} ×${c}`).sort()
    expect(found, '① 钩子第二次调用改变了 cfg——写入依赖了上一次调用的结果（见文件头）').toEqual([])
    const stale = [...staleB].map(([id, c]) => `${id} ×${c}`).sort()
    expect(stale, '② 空输入下「有历史 / 无历史」结果不同——某条路径没覆盖本钩子写过的键，留下上一次的旧值（CC-288 型）').toEqual([])
  }, 900_000)
})
