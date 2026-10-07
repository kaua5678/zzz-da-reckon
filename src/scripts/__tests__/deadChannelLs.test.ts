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

interface ExportHit { key: string; file: string; line: number; name: string; kind: string }
interface ShellHit { key: string; file: string; line: number; name: string; from: string }
interface ExportScanResult { dead: ExportHit[]; staleSeams: string[]; shells: ShellHit[]; staleEntries: string[]; exports: number; ms: number }

const impl = deadChannelLsNs as {
  scanDeadChannelsLs: (opts?: { root?: string; dirs?: string[] }) => ScanResult
  scanDeadExports: (opts?: { root?: string; seams?: Record<string, BaselineEntry>; entries?: Record<string, string> }) => ExportScanResult
  /** 泛型：两类 hit（DeadHit / ExportHit）都只要求有 `key`，别为第二类复制一份函数签名 */
  diffAgainstBaseline: <T extends { key: string }>(dead: T[], baseline?: Record<string, BaselineEntry>) => { fresh: T[]; resolved: string[] }
  DEAD_CHANNEL_LS_BASELINE: Record<string, BaselineEntry>
}
const { scanDeadChannelsLs, scanDeadExports, diffAgainstBaseline, DEAD_CHANNEL_LS_BASELINE } = impl

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

  /**
   * ⑨ 行号无关键（2026-09-15 修的真实假红）。
   *
   * 事故：两笔无关改动（自由对比工作台 + 爱丽丝剑仪）给 `src/types/resource/config.ts`
   * 各插了几行，把该文件里 9 条已冻结基线条目（roxy / claret / norma 系）的行号整体推后，
   * 而它们**一条都没变** —— 旧键 `<文件>:<行> <符号>` 含行号 ⇒ 判据当场假红 9 条。
   * 棘轮要拦的是「**新的**死字段」，不是「同一字段换了行号」。
   *
   * 本用例构造「同一字段、两种行号」的两个键，断言：
   *  ① 带行号的旧键与新键被归一到同一形状（normalizeBaseKey）；
   *  ② 只在基线里有「老写法」条目时，同字段换行号**不判 fresh**（不假红）；
   *  ③ 真·新字段仍然判 fresh（棘轮没被削弱 —— 这条防"为了不假红而把判据改松"）。
   */
  it('⑨ 行号无关键：同字段换行号不假红，真新字段仍红', () => {
    const base = { 'src/types/x.ts:100 oldDeadKnob': { since: '2026-09-15', why: 'fixture' } }
    /** 造一条完整的 DeadHit（字段与 scans/lib 返回结构一致，别用残缺对象糊过去） */
    const hit = (line: number, prop: string): DeadHit => ({
      key: `src/types/x.ts:${line} ${prop}`,
      file: 'src/types/x.ts',
      line,
      prop,
      container: 'CharacterOperationConfig',
      reads: 0,
      confidence: 'dead-both',
      evidence: 'fixture',
    })
    // 同字段、行号从 100 挪到 145（= 上游插了 45 行）
    const shifted = [hit(145, 'oldDeadKnob')]
    const { fresh, resolved } = diffAgainstBaseline(shifted, base)
    expect(fresh.map(f => f.prop), '同字段换行号不该判 fresh（这正是那次假红的形态）').toEqual([])
    expect(resolved, '同字段换行号也不该判 resolved（它没被销账）').toEqual([])
    // 棘轮未被削弱：真·新字段必须仍判 fresh
    const trulyNew = [...shifted, hit(200, 'brandNewKnob')]
    expect(diffAgainstBaseline(trulyNew, base).fresh.map(f => f.prop)).toEqual(['brandNewKnob'])
  })
})

/**
 * 死导出判据（r721 起：全 `src` 层 · 只认生产消费；取代 R33 的 core 限定 LS 版与 R34 的非 core 审计入口）。
 *
 * 立项链：R32 `core/damage.ts#calcDamage` 零调用者却「看着像主管线」⇒ R33 符号级死导出（只扫 core，测试引用算活）。
 * R33 自己记下的真实病灶却是「测试的 import 与符号名全都对，但那个符号是死的」（`damage.test.ts` 测死副本，
 * 活实现零测试）——测试引用算活的口径对它恒绿。r721 普查全 src：只被测试引用 21 + 零引用 5（R34 审计只报不红，
 * 自 09-18 起无人跑）。⇒ 测试侧引用不再算消费；扫面扩到全 src（.vue 解析 `<script>` 的 import）；
 * 例外只有必须与模块私有状态同处的测试接口（`DEAD_EXPORT_TEST_SEAMS`）。
 * r722：拆分 / 下沉留下的兼容壳（14 个门面 60 条转出）有生产消费、死导出口径抓不到 ⇒ 加转出口径：
 * 非入口文件的转出一律报红，入口白名单 `REEXPORT_ENTRY_FILES`。
 */
describe('dead-channel-ls 死导出（全 src · 只认生产消费）', () => {
  it('⑩ 零引用 / 只被测试引用 / 无人经由的转出别名 → 报；改名 import、命名空间解构与按值使用、同文件使用 → 不报；src/test 不进候选', () => {
    const root = fixture({
      'src/core/lib.ts': [
        `export function deadFn(): number { return 1 }`,
        `export function testOnlyFn(): number { return 2 }`,
        `export function aliasedFn(): number { return 3 }`,
        `export function viaNsFn(): number { return 4 }`,
        `function sameFileFn(): number { return 5 }`,
        `export { sameFileFn as exportedLocal }`,
        `export const useSame = (): number => sameFileFn()`,
        '',
      ].join('\n'),
      'src/core/barrel.ts': `export { aliasedFn as oldName } from './lib'\n`,
      'src/core/user.ts': [
        `import { aliasedFn as renamed, useSame } from './lib'`,
        `import * as L from './lib'`,
        `const { viaNsFn } = L`,
        `export const v = renamed() + viaNsFn() + useSame()`,
        '',
      ].join('\n'),
      'src/core/__tests__/lib.test.ts': `import { testOnlyFn, exportedLocal } from '../lib'\nexport const t = testOnlyFn() + exportedLocal()\n`,
      'src/test/helper.ts': `export function testHelper(): number { return 6 }\n`,
      'src/data/ns.ts': `export const A = 1\nexport const B = 2\n`,
      'src/data/nsUser.ts': `import * as N from './ns'\nexport const all = Object.values(N)\n`,
    })
    const keys = scanDeadExports({ root, seams: {} }).dead.map(d => d.key)
    expect(keys).toContain('src/core/lib.ts deadFn')
    expect(keys, '只被测试引用 = 生产死代码').toContain('src/core/lib.ts testOnlyFn')
    expect(keys, '只被测试经由的本地转出别名同样是死的').toContain('src/core/lib.ts exportedLocal')
    expect(keys, '没人经由的转出别名').toContain('src/core/barrel.ts oldName')
    for (const alive of ['src/core/lib.ts aliasedFn', 'src/core/lib.ts viaNsFn', 'src/core/lib.ts useSame', 'src/data/ns.ts A', 'src/data/ns.ts B']) {
      expect(keys, alive).not.toContain(alive)
    }
    expect(keys.filter(k => k.startsWith('src/test/')), 'src/test 是测试基础设施，不进候选面').toEqual([])
  })

  it('⑪ 测试接口豁免：登记的仅测试导出不报；条目失效（长出生产消费者 / 导出已删）进 staleSeams', () => {
    const root = fixture({
      'src/core/memo.ts': `let on = true\nexport function setMemo(v: boolean): void { on = v }\nexport function isOn(): boolean { return on }\nexport const x = isOn()\n`,
      'src/core/__tests__/memo.test.ts': `import { setMemo } from '../memo'\nsetMemo(false)\n`,
    })
    const seams = {
      'src/core/memo.ts setMemo': { since: 't', why: '仅测试' },
      'src/core/memo.ts isOn': { since: 't', why: '已有生产消费者 ⇒ 失效' },
      'src/core/memo.ts gone': { since: 't', why: '导出已删 ⇒ 失效' },
    }
    const r = scanDeadExports({ root, seams })
    expect(r.dead.map(d => d.key)).not.toContain('src/core/memo.ts setMemo')
    expect(r.staleSeams).toEqual(['src/core/memo.ts gone', 'src/core/memo.ts isOn'])
  })

  it('⑫ 仓库级：全 src 死导出为空、测试接口豁免无失效条目、非入口文件无转出', () => {
    const { dead, staleSeams, shells, staleEntries, exports, ms } = scanDeadExports()
    // 反空洞下限：全 src 导出面约 2400（2026-10-07）——扫描器静默失效时这里先红
    expect(exports, 'src 导出面异常小 ⇒ 扫描器可能失效（恒绿风险）').toBeGreaterThan(1500)
    expect(ms).toBeLessThan(60_000)
    expect(staleSeams, '测试接口豁免已失效：从 DEAD_EXPORT_TEST_SEAMS 删掉').toEqual([])
    expect(
      dead.map(d => `${d.key} (${d.kind})`),
      '死导出：接上生产消费者，或删掉（只被测试用的连同测试一起删；夹具搬进 src/test）；只有必须与模块私有状态同处的测试接口才登记 DEAD_EXPORT_TEST_SEAMS',
    ).toEqual([])
    expect(staleEntries, '转出入口白名单失效：该文件已不再转出任何符号，从 REEXPORT_ENTRY_FILES 删掉').toEqual([])
    expect(
      shells.map(s => `${s.key} ← ${s.from}`),
      '兼容壳：导入方改到声明处（← 所指文件）后删掉这条转出；只有一个域的公共入口才登记 REEXPORT_ENTRY_FILES 并写清理由',
    ).toEqual([])
  })

  it('⑬ .vue 消费：import 经 `export *` 可达 ⇒ 活；只 import 了【别的模块】的同名符号 ⇒ 仍死（同名 ≠ 同一符号）', () => {
    const root = fixture({
      'src/composables/lib.ts': `export function barrelReached(): number { return 1 }\nexport function sameName(): number { return 2 }\n`,
      'src/composables/barrel.ts': `export * from './lib'\n`,
      'src/composables/other.ts': `export function sameName(): number { return 3 }\n`,
      'src/views/Page.vue': `<template><div /></template>\n<script setup lang="ts">\nimport { barrelReached } from '@/composables/barrel'\nimport { sameName } from '@/composables/other'\nconst v = barrelReached() + sameName()\n</script>\n`,
    })
    const keys = scanDeadExports({ root, seams: {} }).dead.map(d => d.key)
    expect(keys).not.toContain('src/composables/lib.ts barrelReached')
    expect(keys).not.toContain('src/composables/other.ts sameName')
    expect(keys, '★ .vue 用的是 other 的 sameName，lib 的同名导出仍是死的').toContain('src/composables/lib.ts sameName')
  })

  it('⑭ 转出口径：非入口文件的 `export {x} from` / `export *` / import 再 export 有生产消费也报壳；入口放行；本地改名导出不算转出；入口不再转出进 staleEntries', () => {
    const root = fixture({
      'src/core/impl.ts': `export function a(): number { return 1 }\nexport function b(): number { return 2 }\nexport function c(): number { return 3 }\n`,
      'src/core/facade.ts': [
        `import { b } from './impl'`,
        `export { a } from './impl'`,
        `export { b }`,
        `export * from './impl'`,
        `function own(): number { return 4 }`,
        `export { own as renamed }`,
        '',
      ].join('\n'),
      'src/core/entry.ts': `export { c } from './impl'\n`,
      'src/core/user.ts': `import { a, b, renamed } from './facade'\nimport { c } from './entry'\nexport const v = a() + b() + c() + renamed()\n`,
    })
    const r = scanDeadExports({ root, seams: {}, entries: { 'src/core/entry.ts': '测试入口', 'src/core/gone.ts': '已不存在 ⇒ 失效' } })
    expect(new Set(r.shells.map(s => `${s.key} ← ${s.from}`))).toEqual(new Set([
      'src/core/facade.ts a ← src/core/impl.ts',
      'src/core/facade.ts b ← src/core/impl.ts',
      'src/core/facade.ts * ← src/core/impl.ts',
    ]))
    expect(r.staleEntries).toEqual(['src/core/gone.ts'])
  })
})
