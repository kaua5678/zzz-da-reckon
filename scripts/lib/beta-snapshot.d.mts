/** scripts/lib/beta-snapshot.mjs 的类型声明（供 vitest/TS 消费，先例：scripts/lib/presetCategories.d.mts） */

export interface BetaSnapshotMeta {
  agentId: string
  betaId: string
  tag: string
  sourceVersion: string
  gitTag: string
  createdAt: string
}

export interface BetaCatalogSlice {
  agent: any
  skills: any | null
  engines: any[]
  meta: BetaSnapshotMeta
}

export declare const BETA_ID_RE: RegExp
export declare const BETA_TAG_RE: RegExp
export declare function sliceCatalogFor(catalog: any, agentId: string): { agent: any; skills: any | null; engines: any[] } | null
export declare function rewriteAgentSlice(slice: any, agentId: string, tag: string, meta: BetaSnapshotMeta): BetaCatalogSlice
export declare function rewriteModuleSource(source: string, agentId: string, betaId: string): { source: string; replacements: number }
export declare function rewriteSpec(spec: any, agentId: string, tag: string, provenanceNote: string): any
export declare function mergeBetaFile(existing: any, entries: BetaCatalogSlice, meta: BetaSnapshotMeta): any
export declare function moduleBanner(opts: { sourceFile: string; betaId: string; sourceVersion: string; gitSha: string; createdAt: string }): string
export declare function findModuleFile(agentSources: Array<{ path: string; content: string }>, agentId: string): string[]
export declare function readJsonIfExists(readFile: any, path: string): any
