import { computed, ref, type Ref } from 'vue'
import { computeSlotSweepPoints, type SlotCompareSlot, type SlotSweepResult } from '@/composables/teamTimeline'
import type { useCatalogStore } from '@/stores/catalog'
import type { useResourceCalc } from '@/composables/useResourceCalc'
import type { BossPreset } from '@/types/bossPreset'
import type { Specialty } from '@/types/catalog'

/**
 * 「选第三人」区块：候选圈定 + 试算调度 + 结果条形比例。
 * 从 `views/TeamComparePage.vue` 原样搬出（CC-92，2026-09-27 结构熵切面：页面 1552 行 > 1500 线）。
 *
 * ⚠ 依赖以**同名参数**注入（`catalogStore` / `calc` / `selectedBoss` / `selectedPhase` / `progress` / `computing`），
 * 正文与原地逐行相同（仅整体缩进 2 格），先例 `teamCompareScatter.ts#useScatterGeometry`（R44）。
 * `progress` / `computing` 是页面级共享状态（曲线计算等也写它们），故注入而不是在此新建。
 */
export function useSlotSweep(opts: {
  catalogStore: ReturnType<typeof useCatalogStore>
  calc: ReturnType<typeof useResourceCalc>
  selectedBoss: Readonly<Ref<BossPreset | null>>
  selectedPhase: Readonly<Ref<BossPreset['phases'][number] | null>>
  progress: Ref<{ pct: number; text: string } | null>
  computing: Ref<boolean>
}) {
  const { catalogStore, calc, selectedBoss, selectedPhase, progress, computing } = opts

  // 求值口径在 teamTimeline.ts#computeSlotSweepPoints（@fact slotSweep），页面只做候选圈定与展示。
  /** 职业中文标签（与 WEngineFieldPage/ResourcePage 同款映射；specialty 联合类型单源在 types/catalog） */
  const SWEEP_SPEC_LABELS = { attack: '强攻', stun: '击破', anomaly: '异常', support: '支援', defense: '防护', rupture: '命破', sharpen: '锋御' } as const
  const SLOT_LABELS = ['主C位', '击破位', '支援位'] as const
  const slotLabels = SLOT_LABELS
  const sweepSlot = ref<SlotCompareSlot>(1)
  const sweepSlotOptions: Array<{ value: SlotCompareSlot; label: string }> = [
    { value: 0, label: '主C槽' },
    { value: 1, label: '击破槽' },
    { value: 2, label: '支援槽' },
  ]
  // @fact sweepPage:第三人候选圈定 口径: 候选池 = 「候选职业」多选（空=全部 specialty）过滤后的可见角色 − 固定 2 人；「候选角色」可再手选收窄（空=筛选后全部）；默认态 = 用户 2026-09-13 示例（固定 蕾米埃尔(1581)+维琳娜(1561)、候选职业=异常） | 据 用户 2026-09-13「第三人不是海选，是选定部分角色。比如蕾米+维琳娜，第三人就是任何异常角色」·复核@2026-09-25·复核@2026-09-27（CC-92 纯搬运，口径未变） | 验 src/composables/__tests__/slotSweep.test.ts（candidateIds 收窄口径） | 锚 src/composables/teamCompareSweep.ts#sweepCandidates | 信 确认
  /** 三个槽位各自固定的队友（第三人槽位上的值不读）；默认 = 蕾米埃尔 + 维琳娜（用户示例） */
  const sweepFixedBySlot = ref<Record<number, string | null>>({ 0: '1581', 1: null, 2: '1561' })
  /** 候选职业（空 = 全部）；默认异常 = 用户示例「第三人就是任何异常角色」 */
  const sweepSpecFilter = ref<Specialty[]>(['anomaly'])
  /** 在职业筛选内再手选候选（空 = 筛选后全部） */
  const sweepCandidateSel = ref<string[]>([])
  const sweepBudget = ref(6)
  const sweepOptimalGold = ref(false)
  const sweepAbort = ref(false)
  const sweepResult = ref<SlotSweepResult | null>(null)
  /** 固定队友所在的两个槽位（按槽位序） */
  const sweepFixedSlots = computed(() => [0, 1, 2].filter(s => s !== sweepSlot.value))
  const agentOptions = computed(() =>
    catalogStore.displayAgents.map(a => ({ value: a.id, label: a.name.zhCN ?? a.name.en ?? a.id })),
  )
  const sweepSpecOptions = (Object.entries(SWEEP_SPEC_LABELS) as Array<[Specialty, string]>)
    .map(([value, label]) => ({ value, label }))
  const sweepSpecLabel = computed(() =>
    sweepSpecFilter.value.length === 0 ? '全部职业' : sweepSpecFilter.value.map(s => SWEEP_SPEC_LABELS[s] ?? s).join('、'),
  )
  /** 候选池：职业筛选 → 排除固定 2 人（fixed 未选齐时先按已选的剔除） */
  const sweepCandidates = computed(() => {
    const fixed = sweepFixedSlots.value.map(s => sweepFixedBySlot.value[s]).filter((v): v is string => !!v)
    return catalogStore.displayAgents
      .filter(a => sweepSpecFilter.value.length === 0 || sweepSpecFilter.value.includes(a.specialty))
      .filter(a => !fixed.includes(a.id))
  })
  const sweepCandidateOptions = computed(() =>
    sweepCandidates.value.map(a => ({ value: a.id, label: a.name.zhCN ?? a.name.en ?? a.id })),
  )

  async function runSweep() {
    const boss = selectedBoss.value
    const phase = selectedPhase.value
    if (!boss || !phase) return
    const fixedSlots = sweepFixedSlots.value
    const f0 = sweepFixedBySlot.value[fixedSlots[0]!]
    const f1 = sweepFixedBySlot.value[fixedSlots[1]!]
    if (!f0 || !f1) {
      progress.value = { pct: 1, text: '先选齐两个固定队友' }
      setTimeout(() => { progress.value = null }, 2500)
      return
    }
    if (f0 === f1) {
      progress.value = { pct: 1, text: '两个固定队友不能相同' }
      setTimeout(() => { progress.value = null }, 2500)
      return
    }
    // 手选子集与职业筛选取交集（手选项可能已随筛选变化失效）
    const pool = sweepCandidates.value
    const candidateIds = sweepCandidateSel.value.length > 0
      ? pool.filter(a => sweepCandidateSel.value.includes(a.id)).map(a => a.id)
      : pool.map(a => a.id)
    if (candidateIds.length === 0) {
      progress.value = { pct: 1, text: '候选池为空：换个职业筛选，或在「候选角色」里手选候选人' }
      setTimeout(() => { progress.value = null }, 3000)
      return
    }
    computing.value = true
    sweepAbort.value = false
    progress.value = { pct: 0, text: '' }
    try {
      sweepResult.value = await computeSlotSweepPoints(calc, {
        slot: sweepSlot.value,
        fixed: [f0, f1],
        boss,
        phase,
        budget: sweepBudget.value,
        optimalGold: sweepOptimalGold.value,
        candidateIds,
        shouldAbort: () => sweepAbort.value,
        onProgress: p => { progress.value = p },
      })
    } finally {
      sweepAbort.value = false
      computing.value = false
    }
  }

  const sweepMaxDamage = computed(() => Math.max(...(sweepResult.value?.points ?? []).map(p => p.damage), 1))
  function sweepBarPct(damage: number): number {
    return Math.round((damage / sweepMaxDamage.value) * 1000) / 10
  }

  return {
    slotLabels,
    sweepSlot,
    sweepSlotOptions,
    sweepFixedBySlot,
    sweepSpecFilter,
    sweepCandidateSel,
    sweepBudget,
    sweepOptimalGold,
    sweepAbort,
    sweepResult,
    sweepFixedSlots,
    agentOptions,
    sweepSpecOptions,
    sweepSpecLabel,
    sweepCandidates,
    sweepCandidateOptions,
    runSweep,
    sweepMaxDamage,
    sweepBarPct,
  }
}
