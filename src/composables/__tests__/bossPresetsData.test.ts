import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const presets = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as {
  phaseViews: Array<Record<string, any>>
  bosses: Array<{ id: string; phases: Array<Record<string, any>>; [k: string]: any }>
}

/** 有困难（危局异构）模式的版本：3.1 起新增，1.4–3.0 只有普通。 */
const CA_VERSIONS = new Set(['3.1', '3.2', '3.3'])

describe('boss-presets 期视图数据不变量', () => {
  /** 测试服占位期（无 live_begin）：数据会变、Boss 名可能是占位，严格不变量只约束正式期。
   *  2026-10-26：3.3 三期（690481/690491/690501）已在正式服带 live_begin（10-23/11-06/11-20）⇒ 全部转正，
   *  当前没有占位期；分支保留，将来抓预发布构建又出现占位期时继续生效。 */
  const isTrial = (v: Record<string, any>) => !v.begin

  it('正式期 = 3 普通 + 3 buff；3.1 起有 1 困难，1.4–3.0 无困难（全有预设可应用）', () => {
    for (const v of presets.phaseViews) {
      if (isTrial(v)) continue
      const hasCa = CA_VERSIONS.has(v.version)
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
      if (v.criticalAssault?.presetId) {
        const caPreset = presets.bosses.find(p => p.id === v.criticalAssault.presetId)
        const caPhase = caPreset!.phases.find(p => p.phaseId === v.phaseId && p.zoneKey === v.criticalAssault.zoneKey)
        expect(caPhase!.modeType).toBe('critical_assault')
      }
      for (const d of v.defense) {
        // 测试服占位 Boss（未收录预设）无 presetId，跳过
        if (!d.presetId) continue
        const preset = presets.bosses.find(p => p.id === d.presetId)
        const phase = preset!.phases.find(p => p.phaseId === v.phaseId && p.zoneKey === d.zoneKey)
        expect(phase!.modeType).toBe('defense')
      }
    }
  })

  it('期视图覆盖全部 50 期（1.4–3.3 全为正式排期）；困难模式仅 3.1 起', () => {
    expect(presets.phaseViews.length).toBe(50)
    const versions = [...new Set(presets.phaseViews.map(v => v.version))]
    expect(versions).toContain('1.4')
    expect(versions).toContain('3.2')
    expect(versions).toContain('3.3')
    const caVersions = [...new Set(presets.phaseViews.filter(v => v.criticalAssault).map(v => v.version))]
    expect(caVersions.sort()).toEqual(['3.1', '3.2', '3.3'])
    // 3.3 三期已于 2026-10-23 / 11-06 / 11-20 正式上线（nanoka 正式服 live_begin）⇒ 无占位期。
    // 抓预发布构建又带出占位期时本断言变红，逼回来确认「是占位还是真排期」。
    expect(presets.phaseViews.filter(isTrial).map(v => v.phaseId)).toEqual([])
    // 每期都必须有 begin（无 begin = 时间轴排不上、归档期相位匹配不上）
    for (const v of presets.phaseViews) expect(v.begin, `${v.phaseId} 缺 begin`).toMatch(/^\d{4}-\d{2}-\d{2}/)
  })

  it('3.3 新期弱点 = 当期标签（不跨期求交集）：40003 逐期换弱点、690481 困难 = 40014 而非 40008', () => {
    const phaseOf = (bossId: string, phaseId: string) =>
      presets.bosses.find(b => b.id === bossId)?.phases.find(p => p.phaseId === phaseId)
    // 690431/690441 复写体弱冰；690491 换成火/风（3.3 新角色 1641 火 / 1631 风）——交集口径会把这三期全抹成空
    expect(phaseOf('40003', '690431')?.weakness).toEqual(['冰'])
    expect(phaseOf('40003', '690441')?.weakness).toEqual(['冰'])
    expect(phaseOf('40003', '690491')?.weakness).toEqual(['火', '风'])
    // 690481 困难 Boss 是三期新怪 40014「异构·滞变畸兽」（不是 40008 基塔布鲁·滞变畸兽）
    const view481 = presets.phaseViews.find(v => v.phaseId === '690481')!
    expect(view481.criticalAssault?.presetId).toBe('40014')
    expect(presets.bosses.find(b => b.id === '40014')?.monster).toMatchObject({ stunVuln: 1.25 })
  })
})

describe('boss 敌方体型（BOSS_BODY_SIZES 手录 2026-09-05，TeamCompare 选中时写入敌方配置）', () => {
  const LEGAL = ['small', 'medium', 'large'] as const

  it('全部 24 个预设都有合法 bodySize（新增 boss 未录体型即红，逼显式认领）', () => {
    for (const b of presets.bosses) {
      expect(LEGAL, `${b.id} ${b.name} bodySize 合法`).toContain(b.bodySize)
    }
    expect(presets.bosses.length).toBe(24)
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
    expect(sizeOf('40014')).toBe('large') // 异构·滞变畸兽（3.3 新增，40008 的异构版）
    expect(sizeOf('40012')).toBe('medium') // 以太异体·特里薇亚（3.3 新增，nanoka tag Middle，待用户核对）
  })
})
