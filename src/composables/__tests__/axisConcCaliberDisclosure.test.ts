import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * R14 硬约束 2「来源可见」在**难度曲线页**的延伸判据（lead 复核 2026-10-17）。
 *
 * 背景：非轴参照点（T192）是**关掉轴重算**的 ⇒ 自动吃到 R14 的无轴估算加成；
 * 而轴点是真实轴、不吃。实测「轴 vs 非轴」差距因此被压缩（58.1% → 31.4% 等）。
 * 那是**设计上的必然**（参照语义从「最坏情况」变成「典型玩家」），
 * 但**不能让用户以为自己在看均匀摊** —— 图例必须随开关切换措辞。
 *
 * 反证：删掉图例里的 `v-if="noAxisConcEnabled"` 分支 ⇒ 本判据红。
 */
describe('R14 曲线页口径披露', () => {
  it('★ 图例必须区分「估算的典型玩家」与「完全均匀摊」两种口径', () => {
    const src = readFileSync(resolve(__dirname, '../../views/TeamComparePage.vue'), 'utf-8')
    expect(src, '图例要读开关状态').toContain('noAxisConcEnabled')
    expect(src, '口径一：估算').toContain('估算的典型玩家')
    expect(src, '口径二：均匀摊').toContain('完全均匀摊')
    expect(src, '必须说明「关掉估算 = 均匀摊」这条出路').toMatch(/关掉[^\n]*失衡易伤估算/)
  })
})
