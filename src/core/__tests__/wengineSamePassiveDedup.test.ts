/**
 * 同名音擎被动不叠加（ZZZ 通用规则，effect.description 逐条明写「同名被动效果之间不可叠加」）。
 *
 * 修前两处双吃（用户 2026-10-24 报：雅柚苍两个辅助自动下位都选啜泣摇篮，实际吃不到双份）：
 * - 传播通路 `collectInCombatTeamBuffs`：两个装备者各 push 一条 `wengine-team-<id>` ⇒ 队友双份；
 * - 自身通路 `collectWEngineBuffs`：每个装备者照吃自己那份 teamBuff ⇒ 后装者自身也双份。
 * 实测第二把摇篮贡献 +19.13% 全队伤害（纯错误增益）。修后：传播按 wEngine.id 先到先得（槽位序），
 * 后装者的自身通路按 teammateBuffs 占用判定抑制 teamBuff 份（selfBuff 如后场回能各装各的，不受限）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { collectInCombatTeamBuffs } from '@/core/inCombatBuffs'
import { collectAllBuffs } from '@/core/buff'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

const cat = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as any
const getAgent = (id: string) => cat.agents.find((a: any) => a.id === id)
const getWEngine = (id: string) => cat.wEngines.find((w: any) => String(w.id) === id)
const disc = (): any => ({ fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} })

const CRADLE = '14121' // 啜泣摇篮：selfBuff 后场回能 + teamBuff 全队增伤（同名不叠加）
const PAO = '13115'    // 好斗的阿炮：teamBuff 全队 ATK 叠层
const BALL = '14002'   // 逍遥游球：teamBuff 全队暴击率（属性克制触发）
const YUZUHA = getAgent('1411') // 柚叶（支援）
const SOUKAKU = getAgent('1131') // 苍角（支援）

function collectTeam(wearerIds: string[]): string[] {
  return collectInCombatTeamBuffs(
    wearerIds.map(id => ({ agentId: id, wEngineId: CRADLE, wEngineModLevel: 5, driveDisc: disc(), cinemaLevel: 0 })),
    { teammateBuffGroups: [], driveDiscSetsMap: new Map(), getAgent, getWEngine, isTeammateBuffEnabled: () => false },
  ).map(b => b.id)
}

async function measure(yuzuW: string, soukakuW: string): Promise<number> {
  const { config } = await setupHarness([
    { agentId: '1091', cinemaLevel: 0 },
    { agentId: '1411', cinemaLevel: 0 },
    { agentId: '1131', cinemaLevel: 0 },
  ] as never, { recommendedBuild: true } as never)
  config.team[1].wEngineId = yuzuW
  config.team[2].wEngineId = soukakuW
  const calc = useResourceCalc()
  void calc.damagePoolRows.value
  await new Promise(r => setTimeout(r, 0))
  return calc.teamTotalDamage.value
}

describe('同名音擎被动不叠加', () => {
  it('夹具前提：啜泣摇篮的 teamBuff 与两位支援特化匹配', () => {
    const cradle = getWEngine(CRADLE)
    expect(cradle.effect.teamBuff?.effects?.length, '摇篮须带 teamBuff（全队增伤）').toBeGreaterThan(0)
    expect(cradle.specialty).toBe(YUZUHA.specialty)
    expect(cradle.specialty).toBe(SOUKAKU.specialty)
  })

  it('★ 传播通路：两人同装摇篮 ⇒ wengine-team-14121 只一条（先到先得，修前两条）', () => {
    const ids = collectTeam([YUZUHA.id, SOUKAKU.id])
    expect(ids.filter(id => id === `wengine-team-${CRADLE}`)).toHaveLength(1)
  })

  it('★ 自身通路：后装者的 teammateBuffs 已有同名条目 ⇒ 不再给自己发 teamBuff 份（selfBuff 保留）', () => {
    const cradle = getWEngine(CRADLE)
    const teamEffectStats = cradle.effect.teamBuff.effects.map((e: any) => e.stat)
    const selfEffectStats = cradle.effect.selfBuff.effects.map((e: any) => e.stat)
    const occupied = [{
      id: `wengine-team-${CRADLE}`, effects: [], teammateId: YUZUHA.id,
    } as never]
    const suppressed = collectAllBuffs(SOUKAKU, cradle, disc(), new Map(), occupied, {
      cinemaLevel: 0, wEngineModLevel: 5,
    })
    const free = collectAllBuffs(SOUKAKU, cradle, disc(), new Map(), [], {
      cinemaLevel: 0, wEngineModLevel: 5,
    })
    const statsOf = (b: { inCombat: Array<{ stat: string }> }) => b.inCombat.map(e => e.stat)
    // 抑制后：teamBuff 的效果 stat 全部消失，selfBuff（后场回能）保留
    for (const stat of teamEffectStats) {
      expect(statsOf(suppressed), `后装者不再吃 teamBuff 份（${stat}）`).not.toContain(stat)
      expect(statsOf(free), '夹具前提：无人占用时该份照常发放').toContain(stat)
    }
    for (const stat of selfEffectStats) {
      expect(statsOf(suppressed), `selfBuff 各装各的，不受同名限制（${stat}）`).toContain(stat)
    }
  })

  it('★ 行为层：雅柚苍双摇篮不再双吃 —— 第二把只剩白值+回能，必输阿炮/游球（自动下位贪心会避开）', async () => {
    const both = await measure(CRADLE, CRADLE)
    const pao = await measure(CRADLE, PAO)
    const ball = await measure(CRADLE, BALL)
    expect(both, '双摇篮 < 摇篮+阿炮（修前双吃时反而最高）').toBeLessThan(pao)
    expect(both, '双摇篮 < 摇篮+游球').toBeLessThan(ball)
  }, 600000)
})
