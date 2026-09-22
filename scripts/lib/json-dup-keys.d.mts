/** scripts/lib/json-dup-keys.mjs 的类型声明（供 vitest/TS 消费，先例：teammate-buff-controls.d.mts） */

/** 不参与扫描的目录（生成产物 / 依赖 / 版本库 / 工作状态） */
export declare const JSON_DUP_SKIP_DIRS: Set<string>
/** 反空洞下限：扫描面小于此数 ⇒「零命中」不可采信 */
export declare const JSON_DUP_SCAN_MIN_FILES: number

export interface JsonDupKeyHit {
  /** 重复出现的键名 */
  key: string
  /** 该对象在文件里的 JSON 指针路径（根对象为空串） */
  path: string
  /** 后一次出现的行号（1-based） */
  line: number
  /** 首次出现的行号（1-based） */
  firstLine: number
}

export interface JsonDupScanReport {
  /** 扫描到的 .json 文件数 */
  scanned: number
  /** 重复键命中（含文件路径） */
  duplicates: (JsonDupKeyHit & { file: string })[]
  /** detector 判别性自证结果 */
  selfTest: { ok: boolean; failures: string[] }
  /** 扫描面是否低于反空洞下限 */
  belowFloor: boolean
  /** 综合判定 */
  ok: boolean
}

/** 路径感知重复键扫描（最小 JSON 分词器，零依赖） */
export declare function findDuplicateKeys(text: string): JsonDupKeyHit[]
/** 递归收集仓库内全部 .json（跳过 JSON_DUP_SKIP_DIRS 与隐藏目录） */
export declare function listJsonFiles(root: string): string[]
/** detector 判别性自证：同对象重复必报 / 不同对象同名必不报 / 嵌套内层必报 */
export declare function detectorSelfTest(): { ok: boolean; failures: string[] }
/** 全库扫描（判据 21 的实现面） */
export declare function scanJsonDupKeys(root: string): JsonDupScanReport
/** 把报告渲染成 check-guards 的 detail 行 */
export declare function formatJsonDupKeys(report: JsonDupScanReport): string[]
