/**
 * 判据 30「通用字段的『唯一声明方』前提」测试（T128，2026-10-10）。
 *
 * 三层，对齐 `idLiteralGate.test.ts`（判据 26）的形状：
 * ① **detector 单测**：四种写入形态（成员赋值 / 元素赋值 / 复合赋值 / 对象字面量含简写）必报，
 *    读取 / 解构 / 类型声明 / 注释 / 字符串 / 别的字段必不报——**正反成对**，防「只会红的 detector」。
 * ② **仓库级**：真实仓库里登记字段的声明方 = 登记表（`exContinuous` 当前唯一 = yidhari），
 *    扫描面非空洞（≥ 下限）、detector 自证通过。
 * ③ **可红性自证**：构造「第二个声明方」的语料喂给纯函数 ⇒ 必进 `extra`（判据不是瞎的）；
 *    构造「登记表过期」⇒ 必进 `missing`（双向都成立，字段改名不会静默变成「零写入方」假绿）。
 *
 * 立项依据（缺口形状 + 5 处引擎读点分类表 + 选型与排除理由）见
 * `scripts/lib/field-writer-uniqueness.mjs` 头注释；实测发现见 T127 报告 §3.4。
 */
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import ts from 'typescript'
import {
  FIELD_WRITER_MIN_FILES,
  SINGLE_WRITER_FIELDS,
  fieldWriteAt,
  fieldWriterSelfTest,
  findFieldWrites,
  formatFieldWriters,
  scanFieldWriters,
} from '../../../scripts/lib/field-writer-uniqueness.mjs'

const ROOT = resolve(__dirname, '../../..')

/** 用内存源码造一个 program（与 lib 内自证同一手法：noLib 免加载 lib.d.ts） */
function programOf(code: string, file = '/__t128_fixture__/a.ts') {
  const options = { strict: true, noEmit: true, noLib: true, types: [] }
  const host = ts.createCompilerHost(options)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (f, lang, ...rest) => (f === file ? ts.createSourceFile(f, code, ts.ScriptTarget.Latest, true) : getSourceFile(f, lang, ...rest))
  host.fileExists = (f) => f === file
  host.readFile = (f) => (f === file ? code : undefined)
  return ts.createProgram({ rootNames: [file], options, host })
}

/** 造语料 → 扫 → 返回 `行:形态` 串（行号写死在 fixture 注释里，与自证同款） */
function formsOf(code: string) {
  const r = findFieldWrites(programOf(code), { root: '/__t128_fixture__', isScanned: () => true })
  return r.sites.map(s => `${s.line}${s.form}`).join(',')
}

describe('判据 30 detector：四种写入形态（正例）', () => {
  it('自证通过（lib 内的内存 program 自证位）', () => {
    expect(fieldWriterSelfTest()).toEqual({ ok: true, failures: [] })
  })
  it('★ 成员赋值 / 元素赋值 / 复合赋值 / 对象字面量 / 简写 全报', () => {
    // 这是本判据的**核心正例**：第二个声明方可能用任一形态写，漏抓一种 = 护栏形同虚设
    const code = [
      'interface Cfg { exContinuous?: boolean }',   // 1
      'declare const cfg: Cfg',                     // 2
      'export function a() { cfg.exContinuous = true }',            // 3
      'export function b(c: Cfg) { c["exContinuous"] = true }',     // 4
      'export function c(c: Cfg) { c.exContinuous ||= true }',      // 5
      'export function d() { return { exContinuous: true } }',      // 6
      'export function e(c: Cfg) { return { exContinuous } }',      // 7
    ].join('\n')
    expect(formsOf(code)).toBe('3property,4element,5compound,6literal,7literal-shorthand')
  })
  it('★ 接收者文本被捕获（红信息靠它分辨「自己那份 cfg」与「队友那份 characters[i].cfg」）', () => {
    const code = [
      'interface Cfg { exContinuous?: boolean }',   // 1
      'declare const characters: { cfg: Cfg }[]',   // 2
      'export function a() { characters[0].cfg.exContinuous = true }', // 3
    ].join('\n')
    const r = findFieldWrites(programOf(code), { root: '/__t128_fixture__', isScanned: () => true })
    expect(r.sites.map(s => [s.line, s.receiver])).toEqual([[3, 'characters[0].cfg']])
  })
})

describe('判据 30 detector：不误伤（反例）', () => {
  it('★ 读取 / 解构 / 类型声明 / 注释 / 字符串 / 别的字段 都不报', () => {
    const code = [
      'interface Cfg { exContinuous?: boolean; other?: boolean }',   // 1 类型声明：不是写入
      'declare const cfg: Cfg',                                      // 2
      'export function a(c: Cfg) { return c.exContinuous === true }',        // 3 读
      'export function b(c: Cfg) { const { exContinuous } = c; return exContinuous }', // 4 解构读
      'export function d(c: Cfg) { return { other: c.exContinuous } }',      // 5 别的字段
      '// cfg.exContinuous = true',                                          // 6 注释
      "export const e = 'cfg.exContinuous = true'",                          // 7 字符串
      'export function f(c: Cfg) { c.other = c.exContinuous ?? false }',     // 8 读 + 别的字段写
    ].join('\n')
    expect(formsOf(code)).toBe('')
  })
  it('引擎读点形态（真源码里的 5 处）不命中——否则判据会把引擎自己判成声明方', () => {
    const code = [
      'interface Cfg { exContinuous?: boolean; exFinalize?: boolean; exRefundPerPaid?: number }', // 1
      'declare const cfg: Cfg',                                                                   // 2
      'export const continuous = cfg.exContinuous === true && (cfg.exRefundPerPaid ?? 0) > 0',     // 3
      'export const realUlt = cfg.exContinuous === true && cfg.exFinalize !== true',               // 4
      'export const stored = cfg.exContinuous === true && cfg.exFinalize !== true',                // 5
    ].join('\n')
    expect(formsOf(code)).toBe('')
  })
  it('fieldWriteAt 对非目标字段 / 非赋值节点返回 null（单元级）', () => {
    const wanted = new Set(['exContinuous'])
    const src = 'declare const cfg: { exContinuous?: boolean; other?: boolean }\ncfg.other = true\n'
    const sf = ts.createSourceFile('a.ts', src, ts.ScriptTarget.Latest, true)
    const hits: string[] = []
    const visit = (n: ts.Node) => {
      const hit = fieldWriteAt(n, wanted, sf)
      if (hit) hits.push(hit.field)
      ts.forEachChild(n, visit)
    }
    visit(sf)
    expect(hits).toEqual([])   // 写的是 other，不是登记字段
  })
})

describe('判据 30 仓库级（真实扫描）', () => {
  it('★ 登记字段的声明方 = 登记表，扫描面非空洞，detector 自证过', () => {
    const r = scanFieldWriters(ROOT)
    expect(r.selfTest.ok).toBe(true)
    expect(r.scanned).toBeGreaterThanOrEqual(FIELD_WRITER_MIN_FILES)
    expect(r.extra, r.extra.map(s => `${s.file}:${s.line} ${s.text}`).join('\n')).toEqual([])
    expect(r.missing).toEqual([])
    expect(r.ok).toBe(true)
  })
  it('★ 登记表与实测对得上：每个登记字段都真有声明方，且都在非测试面', () => {
    const r = scanFieldWriters(ROOT)
    expect(SINGLE_WRITER_FIELDS.length).toBeGreaterThan(0)
    for (const f of SINGLE_WRITER_FIELDS) {
      expect(f.field, '字段名不能为空').toBeTruthy()
      expect(f.readers.length, `${f.field} 必须列出引擎读点（红信息靠它告诉人「新声明方要显式处理什么」）`).toBeGreaterThan(0)
      expect(f.writers.length, `${f.field} 必须至少有一个登记声明方`).toBeGreaterThan(0)
      for (const w of f.writers) {
        expect(w.file).toMatch(/^src\//)
        expect(w.why.length, `${w.file} 的 why 要写清「为什么这套语义对它成立」`).toBeGreaterThan(20)
        expect(r.byFile.has(w.file), `${w.file} 应真有写入点`).toBe(true)
      }
    }
  })
  it('★ 声明方不是测试文件 / 展示层（测试夹具不算声明方，展示层够不到 cfg）', () => {
    const r = scanFieldWriters(ROOT)
    for (const s of r.sites) {
      expect(s.file).not.toContain('__tests__')
      expect(s.file).not.toMatch(/\.test\.ts$/)
      expect(s.file).not.toMatch(/\.vue$/)
    }
  })
})

describe('判据 30 可红性自证（判据不是瞎的）', () => {
  const oneField = [{
    field: 'exContinuous',
    readers: ['(fixture)'],
    writers: [{ file: 'src/mechanics/agents/yidhari.ts', since: '2026-10-10', why: '(fixture) 为什么这套语义对它成立' }],
  }]

  it('★ 第二个模块写它 ⇒ 进 extra（这就是 T128 要抓的形态）', () => {
    const code = [
      'interface Cfg { exContinuous?: boolean }',   // 1
      'declare const cfg: Cfg',                     // 2
      'export function b() { cfg.exContinuous = true }',   // 3 ← 第二个声明方
    ].join('\n')
    // 直接把 fixture program 喂给 findFieldWrites，再按登记表口径分拣（与 scanFieldWriters 同式）
    const sites = findFieldWrites(programOf(code, '/__t128_red__/other.ts'), {
      root: '/__t128_red__', isScanned: () => true, fields: oneField,
    }).sites
    expect(sites).toHaveLength(1)
    const registered = new Set(oneField[0].writers.map(w => w.file))
    const extra = sites.filter(s => !registered.has(s.file))
    expect(extra.map(s => `${s.file}:${s.line}`)).toEqual(['other.ts:3'])
  })

  it('★ 红信息点名模块 + 给三条出路（用户 2026-10-10 裁决：判据不许变成「不许第二个」的死锁）', () => {
    const lines = formatFieldWriters({
      selfTest: { ok: true, failures: [] }, belowFloor: false, scanned: 999,
      sites: [],
      extra: [{ file: 'src/mechanics/agents/other.ts', line: 42, field: 'exContinuous', form: 'property', receiver: 'cfg', text: 'cfg.exContinuous = true' }],
      missing: [], byFile: new Map(), ok: false,
    }).join('\n')
    expect(lines).toContain('src/mechanics/agents/other.ts:42')
    expect(lines).toContain('未登记的声明方 1 处')
    // 三条出路必须都在（否则红信息只骂人、不告诉人怎么改）
    expect(lines).toContain('SINGLE_WRITER_FIELDS')
    expect(lines).toContain('按能力/新字段分流')
    expect(lines).toContain('只是重构挪位')
    expect(lines).toContain('不是**「不许第二个」')
  })

  it('★ 登记表过期 ⇒ 进 missing（字段改名 / 写入点搬家不会静默变成「零声明方」假绿）', () => {
    const lines = formatFieldWriters({
      selfTest: { ok: true, failures: [] }, belowFloor: false, scanned: 999, sites: [],
      extra: [], missing: [{ field: 'exContinuous', file: 'src/mechanics/agents/yidhari.ts' }],
      byFile: new Map(), ok: false,
    }).join('\n')
    expect(lines).toContain('登记表过期 1 条')
    expect(lines).toContain('src/mechanics/agents/yidhari.ts')
  })

  it('★ 反空洞下限：扫描面塌陷 ⇒ 判红且明确说「不要改下限」', () => {
    const lines = formatFieldWriters({
      selfTest: { ok: true, failures: [] }, belowFloor: true, scanned: 3, sites: [],
      extra: [], missing: [], byFile: new Map(), ok: false,
    }).join('\n')
    expect(lines).toContain('反空洞下限')
    expect(lines).toContain('不要**改这个下限')
  })

  it('★ detector 自证失败 ⇒ 判红（漏抓第二种写法时判据自己先红）', () => {
    const lines = formatFieldWriters({
      selfTest: { ok: false, failures: ['命中应为 3property，实为 3element'] }, belowFloor: false, scanned: 999, sites: [],
      extra: [], missing: [], byFile: new Map(), ok: false,
    }).join('\n')
    expect(lines).toContain('detector 自证失败')
    expect(lines).toContain('3element')
  })
})
