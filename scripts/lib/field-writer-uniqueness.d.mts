/** scripts/lib/field-writer-uniqueness.mjs 的类型声明（供 vitest/TS 消费，先例：id-literal-gate.d.mts） */
export declare const FIELD_WRITER_MIN_FILES: number
/** 写入形态（AST）：成员赋值 / 元素赋值 / 复合赋值 / 对象字面量 / 字面量简写 */
export type FieldWriteForm = 'property' | 'element' | 'compound' | 'literal' | 'literal-shorthand'
export interface FieldWriterRegistration {
  file: string
  since: string
  why: string
}
export interface SingleWriterField {
  field: string
  /** 引擎读点（人读锚；不参与匹配——行号会随重构漂移，匹配粒度是文件） */
  readers: string[]
  writers: FieldWriterRegistration[]
}
export declare const SINGLE_WRITER_FIELDS: SingleWriterField[]
export interface FieldWriteHit {
  line: number
  field: string
  form: FieldWriteForm
  /** 赋值左侧的接收者文本（红信息靠它分辨「自己那份 cfg」与「队友那份」）；对象字面量形态为空串 */
  receiver: string
  text: string
}
export interface FieldWriteSite extends FieldWriteHit { file: string }
export interface FieldWriterReport {
  sites: FieldWriteSite[]
  scanned: number
  selfTest: { ok: boolean; failures: string[] }
  belowFloor: boolean
  /** 未登记的声明方（新增声明方）——判红面 */
  extra: FieldWriteSite[]
  /** 登记了却没扫到写入点（字段改名 / 写入点搬家）——同样判红，防「零声明方」假绿 */
  missing: { field: string; file: string }[]
  byFile: Map<string, FieldWriteSite[]>
  ok: boolean
}
export declare function fieldWriteAt(
  node: import('typescript').Node,
  fields: Set<string> | string[],
  sf: import('typescript').SourceFile,
): { field: string; form: FieldWriteForm; receiver: string } | null
export declare function findFieldWrites(
  program: import('typescript').Program | null,
  opts?: { root?: string; isScanned?: (rel: string) => boolean; fields?: SingleWriterField[] },
): { sites: FieldWriteSite[]; scanned: number }
export declare function fieldWriterSelfTest(): { ok: boolean; failures: string[] }
export declare function scanFieldWriters(root?: string, fields?: SingleWriterField[]): FieldWriterReport
export declare function formatFieldWriters(report: FieldWriterReport): string[]
