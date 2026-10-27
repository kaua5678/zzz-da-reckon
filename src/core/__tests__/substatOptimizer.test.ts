import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  computeDefaultSubStats, getTemplate, normalizeSubstatAllocation, resolveSubstatBudget,
  fitsTopTwoCap, topTwoOf, SUBSTAT_BUDGET_SETTINGS, SUBSTAT_TOP2_STEP_CAP, type SubstatTemplate,
} from '@/core/substatOptimizer'
import type { Agent } from '@/types/catalog'

const dpsTemplate: SubstatTemplate = {
  stats: ['critRate', 'critDmg', 'atkPct', 'penFlat'],
}
const anomalyTemplate: SubstatTemplate = {
  stats: ['anomalyProficiency', 'atkPct'],
}

function mockAgent(id: string, specialty: string): Agent {
  return { id, specialty } as Agent
}

describe('computeDefaultSubStats · 快速默认词条分配', () => {
  it('低基础暴击（30%）→ 暴击顶满 statCap，再爆伤/攻击（受 TOP2=35 约束）', () => {
    // floor((100-30)/2.4)=29 → 受 statCap 20 封顶；第二个词条只能再吃 15（20+15=35）
    const alloc = computeDefaultSubStats(dpsTemplate, 30, 43, 20)
    expect(alloc).toEqual({ critRate: 20, critDmg: 15, atkPct: 8, penFlat: 0 })
    expect(topTwoOf(alloc)).toBe(SUBSTAT_TOP2_STEP_CAP)
  })

  it('高基础暴击（95%）→ 只补 2 条暴击到百暴，剩下给爆伤/攻击（防溢出）', () => {
    // floor((100-95)/2.4)=2；爆伤顶 20 后攻击只能到 15（TOP2=35），余下给穿透
    const alloc = computeDefaultSubStats(dpsTemplate, 95, 43, 20)
    expect(alloc.critRate).toBe(2)
    expect(alloc.critDmg).toBe(20)
    expect(alloc.atkPct).toBe(15)
    expect(alloc.penFlat).toBe(6)
    expect(topTwoOf(alloc)).toBe(SUBSTAT_TOP2_STEP_CAP)
  })

  it('基础暴击已满（100%）→ 暴击 0 条，顺序填爆伤/攻击/穿透', () => {
    const alloc = computeDefaultSubStats(dpsTemplate, 100, 43, 20)
    expect(alloc).toEqual({ critRate: 0, critDmg: 20, atkPct: 15, penFlat: 8 })
    expect(topTwoOf(alloc)).toBe(SUBSTAT_TOP2_STEP_CAP)
  })

  it('异常角色：精通顶满 + 攻击吃剩余', () => {
    const alloc = computeDefaultSubStats(anomalyTemplate, 5, 32, 20)
    expect(alloc).toEqual({ anomalyProficiency: 20, atkPct: 12 })
  })

  it('预算不足：只按优先序填到预算耗尽', () => {
    const alloc = computeDefaultSubStats(dpsTemplate, 30, 25, 20)
    expect(alloc).toEqual({ critRate: 20, critDmg: 5, atkPct: 0, penFlat: 0 })
  })

  it('转模角色模板：卢西娅 hpPct 首位；洛克茜 v12 已无 defPct（回落到击破兜底）', () => {
    expect(getTemplate(mockAgent('1451', 'support')).stats[0]).toBe('hpPct')
    /**
     * ⚠ **2026-10-26 订正（规则 10 四步）**：洛克茜(1621) 的 `substatTemplate` 原写
     * `['defPct','atkPct','critRate']` = **v12 之前**的旧转模口径（旧 kit「初始防御 >1500 → 防御转攻击/冲击」）。
     * v12 已改为「初始能量自动回复 >1.2 → 攻击/冲击」⇒ **防御对伤害零贡献**，旧模板会让
     * 「最优副词条」把 20 步预算全砸进防御（用户 2026-10-26 抓到「配装默认带防御」）。
     * 处置 = 模块删掉该声明（commit 633f2f70），回落职业兜底 `_default_stun`（暴击率→爆伤→攻击）。
     * 判据本意（「转模源在模板首位」）不变，只是该角色**不再是**转模源。
     */
    expect(getTemplate(mockAgent('1621', 'stun')).stats[0]).toBe('critRate')
    expect(getTemplate(mockAgent('1621', 'stun')).stats).toEqual(['critRate', 'critDmg', 'atkPct', 'penFlat'])
  })

  it('命破默认模板：暴击→爆伤→生命（贯穿吃暴击、生命是基底加法项）', () => {
    expect(getTemplate(mockAgent('1051', 'rupture')).stats).toEqual(['critRate', 'critDmg', 'hpPct'])
    expect(getTemplate(mockAgent('1531', 'rupture')).stats).toEqual(['critRate', 'critDmg', 'hpPct'])
  })

  it('普通辅助/击破默认模板：辅助攻击优先、击破暴击优先', () => {
    expect(getTemplate(mockAgent('9991', 'support')).stats[0]).toBe('atkPct')
    expect(getTemplate(mockAgent('9992', 'stun')).stats[0]).toBe('critRate')
  })

  it('锋御默认模板：防御力进词条、攻击力不进，暴击封顶 200%', () => {
    const claret = getTemplate(mockAgent('1611', 'sharpen'))
    expect(claret.stats).toEqual(['critRate', 'defPct', 'critDmg'])
    expect(claret.stats).not.toContain('atkPct')
    expect(claret.critRateCap).toBe(200)
    // 自动分配：暴击按 200% 封顶吃满 statCap，剩余给防御力
    // （用户 2026-09-09 报「自动副词条给的是攻击不是防御」）
    // 2026-10-26 起还要过 TOP2=35：暴击 20 之后防御只能到 15，余 4 步给暴伤
    // （用户：「最高的两个加起来最好不超过 35」「你这里 20+19 就很超标了」）
    const alloc = computeDefaultSubStats(claret, 76.4, 39, 20)
    expect(alloc.critRate).toBe(20)
    expect(alloc.defPct).toBe(15)
    expect(alloc.critDmg).toBe(4)
    expect(alloc.atkPct ?? 0).toBe(0)
    // 普通角色仍按 100% 封顶
    expect(getTemplate(mockAgent('9992', 'stun')).critRateCap ?? 100).toBe(100)
  })
})

describe('副词条现实性：最高两项 ≤ 35（用户 2026-10-26 裁决）', () => {
  it('全模板 × 全预算组合：默认分配恒不超过 TOP2，且单项不超过 statCap', () => {
    const templates: SubstatTemplate[] = [
      { stats: ['critRate', 'critDmg', 'atkPct', 'penFlat'] },
      { stats: ['anomalyProficiency', 'atkPct'] },
      { stats: ['atkPct', 'hpPct', 'defPct'] },
      { stats: ['hpPct', 'defPct', 'atkPct'] },
      { stats: ['critRate', 'defPct', 'critDmg'], critRateCap: 200 },
      { stats: ['defPct', 'atkPct', 'critRate'] },
    ]
    const offenders: string[] = []
    for (const t of templates) {
      for (const baseCrit of [0, 5, 30, 60, 95, 100, 150, 190]) {
        for (const total of [10, 32, 39, 43, 54]) {
          const alloc = computeDefaultSubStats(t, baseCrit, total, 20)
          if (!fitsTopTwoCap(alloc)) offenders.push(`${t.stats.join('/')} base${baseCrit} total${total} → ${JSON.stringify(alloc)}`)
          for (const [k, v] of Object.entries(alloc)) if (v > 20) offenders.push(`单项超 20：${k}=${v} @${t.stats.join('/')}`)
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('TOP2 只约束前两名：第三/第四条可以吃满（不是「剩余额度」式的误挡）', () => {
    // 4 词条模板：暴击 20 + 爆伤 15 = 35 之后，攻击/穿透都不进前二 ⇒ 不受限
    const alloc = computeDefaultSubStats({ stats: ['critRate', 'critDmg', 'atkPct', 'penFlat'] }, 100, 54, 20)
    expect(alloc.critDmg).toBe(20)
    expect(alloc.atkPct).toBe(15) // 15 ≤ 20 且不进前二（20+15=35 仍达标）
    expect(alloc.penFlat).toBeGreaterThan(0)
    expect(topTwoOf(alloc)).toBe(SUBSTAT_TOP2_STEP_CAP)
  })

  it('两词条模板：20 + 12 = 32 不受影响（本就 ≤35，不误伤）', () => {
    const alloc = computeDefaultSubStats({ stats: ['anomalyProficiency', 'atkPct'] }, 5, 32, 20)
    expect(alloc).toEqual({ anomalyProficiency: 20, atkPct: 12 })
    expect(fitsTopTwoCap(alloc)).toBe(true)
  })
})

describe('副词条预算口径单一来源（arena-D 第 361 轮）', () => {
  const tmpl = (n: number): SubstatTemplate => ({ stats: ['critRate', 'critDmg', 'atkPct', 'penFlat', 'hpPct'].slice(0, n) })
  const none = (_id: string, fallback: number) => fallback

  it('设置全缺省：1–2 词条 32 步、3 词条 39 步、≥4 词条 43 步；单词条上限 20', () => {
    expect([1, 2, 3, 4, 5].map(n => resolveSubstatBudget(tmpl(n), none).totalSteps)).toEqual([32, 32, 39, 43, 43])
    expect(resolveSubstatBudget(tmpl(3), none).statCap).toBe(20)
  })

  it('设置 > 0 覆盖缺省，且读的键与分档一致（1 词条读 totalSteps2，≥5 读 totalSteps4）', () => {
    const settings: Record<string, number> = { 'optimizer.substatCap': 15, 'optimizer.totalSteps2': 30, 'optimizer.totalSteps3': 0, 'optimizer.totalSteps4': 50 }
    const read = (id: string, fallback: number) => settings[id] ?? fallback
    expect([1, 2, 3, 4, 5].map(n => resolveSubstatBudget(tmpl(n), read).totalSteps)).toEqual([30, 30, 39, 50, 50])
    expect(resolveSubstatBudget(tmpl(2), read).statCap).toBe(15)
    expect(SUBSTAT_BUDGET_SETTINGS).toEqual(['optimizer.substatCap', 'optimizer.totalSteps2', 'optimizer.totalSteps3', 'optimizer.totalSteps4'])
  })

  it('写回规整：去掉 ≤0 的键，夹到 54', () => {
    expect(normalizeSubstatAllocation({ critRate: 0, critDmg: 60, atkPct: 3, penFlat: -1 })).toEqual({ critDmg: 54, atkPct: 3 })
  })

  it('源码锁：总步数设置键只在 core/substatOptimizer.ts 出现（视图的输入控件除外）', () => {
    const root = join(__dirname, '..', '..')
    const hits: string[] = []
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f)
        if (statSync(p).isDirectory()) { if (f !== '__tests__') walk(p); continue }
        if (!/\.(ts|vue)$/.test(f) || p.includes(`${join('src', 'views')}`)) continue
        if (readFileSync(p, 'utf8').includes('optimizer.totalSteps')) hits.push(relative(root, p).split('\\').join('/'))
      }
    }
    walk(root)
    expect(hits).toEqual(['core/substatOptimizer.ts'])
  })
})
