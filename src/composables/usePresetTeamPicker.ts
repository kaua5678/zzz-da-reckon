import { computed, ref, watch } from 'vue'
import { teamPresets, presetGroupLabels, presetSubgroupLabelsFor, presetsForFilter, firstNonEmptyFilter } from '@/data/teamPresets'
import { useCatalogStore } from '@/stores/catalog'

/** 一级下拉选项：职业分组（模块级常量，所有级联共用同一数组） */
export const presetGroupOptions = presetGroupLabels.map(l => ({ label: l, value: l }))

/**
 * 预设队伍两级级联筛选（职业 → 属性 → 队伍下拉选项）。CC-482（r668）。
 *
 * 此前 PositionComparePage / TeamComparePage / TeamConfigPage（×2：顶部选预设 + 金数弹窗保存目标）
 * 各抄一份逐字相同的 5 条声明。这里只收「级联」本身；换筛选后清什么、选中后做什么由调用方的 watch 决定
 * （三处语义不同：清多选 / 清单选触发值 / 清保存目标），所以不往里收。
 * @param init 初始筛选；缺省取第一个非空（用户 2026-09-03：打开即有队伍可选——此前全空像「没下拉框」）
 */
export function usePresetFilter(init: { group: string | null; subgroup: string | null } = firstNonEmptyFilter()) {
  const groupSel = ref<string | null>(init.group)
  const subSel = ref<string | null>(init.subgroup)
  const subOptions = computed(() =>
    (groupSel.value ? presetSubgroupLabelsFor(groupSel.value) : []).map(l => ({ label: l, value: l })),
  )
  const teamOptions = computed(() =>
    groupSel.value && subSel.value
      ? presetsForFilter(groupSel.value, subSel.value).map(t => ({ value: t.id, label: t.name }))
      : [],
  )
  return { groupSel, subSel, groupOptions: presetGroupOptions, subOptions, teamOptions }
}

/**
 * 两个比较页（PositionComparePage / TeamComparePage）的预设队伍选择器状态：
 * usePresetFilter + 队伍多选（换筛选即清空）+ 「按主C快选」。CC-482（r668）。
 * 此前两页各抄一份（jscpd 32 行 / 330 token，r666 普查全仓最大的 TS 跨文件克隆）。
 * 返回值全是页面原来的同名绑定，`<script setup>` 里解构即可，模板不用改。
 */
export function usePresetTeamPicker() {
  const catalogStore = useCatalogStore()
  const selectedPresetIds = ref<string[]>([])
  const f = usePresetFilter()
  watch([f.groupSel, f.subSel], () => {
    // 换筛选即清空已选（避免选中的队伍不在当前筛选内）
    if (f.groupSel.value && f.subSel.value) selectedPresetIds.value = []
  })
  /** 按主C快选：选一个主C → 勾选替换为「仅含该主C的队伍」（其他主C的队伍移除）；清空不影响已选 */
  const quickPickMainC = ref<string | null>(null)
  const mainCQuickOptions = computed(() => {
    const seen = new Map<string, string>()
    for (const t of teamPresets) {
      const main = t.team[0]
      if (!seen.has(main)) seen.set(main, catalogStore.agentName(main))
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }))
  })
  watch(quickPickMainC, main => {
    if (!main) return
    selectedPresetIds.value = teamPresets.filter(t => t.team[0] === main).map(t => t.id)
  })
  return {
    selectedPresetIds,
    presetGroupSel: f.groupSel,
    presetSubSel: f.subSel,
    presetGroupOptionsC: f.groupOptions,
    presetSubOptions: f.subOptions,
    presetFilteredOptions: f.teamOptions,
    quickPickMainC,
    mainCQuickOptions,
  }
}
