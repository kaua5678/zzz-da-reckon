/**
 * CC-482（r668）：预设队伍选择器状态簇的唯一实现在 composables/usePresetTeamPicker.ts。
 * 1) 行为：默认选中第一个非空筛选；换筛选清空已选；选主C → 已选替换为「仅含该主C的队伍」；
 * 2) 源码锁：两个比较页都走 composable，views 下不再直接调用筛选函数（防止再抄一份回去）。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { usePresetFilter, usePresetTeamPicker } from '@/composables/usePresetTeamPicker'
import { firstNonEmptyFilter, presetGroupLabels, presetSubgroupLabelsFor, teamPresets } from '@/data/teamPresets'

describe('usePresetTeamPicker（CC-482）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('默认选中第一个非空筛选，且筛选结果非空', () => {
    const p = usePresetTeamPicker()
    const first = firstNonEmptyFilter()
    expect(p.presetGroupSel.value).toBe(first.group)
    expect(p.presetSubSel.value).toBe(first.subgroup)
    expect(p.presetGroupOptionsC.map(o => o.value)).toEqual(presetGroupLabels)
    expect(p.presetSubOptions.value.map(o => o.value)).toEqual(presetSubgroupLabelsFor(first.group))
    expect(p.presetFilteredOptions.value.length).toBeGreaterThan(0)
    expect(p.selectedPresetIds.value).toEqual([])
  })

  it('换筛选即清空已选', async () => {
    const p = usePresetTeamPicker()
    p.selectedPresetIds.value = [p.presetFilteredOptions.value[0]!.value]
    const other = presetGroupLabels.find(l => l !== p.presetGroupSel.value)
    if (other) p.presetGroupSel.value = other
    else p.presetSubSel.value = presetSubgroupLabelsFor(p.presetGroupSel.value!).find(l => l !== p.presetSubSel.value) ?? '其他'
    await nextTick()
    expect(p.selectedPresetIds.value).toEqual([])
  })

  it('按主C快选：已选替换为仅含该主C的队伍；清空不影响已选', async () => {
    const p = usePresetTeamPicker()
    const main = teamPresets[0]!.team[0]!
    expect(p.mainCQuickOptions.value.map(o => o.value)).toContain(main)
    expect(new Set(p.mainCQuickOptions.value.map(o => o.value)).size).toBe(p.mainCQuickOptions.value.length)
    p.quickPickMainC.value = main
    await nextTick()
    const want = teamPresets.filter(t => t.team[0] === main).map(t => t.id)
    expect(p.selectedPresetIds.value).toEqual(want)
    p.quickPickMainC.value = null
    await nextTick()
    expect(p.selectedPresetIds.value).toEqual(want)
  })

  it('usePresetFilter：可指定初始筛选；两级级联独立于多选', () => {
    const f = usePresetFilter({ group: null, subgroup: null })
    expect(f.groupSel.value).toBeNull()
    expect(f.subOptions.value).toEqual([])
    expect(f.teamOptions.value).toEqual([])
    f.groupSel.value = presetGroupLabels[0]!
    expect(f.subOptions.value.map(o => o.value)).toEqual(presetSubgroupLabelsFor(presetGroupLabels[0]!))
    const first = firstNonEmptyFilter()
    f.groupSel.value = first.group
    f.subSel.value = first.subgroup
    expect(f.teamOptions.value.length).toBeGreaterThan(0)
    expect(f.groupOptions).toBe(usePresetFilter().groupOptions)
  })

  it('源码锁：筛选函数只在 composable 里调用；两个比较页解构 usePresetTeamPicker，TeamConfigPage 两处走 usePresetFilter', () => {
    const viewsDir = join(process.cwd(), 'src/views')
    const vueFiles = readdirSync(viewsDir).filter(f => f.endsWith('.vue'))
    const offenders: string[] = []
    for (const f of vueFiles) {
      const s = readFileSync(join(viewsDir, f), 'utf8')
      if (/\b(firstNonEmptyFilter|presetsForFilter|presetSubgroupLabelsFor)\(/.test(s)) offenders.push(f)
    }
    expect(offenders).toEqual([])
    for (const f of ['PositionComparePage.vue', 'TeamComparePage.vue']) {
      const s = readFileSync(join(viewsDir, f), 'utf8')
      expect(s).toMatch(/\{ selectedPresetIds, presetGroupSel, presetSubSel, presetGroupOptionsC, presetSubOptions, presetFilteredOptions, quickPickMainC, mainCQuickOptions \} = usePresetTeamPicker\(\)/)
    }
    const cfg = readFileSync(join(viewsDir, 'TeamConfigPage.vue'), 'utf8')
    expect(cfg.match(/= usePresetFilter\(/g)?.length).toBe(2)
  })
})
