/**
 * CC-437 形状锁（T15-g 收口，2026-10-03 arena-F r473，设计稿 `docs/mcp-cc437-axis-overlay-opaque.md` §4）：
 * 轴窗口 overlay 对编排层**不透明**——共享类型里不得再出现任何 agent 前缀的 overlay 字段 / 命名桶容器，
 * `directRowBonus` 只经 `overlay` 一条通道拿值。
 *
 * 为什么用源码文本锁而不是类型锁：这三条都是「某个名字**不存在**」，类型系统表达不了「没有这个成员」，
 * vue-tsc 对加回去的字段一声不吭；vitest 不做类型检查。文本锁是唯一会红的护栏。
 * 新模块要加轴窗口数据：在自己文件里扩展私有 `XxxOverlay`（见 banyue.ts / yixuan.ts 的样子），不要碰共享类型。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
/** 只看代码行：去掉 `//` 行、块注释行（`/*` / `*` 开头）——注释里允许提历史名字 */
const codeLines = (src: string) => src.split('\n').filter(l => {
  const t = l.trim()
  return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
})

describe('CC-437：轴窗口 overlay 不透明（形状锁）', () => {
  it('① typesHooks.ts 代码行不含任何 agent 前缀 overlay 字段、也不含命名桶容器', () => {
    const code = codeLines(read('../../mechanics/typesHooks.ts')).join('\n')
    for (const legacy of ['MingwangStacks', 'NingshenMap', 'KagerouMap', 'StunBonusMap',
      'MingwangPct', 'StunBonusPct', 'KagerouPct', 'InfectionPct', 'yixuanNingshen',
      'AgentAxisOverlays', 'AxisScalarOverlays', 'scalarBySlot']) {
      expect(code, legacy).not.toContain(legacy)
    }
    // brand 是纯 brand（不再与命名桶交叉）
    expect(code).toMatch(/export type AgentAxisOverlay = \{ readonly \[AXIS_OVERLAY_BRAND\]: true \}/)
  })

  it('② 编排层（panelPhases / damagePool / damagePoolDirect / useResourceCalc）不再解释 overlay 内容', () => {
    for (const rel of ['../resourceCalc/panelPhases.ts', '../resourceCalc/damagePool.ts',
      '../resourceCalc/damagePoolDirect.ts', '../useResourceCalc.ts']) {
      const code = codeLines(read(rel)).join('\n')
      for (const legacy of ['scalarBySlot', 'bucketsBySlot', 'axisBucketsBySlot', 'axisScalarBySlot', 'overlayScalar', 'overlayBuckets']) {
        expect(code, rel + ' ' + legacy).not.toContain(legacy)
      }
    }
  })

  it('③ DirectRowBonusInput 只有 `overlay`（必填）一条 overlay 通道，没有 `buckets` / `scalar`', () => {
    const src = read('../../mechanics/typesRows.ts')
    const start = src.indexOf('export interface DirectRowBonusInput')
    expect(start).toBeGreaterThan(0)
    const body = codeLines(src.slice(start, src.indexOf('\n}\n', start))).join('\n')
    expect(body).toMatch(/^\s*overlay: AgentAxisOverlay \| undefined$/m)
    expect(body).not.toMatch(/^\s*overlay\?:/m)
    expect(body).not.toMatch(/^\s*buckets\??:/m)
    expect(body).not.toMatch(/^\s*scalar\??:/m)
  })
})
