/**
 * CC-110（R5 第 3 刀身份类：`wEngines[].specialty` / `effect.requirement.specialty`）：
 * 音擎团队效果只在装备者特化与音擎特化一致时向队友传播。
 *
 * 自身通路 `collectAllBuffs` 早已按 `wEngine.specialty === agent.specialty`（matchSpecialty）拦截；
 * 团队通路 `collectInCombatTeamBuffs` 修前漏了这道门 ⇒ 特化不符的装备者照样给队友发团队效果。
 * 夹具自证：从 catalog 取一把带 teamBuff 的音擎，分别配给「特化一致」与「特化不一致」的角色。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { collectInCombatTeamBuffs } from '@/core/inCombatBuffs'

const cat = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as any
const getAgent = (id: string) => cat.agents.find((a: any) => a.id === id)
const getWEngine = (id: string) => cat.wEngines.find((w: any) => String(w.id) === id)
const disc = (): any => ({ fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} })

// 带 teamBuff、且 teamBuff 无 condition 的第一把音擎（避免条件门干扰判据）
const engine = cat.wEngines.find((w: any) => w.effect?.teamBuff?.effects?.length && !w.effect.teamBuff.condition)
const match = cat.agents.find((a: any) => a.specialty === engine?.specialty)
const mismatch = cat.agents.find((a: any) => a.specialty && a.specialty !== engine?.specialty)

function teamIds(wearerId: string): string[] {
  const buffs = collectInCombatTeamBuffs(
    [{ agentId: wearerId, wEngineId: String(engine.id), wEngineModLevel: 1, driveDisc: disc(), cinemaLevel: 0 }],
    {
      teammateBuffGroups: [],
      driveDiscSetsMap: new Map(),
      getAgent,
      getWEngine,
      isTeammateBuffEnabled: () => false,
    },
  )
  return buffs.map(b => b.id)
}

describe('CC-110 音擎团队效果按装备者特化拦截', () => {
  it('夹具前提：找到带无条件 teamBuff 的音擎与两类装备者', () => {
    expect(engine).toBeTruthy()
    expect(match?.specialty).toBe(engine.specialty)
    expect(mismatch?.specialty).not.toBe(engine.specialty)
  })

  it('特化一致：团队效果照常发放', () => {
    expect(teamIds(match.id)).toContain(`wengine-team-${engine.id}`)
  })

  it('★ 特化不一致：团队效果不发放（修前会发放）', () => {
    expect(teamIds(mismatch.id)).not.toContain(`wengine-team-${engine.id}`)
  })
})
