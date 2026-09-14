/**
 * 自由对比工作台 · 纯函数层测试（配置码 / x 维度枚举 / 指标注册表）
 *
 * 为什么先测纯函数：求值器（`engine.ts`）要跑真引擎（单次 ~0.3-0.4s，见 TeamComparePage 注释
 * 「每队 ~10 次 ≈ 3~4 秒」推算），把它塞进每个用例会让套件慢到没法用；而**自由对比的语义正确性
 * 全在纯函数层**（配置码怎么解析、x 档位怎么枚举、指标怎么读）—— 这些错了，跑再多引擎也是错的。
 *
 * 判据（AGENTS 规则 9 + 本仓红线「判 X 没实现之前先三层 grep」）：
 * 这里每一条断言都是「会红的断言」——改错实现就红，不是复读实现。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AXIS_ID,
  DEFAULT_SETUP_CODES,
  AXES,
  AXIS_BY_ID,
  type SeriesSpec,
  parseSetupCode,
  formatSetupCode,
  setupCodeGold,
  setupCodeLabel,
} from '@/composables/freeCompare/axes'
import {
  METRICS,
  METRIC_BY_ID,
  TOTAL_KEY,
  formatMetric,
  metricDef,
  type MetricEnv,
} from '@/composables/freeCompare/metrics'
import { constraintSummary } from '@/composables/freeCompare/constraints'

const spec = (members: string[], code: string): SeriesSpec => ({
  id: `${members.join('-')}-${code}`,
  kind: members.length === 1 ? 'agent' : 'team',
  members,
  code: parseSetupCode(code)!,
})

describe('配置码（用户口径：左=影画 0-6，右=专武精炼 1-5，右位 0 = 无专武）', () => {
  it('21 = 2命 + 精炼1；01 = 0命 + 本体（用户原话逐字对上）', () => {
    expect(parseSetupCode('21')).toEqual({ cinema: 2, wengine: 1 })
    expect(parseSetupCode('01')).toEqual({ cinema: 0, wengine: 1 })
    expect(setupCodeLabel(parseSetupCode('21')!)).toBe('2命 精1')
    expect(setupCodeLabel(parseSetupCode('01')!)).toBe('0命 精1')
  })

  it('右位 0（如 20）= 无专武 —— 这是提案里必须点明的边界', () => {
    const c = parseSetupCode('20')!
    expect(c).toEqual({ cinema: 2, wengine: 0 })
    expect(setupCodeLabel(c)).toBe('2命 无专武')
  })

  it('金数：无专武 0 金、精炼1 = 本体 0 金、每级 +1（与团队对比「限定金」口径一致）', () => {
    expect(setupCodeGold(parseSetupCode('01')!)).toBe(0)
    expect(setupCodeGold(parseSetupCode('11')!)).toBe(1)
    expect(setupCodeGold(parseSetupCode('21')!)).toBe(2)
    // 20：2 命 = 2 金，无专武 = 0 金
    expect(setupCodeGold(parseSetupCode('20')!)).toBe(2)
    // 25：2 命 + 精炼5（精炼1是本体，故精炼只算 4 金）
    expect(setupCodeGold(parseSetupCode('25')!)).toBe(6)
  })

  it('非法码返回 null 不抛（UI 直接标红，不让工作台白屏）', () => {
    expect(parseSetupCode('')).toBeNull()
    expect(parseSetupCode('2')).toBeNull()
    expect(parseSetupCode('211')).toBeNull()
    expect(parseSetupCode('ab')).toBeNull()
    // 影画 >6 / 精炼 >5 越界
    expect(parseSetupCode('71')).toBeNull()
    expect(parseSetupCode('26')).toBeNull()
  })

  it('66 应当非法（精炼上限 5）；65 是合法上界', () => {
    expect(parseSetupCode('66')).toBeNull()
    expect(parseSetupCode('65')).toEqual({ cinema: 6, wengine: 5 })
  })

  it('往返：format(parse(x)) === x', () => {
    for (const c of ['00', '01', '11', '21', '20', '65']) {
      expect(formatSetupCode(parseSetupCode(c)!)).toBe(c)
    }
  })
})

describe('x 维度注册表（加维度 = 加一行）', () => {
  it('默认维度是配置码（用户原话「21 对比 11」）', () => {
    expect(DEFAULT_AXIS_ID).toBe('setupCode')
    expect(AXIS_BY_ID.get(DEFAULT_AXIS_ID)?.label).toBe('配置码')
  })

  it('配置码维度默认档位 = 用户原话里的四个码', () => {
    const axis = AXIS_BY_ID.get('setupCode')!
    const levels = axis.levels(spec(['1171'], '21'), {})
    expect(levels.map(l => l.label)).toEqual([...DEFAULT_SETUP_CODES])
  })

  it('影画维度 0→6 共 7 档，且只覆盖 cinema（不改精炼 ⇒ 「任何一维单独改」判据）', () => {
    const axis = AXIS_BY_ID.get('cinema')!
    const levels = axis.levels(spec(['1171'], '21'), { cinemaMax: 6 })
    expect(levels).toHaveLength(7)
    expect(levels.map(l => l.override.cinema)).toEqual([0, 1, 2, 3, 4, 5, 6])
    // 关键：不碰 wengine
    for (const l of levels) expect(l.override.wengine).toBeUndefined()
  })

  it('精炼维度含 0 = 无专武档，且只覆盖 wengine', () => {
    const axis = AXIS_BY_ID.get('wengine')!
    const levels = axis.levels(spec(['1171'], '21'), { wengineMax: 5 })
    expect(levels.map(l => l.override.wengine)).toEqual([0, 1, 2, 3, 4, 5])
    expect(levels[0].label).toBe('无专武')
    for (const l of levels) expect(l.override.cinema).toBeUndefined()
  })

  it('金数/期数/难度维度按参数枚举', () => {
    expect(AXIS_BY_ID.get('gold')!.levels(spec(['1171'], '21'), { goldRange: [2, 5] }))
      .toHaveLength(4)
    const periods = [{ id: 'p1', label: '第1期' }, { id: 'p2', label: '第2期' }]
    expect(AXIS_BY_ID.get('period')!.levels(spec(['1171'], '21'), { periods })
      .map(l => l.override.periodId)).toEqual(['p1', 'p2'])
    expect(AXIS_BY_ID.get('difficulty')!.levels(spec(['1171'], '21'), { difficultyMax: 3 }))
      .toHaveLength(4)
  })

  it('★ 每个维度的 id 唯一且都能枚举（防复制粘贴改漏 id）', () => {
    const ids = AXES.map(a => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of AXES) {
      const levels = a.levels(spec(['1171'], '21'), {})
      expect(Array.isArray(levels)).toBe(true)
      for (const l of levels) {
        expect(Number.isFinite(l.x)).toBe(true)
        expect(typeof l.label).toBe('string')
      }
    }
  })
})

describe('指标注册表（加指标 = 加一行）', () => {
  const env: MetricEnv = { hp: 1000 }

  it('id 唯一 + 默认指标存在（用户原话「伤害曲线」）', () => {
    const ids = METRICS.map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(metricDef('teamTotalDamage')).toBeDefined()
    expect(METRIC_BY_ID.size).toBe(METRICS.length)
  })

  it('★ 每条指标的 read 都必须返回含 __total__ 的有限数（防漏聚合键 / NaN 传染）', () => {
    // 用最小假 ctx：让每条指标都走它的取值路径，读到 undefined 应被 num() 兜成 0 而不是 NaN
    const fakeCtx = {
      teamTotalDamage: { value: 12345 },
      damagePoolRows: { value: [{ slot: 0, agentId: '1171', totalDamage: 100, type: '直伤' }] },
      resourceResult: { value: { totalTime: 180, characters: [] } },
      stunPoolResult: { value: null },
      anomalyPoolResult: { value: null },
      windowDuration: { value: 16 },
    } as never
    for (const m of METRICS) {
      const vec = m.read(fakeCtx, env)
      expect(vec, `指标 ${m.id} 未返回 __total__`).toHaveProperty(TOTAL_KEY)
      for (const [k, v] of Object.entries(vec)) {
        expect(Number.isFinite(v), `指标 ${m.id} 的键 ${k} 不是有限数：${v}`).toBe(true)
      }
    }
  })

  it('伤害类指标能按角色分组（分人伤害判据）', () => {
    const ctx = {
      teamTotalDamage: { value: 300 },
      damagePoolRows: { value: [
        { slot: 0, agentId: '1171', totalDamage: 100, type: '直伤' },
        { slot: 1, agentId: '1561', totalDamage: 200, type: '直伤' },
      ] },
    } as never
    const vec = metricDef('dmgBySlot')!.read(ctx, env)
    expect(vec[TOTAL_KEY]).toBe(300)
    expect(vec['1171']).toBe(100)
    expect(vec['1561']).toBe(200)
  })

  it('Boss 血量比：hp=0 时读 0 而不是 NaN/Infinity', () => {
    const ctx = { teamTotalDamage: { value: 500 } } as never
    expect(metricDef('dmgBossHpRatio')!.read(ctx, { hp: 1000 })[TOTAL_KEY]).toBe(0.5)
    expect(metricDef('dmgBossHpRatio')!.read(ctx, { hp: 0 })[TOTAL_KEY]).toBe(0)
  })

  it('格式化：百分比读数 ×100，整数走 compact', () => {
    const ratio = metricDef('dmgBossHpRatio')!
    expect(formatMetric(ratio, 0.5)).toBe('50.0%')
    const dmg = metricDef('teamTotalDamage')!
    expect(formatMetric(dmg, 1234567)).toMatch(/\d/)
    expect(formatMetric(dmg, Number.NaN)).toBe('—')
  })

  it('scope 标注自洽：perSlot 指标才允许有角色分量', () => {
    for (const m of METRICS) {
      expect(['team', 'perSlot']).toContain(m.scope)
    }
  })
})

describe('约束（用户原话「维琳娜 0命1命2命」是条件不是系列）', () => {
  it('摘要把条件角色渲染出来', () => {
    const nameOf = (id: string) => (id === '1561' ? '维琳娜' : id)
    const s = constraintSummary(
      { conditions: [{ agentId: '1561', cinema: 2 }], gold: 6 },
      nameOf,
    )
    expect(s).toContain('维琳娜 2命')
    expect(s).toContain('6金')
  })
})
