/** scripts/lib/docs-reading-tests.mjs 的类型声明（供 vitest/TS 消费，先例：json-dup-keys.d.mts） */

/** 不参与闭包扫描的目录（依赖 / 版本库 / 生成产物） */
export declare const DOCS_READING_SKIP_DIRS: Set<string>
/** 反空洞下限：清单条数小于此数 ⇒「清单仍有效」不可采信（T114 实测 34） */
export declare const DOCS_READING_MIN_TESTS: number
/** 反空洞下限：扫描面（src+scripts 源文件数）小于此数 ⇒ 扫描器失明（T114 实测 998） */
export declare const DOCS_READING_MIN_SCANNED: number
/** 「读 docs 的测试」显式清单（T114 @ 0b81c1df 派生，34 条；棘轮①要求逐字相等） */
export declare const DOCS_READING_TESTS: readonly string[]

export interface DocsReadingReport {
  /** 扫描到的源文件数（反空洞下限用） */
  scanned: number
  /** 派生出的「读 docs 的测试」集合（相对 root，已排序） */
  derived: string[]
  /** 仓库里读 docs 的源文件（非测试），棘轮③的口径面 */
  docsReaders: string[]
  /** 读 docs、被测试覆盖、却不在任何清单条目闭包里的源文件（应为空） */
  uncoveredReaders: string[]
  /** 清单里指向不存在文件的条目（应为空） */
  missing: string[]
  /** 清单条数/扫描面是否低于反空洞下限 */
  belowFloor: boolean
  /** 综合判定 */
  ok: boolean
}

/** 去块注释与行注释（避免把注释里提到的 `docs/` 当成真读者） */
export declare function stripComments(src: string): string
/** 递归列出根下源文件（跳过 DOCS_READING_SKIP_DIRS 与隐藏目录） */
export declare function listSourceFiles(root: string): string[]
/** 该文件是否命中「读 docs 信号」（去注释后判） */
export declare function readsDocs(src: string): boolean
/** 从源码抽本地 import 说明符（相对路径 / `@/` 别名 / `scripts/` 前缀） */
export declare function localImportSpecs(root: string, file: string, src: string): string[]
/** 探测一个无扩展名路径的真实落点 */
export declare function probeFile(base: string): string | null
/** 派生「读 docs 的测试」集合并与显式清单对账（棘轮的数据面；listed 可注入以做反证） */
export declare function scanDocsReadingTests(root: string, listed?: readonly string[]): DocsReadingReport
/** docs-only 判定器：`git diff --name-only` 输出全部落在 `docs/` 前缀内（空输入判 false） */
export declare function isDocsOnlyChange(nameOnlyOutput: string): boolean
/** 把报告渲染成 check-guards 风格的 detail 行 */
export declare function formatDocsReadingReport(r: DocsReadingReport): string[]
