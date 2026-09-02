import { describe, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { YESHUGUANG_FULL_STUN_MOVES } from '@/mechanics/agents/yeshuguang'

describe('叶瞬光面板分解 + 易伤平均', () => {
  it('print decomposition', async () => {
    const { config, catalog } = await setupHarness([
      { agentId: '1431', cinemaLevel: 0 },
      { agentId: '1481', cinemaLevel: 0 },
      { agentId: '1491', cinemaLevel: 0 },
    ])
    for (const buff of config.globalBuffs) buff.enabled = false
    config.team[0].wEngineId = '14143'
    config.team[0].wEngineModLevel = 1
    config.team[0].driveDisc = {
      fourPieceSetId: '33500', twoPieceSetId: '32700',
      mainStats: { 4: 'critDmg', 5: 'physicalDmg', 6: 'atkPct' },
      subStatAllocation: { atkPct: 8, atkFlat: 6, critRate: 12, critDmg: 10 },
    } as any
    config.syncTeammateBuffsFromTeam()

    const phases = computePanelPhases(0, config, catalog)!
    const out = phases.outOfCombat as any
    const p = phases.inCombat as any
    const agent = catalog.getAgent('1431')!
    const we = catalog.getWEngine('14143')!

    console.log('=== ATK 分解 ===')
    console.log('agent atkBase =', agent.level60.atkBase)
    console.log('wEngine atkBase =', we.level60.atkBase)
    console.log('outOfCombat.atk =', out.atk, '(白值+音擎+盘主副词条+局外)')
    console.log('inCombat.atk =', p.atk, '(局外 + 局内% + 局内固定)')

    const calc = useResourceCalc()
    const ys = calc.resourceResult.value!.characters.find(c => c.agentId === '1431')!
    console.log('=== 面板(资源池 computePanel) ===')
    console.log('atk=', p.atk, '| dmgBonus=', p.dmgBonus, '| physicalDmg=', p.physicalDmg, '| critRate=', p.critRate, '| critDmg=', p.critDmg, '| penRatio=', p.penRatio)
    console.log('enemyDefReduction=', p.enemyDefReduction, '| enemyPhysicalResReduction=', p.enemyPhysicalResReduction, '| stunDmgMultiplierBonus=', p.stunDmgMultiplierBonus, '| yeshuguangStunCapMult=', p.yeshuguangStunCapMult)

    console.log('=== 易伤平均（按倍率加权） ===')
    let whiteMult = 0, nonWhiteMult = 0
    const rows: any[] = []
    for (const e of ys.executions ?? []) {
      const mid = e.moveId ?? ''
      const total = (e.count ?? 0) * (e.damageMultiplier ?? 0)
      if (total <= 0) continue
      const isWhite = YESHUGUANG_FULL_STUN_MOVES.has(mid)
      if (isWhite) whiteMult += total
      else nonWhiteMult += total
      rows.push({ mid, name: e.moveName, count: e.count, mult: e.damageMultiplier, total, isWhite })
    }
    const totalMult = whiteMult + nonWhiteMult
    // 白毛招吃满帷幕易伤 2.1（=min(1.5+0.9, 2.1)），非白毛招按失衡覆盖率折（这里覆盖率约 0.5 示例，实际取资源池 stunCoverage）
    // 用真实覆盖：从 calc 取
    const stunCov = (calc as any).stunCoverage?.value ?? 0.5
    const whiteVuln = 2.1
    const nonWhiteVuln = 1 + (whiteVuln - 1) * stunCov
    const avg = (whiteMult * whiteVuln + nonWhiteMult * nonWhiteVuln) / totalMult
    console.log(`白毛招倍率占比=${(whiteMult/totalMult*100).toFixed(1)}% 易伤=${whiteVuln}x`)
    console.log(`非白毛招倍率占比=${(nonWhiteMult/totalMult*100).toFixed(1)}% 易伤=${nonWhiteVuln.toFixed(2)}x (覆盖率${stunCov})`)
    console.log(`加权平均易伤 = ${avg.toFixed(3)}x`)
    console.log('--- 非白毛招明细 ---')
    for (const r of rows.filter(r => !r.isWhite)) console.log(r.mid, r.name, 'count=', r.count, 'totalMult=', r.total.toFixed(0))
  })
})
