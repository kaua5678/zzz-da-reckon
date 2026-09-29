/**
 * CC-290：buildResourceResult 不得改写 cfg 上影响引擎的量（「晚写」锁）。
 *
 * 为什么：buildResourceResult 在装配末尾执行，能量账（core/resource/resourceIncome）、行物化、
 * 事件派发都早已读完 cfg ⇒ 在这里写 cfg 对引擎**无效**，只会让展示与引擎分叉。
 * 实例：CC-289 朱鸢影画6 余温回能写在这里，资源面板显示「+N 能量并入开局能量总账」，
 * 引擎实际一分未进账（1241 C6 伤害少算 4.4%），只有一条直读 cfg 的单测挡着它。
 *
 * 做法：包住所有注册模块的 buildResourceResult，前后对 cfg 逐键做 JSON 比较；
 * 场景 = 全角色 × 命座 0/6 单人 + 全部三人预设（与 timeGolden 同一批）。
 *
 * 允许名单（写后立刻在同一函数内被读、只服务展示，时机正确）：
 * - orphieBladeHits：orphie.ts buildOrphieResourceResult 写后立刻由 computeSpecResources 按 spec cfgField 读取，
 *   只进 specResources（展示）。
 * 新增名单条目必须写明「为什么不影响引擎」；想影响引擎的量应在 buildExecutions / applyTeamConfig 写入。
 */
import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { getRegisteredAgentMechanics } from '@/mechanics/registry'
import type { AgentMechanicModule } from '@/mechanics/types'

const ALLOW = new Set(['orphieBladeHits'])

const catalogData = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))
const agentIds: string[] = (catalogData.agents ?? []).map((a: { id: number | string }) => String(a.id))

const lateWrites = new Map<string, Set<string>>()
const restores: Array<() => void> = []

function snapshot(cfg: Record<string, unknown>): Map<string, string> {
  const m = new Map<string, string>()
  for (const k of Object.keys(cfg)) {
    let v: string
    try { v = JSON.stringify(cfg[k]) ?? 'undefined' } catch { v = String(cfg[k]) }
    m.set(k, v)
  }
  return m
}

function wrapAll(): number {
  let n = 0
  for (const mod of getRegisteredAgentMechanics()) {
    const orig = mod.buildResourceResult
    if (!orig) continue
    n++
    const wrapped: NonNullable<AgentMechanicModule['buildResourceResult']> = input => {
      const cfg = input.cfg as unknown as Record<string, unknown>
      const before = snapshot(cfg)
      const out = orig(input)
      const after = snapshot(cfg)
      for (const k of new Set([...before.keys(), ...after.keys()])) {
        if (before.get(k) === after.get(k) || ALLOW.has(k)) continue
        const label = `${mod.id}(${mod.agentIds.join("/")})`
        const set = lateWrites.get(label) ?? new Set<string>()
        set.add(k)
        lateWrites.set(label, set)
      }
      return out
    }
    ;(mod as { buildResourceResult?: unknown }).buildResourceResult = wrapped
    restores.push(() => { (mod as { buildResourceResult?: unknown }).buildResourceResult = orig })
  }
  return n
}

afterAll(() => { for (const r of restores) r() })

describe('CC-290 buildResourceResult 不改写 cfg（晚写锁）', () => {
  it('全角色 × 命座 0/6 + 全部三人预设：除允许名单外无晚写', async () => {
    await setupHarness(['', '', ''])
    const wrapped = wrapAll()
    expect(wrapped, '没有包住任何 buildResourceResult（注册表为空？）').toBeGreaterThan(10)
    for (const agentId of agentIds) {
      for (const cinemaLevel of [0, 6]) {
        await setupHarness([{ agentId, cinemaLevel }] as any)
        expect(useResourceCalc().resourceResult.value, `${agentId} C${cinemaLevel}`).toBeTruthy()
      }
    }
    for (const p of teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)) {
      const { catalog, config } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
      config.applyTeamPreset(p.team as [string, string, string])
      expect(calc.resourceResult.value, p.id).toBeTruthy()
    }
    const found = [...lateWrites].map(([id, keys]) => `${id}: ${[...keys].join(', ')}`)
    expect(found, 'buildResourceResult 改写了 cfg——该量若要影响引擎，请移到 buildExecutions / applyTeamConfig（见 CC-289）').toEqual([])
  }, 900_000)
})
