/**
 * CC-482（r668）：预设队伍选择器状态簇的唯一实现在 composables/usePresetTeamPicker.ts。
 * 1) 行为：默认选中第一个非空筛选；换筛选**保留**已选（2026-10-11 起，见下）；选主C → 已选替换为
 *    「仅含该主C的队伍」；
 * 2) 源码锁：两个比较页都走 composable，views 下不再直接调用筛选函数（防止再抄一份回去）。
 *
 * 2026-10-11 口径变更（用户：「点了职业和属性后就不能加其他队伍了…这不够自由」）：
 * 旧行为「换筛选即清空已选」使跨分类勾选**不可能**（换组就清空），已删除；两级各自 `null` = 不筛。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { usePresetFilter, usePresetTeamPicker, PRESET_FILTER_ANY } from '@/composables/usePresetTeamPicker'
import { useCustomTeamsStore } from '@/composables/customTeams'
import { firstNonEmptyFilter, presetGroupLabels, presetSubgroupLabelsFor, presetsForFilter, teamPresets } from '@/data/teamPresets'

describe('usePresetTeamPicker（CC-482）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('默认选中第一个非空筛选，且筛选结果非空', () => {
    const p = usePresetTeamPicker()
    const first = firstNonEmptyFilter()
    expect(p.presetGroupSel.value).toBe(first.group)
    expect(p.presetSubSel.value).toBe(first.subgroup)
    expect(p.presetGroupOptionsC.map(o => o.value)).toEqual([PRESET_FILTER_ANY, ...presetGroupLabels])
    expect(p.presetSubOptions.value.map(o => o.value)).toEqual([PRESET_FILTER_ANY, ...presetSubgroupLabelsFor(first.group)])
    expect(p.presetFilteredOptions.value.length).toBeGreaterThan(0)
    expect(p.selectedPresetIds.value).toEqual([])
  })

  it('换筛选保留已选（跨分类自由勾选）', async () => {
    const p = usePresetTeamPicker()
    const picked = p.presetFilteredOptions.value[0]!.value
    p.selectedPresetIds.value = [picked]
    const other = presetGroupLabels.find(l => l !== p.presetGroupSel.value)
    if (other) p.presetGroupSel.value = other
    else p.presetSubSel.value = presetSubgroupLabelsFor(p.presetGroupSel.value!).find(l => l !== p.presetSubSel.value) ?? '其他'
    await nextTick()
    expect(p.selectedPresetIds.value).toEqual([picked])
  })

  it('「不限」两级：选 null 后选项含全部职业/全部属性，且能勾到别的分类的队伍', async () => {
    const p = usePresetTeamPicker()
    // 一级「不限」→ 二级列出全部属性；此时二级仍筛着原属性 ⇒ 结果 = 全职业里该属性的队伍
    p.presetGroupSel.value = null
    await nextTick()
    expect(p.presetSubOptions.value.map(o => o.value)).toEqual([PRESET_FILTER_ANY, ...presetSubgroupLabelsFor(null)])
    expect(p.presetFilteredOptions.value.length).toBe(teamPresets.filter(t => t.subgroup === p.presetSubSel.value).length)
    // 二级也「不限」→ 全库可选，跨分类勾选不被过滤掉
    p.presetSubSel.value = null
    await nextTick()
    expect(p.presetFilteredOptions.value.length).toBe(teamPresets.length)
    const a = p.presetFilteredOptions.value[0]!.value
    const b = p.presetFilteredOptions.value.at(-1)!.value
    expect(a).not.toBe(b)
    p.selectedPresetIds.value = [a, b]
    await nextTick()
    expect(p.selectedPresetIds.value).toEqual([a, b])
  })

  it('presetLabelOf：已选但不在当前筛选内的项仍给中文名（否则 naive-ui 标签渲染裸 id）', async () => {
    const p = usePresetTeamPicker()
    const picked = p.presetFilteredOptions.value[0]!.value
    const wantName = teamPresets.find(t => t.id === picked)!.name
    // 与 naive-ui 的调用形状一致（fallbackOption 收 value、返回 option 片段）
    expect(p.presetLabelOf(picked).label).toBe(wantName)
    // 换到不含该队的筛选后仍解析得出：naive-ui 对「不在 options 里」的已选值走 fallbackOption，
    // 缺省 fallback 是 String(value) ⇒ 实机实测标签显示成 yixuan-trigger-lucia 这种裸 id
    p.presetGroupSel.value = presetGroupLabels.find(l => l !== p.presetGroupSel.value) ?? null
    await nextTick()
    expect(p.presetFilteredOptions.value.some(o => o.value === picked)).toBe(false)
    expect(p.presetLabelOf(picked).label).toBe(wantName)
    // 未知 id 回落原值（不静默吞掉）
    expect(p.presetLabelOf('nope').label).toBe('nope')
  })

  it('自定义队并入选择池（选项 + 标签名）', async () => {
    const p = usePresetTeamPicker()
    const c = useCustomTeamsStore()
    const def = c.add()
    await nextTick()
    const opt = p.presetFilteredOptions.value.find(o => o.value === def.id)
    // 并进 options 是关键：naive-ui 只给 options 里找得到的值渲染标签，只选不列 ⇒ 框里不可见
    expect(opt, '自定义队必须在 presetFilteredOptions 里').toBeTruthy()
    expect(opt!.label).toContain('自定义')
    expect(p.presetLabelOf(def.id).label).toContain('自定义')
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
    // 一级「不限」⇒ 二级列出全部属性（此前 null 时 subOptions 为空，用户没法从「不限」再往下选）
    expect(f.subOptions.value.map(o => o.value)).toEqual([PRESET_FILTER_ANY, ...presetSubgroupLabelsFor(null)])
    expect(f.teamOptions.value.length).toBe(teamPresets.length)
    f.groupSel.value = presetGroupLabels[0]!
    expect(f.subOptions.value.map(o => o.value)).toEqual([PRESET_FILTER_ANY, ...presetSubgroupLabelsFor(presetGroupLabels[0]!)])
    const first = firstNonEmptyFilter()
    f.groupSel.value = first.group
    f.subSel.value = first.subgroup
    expect(f.teamOptions.value.length).toBeGreaterThan(0)
    expect(f.groupOptions).toBe(usePresetFilter().groupOptions)
  })

  it('presetsForFilter：null = 该级不筛（data 层单一事实源）', () => {
    const first = firstNonEmptyFilter()
    expect(presetsForFilter(null, null).length).toBe(teamPresets.length)
    expect(presetsForFilter(first.group, null).length).toBe(
      teamPresets.filter(p => (p.group?.trim() || '未分组') === first.group).length,
    )
    expect(presetsForFilter(null, first.subgroup).length).toBe(
      teamPresets.filter(p => (p.subgroup?.trim() || '未分属性') === first.subgroup).length,
    )
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
      expect(s).toMatch(/\{ selectedPresetIds, presetGroupSel, presetSubSel, presetGroupOptionsC, presetSubOptions, presetFilteredOptions, presetLabelOf, quickPickMainC, mainCQuickOptions \} = usePresetTeamPicker\(\)/)
    }
    const cfg = readFileSync(join(viewsDir, 'TeamConfigPage.vue'), 'utf8')
    expect(cfg.match(/= usePresetFilter\(/g)?.length).toBe(2)
  })
})
