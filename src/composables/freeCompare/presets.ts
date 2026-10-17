/**
 * 分析工作台 · 参数预设（内置模板 + 用户预设）
 *
 * 用户口径（2026-10-17）：「我的不同对比只是预设了不同参数，想从不同的视角分析多次计算的某项数据」。
 * 因此预设只存**输入**（系列/轴/切片/指标/场景），不存结果——结果由一次求值产出，
 * 视角（表格/折线/切片/3D/差值）是另一层状态，两者互不污染。
 *
 * 存储口径：
 * - 内置模板（`builtin:`）住 `src/data/analysisPresets.ts`，不进 localStorage；
 * - 用户预设（`user:`）存 localStorage 的 `zzz-analysis-presets-v1`，读取时逐条 `sanitizePreset`——
 *   旧版本/手改/损坏的条目**丢弃**而不是让页面炸（schema 版本在顶层，未来可迁移）。
 */

import { AXES, type AxisId, parseSetupCode, parseSliceKey } from './axes'
import { METRIC_BY_ID } from './metrics'
import { ANALYSIS_VIEWS, type AnalysisView } from './views'

export interface WorkbenchPreset {
  id: string
  name: string
  /** 一句话说明（内置模板用；用户预设可空） */
  note?: string
  series: Array<{ agentId: string; code: string }>
  axisId: AxisId
  /** 空 = 单张二维图；编码见 axes.ts#sliceKeyOf */
  sliceKey: string
  metricId: string
  cinemaMax: number
  setupCodesText: string
  bossId: string
  buffChoice: string
  mateA: string
  mateB: string
  autoBuild: boolean
  conditions: Array<{ agentId: string; cinema: number }>
  /** 应用预设时默认打开的视角（缺省 = 折线） */
  view?: AnalysisView
}

/** localStorage 的最小接口（测试注入假实现；页面缺省用 window.localStorage） */
export interface PresetStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORAGE_KEY = 'zzz-analysis-presets-v1'
const STORAGE_VERSION = 1
const MAX_USER_PRESETS = 50

function defaultStorage(): PresetStorage | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

const AXIS_IDS = new Set<AxisId>(AXES.map(a => a.id))
const VIEW_IDS = new Set<AnalysisView>(ANALYSIS_VIEWS.map(v => v.id))

/**
 * 净化一条预设：坏字段丢弃、能补的补默认、整体不可用返回 null。
 * 不抛异常——localStorage 的内容是外部输入。
 */
export function sanitizePreset(raw: unknown): WorkbenchPreset | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id)?.trim()
  const name = str(raw.name)?.trim()
  if (!id || !name) return null

  const series: WorkbenchPreset['series'] = []
  if (Array.isArray(raw.series)) {
    for (const item of raw.series) {
      if (!isRecord(item)) continue
      const agentId = str(item.agentId)?.trim()
      const code = str(item.code)?.trim()
      if (!agentId || !code || !parseSetupCode(code)) continue
      series.push({ agentId, code })
    }
  }
  if (series.length === 0) return null

  const axisId = str(raw.axisId)
  if (!axisId || !AXIS_IDS.has(axisId as AxisId)) return null
  const metricId = str(raw.metricId)
  if (!metricId || !METRIC_BY_ID.has(metricId)) return null

  const sliceKey = str(raw.sliceKey) ?? ''
  if (sliceKey && !parseSliceKey(sliceKey)) return null

  const conditions: WorkbenchPreset['conditions'] = []
  if (Array.isArray(raw.conditions)) {
    for (const item of raw.conditions) {
      if (!isRecord(item)) continue
      const agentId = str(item.agentId)?.trim()
      if (!agentId) continue
      conditions.push({ agentId, cinema: clampInt(item.cinema, 0, 6, 0) })
    }
  }

  const viewRaw = str(raw.view)
  const view = viewRaw && VIEW_IDS.has(viewRaw as AnalysisView) ? viewRaw as AnalysisView : undefined

  return {
    id,
    name,
    note: str(raw.note) ?? undefined,
    series,
    axisId: axisId as AxisId,
    sliceKey,
    metricId,
    cinemaMax: clampInt(raw.cinemaMax, 0, 6, 6),
    setupCodesText: str(raw.setupCodesText) ?? '01,11,21,20',
    bossId: str(raw.bossId) ?? '',
    buffChoice: str(raw.buffChoice) ?? 'none',
    mateA: str(raw.mateA) ?? '',
    mateB: str(raw.mateB) ?? '',
    autoBuild: raw.autoBuild === true,
    conditions,
    view,
  }
}

/** 用户预设 id（与内置 `builtin:` 区分；不需要全局唯一，只要会话内不撞） */
export function newUserPresetId(now = Date.now()): string {
  return 'user:' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

export function isUserPreset(id: string): boolean {
  return id.startsWith('user:')
}

/** 读用户预设（损坏/旧 schema 整体回落空数组，不抛） */
export function loadUserPresets(storage: PresetStorage | null = defaultStorage()): WorkbenchPreset[] {
  if (!storage) return []
  let raw: unknown
  try {
    const text = storage.getItem(STORAGE_KEY)
    if (!text) return []
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!isRecord(raw) || raw.version !== STORAGE_VERSION || !Array.isArray(raw.presets)) return []
  const out: WorkbenchPreset[] = []
  const seen = new Set<string>()
  for (const item of raw.presets) {
    const preset = sanitizePreset(item)
    if (!preset || seen.has(preset.id)) continue
    seen.add(preset.id)
    out.push(preset)
  }
  return out
}

function writeUserPresets(presets: WorkbenchPreset[], storage: PresetStorage | null): WorkbenchPreset[] | null {
  if (!storage) return null
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, presets }))
    return presets
  } catch {
    return null
  }
}

/** 保存/覆盖一条用户预设；storage 不可用或写入失败返回 null（页面据此提示） */
export function saveUserPreset(
  preset: WorkbenchPreset,
  storage: PresetStorage | null = defaultStorage(),
): WorkbenchPreset[] | null {
  const clean = sanitizePreset(preset)
  if (!clean) return null
  const list = loadUserPresets(storage).filter(p => p.id !== clean.id)
  list.push(clean)
  // 超出上限时丢最早保存的（覆盖会先删后 push ⇒ 移到末尾 = 最近保存；列表按保存顺序）
  const capped = list.slice(Math.max(0, list.length - MAX_USER_PRESETS))
  return writeUserPresets(capped, storage)
}

/** 删除一条用户预设；返回删除后的列表（storage 不可用返回 null） */
export function deleteUserPreset(
  id: string,
  storage: PresetStorage | null = defaultStorage(),
): WorkbenchPreset[] | null {
  const list = loadUserPresets(storage).filter(p => p.id !== id)
  return writeUserPresets(list, storage)
}
