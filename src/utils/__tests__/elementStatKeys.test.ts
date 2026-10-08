/**
 * CC-224：元素 → 面板字段名单一来源（src/utils/elementStatKeys.ts）。
 * ① 数值表：7 个基础元素逐字段断言，且字段真实存在于 emptyPanel；② 变种 / 烈霜按基础元素 / 冰读（用户口径 2026-09-05）；
 * ③ 源码锁：除本来源外不许再写「元素 → 字段名」对照表或 switch。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { emptyPanel } from '@/core/panel'
import { elementStatKey, enemyResistanceOf, panelElementStat } from '@/utils/elementStatKeys'
import { DAMAGE_ELEMENTS } from '@/utils/enemyDebuffStats'

const SRC = join(__dirname, '..', '..')
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      walk(p, out)
    } else if (/\.(ts|vue)$/.test(name)) out.push(p)
  }
  return out
}

describe('元素 → 面板字段名单一来源（CC-224）', () => {
  it('7 个基础元素：字段名与 CC-224 前的表逐字一致，且字段存在于面板', () => {
    const panel = emptyPanel() as unknown as Record<string, unknown>
    for (const e of DAMAGE_ELEMENTS) {
      const cap = e[0].toUpperCase() + e.slice(1)
      expect(elementStatKey('dmg', e)).toBe(`${e}Dmg`)
      expect(elementStatKey('sheerDmg', e)).toBe(`${e}SheerDmg`)
      expect(elementStatKey('sharpDmg', e)).toBe(`${e}SharpDmg`)
      expect(elementStatKey('enemyRes', e)).toBe(`enemy${cap}ResReduction`)
      expect(elementStatKey('enemyDef', e)).toBe(`enemy${cap}DefReduction`)
      expect(elementStatKey('enemyAnomalyRes', e)).toBe(`enemy${cap}AnomalyResReduction`)
      expect(elementStatKey('enemyStunRes', e)).toBe(`enemy${cap}StunResReduction`)
      for (const k of ['dmg', 'enemyRes', 'enemyDef', 'enemyAnomalyRes', 'enemyStunRes'] as const) {
        expect(elementStatKey(k, e)! in panel, `${k}/${e}`).toBe(true)
      }
    }
  })
  it('变种 / 烈霜 / 未知元素', () => {
    expect(elementStatKey('dmg', 'physical_polar_assault')).toBe('physicalDmg')
    expect(elementStatKey('enemyRes', 'ether_ink')).toBe('enemyEtherResReduction')
    expect(elementStatKey('dmg', 'frostfire')).toBe('iceDmg')
    expect(elementStatKey('dmg', undefined)).toBeUndefined()
    expect(elementStatKey('dmg', 'nope')).toBeUndefined()
    const p = emptyPanel(); p.etherDmg = 30
    expect(panelElementStat(p, 'dmg', 'ether_ink')).toBe(30)
    expect(panelElementStat(p, 'dmg', '')).toBe(0)
    const res = { physical: 10, fire: 0, ice: 40, electric: 0, ether: -20, wind: 0 }
    expect(enemyResistanceOf(res, 'frostfire')).toBe(40)
    expect(enemyResistanceOf(res, 'ether_ink')).toBe(-20)
    expect(enemyResistanceOf(res, 'physical_polar_assault')).toBe(10)
    expect(enemyResistanceOf(res, 'lumiflux')).toBe(0)
  })
  it('源码锁：除 utils/elementStatKeys.ts 外没有「元素 → 字段名」对照表 / switch', () => {
    const RE = /\bphysical\s*:\s*'(?:physical(?:Sheer|Sharp|Crit)?Dmg|enemyPhysical(?:Res|Def)Reduction)'|case\s+'physical'\s*:\s*return\s+'physicalDmg'/
    const hits = walk(SRC)
      .map(p => relative(SRC, p).replace(/\\/g, '/'))
      .filter(rel => rel !== 'utils/elementStatKeys.ts' && RE.test(readFileSync(join(SRC, rel), 'utf8')))
    expect(hits).toEqual([])
  })
  it('源码锁（CC-225）：不许手拼元素字段名、不许复制元素 → 字段前缀表（注释行除外）', () => {
    const CONCAT = /\$\{[^}]*\}(?:Dmg|CritDmg|SheerDmg|SharpDmg)\b|enemy\$\{[^}]*\}(?:Res|Def)Reduction\b/
    const PREFIX_TABLE = /\bphysical\s*:\s*'Physical'|\[\s*'Physical'\s*,/
    const ALLOW = new Set(['utils/elementStatKeys.ts', 'utils/enemyDebuffStats.ts'])
    const hits: string[] = []
    for (const p of walk(SRC)) {
      const rel = relative(SRC, p).replace(/\\/g, '/')
      if (ALLOW.has(rel)) continue
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        const t = line.trim()
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
        const code = line.replace(/\/\/.*$/, '')
        if (CONCAT.test(code) || PREFIX_TABLE.test(code)) hits.push(`${rel}:${i + 1}`)
      })
    }
    expect(hits).toEqual([])
  })
  it('源码锁（r757 CC-540）：敌人抗性表只经 enemyResistanceOf 按元素取值（core/impactVars.ts 按六元素读写 store 表除外）', () => {
    const RE = /(?<!['"`])\b\w*(?:Resistances|DamageRes)\s*\[/
    const ALLOW = new Set(['utils/elementStatKeys.ts', 'core/impactVars.ts'])
    const hits: string[] = []
    for (const p of walk(SRC)) {
      const rel = relative(SRC, p).replace(/\\/g, '/')
      if (ALLOW.has(rel) || !rel.endsWith('.ts')) continue
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        const t = line.trim()
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
        if (RE.test(line.replace(/\/\/.*$/, ''))) hits.push(`${rel}:${i + 1}`)
      })
    }
    expect(hits).toEqual([])
  })
  it('源码锁（CC-338）：除 utils/elementStatKeys.ts 与 utils/enemyDebuffStats.ts 外不直调 enemyDebuffElementStatId', () => {
    const ALLOW = new Set(['utils/elementStatKeys.ts', 'utils/enemyDebuffStats.ts'])
    const hits = walk(SRC)
      .map(p => relative(SRC, p).replace(/\\/g, '/'))
      .filter(rel => !ALLOW.has(rel) && /\benemyDebuffElementStatId\b/.test(readFileSync(join(SRC, rel), 'utf8')))
    expect(hits).toEqual([])
  })
})
