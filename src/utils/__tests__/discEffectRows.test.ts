/**
 * 驱动盘套装效果行（面板可见性）测试。
 *
 * 背景（用户 2026-09-08）：「部分靠前的驱动盘的4件套没给属性滑块，我认为可能是属性都没做」
 * ——实测效果都已接线，缺的是**可见性**：旧实现只列带 condition/maxStacks 的效果，
 * 于是常驻段/门槛段/未建模段整块不出现。本测试把「每套都要看得见」钉成机器判据。
 * 数据：public/static/catalog.json（scripts/patch-disc-sets.mjs 写条件元数据）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildDiscEffectRows } from '@/utils/discEffectRows'

const catalog = JSON.parse(
  readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'),
) as any
const sets = catalog.driveDiscSets as any[]
const setById = new Map<string, any>(sets.map(s => [String(s.id), s]))
const byName = (zh: string) => sets.find(s => s.name?.zhCN === zh)!

describe('驱动盘效果行可见性（buildDiscEffectRows）', () => {
  it('每个套装单穿 4 件都至少出一行（有文本没效果的走「未建模」行，不留空白）', () => {
    const empty: any[] = []
    for (const s of sets) {
      const rows = buildDiscEffectRows(s, undefined)
      expect(rows.length, `${s.id} ${s.name?.zhCN} 4件段一行都不出，页面上看着就是「没做属性」`).toBeGreaterThan(0)
      if (s.fourPiece?.effectText && !s.fourPiece?.selfBuff?.effects?.length && !s.fourPiece?.teamBuff?.effects?.length) {
        expect(rows.some(r => r.unmodeled), `${s.id} 应标未建模`).toBe(true)
      }
    }
    expect(empty.length).toBe(0)
  })

  it('灵魂摇滚 4pc（受击减伤，生存向）明确标未建模，而不是静默消失', () => {
    const rows = buildDiscEffectRows(setById.get('31500'), undefined)
    const un = rows.filter(r => r.unmodeled)
    expect(un.map(r => r.scope)).toContain('4件')
    expect(un.find(r => r.scope === '4件')!.valueText).toBe('未建模')
  })

  it('棘刺玫瑰 4pc：常驻增伤段列出行（恒开不给滑块），防御门槛段标自动判定', () => {
    const rows = buildDiscEffectRows(setById.get('34200'), undefined)
    const dmg = rows.find(r => r.stat === 'dmgBonus')!
    expect(dmg.label, '属性名应走中文标签，不再是 dmgBonus 原始 id').not.toBe('dmgBonus')
    expect(dmg.adjustable, '常驻段不折算 uptime').toBe(false)
    const gated = rows.filter(r => r.stat === 'critRate')
    expect(gated.length).toBe(2)
    for (const g of gated) {
      expect(g.gateText, '防御≥1000/1800 属自动判定门槛').toContain('局外防御≥')
      expect(g.adjustable, '门槛类再挂覆盖率会双重打折').toBe(false)
    }
  })

  it('触发限时段（囚徒手记/沧浪行歌/山大王 teamBuff/云岿如我贯穿段）都带覆盖率滑块', () => {
    const qiu = buildDiscEffectRows(setById.get('33800'), undefined)
    // 4pc 三段（异放段 + 冻结段两条）+ 该套自带 2pc 冰伤段 = 4 行；只有 4pc 段是触发限时
    const four = qiu.filter(r => r.scope.startsWith('4件'))
    expect(four.length).toBe(3)
    for (const r of four) {
      expect(r.adjustable, `${r.stat} 触发限时，应给 uptime 滑块`).toBe(true)
      expect(r.condition).toBeTruthy()
    }
    const cang = buildDiscEffectRows(setById.get('33500'), undefined)
    // 帷幕两段（暴击+20 / 攻击+10）给滑块；2pc 物理伤是常驻段 → 恒开不给
    expect(cang.filter(r => r.scope.startsWith('4件')).every(r => r.adjustable)).toBe(true)
    expect(cang.filter(r => r.scope === '2件').every(r => !r.adjustable)).toBe(true)
    const king = buildDiscEffectRows(setById.get('33200'), undefined).filter(r => r.scope === '4件·全队')
    expect(king.length, '山大王全队段要看得见').toBeGreaterThan(0)
    // 暴击率≥50% 那一段是门槛判据，不给滑块
    expect(king.some(r => r.gateText?.includes('局外暴击率≥50'))).toBe(true)
  })

  it('4 件与 2 件同套时 2 件段仍列出且不重复；异套时两段各自列出', () => {
    const same = buildDiscEffectRows(setById.get('31000'), setById.get('31000'))
    const twoRows = same.filter(r => r.scope === '2件')
    expect(twoRows.length).toBe(1)
    expect(twoRows[0].setId).toBe('31000')
    const mixed = buildDiscEffectRows(setById.get('34200'), setById.get('31100'))
    // 4 件套自带其 2pc 段（引擎 setCounts：4 件同样吃本套 2 件效果），再加独立 2 件套的段
    expect(mixed.filter(r => r.scope === '2件').map(r => r.setId).sort()).toEqual(['31100', '34200'])
    expect(mixed.some(r => r.scope === '4件·自身')).toBe(true)
  })

  it('叠层段按默认层数呈现（啄木鸟 3 层×9%），无 id 效果不给滑块', () => {
    const rows = buildDiscEffectRows(setById.get('31000'), undefined)
    const atk = rows.find(r => r.stat === 'atkPct')!
    expect(atk.valueText).toBe('+9%×3层')
    for (const r of rows) {
      if (r.adjustable) expect(r.key, '覆盖率按效果 id 存，无 id 不能给滑块').not.toMatch(/-unmodeled$/)
    }
    expect(byName('啄木鸟电音').id).toBe('31000')
  })
})
