import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calcBasePanel } from '@/core/panel'

function loadCatalog() {
  return JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))
}

describe('catalog data invariants', () => {
  it('keeps every agent paired with a skills table', () => {
    const cat = loadCatalog()
    const agents = cat.agents as any[]
    const skills = cat.agentSkills as any[]

    expect(agents.length).toBeGreaterThan(0)
    expect(skills.length).toBe(agents.length)

    const skillIds = new Set(skills.map(s => s.agentId))
    for (const agent of agents) {
      expect(skillIds.has(agent.id)).toBe(true)
    }
  })

  it('uses unique ids across core collections', () => {
    const cat = loadCatalog()
    for (const key of ['agents', 'wEngines', 'driveDiscSets', 'agentSkills', 'bosses']) {
      const rows = cat[key] as any[]
      const ids = rows.map(r => r.id ?? r.agentId)
      expect(new Set(ids).size, `${key} ids`).toBe(ids.length)
    }
  })

  it('keeps the Velina basic combo baseline in sync with catalog data', () => {
    const cat = loadCatalog()
    const skills = (cat.agentSkills as any[]).find(s => s.agentId === '1561')
    const basic = skills?.categories.find((c: any) => c.id === 'basic')
    const numbered = (basic?.moves ?? []).filter((m: any) => {
      const name = m.name?.en || ''
      return /#\d+/.test(name) && !/dash|dodge/i.test(name) && m.actionTime > 0
    })
    const third = numbered[Math.min(2, numbered.length - 1)]

    expect(third?.id).toBe('1561003')
    const buildUp = third?.rows?.find((r: any) => r.id === 'anomaly_buildup')?.values?.[0] ?? 0
    expect(buildUp / third?.actionTime).toBeCloseTo(52.2, 1)
  })

  it('adds DEF-base W-Engine white stats to defense instead of attack', () => {
    const cat = loadCatalog()
    const claret = (cat.agents as any[]).find((a: any) => a.id === '1611')
    const wEngine = (cat.wEngines as any[]).find((w: any) => w.id === '14161')
    expect(wEngine?.level60?.baseStat).toBe('def')

    const noWeapon = calcBasePanel(claret, undefined)
    const withWeapon = calcBasePanel(claret, wEngine)
    expect(withWeapon.def).toBeCloseTo(noWeapon.def + wEngine.level60.atkBase)
    expect(withWeapon.atk).toBe(noWeapon.atk)
  })

  it('covers the nanoka weapons that were previously missing (燃狱齿轮/朔月裁霜/骁骑礼赞等 16 把)', () => {
    const cat = loadCatalog()
    const wmap = new Map((cat.wEngines as any[]).map((w: any) => [w.id, w]))
    // 之前缺失的 16 把全部入库
    for (const id of ['12011', '12015', '13005', '13010', '13011', '13016', '13017', '13018', '13020', '13021', '13112', '13127', '13135', '14003', '14154', '14159']) {
      expect(wmap.has(id), `missing wEngine ${id}`).toBe(true)
    }
    // 关键 60 级面板口径
    expect(wmap.get('14110')?.level60).toMatchObject({ atkBase: 684, advancedStat: { stat: 'impact', value: 18, mode: 'pct' } })
    expect(wmap.get('14154')?.level60).toMatchObject({ atkBase: 713, advancedStat: { stat: 'anomalyMastery', value: 30, mode: 'pct' } })
    expect(wmap.get('14159')?.level60).toMatchObject({ atkBase: 713, advancedStat: { stat: 'critDmg', value: 48, mode: 'flat' } })
    // 锋御防御主词条（基础防御力 24 → 60 级 356，baseStat=def）
    expect(wmap.get('13017')?.level60).toMatchObject({ atkBase: 356, baseStat: 'def', advancedStat: { stat: 'defPct', value: 40, mode: 'pct' } })
    expect(wmap.get('13021')?.level60).toMatchObject({ atkBase: 356, baseStat: 'def', advancedStat: { stat: 'critRate', value: 20, mode: 'flat' } })
    // 被动效果建模（selfBuff effects 非空；无法建模的纯减伤类为空但保留文本）
    for (const id of ['14110', '14154', '14159', '13005', '13021']) {
      const self = wmap.get(id)?.effect?.selfBuff
      expect(Array.isArray(self?.effects) && self.effects.length > 0, `${id} selfBuff effects`).toBe(true)
    }
    expect(wmap.get('13016')?.effect?.selfBuff?.effects ?? []).toEqual([]) // 减伤/秽息未建模
  })
})
