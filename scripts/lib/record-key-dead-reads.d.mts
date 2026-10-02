/** scripts/lib/record-key-dead-reads.mjs 的类型声明（供 vitest/TS 消费，先例：json-dup-keys.d.mts） */

export declare const RECORD_KEY_MIN_SCANNED_FILES: number

export interface RecordKeyDeadRead {
  /** 只被当作记录读取、别处零出现的键 */
  key: string
  /** 读取位置 `相对路径:行号` */
  sites: string[]
}

export interface RecordKeyDeadReadReport {
  scanned: number
  reads: number
  dead: RecordKeyDeadRead[]
  fresh: RecordKeyDeadRead[]
  staleAllow: string[]
  selfTest: { ok: boolean; failures: string[] }
  belowFloor: boolean
  ok: boolean
}

export declare function maskSource(text: string, opts: { strings: boolean }): string
export declare function findRecordKeyDeadReads(texts: Map<string, string>): { reads: number; dead: RecordKeyDeadRead[] }
export declare function detectorSelfTest(): { ok: boolean; failures: string[] }
export declare function scanRecordKeyDeadReads(root: string, allowlist?: Record<string, string>): RecordKeyDeadReadReport
export declare function formatRecordKeyDeadReads(report: RecordKeyDeadReadReport): string[]
