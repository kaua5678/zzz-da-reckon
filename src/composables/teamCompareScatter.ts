import { computed, type ComputedRef } from 'vue'
import { teamPresets } from '@/data/teamPresets'
import type { TeamComparePoint } from '@/types/teamPreset'

/**
 * 散点图几何（x = 难度，y = 血量%）：画布尺寸、轴上限、刻度与队伍配色。
 * 从 `views/TeamComparePage.vue` 原样搬出（纯派生量、无副作用；2026-09-20 round 44 结构熵切面）。
 *
 * ⚠ 依赖以**同名参数**注入（`visiblePoints`）而不是改名成 `points`：这样搬出的正文与原地
 * **逐字节相同**，保真可机器证明。同时 `PALETTE` 常量**整体**随搬（留原地会让两个文件各持
 * 一份色板 = 规则 11 的单一事实源被破）。
 */
export function useScatterGeometry(opts: { visiblePoints: ComputedRef<TeamComparePoint[]> }) {
  const { visiblePoints } = opts

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

  const PALETTE = ['#63e2b7', '#63b3ed', '#f6ad55', '#f687b3', '#b794f4', '#f6e05e', '#4fd1c5', '#fc8181']
  const presetColors = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    teamPresets.forEach((t, i) => { map[t.id] = PALETTE[i % PALETTE.length] })
    return map
  })
  function colorOf(presetId: string): string {
    return presetColors.value[presetId] ?? '#888'
  }

  return {
    svgW, padL, padR, padT, padB, plotW, plotH, viewBox,
    yMax, xMax, yOf, xOf, yTicks, yLabel, xTicks, xTickPositions, xTickLabels,
    presetColors, colorOf,
  }
}
