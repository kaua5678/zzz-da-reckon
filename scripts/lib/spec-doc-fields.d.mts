/** scripts/lib/spec-doc-fields.mjs 的类型声明（供 vite.config.ts 与 vitest 消费，先例：worker-cap.d.mts） */

/** 构建期从 spec 模块里剥掉的字段 */
export declare const STRIPPED_SPEC_FIELDS: readonly string[]

/**
 * 把一份 spec JSON 文本剥成运行时形态。纯函数：不读盘、不改原文件。
 *
 * @param jsonText 原始 JSON 文本
 */
export declare function stripSpecDocFields(jsonText: string): string
