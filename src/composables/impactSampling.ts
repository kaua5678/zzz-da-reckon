/**
 * 伤害影响分析的采样（CC-345，2026-10-02 arena-E r376）：2D 单变量敏感度曲线 + 3D 双变量响应面。
 *
 * 为什么独立成模块：原先采样循环写在 `components/ImpactChart.vue` / `charts/ResponseSurface3D.vue` 里，
 * 直接改写**页面正在用的 UI config store**（逐点写变量、快照曲线用 `$patch` 换队），跑完手工恢复：
 * - 恢复写在 `try` 里而不是 `finally`：中途抛错 ⇒ UI 现场留在最后一个采样点；
 * - 恢复靠「把原值写回去」：机制设置原先是「未设置（取缺省 / 取覆盖率自动值）」时，写回后变成显式值，现场被改；
 * - 采样期间每次让出主线程，页面上绑在 UI store 的所有计算都为中间态重算，用户此时的编辑会被恢复覆盖。
 * 这正是 CC-343 用独立场景消除的结构（docs/mcp-analyzer-scenario-isolation.md §1），这里是漏迁的最后一个分析器。
 *
 * 现在：调用方 `withAnalysisScenario(s => sampleImpactCurve(s, ...))`；本模块只在场景上写变量、读结果，
 * 不读 UI config store、不做恢复。让出主线程的位置与原组件逐一对应（pre-flush watcher——例如副词条预算
 * 设置 watcher——在让出时才跑，读数时机变了结果就会变），A/B 见上述文档 §3.6。
 */
import type { AnalysisContext } from '@/composables/analysisScenario'
import { cloneConfigState } from '@/composables/analysisScenario'
import { isBatchAborted, type BatchControl } from '@/composables/batchTask'
import { teamMechanicSettings, teamReleaseShares } from '@/composables/agentMechanicView'
import { buildImpactVariables, writeImpactVariable } from '@/composables/impactVariables'
import type { ImpactVariable } from '@/core/impactVars'
import { computeSubstatAllocationForSlot } from '@/composables/substatOptimizer'
import { useCatalogStore } from '@/stores/catalog'
import type { CharacterConfig } from '@/stores/config'
import type { MechanicSetting } from '@/types/resource'

/** 一个采样点：x = 变量值（展示单位），y = 队伍总伤，byType = 按伤害类型分解 */
export interface ImpactPoint { x: number; y: number; byType: Record<string, number> }

const yieldToMacrotask = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/** 场景当前队伍的机制设置表与可选变量（口径同 ImpactChart 的 settingMap / allVars） */
export function impactVariableView(scenario: AnalysisContext): { settingMap: Map<string, MechanicSetting>; vars: ImpactVariable[] } {
  const { config, calc } = scenario
  const catalog = useCatalogStore()
  const settingMap = new Map<string, MechanicSetting>()
  for (const setting of teamMechanicSettings(config.team)) settingMap.set(setting.id, setting)
  const coverageRate = calc.anomalyPoolResult.value?.coverage?.perElementCoverageRate
  const releaseShares = teamReleaseShares(config.team, id => catalog.getAgent(id))
  return { settingMap, vars: buildImpactVariables(settingMap, releaseShares, coverageRate) }
}

/** 读当前求值结果：总伤 + 按伤害类型分解（只计 totalDamage > 0 的行） */
export function readImpactPoint(scenario: AnalysisContext, x = 0): ImpactPoint {
  const byType: Record<string, number> = {}
  for (const row of scenario.calc.damagePoolRows.value) {
    if (row.totalDamage > 0) byType[row.type] = (byType[row.type] ?? 0) + row.totalDamage
  }
  return { x, y: scenario.calc.teamTotalDamage.value, byType }
}

export interface ImpactCurveOptions {
  varId: string
  points: number
  /** 每点对 0 号位重算副词条分配（以真实伤害精修，CC-183/185） */
  optimizePerPoint?: boolean
  /** 快照曲线：先把场景队伍整体换成这份（深拷贝） */
  team?: CharacterConfig[]
  onProgress?: (done: number) => void
  control?: BatchControl
}

/**
 * 2D 敏感度曲线：变量在其缺省区间上等距取 `points` 个点。变量不属于（换队后的）场景 ⇒ 返回空数组。
 * 被取消时在下一点之前停，返回已算部分。
 */
export async function sampleImpactCurve(scenario: AnalysisContext, opts: ImpactCurveOptions): Promise<ImpactPoint[]> {
  const { config, calc } = scenario
  if (opts.team) {
    config.team = cloneConfigState(opts.team)
    await yieldToMacrotask()
  }
  const { settingMap, vars } = impactVariableView(scenario)
  const v = vars.find(item => item.id === opts.varId)
  if (!v) return []
  const catalog = useCatalogStore()
  const [xMin, xMax] = v.defaultRange
  const pts: ImpactPoint[] = []
  for (let i = 0; i < opts.points; i++) {
    if (isBatchAborted(opts.control)) break
    const x = xMin + ((xMax - xMin) / (opts.points - 1)) * i
    writeImpactVariable(v.id, x, config, settingMap)
    await yieldToMacrotask()
    if (opts.optimizePerPoint) {
      const alloc = computeSubstatAllocationForSlot(0, config, catalog, { readDamage: () => calc.teamTotalDamage.value }, calc.effectiveWEngineCoverages.value)
      const char = config.team[0]
      if (char && alloc) char.driveDisc.subStatAllocation = alloc
    }
    await yieldToMacrotask()
    pts.push(readImpactPoint(scenario, x))
    opts.onProgress?.(i + 1)
  }
  return pts
}

export interface ImpactSurfaceOptions {
  varX: string
  varY: string
  /** 每轴网格点数（总点数 n²） */
  n: number
  onProgress?: (done: number, total: number) => void
  control?: BatchControl
}

export interface ImpactSurface {
  xs: number[]
  ys: number[]
  /** grid[i][j] = (xs[i], ys[j]) 处的队伍总伤 */
  grid: number[][]
  minZ: number
  maxZ: number
  peak: { x: number; y: number; z: number }
  /** 被取消 ⇒ false（grid 不完整，调用方不应展示） */
  complete: boolean
}

/** 3D 响应面：两变量各在缺省区间上取 n 点。任一变量不属于场景 ⇒ null。 */
export async function sampleImpactSurface(scenario: AnalysisContext, opts: ImpactSurfaceOptions): Promise<ImpactSurface | null> {
  const { settingMap, vars } = impactVariableView(scenario)
  const vx = vars.find(item => item.id === opts.varX)
  const vy = vars.find(item => item.id === opts.varY)
  if (!vx || !vy) return null
  const N = opts.n
  const total = N * N
  const [minX, maxX] = vx.defaultRange
  const [minY, maxY] = vy.defaultRange
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < N; i++) {
    xs.push(minX + ((maxX - minX) / (N - 1)) * i)
    ys.push(minY + ((maxY - minY) / (N - 1)) * i)
  }
  const grid: number[][] = []
  let minZ = Infinity
  let maxZ = -Infinity
  let peak = { x: minX, y: minY, z: 0 }
  const BATCH_SIZE = 8
  let completed = 0
  for (let i = 0; i < N; i++) {
    grid[i] = []
    for (let j = 0; j < N; j++) {
      if (isBatchAborted(opts.control)) return { xs, ys, grid, minZ, maxZ, peak, complete: false }
      writeImpactVariable(vx.id, xs[i]!, scenario.config, settingMap)
      writeImpactVariable(vy.id, ys[j]!, scenario.config, settingMap)
      // 让出主线程的节奏同原组件：每 8 点一次（含第 0 点），其余点同步读数
      if (completed % BATCH_SIZE === 0) await yieldToMacrotask()
      const z = scenario.calc.teamTotalDamage.value
      grid[i]![j] = z
      if (z < minZ) minZ = z
      if (z > maxZ) { maxZ = z; peak = { x: xs[i]!, y: ys[j]!, z } }
      completed++
      if (completed % 5 === 0 || completed === total) opts.onProgress?.(completed, total)
    }
  }
  return { xs, ys, grid, minZ: minZ === Infinity ? 0 : minZ, maxZ: maxZ === -Infinity ? 1 : maxZ, peak, complete: true }
}
