/**
 * CC-214 源码锁：伤害元素 / 角色属性的中文名映射，每个语义域只允许一份。
 * - 伤害元素：`utils/agentLabelMaps#DAMAGE_ELEMENT_LABEL`（含变种元素）；
 * - 角色属性：`utils/agentLabelMaps#ATTRIBUTE_LABEL`；
 * - 允许的其他用途：`utils/enemyDebuffStats#ELEMENT_LABEL`（「火属性」后缀，拼减抗标签）、
 *   `views/StunAxisPage.vue` 进窗异常下拉（有意的子集）、
 *   `components/StatPanel.vue` 乘区说明（「火属性」后缀风格；lumiflux 写「辉光」而 enemyDebuffStats 写「辉光/耀变」，合并会改文案口径，CC-214 不做）。
 * 新写一份 `physical: '物理'` 映射会让本测试变红：改为导入上面的共享映射，或把新用途登记进 ALLOWED 并写明理由。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { DAMAGE_ELEMENT_LABEL, damageElementLabel, SPECIALTY_LABEL } from '@/utils/agentLabelMaps'

const SRC = join(__dirname, '..', '..')
const ALLOWED = new Set([
  'utils/agentLabelMaps.ts',
  'utils/enemyDebuffStats.ts',
  'views/StunAxisPage.vue',
  'components/StatPanel.vue',
])

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

describe('职业中文名映射单一来源（CC-215）', () => {
  it('只有 utils/agentLabelMaps.ts 定义「attack → 强攻」映射（含 label: \'强攻\' 这种组合写法）', () => {
    const hits = walk(SRC)
      .filter(p => /attack:\s*'强攻'|label:\s*'强攻'|attack:\s*\{\s*label:\s*'强攻'/.test(readFileSync(p, 'utf8')))
      .map(p => relative(SRC, p).replace(/\\/g, '/'))
    expect(hits).toEqual(['utils/agentLabelMaps.ts'])
  })

  it('职业表覆盖全部 7 个职业', () => {
    expect(Object.keys(SPECIALTY_LABEL).sort()).toEqual(['anomaly', 'attack', 'defense', 'rupture', 'sharpen', 'stun', 'support'])
  })
})

describe('元素中文名映射单一来源（CC-214）', () => {
  it('只有登记过的文件定义「physical → 物理」映射', () => {
    const hits = walk(SRC)
      .filter(p => /physical:\s*'物理'/.test(readFileSync(p, 'utf8')))
      .map(p => relative(SRC, p).replace(/\\/g, '/'))
      .sort()
    expect(hits).toEqual([...ALLOWED].sort())
  })

  it('变种元素都有中文名，不会把原始 id 显示给用户', () => {
    for (const el of ['physical_polar_assault', 'ether_ink', 'frostfire', 'lumiflux']) {
      expect(DAMAGE_ELEMENT_LABEL[el]).toBeTruthy()
      expect(damageElementLabel(el)).not.toBe(el)
    }
    expect(damageElementLabel('unknown_x')).toBe('unknown_x')
  })
})
