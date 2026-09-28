/**
 * CC-234 锁：「队伍总伤害」单一定义 = useResourceCalc#teamTotalDamage（Σ damagePoolRows.totalDamage）。
 * 此前 ResultPage 另算 damagePoolTotal（同式）并挂残留别名 totalDamageWithDisorder（紊乱早已并入伤害池行）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const SRC = resolve(__dirname, '../..')
function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? (d.name === '__tests__' ? [] : vueFiles(join(dir, d.name))) : d.name.endsWith('.vue') ? [join(dir, d.name)] : [])
}

describe('CC-234 队伍总伤害单一定义', () => {
  it('views / components 不再对 damagePoolRows 整体求和 totalDamage', () => {
    const hits: string[] = []
    for (const f of [...vueFiles(join(SRC, 'views')), ...vueFiles(join(SRC, 'components'))]) {
      const code = readFileSync(f, 'utf-8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
      if (/damagePoolRows\.value\.reduce\(\s*\(\s*\w+\s*,\s*\w+\s*\)\s*=>\s*\w+\s*\+\s*\w+\.totalDamage/.test(code)) hits.push(f)
      if (/\btotalDamageWithDisorder\b/.test(code)) hits.push(f + ' (totalDamageWithDisorder)')
    }
    expect(hits).toEqual([])
  })
})
