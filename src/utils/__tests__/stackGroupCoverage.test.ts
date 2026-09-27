/**
 * CC-111（R5 第 4 刀 D3）：覆盖率滑块按 stackGroup 联动。
 * 纯函数单测 + 数据前提（多成员组确实存在，且组内成员在同一件装备里）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { stackGroupPeerIds } from '@/utils/stackGroupCoverage'
import { buildDiscEffectRows } from '@/utils/discEffectRows'

const cat = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as any

describe('stackGroupPeerIds', () => {
  const members = [
    { id: 'a', stackGroup: 'g' },
    { id: 'b', stackGroup: 'g' },
    { id: 'c' },
    { id: 'd', stackGroup: 'h' },
  ]
  it('有组 ⇒ 同组全部成员', () => expect(stackGroupPeerIds(members, 'a').sort()).toEqual(['a', 'b']))
  it('无组 ⇒ 只有自己', () => expect(stackGroupPeerIds(members, 'c')).toEqual(['c']))
  it('单成员组 ⇒ 只有自己', () => expect(stackGroupPeerIds(members, 'd')).toEqual(['d']))
  it('未知 id ⇒ 只有自己', () => expect(stackGroupPeerIds(members, 'zz')).toEqual(['zz']))
})

describe('数据前提', () => {
  it('音擎：存在多成员 stackGroup，且组内成员同属一把音擎', () => {
    const owner = new Map<string, Set<string>>()
    for (const w of cat.wEngines) {
      for (const g of [w.effect?.selfBuff, w.effect?.teamBuff]) {
        for (const e of g?.effects ?? []) {
          if (!e?.stackGroup) continue
          if (!owner.has(e.stackGroup)) owner.set(e.stackGroup, new Set())
          owner.get(e.stackGroup)!.add(String(w.id))
        }
      }
    }
    for (const [g, ws] of owner) expect(ws.size, g).toBe(1)
    const members = cat.wEngines.flatMap((w: any) => [w.effect?.selfBuff, w.effect?.teamBuff].flatMap((g: any) => g?.effects ?? []))
      .filter((e: any) => e?.id).map((e: any) => ({ id: e.id, stackGroup: e.stackGroup }))
    expect(stackGroupPeerIds(members, members.find((m: any) => m.stackGroup === 'qingming_companion').id).length).toBeGreaterThan(1)
  })

  it('驱动盘：行上带出 stackGroup，32900 如影相随同组 ≥ 2 行', () => {
    const set = cat.driveDiscSets.find((s: any) => String(s.id) === '32900')
    const rows = buildDiscEffectRows(set, undefined).filter(r => r.setId === '32900')
    const grouped = rows.filter(r => r.stackGroup === 'shadow_harmony_stacks')
    expect(grouped.length).toBeGreaterThanOrEqual(2)
    const peers = stackGroupPeerIds(rows.map(r => ({ id: r.key, stackGroup: r.stackGroup })), grouped[0].key)
    expect(peers.sort()).toEqual(grouped.map(r => r.key).sort())
  })
})

describe('CC-111（R5 D7）带持续时间的效果给滑块', () => {
  it('31600 四件套 teamBuff（组级 durationSeconds、效果无 condition / coverage）可调', () => {
    const set = cat.driveDiscSets.find((s: any) => String(s.id) === '31600')
    expect(set.fourPiece.teamBuff.durationSeconds).not.toBeUndefined()
    const row = buildDiscEffectRows(set, undefined).find(r => r.key === 'effect_swing_jazz_4pc_team_dmg')
    expect(row?.adjustable).toBe(true)
  })
})
