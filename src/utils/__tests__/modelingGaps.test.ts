import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  collectCinemaGaps,
  collectMechanicGaps,
  describeDriveDiscSetGaps,
  discSetGapLabel,
} from '../modelingGaps'

describe('套装未建模标记', () => {
  it('已建模套装（selfBuff 有数据）无角标', () => {
    const set = {
      twoPiece: { effects: [{ stat: 'atkPct' }] },
      fourPiece: { effectText: { zhCN: 'x' }, selfBuff: { effects: [{ stat: 'dmgBonus' }] }, teamBuff: null },
    }
    expect(describeDriveDiscSetGaps(set)).toEqual({ twoPieceUnmodeled: false, fourPieceUnmodeled: false })
    expect(discSetGapLabel(set)).toBe('')
  })

  it('全队型 4pc（teamBuff 有数据）不算未建模', () => {
    const set = {
      twoPiece: { effects: [{}] },
      fourPiece: { effectText: { zhCN: 'x' }, selfBuff: null, teamBuff: { effects: [{}] } },
    }
    expect(discSetGapLabel(set)).toBe('')
  })

  it('灵魂摇滚型（4pc 只有文本）→ 4pc未建模', () => {
    const set = {
      twoPiece: { effects: [{}] },
      fourPiece: { effectText: { zhCN: '受击减伤' }, selfBuff: null, teamBuff: null },
    }
    expect(discSetGapLabel(set)).toBe('（4pc未建模）')
  })

  it('原始朋克型（2pc 缺失）→ 2pc未建模', () => {
    const set = {
      twoPiece: undefined,
      fourPiece: { effectText: { zhCN: 'x' }, selfBuff: null, teamBuff: { effects: [{}] } },
    }
    expect(discSetGapLabel(set)).toBe('（2pc未建模）')
  })
})

describe('部署建模缺口清单', () => {
  const constellations = {
    '1551': {
      name: { zhCN: '佩洛伊斯' },
      cinemas: [
        { cinema: 2, status: 'implemented_approximation', pending: ['覆盖率近似'] },
        { cinema: 6, status: 'not_described_not_implemented', pending: ['影画效果未揭示'] },
      ],
    },
    '1071': { name: { zhCN: '凯撒' }, cinemas: [{ cinema: 4, status: 'implemented', pending: [] }] },
  }
  const mechanics = {
    '1551': {
      name: { zhCN: '佩洛伊斯' },
      mechanics: [
        { name: '阳炎', implementation: 'implemented' },
        { name: '潜能觉醒', implementation: 'pending', pending: ['占位测试数据'] },
      ],
    },
  }

  it('pending 非空即列（2026-09-10 口径：implemented 带遗留待办也现形，status 只定措辞）', () => {
    const hints = collectCinemaGaps(constellations as never, ['1551', '1071'])
    expect(hints).toHaveLength(2)
    const c2 = hints.find(h => h.text.startsWith('C2'))
    const c6 = hints.find(h => h.text.startsWith('C6'))
    expect(c2).toMatchObject({ kind: 'cinema', agentName: '佩洛伊斯' })
    expect(c2!.text).toContain('已实现·遗留待办')
    expect(c2!.text).toContain('覆盖率近似')
    expect(c6!.text).toContain('未接入计算')
    expect(c6!.text).toContain('影画效果未揭示')
  })

  it('implemented 且无 pending → 不列', () => {
    const hints = collectCinemaGaps(constellations as never, ['1071'])
    expect(hints).toEqual([])
  })

  it('机制 pending 列出，implemented 无 pending 不列', () => {
    const hints = collectMechanicGaps(mechanics as never, ['1551'])
    expect(hints).toHaveLength(1)
    expect(hints[0].kind).toBe('mechanic')
    expect(hints[0].text).toContain('潜能觉醒')
    expect(hints[0].text).toContain('未接入计算')
  })

  it('账本缺失/角色不在账本 → 空清单不抛错', () => {
    expect(collectCinemaGaps(undefined, ['1551'])).toEqual([])
    expect(collectMechanicGaps({}, ['9999'])).toEqual([])
  })

  it('真实账本数据驱动：带 pending 的条目全部现形（判据：143 条存量不再静默）', () => {
    const cin = JSON.parse(
      readFileSync(new URL('../../../public/static/character-constellations.json', import.meta.url), 'utf8'),
    )
    const mec = JSON.parse(
      readFileSync(new URL('../../../public/static/character-mechanics.json', import.meta.url), 'utf8'),
    )
    const agentIds = Object.keys(cin.characters)
    const cinemaHints = collectCinemaGaps(cin.characters as never, agentIds)
    const mechanicHints = collectMechanicGaps(mec.characters as never, agentIds)
    // 判据 A：任何带 pending 的命座/机制条目都出现在清单里
    for (const ch of Object.values(cin.characters) as any[]) {
      for (const c of ch.cinemas ?? []) {
        if ((c.pending ?? []).length > 0) {
          expect(cinemaHints.some(h => h.text.startsWith(`C${c.cinema}`))).toBe(true)
        }
      }
    }
    for (const ch of Object.values(mec.characters) as any[]) {
      for (const m of ch.mechanics ?? []) {
        if ((m.pending ?? []).length > 0) {
          const name = typeof m.name === 'string' ? m.name : m.name?.zhCN ?? ''
          expect(mechanicHints.some(h => h.text.includes(name))).toBe(true)
        }
      }
    }
    // 判据 B：无 pending 的 implemented 不列（status 只定措辞，不决定出现与否）
    for (const h of cinemaHints) {
      expect(h.text).toMatch(/未接入计算|已实现·遗留待办/)
    }
    // 判据 C：存量规模（2026-09-10 实测：命座 104 + 机制 42 + 未描述 6+1）
    expect(cinemaHints.length).toBeGreaterThanOrEqual(104)
    expect(mechanicHints.length).toBeGreaterThanOrEqual(41)
  })
})
