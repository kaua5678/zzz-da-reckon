/**
 * 防御**三通道**判据（2026-11-09 用户裁决）。
 *
 * 用户口径：
 * > 「减防是不是也分直伤和异常和通用？」
 *
 * 与抗性三通道同构（见 `resistanceChannels.test.ts`）：防御区里「怪物身上减防」是结算区 debuff
 * （直伤与异常都吃），「自身造成伤害无视防御」只作用于直伤、没有降低 boss 身上的乘区。
 *
 * 修前原文「造成伤害无视 N% 防御」一律写进 `enemyDefReduction`，而该字段被直伤与异常**同时**读取
 * ⇒ 异常白吃直伤专属的无视防御。因两族在 `defenseMultiplierDetail` 里同形（线性乘算），
 * 合并写法**静默通过全部既有测试**——本文件是那条漏网的口子。
 *
 * 判据分三层：
 *   ① 读数层：三族字段各自读得出、互不串味（`enemyDefReductionOf` / `selfDefIgnoreOf`）
 *   ② 行为层：直伤无视**只改直伤**、异常专属**只改异常**、怪物减防**两边都改**
 *   ③ 源码锁：`core/damage.ts` 直伤链走 `selfDefIgnoreOf`，异常链不读 `enemyDefIgnoreDirect`
 */
import { describe, expect, it } from 'vitest'
import { emptyPanel } from '@/core/panel'
import { calcAnomalyDamage, calcDirectDamage } from '@/core/damage'
import { enemyDefReductionOf, selfDefIgnoreOf } from '@/core/defenseChannels'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 直伤探针：固定基底，只让防御区变 */
function direct(panel: ReturnType<typeof emptyPanel>, element = 'electric') {
  return calcDirectDamage({
    panel,
    skillMultiplier: 1000,
    damageElement: element as never,
    enemyDefense: 953,
    enemyDefReduction: 0,
    enemyDefFlatReduction: 0,
    enemyResistance: 0,
    enemyResReduction: 0,
    stunMultiplier: 1,
    stunned: false,
    critMode: 'nonCrit',
    count: 1,
  }).damage
}

/** 异常探针：同面板、同防御基数，只让防御区变 */
function anomaly(panel: ReturnType<typeof emptyPanel>, element = 'electric') {
  return calcAnomalyDamage({
    panel,
    baseMultiplier: 1000,
    element: element as never,
    enemyDefense: 953,
    enemyDefReduction: 0,
    enemyDefFlatReduction: 0,
    enemyResistance: 0,
    enemyResReduction: 0,
  }).damage
}

const basePanel = () => ({ ...emptyPanel(), atk: 1000, anomalyProficiency: 100 })

describe('① 读数层：防御三族字段互不串味', () => {
  it('通用减防读 enemyDefReduction + 元素族；自身直伤无视读自己的族', () => {
    const p = {
      ...basePanel(),
      enemyDefReduction: 10,
      enemyElectricDefReduction: 5,
      enemyDefIgnoreDirect: 20,
      enemyElectricDefIgnoreDirect: 7,
    }
    expect(enemyDefReductionOf(p, 'electric')).toBe(15) // 10 + 5
    expect(selfDefIgnoreOf(p, 'electric')).toBe(27) // 20 + 7
    // 元素不同 ⇒ 只读到全元素那条
    expect(enemyDefReductionOf(p, 'fire')).toBe(10)
    expect(selfDefIgnoreOf(p, 'fire')).toBe(20)
  })

  it('元素未知 / 无元素时**不得**回落到元素字段再读一次（会双计）', () => {
    const p = { ...basePanel(), enemyDefIgnoreDirect: 20, enemyElectricDefIgnoreDirect: 7 }
    expect(selfDefIgnoreOf(p)).toBe(20)
    expect(selfDefIgnoreOf(p, null)).toBe(20)
    expect(selfDefIgnoreOf(p, 'mystery')).toBe(20)
  })

  it('extra 参数与面板值加算（行级 moveId 限定）', () => {
    const p = { ...basePanel(), enemyDefIgnoreDirect: 10 }
    expect(selfDefIgnoreOf(p, 'fire', undefined, 5)).toBe(15)
  })
})

describe('② 行为层：三通道谁吃谁不吃', () => {
  const p = basePanel()
  const d0 = direct(p)
  const a0 = anomaly(p)

  it('通用（怪物身上减防）：直伤与异常**都**吃', () => {
    const withGeneric = { ...p, enemyDefReduction: 20 }
    expect(direct(withGeneric)).toBeGreaterThan(d0)
    expect(anomaly(withGeneric)).toBeGreaterThan(a0)
  })

  it('★ 自身直伤无视防御：只改直伤，异常**逐位不变**', () => {
    const withDirect = { ...p, enemyDefIgnoreDirect: 20 }
    expect(direct(withDirect)).toBeGreaterThan(d0)
    expect(anomaly(withDirect), '异常不得吃「造成伤害无视防御」').toBe(a0)
  })

  it('★ 异常专属无视防御：只改异常，直伤**逐位不变**', () => {
    const withAnomaly = { ...p, enemyAnomalyDefReduction: 20 }
    expect(anomaly(withAnomaly)).toBeGreaterThan(a0)
    expect(direct(withAnomaly), '直伤不得吃异常专属无视防御').toBe(d0)
  })

  it('强击专属：只在物理异常结算时进防御区', () => {
    const withAssault = { ...p, enemyAssaultDefReduction: 20 }
    expect(anomaly(withAssault, 'electric')).toBe(a0) // 非物理不吃
    expect(anomaly(withAssault, 'physical')).toBeGreaterThan(anomaly(p, 'physical'))
  })

  it('元素族同规则：直伤族元素字段不进异常', () => {
    expect(anomaly({ ...p, enemyElectricDefIgnoreDirect: 20 })).toBe(a0)
    expect(direct({ ...p, enemyElectricDefIgnoreDirect: 20 })).toBeGreaterThan(d0)
  })
})

describe('③ 源码锁：防御字段族只在 core/defenseChannels 里拼', () => {
  const SRC = join(__dirname, '..', '..')
  /** 去掉注释行（口径说明允许写字段名） */
  const code = (t: string) => t.split('\n').filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')

  it('core/damage.ts：直伤链走 selfDefIgnoreOf，异常链不读该族', () => {
    const src = code(readFileSync(join(SRC, 'core/damage.ts'), 'utf8'))
    expect(src).toContain('selfDefIgnoreOf(')
    // ⚠ 锚点必须是**代码行**：上面 code() 已剔除注释行，用 '// 4. 防御乘区' 会 indexOf −1 ⇒
    // slice(-1) 只剩末尾换行，断言退化成空转（实测直接反着红）。
    // 用异常链防御区的**第一行代码** `settle.enemyDefReduction` 作锚，切到文件末尾：
    // 直伤链在它之前 ⇒ 后面出现 enemyDefIgnoreDirect 就说明漏进异常了。
    const anchor = src.indexOf('settle.enemyDefReduction')
    expect(anchor, '锚点丢失：异常链不再读 settle.enemyDefReduction').toBeGreaterThan(-1)
    const anomalyBlock = src.slice(anchor)
    expect(anomalyBlock, '异常链不得出现直伤族字段').not.toContain('enemyDefIgnoreDirect')
    expect(anomalyBlock).not.toContain('selfDefIgnoreOf(')
    // 异常侧的三条通道都在场：通用 / 异常专属 / 强击专属
    expect(anomalyBlock).toContain('settle.enemyAnomalyDefReduction')
    expect(anomalyBlock).toContain('settle.enemyAssaultDefReduction')
  })

  it('字段名只由 utils/defenseChannels 生成（不手拼 DefIgnoreDirect）', () => {
    const src = readFileSync(join(SRC, 'utils/defenseChannels.ts'), 'utf8')
    expect(src).toContain('defIgnoreDirectStatId')
    expect(src).toContain('DEF_IGNORE_DIRECT_SUFFIX')
  })
})
