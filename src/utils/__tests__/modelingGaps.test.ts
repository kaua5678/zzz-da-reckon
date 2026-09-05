import { describe, expect, it } from 'vitest'
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

  it('只列真缺口（not_described/pending），近似实现不列', () => {
    const hints = collectCinemaGaps(constellations as never, ['1551', '1071'])
    expect(hints).toHaveLength(1)
    expect(hints[0]).toMatchObject({ kind: 'cinema', agentName: '佩洛伊斯' })
    expect(hints[0].text).toContain('C6')
  })

  it('机制 pending 列出，implemented 不列', () => {
    const hints = collectMechanicGaps(mechanics as never, ['1551'])
    expect(hints).toHaveLength(1)
    expect(hints[0].kind).toBe('mechanic')
    expect(hints[0].text).toContain('潜能觉醒')
  })

  it('账本缺失/角色不在账本 → 空清单不抛错', () => {
    expect(collectCinemaGaps(undefined, ['1551'])).toEqual([])
    expect(collectMechanicGaps({}, ['9999'])).toEqual([])
  })
})
