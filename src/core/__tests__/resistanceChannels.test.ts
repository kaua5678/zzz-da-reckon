/**
 * 抗性**三通道**判据（2026-11-09 用户口径）。
 *
 * > 「减抗的实现分为两种，一个是降低怪物的抗性……直伤和异常比如乱流灼烧强击之类都能吃。
 * >  还有一种是加自己的无视抗性，这种抗性只有自己直伤能无视……异常状态吃不到这种减抗。」
 * > 「只有怪物身上属性抗性降低和造成异常伤害时无视抗性，才能给异常吃。
 * >  所以可以分为三种情况：直伤抗性，异常抗性，通用抗性。」
 *
 * 修前三类文本压进 `enemyResReduction` 一个字段，直伤与异常**同时**读它 ⇒ 原文写「造成伤害
 * 无视抗性」的直伤专属效果被异常白吃。数值上「怪物减抗」与「自身无视」在抗性区里同形（线性加算），
 * 所以合并写法**静默通过全部既有测试**——本文件是那条漏网的口子。
 *
 * 判据分三层：
 *   ① 读数层：三族字段各自读得出、互不串味（`enemyResReductionOf` / `selfResIgnoreOf`）
 *   ② 行为层：直伤无视**只改直伤**、异常无视**只改异常**、怪物减抗**两边都改**
 *   ③ 源码锁：`core/damage.ts` / `anomalyPool/helpers.ts` 不得再手拼抗性字段族
 */
import { describe, expect, it } from 'vitest'
import { emptyPanel } from '@/core/panel'
import { calcAnomalyDamage, calcDirectDamage } from '@/core/damage'
import { enemyResReductionOf, selfResIgnoreOf, resistanceChannelsOf } from '@/core/resistanceChannels'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 直伤探针：固定基底，只让抗性区变 */
function direct(panel: ReturnType<typeof emptyPanel>, element = 'fire') {
  return calcDirectDamage({
    panel,
    skillMultiplier: 1000,
    damageElement: element as never,
    enemyDefense: 0,
    enemyDefReduction: 0,
    enemyDefFlatReduction: 0,
    enemyResistance: 40,
    enemyResReduction: 0,
    stunMultiplier: 1,
    stunned: false,
    critMode: 'nonCrit',
    count: 1,
  }).damage
}

/** 异常探针：同面板、同抗性基数，只让抗性区变 */
function anomaly(panel: ReturnType<typeof emptyPanel>, element = 'fire') {
  return calcAnomalyDamage({
    panel,
    baseMultiplier: 1000,
    element: element as never,
    enemyDefense: 0,
    enemyDefReduction: 0,
    enemyDefFlatReduction: 0,
    enemyResistance: 40,
    enemyResReduction: 0,
  }).damage
}

const basePanel = () => ({ ...emptyPanel(), atk: 1000, anomalyProficiency: 100 })

describe('① 读数层：三族字段互不串味', () => {
  it('通用减抗读 enemyResReduction + 元素族；自身无视读各自族', () => {
    const p = {
      ...basePanel(),
      enemyResReduction: 10,
      enemyFireResReduction: 5,
      enemyResIgnoreDirect: 15,
      enemyFireResIgnoreDirect: 3,
      enemyResIgnoreAnomaly: 20,
      enemyFireResIgnoreAnomaly: 7,
    }
    expect(enemyResReductionOf(p, 'fire')).toBe(15) // 10 + 5
    expect(selfResIgnoreOf(p, 'direct', 'fire')).toBe(18) // 15 + 3
    expect(selfResIgnoreOf(p, 'anomaly', 'fire')).toBe(27) // 20 + 7
    expect(resistanceChannelsOf(p, 'direct', 'fire')).toEqual({ reduction: 15, ignore: 18 })
    expect(resistanceChannelsOf(p, 'anomaly', 'fire')).toEqual({ reduction: 15, ignore: 27 })
  })

  it('元素口径与元素减抗同源（烈霜按冰读，见 elementStatKeys）', () => {
    const p = { ...basePanel(), enemyIceResIgnoreDirect: 12, enemyIceResIgnoreAnomaly: 9 }
    expect(selfResIgnoreOf(p, 'direct', 'frostfire')).toBe(12)
    expect(selfResIgnoreOf(p, 'anomaly', 'frostfire')).toBe(9)
  })

  it('extra 参数与面板值加算（行级 moveId 限定 / 异放 releaseModifier）', () => {
    const p = { ...basePanel(), enemyResIgnoreDirect: 10, enemyResIgnoreAnomaly: 10 }
    expect(selfResIgnoreOf(p, 'direct', 'fire', undefined, 5)).toBe(15)
    expect(selfResIgnoreOf(p, 'anomaly', 'fire', undefined, 5)).toBe(15)
  })
})

describe('② 行为层：三通道谁吃谁不吃', () => {
  const p = basePanel()
  const d0 = direct(p)
  const a0 = anomaly(p)

  it('通用（怪物身上减抗）：直伤与异常**都**吃', () => {
    const withGeneric = { ...p, enemyResReduction: 20 }
    expect(direct(withGeneric)).toBeGreaterThan(d0)
    expect(anomaly(withGeneric)).toBeGreaterThan(a0)
    // 抗性 40 → 有效 20 ⇒ 区从 0.6 变 0.8
    expect(direct(withGeneric) / d0).toBeCloseTo(0.8 / 0.6, 10)
    expect(anomaly(withGeneric) / a0).toBeCloseTo(0.8 / 0.6, 10)
  })

  it('★ 自身直伤无视：只改直伤，异常**逐位不变**', () => {
    const withDirect = { ...p, enemyResIgnoreDirect: 20 }
    expect(direct(withDirect) / d0).toBeCloseTo(0.8 / 0.6, 10)
    expect(anomaly(withDirect), '异常不得吃「造成伤害无视抗性」').toBe(a0)
  })

  it('★ 自身异常无视：只改异常，直伤**逐位不变**', () => {
    const withAnomaly = { ...p, enemyResIgnoreAnomaly: 20 }
    expect(anomaly(withAnomaly) / a0).toBeCloseTo(0.8 / 0.6, 10)
    expect(direct(withAnomaly), '直伤不得吃「造成异常伤害时无视抗性」').toBe(d0)
  })

  it('元素族同规则：直伤族元素字段不进异常，异常族元素字段不进直伤', () => {
    expect(anomaly({ ...p, enemyFireResIgnoreDirect: 20 })).toBe(a0)
    expect(direct({ ...p, enemyFireResIgnoreAnomaly: 20 })).toBe(d0)
    expect(direct({ ...p, enemyFireResIgnoreDirect: 20 })).toBeGreaterThan(d0)
    expect(anomaly({ ...p, enemyFireResIgnoreAnomaly: 20 })).toBeGreaterThan(a0)
  })

  it('行级额外量按族传入：extra 只加到自己那族', () => {
    const directExtra = calcDirectDamage({
      panel: p, skillMultiplier: 1000, damageElement: 'fire' as never,
      enemyDefense: 0, enemyDefReduction: 0, enemyDefFlatReduction: 0,
      enemyResistance: 40, enemyResReduction: 0, enemyResIgnoreDirect: 20,
      stunMultiplier: 1, stunned: false, critMode: 'nonCrit', count: 1,
    }).damage
    expect(directExtra).toBeCloseTo(d0 * (0.8 / 0.6), 10)
    // 同一份 20 若错传到异常侧 —— 那是另一族，数值必须不同源
    const anomalyExtra = calcAnomalyDamage({
      panel: p, baseMultiplier: 1000, element: 'fire' as never,
      enemyDefense: 0, enemyDefReduction: 0, enemyDefFlatReduction: 0,
      enemyResistance: 40, enemyResReduction: 0, enemyResIgnoreAnomaly: 20,
    }).damage
    expect(anomalyExtra).toBeCloseTo(a0 * (0.8 / 0.6), 10)
  })
})

describe('③ 源码锁：抗性字段族只在 core/resistanceChannels 里拼', () => {
  const SRC = join(__dirname, '..', '..')
  const OWNER = 'core/resistanceChannels.ts'
  /** 去掉注释行（口径说明允许写字段名） */
  const code = (t: string) => t.split('\n').filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')

  it('core/damage.ts 直接读的只有「通用族 + 本族」两个入口函数', () => {
    const src = code(readFileSync(join(SRC, 'core/damage.ts'), 'utf8'))
    expect(src).toContain('enemyResReductionOf(')
    expect(src).toContain("selfResIgnoreOf(p, 'direct'")
    expect(src).toContain("selfResIgnoreOf(settle, 'anomaly'")
    // 不读另一族：直伤链里不出现 anomaly 族的 selfResIgnoreOf，反之亦然
    expect(src.split("selfResIgnoreOf(p, 'anomaly'").length - 1).toBe(0)
    expect(src.split("selfResIgnoreOf(settle, 'direct'").length - 1).toBe(0)
  })

  it('异常池紊乱 / 乱流用异常族，不用直伤族', () => {
    const src = code(readFileSync(join(SRC, 'core/anomalyPool/helpers.ts'), 'utf8'))
    expect(src).toContain("selfResIgnoreOf(p, 'anomaly'")
    expect(src.split("selfResIgnoreOf(p, 'direct'").length - 1).toBe(0)
  })

  it('耀变（蕾米埃尔）：异常族 + **结算者是蕾米**（读 settler 面板，不读来源队友）', () => {
    const src = code(readFileSync(join(SRC, 'mechanics/agents/remielle.ts'), 'utf8'))
    // 用户口径：队友的自身异常抗性吃不到，因为结算者是蕾米
    expect(src).toContain("selfResIgnoreOf(remielle, 'anomaly'")
    expect(src).toContain("enemyResReductionOf(remielle,")
    // 反锁：不得再从来源队友（source）面板读抗性/无视抗性
    expect(src.split("enemyResReductionOf(source").length - 1).toBe(0)
    expect(src.split("selfResIgnoreOf(source").length - 1).toBe(0)
    expect(src.split("selfResIgnoreOf(remielle, 'direct'").length - 1).toBe(0)
  })

  it('字段名只由 utils/resistanceChannels 生成（不手拼 ResIgnoreDirect / ResIgnoreAnomaly）', () => {
    const src = readFileSync(join(SRC, OWNER), 'utf8')
    expect(src).toContain('enemyResReductionOf')
    expect(src).toContain('selfResIgnoreOf')
  })
})
