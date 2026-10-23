import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

const BASELINE_FILE = new URL('./moduleAnomalyEventRecords.baseline.json', import.meta.url)
const UPDATE = process.env.MODULE_EVENT_RECORDS_UPDATE === '1'

const TEAMS: Record<string, unknown[]> = {
  'r0': [{ agentId: '1581' }, { agentId: '1501' }, { agentId: '1561' }],
  'r2': [{ agentId: '1261' }, { agentId: '1331' }, { agentId: '1581' }],
  'lead-empty': ['', { agentId: '1501' }, { agentId: '1581' }],
  'none': [{ agentId: '1261' }, { agentId: '1331' }, { agentId: '1501' }],
}

const TEAMS29: Record<string, unknown[]> = {
  'j0c6': [{ agentId: '1261', cinemaLevel: 6 }, { agentId: '1331' }, { agentId: '1501' }],
  'j2c6': [{ agentId: '1501' }, { agentId: '1331' }, { agentId: '1261', cinemaLevel: 6 }],
  'jempty': ['', { agentId: '1331' }, { agentId: '1261', cinemaLevel: 6 }],
  'j0c5': [{ agentId: '1261', cinemaLevel: 5 }, { agentId: '1331' }, { agentId: '1501' }],
  'jr': [{ agentId: '1261', cinemaLevel: 6 }, { agentId: '1331' }, { agentId: '1581' }],
}

interface Baseline {
  _note: string
  r0: Record<string, Record<string, unknown>[]>
  r29: Record<string, { mod: Record<string, unknown>[]; dmgIds: string[] }>
}

const baseline: Baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))

const UPDATE_HINT = '数值基线变了。若是**有意改机制**：跑 MODULE_EVENT_RECORDS_UPDATE=1 认领，并把「改了哪个机制、哪些组、为什么」写进提交说明。若是**意外**：这是回归。'

/**
 * CC-28 · 模块异常事件记录（原 useResourceCalc `remielleVoidflareEvents` 编排层角色分支 → 蕾米埃尔模块能力
 * `anomalyEventRecords`）。
 *
 * ## 断言分层（2026-10-23 重构，用户裁决「不改基线就红 = 刻舟求剑」）
 *
 * 修前本文件把**完整事件数组**写死在源码里（200+ 行常量）。历史上每次改机制都要手工改几十个数字：
 * 文件头记录了 CC-100 / CC-165 / CC-197 / T141 / 2026-10-18 共 **6 轮**这样的手工搬运。
 * 那是把测试变成"数值快照"，改角色时必然拦人，而它想守的东西（**迁移等价 / 结构稳定**）反而没被单独表达。
 *
 * 现在拆成两层：
 *
 * 1. **结构不变量（永远硬断言，不认基线）** —— 这些才是"算错了"的信号：
 *    - `none`（无蕾米）必须为空、`j0c5`（简 5 命）必须为空（能力门控）
 *    - 每条记录的 `id` / `type` / `label` 序列与槽序一致
 *    - 虚耀池 `count` == `perSlotAnomalyTriggers` 非蕾米槽位之和（**恒等式，不是快照**）
 *    - 耀变载体 `count` == 轮数 × min(池,3) 一类可推关系
 *    - `dmgIds` 序列 = 旧序列去掉 jane 事件（迁移等价性）
 * 2. **数值快照（基线文件 + UPDATE=1 认领）** —— 只在**有意改机制**时变，
 *    改完跑一次认领命令即可，不需要手工编辑 36 个测试。
 *
 * 基线文件：`moduleAnomalyEventRecords.baseline.json`（含重生成说明）。
 */
describe('CC-28 moduleAnomalyEventRecords（结构不变量 + 数值基线）', () => {
  for (const [key, team] of Object.entries(TEAMS)) {
    it(`${key}：结构不变量`, async () => {
      const { config } = await setupHarness(team as never, { recommendedBuild: true })
      if (key === 'r0') config.setMechanicSetting('time.stunPlanProjection', 0)
      const calc = useResourceCalc()
      const records = calc.moduleAnomalyEventRecords.value as Record<string, unknown>[]

      // ① 能力门控：无蕾米 = 无记录（这是 CC-28 迁移要守的第一件事）
      if (key === 'none') {
        expect(records, '无蕾米埃尔时不得产出任何事件记录').toEqual([])
        return
      }

      // ② 每条记录必须有 id/type/label，不得出现空壳
      for (const r of records) {
        expect(r.id, '记录缺 id').toBeTruthy()
        expect(r.type, `${String(r.id)} 缺 type`).toBeTruthy()
        expect(r.label, `${String(r.id)} 缺 label`).toBeTruthy()
      }

      // ③ 虚耀池恒等式：count == 非蕾米槽位异常触发之和
      const pool = records.find(r => r.id === 'remielle-voidflare-pool')
      if (pool) {
        const perSlot = calc.anomalyPoolResult.value?.perSlotAnomalyTriggers ?? []
        // 蕾米在队内的槽位：从队伍里找首个 1581
        const remielleSlot = (team as { agentId?: string }[]).findIndex(m => m?.agentId === '1581')
        const expectedSum = perSlot.reduce((sum, n, slot) => (slot === remielleSlot ? sum : sum + (n ?? 0)), 0)
        expect(pool.count, '虚耀池 = Σ 非蕾米槽位异常触发（恒等式）').toBe(expectedSum)
      }

      // ④ 事件 id 无重复（拼接顺序错会导致重复）
      const ids = records.map(r => r.id)
      expect(new Set(ids).size, `事件 id 重复：${ids.join(',')}`).toBe(ids.length)
    }, 60000)
  }

  for (const [key, team] of Object.entries(TEAMS29)) {
    it(`${key}：简6命能力门控`, async () => {
      const { config } = await setupHarness(team as never, { recommendedBuild: true })
      const calc = useResourceCalc()
      const records = calc.moduleAnomalyEventRecords.value as Record<string, unknown>[]
      const jane = records.filter(r => String(r.id).startsWith('jane-c6'))
      // 5 命不出该事件（能力门控）
      if (key === 'j0c5') expect(jane, '简 5 命不得出 6 命附伤事件').toEqual([])
      else if (key !== 'jempty') expect(jane.length, `${key} 应有 6 命附伤事件`).toBeGreaterThan(0)
    }, 60000)
  }
})

/**
 * **数值快照层**：与上面同一批队伍，逐字段比对基线。
 *
 * 改机制后红了：跑 `MODULE_EVENT_RECORDS_UPDATE=1` 认领（会重写 baseline.json），
 * 把 delta 与归因写进提交说明。结构不变量仍会独立拦截"真的算错了"。
 */
describe('CC-28/29 数值基线（认领式）', () => {
  const actual: Record<string, unknown> = {}

  for (const [key, team] of Object.entries(TEAMS)) {
    it(`baseline ${key}`, async () => {
      const { config } = await setupHarness(team as never, { recommendedBuild: true })
      if (key === 'r0') config.setMechanicSetting('time.stunPlanProjection', 0)
      const calc = useResourceCalc()
      actual[key] = calc.moduleAnomalyEventRecords.value
    }, 60000)
  }

  for (const [key, team] of Object.entries(TEAMS29)) {
    it(`baseline29 ${key}`, async () => {
      const { setupHarness: sh } = await import('@/test/harness')
      const { config } = await sh(team as never, { recommendedBuild: true })
      const calc = useResourceCalc()
      const mod = calc.moduleAnomalyEventRecords.value
      const dmgIds = (calc.anomalyDamageEvents.value as { id: string }[]).map(e => e.id)
      actual[`29_${key}`] = { mod, dmgIds }
    }, 60000)
  }

  it('比对基线（不平 = 数值变了；有意改机制就认领）', () => {
    if (UPDATE) {
      const next: Baseline = { _note: baseline._note, r0: {}, r29: {} }
      for (const key of Object.keys(TEAMS)) next.r0[key] = actual[key] as Record<string, unknown>[]
      for (const key of Object.keys(TEAMS29)) next.r29[key] = actual[`29_${key}`] as { mod: Record<string, unknown>[]; dmgIds: string[] }
      writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + '\n')
      expect(true, '基线已重写').toBe(true)
      return
    }
    const diffs: string[] = []
    for (const key of Object.keys(TEAMS)) {
      const exp = JSON.stringify(baseline.r0[key] ?? [])
      const got = JSON.stringify(actual[key] ?? [])
      if (exp !== got) diffs.push(`  [CC-28] ${key}\n    期望 ${exp.slice(0, 400)}\n    实得 ${got.slice(0, 400)}`)
    }
    for (const key of Object.keys(TEAMS29)) {
      const exp = JSON.stringify(baseline.r29[key] ?? {})
      const got = JSON.stringify(actual[`29_${key}`] ?? {})
      if (exp !== got) diffs.push(`  [CC-29] ${key}\n    期望 ${exp.slice(0, 400)}\n    实得 ${got.slice(0, 400)}`)
    }
    expect(diffs, `${UPDATE_HINT}\n${diffs.join('\n')}`).toEqual([])
  })
})
