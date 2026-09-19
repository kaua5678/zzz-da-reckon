/**
 * 判据 19「录入层 → 编排层值倒置」测试（2026-09-19 round 37，OPEN-ITEMS R35-J2）。
 *
 *  ① detector 单测（构造 fixture，**可红性自证**）：值导入必须报、语句级 `import type` 必须不报——
 *     这一对是判据的核心 discriminating pair；再加多行 `import type {…}`（逐行扫描器会误报的形态）、
 *     动态 `import()` 的值位/类型位、`export … from`、副作用 import、注释行、别名前缀误伤（`@/composablesX`）。
 *  ② 成对判据：行为面（值导入 0 + 反空洞下限）与形状面（claret 锁）各自能单独变红，且互不替代。
 *  ③ 仓库级：真实仓库当前值导入 = 0、总站点 ≥ 下限、形状锁 0 处；顺带钉住「扫描面确实是录入层」
 *     （扫到的文件数 ≥ 60、全部落在 src/mechanics|src/specs），防扫描器静默失效后假绿。
 *
 * 立项依据见 `scripts/lib/layer-inversion.mjs` 头注释：claret.ts:15 是全仓唯一一条录入层值导入编排层的边，
 * Tarjan SCC 实测 8 模块强连通分量；判据 7 / 12 对这条边结构性全盲。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

// @ts-expect-error -- scripts/lib 纯 JS 工具模块（与 compacted-slot-index / dead-channel-ls 同处理）
import * as libNs from '../../../scripts/lib/layer-inversion.mjs'

interface Site { file?: string; line: number; text: string; kind: 'type' | 'value'; specifier: string }
interface Report {
  scannedFiles: number
  sites: Site[]
  typeCount: number
  valueCount: number
  total: number
  shapeViolations: { file: string; line: number; text: string }[]
}

const lib = libNs as {
  ENTRY_LAYER_DIRS: string[]
  LAYER_INVERSION_MIN_TOTAL_SITES: number
  LAYER_INVERSION_SHAPE_LOCKS: string[]
  classifyImportSpecifierSites: (content: string) => Site[]
  listEntryLayerFiles: (root: string) => string[]
  scanShapeLocks: (root: string, locks?: string[]) => { file: string; line: number; text: string }[]
  scanLayerInversion: (root: string) => Report
  layerInversionOk: (report: Report, minTotal?: number) => boolean
  formatLayerInversion: (report: Report, minTotal?: number) => string[]
}

const REPO_ROOT = join(__dirname, '..', '..', '..')

let tmpRoots: string[] = []
afterEach(() => {
  for (const r of tmpRoots) rmSync(r, { recursive: true, force: true })
  tmpRoots = []
})

/** 造一个最小仓库：files = { 'src/mechanics/agents/x.ts': '内容', … } */
function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'layer-inversion-'))
  tmpRoots.push(root)
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), content, 'utf8')
  }
  return root
}

/** 8 条合法 `import type` 站点（模拟真实录入层的 CalcRoundThreads 形态），供反空洞下限用 */
function eightTypeSites(): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < 8; i++) {
    out[`src/mechanics/agents/a${i}.ts`] = `import type { CalcRoundThreads } from '@/composables/resourceCalc/roundThreads'\nexport const x${i} = 1\n`
  }
  return out
}

/** 基线 fixture = 8 条 type 站点 + 一份干净的形状锁文件 claret.ts（锁文件不存在会按「清单腐烂」判红） */
function baseRepo(): Record<string, string> {
  return { ...eightTypeSites(), 'src/mechanics/agents/claret.ts': 'export const claret = 1\n' }
}

describe('判据 19 · detector：classifyImportSpecifierSites（可红性自证）', () => {
  it('discriminating pair：值导入 → value；语句级 import type → type', () => {
    const value = lib.classifyImportSpecifierSites(
      "import { fusedRowValue } from '@/composables/resourceCalc/helpers'\n",
    )
    expect(value).toHaveLength(1)
    expect(value[0]).toMatchObject({ line: 1, kind: 'value', specifier: '@/composables/resourceCalc/helpers' })

    const type = lib.classifyImportSpecifierSites(
      "import type { CalcRoundThreads } from '@/composables/resourceCalc/roundThreads'\n",
    )
    expect(type).toHaveLength(1)
    expect(type[0].kind).toBe('type')
  })

  it('多行 import type {…} 按整条语句判 type（逐行扫描器会把收尾行误判成值导入）', () => {
    const src = "import type {\n  CalcRoundThreads,\n  Foo,\n} from '@/composables/resourceCalc/roundThreads'\n"
    const sites = lib.classifyImportSpecifierSites(src)
    expect(sites).toHaveLength(1)
    expect(sites[0]).toMatchObject({ line: 1, kind: 'type' })

    const valueSrc = "import {\n  fusedRowValue,\n} from '@/composables/resourceCalc/helpers'\n"
    expect(lib.classifyImportSpecifierSites(valueSrc)).toMatchObject([{ line: 1, kind: 'value' }])
  })

  it('内联 type 说明符 / export … from / 副作用 import / 动态 import 值位 ⇒ 全部按值计', () => {
    const src = [
      "import { type Foo } from '@/composables/a'",
      "export { bar } from '@/composables/b'",
      "export * from '@/composables/c'",
      "import '@/composables/d'",
      "const m = await import('@/composables/e')",
      "import('@/composables/f').then(x => x)",
    ].join('\n') + '\n'
    const sites = lib.classifyImportSpecifierSites(src)
    expect(sites.map(s => s.kind)).toEqual(['value', 'value', 'value', 'value', 'value', 'value'])
    expect(sites.map(s => s.line)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('类型位 import(\'…\').Name（velina/alice 既有写法）与 export type … from ⇒ 按 type 计', () => {
    const src = [
      "type T = import('@/composables/resourceCalc/roundThreads').CalcRoundThreads",
      "function f(): Partial<import('@/composables/x').Y> { return {} }",
      "export type { Z } from '@/composables/z'",
    ].join('\n') + '\n'
    expect(lib.classifyImportSpecifierSites(src).map(s => s.kind)).toEqual(['type', 'type', 'type'])
  })

  it('注释行豁免；别名前缀不误伤（@/composablesX、@/core、相对路径）', () => {
    const src = [
      "// import { a } from '@/composables/a'",
      " * import { b } from '@/composables/b'",
      "/* import { c } from '@/composables/c' */",
      "import { d } from '@/composablesX/d'",
      "import { e } from '@/core/e'",
      "import { f } from './composables/f'",
      "import { g } from '@/composables'",
    ].join('\n') + '\n'
    const sites = lib.classifyImportSpecifierSites(src)
    // 只有最后一行（别名根本身）是站点
    expect(sites).toHaveLength(1)
    expect(sites[0]).toMatchObject({ line: 7, kind: 'value', specifier: '@/composables' })
  })
})

describe('判据 19 · 成对判据：行为面与形状面各自可红、互不替代', () => {
  it('行为面 A：8 条 type 站点 + 0 值 ⇒ ok；再加 1 条值导入 ⇒ 红且点名文件:行', () => {
    const okRoot = makeRepo(baseRepo())
    const okReport = lib.scanLayerInversion(okRoot)
    expect(okReport).toMatchObject({ scannedFiles: 9, typeCount: 8, valueCount: 0, total: 8, shapeViolations: [] })
    expect(lib.layerInversionOk(okReport)).toBe(true)

    const badRoot = makeRepo({
      ...baseRepo(),
      'src/mechanics/agents/claret2.ts':
        "import type { X } from '@/types/x'\nimport { fusedRowValue } from '@/composables/resourceCalc/helpers'\n",
    })
    const badReport = lib.scanLayerInversion(badRoot)
    expect(badReport.valueCount).toBe(1)
    expect(lib.layerInversionOk(badReport)).toBe(false)
    const detail = lib.formatLayerInversion(badReport).join('\n')
    expect(detail).toContain('src/mechanics/agents/claret2.ts:2')
    expect(detail).toContain('下沉 src/data/')
  })

  it('行为面 B（反空洞下限）：值导入 0 但总站点 < 下限 ⇒ 红（「扫不到」≠「真清零」）', () => {
    const files = baseRepo()
    delete files['src/mechanics/agents/a7.ts']
    const report = lib.scanLayerInversion(makeRepo(files))
    expect(report).toMatchObject({ valueCount: 0, total: 7 })
    expect(lib.layerInversionOk(report)).toBe(false)
    expect(lib.formatLayerInversion(report).join('\n')).toContain('反空洞下限')
    // 同一份报告按更低的下限读 ⇒ 绿：证明红的确来自下限而不是别处
    expect(lib.layerInversionOk(report, 7)).toBe(true)
  })

  it('形状面：claret.ts 只要出现 @/composables 字面量（哪怕在注释里 / import type）⇒ 红；行为面看不见它', () => {
    const root = makeRepo({
      ...baseRepo(),
      'src/mechanics/agents/claret.ts':
        "// 曾经：pickThirdNamedBasicSegment 来自 @/composables/resourceCalc/helpers\nexport const claret = 1\n",
    })
    const report = lib.scanLayerInversion(root)
    // 行为面：注释行不算站点 ⇒ 值导入仍为 0（若只有行为面，这条回流看不见）
    expect(report.valueCount).toBe(0)
    expect(report.shapeViolations).toMatchObject([{ file: 'src/mechanics/agents/claret.ts', line: 1 }])
    expect(lib.layerInversionOk(report)).toBe(false)
    expect(lib.formatLayerInversion(report).join('\n')).toContain('形状锁')
  })

  it('形状锁清单腐烂（锁文件不存在）⇒ 红并提示改清单，而不是静默通过', () => {
    const root = makeRepo(eightTypeSites())
    const violations = lib.scanShapeLocks(root)
    expect(violations).toHaveLength(1)
    expect(violations[0].text).toContain('清单腐烂')
  })

  it('扫描面 = 录入层非测试 .ts（.d.ts / __tests__ / .test.ts / 其它层一律不扫）', () => {
    const root = makeRepo({
      ...baseRepo(),
      'src/mechanics/agents/__tests__/x.test.ts': "import { a } from '@/composables/a'\n",
      'src/mechanics/agents/y.test.ts': "import { a } from '@/composables/a'\n",
      'src/mechanics/agents/z.d.ts': "import { a } from '@/composables/a'\n",
      'src/specs/agents/w.json': '{"note":"@/composables/not-an-import"}',
      'src/core/engine.ts': "import { a } from '@/composables/a'\n",
      'src/specs/mechanics.ts': "import type { R } from '@/composables/resourceCalc/roundThreads'\n",
    })
    const report = lib.scanLayerInversion(root)
    expect(report.scannedFiles).toBe(10)
    expect(report).toMatchObject({ valueCount: 0, typeCount: 9, total: 9 })
    expect(lib.layerInversionOk(report)).toBe(true)
  })
})

describe('判据 19 · 仓库级：录入层对编排层值导入 = 0（claret.ts 已下沉 data/moveTableQueries）', () => {
  it('真实仓库：值导入 0 / 总站点 ≥ 下限 / 形状锁 0，且扫描面确实覆盖录入层', () => {
    const report = lib.scanLayerInversion(REPO_ROOT)
    expect(report.valueCount, report.sites.filter(s => s.kind === 'value').map(s => `${s.file}:${s.line}`).join(', ')).toBe(0)
    expect(report.total).toBeGreaterThanOrEqual(lib.LAYER_INVERSION_MIN_TOTAL_SITES)
    expect(report.shapeViolations).toEqual([])
    expect(lib.layerInversionOk(report)).toBe(true)
    // 反空洞：扫描面要真的是录入层（2026-09-19 实测 73 个文件），且每个站点都落在录入层目录内
    expect(report.scannedFiles).toBeGreaterThanOrEqual(60)
    for (const s of report.sites) {
      expect(lib.ENTRY_LAYER_DIRS.some(d => s.file!.startsWith(d + '/')), s.file).toBe(true)
    }
  })

  it('形状锁清单未腐烂：每个锁文件都存在', () => {
    for (const f of lib.LAYER_INVERSION_SHAPE_LOCKS) {
      expect(lib.listEntryLayerFiles(REPO_ROOT)).toContain(f)
    }
  })
})
