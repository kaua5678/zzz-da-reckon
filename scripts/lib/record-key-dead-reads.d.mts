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
  /**
   * `git ls-files` 有、磁盘上没有的文件（rm 未 add）。
   * 已从扫描面剔除并**显式报告**——不能静默当成空文件，否则「文件消失 ⇒ 命中变少 ⇒ 棘轮变绿」
   * 会伪装成进步（2026-10-20 实测：删文件后 check-guards 直接 ENOENT 崩掉）。
   */
  missing: string[]
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
