/**
 * `solveTeam` 抽离的**纯度锁**（CC-10，2026-09-25）。
 *
 * 抽离 `computeCalcOutput` 的意义 = 外层不动点 + S3 可行化决策**可脱 Vue 调用**
 * （自由对比 / 时间图表 / 选第三人不必「写 store → 读 computed」绕一圈，见
 * `docs/ARCHITECTURE.md` §3「引擎没有单角色求值入口」）。
 *
 * 这个意义唯一可能被悄悄破坏的方式 = 后续有人往 `solveTeam.ts` 里塞回 `vue` / `pinia` /
 * `@/stores/*` 或反向 import `useResourceCalc`——类型检查与既有行为测试**都看不见**这种回归
 * （`import { computed }` 语法完全合法）。故用源码扫描把契约钉死：
 *  ① 值导入面**不含** `vue` / `pinia` / `@/stores/` / `useResourceCalc`（含 `import type`）；
 *  ② 反向依赖也不许出现（`solveTeam.ts` 不得 import 编排入口）；
 *  ③ 反空洞：文件确实存在、确实导出 `solveTeam`、确实 import 了同目录纯函数
 *    （防「把文件清空/改名 ⇒ 扫描器无对象可扫 ⇒ 假绿」）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const SOLVE_TEAM_PATH = new URL('../resourceCalc/solveTeam.ts', import.meta.url)
const source = readFileSync(SOLVE_TEAM_PATH, 'utf8')

/** 从源码里抽出所有 import/export 说明符（含 `import type`、`export … from`、动态 import）。 */
function importSpecifiers(src: string): string[] {
  const out: string[] = []
  const re = /(?:^|\n)\s*(?:import|export)\b[^\n]*?\bfrom\s*['"]([^'"]+)['"]/g
  for (const m of src.matchAll(re)) out.push(m[1])
  // 动态 import('…') / import("…")
  const dyn = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const m of src.matchAll(dyn)) out.push(m[1])
  return out
}

describe('CC-10 solveTeam 纯度（Vue 无关契约）', () => {
  it('值导入面不含 vue / pinia / @/stores / useResourceCalc', () => {
    const specs = importSpecifiers(source)
    // 反空洞：至少要有 import，否则正则或文件出问题（下面另有更强的形状断言）
    expect(specs.length).toBeGreaterThan(0)
    const forbidden = specs.filter(s =>
      s === 'vue' || s === 'pinia'
      || s.startsWith('@/stores/') || s.startsWith('@/stores')
      || s.includes('useResourceCalc'))
    expect(forbidden, `solveTeam.ts 不得依赖 Vue 响应式层，实测命中 ${JSON.stringify(forbidden)}`).toEqual([])
  })

  it('反向依赖：不得 import 编排入口 useResourceCalc（防循环/回退）', () => {
    expect(source).not.toMatch(/from\s*['"][^'"]*useResourceCalc['"]/)
    expect(source).not.toMatch(/import\s*\(\s*['"][^'"]*useResourceCalc['"]\s*\)/)
  })

  it('形状锁：文件确实导出 solveTeam 且依赖同目录纯函数模块（反「清空即绿」）', () => {
    expect(source).toMatch(/export\s+function\s+solveTeam\s*\(/)
    expect(source).toMatch(/export\s+interface\s+SolveTeamInput\b/)
    expect(source).toMatch(/export\s+interface\s+SolveTeamResult\b/)
    const specs = importSpecifiers(source)
    // 同目录纯函数依赖（搬移后 solveTeam 自己承担这些 import）
    for (const dep of ['./roundThreads', './outerCycle', './feasibilitySearch']) {
      expect(specs, `solveTeam.ts 应依赖 ${dep}`).toContain(dep)
    }
    // 单轮工厂只允许 type-only（不引入 convergence 的运行时依赖）
    expect(source).toMatch(/import\s+type\s*\{[^}]*createRunCalcRound[^}]*\}\s*from\s*'\.\/convergence'/)
  })
})
