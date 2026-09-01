/** scripts/zc-brief.mjs 的类型声明（供 vitest 消费） */

export interface CjkTokens { latin: string[]; grams: string[] }
export declare function cjkTokens(text: unknown): CjkTokens
export declare function scoreText(query: string, text: string): number
export declare function hasStrongOverlap(query: string, text: string): boolean

export interface MarkdownTable {
  header: string[]
  rows: { cells: string[]; line: number }[]
  startLine: number
}
export declare function parseMarkdownTables(md: string): MarkdownTable[]

export interface NumberedItem { n: number; title: string; body: string; line: number }
export declare function parseNumberedItems(md: string, fromLine?: number): NumberedItem[]
export declare function findHeadingLine(md: string, re: RegExp): number
export declare function inferTier(query: string): 'fast' | 'full' | 'loop'

export interface BriefEntities { agentIds: string[]; moveIds: string[]; settings: string[]; paths: string[] }
export declare function extractEntities(query: string): BriefEntities

export interface Brief {
  query: string
  tier: string
  entities: BriefEntities
  rules: { n: number; title: string; at: string; score: number }[]
  where: { task: string; to: string; at: string; score: number }[]
  pits: { n: number; title: string; at: string; score: number }[]
  causes: { cause: string; symptom: string; at: string; score: number }[]
  counts: { rules: number; tasks: number; pits: number; causes: number }
}
export declare function buildBrief(query: string, opts?: { root?: string; topN?: number; tier?: string }): Brief
