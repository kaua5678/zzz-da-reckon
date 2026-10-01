/**
 * CC-341：危局 buff 牌条件（特性限定 / 特性人数分档）的唯一解析 + 「牌 → 全局 Buff 行」唯一映射。
 * 管线侧（按当前队伍解析、写入方带 cond）的端到端断言见 `src/composables/__tests__/phaseBuffCond.test.ts`。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  phaseBuffCondLabel,
  phaseBuffRows,
  resolvePhaseBuffValue,
  specialtyCodeOfLabel,
  teamSpecialtiesOf,
} from '@/utils/phaseBuff'
import { SPECIALTY_LABEL } from '@/utils/agentLabelMaps'
import type { BossPresetFile, PhaseBuffCard } from '@/types/bossPreset'

const tier = { countTier: { specialty: '异常', thresholds: [2, 3] as [number, number], values: [10, 70] as [number, number] } }

describe('CC-341 resolvePhaseBuffValue（危局 buff 牌条件的唯一解析）', () => {
  it('无条件 ⇒ 原值', () => {
    expect(resolvePhaseBuffValue(15, undefined, [])).toBe(15)
  })

  it('特性限定：队里有该特性 ⇒ 原值；没有 ⇒ null', () => {
    expect(resolvePhaseBuffValue(30, { specialty: '强攻' }, ['attack', 'support'])).toBe(30)
    expect(resolvePhaseBuffValue(30, { specialty: '强攻' }, ['anomaly', 'anomaly', 'support'])).toBeNull()
  })

  it('人数分档：2 名取低档、3 名取满编档、不足 ⇒ null（与 CC-341 前 teamCompare#resolveBuffEffect 同口径）', () => {
    expect(resolvePhaseBuffValue(70, tier, ['anomaly', 'anomaly', 'support'])).toBe(10)
    expect(resolvePhaseBuffValue(70, tier, ['anomaly', 'anomaly', 'anomaly'])).toBe(70)
    expect(resolvePhaseBuffValue(70, tier, ['anomaly', 'stun', 'support'])).toBeNull()
  })

  it('特性限定 + 人数分档并存：先判限定，再按人数取档', () => {
    const both = { specialty: '击破', ...tier }
    expect(resolvePhaseBuffValue(70, both, ['anomaly', 'anomaly', 'support'])).toBeNull()
    expect(resolvePhaseBuffValue(70, both, ['anomaly', 'anomaly', 'stun'])).toBe(10)
  })

  it('未收录的特性名 ⇒ 匹配不到任何在场角色（条件不成立）', () => {
    expect(resolvePhaseBuffValue(5, { specialty: '未知职业' }, ['attack', 'stun', 'anomaly'])).toBeNull()
  })
})

describe('CC-341 specialtyCodeOfLabel（由 SPECIALTY_LABEL 反查，单一来源）', () => {
  it('SPECIALTY_LABEL 的每个中文名都反查回 code', () => {
    for (const [code, label] of Object.entries(SPECIALTY_LABEL)) expect(specialtyCodeOfLabel(label)).toBe(code)
  })

  it('boss-presets.json 里解析器产出的全部条件特性名都能反查（解析器出现新词时这里红）', () => {
    const bp = JSON.parse(
      readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8'),
    ) as BossPresetFile
    const labels = new Set<string>()
    for (const v of bp.phaseViews ?? []) {
      const cards: PhaseBuffCard[] = [...(v.buffs ?? [])]
      for (const b of [...(v.criticalAssault ? [v.criticalAssault] : []), ...(v.defense ?? [])]) cards.push(...(b.bossBuffs ?? []))
      for (const c of cards) {
        for (const e of c.effects ?? []) {
          if (e.cond?.specialty) labels.add(e.cond.specialty)
          if (e.cond?.countTier) labels.add(e.cond.countTier.specialty)
        }
      }
    }
    expect(labels.size).toBeGreaterThan(0)
    const known = new Set(Object.values(SPECIALTY_LABEL))
    expect([...labels].filter(l => !known.has(l))).toEqual([])
  })
})

describe('CC-341 teamSpecialtiesOf / phaseBuffCondLabel / phaseBuffRows', () => {
  it('teamSpecialtiesOf：空槽与目录查不到的角色不计', () => {
    const map: Record<string, string> = { a: 'attack', b: 'anomaly' }
    expect(teamSpecialtiesOf([{ agentId: 'a' }, { agentId: '' }, { agentId: 'zz' }, null, { agentId: 'b' }], id => map[id]))
      .toEqual(['attack', 'anomaly'])
  })

  it('phaseBuffCondLabel：分档在前、限定在后；无条件为空串（Boss 卡标签原格式）', () => {
    expect(phaseBuffCondLabel(undefined)).toBe('')
    expect(phaseBuffCondLabel({ specialty: '强攻' })).toBe('强攻限定')
    expect(phaseBuffCondLabel({ specialty: '击破', ...tier })).toBe('异常2/3名，击破限定')
  })

  it('phaseBuffRows：逐条效果一行、cond 原样带上、目标招式缺省 all、无 stat 的效果跳过', () => {
    const card: PhaseBuffCard = {
      title: 't',
      testOnly: false,
      unparsed: [],
      effects: [
        { stat: 'critDmg', value: 60, cond: { specialty: '强攻' } },
        { stat: 'skillDmgBonus', value: 25, targetSkillType: 'chain' },
        { stat: '', value: 1 },
      ],
    }
    const rows = phaseBuffRows(card, (e, i) => `x:${e.stat}:${i}`, '名')
    expect(rows).toEqual([
      { id: 'x:critDmg:0', name: '名', stat: 'critDmg', value: 60, enabled: true, targetSkillType: 'all', cond: { specialty: '强攻' } },
      { id: 'x:skillDmgBonus:1', name: '名', stat: 'skillDmgBonus', value: 25, enabled: true, targetSkillType: 'chain' },
    ])
    expect('cond' in rows[1]).toBe(false)
  })
})

describe('CC-341 源码锁：buff 牌条件的取值逻辑只有一处', () => {
  it('src 下（测试除外）只有 utils/phaseBuff.ts 与类型定义出现 countTier', () => {
    const srcRoot = fileURLToPath(new URL('../../', import.meta.url))
    const allowed = new Set(['utils/phaseBuff.ts', 'types/bossPreset.ts'])
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); continue }
        if (!/\.(ts|vue)$/.test(name) || name.endsWith('.test.ts')) continue
        const rel = relative(srcRoot, p).split(sep).join('/')
        if (!allowed.has(rel) && readFileSync(p, 'utf8').includes('countTier')) offenders.push(rel)
      }
    }
    walk(srcRoot)
    expect(offenders).toEqual([])
  })
})
