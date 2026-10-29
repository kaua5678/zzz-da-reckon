import { computed, type Ref } from 'vue'
import type { TeamComparePoint } from '@/types/teamPreset'
import { assignTeamColors, teamColorOf } from '@/composables/teamColors'

/**
 * 散点图几何（x = 难度，y = 血量%）：画布尺寸、轴上限、刻度与队伍配色。
 * 从 `views/TeamComparePage.vue` 原样搬出（纯派生量、无副作用；2026-09-20 round 44 结构熵切面）。
 *
 * ⚠ 依赖以**同名参数**注入（`visiblePoints`）而不是改名成 `points`：这样搬出的正文与原地
 * **逐字节相同**，保真可机器证明。
 *
 * ⚠ **配色已外移**到 `composables/teamColors.ts`（用户 2026-10-29 报「挽昼的几个队都是灰色曲线
 * 看不清」）：色号必须按**勾选清单**编，而不是按预设库下标取模、未命中兜底灰——自定义队不在
 * 预设库里，旧实现让它们全部同色。本文件只把清单转成 `colorOf` 给图表用。
 */
export function useScatterGeometry(opts: {
  visiblePoints: Ref<TeamComparePoint[]>
  /** 当前勾选的队伍 id（顺序 = 勾选顺序）——色号基准，见 `teamColors.ts` 口径 */
  selectedPresetIds: Ref<readonly string[]>
}) {
  const { visiblePoints, selectedPresetIds } = opts

  const svgW = computed(() => Math.max(420, Math.min(1100, typeof window !== 'undefined' ? window.innerWidth - 120 : 960)))
  const padL = 46, padR = 16, padT = 24, padB = 44
  const plotW = computed(() => svgW.value - padL - padR)
  const plotH = 340
  const viewBox = computed(() => `0 0 ${svgW.value} ${padT + plotH + padB}`)

  const yMax = computed(() => {
    const maxRatio = Math.max(...visiblePoints.value.map(p => p.hpRatio), 0)
    return Math.max(100, Math.ceil(Math.max(maxRatio, 150) / 50) * 50)
  })
  const xMax = computed(() => {
    const maxD = Math.max(...visiblePoints.value.map(p => p.difficulty), 1)
    return Math.max(10, Math.ceil(maxD / 5) * 5)
  })
  function yOf(v: number): number {
    return padT + plotH - (v / yMax.value) * plotH
  }
  function xOf(v: number): number {
    return padL + (v / xMax.value) * plotW.value
  }

  const yTicks = computed(() => {
    const ticks: number[] = []
    const step = yMax.value <= 100 ? 20 : yMax.value <= 200 ? 50 : 100
    for (let v = 0; v <= yMax.value; v += step) ticks.push(yOf(v))
    return ticks
  })
  function yLabel(i: number): number {
    const step = yMax.value <= 100 ? 20 : yMax.value <= 200 ? 50 : 100
    return i * step
  }

  const xTicks = 5
  const xTickPositions = computed(() => {
    const out: number[] = []
    for (let i = 0; i <= xTicks; i++) out.push(xOf((xMax.value / xTicks) * i))
    return out
  })
  const xTickLabels = computed(() => {
    const out: number[] = []
    for (let i = 0; i <= xTicks; i++) out.push((xMax.value / xTicks) * i)
    return out
  })

  /** 勾选清单 → 色表（顺序即色号；重复 id 不占两个色号） */
  const presetColors = computed<Record<string, string>>(() => assignTeamColors(selectedPresetIds.value))
  /** 取色：清单内直取，清单外走稳定哈希兜底（**永不返回灰**，见 `teamColors.ts`） */
  function colorOf(presetId: string): string {
    return teamColorOf(presetId, presetColors.value)
  }

  return {
    svgW, padL, padR, padT, padB, plotW, plotH, viewBox,
    yMax, xMax, yOf, xOf, yTicks, yLabel, xTicks, xTickPositions, xTickLabels,
    presetColors, colorOf,
  }
}
