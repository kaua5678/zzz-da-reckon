import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const presets = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as {
  phaseViews: Array<Record<string, any>>
  bosses: Array<{ id: string; phases: Array<Record<string, any>>; [k: string]: any }>
}

describe('boss-presets 期视图数据不变量', () => {
  it('每期 = 3 普通 + 3 buff；3.1/3.2 有 1 困难，1.4–3.0 无困难（全有预设可应用）', () => {
    for (const v of presets.phaseViews) {
      const hasCa = v.version === '3.1' || v.version === '3.2'
      if (hasCa) expect(v.criticalAssault, `${v.phaseId} 困难`).toBeTruthy()
      else expect(v.criticalAssault, `${v.phaseId} 困难`).toBeNull()
      expect(v.defense.length, `${v.phaseId} 普通数量`).toBe(3)
      expect(v.buffs.length, `${v.phaseId} buff 数量`).toBe(3)
      // 普通与困难（若有）都必须能定位到预设（一期 = 1 困难 + 3 普通，都是危局）
      const briefs = hasCa ? [v.criticalAssault, ...v.defense] : [...v.defense]
      for (const b of briefs) {
        expect(b.presetId, `${v.phaseId} ${b.name} presetId`).toBeTruthy()
        const preset = presets.bosses.find(p => p.id === b.presetId)
        expect(preset, `${v.phaseId} ${b.name} 预设存在`).toBeTruthy()
        expect(
          preset!.phases.some(p => p.phaseId === v.phaseId && p.zoneKey === b.zoneKey),
          `${v.phaseId} ${b.name} 预设含对应期 phase`,
        ).toBe(true)
      }
    }
  })

  it('困难 Boss 的期数是 critical_assault，普通是 defense', () => {
    for (const v of presets.phaseViews) {
      if (v.criticalAssault) {
        const caPreset = presets.bosses.find(p => p.id === v.criticalAssault.presetId)
        const caPhase = caPreset!.phases.find(p => p.phaseId === v.phaseId && p.zoneKey === v.criticalAssault.zoneKey)
        expect(caPhase!.modeType).toBe('critical_assault')
      }
      for (const d of v.defense) {
        const preset = presets.bosses.find(p => p.id === d.presetId)
        const phase = preset!.phases.find(p => p.phaseId === v.phaseId && p.zoneKey === d.zoneKey)
        expect(phase!.modeType).toBe('defense')
      }
    }
  })

  it('期视图覆盖全部 47 期（1.4–3.2）；困难模式仅 3.1/3.2', () => {
    expect(presets.phaseViews.length).toBe(47)
    const versions = [...new Set(presets.phaseViews.map(v => v.version))]
    expect(versions).toContain('1.4')
    expect(versions).toContain('3.2')
    const caVersions = [...new Set(presets.phaseViews.filter(v => v.criticalAssault).map(v => v.version))]
    expect(caVersions.sort()).toEqual(['3.1', '3.2'])
  })
})
