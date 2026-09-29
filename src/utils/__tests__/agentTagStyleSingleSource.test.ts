/**
 * CC-281：角色卡片标签样式（职业 / 属性颜色、稀有度 tag type）单一来源 = `utils/agentLabelMaps.ts`。
 * CC-281 前 CharacterCard.vue 与 ResourcePage.vue 各持一份逐字相同的颜色表；新增职业 / 属性只改一处会让两页颜色分叉。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { attributeTagColor, rarityTagType, specialtyTagColor } from '@/utils/agentLabelMaps'

const SRC = join(__dirname, '..', '..')
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) { if (n !== '__tests__') walk(p, out) }
    else if (/\.(ts|vue)$/.test(n) && !n.endsWith('.d.ts')) out.push(p)
  }
  return out
}

describe('agent tag style single source (CC-281)', () => {
  it('语义：已知 code 取表值，未知 / undefined 落灰色兜底', () => {
    expect(specialtyTagColor('attack')).toEqual({ color: '#c0392b', textColor: '#fff' })
    expect(attributeTagColor('xuanmo')).toEqual({ color: '#6366f1', textColor: '#fff' })
    expect(attributeTagColor(undefined)).toEqual({ color: '#555', textColor: '#fff' })
    expect(rarityTagType('S')).toBe('warning')
    expect(rarityTagType('A')).toBe('success')
    expect(rarityTagType(undefined)).toBe('default')
  })
  it('职业 / 属性颜色表只在 utils/agentLabelMaps.ts 定义', () => {
    const hits: string[] = []
    for (const f of walk(SRC)) {
      const s = readFileSync(f, 'utf8')
      // 职业表首项与属性表的 honed_edge 项（键 + 颜色对象）是两张表的指纹
      if (/attack:\s*\{\s*color:/.test(s) || /honed_edge:\s*\{\s*color:/.test(s)) hits.push(relative(SRC, f).replace(/\\/g, '/'))
    }
    expect(hits).toEqual(['utils/agentLabelMaps.ts'])
  })
})
