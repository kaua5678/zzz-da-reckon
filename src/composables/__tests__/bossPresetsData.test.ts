import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const presets = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as {
  phaseViews: Array<Record<string, any>>
  bosses: Array<{ id: string; phases: Array<Record<string, any>>; [k: string]: any }>
}

describe('boss-presets 期视图数据不变量', () => {
  it('每期 = 1 困难 + 3 普通，且都是危局强袭战（全有预设可应用）', () => {
    for (const v of presets.phaseViews) {
      expect(v.criticalAssault, `${v.phaseId} 困难`).toBeTruthy()
      expect(v.defense.length, `${v.phaseId} 普通数量`).toBe(3)
      // 困难与普通都必须能定位到预设（一期 = 1 困难 + 3 普通，都是危局）
      for (const b of [v.criticalAssault, ...v.defense]) {
        expect(b.presetId, `${v.phaseId} ${b.name} presetId`).toBeTruthy()
        const preset = presets.bosses.find(p => p.id === b.presetId)
        expect(preset, `${v.phaseId} ${b.name} 预设存在`).toBeTruthy()
        expect(
          preset!.phases.some(p => p.phaseId === v.phaseId && p.zoneKey === b.zoneKey),
          `${v.phaseId} ${b.name} 预设含对应期 phase`,
        ).toBe(true)
      }
      // 当期 buff 3 张牌
      expect(v.buffs.length).toBe(3)
    }
  })

  it('困难 Boss 的期数是 critical_assault，普通是 defense', () => {
    for (const v of presets.phaseViews) {
      const caPreset = presets.bosses.find(p => p.id === v.criticalAssault.presetId)
      const caPhase = caPreset!.phases.find(p => p.phaseId === v.phaseId && p.zoneKey === v.criticalAssault.zoneKey)
      expect(caPhase!.modeType).toBe('critical_assault')
      for (const d of v.defense) {
        const preset = presets.bosses.find(p => p.id === d.presetId)
        const phase = preset!.phases.find(p => p.phaseId === v.phaseId && p.zoneKey === d.zoneKey)
        expect(phase!.modeType).toBe('defense')
      }
    }
  })

  it('期视图覆盖全部 6 期且按日期倒序', () => {
    expect(presets.phaseViews.length).toBe(6)
    const begins = presets.phaseViews.map(v => v.begin)
    const sorted = [...begins].sort().reverse()
    expect(begins).toEqual(sorted)
  })
})
