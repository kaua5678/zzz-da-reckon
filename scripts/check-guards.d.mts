/** scripts/check-guards.mjs 的类型声明（供 vitest 消费，先例：phase-buff-parser.d.mts） */

export declare const ROOT: string

// 判据 1：fetch-stub 冻结
export declare const FETCH_STUB_PATTERNS: RegExp[]
export declare function detectFetchStub(content: string): boolean
export declare const GUARD_SYSTEM_FILES: string[]
export declare const FETCH_STUB_ALLOWLIST: string[]
export declare function fetchStubViolations(files: { path: string; content: string }[]): string[]
export declare function scanFetchStubs(root?: string): { violations: string[]; stale: string[] }

// 判据 2：编排层 agentId 分支棘轮（2026-09-12 口径纠正：单文件 → 入口 + resourceCalc/ 目录）
export declare const AGENT_BRANCH_DIR: string
export declare const AGENT_BRANCH_FILE: string
export declare const AGENT_BRANCH_BASELINE: number
export declare function listAgentBranchFiles(root?: string): string[]
export declare function countAgentBranchLines(root?: string): number
export declare function countAgentIdBranchLines(content: string): number
// 引擎层 agentId 棘轮（规则 6 在 core 的延伸）
export declare const CORE_AGENT_BRANCH_FILES: string[]
export declare const CORE_AGENT_BRANCH_BASELINE: number
export declare function countAgentIdBranchLinesInFiles(files: string[], root?: string): number

// 判据 3：工作区状态防误提交
export declare const CLAUDE_TRACKED_ALLOWLIST: string[]
export declare function findForbiddenTracked(trackedPaths: string[]): string[]

// 判据 4：滑块生效测试
export declare const UNTESTED_SETTINGS_ALLOWLIST: string[]
export declare function extractSettingIds(moduleSource: string): string[]
export declare function scanSettingsCoverage(root?: string): {
  declared: Map<string, string[]>
  untested: string[]
  stale: string[]
}

// 判据 5：debt: 标记注册表
export interface DebtMarker { file: string; text: string }
export interface DebtEntry { since: string; due: string }
export declare const DEBT_REGISTRY: Record<string, DebtEntry>
export declare const DEBT_SCAN_SELF_REFERENTIAL: string[]
export declare function scanDebtMarkers(root?: string): DebtMarker[]
export declare function matchDebtRegistry(markers: DebtMarker[]): { unregistered: DebtMarker[]; cleared: string[] }

// 判据 9：README §6 文档表 == docs/ 实际文件
export declare function parseDocTable(readmeText: string): { files: string[]; declaredCount: number | null }
export declare function listDocs(root?: string): string[]
export declare function auditDocTable(root?: string): {
  missing: string[]
  extra: string[]
  declaredCount: number | null
  actualCount: number
  countMismatch: boolean
} | null

// 判据 10：catalog level60 ↔ raw 源对账（防漏加满级突破加成，坑 40）
export declare function auditCatalogLevel60(root?: string): {
  compared: number
  violations: { id: string; name: string; field: string; got: unknown; want: unknown }[]
  fieldNames: string[]
} | null

export interface GuardResult {
  name: string
  ok: boolean
  detail: string[]
}
export declare function runAllChecks(root?: string): { results: GuardResult[]; ok: boolean }

// 判据 11：棘轮 burn-down 契约（防「冻结 = 永久化」）
export interface RatchetBurndownEntry {
  id: string
  file: string
  frozen: number
  target: number
  due: string
  plan: string
}
export interface RatchetBurndownState extends RatchetBurndownEntry {
  current: number
  progress: number
  remaining: number
  overdue: boolean
  stale: boolean
  done: boolean
  dueSoon: boolean
}
export declare const RATCHET_BURNDOWN: RatchetBurndownEntry[]
export declare function computeBurndown(
  measure: (id: string) => number,
  today?: string,
): RatchetBurndownState[]
export declare function daysBetween(a: string, b: string): number

// 判据 7：展示层越层 import 棘轮（ARCHITECTURE §0 依赖方向）
export declare const EXHIBITION_LAYER_DIRS: string[]
export declare const EXHIBITION_LAYER_FORBIDDEN: RegExp
export declare const EXHIBITION_LAYER_IMPORT_BASELINE: number
export declare function detectExhibitionLayerImport(line: string): boolean
export declare function countExhibitionLayerImports(content: string): number
export declare function scanExhibitionLayerImports(root?: string): {
  count: number
  sites: { file: string; line: number; text: string }[]
}
