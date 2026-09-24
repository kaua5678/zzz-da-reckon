/**
 * 热启动缓存 —— 自 `core/resource.ts` 迁出（CC-2，2026-09-24）。
 *
 * 职责：把上次收敛的**规范种子**（本轮 `states` 初值）按精确键缓存，同配置再次计算时注入为初值，
 * 加速内层不动点收敛。**只做精确键命中**；近似命中（邻域初值）的度量依据与前置条件见下方块注释。
 * 模块级状态 `warmStartCache` / `warmStartStats` 全仓**只有这一份**；`core/resource.ts` 保留
 * `clearWarmStartCache` / `getWarmStartStats` 的 re-export 壳，测试与 dump 调用方零改动。
 *
 * 依赖方向：本文件**不得** import `core/resource.ts`（防循环依赖）；只依赖 `@/types/resource` 类型。
 * 写回顺序（终局重推之后、装配之前）与「只存规范种子不存末态」口径 = `core/resource.ts` 内
 * `@fact engine:热启动逐位透明`，搬迁不得重排。
 */
import type { ResourceCalcConfig, CharacterOperationConfig, IterationState } from '@/types/resource'

// ============ 热启动缓存 ============
/**
 * 热启动（2026-08 复活）：把上次收敛的 IterationState[] 缓存、同配置再次计算时作为初值注入。
 * **只做精确键命中**：从上一轮的收敛末态出发时，iterate 落在不动点上，结果与冷算逐位一致
 * （下方测试锁定）。**队签名近似命中（改滑块/命座后复用邻域初值）暂不做的度量依据**：
 * 内层循环只对强特/终结次数判稳，次数稳定后 basicAttackTime/喧响的小数位仍随初值漂移
 * （实测同队签名扰动下喧响总数差 ~0.1%）——近似命中会让结果依赖计算历史，
 * 违反 seedInvariance「收敛态与初值无关」的安全性前提；前置是先把内层收敛判据
 * 加强到小数位稳定（会整体微移全库数值基线，须单独立项验证后再启用近似命中）。
 */
export interface WarmStartEntry {
  exactKey: string
  states: IterationState[]
}
const WARM_START_CACHE_MAX = 16
/** 收敛后写回 cfg 的反馈字段 + 每次进入先清零的草稿字段：不是输入，进精确键只会造成假未命中。
 *  新增「收敛后写回 cfg」的字段时必须同步加进这里。 */
const WARM_KEY_OMIT_CFG = new Set([
  'timeBudgetExcess',
  'luciaCurtainTriggerCount',
  'yidhariExternalHealPct',
  'normaHatToChainCount',
  'rowTimeLimit',
])
const warmStartCache: WarmStartEntry[] = []
const warmStartStats = { stored: 0, seeded: 0 }

function sanitizeWarmKeyCfg(cfg: CharacterOperationConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cfg as unknown as Record<string, unknown>)) {
    if (!WARM_KEY_OMIT_CFG.has(k)) out[k] = v
  }
  return out
}

export function warmStartExactKey(config: ResourceCalcConfig): string {
  const globals: Record<string, unknown> = { ...config }
  delete globals.initialStates
  delete globals.characters
  return JSON.stringify([globals, config.characters.map(sanitizeWarmKeyCfg)])
}

/** 命中则返回缓存的收敛态（只读，调用方自行浅拷贝）；显式 initialStates 时返回 null。
 *  `exactKey` 由调用方预先算好传入（2026-09-23 mcp-engine：旧版在 find 回调里对**每个缓存条目**
 *  重算一次 JSON 键，最多 16×序列化/求值，实测 ~1s/18s 自耗时）。 */
export function lookupWarmStart(config: ResourceCalcConfig, exactKey: string): WarmStartEntry | null {
  if (config.initialStates) return null
  const entry = warmStartCache.find(e => e.exactKey === exactKey) ?? null
  if (entry) warmStartStats.seeded++
  return entry
}

export function storeWarmStart(exactKey: string, states: IterationState[]): void {
  const idx = warmStartCache.findIndex(e => e.exactKey === exactKey)
  if (idx >= 0) warmStartCache.splice(idx, 1)
  warmStartCache.push({ exactKey, states: states.map(s => ({ ...s })) })
  if (warmStartCache.length > WARM_START_CACHE_MAX) warmStartCache.shift()
  warmStartStats.stored++
}

/** 清空热启动缓存与统计（测试隔离用） */
export function clearWarmStartCache(): void {
  warmStartCache.length = 0
  warmStartStats.stored = 0
  warmStartStats.seeded = 0
}

/** 热启动统计（测试/诊断用）：stored=写入次数，seeded=命中注入次数 */
export function getWarmStartStats(): { stored: number; seeded: number } {
  return { ...warmStartStats }
}
