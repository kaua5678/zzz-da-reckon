/** scripts/check-tokens.mjs 的类型声明（供 vitest 消费，先例：check-guards.d.mts） */

export declare const ROOT: string
export declare const GLOBAL_CSS: string

// 文本解析
export declare function stripComments(text: string): string
export declare function extractStyleBlocks(
  source: string,
): { content: string; startLine: number }[]
export declare function extractTemplateSource(source: string): string
export declare function extractDeclarationRegions(css: string): string[]
export declare function countHardcodedColors(text: string): number
export declare function findVarRefs(text: string): string[]
export declare function findFontSizes(css: string): { value: string; num: number; unit: string }[]

// 令牌表
export declare function parseGlobalTokens(
  css: string,
): { root: Map<string, string>; light: Map<string, string> }

// 颜色计算
export interface Rgba { r: number; g: number; b: number; a: number }
/** 实现里对非字符串做了防御（typeof !== 'string' → null），声明同步放宽以便测试覆盖该分支 */
export declare function parseColor(input: string | null | undefined): Rgba | null
export declare function flatten(fg: Rgba, bg: Rgba): Rgba
export declare function relativeLuminance(c: Rgba): number
export declare function contrastRatio(fg: Rgba, bg: Rgba): number
export declare function resolveTokenColor(
  tokens: Map<string, string>,
  name: string,
  baseBg: Rgba | null,
): Rgba | null

// 扫描
export interface ScannedVue {
  path: string
  hardcoded: number
  fontOutliers: string[]
  varRefs: string[]
}
export declare function scanVueFiles(root: string, fontScale: number[]): ScannedVue[]

// 基线
export declare const HARDCODED_WHITELIST: string[]
export declare const HARDCODED_BASELINE: Record<string, number>
export declare const FONT_SCALE: number[]
export declare const FONT_SIZE_BASELINE: Record<string, number>
export declare const WA_REF_BASELINE: number
export declare const VAR_TOTAL_BASELINE: number

// 对比度判据
export declare const CONTRAST_TEXT_PAIRS: string[]
export declare const CONTRAST_TEXT_MIN: number
export declare const CONTRAST_CHART_PAIRS: string[]
export declare const CONTRAST_CHART_MIN: number

export interface TokenCheckResult {
  name: string
  ok: boolean
  detail: string[]
}
export interface TokenCheckStats {
  scanned: ScannedVue[]
  varTotal: number
  waRefs: number
  darkTokens: Map<string, string>
  lightTokens: Map<string, string>
}
export declare function runAllChecks(root?: string): {
  results: TokenCheckResult[]
  ok: boolean
  stats: TokenCheckStats
}
