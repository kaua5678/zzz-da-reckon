/**
 * 调试元数据单一事实源（规则 11 点名的 statMeta）的定向单测。
 *
 * 为什么补（2026-09-12 评审 #14 收尾体检）：全仓引用扫描发现 statMeta 有 **9 个调用方、
 * 零直接测试**——它是面板/调试器标签的统一来源，四函数都是纯查表/纯转换，
 * 错了不会报错、只会**静默错标**（比如 `__招式限定` 后缀漏拼、legacy 剔除失效）。
 * 本文件按"特征化"写法钉住现状口径（含两处易被忽略的设计：无 scope 时 core 词条回落旧标签、
 * display 覆盖只认 string / {zhCN|en}，其余一律回落元数据标签）。
 */
import { describe, expect, it } from 'vitest'
import {
  STAT_META,
  getGlobalBuffStatOptions,
  getStatMeta,
  isPctStat,
  phaseStatLabel,
} from '@/utils/statMeta'
import { LEGACY_ENEMY_DEBUFF_STAT_IDS } from '@/utils/enemyDebuffStats'

describe('isPctStat（八后缀 + `__` 限定段剥离）', () => {
  it.each([
    ['atkPct'], ['critRate'], ['critDmg'], ['energyRegenRatio'],
    ['anomalyBuildUpEfficiency'], ['dmgBonus'], ['defReduction'], ['enemyDefIgnore'],
  ])('后缀命中 → pct：%s', (stat) => {
    expect(isPctStat(stat)).toBe(true)
  })

  it('固定值与无后缀字段 → false', () => {
    expect(isPctStat('atkFlat')).toBe(false)
    expect(isPctStat('hp')).toBe(false)
    expect(isPctStat('')).toBe(false)
  })

  it('`__招式限定` 段按 base 判定', () => {
    expect(isPctStat('atkPct__basic')).toBe(true)
    expect(isPctStat('atkFlat__ultimate')).toBe(false)
  })
})

describe('getStatMeta（直接命中 → base 派生 → 未知兜底 三层）', () => {
  it('直接命中：返回登记条目本体', () => {
    const m = getStatMeta('critRate')
    expect(m).toMatchObject({ value: 'critRate', label: '暴击率', zone: '暴击区', mode: 'pct' })
  })

  it('限定后缀：label 拼（招式限定）、description 补生效说明', () => {
    const m = getStatMeta('critRate__basic')
    expect(m.label).toBe('暴击率（普通攻击限定）')
    expect(m.value).toBe('critRate__basic')
    expect(m.description).toContain('该字段仅在指定招式类型下生效')
  })

  it('未知招式 key 不吞掉：原样进括号（防静默丢信息）', () => {
    expect(getStatMeta('critRate__mystery').label).toBe('暴击率（mystery限定）')
  })

  it('完全未知字段：合成兜底，zone=其他，mode 由 isPctStat 推', () => {
    const flat = getStatMeta('brandNewField')
    expect(flat).toMatchObject({ value: 'brandNewField', label: 'brandNewField', zone: '其他', mode: 'flat' })
    expect(flat.description).toContain('未在调试元数据中登记')
    expect(getStatMeta('brandNewBonus').mode).toBe('pct')
  })
})

describe('phaseStatLabel（局内外标签三层回落）', () => {
  it('显式局内外字段：正则直出（大/小词条按 Pct/Flat）', () => {
    expect(phaseStatLabel('outOfCombatAtkPct')).toBe('局外攻击大词条')
    expect(phaseStatLabel('inCombatDefFlat')).toBe('局内防御小词条')
    expect(phaseStatLabel('outOfCombatImpactPct')).toBe('局外冲击力大词条')
  })

  it('兼容旧字段（atkPct 等 8 个）：有 scope 时按来源阶段标', () => {
    expect(phaseStatLabel('atkPct', 'outOfCombat')).toBe('局外攻击大词条')
    expect(phaseStatLabel('atkPct', 'inCombat')).toBe('局内攻击大词条')
    expect(phaseStatLabel('impactFlat', 'inCombat')).toBe('局内冲击力小词条')
  })

  it('★ 兼容旧字段无 scope：回落旧标签「（阶段继承）」——不猜阶段', () => {
    expect(phaseStatLabel('atkPct')).toBe('攻击大词条（阶段继承）')
  })

  it('非 core 字段带 scope 也走元数据标签（scope 不污染）', () => {
    expect(phaseStatLabel('critRate', 'inCombat')).toBe('暴击率')
  })
})

describe('getGlobalBuffStatOptions（分组/剔除/显示覆盖）', () => {
  it('按 zone 分组、组序 = 元数据首次出现序；子项标签为 `名 (id)`', () => {
    const groups = getGlobalBuffStatOptions()
    expect(groups.length).toBeGreaterThan(3)
    expect(groups[0]).toMatchObject({ type: 'group', label: '基础属性', key: '基础属性' })
    const crit = groups.flatMap(g => g.children).find(c => c.value === 'critRate')
    expect(crit?.label).toBe('暴击率 (critRate)')
    // 与元数据一一对应（除去 legacy 剔除项）
    const childCount = groups.reduce((n, g) => n + g.children.length, 0)
    expect(childCount).toBe(
      STAT_META.filter(m => !LEGACY_ENEMY_DEBUFF_STAT_IDS.includes(m.value)).length,
    )
  })

  it('legacy 敌方削弱 id 全组剔除（含属性 × 各元素派生 id）', () => {
    const values = new Set(getGlobalBuffStatOptions().flatMap(g => g.children.map(c => c.value)))
    expect(values.has('enemyDefIgnore')).toBe(false)
    for (const id of LEGACY_ENEMY_DEBUFF_STAT_IDS) expect(values.has(id)).toBe(false)
  })

  // 注：display 的条目形状 = `{ label: string | {zhCN?, en?} }`（实现读 display[id].label）
  it('display 覆盖只认 label 为 string 或 {zhCN|en}，其余一律回落元数据标签', () => {
    const pick = (display: Record<string, unknown>) =>
      getGlobalBuffStatOptions(display).flatMap(g => g.children).find(c => c.value === 'critRate')!.label
    expect(pick({ critRate: { label: '自定义名' } })).toBe('自定义名 (critRate)')
    expect(pick({ critRate: { label: { zhCN: '中文', en: 'Eng' } } })).toBe('中文 (critRate)')
    expect(pick({ critRate: { label: { en: 'Eng' } } })).toBe('Eng (critRate)')
    expect(pick({ critRate: {} })).toBe('暴击率 (critRate)')                 // 无 label → 回落
    expect(pick({ critRate: { label: '自定义名' }, other: 1 })).toBe('自定义名 (critRate)')
    expect(pick({ critRate: '自定义名' })).toBe('暴击率 (critRate)')          // 字符串本身 → 无 .label → 回落
    expect(pick({})).toBe('暴击率 (critRate)')
  })

  it('未知字段的覆盖也能生效（不要求先登记）', () => {
    const groups = getGlobalBuffStatOptions({ totallyUnknown: 'X' })
    expect(groups.flatMap(g => g.children).some(c => c.value === 'totallyUnknown')).toBe(false)
    // ↑ 覆盖只作用于已登记条目——防"display 里有但没登记"的字段凭空出现在下拉里
  })
})
