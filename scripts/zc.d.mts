/** scripts/zc.mjs 的类型声明（供 vitest 消费，先例：check-guards.d.mts / check-tokens.d.mts） */

export declare const ROOT: string
export declare const STATE_DIR: string
export declare const LEASES_FILE: string
export declare const JOURNAL_FILE: string

// ---- L1 事实层（语言本体） ----
export declare const FACT_KINDS: string[]
export declare const CONFIDENCE: string[]

export interface Fact {
  subject: string
  kind: string
  claim: string
  provenance: string | null
  verifier: string | null
  /** 口径实现在哪：<路径>[#<符号>]；断锚 = check-guards 判据 6 红 */
  anchor: string | null
  confidence: string | null
  source?: string
}

export declare function parseFactLine(line: unknown): Fact | null
export declare function formatFact(f: Fact): string
export declare function grammar(): string

// ---- L2 索引层（从散文抽取） ----
export declare const KIND_MARKERS: { re: RegExp; kind: string }[]
export declare const CONFIDENCE_TAGS: { re: RegExp; confidence: string }[]
export declare function extractProvenance(text: string): string | null
export declare function splitSentences(text: string): string[]
export interface UnmarkedSentence { subject: string; source: string; text: string }
export declare function extractFacts(
  text: string,
  subject: string,
  source: string,
): { facts: Fact[]; unparsed: UnmarkedSentence[] }
export declare function subjectFromPath(path: string, moduleAgentIds?: Record<string, string>): string
export declare function resolveModuleAgentId(source: string): string | null
export declare function buildModuleAgentIds(root?: string): { map: Record<string, string>; unresolved: string[] }
export declare function collectSpecNotes(value: unknown, acc?: string[]): string[]
export declare function collectComments(source: string): string[]
export interface HarvestStats {
  facts: number
  unmarked: number
  subjects: number
  unresolvedModules: number
  structuredRate: number
  withoutProvenance: number
}
export declare function harvestRepo(root?: string): {
  facts: Fact[]
  unparsed: UnmarkedSentence[]
  unresolved: string[]
  stats: HarvestStats
}
export declare function testsForSubject(subject: string, root?: string): string[]

// ---- L2.5 锚点层（口径 ↔ 代码绑定） ----
export declare function stripCommentPrefix(line: string): string
export interface AnchorResolution {
  ok: boolean
  reason: 'ok' | 'file' | 'symbol' | 'anchor-missing' | 'file-missing' | 'symbol-missing'
  path?: string
  symbol?: string
}
export declare function resolveAnchor(anchor: string | null | undefined, root?: string): AnchorResolution
export interface AuthoredFact { file: string; line: number; raw: string; fact: Fact | null }
export declare function scanAuthoredFacts(root?: string): AuthoredFact[]
export declare function auditAuthoredFacts(root?: string): {
  scanned: AuthoredFact[]
  violations: (AuthoredFact & { problem: string })[]
}
export declare function anchorTouchedAt(path: string, root?: string): number
export declare function driftQueue(root?: string): {
  subject: string
  anchor: string
  since: string
  touchedAt: string
  at: string
}[]

// ---- L3 动作层（租约 / 信封 / CLI） ----
export interface Lease { path: string; lane: string; at: number; ttlMs: number }
export declare function readLeases(): Lease[]
export declare function writeLeases(leases: Lease[]): void
export declare function isExpired(lease: Lease, now?: number): boolean
export declare function currentLane(explicit?: string): string
export declare function findConflicts(
  leases: Lease[],
  paths: string[],
  lane: string,
  now?: number,
): { path: string; holder: Lease }[]
export declare function applyClaim(leases: Lease[], paths: string[], lane: string, ttlMs: number, now?: number): Lease[]
export declare function applyRelease(leases: Lease[], paths: string[] | '--all', lane: string): Lease[]
export declare function detectForeignWip(
  changed: string[],
  leases: Lease[],
  mtimes: Record<string, number>,
  now?: number,
  windowMs?: number,
  ownPaths?: string[],
): string[]
export declare function recentlyOwnedPaths(
  journal: { lane?: string; at?: string; changed?: string[] }[],
  lane: string,
  now?: number,
  windowMs?: number,
): string[]
export interface Envelope<T = Record<string, unknown>> { ok: boolean; verb: string; data: T; next: string | null }
export declare function envelope<T>(verb: string, ok: boolean, data: T, next?: string | null): Envelope<T>
export declare function parsePorcelain(text: string): { status: string; path: string }[]
export declare function parseArgs(argv: string[]): Record<string, string | boolean | string[]> & { positional: string[] }
export declare function main(argv: string[]): Promise<Envelope<Record<string, unknown>>>
