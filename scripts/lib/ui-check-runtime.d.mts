/**
 * `scripts/lib/ui-check-runtime.mjs` 的类型声明（供 vitest/TS 消费，先例：recording.d.mts /
 * teammate-buff-controls.d.mts）。
 *
 * ⚠ 与 `.mjs` 的运行时导出必须一一对应：`check-guards` 判据 14-C（scanDtsDrift）会对账
 * 「手写声明 ↔ 运行时导出」，多一个或少一个都红（防声明漂移成死数据）。
 */

/** 通用脚本步里的动作类动词（`--step <verb>:...`） */
export declare const STEP_ACTION_VERBS: string[]
/** 固定 flags 里的动作类动词（`--tab` / `--click` / … / `--main-c`） */
export declare const FIXED_ACTION_FLAGS: string[]
/** 动作类动词全集 */
export declare const ACTION_VERBS: string[]
/** 固定动作 flag 清单（与 FIXED_ACTION_FLAGS 同源） */
export declare const ACTION_FLAGS: string[]
/** `wait:` —— 等状态，允许回落到页面文本包含 */
export declare const PAGE_WAIT_VERBS: string[]
/** `eval:` —— 诊断读回，false/null 是合法值 */
export declare const DIAGNOSTIC_VERBS: string[]
/** `sleep:` —— 纯等待 */
export declare const PASSIVE_VERBS: string[]

/** 动作结果：命中 `{ok:true}`，未命中 `{ok:false, reason}` */
export interface ActionProbe {
  ok: boolean
  reason?: string
  found?: boolean
  disabled?: string
  hidden?: string
  activated?: boolean
  alreadyActive?: boolean
  label?: string
  ms?: number
  x?: number
  y?: number
  inView?: boolean
  tag?: string
}

/** 产物路径（通过轮沿用既有文件名，失败轮用专用名） */
export interface ArtifactNames { status: 'pass' | 'fail'; report: string; shot: string }

/** 动词分类：action / page-wait / diagnostic / passive / unknown */
export declare function classifyAction(verb: string): 'action' | 'page-wait' | 'diagnostic' | 'passive' | 'unknown'
/** 动作结果 → 失败原因（null = 命中） */
export declare function actionFailure(verb: string, result: unknown): string | null
/** 失败清单 → 退出码 */
export declare function exitCodeFor(failures: string[]): number
/** 动作结果 → 失败清单（命中返回 []） */
export declare function collectFailures(verb: string, result: unknown): string[]
/** FAIL 打印块（沿用既有格式） */
export declare function failureBlock(failures: string[]): string
/** 本轮标识（文件名安全的 ISO 时间戳） */
export declare function roundId(date?: Date): string
/** 产物路径 */
export declare function artifactNames(outDir: string, status: 'pass' | 'fail'): ArtifactNames
/** 上一轮产物的过期改名目标 */
export declare function staleNames(outDir: string): { report: string; shot: string }

/** 元素不可见原因（可见返回 null） */
export declare function inPageHidden(el: unknown): string | null
/** 元素禁用原因（可点返回 null） */
export declare function inPageDisabled(el: unknown): string | null
/** 元素文本短标签 */
export declare function inPageLabel(el: unknown): string
/** 页内点击 + 命中判定 */
export declare function performClick(sel: string, text: string, inner?: boolean, expectActivate?: boolean): Promise<ActionProbe>
/** 真实鼠标点击目标探测（含 scrollIntoView / 禁用 / 可见 / 视口判定） */
export declare function probeRealClickTarget(el: unknown): ActionProbe
/** `type:` 的前置判定（必须有非 body 的聚焦元素） */
export declare function probeFocusTarget(): ActionProbe
/** 当前真正可见的下拉菜单里的选项 */
export declare function visibleMenuOptions(): unknown[]
/** 把页内函数包装成可在浏览器里求值的表达式 */
export declare function inPageCall(fn: (...args: any[]) => any, ...args: unknown[]): string
/** 同上，形参是元素表达式 */
export declare function inPageElementCall(findExpr: string, probe?: (el: unknown) => ActionProbe, extra?: ((...args: any[]) => any)[]): string
/** 真鼠标点击（CDP Input.dispatchMouseEvent） */
export declare function realMouseClick(
  send: (method: string, params?: Record<string, unknown>) => Promise<any>,
  findExpr: string,
  probe?: (el: unknown) => ActionProbe,
  extra?: ((...args: any[]) => any)[],
): Promise<ActionProbe>
