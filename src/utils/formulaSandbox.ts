/**
 * 用户 / spec 公式字符串的**唯一**沙箱求值器（CC-504，r686）。
 *
 * 此前两份：`core/buff.ts#evalFormulaExpression`（spec `formula` 通道，变量 x/s/p）与
 * `composables/teamCompare.ts#evalDifficultyFormula`（难度公式，变量 c/w/r/k），注释互指「同款沙箱」——
 * 字符白名单、`Function` 注入方式、helper 名单各抄一份，谁加了 `pow` 另一边不知道。
 *
 * 口径：
 *  - 白名单 `[0-9+\-*\/().,\s_a-zA-Z]`：挡住属性访问以外的逃逸面（反引号 / `=` / `[]` / `;` / 引号都不许）；
 *    `.` 后跟字母虽放行，但沙箱里没有任何对象可及（只有数字入参与 helper 函数）。
 *  - helper 统一为 `clamp / floor / max / min / pow / abs / sqrt`（`pow` 必须有：JS 无 `^`）。
 *  - 不合法 / 求值抛错 ⇒ `ok: false`；合法 ⇒ 原样返回结果（可能非有限），**是否接受非有限由调用方定**
 *    （buff 通道历史上原样返回，难度公式历史上退化为 `c*w`）。
 */
const HELPERS = {
  clamp: (v: number, min: number, max: number) => Math.min(Math.max(v, min), max),
  floor: Math.floor,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  abs: Math.abs,
  sqrt: Math.sqrt,
} as const
const HELPER_NAMES = Object.keys(HELPERS)
const HELPER_FNS = Object.values(HELPERS)
const SAFE_EXPRESSION = /^[0-9+\-*/().,\s_a-zA-Z]+$/

export type SandboxResult = { ok: true; value: number } | { ok: false }

export function evalSandboxedFormula(expression: string, vars: Readonly<Record<string, number>>): SandboxResult {
  const expr = expression.trim()
  if (expr === '' || !SAFE_EXPRESSION.test(expr)) return { ok: false }
  try {
    const value = Function(...Object.keys(vars), ...HELPER_NAMES, `return (${expr})`)(
      ...Object.values(vars), ...HELPER_FNS,
    ) as number
    return { ok: true, value }
  } catch {
    return { ok: false }
  }
}
