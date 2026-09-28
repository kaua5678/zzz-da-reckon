/**
 * CC-174（第 198 轮）：calcPanel 生产调用点的输入契约。
 *
 * 背景：calcPanel 的 config 可选字段漏传不会报类型错，会被缺省值静默兜底——CC-171（potentialLevel 漏传 ⇒ 面板恒为 6 潜）
 * 与 CC-172（来源面板不传 effectCoverageMap ⇒ 自身条件效果恒 100%）都是这么漏的。改成类型必填会让 25 处测试调用补噪音，
 * 所以只锁**生产**调用点：每处必须**显式写出** `potentialLevel` 与 `effectCoverageMap` 两个键（有意不传就写 `undefined` + 注释）。
 *
 * 新增生产调用点 ⇒ 本测试的 KNOWN 清单会失败：对照 `computePanelPhases` 的参数表逐项核对口径，再把文件加进清单。
 * 判据理由与普查表见 docs/mcp-stun-dual-source.md §24.18 / §24.20。
 */
import { describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const REQUIRED_KEYS = ['potentialLevel', 'effectCoverageMap'] as const
const KNOWN: Record<string, number> = {
  'src/composables/resourceCalc/panelPhases.ts': 2, // computePanelPhases、computeEntrySnapshotPanel
  'src/core/teammateBuffSource.ts': 1,              // 队友 buff 来源面板
  'src/core/substatOptimizer.ts': 1,                // 无副词条起点（输入由调用方给）
  'src/stores/config.ts': 1,                        // 整队贪心的队友估值（CC-173：允许不同源）
}

/** 从 `calcPanel(` 起按括号深度取到匹配的 `)`（跳过字符串 / 注释足够粗：调用实参里不含括号字符串） */
function callTexts(src: string): string[] {
  const out: string[] = []
  const re = /(?<![\w.])calcPanel\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 20), m.index)
    if (/function\s+$/.test(before)) continue // 定义本身
    let depth = 0
    let i = m.index + 'calcPanel'.length
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') { depth--; if (depth === 0) break }
    }
    out.push(src.slice(m.index, i + 1))
  }
  return out
}

describe('CC-174 calcPanel 生产调用点输入契约', () => {
  const files = execSync("git ls-files 'src/*.ts' 'src/*.vue'", { encoding: 'utf8' })
    .split('\n').filter(f => f && !/__tests__|\.test\.ts$|\.spec\.ts$|^src\/test\//.test(f))
  const found: Record<string, string[]> = {}
  for (const f of files) {
    let txt: string
    try { txt = readFileSync(f, 'utf8') } catch { continue } // 工作区已删、索引仍在
    const calls = callTexts(txt)
    if (calls.length) found[f] = calls
  }

  it('生产调用点清单 = KNOWN（新增调用点须先核对口径再登记）', () => {
    expect(Object.fromEntries(Object.entries(found).map(([f, c]) => [f, c.length]))).toEqual(KNOWN)
  })

  it('每个生产调用点都显式写出 potentialLevel 与 effectCoverageMap', () => {
    const missing: string[] = []
    for (const [f, calls] of Object.entries(found)) {
      calls.forEach((c, k) => {
        for (const key of REQUIRED_KEYS) if (!new RegExp(`\\b${key}\\b`).test(c)) missing.push(`${f}#${k + 1} 缺 ${key}`)
      })
    }
    expect(missing).toEqual([])
  })

  it('探测器自检：能抓到漏键、跳过函数定义', () => {
    const t = 'export function calcPanel(a) {}\nconst r = calcPanel(x, y, { cinemaLevel: 0, effectCoverageMap: m })\n'
    const c = callTexts(t)
    expect(c.length).toBe(1)
    expect(/\bpotentialLevel\b/.test(c[0]!)).toBe(false)
  })
})
