/** scripts/lib/agent-identity-lines.mjs 的类型声明（供 vitest / TS 消费，先例：presetCategories.d.mts） */

/** 棘轮度量的三种身份形态 */
export declare const IDENTITY_FIELDS: string[]
/** 角色 agentId 形态（四位数字） */
export declare const CHARACTER_ID: RegExp

export declare function unwrapIdentityNode(node: unknown): unknown
export declare function identityFieldOf(node: unknown): string | null
export declare function identityAliasOf(node: unknown): string | null

export interface IdentityComparison {
  file: string
  line: number
  column: number
  field: string
  /** 比较另一侧的字面量；null = 动态值（`agentId`/`teammateBuffId` 形态下仍是身份判定） */
  identity: string | null
  text: string
}

export declare function identityComparison(node: unknown): { field: string; identity: string | null } | null
export declare function isNonCharacterIdComparison(node: unknown): boolean

export interface IdentityNodeHits {
  source: unknown
  identity: { node: unknown; field: string; identity: string | null }[]
  nonCharacter: { node: unknown; field: string; identity: string | null }[]
  aliases: { node: unknown; alias: string; identity: string }[]
}
/** 节点级命中（报告脚本要按 node 分类/追消费者）——与扁平化面同一 visitor */
export declare function scanIdentityNodes(content: string, file?: string): IdentityNodeHits
export declare function scanIdentitySurface(content: string, file?: string): {
  comparisons: IdentityComparison[]
  nonCharacter: IdentityComparison[]
}
/** 执行尺输入：角色身份判定 */
export declare function scanIdentityComparisons(content: string, file?: string): IdentityComparison[]
/** 观察项：非角色 `.id` 比较（moveId/dataId/overrideId/rowId 族）——不进任何度量 */
export declare function scanNonCharacterIdComparisons(content: string, file?: string): IdentityComparison[]
/** 执行尺：按「文件:行」去重的角色判定行数 */
export declare function countIdentityBranchLines(content: string): number
export declare function countIdentityBranchLinesInFiles(files: string[], read: (file: string) => string): number
