/**
 * 死通道 LanguageService 版判据（判据 14 的精粒度补充）双层测试：
 *  ① detector 单测：/tmp 构造源码，验证「零写入 → 报 / 有写入 → 不报 / namesake 同名写入 → 不报（O2 反误报闸门）」；
 *  ② 仓库级棘轮：真实仓库实测死集合 ⊆ `DEAD_CHANNEL_LS_BASELINE`（新增即红；基线过期只打印提示）。
 * 可红性自证：③ 用构造输入证明「不在基线里的新死通道会被 diffAgainstBaseline 判 fresh（= 真实红路径）」。
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

// @ts-expect-error -- scripts/lib 纯 JS 工具模块（本任务硬约束：不为它新建手写 .d.mts；若将来补了声明，本行会以「未使用的 expect-error」变红，届时删除即可）
import * as deadChannelLsNs from '../../../scripts/lib/dead-channel-ls.mjs'

/** 局部最小类型（模块无声明文件；保持与 dead-channel-ls.mjs 返回结构一致） */
interface DeadHit {
  key: string
  file: string
  line: number
  prop: string
  container: string
  reads: number
  confidence: 'dead-both' | 'dead-input'
  evidence: string
}
interface ScanResult { dead: DeadHit[]; candidates: number; ms: number }
interface BaselineEntry { since: string; why: string }

const impl = deadChannelLsNs as {
  scanDeadChannelsLs: (opts?: { root?: string; dirs?: string[] }) => ScanResult
  diffAgainstBaseline: (dead: DeadHit[], baseline?: Record<string, BaselineEntry>) => { fresh: DeadHit[]; resolved: string[] }
  DEAD_CHANNEL_LS_BASELINE: Record<string, BaselineEntry>
}
const { scanDeadChannelsLs, diffAgainstBaseline, DEAD_CHANNEL_LS_BASELINE } = impl

const roots: string[] = []
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dead-ls-'))
  roots.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  return root
}
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

describe('dead-channel-ls detector（构造源码单测）', () => {
  it('① 导出 interface 可选属性：零写入 + 有读取（?? 默认）→ 报 dead-input', () => {
    const root = fixture({
      'src/opts.ts': `export interface Opts { neverPassed?: number }\nexport function run(o: Opts): number { return o.neverPassed ?? 7 }\n`,
      'src/caller.ts': `import { run } from './opts'\nexport const v = run({})\n`,
    })
    const { dead } = scanDeadChannelsLs({ root, dirs: ['src'] })
    expect(dead.map(d => d.prop)).toEqual(['neverPassed'])
    expect(dead[0].confidence).toBe('dead-input')
    expect(dead[0].reads).toBeGreaterThan(0)
  })

  it('② 零写入 + 零读取 → 报 dead-both', () => {
    const root = fixture({
      'src/opts.ts': `export interface Opts { ghostSlot?: string }\nexport const optsShape = 1\n`,
    })
    const { dead } = scanDeadChannelsLs({ root, dirs: ['src'] })
    expect(dead.map(d => `${d.prop}:${d.confidence}`)).toEqual(['ghostSlot:dead-both'])
  })

  it('③ 有写入点（另一模块对象字面量传入）→ 不报', () => {
    const root = fixture({
      'src/opts.ts': `export interface Opts { realKnob?: number }\nexport function run(o: Opts): number { return o.realKnob ?? 7 }\n`,
      'src/caller.ts': `import { run } from './opts'\nexport const v = run({ realKnob: 3 })\n`,
    })
    const { dead } = scanDeadChannelsLs({ root, dirs: ['src'] })
    expect(dead).toEqual([])
  })

  it('④ namesake 反例（O2 盲区）：同名字段在另一模块/另一类型被写 → 保守压制不报', () => {
    // ⚠ 字段名用仓库里不存在的 `resistX`：若写成真实字段名（如抗性字段），本测试文件里的
    // fixture 源码字符串会被 check-guards 判据 14 的**按名正则**当成真实读写点（实测踩过：
    // runArchiveImport 归档 DTO 的抗性字段豁免条目被误判「过期」而红）。namesake 语义由
    // fixture 虚拟仓库内部的两处同名声明保证，不依赖真实字段名。
    const root = fixture({
      'src/opts.ts': `export interface Opts { resistX?: Record<string, number> }\nexport function run(o: Opts): number { return Object.keys(o.resistX ?? {}).length }\n`,
      // 同名但完全无关的类型与写入（模拟归档 DTO ↔ EnemyConfig 的同名字段撞车）
      'src/other.ts': `export interface EnemyCfg { resistX: Record<string, number> }\nexport const enemy: EnemyCfg = { resistX: {} }\n`,
    })
    const { dead } = scanDeadChannelsLs({ root, dirs: ['src'] })
    expect(dead).toEqual([])
  })

  it('⑤ 导出函数内联 opts 形参：可选属性零传入 → 报（正则版判据 14 的盲区面）', () => {
    const root = fixture({
      'src/inline.ts': `export function climb(opts: { base?: number; steps: number }): number { return (opts.base ?? 1) + opts.steps }\n`,
      'src/caller.ts': `import { climb } from './inline'\nexport const v = climb({ steps: 2 })\n`,
    })
    const { dead } = scanDeadChannelsLs({ root, dirs: ['src'] })
    expect(dead.map(d => d.prop)).toEqual(['base'])
  })

  it('⑥ .vue 里的同名写入（TS program 看不见）→ 文本兜底压制不报', () => {
    const root = fixture({
      'src/opts.ts': `export interface Opts { vueFed?: number }\nexport function run(o: Opts): number { return o.vueFed ?? 0 }\n`,
      'src/Page.vue': `<script setup lang="ts">\nconst o = {\n  vueFed: 5,\n}\n</script>\n`,
    })
    const { dead } = scanDeadChannelsLs({ root, dirs: ['src'] })
    expect(dead).toEqual([])
  })
})

describe('dead-channel-ls 棘轮（仓库级现状断言）', () => {
  it('⑦ 实测死集合 ⊆ 冻结基线（新增即红；基线过期只提示不红）', () => {
    const { dead, candidates, ms } = scanDeadChannelsLs()
    const { fresh, resolved } = diffAgainstBaseline(dead)
    // 供人读的现状快照（vitest 输出里能看到候选面与耗时）
    expect(candidates).toBeGreaterThan(0)
    expect(ms).toBeLessThan(60_000)
    if (resolved.length > 0) {
      // 改善项：下任从 DEAD_CHANNEL_LS_BASELINE 删掉（棘轮只减不增）
      console.log('[dead-channel-ls] 基线已过期（实测不再命中，可销账）：', resolved)
    }
    expect(
      fresh.map(f => `${f.key} — ${f.evidence}`),
      `发现基线外的新死通道：接上消费点或（确认死）在 DEAD_CHANNEL_LS_BASELINE 登记（since+why 证据）`,
    ).toEqual([])
  })

  it('⑧ 可红性自证：不在基线里的新死通道会被判 fresh（= 真实红路径）', () => {
    const root = fixture({
      'src/opts.ts': `export interface Opts { brandNewDeadKnob?: number }\nexport function run(o: Opts): number { return o.brandNewDeadKnob ?? 1 }\n`,
    })
    const { dead } = scanDeadChannelsLs({ root, dirs: ['src'] })
    expect(dead.map(d => d.prop)).toContain('brandNewDeadKnob')
    const { fresh } = diffAgainstBaseline(dead, DEAD_CHANNEL_LS_BASELINE)
    expect(fresh.map(f => f.prop)).toContain('brandNewDeadKnob')
  })
})
