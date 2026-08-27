import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')

interface MoveLike {
  id: string
  name?: { zhCN?: string; en?: string }
  timeType?: string
  actionTime?: number
  rows?: { id: string; values: number[] }[]
}

function etherOf(m: MoveLike): number { return m.rows?.find(r => r.id === 'ether_purify')?.values[0] ?? 0 }
function buildupOf(m: MoveLike): number { return m.rows?.find(r => r.id === 'anomaly_buildup')?.values[0] ?? 0 }

function typeBonus(m: MoveLike): number {
  const zh = m.name?.zhCN ?? ''
  const en = m.name?.en ?? ''
  if (m.timeType === 'ultimate' || zh.includes('终结技') || /Ultimate/.test(en)) return 500
  if (zh.startsWith('闪避反击') || /Dodge Counter/.test(en)) return 150
  if (zh.startsWith('招架支援') || /Defensive Assist/.test(en)) return 250
  return 0
}

function* allMoves(catalog: any): Generator<[string, string, MoveLike]> {
  const an = Object.fromEntries((catalog.agents ?? []).map((a: any) => [a.id, a.name?.zhCN ?? a.id]))
  for (const sk of catalog.agentSkills ?? []) {
    const aid = sk.agentId
    for (const cat of sk.categories ?? []) {
      for (const m of cat.moves ?? []) {
        yield [aid, an[aid] ?? aid, m]
      }
    }
  }
}

describe('actionTime 数据质量护栏', () => {
  const catalog = JSON.parse(catalogText)
  const moves = [...allMoves(catalog)]

  it('佩洛伊斯四终结技 = 用户核对值（积蓄/100 口径）', () => {
    const overrides: Record<string, number> = {
      '1551015': 2.4329, // 万军诛绝：积蓄 243.29
      '1551014': 1.1503, // 凯旋坦途：积蓄 115.03
      '1551013': 3.0663, // 无拘剑势：积蓄 306.63
      '1551016': 2.2836, // 永陷幽囚：积蓄 228.36
    }
    for (const [aid, , m] of moves) {
      if (aid !== '1551') continue
      if (overrides[m.id] != null) {
        expect(m.actionTime, `${m.id} ${m.name?.zhCN}`).toBe(overrides[m.id])
        expect(m.actionTime).toBeCloseTo(buildupOf(m) / 100, 4)
      }
    }
  })

  it('可琳/妮可/奥菲丝 用户核对覆盖（异型秽盾奖励）', () => {
    const overrides: Record<string, number> = {
      '1061015': 0.6581, '1061016': 0.6581, // 可琳 [舍]#1/#2：150 分散成 75+100t
      '1031205': 0.3164, '1031206': 0.3164, // 妮可 牵制炮击 #1/#2：同上
      '1031304': 0.36,   '1031305': 0.54,   // 妮可 特制以太榴弹 #1/#2：奖励 200/300
      '1301015': 0.27,   '1301016': 0.18,   // 奥菲丝 与火共舞 #1/#2：奖励 300/200
    }
    for (const [, , m] of moves) {
      if (overrides[m.id] != null) {
        expect(m.actionTime, `${m.id} ${m.name?.zhCN}`).toBe(overrides[m.id])
      }
    }
  })

  it('类型加成缺失形态不允许钳位哨兵（秽盾≈积蓄 → 积蓄/100；招架支援无积蓄 → 秽盾/100）', () => {
    const failures: string[] = []
    for (const [, name, m] of moves) {
      const bonus = typeBonus(m)
      if (!bonus) continue
      const ether = etherOf(m)
      if (ether <= 0) continue
      const buildup = buildupOf(m)
      if (buildup > 0 && Math.abs(ether - buildup) <= 2) {
        const expected = Math.round(buildup / 100 * 10000) / 10000
        const actual = m.actionTime ?? 0
        if (actual !== expected) {
          failures.push(`${m.id} ${m.name?.zhCN ?? ''}：${name} 秽盾${ether}≈积蓄${buildup}，期望="${expected}" 实际="${actual}"`)
        }
      } else if (buildup <= 0 && ether <= bonus) {
        const expected = Math.round(ether / 100 * 1000) / 1000
        const actual = m.actionTime ?? 0
        if (actual !== expected) {
          failures.push(`${m.id} ${m.name?.zhCN ?? ''}：${name} 无积蓄秽盾${ether}≤加成${bonus}，期望="${expected}" 实际="${actual}"`)
        }
      }
    }
    expect(failures).toEqual([])
  })
})