/**
 * zc ctx（文件上下文反查，scripts/zc-where.mjs）的护栏。
 *
 * 为什么值得测：ctx 是 brief 的镜像（brief = 任务→上下文，ctx = 文件→上下文），
 * 价值全在「摸文件前把钉死的口径一页带出」与「不编造」两件事上——
 * ① 路径归一化错一格，决策树里的 core/damage.ts 就反查不到 src/core/damage.ts；
 * ② 文件目标拿 core/ 这种目录前缀去撞，会命中 core/resource.ts 一整族（噪声，不是答案）；
 * ③ 目标解析不到必须 resolved=null + 大声失败，绝不能凑一个看似合理的命中。
 */
import { describe, expect, it } from 'vitest'
import {
  anchorHits,
  buildWhere,
  firstHeaderComment,
  mentionsPath,
  normPath,
} from '../../../scripts/zc-where.mjs'

describe('路径归一化与命中（错一格 = 反查不到 / 误伤一整族）', () => {
  it('归一化：去 ./ 与 src/ 前缀、统一斜杠', () => {
    expect(normPath('src/core/damage.ts')).toBe('core/damage.ts')
    expect(normPath('./src/core/damage.ts')).toBe('core/damage.ts')
    expect(normPath('src\\core\\damage.ts')).toBe('core/damage.ts')
    expect(normPath('core/damage.ts')).toBe('core/damage.ts')
  })

  it('文件目标：命中归一化路径 / src 前缀 / 文件名，但不拿 core/ 前缀误伤兄弟文件', () => {
    expect(mentionsPath('core/damage.ts（乘区顺序 = 代码顺序）', 'src/core/damage.ts')).toBe(true)
    expect(mentionsPath('`src/core/damage.ts`', 'src/core/damage.ts')).toBe(true)
    expect(mentionsPath('改乘区 → damage.ts', 'src/core/damage.ts')).toBe(true)
    // core/resource.ts 与 core/damage.ts 同目录但不同文件：不能因为共享 core/ 就命中
    expect(mentionsPath('core/resource.ts（主循环）', 'src/core/damage.ts')).toBe(false)
  })

  it('目录目标：命中落在该目录下的路径', () => {
    expect(mentionsPath('core/stunPool/', 'src/core')).toBe(true)
    expect(mentionsPath('src/composables/', 'src/core')).toBe(false)
  })

  it('锚命中：相等 / 锚在目标目录下 / 目标在锚目录下', () => {
    expect(anchorHits('src/core/damage.ts', 'src/core/damage.ts')).toBe(true)
    expect(anchorHits('src/core/damage.ts', 'src/core')).toBe(true)
    expect(anchorHits('src/core', 'src/core/damage.ts')).toBe(true)
    expect(anchorHits('src/core/damage.ts', 'src/core/resource.ts')).toBe(false)
  })
})

describe('文件上下文包：真实文件能带出钉死的口径', () => {
  it('core/damage.ts：职责声明 + 乘区顺序 @fact + 决策树行，全带出处', () => {
    const w = buildWhere('src/core/damage.ts')
    expect(w.resolved).toBe('src/core/damage.ts')
    expect(w.header).toContain('伤害计算引擎')
    expect(w.facts.length).toBeGreaterThanOrEqual(1)
    expect(w.facts.map(f => f.fact).join(' ')).toContain('乘区顺序')
    expect(w.facts[0].at).toMatch(/damage\.ts:\d+$/)
    expect(w.tree.map(t => t.task)).toContain('改伤害公式 / 乘区')
    expect(w.tree.every(t => /\.md:\d+$/.test(t.at))).toBe(true)
    expect(w.counts.facts).toBeGreaterThanOrEqual(1)
    expect(w.counts.tree).toBeGreaterThanOrEqual(1)
  })

  it('spec JSON（1411.json）：头注释为 null，但 notes 里吐出的口径被带出', () => {
    const w = buildWhere('src/specs/agents/1411.json')
    expect(w.resolved).toBe('src/specs/agents/1411.json')
    expect(w.header).toBeNull()
    expect(w.sourced.length).toBeGreaterThan(0)
    expect(w.sourced.every(f => f.fact.startsWith('@fact agent:1411'))).toBe(true)
  })

  it('mechanics 模块（yixuan.ts）：头注释即「用户确认口径」声明，被带出', () => {
    const w = buildWhere('src/mechanics/agents/yixuan.ts')
    expect(w.resolved).toBe('src/mechanics/agents/yixuan.ts')
    expect(w.header).toContain('用户确认口径')
  })

  it('目录目标：反查出落在该目录下的口径与决策树行，头注释为 null', () => {
    const w = buildWhere('src/core')
    expect(w.resolved).toBe('src/core')
    expect(w.header).toBeNull()
    expect(w.facts.length).toBeGreaterThan(0)
    expect(w.tree.length).toBeGreaterThan(0)
  })

  it('不存在的文件：resolved=null 且什么都不编（不猜路径，规则 15）', () => {
    const w = buildWhere('src/core/没这个文件.ts')
    expect(w.resolved).toBeNull()
    expect(w.tree).toHaveLength(0)
    expect(w.facts).toHaveLength(0)
    expect(w.sourced).toHaveLength(0)
    expect(w.header).toBeNull()
  })
})

describe('头注释抽取', () => {
  it('core 文件头注释 = 职责声明', () => {
    expect(firstHeaderComment('src/core/damage.ts')).toContain('伤害计算引擎')
  })

  it('目录 / 不存在 → null，不硬凑', () => {
    expect(firstHeaderComment('src/core')).toBeNull()
    expect(firstHeaderComment('src/core/没这个.ts')).toBeNull()
  })
})
