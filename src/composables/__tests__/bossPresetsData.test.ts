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

describe('boss 敌方体型（BOSS_BODY_SIZES 手录 2026-09-05，TeamCompare 选中时写入敌方配置）', () => {
  const LEGAL = ['small', 'medium', 'large'] as const

  it('全部 22 个预设都有合法 bodySize（新增 boss 未录体型即红，逼显式认领）', () => {
    for (const b of presets.bosses) {
      expect(LEGAL, `${b.id} ${b.name} bodySize 合法`).toContain(b.bodySize)
    }
    expect(presets.bosses.length).toBe(22)
  })

  it('抽检用户手录值（小型：名可名/叶释渊/始主/薇斯珀；中型：亵渎者/彷徨猎手/血清道夫/冥宁芙）', () => {
    const sizeOf = (id: string) => presets.bosses.find(b => b.id === id)?.bodySize
    expect(sizeOf('30034')).toBe('small') // 秽息妖鬼·名可名
    expect(sizeOf('30042')).toBe('small') // 魇缚者·叶释渊
    expect(sizeOf('40000')).toBe('small') // 太初梦魇·「始主」
    expect(sizeOf('40001')).toBe('small') // 叛律孤歌·薇斯珀
    expect(sizeOf('30038')).toBe('medium') // 「亵渎者」
    expect(sizeOf('30041')).toBe('medium') // 彷徨猎手
    expect(sizeOf('40002')).toBe('medium') // 猎血清道夫
    expect(sizeOf('300121')).toBe('medium') // 恶名·冥宁芙
    expect(sizeOf('30007')).toBe('large') // 恶名·死路屠夫
    expect(sizeOf('40006')).toBe('large') // 基塔布鲁
    expect(sizeOf('300082')).toBe('large') // 提丰·破坏者型
  })
})
