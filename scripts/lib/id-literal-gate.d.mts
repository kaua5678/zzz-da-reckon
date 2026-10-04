/** scripts/lib/id-literal-gate.mjs 的类型声明（供 vitest/TS 消费，先例：record-key-dead-reads.d.mts） */
export declare const ID_LITERAL_SCAN_DIR: string
export declare const ID_HOME_DIRS: string[]
export declare const ID_LITERAL_BASELINE: number
export declare const ID_LITERAL_MIN_FILES: number
export declare const ID_LITERAL: RegExp
export interface IdLiteralHit { line: number; id: string; text: string }
export interface IdLiteralSite extends IdLiteralHit { file: string }
export interface IdLiteralReport {
  count: number
  sites: IdLiteralSite[]
  scanned: number
  selfTest: { ok: boolean; failures: string[] }
  belowFloor: boolean
  ok: boolean
}
export declare function stripComments(text: string): string
export declare function findIdLiterals(text: string): IdLiteralHit[]
export declare function detectorSelfTest(): { ok: boolean; failures: string[] }
export declare function scanIdLiterals(root?: string, homeDirs?: string[]): IdLiteralReport
export declare function formatIdLiterals(report: IdLiteralReport): string[]
