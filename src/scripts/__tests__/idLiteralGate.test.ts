/**
 * 判据 26「角色 / 招式 id 字面量只许在 id 的家」测试（CC-449 展示层 → CC-450 全 src，2026-10-04）。
 *
 * ① detector 单测：引号包着的四位 1xx1 / 七位 1xx1xxx 必报（行号准确）；注释（行 / 块 / 模板）、URL、无引号数字、
 *    五位道具 id / boss id / 年份不报。
 * ② 仓库级：真实仓库 id 的家之外当前 = 0，扫描面非空洞（文件数 ≥ 下限），detector 自证通过；
 *    id 的家本身确实有字面量（否则是白名单写错路径、整条判据空转）。
 * ③ 事故回放：r487 断言「views 无 moveId 字面量」时 StunAxisPage.vue 实有的三行（CC-448 前原文）喂给 detector，必须全报。
 * 立项依据见 `scripts/lib/id-literal-gate.mjs` 头注释。
 */
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import {
  ID_HOME_DIRS,
  ID_LITERAL_MIN_FILES,
  detectorSelfTest,
  findIdLiterals,
  scanIdLiterals,
  stripComments,
} from '../../../scripts/lib/id-literal-gate.mjs'
const ROOT = resolve(__dirname, '../../..')
describe('判据 26 detector', () => {
  it('自证通过', () => {
    expect(detectorSelfTest()).toEqual({ ok: true, failures: [] })
  })
  it('剥注释保行号', () => {
    const src = "<!-- a\n '1471' -->\nconst x = '1371' // '1581'\n/* '1051' */ const y = 1\n"
    expect(stripComments(src).split('\n').length).toBe(src.split('\n').length)
    const hits = findIdLiterals(src)
    expect(hits.map(h => [h.line, h.id])).toEqual([[3, '1371']])
  })
  it('形状：四位 1xx1 / 七位 1xx1xxx 计；五位道具 / boss / 年份 / 无引号不计', () => {
    const src = "a('1021')\nb('1641029')\nc('20101')\nd('41001')\ne('2026')\nf(1371)\ng('13710')\n"
    expect(findIdLiterals(src).map(h => h.id)).toEqual(['1021', '1641029'])
  })
  it('事故回放：CC-448 前 StunAxisPage.vue 的三处字面量全报', () => {
    const src = [
      "    if (act.moveId !== '1371014' && act.moveId !== '1371020') continue",
      '  // 仪玄的符法千重（1371020）是术法值触发的额外终结技，不能被琉音转大',
      "  if (moveId === '1371020') return false",
    ].join('\n')
    expect(findIdLiterals(src).map(h => [h.line, h.id])).toEqual([[1, '1371014'], [1, '1371020'], [3, '1371020']])
  })
})
describe('判据 26 仓库级', () => {
  it('id 的家之外 = 0，扫描面非空洞', () => {
    const r = scanIdLiterals(ROOT)
    expect(r.selfTest.ok).toBe(true)
    expect(r.scanned).toBeGreaterThanOrEqual(ID_LITERAL_MIN_FILES)
    expect(r.sites, r.sites.map(s => `${s.file}:${s.line} ${s.id}`).join('\n')).toEqual([])
    expect(r.ok).toBe(true)
  })
  it('白名单路径真实存在且确有字面量（防白名单写错路径让判据空转）', () => {
    // 把家从白名单里拿掉再扫：每个家都必须贡献命中
    for (const home of ID_HOME_DIRS) {
      const others = ID_HOME_DIRS.filter(d => d !== home)
      const r = scanIdLiterals(ROOT, others)
      expect(r.sites.some(s => s.file.startsWith(home + '/')), home).toBe(true)
    }
  })
})
