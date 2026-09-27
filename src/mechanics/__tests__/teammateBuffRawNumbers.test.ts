/**
 * 队友 buff 数值 ↔ 原文对账（第 157 轮固化，来源：CC-131 克拉蕾测试服残留、CC-132 柚叶 15.04 笔误）。
 *
 * 规则：public/static/teammate-buffs.json 每个效果的 value / ratio / cap / valuePerStack，必须能在该组角色原文
 * data/raw/nanoka_missing/full/<组id>.json（去掉 <color> 等标签）里找到：
 *   - 紧跟「%」「点」「秒」的数字；或
 *   - {CAL:表达式,...} 模板在技能等级 1–16 下的求值（含 ×100 的百分数形式）。
 * formula 表达式里的常数不在本测试范围（常含推导值，如耀嘉音影画2 0.54 = 0.35 + 0.19；核对记录见
 * docs/mcp-r6-refactor-list.md §2.17）。
 *
 * 变红时：先读原文确认。原文确实没有 ⇒ 数据是残留 / 笔误，开 CC 卡订正（改数值要走 zd + 基线解释）；
 * 原文有但本测试没匹配上（新的文本格式）⇒ 扩展下面的提取规则，不要加白名单绕过。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

const root = new URL('../../../', import.meta.url)
const groups = JSON.parse(readFileSync(new URL('public/static/teammate-buffs.json', root), 'utf8')) as any[]

const r4 = (v: number) => Math.round(v * 1e4) / 1e4

function rawNumbers(text: string): Set<number> {
  const S = new Set<number>()
  for (const m of text.matchAll(/\{CAL:([^,}]+)[^}]*\}/g)) {
    for (let lv = 1; lv <= 16; lv++) {
      const e = m[1].replace(/AvatarSkillLevel\(\d+\)/g, String(lv))
      if (!/^[\d.+\-*/() ]+$/.test(e)) continue
      try {
        const v = Function(`"use strict";return (${e})`)() as number
        if (Number.isFinite(v)) { S.add(r4(v)); S.add(r4(v * 100)) }
      } catch { /* 非法表达式跳过 */ }
    }
  }
  for (const m of text.replace(/\{CAL:[^}]*\}/g, '').matchAll(/(\d+(?:\.\d+)?)\s*(?:%|点|秒)/g)) S.add(r4(Number(m[1])))
  return S
}

describe('队友 buff 数值能在角色原文里找到', () => {
  const misses: string[] = []
  let checked = 0
  for (const g of groups) {
    const file = new URL(`data/raw/nanoka_missing/full/${g.id}.json`, root)
    if (!existsSync(file)) { misses.push(`${g.id}: 缺原文文件`); continue }
    const S = rawNumbers(readFileSync(file, 'utf8').replace(/<[^>]+>/g, ''))
    for (const b of g.buffs ?? []) {
      for (const e of b.effects ?? []) {
        for (const k of ['value', 'ratio', 'cap', 'valuePerStack'] as const) {
          const v = e[k]
          if (typeof v !== 'number') continue
          checked++
          if (!S.has(r4(v)) && !S.has(r4(v * 100))) misses.push(`${g.id} ${b.id} ${e.id} ${e.stat} ${k}=${v}`)
        }
      }
    }
  }
  it('全部匹配（无残留 / 笔误）', () => {
    expect(checked).toBeGreaterThan(100)
    expect(misses).toEqual([])
  })
})
