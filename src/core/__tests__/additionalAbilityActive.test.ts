/**
 * CC-507：「面板额外能力是否触发」只写一份（`core/additionalAbilityActive.ts#additionalAbilityActiveOf`）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { additionalAbilityActiveOf } from '@/core/additionalAbilityActive'

const SRC = join(__dirname, '..', '..')
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (f === '__tests__' || f === 'node_modules') continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|vue)$/.test(f) && !/\.test\.ts$/.test(f)) out.push(p)
  }
  return out
}

describe('additionalAbilityActiveOf（CC-507）', () => {
  it('1 ⇒ 触发；0 / 缺省 / 空面板 ⇒ 未触发', () => {
    expect(additionalAbilityActiveOf({ additionalAbilityActive: 1 })).toBe(true)
    expect(additionalAbilityActiveOf({ additionalAbilityActive: 0 })).toBe(false)
    expect(additionalAbilityActiveOf({})).toBe(false)
    expect(additionalAbilityActiveOf(null)).toBe(false)
    expect(additionalAbilityActiveOf(undefined)).toBe(false)
  })
  it('源码锁：src 下（测试除外）按数值判定 additionalAbilityActive（带 `?? 0)` 或裸比较 > / <= / ===）只出现在 owner', () => {
    const owner = join(SRC, 'core', 'additionalAbilityActive.ts')
    // 裸比较也算：r731 删掉 `?? 1` 后，佩洛伊斯留下的 `cfg.panel.additionalAbilityActive > 0` 没被只认 `?? 0)` 的旧式拦住（r758 收口）
    const re = /additionalAbilityActive(\s*\?\?\s*0\))?\s*(>|<=|===)/g
    for (const f of walk(SRC)) {
      const code = readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
      const hits = (code.match(re) ?? []).length
      expect(hits, f).toBe(f === owner ? 1 : 0)
    }
  })
})
