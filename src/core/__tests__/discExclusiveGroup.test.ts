/**
 * CC-101（R5 D8）：同 `exclusiveGroup` 的驱动盘 4 件套全队效果只计一次。
 *
 * 数据：31900 原始朋克 `fourPiece.teamBuff.exclusiveGroup = "proto_punk_4pc_team_dmg"`，
 * 原文「全队角色造成的伤害提升15%，持续10秒，同名被动效果之间不可叠加」。
 * 修前：`core/inCombatBuffs.ts` 对每个穿戴者各推一份 teamBuff，下游全程不去重 ⇒ 两人同穿 = +30。
 *
 * 范围口径（D8）：只有数据标了 exclusiveGroup 的组才去重；其余 6 套带 teamBuff 的 4 件套
 * 数据没有标，按 R5「数据可信」**不**推断它们互斥 ⇒ 摇摆爵士两人同穿仍为 +30（本文件钉住）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calcPanel } from '@/core/panel'
import { buildTeammateBuffSourceContext } from '@/core/teammateBuffSource'

const cat = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as any
const setsMap = new Map<string, any>(cat.driveDiscSets.map((s: any) => [String(s.id), s]))
const statRules = cat.statRules
const getAgent = (id: string) => cat.agents.find((a: any) => a.id === id || a.teammateBuffId === id)
const disc = (fourPieceSetId = ''): any => ({ fourPieceSetId, twoPieceSetId: '', mainStats: {}, subStatAllocation: {} })

/** 三人队 [1411, 1241, 1031]，按槽位给 4 件套；返回每人局内 dmgBonus */
function teamDmgBonus(sets: [string, string, string]): number[] {
  const ids = ['1411', '1241', '1031']
  const team = ids.map((agentId, i) => ({ agentId, driveDisc: disc(sets[i]), cinemaLevel: 0, wEngineModLevel: 1, wEngineId: undefined }))
  const ctx = buildTeammateBuffSourceContext(team, {
    teammateBuffGroups: [],
    driveDiscSetsMap: setsMap,
    statRules,
    getAgent,
    getWEngine: () => undefined,
    isTeammateBuffEnabled: () => false,
  })
  return ids.map((id, i) => calcPanel(getAgent(id), undefined, disc(sets[i]), setsMap, ctx.enabledTeammateBuffs, statRules, {
    cinemaLevel: 0,
    wEngineModLevel: 1,
    sourcePanelsByOwner: ctx.sourcePanelsByOwner,
  }).inCombat.dmgBonus)
}

describe('CC-101 exclusiveGroup：同组全队效果只计一次', () => {
  const base = teamDmgBonus(['', '', ''])
  const delta = (sets: [string, string, string]) => teamDmgBonus(sets).map((v, i) => v - base[i])

  it('数据前提：只有 31900 标了 exclusiveGroup', () => {
    const marked = cat.driveDiscSets.filter((s: any) => s.fourPiece?.teamBuff?.exclusiveGroup).map((s: any) => String(s.id))
    expect(marked).toEqual(['31900'])
  })

  it('原始朋克单人穿：全队（含装备者）+15', () => {
    expect(delta(['31900', '', ''])).toEqual([15, 15, 15])
  })

  it('★ 原始朋克两人同穿：全队仍 +15（修前 +30）', () => {
    expect(delta(['31900', '31900', ''])).toEqual([15, 15, 15])
    expect(delta(['31900', '31900', '31900'])).toEqual([15, 15, 15])
  })

  it('范围口径：未标 exclusiveGroup 的摇摆爵士两人同穿仍叠加（+30），不推断互斥', () => {
    expect(delta(['31600', '', ''])).toEqual([15, 15, 15])
    expect(delta(['31600', '31600', ''])).toEqual([30, 30, 30])
  })
})
