/**
 * 队友 buff 启用状态的纯派生（评审第二梯队 #9 的抽取物）。
 *
 * 为什么值得测：这段判定在抽取前内联在 `useConfigStore` 的 sync 方法里，只能靠
 * 「建 store + 载 catalog + 组队」才触达，边界（不在队/影画不足/特例分支）从来没有独立断言。
 * 抽成模块级纯函数后，用**合成输入**即可钉住每条分支——这正是本次抽取的收益。
 *
 * 口径提醒：本函数只回答「**应该**启用吗」（派生值）；用户手动开关与覆盖率由 store 的
 * 选择表持有，见 `syncTeammateBuffsFromTeam` 的合并逻辑（那部分由全量测试与
 * teammateBuff* 相关集成测试覆盖，本文件不重复）。
 */
import { describe, expect, it } from 'vitest'
import { deriveTeammateBuffEnabled } from '@/stores/config'
import type { Agent, TeammateBuff, TeammateBuffGroup } from '@/types/catalog'

// ---- 合成 fixture（只填判定需要的字段；其余用 cast 跳过，避免为测试虚构整份 Agent） ----
const mkAgent = (id: string, extra: Record<string, unknown> = {}): Agent =>
  ({ id, specialty: 'attack', faction: 'fx', ...extra }) as unknown as Agent

/** 造一个队友 buff（判定只读 id / sourceLabel / ownerId） */
const mkBuff = (id: string, sourceLabelZhCN: string, ownerId = ''): TeammateBuff =>
  ({ id, sourceLabel: { zhCN: sourceLabelZhCN }, source: { zhCN: sourceLabelZhCN }, ownerId }) as unknown as TeammateBuff

const mkGroup = (id: string, buffs: TeammateBuff[]): TeammateBuffGroup =>
  ({ id, buffs, name: { zhCN: id }, attribute: 'atk', specialty: 'attack' }) as unknown as TeammateBuffGroup

/** 队伍槽位（只填派生读取的字段） */
const slot = (agentId: string, cinemaLevel = 0) =>
  ({ slot: 0, agentId, cinemaLevel, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 })

const NO_AGENT = () => undefined

describe('deriveTeammateBuffEnabled（基础：在队 × 影画门槛）', () => {
  const groups = [mkGroup('A1', [
    mkBuff('a.core', '核心被动'),      // 无影画要求
    mkBuff('a.c2', '影画二'),          // 需 影画2
    mkBuff('a.c6', '影画六'),          // 需 影画6
  ])]
  const agents: Record<string, Agent> = { A1: mkAgent('A1') }
  const getAgent = (id: string) => agents[id]

  it('不在队 → 全部 false（即使影画满）', () => {
    const out = deriveTeammateBuffEnabled([slot('OTHER', 6)], groups, getAgent)
    expect(out).toEqual([
      { id: 'a.core', enabled: false },
      { id: 'a.c2', enabled: false },
      { id: 'a.c6', enabled: false },
    ])
  })

  it('在队 + 影画达标 → 按各自门槛启用', () => {
    const out = deriveTeammateBuffEnabled([slot('A1', 2)], groups, getAgent)
    expect(out).toEqual([
      { id: 'a.core', enabled: true },   // 无门槛
      { id: 'a.c2', enabled: true },     // 2 >= 2
      { id: 'a.c6', enabled: false },    // 2 < 6
    ])
  })

  it('影画 6 → 三条全开', () => {
    const out = deriveTeammateBuffEnabled([slot('A1', 6)], groups, getAgent)
    expect(out.every(o => o.enabled)).toBe(true)
  })

  it('空队 / 空 groups → 安全（空队全 false；空 groups 空数组）', () => {
    expect(deriveTeammateBuffEnabled([], groups, getAgent).every(o => !o.enabled)).toBe(true)
    expect(deriveTeammateBuffEnabled([slot('A1', 6)], [], getAgent)).toEqual([])
  })

  it('agentId 查不到 Agent 时视为不在队（与抽取前的 filter(!!agent) 一致）', () => {
    expect(deriveTeammateBuffEnabled([slot('A1', 6)], groups, NO_AGENT).every(o => !o.enabled)).toBe(true)
  })
})

describe('deriveTeammateBuffEnabled（teammateBuffId 二级映射）', () => {
  it('group.id 命中 agent.teammateBuffId 也算在队', () => {
    const groups = [mkGroup('TB9', [mkBuff('tb.core', '核心被动')])]
    const agents: Record<string, Agent> = { A1: mkAgent('A1', { teammateBuffId: 'TB9' }) }
    const out = deriveTeammateBuffEnabled([slot('A1', 0)], groups, id => agents[id])
    expect(out).toEqual([{ id: 'tb.core', enabled: true }])
  })
})

describe('deriveTeammateBuffEnabled（角色特例分支）', () => {
  it('波可娜(1351) C6：base 条被禁用（防与 pulchra_cinema_6_trap_all 双计）', () => {
    const groups = [mkGroup('1351', [mkBuff('pulchra_extra_trap_followup', '核心被动')])]
    const agents: Record<string, Agent> = { 1351: mkAgent('1351') }
    const getAgent = (id: string) => agents[id]
    expect(deriveTeammateBuffEnabled([slot('1351', 5)], groups, getAgent)[0].enabled).toBe(true)
    expect(deriveTeammateBuffEnabled([slot('1351', 6)], groups, getAgent)[0].enabled).toBe(false)
  })

  it('雷米尔(1581) 分层：tier = 队内异常角色数（1..3），三条 atk buff 各自只认自己那层', () => {
    const groups = [mkGroup('1581', [
      mkBuff('1581.additional_ability.atk_1_anomaly', '额外能力'),
      mkBuff('1581.additional_ability.atk_2_anomaly', '额外能力'),
      mkBuff('1581.additional_ability.atk_3_anomaly', '额外能力'),
      mkBuff('1581.core_passive.refringe_3_anomaly', '核心被动'),
      mkBuff('1581.additional_ability.prismatic_buildup', '额外能力'),
    ])]
    const agents: Record<string, Agent> = {
      1581: mkAgent('1581'),
      AN1: mkAgent('AN1', { specialty: 'anomaly' }),
      AN2: mkAgent('AN2', { specialty: 'anomaly' }),
      AN3: mkAgent('AN3', { specialty: 'anomaly' }),
    }
    const getAgent = (id: string) => agents[id]
    const run = (others: string[]) =>
      Object.fromEntries(deriveTeammateBuffEnabled([slot('1581', 0), ...others.map(a => slot(a, 0))], groups, getAgent)
        .map(o => [o.id, o.enabled]))

    // 1 个异常队友 → tier1
    const t1 = run(['AN1'])
    expect(t1['1581.additional_ability.atk_1_anomaly']).toBe(true)
    expect(t1['1581.additional_ability.atk_2_anomaly']).toBe(false)
    expect(t1['1581.additional_ability.prismatic_buildup']).toBe(true)  // active 即可
    expect(t1['1581.core_passive.refringe_3_anomaly']).toBe(false)      // 需 tier3
    // 2 个 → tier2
    const t2 = run(['AN1', 'AN2'])
    expect(t2['1581.additional_ability.atk_1_anomaly']).toBe(false)
    expect(t2['1581.additional_ability.atk_2_anomaly']).toBe(true)
    // 3 个 → tier3（同时满足 core_passive）
    const t3 = run(['AN1', 'AN2', 'AN3'])
    expect(t3['1581.additional_ability.atk_3_anomaly']).toBe(true)
    expect(t3['1581.core_passive.refringe_3_anomaly']).toBe(true)
    // 无异常队友且不同阵营 → 不 active
    const t0 = run([])
    expect(t0['1581.additional_ability.prismatic_buildup']).toBe(false)
    expect(t0['1581.additional_ability.atk_1_anomaly']).toBe(false)
  })
})

describe('deriveTeammateBuffEnabled（输出契约）', () => {
  it('顺序 = groups 遍历顺序再展开 buffs（写入端依赖该顺序决定对象键序）', () => {
    const groups = [
      mkGroup('G2', [mkBuff('g2.a', '核心被动'), mkBuff('g2.b', '核心被动')]),
      mkGroup('G1', [mkBuff('g1.a', '核心被动')]),
    ]
    const agents: Record<string, Agent> = { G2: mkAgent('G2'), G1: mkAgent('G1') }
    const out = deriveTeammateBuffEnabled([slot('G2', 0), slot('G1', 0)], groups, id => agents[id])
    expect(out.map(o => o.id)).toEqual(['g2.a', 'g2.b', 'g1.a'])
  })

  it('重复 buff id 原样输出（去重不是本函数职责，由上游数据保证）', () => {
    const groups = [mkGroup('G', [mkBuff('dup', '核心被动'), mkBuff('dup', '核心被动')])]
    const agents: Record<string, Agent> = { G: mkAgent('G') }
    expect(deriveTeammateBuffEnabled([slot('G', 0)], groups, id => agents[id])).toHaveLength(2)
  })

  it('组内 buffs 缺失 → 跳过（与抽取前的 `group.buffs ?? []` 一致）', () => {
    const groups = [{ id: 'G', name: { zhCN: 'G' }, attribute: 'atk', specialty: 'attack' } as unknown as TeammateBuffGroup]
    const agents: Record<string, Agent> = { G: mkAgent('G') }
    expect(deriveTeammateBuffEnabled([slot('G', 0)], groups, id => agents[id])).toEqual([])
  })
})
