/** scripts/zc-where.mjs 的类型声明（供 vitest 消费，先例：zc.d.mts / zc-brief.d.mts） */

export declare function normPath(p: string): string
export declare function mentionsPath(text: string, target: string): boolean
export declare function anchorHits(anchorPath: string, target: string): boolean
export declare function firstHeaderComment(rel: string, root?: string): string | null

export interface WhereTreeRow { task: string; read: string; edit: string; at: string }
export interface WhereFact { fact: string; at: string }

export interface Where {
  target: string
  /** 目标解析不到（文件不存在）= null，且 tree/facts/sourced/header 全空（不猜路径，规则 15） */
  resolved: string | null
  tree: WhereTreeRow[]
  facts: WhereFact[]
  sourced: WhereFact[]
  header: string | null
  counts: { tree: number; facts: number; sourced: number }
}
export declare function buildWhere(target: string, opts?: { root?: string }): Where
