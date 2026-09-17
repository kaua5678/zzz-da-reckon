/** scripts/report-agent-identity.mjs 的类型声明（供 vitest 消费，先例：check-guards.d.mts） */

export type IdentityCategory = 'business' | 'definition' | 'unknown'

export interface IdentityEntry {
  file: string
  line: number
  column: number
  /** 命中的身份字段形态 */
  field: string
  /** 比较另一侧的字面量；null = 动态值（未知） */
  identity: string | null
  category: IdentityCategory
  reason: string
  text: string
  /** 存储标志的声明名（仅 unknown/stored 形态） */
  storedAs?: string
  /** 同名消费者的候选行号（best-effort，仅 unknown/stored 形态） */
  consumers?: number[]
}

export interface IdentityBlindSpot {
  file: string
  line: number
  column: number
  alias: string
  identity: string
  reason: string
  text: string
}

export interface IdentityGroup {
  comparisons: number
  lines: number
}

export interface IdentitySummary {
  comparisons: number
  lines: number
  business: IdentityGroup
  definition: IdentityGroup
  unknown: IdentityGroup
  definitionIdentities: string[]
  byShape: Record<string, IdentityGroup>
  /** 同一源码行同时出现两种形态的行数（如 id+teammateBuffId）⇒ 形态数不可相加 */
  shapeOverlap: Record<string, number>
  /** 角色判定合计（机器可复算，不硬编码数字）：business ∪ 待核存储标志 */
  characterJudgment: {
    lines: number
    businessLines: number
    reviewableUnknownLines: number
    newBeyondLegacy: number
    legacyLines: number
    unresolvedIdentityValues: string[]
    nonCharacterUnknownLines: number
  }
  deltaVsLegacy: { businessLinesBeyondLegacyRuler: number; legacyLinesNotBusiness: number }
}

export interface IdentityByIdentity {
  identity: string
  comparisons: number
  lines: number
  categories: IdentityCategory[]
  /** 数据面对账：agent.id / teammateBuffId / dynamic / unresolved / no-catalog */
  resolves: 'agent.id' | 'teammateBuffId' | 'dynamic' | 'unresolved' | 'no-catalog'
}

export interface IdentityReport {
  /** 取数面：HEAD 提交态（默认，抗并行 WIP）/ worktree / mixed（部分文件回退） */
  measuredAt: 'HEAD' | 'worktree' | 'mixed'
  /** 因未提交/无 git 而回退到工作树读取的文件数 */
  fellBack: number
  legacyLines: number
  summary: IdentitySummary
  byIdentity: IdentityByIdentity[]
  entries: IdentityEntry[]
  blindSpots: IdentityBlindSpot[]
  /** 观察项：非角色 `.id` 比较（moveId/dataId/overrideId/rowId 族）——不进任何度量 */
  nonCharacterIds: IdentityEntry[]
}

export declare const IDENTITY_FIELDS: string[]
export declare function scanIdentitySource(content: string, file?: string): {
  entries: IdentityEntry[]
  blindSpots: IdentityBlindSpot[]
  nonCharacterIds: IdentityEntry[]
}
export declare function summarizeIdentity(entries: IdentityEntry[]): IdentitySummary
export declare function groupByIdentity(entries: IdentityEntry[]): IdentityByIdentity[]
/** 度量面源码读取（默认 HEAD 提交态；`{ atHead: false }` 量工作树）——扫面与 check-guards 同源 */
export declare function readIdentitySources(root?: string, options?: { atHead?: boolean }): { file: string; content: string; source: 'HEAD' | 'worktree' | 'worktree-fallback' }[]
export declare function reportIdentity(root?: string, options?: { atHead?: boolean }): IdentityReport
export declare function formatMarkdown(report: IdentityReport): string
