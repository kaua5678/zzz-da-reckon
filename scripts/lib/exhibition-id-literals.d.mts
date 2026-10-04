/** scripts/lib/exhibition-id-literals.mjs 的类型声明（供 vitest/TS 消费，先例：record-key-dead-reads.d.mts） */
export declare const EXHIBITION_ID_LITERAL_DIRS: string[]
export declare const EXHIBITION_ID_LITERAL_BASELINE: number
export declare const EXHIBITION_ID_LITERAL_MIN_FILES: number
export declare const ID_LITERAL: RegExp
export interface IdLiteralSite { file?: string; line: number; id: string; text: string }
export interface ExhibitionIdLiteralReport {
  count: number
  sites: IdLiteralSite[]
  scanned: number
  selfTest: { ok: boolean; failures: string[] }
  belowFloor: boolean
  ok: boolean
}
export declare function stripComments(text: string): string
export declare function findIdLiterals(text: string): IdLiteralSite[]
export declare function detectorSelfTest(): { ok: boolean; failures: string[] }
export declare function scanExhibitionIdLiterals(root?: string): ExhibitionIdLiteralReport
export declare function formatExhibitionIdLiterals(report: ExhibitionIdLiteralReport): string[]
