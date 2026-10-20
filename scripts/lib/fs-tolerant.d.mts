/** scripts/lib/fs-tolerant.mjs 的类型声明（供 vitest/TS 消费，先例：record-key-dead-reads.d.mts） */

/**
 * 读文件；文件不存在时返回 `null` 而不是抛错。
 * 用于「git 索引 == 磁盘」假设不成立的窗口（rm 未 add）。
 */
export declare function readTextIfExists(absPath: string): string | null

/**
 * 批量读取。`texts`（存在的）+ `missing`（缺失的）互斥且并集 = 输入。
 */
export declare function readTextsTolerant(root: string, relPaths: readonly string[]): {
  texts: Map<string, string>
  missing: string[]
}
