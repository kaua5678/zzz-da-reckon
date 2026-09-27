/**
 * CC-111（R5 第 4 刀 D14）：蕾米埃尔（1581）耀变数据 ↔ 模块硬编码一致性。
 *
 * 模块 `mechanics/agents/remielle.ts` 按招式 id 字面量处理耀变（1581007 / 008 / 015 / 016），
 * 等级阈值写死在 `getRemielleLevelValue` 的兜底（14、16）。数据改了招式或阈值，模块不会跟着变
 * ⇒ 这里用数据自证，任何一边单独变都会红。零差（只加测试）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getRemielleLevelValue } from '@/mechanics/agents/remielle'

const cat = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as any
const src = readFileSync(new URL('../agents/remielle.ts', import.meta.url), 'utf8')
const skills = cat.agentSkills.find((s: any) => s.agentId === '1581')
const moves: any[] = skills.categories.flatMap((c: any) => c.moves)

describe('CC-111 蕾米埃尔耀变数据与模块一致', () => {
  // 模块里与耀变无关的 1581 字面量（显式列出；新增时在这里登记并写明用途）：
  // 1581010 = 曙光回旋（失衡倍率 / 执行派发，见 remielle.ts:292/490）
  const NON_LUMINIZE_LITERALS = ['1581010']

  it('canTriggerLuminize 招式集合 = 模块里带引号的 1581xxx 字面量集合（扣除非耀变登记项）', () => {
    const data = moves.filter(m => m.canTriggerLuminize === true).map(m => m.id).sort()
    const code = [...new Set([...src.matchAll(/'(1581\d{3})'/g)].map(m => m[1]))].sort()
    expect(data.length).toBeGreaterThan(0)
    // 每个字面量都是真实招式
    for (const id of code) expect(moves.some(m => m.id === id), id).toBe(true)
    // 登记的非耀变字面量在数据里确实不能触发耀变
    for (const id of NON_LUMINIZE_LITERALS) expect(moves.find(m => m.id === id)?.canTriggerLuminize, id).not.toBe(true)
    expect(code.filter(id => !NON_LUMINIZE_LITERALS.includes(id))).toEqual(data)
  })

  it('remielleLuminizeMultipliers 的键 = 耀变招式集合，values = 招式行（带 levelValues）的 values', () => {
    const data = moves.filter(m => m.canTriggerLuminize === true)
    expect(Object.keys(skills.remielleLuminizeMultipliers).sort()).toEqual(data.map(m => m.id).sort())
    for (const m of data) {
      const row = m.rows.find((r: any) => Array.isArray(r.levelValues))
      expect(row, m.id).toBeTruthy()
      expect(row.levelValues).toEqual(skills.remielleLuminizeLevels)
      expect(row.values).toEqual(skills.remielleLuminizeMultipliers[m.id].values)
    }
  })

  it('等级阈值：去掉 levelValues 后，模块兜底在数据的每个等级上取到同一档', () => {
    const levels: number[] = skills.remielleLuminizeLevels
    const m = moves.find(x => x.canTriggerLuminize === true)
    const row = m.rows.find((r: any) => Array.isArray(r.levelValues))
    const bare = { ...row, levelValues: undefined }
    levels.forEach((lv, i) => {
      expect(getRemielleLevelValue(row, lv - 12)).toBe(row.values[i])
      expect(getRemielleLevelValue(bare, lv - 12)).toBe(row.values[i])
    })
  })
})
