/**
 * R5 D21（`target.skillTargets`）：catalog 里每个带招式目标的效果，都必须只落到对应招式族的
 * 定向键（`<stat>__<target>`），不能漏掉任何一个目标、也不能退化成全招式生效。
 *
 * 修前：`core/buff.ts#effectSkillDamageTargets` 只认 skillTag = exSpecial / dashAttack /
 * additionalAttack，31800 混沌爵士 4pc 的 `skillTag: "assistAttack"`（原文「[强化特殊技]和
 * [支援攻击]造成的伤害提升20%」）被静默丢弃 ⇒ 支援技拿不到 +20%。
 * 口径：skillTag `assistAttack` 归一到招式族 `assist`（`core/damage.ts` categoryId 'assist' → 'assist'）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyEffect } from '@/core/buff'
import { SKILL_DMG_TARGETS } from '@/data/skillDamageTargets'

const cat = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as any
const TAG_ALIAS: Record<string, string> = { assistAttack: 'assist' }

function collect(o: any, out: any[]): void {
  if (Array.isArray(o)) { o.forEach(v => collect(v, out)); return }
  if (!o || typeof o !== 'object') return
  if (o.stat && Array.isArray(o.target?.skillTargets) && !o.targetSkillType) out.push(o)
  for (const v of Object.values(o)) collect(v, out)
}
const effects: any[] = []
collect({ w: cat.wEngines, d: cat.driveDiscSets, a: cat.agents }, effects)

function expected(e: any): string[] {
  return [...new Set<string>(e.target.skillTargets.map((t: any) => t.kind === 'skillTag' ? (TAG_ALIAS[t.skillTag] ?? t.skillTag) : t.skillType))].sort()
}

describe('R5 D21 skillTargets 全部落到定向键', () => {
  it('数据里出现的每个目标都是引擎认识的招式族', () => {
    expect(effects.length).toBeGreaterThan(10)
    const unknown = effects.flatMap(e => expected(e)).filter(t => !(SKILL_DMG_TARGETS as string[]).includes(t) || t === 'all')
    expect(unknown).toEqual([])
  })

  it('★ 每个效果只写 <stat>__<target>，目标集合与数据一致（修前 31800 缺 assist）', () => {
    const bad: string[] = []
    for (const e of effects) {
      const panel: Record<string, number> = {}
      applyEffect(panel as any, { ...e, coverage: undefined, value: e.value ?? 1, valuePerStack: e.valuePerStack ?? e.value ?? 1 })
      const keys = Object.keys(panel).filter(k => panel[k] !== 0)
      const global = keys.filter(k => !k.includes('__'))
      const got = [...new Set(keys.filter(k => k.includes('__')).map(k => k.split('__')[1]))].sort()
      if (global.length || JSON.stringify(got) !== JSON.stringify(expected(e))) bad.push(`${e.id}: got=${got} global=${global} want=${expected(e)}`)
    }
    expect(bad).toEqual([])
  })
})
