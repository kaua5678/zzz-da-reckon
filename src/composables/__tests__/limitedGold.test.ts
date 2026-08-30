import { describe, expect, it } from 'vitest'
import { memberLimitedGold, runLimitedGold, lowGoldFrontier } from '@/composables/limitedGold'

/**
 * 金数口径 + 低金顶分前沿单测。
 * agentId 选择：限定 S = 1091(星见雅)/1511(南宫羽)/1481(琉音)/1581(蕾米埃尔)；
 * 常驻 S = 1021(猫又)/1211(丽娜)；未收录 A 级 = 1031（AGENT_RELEASE_NODE 无条目）。
 */
describe('memberLimitedGold 金数口径', () => {
  it('限定 S：本体 1 + 影画 + 精炼(phase−1)', () => {
    expect(memberLimitedGold({ agentId: '1091' })).toBe(1)
    expect(memberLimitedGold({ agentId: '1091', mindscape: 6 })).toBe(7)
    expect(memberLimitedGold({ agentId: '1091', mindscape: 6, phase: 5 })).toBe(11)
    expect(memberLimitedGold({ agentId: '1091', mindscape: 0, phase: 2 })).toBe(2)
  })

  it('缺省：mindscape 默认 0、phase 默认 1（精炼不计）', () => {
    expect(memberLimitedGold({ agentId: '1511', phase: 1 })).toBe(1)
    expect(memberLimitedGold({ agentId: '1511', mindscape: 2 })).toBe(3)
  })

  it('常驻 S（猫又/丽娜）不计金，无论影画精炼', () => {
    expect(memberLimitedGold({ agentId: '1021', mindscape: 6, phase: 5 })).toBe(0)
    expect(memberLimitedGold({ agentId: '1211', mindscape: 3, phase: 4 })).toBe(0)
  })

  it('未收录角色（A 级）不计金', () => {
    expect(memberLimitedGold({ agentId: '1031', mindscape: 6, phase: 5 })).toBe(0)
  })
})

describe('runLimitedGold 队伍求和', () => {
  it('限定 + 常驻 + A 级混合：只累加限定部分', () => {
    const team = [
      { agentId: '1091', mindscape: 6, phase: 5 }, // 1 + 6 + 4 = 11
      { agentId: '1211', mindscape: 3, phase: 4 }, // 常驻 = 0
      { agentId: '1031', mindscape: 6, phase: 5 }, // A 级 = 0
    ]
    expect(runLimitedGold(team)).toBe(11)
  })
})

describe('lowGoldFrontier 低金顶分前沿', () => {
  const room = (seasonId: string, targetId: string) => ({ seasonId, targetId })

  it('每房间只在顶分 run 里取最低金；低分低金不入选', () => {
    const A = room('s1', 't1')
    const runs = [
      { ...A, score: 65000, team: [{ agentId: '1091', mindscape: 6, phase: 5 }] }, // 顶分但 11 金
      { ...A, score: 65000, team: [{ agentId: '1091' }, { agentId: '1211' }] }, // 顶分 1 金 → 前沿
      { ...A, score: 50000, team: [{ agentId: '1211' }] }, // 低分 0 金 → 不入选（非顶分）
    ]
    const out = lowGoldFrontier(runs)
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(runs[1])
  })

  it('并列最低金全保留（同房间多支 1 金顶分队）', () => {
    const A = room('s1', 't1')
    const a = { ...A, score: 65000, team: [{ agentId: '1091' }] }
    const b = { ...A, score: 65000, team: [{ agentId: '1511' }] }
    const c = { ...A, score: 65000, team: [{ agentId: '1091', mindscape: 1 }] } // 2 金 → 排除
    const out = lowGoldFrontier([a, b, c])
    expect(out).toHaveLength(2)
    expect(out).toEqual([a, b])
  })

  it('跨房间独立取前沿（每期每个 Boss 各一组）', () => {
    const r1 = room('s1', 't1')
    const r2 = room('s1', 't2')
    const runs = [
      { ...r1, score: 65000, team: [{ agentId: '1091' }] }, // r1 前沿 1 金
      { ...r1, score: 65000, team: [{ agentId: '1091', mindscape: 2 }] },
      { ...r2, score: 64000, team: [{ agentId: '1481' }, { agentId: '1581' }] }, // r2 顶分 2 金
      { ...r2, score: 62000, team: [{ agentId: '1511' }] },
    ]
    const out = lowGoldFrontier(runs)
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.targetId).sort()).toEqual(['t1', 't2'])
    expect(out.find((r) => r.targetId === 't2')!.team).toEqual([{ agentId: '1481' }, { agentId: '1581' }])
  })

  it('顶分不是满分（无 cap）也按房间自身 maxScore 取前沿', () => {
    const A = room('s2', 't3')
    const runs = [
      { ...A, score: 59000, team: [{ agentId: '1091' }] }, // 房内顶分 1 金 → 前沿
      { ...A, score: 59000, team: [{ agentId: '1091', mindscape: 4 }] },
      { ...A, score: 58000, team: [] },
    ]
    const out = lowGoldFrontier(runs)
    expect(out).toHaveLength(1)
    expect(out[0].score).toBe(59000)
  })

  it('killedOnly：未击杀 run 不进前沿（即使顶分）', () => {
    const A = room('s1', 't1')
    const killed = { ...A, score: 65000, bossKilled: true, team: [{ agentId: '1091' }] }
    const notKilled = { ...A, score: 65000, bossKilled: false, team: [{ agentId: '1511' }] }
    const out = lowGoldFrontier([killed, notKilled], { killedOnly: true })
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(killed)
  })

  it('killedOnly：缺 bossKilled 字段视为未提供 → 跳过', () => {
    const A = room('s1', 't1')
    const killed = { ...A, score: 65000, bossKilled: true, team: [{ agentId: '1091' }] }
    const noField = { ...A, score: 65000, team: [{ agentId: '1511' }] } // 无 bossKilled
    const out = lowGoldFrontier([killed, noField], { killedOnly: true })
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(killed)
  })

  it('goldWindow：放宽到最低金 +N（同房多档低金全保留）', () => {
    const A = room('s1', 't1')
    const g1 = { ...A, score: 65000, team: [{ agentId: '1091' }] } // 1 金
    const g2 = { ...A, score: 65000, team: [{ agentId: '1091', mindscape: 1 }] } // 2 金
    const g3 = { ...A, score: 65000, team: [{ agentId: '1091', mindscape: 2 }] } // 3 金
    const g4 = { ...A, score: 65000, team: [{ agentId: '1091', mindscape: 3 }] } // 4 金
    expect(lowGoldFrontier([g1, g2, g3, g4], { goldWindow: 1 })).toEqual([g1, g2])
    expect(lowGoldFrontier([g1, g2, g3, g4], { goldWindow: 2 })).toEqual([g1, g2, g3])
  })

  it('goldWindow 取负钳制为 0（只取最低金）', () => {
    const A = room('s1', 't1')
    const g1 = { ...A, score: 65000, team: [{ agentId: '1091' }] }
    const g2 = { ...A, score: 65000, team: [{ agentId: '1091', mindscape: 1 }] }
    expect(lowGoldFrontier([g1, g2], { goldWindow: -5 })).toEqual([g1])
  })
})
