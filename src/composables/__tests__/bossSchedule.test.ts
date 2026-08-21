/**
 * Boss 排期 × 版本节点（bossSchedule）测试：
 * - nodeIdForDate 日期窗口边界（首节点前 null / 边界含 / 节点间 / 末节点无上界）
 * - buildBossSchedule 映射（双 modeType、去重、缺 begin 跳过、排序）
 * - 真实数据冒烟（boss-presets.json 全部期数落到合法节点；秽息司祭有排期）
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { VERSION_NODES } from '@/data/versionTimeline'
import { buildBossSchedule, nodeIdForDate, scheduleByNode } from '@/composables/bossSchedule'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'

const bossText = readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')
const bossData = JSON.parse(bossText) as { bosses: BossPreset[] }

const NODES = [
  { id: '1.0-1', date: '2024-07-04' },
  { id: '1.0-2', date: '2024-07-30' },
  { id: '1.1-1', date: '2024-08-14' },
]

function mkPhase(overrides: Partial<BossPresetPhase> & { phaseId: string; begin: string }): BossPresetPhase {
  return {
    zoneKey: 'z',
    version: '1.0',
    label: `v · ${overrides.begin.slice(0, 10)}`,
    modeType: 'critical_assault',
    stageName: '测试关',
    stageNum: 1,
    level: 70,
    hp: 1000,
    stunValue: 100,
    defense: 953,
    bossAnomalyCoeff: 1.1,
    damageResistances: {},
    stunResistances: {},
    anomalyResistances: {},
    weakness: [],
    resistance: [],
    ...overrides,
  }
}

function mkBoss(id: string, name: string, phases: BossPresetPhase[]): BossPreset {
  return {
    id,
    name,
    nameEn: id,
    aliases: [],
    icon: null,
    iconSource: null,
    isCriticalAssault: true,
    monster: { stunVuln: 1.5, stunTime: 12, name },
    defaults: { battleTime: 180, shieldCount: 0, energyShield: 0 },
    phases,
  }
}

describe('nodeIdForDate 日期窗口', () => {
  it('早于首节点 → null；恰逢边界日期归新节点；末节点无上界', () => {
    expect(nodeIdForDate(NODES, '')).toBeNull()
    expect(nodeIdForDate(NODES, '2024-06-01')).toBeNull()
    expect(nodeIdForDate(NODES, '2024-07-04')).toBe('1.0-1') // 首节点当天含
    expect(nodeIdForDate(NODES, '2024-07-29 04:00:00')).toBe('1.0-1') // 带时分秒取前 10 位
    expect(nodeIdForDate(NODES, '2024-07-30')).toBe('1.0-2') // 边界日 = 下节点开始
    expect(nodeIdForDate(NODES, '2024-08-20')).toBe('1.1-1')
    expect(nodeIdForDate(NODES, '2030-01-01')).toBe('1.1-1') // 末节点之后仍归末节点
  })
})

describe('buildBossSchedule', () => {
  const bosses = [
    mkBoss('b1', '危局君', [
      mkPhase({ phaseId: 'p1', begin: '2024-07-05 04:00:00' }), // 1.0-1 危局
      mkPhase({ phaseId: 'p2', begin: '2024-08-15 04:00:00' }), // 1.1-1 危局
      mkPhase({ phaseId: 'p3', begin: '2024-08-16 04:00:00', modeType: 'defense' }), // 1.1-1 试炼
      mkPhase({ phaseId: 'p-dup', begin: '2024-07-06 04:00:00' }), // 同节点同模式重复 → 去重
    ]),
    mkBoss('b2', '试炼姐', [
      mkPhase({ phaseId: 'p4', begin: '2024-07-10 04:00:00', modeType: 'defense' }),
      mkPhase({ phaseId: 'p-nobegin', begin: '', modeType: 'critical_assault' }), // 缺 begin → 跳过
      mkPhase({ phaseId: 'p5', begin: '2024-06-01 04:00:00' }), // 早于首节点 → 跳过
    ]),
  ]

  it('begin→节点映射正确，双 modeType 都收，去重与跳过生效', () => {
    const entries = buildBossSchedule(NODES, bosses)
    const key = (e: { nodeId: string; bossId: string; modeType: string }) => `${e.nodeId}:${e.bossId}:${e.modeType}`
    expect(entries.map(key)).toEqual([
      '1.0-1:b1:critical_assault',
      '1.0-1:b2:defense',
      '1.1-1:b1:critical_assault',
      '1.1-1:b1:defense',
    ])
    // 字段回填
    expect(entries[0]).toMatchObject({ bossName: '危局君', beginDate: '2024-07-05', stageName: '测试关' })
  })

  it('scheduleByNode 分组保持时间轴顺序', () => {
    const m = scheduleByNode(buildBossSchedule(NODES, bosses))
    expect([...m.keys()]).toEqual(['1.0-1', '1.1-1'])
    expect(m.get('1.1-1')!.map(e => e.modeType)).toEqual(['critical_assault', 'defense']) // 危局在前
  })
})

describe('真实数据冒烟', () => {
  it('boss-presets.json 全部期数落到合法版本节点；危局/试炼都有覆盖', () => {
    const entries = buildBossSchedule(VERSION_NODES, bossData.bosses)
    expect(entries.length).toBeGreaterThan(0)
    const nodeIds = new Set(VERSION_NODES.map(n => n.id))
    for (const e of entries) expect(nodeIds.has(e.nodeId), `${e.bossName} ${e.phaseLabel} 落到未知节点`).toBe(true)
    expect(entries.some(e => e.modeType === 'critical_assault')).toBe(true)
    expect(entries.some(e => e.modeType === 'defense')).toBe(true)
  })

  it('选中排期里的任一 Boss 都能查到出场节点（如 秽息司祭）', () => {
    const entries = buildBossSchedule(VERSION_NODES, bossData.bosses)
    const priest = entries.filter(e => e.bossName.includes('司祭'))
    expect(priest.length).toBeGreaterThan(0)
    for (const e of priest) expect(VERSION_NODES.some(n => n.id === e.nodeId)).toBe(true)
  })
})
