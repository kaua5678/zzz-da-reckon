import { computed, ref, watch } from 'vue'
import { teamPresets, presetGroupLabels, presetSubgroupLabelsFor, presetsForFilter, firstNonEmptyFilter } from '@/data/teamPresets'
import { useCatalogStore } from '@/stores/catalog'
import { useCustomTeamsStore } from '@/composables/customTeams'

/**
 * 「不限」选项值。
 *
 * 用**空串**而不是 `null`：naive-ui 的 `SelectMixedOption.value` 只接受 `string | number`
 * （写 `null` 直接 TS2322：`Property 'type' is missing in type ... SelectIgnoredOption`），
 * 所以 UI 层的哨兵只能是字符串。选空串而非「全部」这类中文哨兵：分类名不会为空串
 * （缺省一律落 `未分组`/`未分属性`），故与真实分类名**不可能撞车**；
 * 进 data 层前经 `toFilterValue` 归一成 `null`（data 层用 `null` 表达「该级不筛」）。
 */
export const PRESET_FILTER_ANY = ''

/** UI 哨兵 → data 层口径：空串/null 都是「不筛」 */
function toFilterValue(v: string | null): string | null {
  return v ? v : null
}

/** 一级下拉选项：职业分组 + 置顶「不限」（模块级常量，所有级联共用同一数组） */
export const presetGroupOptions: Array<{ label: string; value: string }> = [
  { label: '全部职业', value: PRESET_FILTER_ANY },
  ...presetGroupLabels.map(l => ({ label: l, value: l })),
]

/**
 * 预设队伍两级级联筛选（职业 → 属性 → 队伍下拉选项）。CC-482（r668）。
 *
 * 此前 PositionComparePage / TeamComparePage / TeamConfigPage（×2：顶部选预设 + 金数弹窗保存目标）
 * 各抄一份逐字相同的 5 条声明。这里只收「级联」本身；选中后做什么由调用方的 watch 决定
 * （三处语义不同：清单选触发值 / 清保存目标），所以不往里收。
 *
 * 2026-10-11（用户：「点了职业和属性后就不能加其他队伍了…这不够自由」）：
 * ① 两级各加「不限」——旧版没有「全部」档，要跨分类选队必须来回换筛选；
 * ② 「不限」时**二级列出全部属性**（`presetSubgroupLabelsFor(null)`），旧版 `groupSel` 为空则二级为空。
 * @param init 初始筛选；缺省取第一个非空（用户 2026-09-03：打开即有队伍可选——此前全空像「没下拉框」）
 */
export function usePresetFilter(init: { group: string | null; subgroup: string | null } = firstNonEmptyFilter()) {
  const groupSel = ref<string | null>(init.group)
  const subSel = ref<string | null>(init.subgroup)
  const subOptions = computed(() => [
    { label: '全部属性', value: PRESET_FILTER_ANY },
    ...presetSubgroupLabelsFor(toFilterValue(groupSel.value)).map(l => ({ label: l, value: l })),
  ])
  const teamOptions = computed(() =>
    /* 两级各自「不限」= 该级不筛（跨分类自由勾选），故不再要求两级都选中 */
    presetsForFilter(toFilterValue(groupSel.value), toFilterValue(subSel.value)).map(t => ({ value: t.id, label: t.name })),
  )
  return { groupSel, subSel, groupOptions: presetGroupOptions, subOptions, teamOptions }
}

/**
 * 两个比较页（PositionComparePage / TeamComparePage）的预设队伍选择器状态：
 * usePresetFilter + 队伍多选 + 「按主C快选」+ 自定义队并入选择池。CC-482（r668）。
 * 此前两页各抄一份（jscpd 32 行 / 330 token，r666 普查全仓最大的 TS 跨文件克隆）。
 * 返回值全是页面原来的同名绑定，`<script setup>` 里解构即可，模板不用改。
 *
 * 2026-10-11：自定义队并入 `presetFilteredOptions`（用户要的「自由加队伍」）。**必须并进 options**，
 * 不只是并进已选值——naive-ui 的多选标签只渲染 `options` 里找得到的值（`Select.mjs#getMergedOptions`
 * 命中 `valOptMap` 才给 option，没有 `fallback-option` 就整条跳过）⇒ 只选不列会让自定义队在框里
 * **不可见**（选了却看不到，比报错更难查）。自定义队**不受**职业/属性筛选影响（它们没有分类）。
 */
export function usePresetTeamPicker() {
  const catalogStore = useCatalogStore()
  const custom = useCustomTeamsStore()
  const selectedPresetIds = ref<string[]>([])
  const f = usePresetFilter()
  /*
   * 2026-10-11 删除「换筛选即清空已选」：它使跨分类勾选不可能（换组就清空，用户要的是
   * 「点了职业和属性后还能加其他队伍」）。保留已选后，选中的队伍可以不在当前筛选内——
   * 多选框的已选项标签仍照常显示（naive-ui 按 value 渲染 tag），这是有意的：
   * 筛选只决定**下拉里列出什么**，不决定**已经选了什么**。
   */
  /** 自定义队选项（恒在列表里，带「自定义」后缀与预设队区分） */
  const customOptions = computed(() =>
    custom.defs.map(d => ({ value: d.id, label: `${custom.displayName(d)}（自定义）` })),
  )
  const presetFilteredOptions = computed(() => [...f.teamOptions.value, ...customOptions.value])
  /**
   * id → 展示名（**全库**：预设 + 自定义，不受当前筛选影响）。
   *
   * 为什么必须有：naive-ui 的多选标签对「值不在 `options` 里」的项走 `fallbackOption`
   * （`Select.mjs`：`valOptMap` 未命中 → `wrappedFallbackOption`），而**缺省 fallback 是
   * `String(value)`** ⇒ 标签渲染成裸 id。保留已选（跨分类勾选）后「已选但不在当前筛选内」是常态，
   * 不传这个就会在框里看到 `yixuan-trigger-lucia` 这种 id（实测）。
   *
   * 返回 `Object.assign` 的入参形状（naive 会补 `value`）；找不到的 id 回落原值，不静默吞掉。
   */
  const labelById = computed(() => {
    const map = new Map<string, string>()
    for (const t of teamPresets) map.set(t.id, t.name)
    for (const d of custom.defs) map.set(d.id, `${custom.displayName(d)}（自定义）`)
    return map
  })
  function presetLabelOf(id: string): { label: string } {
    return { label: labelById.value.get(id) ?? id }
  }
  /** 按主C快选：选一个主C → 勾选替换为「仅含该主C的队伍」（其他主C的队伍移除）；清空不影响已选 */
  const quickPickMainC = ref<string | null>(null)
  const mainCQuickOptions = computed(() => {
    const seen = new Map<string, string>()
    // 自定义队一并参与（主C 口径 = 槽位 0，与预设库一致）：槽位 0 空着的自定义队不进快选
    for (const t of [...teamPresets, ...custom.presets]) {
      const main = t.team[0]
      if (!main || seen.has(main)) continue
      seen.set(main, catalogStore.agentName(main))
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }))
  })
  watch(quickPickMainC, main => {
    if (!main) return
    selectedPresetIds.value = [...teamPresets, ...custom.presets].filter(t => t.team[0] === main).map(t => t.id)
  })
  /**
   * 默认选中 = **当前筛选分类下的队伍 id**（用户 2026-10-12：「默认不要选择 97 个队伍」
   * +「默认选中 97+ 队伍也没算出图啊，跟没选是一样的」）。
   *
   * 旧行为是调用方自己 `teamPresets.map(t => t.id)` 全选 97 条，有两个问题：
   * ① 与筛选器显示的分类完全脱节（用户看到「命破队·以太」，选中的却是全库）；
   * ② 因为不自动计算，全选并不产出任何图，纯粹是噪音。
   * 取当前筛选 ⇒ **所见即所选**，且与 `firstNonEmptyFilter()`（用户 2026-09-03
   * 「打开即有队伍可选」）同一意图。
   *
   * ⚠ 只作**初值**用，不要在筛选变化时调用——2026-10-11 用户裁决「筛选只决定下拉列出什么，
   * 不清空已选」（跨分类自由勾选），跟着筛选重置会破坏那条口径。
   * ⚠ 筛选函数（`presetsForFilter`）**只在 composable 里调用**：页面直接用会被源码锁判红
   * （规则 11 单一事实源，见 usePresetTeamPicker.test.ts 的「源码锁」用例）。
   */
  function defaultSelection(): string[] {
    return f.teamOptions.value.map(o => o.value)
  }
  return {
    selectedPresetIds,
    defaultSelection,
    presetGroupSel: f.groupSel,
    presetSubSel: f.subSel,
    presetGroupOptionsC: f.groupOptions,
    presetSubOptions: f.subOptions,
    presetFilteredOptions,
    presetLabelOf,
    quickPickMainC,
    mainCQuickOptions,
  }
}
