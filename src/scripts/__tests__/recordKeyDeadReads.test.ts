/**
 * 判据 25「无类型记录字符串键死读」测试（CC-91，2026-09-27）。
 *
 * ① detector 单测：死读必报（且行号准确）/ 别处有写入必不报 / 字符串里的「x.key」不算读取。
 * ② 仓库级：真实仓库当前死读 = 0，扫描面非空洞（读取数 ≥ 下限），detector 自证通过。
 * ③ 事故回放：把 CC-91 修复前 vivian.ts 的两行读取喂给 detector，必须报出 vivianDanceHit / vivianAssistCount。
 * 立项依据见 `scripts/lib/record-key-dead-reads.mjs` 头注释。
 */
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import {
  RECORD_KEY_MIN_SCANNED_FILES,
  detectorSelfTest,
  findRecordKeyDeadReads,
  maskSource,
  scanRecordKeyDeadReads,
} from '../../../scripts/lib/record-key-dead-reads.mjs'
import { RECORD_KEY_DEAD_READ_ALLOWLIST } from '../../../scripts/check-guards.mjs'

const ROOT = resolve(__dirname, '../../..')
const DECL = 'const record = cfg as unknown as Record<string, unknown>\n'

describe('判据 25 detector', () => {
  it('自证通过', () => {
    expect(detectorSelfTest()).toEqual({ ok: true, failures: [] })
  })

  it('保长度遮罩：行号不偏', () => {
    const src = '/* a\n b */ const x = 1 // c\nconst s = \'y.z\'\n'
    const masked = maskSource(src, { strings: true })
    expect(masked.length).toBe(src.length)
    expect(masked.split('\n').length).toBe(src.split('\n').length)
    expect(masked).not.toContain('y.z')
    expect(maskSource(src, { strings: false })).toContain('y.z')
  })

  it('事故回放：CC-91 前 vivian.ts 的两条死读必须报出', () => {
    const texts = new Map([['src/mechanics/agents/vivian.ts', DECL
      + '    danceHitCount: Number(record.vivianDanceHit ?? 0),\n'
      + '    assistCount: Number(record.vivianAssistCount ?? 0),\n'
      + '    battleTime: Number(record.battleTime ?? 180),\n'],
    ['src/other.ts', 'cfg.battleTime = 120\n']])
    const { dead } = findRecordKeyDeadReads(texts)
    expect(dead.map(d => d.key)).toEqual(['vivianAssistCount', 'vivianDanceHit'])
    expect(dead[1].sites).toEqual(['src/mechanics/agents/vivian.ts:2'])
  })

  it('简写属性 / 对象字面量写入算「有人用」，不报', () => {
    const texts = new Map([['a.ts', DECL + 'const v = record.fooShort\n'], ['b.ts', 'const fooShort = 1\nObject.assign(cfg, { fooShort })\n']])
    expect(findRecordKeyDeadReads(texts).dead).toEqual([])
  })
})

describe('判据 25 仓库级', () => {
  it('当前死读 0、扫描面非空洞、豁免表无失效项', () => {
    const r = scanRecordKeyDeadReads(ROOT, RECORD_KEY_DEAD_READ_ALLOWLIST)
    expect(r.fresh).toEqual([])
    expect(r.staleAllow).toEqual([])
    expect(r.scanned).toBeGreaterThanOrEqual(RECORD_KEY_MIN_SCANNED_FILES)
    expect(r.ok).toBe(true)
  })
})

/**
 * 2026-10-20 实测事故：`rm src/components/charts/ContributionHeatmap.vue` 后（还没 `git add`），
 * `check-guards` 直接 `Error: ENOENT` 崩掉，整张护栏表停摆。
 *
 * 根因：扫描器用 `git ls-files`（**索引**）取清单、再 `readFileSync`（**磁盘**）读，
 * 「已删除未暂存」的窗口必然 ENOENT。
 *
 * 修法 = `fs-tolerant`：文件不存在 ⇒ 返回 null 并计入 `missing`（剔除出扫描面但**显式报告**）。
 * 负控：把容错改回直接 readFileSync ⇒ 本用例抛 ENOENT 而不是断言失败。
 */
describe('扫描器容错：git 索引与磁盘不一致（rm 未 add）', () => {
  it('缺失文件被剔除且计入 missing，不抛 ENOENT', async () => {
    const { readTextsTolerant } = await import('../../../scripts/lib/fs-tolerant.mjs')
    const r = readTextsTolerant(ROOT, [
      'package.json',                          // 存在
      'src/components/charts/__不存在__.vue',   // 不存在
    ])
    expect(r.texts.has('package.json')).toBe(true)
    expect(r.missing).toEqual(['src/components/charts/__不存在__.vue'])
    // 并集恒等：存在的 + 缺失的 === 输入条数
    expect(r.texts.size + r.missing.length).toBe(2)
  })

  it('仓库级扫描不因缺失文件崩溃，且 missing 显式暴露', () => {
    const r = scanRecordKeyDeadReads(ROOT, RECORD_KEY_DEAD_READ_ALLOWLIST)
    expect(Array.isArray(r.missing)).toBe(true)
    // 扫描面 = 实际读到的文件数（缺失的不计入分母）
    expect(r.scanned).toBeGreaterThan(0)
  })
})
