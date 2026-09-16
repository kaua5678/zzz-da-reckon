/**
 * 判据 17「压缩数组槽位索引」测试（2026-09-16 round 9）。
 *
 *  ① detector 单测（构造 fixture，**可红性自证**）：
 *     「槽位表达式作下标」必须报；安全的四种写法（`find(slot===)` / `panelAt` / 整数组消费者 /
 *     循环下标 `i`）必须**不报**——这一对是判据的核心 discriminating pair
 *     （少一半就是漏报，多一半就是误报，两种都会让判据被绕过或被人为关闭）。
 *  ② 仓库级：真实仓库当前违规 = 0，且**豁免清单逐条有效**（豁免的文件/数组/键确实还在用那种写法；
 *     代码改了而豁免没销号 ⇒ 说明清单在腐烂，点名）。
 *
 * 立项依据 = 本类缺陷实测的三档后果（详见 `scripts/lib/compacted-slot-index.mjs` 头注释）：
 * 静默错值（艾莲影画4 冻结 4→0 / 回能 16→0）、跨角色污染（格雷丝写进队友 cfg）、
 * 硬崩（奥菲丝/薇薇安/蕾米埃尔在「槽0 空 + 该角色在槽2」时抛 TypeError）。
 * 而它**此前在测试网里零覆盖**：105 预设全满槽、5758 条归档 slots=[1,2,3]、
 * 312 个 setupHarness 用例里前导/中间空槽 0 例。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// @ts-expect-error -- scripts/lib 纯 JS 工具模块（与 dead-channel-ls / scoped-style-reach 同处理）
import * as idxNs from '../../../scripts/lib/compacted-slot-index.mjs'

interface Violation { file: string; line: number; array: string; key: string; text: string }
interface ScanResult { violations: Violation[]; scanned: number }

const mod = idxNs as {
  scanCompactedSlotIndex: (root: string) => ScanResult
  COMPACTED_ARRAYS: string[]
  IDX_SAFE_ALLOWLIST: { file: string; array: string; key: string; reason: string }[]
}

let tmpRoots: string[] = []
afterEach(() => {
  for (const r of tmpRoots) rmSync(r, { recursive: true, force: true })
  tmpRoots = []
})

/** 造一个最小仓库：把 src/<name>.ts 写成给定内容 */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'compacted-'))
  tmpRoots.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, content, 'utf8')
  }
  return root
}

const scan = (files: Record<string, string>) => mod.scanCompactedSlotIndex(fixture(files))

describe('scanCompactedSlotIndex：核心 discriminating pair', () => {
  it('★ 槽位表达式作下标 ⇒ 报（四个数组都覆盖）', () => {
    for (const arr of mod.COMPACTED_ARRAYS) {
      const r = scan({ 'src/a.ts': `export const x = (${arr}: any[], slot: number) => ${arr}[slot]\n` })
      expect(r.violations.map(v => `${v.array}[${v.key}]`), `${arr}[slot] 未被拦下`).toEqual([`${arr}[slot]`])
    }
  })

  it('★ 变体形态逐一拦下：input.slot / row.slot / c.slot / 具名槽位变量', () => {
    // 注意：判据按**数组名**匹配，故 fixture 必须用真实的四个数组名（`ps`/`cs` 之类不会被判——
    // 这也正是「宁漏不误伤」的体现：判据不认识别名）。
    const r = scan({
      'src/a.ts': [
        'export const f = (input: any) => input.characters[input.slot]',
        'export const g = (row: any, panels: any[]) => panels[row.slot]',
        'export const h = (characters: any[], c: any) => characters[c.slot]',
        'export const i = (damagePanels: any[], banyueSlot: number) => damagePanels[banyueSlot]',
        'export const j = (panels: any[], windSlot: number) => panels[windSlot]',
        'export const k = (remielleEntryPanels: any[], remielleSlot: number) => remielleEntryPanels[remielleSlot]',
      ].join('\n') + '\n',
    })
    expect(r.violations.map(v => `${v.array}[${v.key}]`)).toEqual([
      'characters[input.slot]', 'panels[row.slot]', 'characters[c.slot]',
      'damagePanels[banyueSlot]', 'panels[windSlot]', 'remielleEntryPanels[remielleSlot]',
    ])
  })

  it('★ 安全写法一个都不报（find 按身份 / panelAt / 循环下标 / 整数组消费者）', () => {
    const r = scan({
      'src/a.ts': [
        'export const f = (cs: any[], slot: number) => cs.find(c => c.slot === slot)',
        'export const g = (ps: any[], slot: number) => panelAt(ps, slot)',
        'export const h = (cs: any[]) => { for (let i = 0; i < cs.length; i++) use(cs[i]) }',
        'export const k = (cs: any[]) => cs.map(c => c.slot)',
        'export const m = (ps: any[]) => ps.reduce((s, p) => s + p.atk, 0)',
        'export const n = (ps: any[], slot: number) => ps.some(p => p.slot === slot)',
      ].join('\n') + '\n',
    })
    expect(r.violations).toEqual([])
  })

  it('评论行不报（口径/文档里写 `characters[slot]` 是指出缺陷，不是在犯）', () => {
    const r = scan({
      'src/a.ts': [
        '// ⚠ 不要写 characters[slot]（压缩数组，槽位号 ≠ 下标）',
        '/* panels[slot] 同款问题 */',
        ' * damagePanels[slot]',
      ].join('\n') + '\n',
    })
    expect(r.violations).toEqual([])
  })

  it('测试文件不扫（测试里按下标手工构造密集数组是合法的）', () => {
    const r = scan({
      'src/__tests__/a.test.ts': 'export const x = (cs: any[], slot: number) => cs[slot]\n',
    })
    expect(r.violations).toEqual([])
  })

  it('纯数字下标不报（`arr[0]` 是显式索引语义，不是槽位）', () => {
    const r = scan({ 'src/a.ts': 'export const x = (cs: any[]) => cs[0]\n' })
    expect(r.violations).toEqual([])
  })
})

describe('仓库级（真实扫描）', () => {
  it('★ 当前仓库违规 = 0（round 9 已清 59 处）', () => {
    const r = mod.scanCompactedSlotIndex(process.cwd())
    expect(r.violations.map(v => `${v.file}:${v.line} ${v.array}[${v.key}]`)).toEqual([])
  })

  it('★ 豁免清单逐条仍然有效（防「代码改了豁免没销号」⇒ 清单腐烂后变成永久豁免）', () => {
    const { readFileSync, existsSync } = require('node:fs') as typeof import('node:fs')
    for (const a of mod.IDX_SAFE_ALLOWLIST) {
      expect(existsSync(join(process.cwd(), a.file)), `豁免指向的文件已不存在：${a.file}`).toBe(true)
      const src = readFileSync(join(process.cwd(), a.file), 'utf8')
      // 该写法必须仍然存在（否则豁免该删）；且豁免必须写明理由（防止变成橡皮图章）
      expect(
        src.includes(`${a.array}[${a.key}]`),
        `豁免失效：${a.file} 里已无 ${a.array}[${a.key}] ⇒ 从 IDX_SAFE_ALLOWLIST 删掉这一条`,
      ).toBe(true)
      expect(a.reason.length, `豁免缺理由：${a.file} ${a.array}[${a.key}]`).toBeGreaterThan(20)
    }
  })
})
