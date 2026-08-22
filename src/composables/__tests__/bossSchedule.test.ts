/**
 * Boss 排期 × 危局期数轴（bossSchedule）测试：
 * - indexForDate/nodeIdForDate 日期窗口边界（早于首期 -1/null、边界含、窗口匹配、末节点无上界）
 * - buildPeriodAxis 聚合（按 begin 排序 / 同(期,Boss,模式)去重 / 双模式分列 / 测试服期剔除）
 * - 真实数据冒烟（47 期默认剔除 3 个测试服占位期；每期都有普通 Boss；仅近期有困难行）
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { VERSION_NODES } from '@/data/versionTimeline'
import { buildPeriodAxis, indexForDate, nodeIdForDate } from '@/composables/bossSchedule'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'

const bossText = readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')
const bossData = JSON.parse(bossText) as { bosses: BossPreset[] }

const NODES = [
  { id: 'P1', date: '2024-12-20' },
  { id: 'P2', date: '2025-01-03' },
  { id: 'P3', date: '2025-01-17' },
]

function mkPhase(overrides: Partial<BossPresetPhase> & { phaseId: string; begin: string }): BossPresetPhase {
  return {
    zoneKey: 'z',
    version: '2.0',
    label: `v · ${overrides.begin.slice(0, 10)}`,
    modeType: 'defense',
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
    isCriticalAssault: false,
    monster: { stunVuln: 1.5, stunTime: 12, name },
    defaults: { battleTime: 180, shieldCount: 0, energyShield: 0 },
    phases,
  }
}

describe('indexForDate 日期窗口', () => {
  it('早于首期 → -1/null；恰逢边界归新节点；末节点无上界', () => {
    expect(indexForDate(NODES, '')).toBe(-1)
    expect(nodeIdForDate(NODES, '')).toBeNull()
    expect(indexForDate(NODES, '2024-12-01')).toBe(-1)
    expect(indexForDate(NODES, '2024-12-20')).toBe(0) // 首期当天含
    expect(nodeIdForDate(NODES, '2024-12-25 04:00:00')).toBe('P1') // 带时分秒取前 10 位
    expect(indexForDate(NODES, '2025-01-03')).toBe(1) // 边界日 = 下期开始
    expect(indexForDate(NODES, '2025-02-01')).toBe(2)
    expect(nodeIdForDate(NODES, '2030-01-01')).toBe('P3') // 末期无上界
  })
})

describe('buildPeriodAxis 期数轴聚合', () => {
  const bosses = [
    mkBoss('bA', '普通甲', [
      mkPhase({ phaseId: '69001', begin: '2024-12-20 04:00:00' }), // P0 普通
      mkPhase({ phaseId: '69002', begin: '2025-01-10 04:00:00' }), // P1 普通
      mkPhase({ phaseId: '69002b', begin: '2025-01-09 04:00:00' }), // 注意：begin 更早但 id 更大 → 按 begin 排序应在 69002 前
      mkPhase({ phaseId: '69002', begin: '2025-01-11 04:00:00' }), // 同(期,Boss)重复 → 去重
    ]),
    mkBoss('bB', '困难乙', [
      mkPhase({ phaseId: '69002', begin: '2025-01-10 04:00:00', modeType: 'critical_assault' }), // P1 困难
      mkPhase({ phaseId: '69003', begin: '' }), // 缺 begin → 跳过
    ]),
  ]

  it('按 begin 排序（id 不参与）、双模式分列、同(期,Boss,模式)去重、缺 begin 跳过', () => {
    const axis = buildPeriodAxis(bosses)
    // 69002b 与 69002 begin 相差一天，按 begin 排序 69002b 在前（id 数值序会把 69002 排前面）
    expect(axis.map(p => p.id)).toEqual(['69001', '69002b', '69002'])
    const p1 = axis.find(p => p.id === '69002')!
    expect(p1.normalBosses).toEqual([{ bossId: 'bA', bossName: '普通甲' }])
    expect(p1.criticalBosses).toEqual([{ bossId: 'bB', bossName: '困难乙' }])
  })

  it('测试服占位期默认剔除，includeTestServer 可放行', () => {
    const ts = new Set(['9.9'])
    const mk = () => [mkBoss('ts', '测试服君', [mkPhase({ phaseId: '99001', begin: '2025-02-01 04:00:00', version: '9.9' })])]
    // 默认（未显式放行）即剔除
    expect(buildPeriodAxis(mk(), { testServerVersions: ts }).some(p => p.id === '99001')).toBe(false)
    expect(buildPeriodAxis(mk(), { includeTestServer: false, testServerVersions: ts }).some(p => p.id === '99001')).toBe(false)
    expect(buildPeriodAxis(mk(), { includeTestServer: true, testServerVersions: ts }).some(p => p.id === '99001')).toBe(true)
  })
})

describe('真实数据冒烟', () => {
  it('47 期默认剔除 3 个测试服占位期；全部按 begin 升序且每期都有危局·普通 Boss', () => {
    const ts = new Set(VERSION_NODES.filter(n => (n.note ?? '').includes('测试服')).map(n => n.version))
    const axis = buildPeriodAxis(bossData.bosses, { testServerVersions: ts })
    expect(axis.length).toBeGreaterThanOrEqual(40)
    for (let i = 1; i < axis.length; i++) {
      expect(axis[i].begin >= axis[i - 1].begin).toBe(true)
    }
    for (const p of axis) {
      expect(p.normalBosses.length).toBeGreaterThan(0)
    }
    // 仅最近数期才有困难行
    const withCritical = axis.filter(p => p.criticalBosses.length > 0)
    expect(withCritical.length).toBeGreaterThan(0)
    expect(withCritical.length).toBeLessThan(axis.length)
  })

  it('选中排期里的任一 Boss 都能查到出场期数（如 秽息司祭）', () => {
    const ts = new Set(VERSION_NODES.filter(n => (n.note ?? '').includes('测试服')).map(n => n.version))
    const axis = buildPeriodAxis(bossData.bosses, { testServerVersions: ts })
    const priest = axis.filter(p => [...p.normalBosses, ...p.criticalBosses].some(b => b.bossName.includes('司祭')))
    expect(priest.length).toBeGreaterThan(0)
  })
})
