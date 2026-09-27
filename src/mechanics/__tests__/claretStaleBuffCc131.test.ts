/**
 * CC-131：teammate-buffs 1611 组曾有 `claret.gleaming_edge_teammate`（「核心被动·锋芒毕露」：切换至击破/锋御队友时
 * 复制 穿透率 +20% / 造成失衡值 +10%）。来源是 v12 重录前的测试服草稿（data/raw/_archive/scratch/claret_teammate_buff.json，
 * 2026-08-18 初始提交即存在）；v12 原文（data/raw/nanoka_missing/full/1611.json）、catalog 1611 技能文本、两把相关音擎均无此效果
 * （无「锋芒毕露」「切换至」「穿透率提升」）。R5：原文可信 ⇒ 删除。本测试防止它被重新录回。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const groups = JSON.parse(readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')) as any[]
const raw = readFileSync(new URL('../../../data/raw/nanoka_missing/full/1611.json', import.meta.url), 'utf8')

describe('CC-131 克拉蕾过时队友 buff 已删除', () => {
  it('1611 组不含锋芒毕露复制 buff，也没有穿透率 / 失衡值效果', () => {
    const g = groups.find(x => String(x.id) === '1611')
    expect(g).toBeTruthy()
    expect(g.buffs.map((b: any) => b.id)).not.toContain('claret.gleaming_edge_teammate')
    const stats = g.buffs.flatMap((b: any) => b.effects.map((e: any) => e.stat))
    expect(stats).not.toContain('penRatio')
    expect(stats).not.toContain('stunBuildUpBonus')
  })

  it('依据仍成立：v12 原文没有「锋芒毕露」与「穿透率提升」（原文更新后若出现，重新评估本卡）', () => {
    expect(raw.includes('锋芒毕露')).toBe(false)
    expect(raw.includes('穿透率提升')).toBe(false)
  })
})
