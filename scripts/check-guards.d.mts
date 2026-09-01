/** scripts/check-guards.mjs 的类型声明（供 vitest 消费，先例：phase-buff-parser.d.mts） */

export declare const ROOT: string

// 判据 1：fetch-stub 冻结
export declare const FETCH_STUB_PATTERNS: RegExp[]
export declare function detectFetchStub(content: string): boolean
export declare const GUARD_SYSTEM_FILES: string[]
export declare const FETCH_STUB_ALLOWLIST: string[]
export declare function fetchStubViolations(files: { path: string; content: string }[]): string[]
export declare function scanFetchStubs(root?: string): { violations: string[]; stale: string[] }

// 判据 2：agentId 分支棘轮
export declare const AGENT_BRANCH_FILE: string
export declare const AGENT_BRANCH_BASELINE: number
export declare function countAgentIdBranchLines(content: string): number

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

export interface GuardResult {
  name: string
  ok: boolean
  detail: string[]
}
export declare function runAllChecks(root?: string): { results: GuardResult[]; ok: boolean }
