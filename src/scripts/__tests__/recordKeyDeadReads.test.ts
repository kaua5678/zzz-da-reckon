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
  RECORD_KEY_MIN_READS,
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
    expect(r.reads).toBeGreaterThanOrEqual(RECORD_KEY_MIN_READS)
    expect(r.ok).toBe(true)
  })
})
