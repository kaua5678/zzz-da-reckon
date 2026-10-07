/** scripts/lib/literal-assertion-gate.mjs 的类型声明（供 vitest/TS 消费，先例：id-literal-gate.d.mts） */
export declare const LITERAL_ASSERTION_SCAN_DIR: string
export declare const LITERAL_ASSERTION_BASELINE: number
export declare const LITERAL_ASSERTION_MIN_FILES: number
export interface LiteralAssertionHit { line: number; kind: string; type: string; text: string }
export interface LiteralAssertionSite extends LiteralAssertionHit { file: string }
export interface LiteralAssertionReport {
  count: number
  sites: LiteralAssertionSite[]
  scanned: number
  selfTest: { ok: boolean; failures: string[] }
  belowFloor: boolean
  ok: boolean
}
export declare function findLiteralAssertions(text: string, fileName?: string): LiteralAssertionHit[]
export declare function literalAssertionSelfTest(): { ok: boolean; failures: string[] }
export declare function scanLiteralAssertions(root?: string): LiteralAssertionReport
export declare function formatLiteralAssertions(report: LiteralAssertionReport): string[]
