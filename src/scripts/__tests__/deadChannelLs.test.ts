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
interface ExportScanResult { dead: ExportHit[]; exports: number; ms: number }

const impl = deadChannelLsNs as {
  scanDeadChannelsLs: (opts?: { root?: string; dirs?: string[] }) => ScanResult
  scanDeadExportsLs: (opts?: { root?: string; dirs?: string[] }) => ExportScanResult
  /** 泛型：两类 hit（DeadHit / ExportHit）都只要求有 `key`，别为第二类复制一份函数签名 */
  diffAgainstBaseline: <T extends { key: string }>(dead: T[], baseline?: Record<string, BaselineEntry>) => { fresh: T[]; resolved: string[] }
  DEAD_CHANNEL_LS_BASELINE: Record<string, BaselineEntry>
  DEAD_EXPORT_BASELINE: Record<string, BaselineEntry>
}
const { scanDeadChannelsLs, scanDeadExportsLs, diffAgainstBaseline, DEAD_CHANNEL_LS_BASELINE, DEAD_EXPORT_BASELINE } = impl

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
 * ★ R33（2026-09-18）新增：**符号级死导出判据**（R32-J2 的直接产物）。
 *
 * 立项依据（可复现）：R32 发现 `core/damage.ts#calcDamage` 是**零调用者的死函数**，
 * 却**看着像主管线**（名字就叫 calcDamage）⇒ 规则 16「命名骗 agent」。
 * 而既有两条判据对它**结构性全盲**：
 * - 判据 14（字段名级正则）与 `scanDeadChannelsLs`（可选属性级）：候选面**只有可选属性**，
 *   而 `calcDamage` 的签名里一个可选属性都没有 ⇒ **连看都不看它一眼**；
 * - 出口：`grep` 看得见文本，但看不见 `import { a as b }` 这类改名引用。
 *
 * ⇒ 本判据用 **LanguageService 符号级**零引用（`findReferences` 覆盖整个 program，含 __tests__）
 * 来判「死函数」。⚠ 只扫 `src/core`（理由见 DEAD_EXPORT_BASELINE 头注释）。
 */
describe('dead-channel-ls 死导出（符号级，src/core）', () => {
  it('⑩ 导出函数零引用 → 报；被改名 import 引用 → 不报（grep 型判据的盲区）', () => {
    const root = fixture({
      'src/core/lib.ts': [
        `export function deadFn(): number { return 1 }`,
        `export function liveFn(): number { return 2 }`,
        `export function aliasedFn(): number { return 3 }`,
        '',
      ].join('\n'),
      // 关键：**改名引用**（`as`）——纯 grep 找 `liveFn` 找得到，但「按名字计数」型启发式会漏；
      // 更关键的是下面 aliasedFn 的形态：grep `aliasedFn` 只在定义行命中 ⇒ 会被误判为死。
      'src/core/user.ts': `import { liveFn, aliasedFn as renamed } from './lib'\nexport const v = liveFn() + renamed()\n`,
    })
    const { dead } = scanDeadExportsLs({ root, dirs: ['src/core'] })
    const names = dead.map(d => d.name)
    expect(names).toContain('deadFn')
    expect(names, '被引用的导出不该报').not.toContain('liveFn')
    expect(names, '改名 import（as）仍算引用 —— 这正是符号级相对 grep 的价值').not.toContain('aliasedFn')
  })

  it('⑪ 可红性自证：新死导出不在基线里 ⇒ 判 fresh（= 真实红路径）', () => {
    const root = fixture({
      'src/core/lib.ts': `export function brandNewDeadFn(): number { return 1 }\n`,
    })
    const { dead } = scanDeadExportsLs({ root, dirs: ['src/core'] })
    expect(dead.map(d => d.name)).toEqual(['brandNewDeadFn'])
    const { fresh } = diffAgainstBaseline(dead, DEAD_EXPORT_BASELINE)
    expect(fresh.map(f => f.key)).toContain('src/core/lib.ts brandNewDeadFn')
  })

  it('⑫ 仓库级棘轮：实测死导出 ⊆ 冻结基线（新增即红；改善只提示不红）', () => {
    const { dead, exports, ms } = scanDeadExportsLs()
    const { fresh, resolved } = diffAgainstBaseline(dead, DEAD_EXPORT_BASELINE)
    // 反空洞下限：src/core 的导出面不可能这么小（防「扫描器静默扫不到任何东西 ⇒ 恒绿」）
    expect(exports, 'src/core 导出面异常小 ⇒ 扫描器可能失效（恒绿风险）').toBeGreaterThan(100)
    expect(ms).toBeLessThan(120_000)
    if (resolved.length > 0) {
      console.log('[dead-export] 基线已过期（实测不再命中，可销账）：', resolved)
    }
    expect(
      fresh.map(f => `${f.key} (${f.kind})`),
      '发现基线外的新死导出：接上消费点，或（确认死）在 DEAD_EXPORT_BASELINE 登记（since+why 证据）',
    ).toEqual([])
  })
})
