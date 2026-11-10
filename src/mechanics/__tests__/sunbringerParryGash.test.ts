/**
 * 挽昼（1601）3.4.3 新增的**[招架支援]残痕**——数据钉值 + 生效判据（2026-11-08 批 3）。
 *
 * 原文：「德蕾琪娜成功招架敌人的攻击时，可为敌人积累残痕值」。
 * 数值不在 catalog 的 1601201/2/3 行（gash 全空），而在 gachabase 的 1601206/7/8
 * （animator_event = ParryAid_L/H/…，轻/重/连续），gash_buildup 5664/9914/9914 ⇒ /100。
 *
 * 本文件锁四件事：
 * ① **钉值**：模块常量与 data/raw/gachabase/1601.json 逐位对拍（raw 一变测试就红）；
 * ② **档位由引擎选**：不同 defensiveAssistMoveId 取不同点数，未选中档 = 0；
 * ③ **吃影画1 的 ×1.1 积蓄效率**，且与 basic/ex/chain **在同一处乘**（与灯塔白送层对照负控）；
 * ④ **次数 = parryCount**，且这一项真能把残痕值推过 600 点一档（端到端生效）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildSunbringerCharConfig,
  solveSunbringerLoops,
  SUNBRINGER_PARRY_GASH_BY_ASSIST_MOVE_ID,
  SUNBRINGER_C1_GASH_EFFICIENCY,
  SUNBRINGER_ASSIST_FOLLOW_UP_GASH_EFFICIENCY,
} from '@/mechanics/agents/sunbringer'
import { GASH_PER_LAYER } from '@/mechanics/gashMaim'
import { findAssistFollowUp } from '@/core/resource/moveLookup'
import type { AgentCharConfigInput } from '@/mechanics/types'

const gachabase = JSON.parse(
  readFileSync(new URL('../../../data/raw/gachabase/1601.json', import.meta.url), 'utf8'),
) as { skill_data: Array<{ id: number, gash_buildup: number }> }
/** catalog 的 1601 切片（判据 ⑦ 走真 `buildSunbringerCharConfig`，不手搓 meta） */
const catalog = JSON.parse(
  readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'),
) as {
  agents: { id: string, level60: Record<string, number>, basicBenchmarkMoveId?: string }[]
  agentSkills: { agentId: string }[]
}
const catalogSkills = catalog.agentSkills.find(s => s.agentId === '1601')!
const catalogAgent = catalog.agents.find(a => a.id === '1601')!
const rawGash = (id: number) => (gachabase.skill_data.find(r => Number(r.id) === id)?.gash_buildup ?? 0) / 100

const meta = {
  basic: { damagePerSec: 268.7, gashPerSec: 80.3, sharpPerSec: 2.0 },
  ex: { moveId: '1601106', actionTime: 2.5, damage: 1240.5, daze: 743.7, decibel: 0, gash: 200, sharpness: 0 },
  jufeng: { moveId: '1601015', actionTime: 1.367, damage: 1722.5, daze: 226.3, decibel: 0, gash: 0, sharpness: 0 },
  changan: { moveId: '1601107', actionTime: 3.7, damage: 2690.6, daze: 611.7, decibel: 0, gash: 0, sharpness: 0 },
  torch: { moveId: '1601007', actionTime: 3.667, damage: 2441.1, daze: 605.8, decibel: 0, gash: 0, sharpness: 0 },
  ultA: { moveId: '1601111', actionTime: 2.883, damage: 3900.1, daze: 476.7, decibel: 0, gash: 0, sharpness: 0 },
  ultB: { moveId: '1601011', actionTime: 4.083, damage: 2827, daze: 674.7, decibel: 0, gash: 0, sharpness: 0 },
  maim: { moveId: '1601114', actionTime: 0, damage: 336.3, daze: 0, decibel: 0, gash: 0, sharpness: 0 },
  chain: { moveId: '1601110', actionTime: 2.466, damage: 1550.3, daze: 407.7, decibel: 0, gash: 197.31, sharpness: 0 },
  /** 招架后那一发支援突击（引擎 `findAssistFollowUp` 给 1601 选的就是这条）：gash 表值 186.98 */
  assistFollowUp: { moveId: '1601013', actionTime: 2.2, damage: 1112.6, daze: 188.4, decibel: 0, gash: 186.98, sharpness: 0 },
  sharpnessRegen: 1.5,
} as const

const base = {
  meta: meta as any,
  combatTime: 180,
  basicTime: 90,
  chainCount: 1,
  totalDecibel: 6000,
  ultimateCost: 3000,
}

describe('1601 招架支援残痕（3.4.3）', () => {
  it('① 钉值：模块常量与 gachabase raw 逐位一致（1601206/7/8 ÷100）', () => {
    expect(SUNBRINGER_PARRY_GASH_BY_ASSIST_MOVE_ID['1601201']).toBe(rawGash(1601206))
    expect(SUNBRINGER_PARRY_GASH_BY_ASSIST_MOVE_ID['1601202']).toBe(rawGash(1601207))
    expect(SUNBRINGER_PARRY_GASH_BY_ASSIST_MOVE_ID['1601203']).toBe(rawGash(1601208))
    // 反空洞：raw 里这三行必须真有非零 gash（否则上面的等式退化成 0 === 0）
    expect(rawGash(1601206), '轻招架 raw 必须非 0').toBeGreaterThan(0)
    expect(rawGash(1601207), '重招架 raw 必须非 0').toBeGreaterThan(0)
    expect(rawGash(1601206)).toBeCloseTo(56.64, 6)
    expect(rawGash(1601207)).toBeCloseTo(99.14, 6)
  })

  it('② 档位由引擎选：轻 56.64 / 重 99.14 / 未选中 0', () => {
    const light = solveSunbringerLoops({ ...base, parryCount: 3, defensiveAssistMoveId: '1601201' })
    const heavy = solveSunbringerLoops({ ...base, parryCount: 3, defensiveAssistMoveId: '1601202' })
    const none = solveSunbringerLoops({ ...base, parryCount: 3, defensiveAssistMoveId: '' })
    expect(light.parryGashPerCast).toBeCloseTo(56.64, 6)
    expect(light.parryGash).toBeCloseTo(3 * 56.64, 6)
    expect(heavy.parryGash).toBeCloseTo(3 * 99.14, 6)
    expect(none.parryGash, '未选中任何招架档 ⇒ 0').toBe(0)
  })

  it('③ 吃影画1 ×1.1，且与 basic/ex/chain 同一处乘（灯塔白送层不吃）', () => {
    // C1 的 ×1.1 作用于**整条积累括号**（basic + ex + chain + 招架 + 支援突击），不是只乘招架。
    // 「招架在括号里」的判据：把它拿掉后算出的基线 A0，满足 (A0 + 招架) × 1.1 − A0 = 括号×0.1。
    // ⚠ 本条只验**招架半边**：支援突击那条来源在 ⑤ 单独验 ⇒ 这里用去掉它的 meta 把两个通道隔开
    //   （否则差分里混着两条来源，判据虽然还成立、但断言值会随另一条的改动漂移）。
    const { assistFollowUp: _omitFollow, ...metaParryOnly } = meta
    const parryOnlyBase = { ...base, meta: metaParryOnly as any }
    const noParryC0 = solveSunbringerLoops({ ...parryOnlyBase, parryCount: 0, defensiveAssistMoveId: '1601201' })
    const c0 = solveSunbringerLoops({ ...parryOnlyBase, parryCount: 4, defensiveAssistMoveId: '1601201' })
    const c1 = solveSunbringerLoops({ ...parryOnlyBase, cinemaLevel: 1, parryCount: 4, defensiveAssistMoveId: '1601201' })
    const parryPart = 4 * 56.64
    // ① 招架确实进了括号：差分 = (基线 + 招架) × (1.1 − 1)
    expect(c1.gash - c0.gash).toBeCloseTo((noParryC0.gash + parryPart) * (SUNBRINGER_C1_GASH_EFFICIENCY - 1), 6)
    // ② 负控：若招架被写在乘法**外面**，差分只会是基线 × 0.1 ⇒ 与实测差出 parryPart × 0.1
    const ifOutside = noParryC0.gash * (SUNBRINGER_C1_GASH_EFFICIENCY - 1)
    expect(Math.abs((c1.gash - c0.gash) - ifOutside), '证明不是写在乘法外面').toBeGreaterThan(parryPart * 0.09)
    // 对照负控：灯塔白送层**不吃**效率 ⇒ 在同一命座下，每多一组只 +600（不被 ×1.1 放大）。
    // （不能拿 C0/C1 的绝对值相减：C1 会同时放大 basic/ex/chain，那不是验证白送层。）
    for (const cinemaLevel of [0, 1]) {
      const g0 = solveSunbringerLoops({ ...base, cinemaLevel, counterAssistCount: 0 })
      const g2 = solveSunbringerLoops({ ...base, cinemaLevel, counterAssistCount: 2 })
      expect(g2.gash - g0.gash, `C${cinemaLevel}: 2 组白送 = 1200 点，不吃效率`).toBeCloseTo(2 * GASH_PER_LAYER, 6)
    }
  })

  it('④ 端到端：招架多到跨过 600 一档，层数跟着涨', () => {
    const noParry = solveSunbringerLoops({ ...base, parryCount: 0, defensiveAssistMoveId: '1601201' })
    const manyParry = solveSunbringerLoops({ ...base, parryCount: 20, defensiveAssistMoveId: '1601201' })
    // 一次招架 = 招架支援表值（56.64）+ 紧随的支援突击表值 ×1.15（186.98 × 1.15）
    expect(manyParry.gash - noParry.gash).toBeCloseTo(20 * (56.64 + 186.98 * 1.15), 6)
    expect(manyParry.gashLayers).toBeGreaterThan(noParry.gashLayers)
    expect(manyParry.gashLayers).toBe(Math.floor(manyParry.gash / GASH_PER_LAYER))
  })

  it('次数口径 = parryCount（小数 floor，负数记 0）', () => {
    const frac = solveSunbringerLoops({ ...base, parryCount: 2.9, defensiveAssistMoveId: '1601201' })
    expect(frac.parryGash).toBeCloseTo(2 * 56.64, 6)
    const neg = solveSunbringerLoops({ ...base, parryCount: -5, defensiveAssistMoveId: '1601201' })
    expect(neg.parryGash).toBe(0)
  })

  /**
   * ⑤ **支援突击**那一半（同一句原文的后半「艾尔妲与林德薇恩发动的[支援突击]残痕积蓄效率提升15%」）。
   * 用户 2026-11-10 实录把它坐实：这一招的 rate = 1.15，而普攻/连携/EX/快速支援都是 1.00。
   */
  it('⑤ 支援突击残痕：表值 ×1.15，次数 = parryCount，且进「积累括号」吃影画1 的 ×1.1', () => {
    const c0 = solveSunbringerLoops({ ...base, parryCount: 3, defensiveAssistMoveId: '1601202' })
    expect(c0.assistFollowUpGashPerCast).toBeCloseTo(186.98 * SUNBRINGER_ASSIST_FOLLOW_UP_GASH_EFFICIENCY, 6)
    expect(c0.assistFollowUpGash).toBeCloseTo(3 * 186.98 * 1.15, 6)
    // 进括号（不是写在乘法外面）：C1 的差分必须等于「基线 + 招架 + 支援突击」整括号 × 0.1
    const c1 = solveSunbringerLoops({ ...base, cinemaLevel: 1, parryCount: 3, defensiveAssistMoveId: '1601202' })
    const noParryC0 = solveSunbringerLoops({ ...base, parryCount: 0, defensiveAssistMoveId: '1601202' })
    const parrySide = 3 * 99.14
    const followSide = 3 * 186.98 * 1.15
    expect(c1.gash - c0.gash)
      .toBeCloseTo((noParryC0.gash + parrySide + followSide) * (SUNBRINGER_C1_GASH_EFFICIENCY - 1), 6)
    // 负控：若支援突击被漏在括号外，差分只会是 (基线 + 招架) 的那一份 ⇒ 差出 followSide × 0.1
    const ifOutside = (noParryC0.gash + parrySide) * (SUNBRINGER_C1_GASH_EFFICIENCY - 1)
    expect(Math.abs((c1.gash - c0.gash) - ifOutside), '证明支援突击不是写在乘法外面').toBeGreaterThan(followSide * 0.09)
  })

  it('⑤b 门控：行不产（actionTime 0）/ 没有支援突击 ⇒ 本来源 0，招架那半照旧', () => {
    const metaNoRow = { ...meta, assistFollowUp: { ...meta.assistFollowUp, actionTime: 0 } }
    const noRow = solveSunbringerLoops({ ...base, meta: metaNoRow as any, parryCount: 2, defensiveAssistMoveId: '1601201' })
    expect(noRow.assistFollowUpGash).toBe(0)
    expect(noRow.parryGash).toBeCloseTo(2 * 56.64, 6)
    const { assistFollowUp: _omit, ...metaNoMove } = meta
    const noMove = solveSunbringerLoops({ ...base, meta: metaNoMove as any, parryCount: 2, defensiveAssistMoveId: '1601201' })
    expect(noMove.assistFollowUpGash).toBe(0)
    expect(noMove.parryGash).toBeCloseTo(2 * 56.64, 6)
  })

  /**
   * ⑥ 与用户实测数值对账（外部证据钉在测试里，防止后人把 99.14 或 ×1.1 改掉还没人发现）：
   * - M0 场（rate=1）：重招架 gash 显示 99.14 ⇒ 内部整数 9914；
   * - M2 场（rate=1.1，来源 Sunbringer_Talent_01 = 影画1）：同招显示 109.05。
   * ⚠ 两种取整口径（9914×1.1→10905 vs 99.14×1.1→109.054）在两位小数下不可区分，
   *   引擎按浮点累计、只在折层时 floor ⇒ 与「逐次取整」的差 ≤0.005/次，量级远小于 600 一档。
   */
  it('⑥ 实录对账：99.14 × 1.1 = 109.054 ⇒ 站点显示 109.05', () => {
    const c1 = solveSunbringerLoops({ ...base, cinemaLevel: 1, parryCount: 1, defensiveAssistMoveId: '1601202' })
    expect(c1.parryGashPerCast * SUNBRINGER_C1_GASH_EFFICIENCY).toBeCloseTo(109.054, 6)
    expect(Number((c1.parryGashPerCast * SUNBRINGER_C1_GASH_EFFICIENCY).toFixed(2))).toBe(109.05)
    expect(Number((Math.floor(9914 * 1.1) / 100).toFixed(2))).toBe(109.05)
    expect(GASH_PER_LAYER).toBe(600)
  })

  it('⑦ 引擎接线：buildSunbringerCharConfig 按 cfg.assistFollowUpMoveId 取表值（与 raw 对拍）', () => {
    const cfg: Record<string, unknown> = { assistFollowUpMoveId: '1601013' }
    buildSunbringerCharConfig({
      cfg, skills: catalogSkills, agent: catalogAgent, cinemaLevel: 0,
    } as unknown as AgentCharConfigInput)
    const built = cfg.sunbringerMeta as { assistFollowUp?: { moveId: string, gash: number, actionTime: number } }
    // 链条闭合：引擎 `helpers.ts` 写的 `cfg.assistFollowUpMoveId` 就是 findAssistFollowUp 的选择，
    // 这条断言把「引擎选哪一行」也钉住：catalog 的 assist 段里有两条 Assist Follow-Up
    // （1601013 坚定信仰 / 1601113 不灭的热情），findAssistFollowUp 取第一条 ⇒ 换成另一条
    // 不只是数字变了，而是换了另一招（表值 211.06 而非 186.98）。
    expect(String(findAssistFollowUp(catalogSkills as never)?.moveId)).toBe('1601013')
    expect(built.assistFollowUp?.moveId).toBe('1601013')
    expect(built.assistFollowUp?.gash).toBeCloseTo(rawGash(1601013), 6)
    expect(built.assistFollowUp?.gash, '反空洞：表值必须非 0').toBeGreaterThan(0)
    expect(built.assistFollowUp?.actionTime).toBeGreaterThan(0)
    // 负控：引擎没解析到支援突击（cfg 无 moveId）⇒ 不写该字段，也不写 0 值假元数据
    const cfg2: Record<string, unknown> = {}
    buildSunbringerCharConfig({
      cfg: cfg2, skills: catalogSkills, agent: catalogAgent, cinemaLevel: 0,
    } as unknown as AgentCharConfigInput)
    expect((cfg2.sunbringerMeta as { assistFollowUp?: unknown }).assistFollowUp).toBeUndefined()
  })
})
