/**
 * CC-209：局内生命构成拆解迁出 FinalPanel，覆盖率与引擎同表、全局 Buff 与引擎同口径，并给出差额。
 * 判据：无模块直写生命的队伍，按核对表重建的局内生命 == 引擎局内生命（差额≈0），拖滑块 / 加全局 Buff 后仍成立。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { collectHpSources, hpBreakdownTotals } from '@/composables/hpSourceBreakdown'

const BUFF = 'lucia_elowen.core_dream_song'

async function load() {
  const { config, catalog } = await setupHarness([{ agentId: '1451' }, { agentId: '1041' }, ''])
  const breakdown = (slot: number) => {
    const ph = computePanelPhases(slot, config, catalog)!
    const rows = collectHpSources(slot, config, catalog)
    return { rows, ph, ...hpBreakdownTotals(rows, ph.outOfCombat.hp ?? 0, ph.inCombat.hp ?? 0) }
  }
  return { config, breakdown }
}

describe('CC-209 局内生命构成与引擎同口径', () => {
  it('默认：卢西娅梦之歌 hpPct 5 列入 11 号，差额≈0', async () => {
    const { config, breakdown } = await load()
    expect(config.isTeammateBuffEnabled(BUFF)).toBe(true)
    const b = breakdown(1)
    const row = b.rows.find(r => r.stat === 'hpPct' && r.phase === 'in')!
    expect(row.num).toBeCloseTo(5, 9)
    expect(Math.abs(b.residualHp)).toBeLessThan(0.5)
  })

  it('滑块 50%：条目按引擎覆盖率折半，差额仍≈0（旧口径读 coverage.default=1 会留下 outHp×2.5% 的缺口）', async () => {
    const { config, breakdown } = await load()
    const before = breakdown(1).ph.inCombat.hp!
    config.setTeammateBuffCoverage(BUFF, 50)
    const b = breakdown(1)
    expect(b.ph.inCombat.hp!).toBeLessThan(before) // 判别力：引擎确实读滑块
    expect(b.rows.find(r => r.stat === 'hpPct' && r.phase === 'in')!.num).toBeCloseTo(2.5, 9)
    expect(Math.abs(b.residualHp)).toBeLessThan(0.5)
  })

  it('全局 Buff hpPct：按局内列出（引擎口径），差额≈0', async () => {
    const { config, breakdown } = await load()
    config.addGlobalBuff()
    const id = config.globalBuffs[config.globalBuffs.length - 1].id
    config.updateGlobalBuff(id, { stat: 'hpPct', value: 10, enabled: true, name: 'probe' })
    const b = breakdown(1)
    const g = b.rows.filter(r => r.source === '全局 Buff')
    expect(g.map(r => [r.phase, r.num])).toEqual([['in', 10]])
    expect(Math.abs(b.residualHp)).toBeLessThan(0.5)
  })
})
