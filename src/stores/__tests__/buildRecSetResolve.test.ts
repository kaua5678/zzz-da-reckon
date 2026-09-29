/**
 * CC-269：配装推荐的套装按 catalog id 解析（applyBuildRecommendationForSlot）。
 * 修前按 name_zh 全等匹配，数据「雪兔梦游仙境 」带尾随空格 ⇒ 1071/1271/1341/1421 的 4pc 静默落到兜底套装。
 * 本锁从数据侧全员出发：每个 catalog 角色应用推荐后，4pc / 2pc 必须等于推荐条目给的套装 id。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'

describe('CC-269 推荐套装按 id 解析', () => {
  it('每个角色应用推荐后 4pc / 2pc = 推荐条目 id', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    const recs = await catalog.loadBuildRecommendations()
    const bad: string[] = []
    for (const agent of catalog.agentsMap.values()) {
      const rec = recs?.characters[agent.id]
      if (!rec) { bad.push(`${agent.id} 无推荐`); continue }
      config.team[0]!.agentId = agent.id
      config.team[0]!.driveDisc.fourPieceSetId = ''
      config.team[0]!.driveDisc.twoPieceSetId = ''
      config.applyBuildRecommendationForSlot(0)
      const d = config.team[0]!.driveDisc
      if (rec.drive_disc_sets.four_piece && d.fourPieceSetId !== rec.drive_disc_sets.four_piece.id) bad.push(`${agent.id} 4pc ${d.fourPieceSetId}≠${rec.drive_disc_sets.four_piece.id}`)
      if (rec.drive_disc_sets.two_piece && d.twoPieceSetId !== rec.drive_disc_sets.two_piece.id) bad.push(`${agent.id} 2pc ${d.twoPieceSetId}≠${rec.drive_disc_sets.two_piece.id}`)
    }
    expect(bad).toEqual([])
  }, 60_000)
})
