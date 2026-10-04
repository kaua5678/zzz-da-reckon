import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { getStatMeta } from '@/utils/statMeta'
import { SKILL_DMG_TARGET_LABELS } from '@/data/skillDamageTargets'

const SRC = join(__dirname, '..', '..')

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'test') walk(p, acc) }
    else if (/\.(ts|vue)$/.test(name) && !name.endsWith('.test.ts')) acc.push(p)
  }
  return acc
}

/**
 * CC-464（r583）：
 * ① 招式类型（`SkillDamageTarget`）code→中文名只有 `data/skillDamageTargets.ts` 一份（CC-214/215 同族：
 *    `utils/statMeta.ts` 曾私抄 8 项子集、缺 `additionalAttack` ⇒ 定向属性标签显示英文原文）。签名取 `assist: '支援技'`
 *    （倍率表 `MOVE_TYPE_LABELS` 是另一域：无 `assist`、有招架/快支变体，不在此锁内）。
 * ② `specs/types.ts` 的 `adjustable` 就是 `MechanicSetting`（`specToMechanicModule` 原样摊进 `settings`），不得再手抄同形内联类型。
 */
describe('CC-464 招式类型标签 / spec adjustable 单一来源', () => {
  it('定向属性后缀用 SKILL_DMG_TARGET_LABELS（含 additionalAttack）', () => {
    expect(getStatMeta('skillDmgBonus__additionalAttack').label).toContain('追加攻击')
    expect(getStatMeta('skillDmgBonus__dodgeCounter').label).toContain(SKILL_DMG_TARGET_LABELS.dodgeCounter)
  })
  it('src 里 `assist: \'支援技\'` 只出现在 data/skillDamageTargets.ts', () => {
    const hits = walk(SRC).filter(f => /^\s*assist:\s*'支援技'/m.test(readFileSync(f, 'utf-8'))).map(f => relative(SRC, f))
    expect(hits).toEqual(['data/skillDamageTargets.ts'])
  })
  it('specs/types.ts: adjustable?: MechanicSetting，无内联同形块', () => {
    const src = readFileSync(join(SRC, 'specs', 'types.ts'), 'utf-8')
    expect(src).toMatch(/adjustable\?: MechanicSetting\b/)
    expect(/adjustable\?: \{/.test(src)).toBe(false)
  })
})
