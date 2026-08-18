import { describe, expect, it } from 'vitest'
import { matchStunAxisPresets, cloneStunAxes, presetTeamKey, normalizeAxesForExport, resolveStunAxisPlan, selectAutoStunAxisPreset, stunAxisPresets } from '@/data/stunAxisPresets'
import type { StunAxisPreset } from '@/data/stunAxisPresets'

const sample: StunAxisPreset[] = [
  {
    id: 'abc',
    name: 'ABC 标准轴',
    team: ['1251', '1391', '1241'],
    axes: [{ name: '轴1', count: 2, actions: [{ slot: 0, moveId: '1251008', count: 1, startTime: 0 }] }],
  },
]

describe('stunAxisPresets', () => {
  it('matches by slot-ordered team only', () => {
    expect(matchStunAxisPresets(['1251', '1391', '1241'], sample)).toHaveLength(1)
    // 换位不命中（轴内 action.slot 绑定槽位）
    expect(matchStunAxisPresets(['1241', '1391', '1251'], sample)).toHaveLength(0)
    // 缺员不命中
    expect(matchStunAxisPresets(['1251', '1391', ''], sample)).toHaveLength(0)
    expect(matchStunAxisPresets(['1251', '1391'], sample)).toHaveLength(0)
  })

  it('supports wildcard slot (伊琉体系第三槽任意辅助)', () => {
    const wild: StunAxisPreset[] = [{ id: 'yiliu', name: '伊琉', team: ['1051', '1481', '*'], axes: [] }]
    expect(matchStunAxisPresets(['1051', '1481', '1451'], wild)).toHaveLength(1)
    expect(matchStunAxisPresets(['1051', '1481', '1421'], wild)).toHaveLength(1)
    expect(matchStunAxisPresets(['1051', 'other', '1451'], wild)).toHaveLength(0)
  })

  it('presetTeamKey returns null for incomplete teams', () => {
    expect(presetTeamKey(['1251', '1391', '1241'])).toBe('1251|1391|1241')
    expect(presetTeamKey(['1251', '', '1241'])).toBeNull()
    expect(presetTeamKey(['1251', '1391'])).toBeNull()
  })

  it('cloneStunAxes deep-clones so editing does not mutate the preset', () => {
    const src = sample[0].axes!
    const cloned = cloneStunAxes(src)
    cloned[0].actions[0].count = 99
    expect(src[0].actions[0].count).toBe(1)
    expect(cloned[0].actions[0].count).toBe(99)
  })

  it('resolveStunAxisPlan picks first matching condition (按失衡次数+好评自选轴)', () => {
    const plans = [
      { name: '双转大轴', when: { stunMin: 4, goodReviewMin: 540 }, axes: [{ name: '双转大', actions: [] }] },
      { name: '普通轴', axes: [{ name: '普通', actions: [] }] },
    ]
    // 好评 >= 540 且失衡 >= 4 → 命中第一条
    expect(resolveStunAxisPlan(plans, { stunCount: 4, goodReview: 600 })?.plan.name).toBe('双转大轴')
    // 好评不足 → 未命中条件，兜底最后一条（普通轴）
    expect(resolveStunAxisPlan(plans, { stunCount: 4, goodReview: 500 })?.plan.name).toBe('普通轴')
    // 失衡不足 → 普通轴
    expect(resolveStunAxisPlan(plans, { stunCount: 3, goodReview: 600 })?.plan.name).toBe('普通轴')
    // 返回的 axes 是深拷贝，改副本不影响方案本体
    const resolved = resolveStunAxisPlan(plans, { stunCount: 4, goodReview: 600 })!
    resolved.axes[0].name = '改'
    expect(plans[0].axes[0].name).toBe('双转大')
  })

  it('resolveStunAxisPlan supports energy threshold (能量足够→3E / 不足→2E)', () => {
    const plans = [
      { name: '单连携+3E', when: { energyMin: 450, energySlot: 0 }, axes: [{ name: '3E', actions: [] }] },
      { name: '双连携+2E', axes: [{ name: '2E', actions: [] }] },
    ]
    // 主C闪能 600 >= 450 → 3E
    expect(resolveStunAxisPlan(plans, { stunCount: 4, goodReview: -1, energyBySlot: { 0: 600 } })?.plan.name).toBe('单连携+3E')
    // 主C闪能 300 < 450 → 兜底 2E
    expect(resolveStunAxisPlan(plans, { stunCount: 4, goodReview: -1, energyBySlot: { 0: 300 } })?.plan.name).toBe('双连携+2E')
    // energySlot 指定槽位：槽0 不足但槽1 够（slot 检查 1）
    const slot1 = [
      { name: 'slot1够', when: { energyMin: 100, energySlot: 1 }, axes: [] },
      { name: '兜底', axes: [] },
    ]
    expect(resolveStunAxisPlan(slot1, { stunCount: 1, goodReview: -1, energyBySlot: { 0: 0, 1: 150 } })?.plan.name).toBe('slot1够')
  })

  it('resolveStunAxisPlan supports cinema gate (1命才能解锁3E轴)', () => {
    const plans = [
      { name: '1命3E', when: { cinemaMin: 1, cinemaSlot: 0 }, axes: [{ name: '3E', actions: [] }] },
      { name: '0命兜底', axes: [{ name: '2E', actions: [] }] },
    ]
    expect(resolveStunAxisPlan(plans, { stunCount: 4, goodReview: -1, cinemaBySlot: { 0: 1 } })?.plan.name).toBe('1命3E')
    expect(resolveStunAxisPlan(plans, { stunCount: 4, goodReview: -1, cinemaBySlot: { 0: 0 } })?.plan.name).toBe('0命兜底')
  })

  it('resolveStunAxisPlan split(energyOverflow) allocates windows 鸡兔同笼 (先全给2再升3)', () => {
    const split = {
      algorithm: 'energyOverflow' as const,
      energySlot: 0,
      baseCost: 100,
      upgradeCost: 135,
      baseAxis: { name: '双连携+2E', actions: [] },
      upgradeAxis: { name: '单连携+3E', actions: [] },
    }
    const plans = [{ name: '分配', split }]
    // 闪能 600, 4窗：extra=200 → 4窗全升级(3E)
    let r = resolveStunAxisPlan(plans, { stunCount: 4, goodReview: -1, energyBySlot: { 0: 600 } })!
    expect(r.axes.map(a => `${a.name}×${a.count}`)).toEqual(['单连携+3E×4'])
    // 闪能 450, 4窗：extra=50 → 1窗3E + 3窗2E
    r = resolveStunAxisPlan(plans, { stunCount: 4, goodReview: -1, energyBySlot: { 0: 450 } })!
    expect(r.axes.map(a => `${a.name}×${a.count}`)).toEqual(['单连携+3E×1', '双连携+2E×3'])
    // 闪能 350, 4窗：extra<0 → 全2E（资源不足仅提示）
    r = resolveStunAxisPlan(plans, { stunCount: 4, goodReview: -1, energyBySlot: { 0: 350 } })!
    expect(r.axes.map(a => `${a.name}×${a.count}`)).toEqual(['双连携+2E×4'])
  })

  it('resolveStunAxisPlan split(goodReviewOverflow) allocates windows 好评溢出才打爆发轴', () => {
    const split = {
      algorithm: 'goodReviewOverflow' as const,
      baseAxis: { name: '常规', actions: [{ slot: 0, moveId: '1471021', count: 1, promoteVariant: '60' as const }] },
      upgradeAxis: { name: '爆发', actions: [
        { slot: 0, moveId: '1471021', count: 1, promoteVariant: '60' as const },
        { slot: 0, moveId: '1471021', count: 1, promoteVariant: '90' as const },
      ] },
    }
    const plans = [{ name: '分配', split }]
    // 好评 240 = 4窗×60：不溢出 → 全常规
    let r = resolveStunAxisPlan(plans, { stunCount: 4, goodReview: 240 })!
    expect(r.axes.map(a => `${a.name}×${a.count}`)).toEqual(['常规×4'])
    // 好评 330：extra=90 → 1窗爆发 + 3窗常规
    r = resolveStunAxisPlan(plans, { stunCount: 4, goodReview: 330 })!
    expect(r.axes.map(a => `${a.name}×${a.count}`)).toEqual(['爆发×1', '常规×3'])
    // 好评 600：extra=360 → 4窗全爆发
    r = resolveStunAxisPlan(plans, { stunCount: 4, goodReview: 600 })!
    expect(r.axes.map(a => `${a.name}×${a.count}`)).toEqual(['爆发×4'])
    // 好评 100：不足 → 全常规（资源不足仅提示）
    r = resolveStunAxisPlan(plans, { stunCount: 4, goodReview: 100 })!
    expect(r.axes.map(a => `${a.name}×${a.count}`)).toEqual(['常规×4'])
  })

  it('normalizeAxesForExport strips label and default startTime, preserves count/basicFillerSlot', () => {
    const normalized = normalizeAxesForExport([{
      name: '轴1',
      count: 2,
      basicFillerSlot: 0,
      actions: [
        { slot: 0, moveId: '1251008', count: 1, label: '醉花月云转', startTime: 0 },
        { slot: 1, moveId: '1391010', count: 2, label: 'xx', startTime: 3 },
      ],
    }])
    expect(normalized[0].count).toBe(2)
    expect(normalized[0].basicFillerSlot).toBe(0)
    expect(normalized[0].actions[0]).toEqual({ slot: 0, moveId: '1251008', count: 1 })
    expect(normalized[0].actions[1]).toEqual({ slot: 1, moveId: '1391010', count: 2, startTime: 3 })
  })

  describe('selectAutoStunAxisPreset（通用自动轴：章鱼按 章×有琉，其余按匹配）', () => {
    const byId = (id: string) => stunAxisPresets.find(p => p.id === id)
    // 4 个章鱼预设必须带 chapter 且已加载
    it('4 个章鱼预设已加载并带 chapter', () => {
      expect(byId('yidhari-liuyin-0life')?.chapter).toBe(0)
      expect(byId('0伊-任意')?.chapter).toBe(0)
      expect(byId('1章+琉')?.chapter).toBe(1)
      expect(byId('1伊-其他')?.chapter).toBe(1)
    })

    it('0章（0命）+ 有琉（1481 槽位1）→ 0章-琉', () => {
      const p = selectAutoStunAxisPreset(['1051', '1481', '1451'], { 0: 0 })
      expect(p?.id).toBe('yidhari-liuyin-0life')
    })

    it('0章 + 无琉 → 0章其他（常规循环轴）', () => {
      const p = selectAutoStunAxisPreset(['1051', '1391', '1451'], { 0: 0 })
      expect(p?.id).toBe('0伊-任意')
    })

    it('1章（≥1命）+ 有琉 → 1章-琉（第三槽任意辅助均命中，通配）', () => {
      expect(selectAutoStunAxisPreset(['1051', '1481', '1451'], { 0: 1 })?.id).toBe('1章+琉')
      expect(selectAutoStunAxisPreset(['1051', '1481', '1421'], { 0: 1 })?.id).toBe('1章+琉')
    })

    it('1章 + 无琉 → 1章其他（1命按闪能分配）', () => {
      const p = selectAutoStunAxisPreset(['1051', '1391', '1451'], { 0: 1 })
      expect(p?.id).toBe('1伊-其他')
    })

    it('同一队伍随伊德海莉命座切换章：0命 0章-琉 → 1命 1章-琉', () => {
      const team = ['1051', '1481', '1451']
      expect(selectAutoStunAxisPreset(team, { 0: 0 })?.id).toBe('yidhari-liuyin-0life')
      expect(selectAutoStunAxisPreset(team, { 0: 1 })?.id).toBe('1章+琉')
      expect(selectAutoStunAxisPreset(team, { 0: 6 })?.id).toBe('1章+琉')
    })

    it('无伊德海莉 / 伊德海莉不在槽位0 / 队伍不满 → null', () => {
      expect(selectAutoStunAxisPreset(['1391', '1481', '1451'], { 0: 0 })).toBeNull()
      expect(selectAutoStunAxisPreset(['1481', '1051', '1451'], { 1: 0 })).toBeNull()
      expect(selectAutoStunAxisPreset(['1051', '1481'], { 0: 0 })).toBeNull()
      expect(selectAutoStunAxisPreset(['1051', '', '1451'], { 0: 0 })).toBeNull()
    })
  })
})
