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
// 引擎层「按角色名的值导入」棘轮（判据 12，T8 证伪后改口径：baseline=5，全活引用不许增）
export declare const CORE_ROLE_IMPORT_BASELINE: number

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

// 判据 11：手册数字 id 密度棘轮（任务卡 2026-09-12「经验手册防历史记录化」，防手册编年史化）
export declare const MANUAL_DENSITY_CEILINGS: Record<string, number>
export interface ManualDensityRow {
  ceiling: number
  lines: number
  hits: number
  /** null = 文档缺失（不判红，与判据 10 同风格） */
  density: number | null
}
export declare function scanManualDensity(root?: string): Record<string, ManualDensityRow>

// 复核触发器（任务卡第 5 步：手册条目「⟳复核: …｜到期 YYYY-MM-DD」，zc drift 点名逾期）
export interface DocReviewTrigger {
  file: string
  line: number
  due: string
  overdue: boolean
  text: string
}
export declare function scanDocReviewTriggers(root?: string, today?: string): DocReviewTrigger[]
export declare function countGuideSection4Lines(root?: string): number

// 判据 12：core role-import 棘轮（上面 CORE_ROLE_IMPORT_BASELINE 是它的基线常量）
export declare const CORE_LAYER_DIR: string
export declare function scanCoreRoleImports(root?: string): {
  count: number
  sites: { file: string; line: number; text: string }[]
}

// 判据 13：名词表三态对账（防「数据在源里但没人消费」）
export declare const NOUN_TRIAGE_FILE: string
export declare const NOUN_SOURCE_FILE: string
export declare const NOUN_STATES: string[]
/** 源文件最小键数（只减不增；防「把源清空 = 无项可审 = 全绿」的假绿通道） */
export declare const NOUN_SOURCE_MIN_KEYS: number
export interface NounTriageEntry {
  name?: string
  title?: string
  skill?: string
  /** modeled = src 有可解析消费锚点 / deferred = 有登记（registeredAt + since）/ unhandled = 两者皆无（红） */
  state: string
  anchor?: string
  registeredAt?: string
  since?: string
  evidence?: string
  duplicateOf?: string
}
export interface NounTriageAudit {
  ok: boolean
  source: Record<string, unknown>
  triage: { entries?: Record<string, NounTriageEntry>; [k: string]: unknown }
  sourceKeys: string[]
  /** 源里有但未对账 / 对账文件多出源里没有的键 */
  missing: string[]
  extra: string[]
  badState: string[]
  noEvidence: string[]
  brokenAnchor: string[]
  noRegister: string[]
  /** 未处理项（each: '<key> <name>｜<evidence>'）——判据 13 的红面 */
  unhandled: string[]
  /** 源面异常（源/账缺失、源键数低于冻结下限）——防「删账本 / 清空源 = 全绿」 */
  sourceShrunk: string[]
}
export declare function auditNounTriage(
  root?: string,
  resolveAnchorFn?: (anchor: string | null | undefined, root?: string) => { ok: boolean; reason: string },
): NounTriageAudit | null

// 判据 14：死通道扫描（A 零读零写 / B 只读不写 / C 手写 .d.mts 漂移）
export interface DeadChannelEntry {
  since: string
  /** ISO 日期（`YYYY-MM-DD`）——与 RATCHET_BURNDOWN 的 due 同源；散文写 action */
  due: string
  /** 怎么处置（原先写在 due 里的中文说明，2026-09-14 拆出来让 due 可机器比对） */
  action: string
  /** 怎么证明它是死的（防「为绿而登记」） */
  why: string
}
export declare const DEAD_CHANNEL_ALLOWLIST: Record<string, DeadChannelEntry>
export interface DeadChannelCandidate {
  key: string
  file: string
  line: number
  name: string
  reads?: number
  writes?: number
}
export declare function scanDeadOptionalProps(root?: string): DeadChannelCandidate[]
export declare function scanReadOnlyOptionalProps(root?: string): DeadChannelCandidate[]
export declare function stripStringLiterals(text: string): string
export declare function stripCommentsAndStrings(text: string): string
export interface DtsDriftRow {
  dts: string
  mjs: string
  names: string[]
  key: string
}
export declare function scanDtsDrift(root?: string): {
  pairs: { dts: string; mjs: string; declared: number; runtime: number }[]
  /** .d.mts 声明了但 .mjs 没有 ⇒ 具名 import 即 TS2305 */
  declaredNotExported: DtsDriftRow[]
  /** .mjs 导出了但影子 API 没写 ⇒ TS 侧看不见 */
  exportedNotDeclared: DtsDriftRow[]
}
export declare function extractRuntimeExports(source: string): string[]
/**
 * 按白名单豁免死通道候选。`segment`（'A'|'B'|'C'）**应显式传**：候选为空时也要查该段
 * 清单是否该销号（不传则退回「从候选推断段」，空候选 = 不查 stale 的旧行为）。
 */
export declare function applyDeadChannelAllowlist(
  candidates: DeadChannelCandidate[] | DtsDriftRow[],
  segment?: string | null,
): {
  fresh: (DeadChannelCandidate | DtsDriftRow)[]
  allowlisted: (DeadChannelCandidate | DtsDriftRow)[]
  /** 清单里已不再命中的行（按 A|/B|/C| 段各自计算） */
  stale: string[]
}

// 判据 15：口径复核触发器强制（游戏语义 @fact 必须挂 ⟳复核 + 到期日）
export declare const CALIBER_NON_GAME_SUBJECTS: string[]
export declare const CALIBER_TRIGGER_KINDS: string[]
export declare const CALIBER_TRIGGER_ALLOWLIST: string[]
export interface CaliberTriggerRow {
  file: string
  line: number
  subject: string
  kind: string
}
export interface CaliberTriggerDueRow {
  file: string
  line: number
  subject: string
  kind: string
  due: string
  overdue: boolean
  text: string
}
/** 代码侧 @fact 触发器的**逾期**检查（判据 15 原先只查「有没有」，从不比对今天） */
export declare function scanCaliberTriggerDue(root?: string, today?: string): CaliberTriggerDueRow[]
export declare function scanCaliberTriggers(
  root?: string,
  facts?: { file: string; line: number; raw?: string; fact?: { subject: string; kind: string } | null }[] | null,
): {
  game: (CaliberTriggerRow & { key: string })[]
  withTrigger: CaliberTriggerRow[]
  /** 游戏语义口径里缺触发器的（判据 15 的红面） */
  missing: (CaliberTriggerRow & { key: string })[]
  /** 豁免清单里已补上触发器的行（漏删即红） */
  stale: string[]
}
