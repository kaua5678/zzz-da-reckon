/**
 * 敌方削弱 statId 生成 + legacy 别名归一层（规则 15 的 id↔口径高危区）。
 *
 * 为什么补（2026-09-12 覆盖体检，11 个零测模块中真缺口第二档）：
 * 它是 buff/spec 数据能对上引擎字段的**唯一桥**——归一错了不报错，只会让对应削弱**静默不生效**
 * （SOP §3.5 点名的"buff 没生效"症状上游）。且 legacy 别名路径（三种旧格式）**只有旧数据会走到**，
 * 上游引擎测试全用现名，间接覆盖不到这里的正则分支。
 * 对照 `inCombatBuffs`：同在零测名单，但它活在面板主路径上、allAgentsSweep 60 角色全穿过——
 * **间接覆盖已到位，不为其灌水**（体检结论一并记录，防下任重复劳动）。
 */
import { describe, expect, it } from 'vitest'
import {
  DAMAGE_ELEMENTS,
  ENEMY_DEBUFF_KIND_CONFIG,
  GENERATED_ENEMY_DEBUFF_STAT_IDS,
  LEGACY_ENEMY_DEBUFF_STAT_IDS,
  STANDARD_ENEMY_DEBUFF_ELEMENTS,
  enemyDebuffElementStatId,
  enemyDebuffStatId,
  isEnemyDebuffStat,
  normalizeEnemyDebuffStatAlias,
  type EnemyDebuffKind,
} from '@/utils/enemyDebuffStats'

const KINDS = Object.keys(ENEMY_DEBUFF_KIND_CONFIG) as EnemyDebuffKind[]

describe('enemyDebuffStatId（生成规则）', () => {
  it('无元素 / all → 基础 id', () => {
    expect(enemyDebuffStatId('def')).toBe('enemyDefReduction')
    expect(enemyDebuffStatId('res', 'all')).toBe('enemyResReduction')
  })

  it('元素 → enemy{Prefix}{Suffix}', () => {
    expect(enemyDebuffStatId('def', 'fire')).toBe('enemyFireDefReduction')
    expect(enemyDebuffStatId('stunRes', 'lumiflux')).toBe('enemyLumifluxStunResReduction')
    expect(enemyDebuffStatId('anomalyRes', 'electric')).toBe('enemyElectricAnomalyResReduction')
  })

  it('★ 未知元素静默回落基础 id（设计如此：如 lumiflux 缺该 kind 数据时的兜底）', () => {
    expect(enemyDebuffStatId('def', 'mystery')).toBe('enemyDefReduction')
  })

  it('element 版：无/all/未知 → undefined（区别于回落）', () => {
    expect(enemyDebuffElementStatId('def', 'all')).toBeUndefined()
    expect(enemyDebuffElementStatId('def')).toBeUndefined()
    expect(enemyDebuffElementStatId('res', 'mystery')).toBeUndefined()
    expect(enemyDebuffElementStatId('res', 'ice')).toBe('enemyIceResReduction')
  })
})

describe('normalizeEnemyDebuffStatAlias（三形态 legacy → 现名）', () => {
  it('五条全局别名逐一钉死（含 allResIgnore 归**通用**减抗而非某元素）', () => {
    expect(normalizeEnemyDebuffStatAlias('enemyDefIgnore')).toBe('enemyDefReduction')
    expect(normalizeEnemyDebuffStatAlias('enemyResIgnore')).toBe('enemyResReduction')
    expect(normalizeEnemyDebuffStatAlias('allResIgnore')).toBe('enemyResReduction')
    expect(normalizeEnemyDebuffStatAlias('enemyStunResIgnore')).toBe('enemyStunResReduction')
    expect(normalizeEnemyDebuffStatAlias('enemyAnomalyResIgnore')).toBe('enemyAnomalyResReduction')
  })

  it('旧形态 A：元素开头 fireDefIgnore → enemyFireDefReduction', () => {
    expect(normalizeEnemyDebuffStatAlias('fireDefIgnore')).toBe('enemyFireDefReduction')
    expect(normalizeEnemyDebuffStatAlias('physicalResIgnore')).toBe('enemyPhysicalResReduction')
    expect(normalizeEnemyDebuffStatAlias('windStunResIgnore')).toBe('enemyWindStunResReduction')
    expect(normalizeEnemyDebuffStatAlias('lumifluxAnomalyResIgnore')).toBe('enemyLumifluxAnomalyResReduction')
  })

  it('旧形态 B：enemy+元素 Ignore → Reduction', () => {
    expect(normalizeEnemyDebuffStatAlias('enemyIceResIgnore')).toBe('enemyIceResReduction')
    expect(normalizeEnemyDebuffStatAlias('enemyElectricStunResIgnore')).toBe('enemyElectricStunResReduction')
  })

  it('现名与非削弱字段原样穿过', () => {
    expect(normalizeEnemyDebuffStatAlias('enemyDefReduction')).toBe('enemyDefReduction')
    expect(normalizeEnemyDebuffStatAlias('atk')).toBe('atk')
    expect(normalizeEnemyDebuffStatAlias('enemyMysteryIgnore')).toBe('enemyMysteryIgnore')
  })

  it('幂等：normalize(normalize(x)) === normalize(x)（全 legacy + 全现名两集合都查）', () => {
    for (const id of [...LEGACY_ENEMY_DEBUFF_STAT_IDS, ...GENERATED_ENEMY_DEBUFF_STAT_IDS]) {
      const once = normalizeEnemyDebuffStatAlias(id)
      expect(normalizeEnemyDebuffStatAlias(once)).toBe(once)
    }
  })
})

describe('两套 id 清单的结构性不变量', () => {
  it('GENERATED = 4 基础 + 7 元素 × 4 类 = 32 条，且每个都能被自身生成函数命中', () => {
    expect(GENERATED_ENEMY_DEBUFF_STAT_IDS).toHaveLength(4 + 7 * 4)
    for (const kind of KINDS) {
      expect(GENERATED_ENEMY_DEBUFF_STAT_IDS).toContain(ENEMY_DEBUFF_KIND_CONFIG[kind].baseStat)
      for (const el of DAMAGE_ELEMENTS) {
        expect(GENERATED_ENEMY_DEBUFF_STAT_IDS).toContain(enemyDebuffStatId(kind, el))
      }
    }
  })

  it('GENERATED 与 LEGACY 零交集（现名混进 legacy 名单会让 statMeta 错剔条目）', () => {
    const legacy = new Set(LEGACY_ENEMY_DEBUFF_STAT_IDS)
    expect(GENERATED_ENEMY_DEBUFF_STAT_IDS.filter(id => legacy.has(id))).toEqual([])
  })

  it('STANDARD 元素表 = DAMAGE 去掉 lumiflux（辉光暂无敌方削弱数据，口径见原注释）', () => {
    expect(STANDARD_ENEMY_DEBUFF_ELEMENTS).toEqual(
      DAMAGE_ELEMENTS.filter(e => e !== 'lumiflux'),
    )
  })
})

describe('isEnemyDebuffStat（别名感知归属判断）', () => {
  it('现名 / legacy 别名都认；无关字段不认', () => {
    expect(isEnemyDebuffStat('enemyFireDefReduction')).toBe(true)
    expect(isEnemyDebuffStat('enemyDefIgnore')).toBe(true)
    expect(isEnemyDebuffStat('fireResIgnore')).toBe(true)
    expect(isEnemyDebuffStat('atk')).toBe(false)
    expect(isEnemyDebuffStat('atkPct')).toBe(false)
    expect(isEnemyDebuffStat('enemyDefReductionx')).toBe(false)
  })
})
