/**
 * spec JSON 的「只作文档」字段——**构建期剥离**（2026-10-27 首屏体积专项）。
 *
 * ## 为什么
 *
 * `src/specs/agents/*.json` 被 `src/specs/registry.ts` 以 `import.meta.glob(eager)` 打进**首屏入口
 * chunk**。2026-10-27 实测：65 个文件在入口里占 16.5%（361.6 KB raw / 234.9 KB gz），其中 `notes`
 * 一项就 195 KB raw —— 占 spec 数据 60%，全库 gz 里 110 KB（入口 JS gzip 的 21%）。
 *
 * 而 `notes` 在**生产运行时零读取**：
 *   · 原唯一消费点 `specs/mechanics.ts#specToMechanicModule` 的 `description: spec.notes.join('；')`
 *     是**死写**（`AgentMechanicModule.description` 全仓无读取方），已随本专项删除；
 *   · 真正在用 `notes` 的全是**读盘**的工具/测试：`scripts/resolve.mjs`、`spec-coverage`、
 *     `import-specs`、`enrich-nanoka-missing`、`beta-snapshot`、`src/specs/__tests__/specs.test.ts`。
 *
 * ## 纪律
 *
 * **JSON 文件本身一个字节都不动**。`notes` 是录入证据契约（人类核对原文的落点）与 `check-guards`
 * 的技术债标记扫描面（口径：标记只扫源文件，源文件不动），只从**打进浏览器的模块**里消失：
 *   · 构建（`vite build`）⇒ 插件 `apply: 'build'` 生效 ⇒ 运行时无 notes；
 *   · 测试（vitest 跑的是 Vite 的 serve 变换）⇒ 插件不生效 ⇒ 测试仍看到完整数据，
 *     所以 `specs.test.ts` 的「每角色 notes ≥ 10 条」完整性判据照旧有效。
 *
 * ## 判据
 *
 * `src/scripts/__tests__/specDocFields.test.ts`：①剥键后运行时形状与 `AgentMechanicSpec` 相容且
 * notes 确实消失 ②生产源码里零 `spec.notes` 读取 ③反空洞（全库 notes 总量下限，防被整体清空）。
 *
 * ⚠ 若将来某字段真的有了运行时消费者，**不能**只把它从下表的注释里删掉——数据在浏览器里是缺的，
 * 测试却看得见，会变成「测试绿、线上炸」。正确做法：先加回字段再谈优化。
 */

/** 构建期从 spec 模块里剥掉的字段（当前只有 `notes`：占收益 98.5%，其余文档字段合计仅 1.7 KB gz，不值一次类型放宽）。 */
export const STRIPPED_SPEC_FIELDS = ['notes']

/**
 * 把一份 spec JSON 文本剥成运行时形态。纯函数：不读盘、不改原文件。
 *
 * @param {string} jsonText 原始 JSON 文本
 * @returns {string} 剥掉 {@link STRIPPED_SPEC_FIELDS} 后的 JSON 文本
 */
export function stripSpecDocFields(jsonText) {
  const spec = JSON.parse(jsonText)
  for (const key of STRIPPED_SPEC_FIELDS) delete spec[key]
  return JSON.stringify(spec)
}
