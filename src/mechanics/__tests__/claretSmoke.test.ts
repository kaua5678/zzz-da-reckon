/**
 * 克拉蕾(1611) v12 录入生效测试（2026-09-03，nanoka 3.2.12+18601660）：
 * - 锐能：进场 60 + 终结技 10/次（raw chain.description[1]）→ 秘血铸锋 60/发（旧「毁伤回锐能」口径已废除）；
 * - 残痕值：(平A两态秒均×时间 + 其余全部招式 实打次数×gash_buildup 表值) × 积蓄效率（核心 50% + 影画1 20%）→ 每 600 点 = 1 层；
 * - 毁伤：min(层数, 斩金断铁×1+葬血强袭×3)×覆盖率 + 影画6 直接毁伤（层预算不含 C6，R54 修正）；
 * - ★ R55 订正影画分档：**影画1** = 积蓄 +20% 且毁伤倍率 ×130%；**影画2** = 铭刻 +2s 且无视 18% 电抗
 *   （旧实现两档互换 + 电抗值 16 过期，见 `claret.ts` `@fact agent:1611/影画分档`）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setActiveRowFusionRules } from '@/logicEditor/fusion'
import type { RowFusionRule } from '@/logicEditor/types'
import {
  claretMechanic,
  computeClaretSharpResource,
  C1_MAIM_MULT,
  C2_RES_IGNORE,
  GASH_EFF_C1,
  GASH_EFF_CORE,
  INITIAL_CRIT_DMG_TO_CRIT_RATE,
  INSCRIPTION_BENCHMARK_MOVE_ID,
  SHARPNESS_COST_PER_EX,
  SHARPNESS_ULTIMATE_GAIN,
} from '@/mechanics/agents/claret'

beforeEach(() => {
  // setupHarness 内部自建 pinia；这里仅保证 fetch stub 隔离
})

afterEach(() => {
  // 逻辑编辑器行融合规则是模块级状态（logicEditor/fusion.ts），下方 R37-J1 用例会灌规则，跑完必须清空
  setActiveRowFusionRules([])
})

/**
 * R37-J1（2026-09-19，OPEN-ITEMS）：克拉蕾模块曾有**私有** `findMoveById` / `getRowValue`，后者 = `values[0] ?? 0`，
 * **缺** `× getRowFusionMultiplier(move.id, rowId)`（逻辑编辑器 `RowFusionRule`）。引擎其余路径（`getBasicComboMoves` /
 * `averageBasicRows` / `fusedRowValue`）全走带乘数的 `data/moveTableQueries` 版 ⇒ 用户在逻辑编辑器给克拉蕾招式行配
 * 融合规则时，其余角色吃、克拉蕾的平A两态秒均 / 斩金断铁 / 葬血强袭倍率**不吃**。测试态 `activeRowFusions` 默认空，
 * 3000+ 条既有测试全看不见这条分裂——本组用例就是分裂的机器判据（修前必红）。
 *
 * 行为面：给两套平A基准（血锻#3 1611003 / 锻星#3 1611007）的 damage 行都配 ×2 ⇒ 无论铭刻份额多少，
 *   `basicDamagePerSec = 2a(1−s) + 2b·s` 恰为原值 2 倍（mix 线性）；残痕行没配规则 ⇒ 不变（反锁：不是整行全乘）。
 * 形状面：claret.ts 不再有同形私有函数，四个纯查询全部来自 `@/data/moveTableQueries`。
 */
describe('R37-J1 · 逻辑编辑器行融合乘数对克拉蕾生效（私有 getRowValue 漏乘的分裂已合并）', () => {
  const RULE = (moveId: string, multiplier: number, enabled = true): RowFusionRule => ({
    id: `t-${moveId}`, name: 't', agentId: '1611', moveId, rowId: 'damage', multiplier, enabled, note: '',
  })
  async function measure(rules: RowFusionRule[]) {
    // 规则是模块级状态、不在 Vue 响应式图里 ⇒ 必须在首次求值**之前**灌进去，故每次都新建 harness + calc
    const { config } = await setupHarness([{ agentId: '1611', cinemaLevel: 0 }, '', ''])
    setActiveRowFusionRules(rules)
    const calc = useResourceCalc()
    const ch = calc.resourceResult.value!.characters.find(c => c.agentId === '1611')!
    const basic = ch.executions.find(e => e.moveId === 'basic_attack')!
    const src = ch.claretSharpResourceSource!
    return {
      basicDamagePerSec: basic.damageMultiplier ?? 0,
      basicGashPerSec: src.basicGashPerSec,
      share: config.getMechanicSetting('claret.inscriptionBasicTimeShare', 0),
      teamDamage: calc.teamTotalDamage.value,
    }
  }

  it('★ 两套平A基准 damage 行 ×2 ⇒ 平A秒均倍率恰为 2 倍、残痕秒均不变、总伤上升（修前：三者全部不动）', async () => {
    const base = await measure([])
    const doubled = await measure([RULE('1611003', 2), RULE(INSCRIPTION_BENCHMARK_MOVE_ID, 2)])
    expect(base.basicDamagePerSec).toBeGreaterThan(0)
    expect(doubled.basicDamagePerSec).toBeCloseTo(base.basicDamagePerSec * 2, 3)
    expect(doubled.basicGashPerSec).toBeCloseTo(base.basicGashPerSec, 6)
    expect(doubled.teamDamage).toBeGreaterThan(base.teamDamage)
  })

  it('反锁：规则 enabled=false / 只配别人的招式 ⇒ 克拉蕾读数逐位不变', async () => {
    const base = await measure([])
    const disabled = await measure([RULE('1611003', 2, false), RULE(INSCRIPTION_BENCHMARK_MOVE_ID, 2, false)])
    const other = await measure([{ ...RULE('1011001', 2), agentId: '1011' }])
    expect(disabled.basicDamagePerSec).toBe(base.basicDamagePerSec)
    expect(disabled.teamDamage).toBe(base.teamDamage)
    expect(other.basicDamagePerSec).toBe(base.basicDamagePerSec)
    expect(other.teamDamage).toBe(base.teamDamage)
  })

  it('形状面：claret.ts 无同形私有 findMoveById / getRowValue，四个纯查询全部 import 自 @/data/moveTableQueries', () => {
    const src = readFileSync(join(__dirname, '..', 'agents', 'claret.ts'), 'utf8')
    expect(src).not.toMatch(/^function (findMoveById|getRowValue)\b/m)
    expect(src).toMatch(/^import \{[^}]*\bgetRowValue\b[^}]*\} from '@\/data\/moveTableQueries'$/m)
    expect(src).toMatch(/^import \{[^}]*\bfindMoveById\b[^}]*\} from '@\/data\/moveTableQueries'$/m)
  })
})

describe('克拉蕾锐能（v12：进场 60 + 终结技 10/次 → 秘血铸锋 60/发）', () => {
  const base = {
    basicGashPerSec: 0,
    basicAttackTime: 0,
    // 全招式口径（2026-09-12 更正）：平A 外招式按「实打次数 × gash_buildup 表值」求和后传入
    // （1 发秘血铸锋 = 281.97；旧实现这里填 234.96 是 anomaly_buildup 列，且只算 EX 一发）
    moveGashTotal: 281.97,
    cleaveSpecialCount: 1,
    bloodBurialCount: 1,
    gashCoverage: 1,
    cinemaLevel: 0,
    chainCountTotal: 0,
    ultimateCount: 0,
  }

  it('锐能账本 = 进场 60 + 终结技 10/次（0 次 → floor(60/60) = 1 发、结余 0）', () => {
    const r = computeClaretSharpResource({ ...base, cinemaLevel: 0 })
    expect(r.sharpnessGain).toBe(60)
    expect(r.ultimateCount).toBe(0)
    expect(r.affordableExCount).toBe(1)
    expect(r.sharpnessSpend).toBe(SHARPNESS_COST_PER_EX)
    expect(r.sharpnessRemaining).toBe(0)
  })

  it('终结技回锐能计入总量：2 次 → 80（仍 1 发、结余 20）；6 次 → 120 → 2 发', () => {
    // raw chain.description[1]「招式发动时，回复10点锐能」——此前零引用，2026-09-11 接入
    const u2 = computeClaretSharpResource({ ...base, cinemaLevel: 0, ultimateCount: 2 })
    expect(u2.sharpnessGain).toBe(60 + 2 * SHARPNESS_ULTIMATE_GAIN)
    expect(u2.affordableExCount).toBe(1)
    expect(u2.sharpnessRemaining).toBe(20)
    const u6 = computeClaretSharpResource({ ...base, cinemaLevel: 0, ultimateCount: 6 })
    expect(u6.sharpnessGain).toBe(120)
    expect(u6.affordableExCount).toBe(2)
    expect(u6.sharpnessSpend).toBe(120)
    expect(u6.sharpnessRemaining).toBe(0)
    // 负值防御：不给负数锐能
    const neg = computeClaretSharpResource({ ...base, cinemaLevel: 0, ultimateCount: -3 })
    expect(neg.sharpnessGain).toBe(60)
    expect(neg.ultimateCount).toBe(0)
  })

  it('残痕值 = (平A两态秒均×时间 + 其余招式实打×gash_buildup) × 积蓄效率；每 600 点 = 1 层', () => {
    // 仅 1 发 EX：281.97 × 1.5 = 422.955 → 0 层（用户口径：600 点一次毁伤）
    const r = computeClaretSharpResource({ ...base, cinemaLevel: 0 })
    expect(r.gashBuildupMultiplier).toBeCloseTo(1.5, 5)
    expect(r.gashValuePct).toBeCloseTo(281.97 * 1.5, 5)
    expect(r.gashStacks).toBe(0)
    // 平A 1200 + 招式 281.97 → × 1.5 = 2222.955 → 3 层
    const full = computeClaretSharpResource({ ...base, basicGashPerSec: 20, basicAttackTime: 60 })
    expect(full.gashValuePct).toBeCloseTo((1200 + 281.97) * 1.5, 2)
    expect(full.gashStacks).toBe(3)
    // ★ R55 订正：积蓄 +20% 挂在**影画1**（原文 talent.1.desc），旧实现错挂在影画2
    //   （倍率 = 1 + 核心 50% + 影画1 20% = 1.7；命座**累进** ⇒ C2 也含 C1 的积蓄）
    const r1 = computeClaretSharpResource({ ...base, cinemaLevel: 1 })
    expect(r1.gashBuildupMultiplier).toBeCloseTo(1 + GASH_EFF_CORE / 100 + GASH_EFF_C1 / 100, 5)
    // 反锁：门槛两侧 —— C0 没有积蓄加成（旧实现 `>=2` 会让 C1 也拿不到，本条即其判据）
    const r0 = computeClaretSharpResource({ ...base, cinemaLevel: 0 })
    expect(r0.gashBuildupMultiplier).toBeCloseTo(1 + GASH_EFF_CORE / 100, 5)
    const r2 = computeClaretSharpResource({ ...base, cinemaLevel: 2 })
    expect(r2.gashBuildupMultiplier).toBeCloseTo(1 + GASH_EFF_CORE / 100 + GASH_EFF_C1 / 100, 5)
  })

  it('毁伤：min(层数, 需求) 拆分到斩金断铁/葬血强袭；影画6 直接毁伤不消耗残痕', () => {
    // 层数 3（平A 1200 + EX → 2152 × 1.5）：需求 = 斩金断铁1 + 葬血强袭3 = 4 → 消耗 3 → 毁伤 3（cleave 1 + burial 2）
    const full = { ...base, basicGashPerSec: 20, basicAttackTime: 60 }
    const r = computeClaretSharpResource(full)
    expect(r.maimDemand).toBe(4)
    expect(r.gashStackConsumed).toBe(3)
    expect(r.maimFromCleave).toBe(1)
    expect(r.maimFromBurial).toBe(2)
    expect(r.maimCount).toBe(3)
    // C6：连携/终结各 +1 直接毁伤（不占残痕层数）；影画1 也在（×1.7）→ 2519.35 → 4 层
    const r6 = computeClaretSharpResource({ ...full, cinemaLevel: 6, chainCountTotal: 2, ultimateCount: 1 })
    expect(r6.maimFromC6).toBe(3)
    expect(r6.maimCount).toBe(7) // 消耗 4 + C6 3（旧实现被「3 层」整局钳制压成 6——用户 2026-09-12 纠正）
  })

  it('残痕覆盖率 50%：消耗层数按比例折算', () => {
    const full = { ...base, basicGashPerSec: 20, basicAttackTime: 30 }
    const r = computeClaretSharpResource({ ...full, cinemaLevel: 0, gashCoverage: 0.5 })
    // (600+281.97)×1.5=1322.955 → 2 层 × 0.5 = 1 层消耗
    expect(r.gashStackConsumed).toBe(1)
    expect(r.maimCount).toBe(1)
  })

  it('反制支援送残痕：每组控制技 = 琢形直接添加 1 层（600 点，**不吃积蓄效率倍率**、与表值积累并存不双计）', () => {
    // base = 1 发 EX（表值 281.97）→ ×1.5 = 422.955，再 + 2 组送层 1200 = 1622.955 → 2 层
    const r = computeClaretSharpResource({ ...base, counterAssistCount: 2 })
    expect(r.counterAssistGashStacks).toBe(2)
    expect(r.gashValuePct).toBeCloseTo(281.97 * 1.5 + 2 * 600, 4)
    expect(r.gashStacks).toBe(2)
    // 送层直接抬毁伤：需求 = 斩金断铁1 + 葬血强袭3 = 4 → 消耗 2 层 → 毁伤 2
    expect(r.maimCount).toBe(2)
    // 送层不吃倍率：+1 组恰好 +600 点（若按积累走会 ×1.5 = 900）
    const one = computeClaretSharpResource({ ...base, counterAssistCount: 1 })
    expect(one.gashValuePct - computeClaretSharpResource(base).gashValuePct).toBeCloseTo(600, 6)
    // 招式自身的 gash_buildup（表值）与「送的一层」是两个来源，同时在场（不双计＝不互相覆盖）
    expect(r.moveGashValuePct).toBeCloseTo(281.97 * 1.5, 4)
    // 0 组时逐位等于原口径
    expect(computeClaretSharpResource({ ...base, counterAssistCount: 0 }).gashValuePct)
      .toBe(computeClaretSharpResource(base).gashValuePct)
  })

  it('整局可用层数不钳 3（3 = 敌人身上同时存量上限，不是毁伤次数上限）', () => {
    // 平A 6000 点（×1.5=9000）+ 送 1 层 → 16 层；需求 4 → 消耗 4 → 毁伤 4（旧实现会被钳成 3）
    const r = computeClaretSharpResource({
      ...base, basicGashPerSec: 100, basicAttackTime: 60, counterAssistCount: 1,
    })
    expect(r.gashStacks).toBe(16)
    expect(r.gashValuePct).toBeCloseTo((6000 + 281.97) * 1.5 + 600, 4)
    expect(r.gashStackConsumed).toBe(4)
    expect(r.maimCount).toBe(4)
    // 真正卡住毁伤的是消耗需求，不是 3 层
    const noDemand = computeClaretSharpResource({
      ...base, basicGashPerSec: 100, basicAttackTime: 60, cleaveSpecialCount: 0, bloodBurialCount: 0,
    })
    expect(noDemand.gashStacks).toBeGreaterThan(3)
    expect(noDemand.maimCount).toBe(0)
  })
})

describe('克拉蕾全管线冒烟（v12）', () => {
  async function setup() {
    return setupHarness([{ agentId: '1611', cinemaLevel: 0 }, '', ''])
  }

  it('C6 队伍伤害 > C0（命座有效性，含影画1/3/5 生效；C6 直接毁伤入行）', async () => {
    const { config } = await setup()
    const calc = useResourceCalc()
    const d0 = calc.teamTotalDamage.value
    expect(d0).toBeGreaterThan(0)
    config.team[0].cinemaLevel = 6
    const d6 = calc.teamTotalDamage.value
    expect(d6).toBeGreaterThan(d0)
  })

  /**
   * ★ R55 订正：影画1/影画2 门槛互换 —— 真管线三档（C0 / C1 / C2）行为判据。
   *
   * ⚠ 本条**替换**了旧的代理判据「影画1 电抗无视 16% 确实抬高结果（`toBeGreaterThan(0)`）」：
   *   那条按错口径写（电抗在 C1、值 16），且 `toBeGreaterThan` 只证明「有变化」不证明「是哪一档给的」
   *   —— 门槛互换后它**照样绿**（C1 换了别的收益进去），属 R51/R52 踩过两次的代理判据陷阱。
   * 现判据钉在**可分辨的量**上：电抗削减（C2 才给，且值 = 18）与积蓄倍率（C1 才给，值 = 1.7）。
   */
  it('★R55 影画分档：C1 = 积蓄+20% / 毁伤×130%，C2 = 无视18%电抗（门槛两侧三档可分辨）', async () => {
    async function probe(cinemaLevel: number) {
      // 每点独立 setupHarness（硬约束：不许复用同一 calc 的响应式快照）
      await setupHarness([{ agentId: '1611', cinemaLevel }, '', ''])
      const calc = useResourceCalc()
      await new Promise(r => setTimeout(r, 0))
      const ch = calc.resourceResult.value!.characters.find(c => c.agentId === '1611')!
      const maim = ch.executions.find(e => e.moveId === '1611013' && (e.damageMultiplierOverride ?? false))
      return {
        resIgnore: (calc.panels.value[0] as any)?.enemyElectricResReduction ?? 0,
        buildup: ch.claretSharpResourceSource!.gashBuildupMultiplier,
        maimMultiplier: maim?.damageMultiplier ?? 0,
        damage: calc.teamTotalDamage.value,
      }
    }
    const c0 = await probe(0)
    const c1 = await probe(1)
    const c2 = await probe(2)

    // ① 积蓄效率：C1 起给（+20%），C0 没有 —— 门槛两侧各断言一次
    //    ⚠ 命座**累进**：C2 也含 C1 的积蓄加成，故 c2 与 c1 同值（不是「C2 不给」）
    expect(c0.buildup).toBeCloseTo(1 + GASH_EFF_CORE / 100, 5)
    expect(c1.buildup).toBeCloseTo(1 + GASH_EFF_CORE / 100 + GASH_EFF_C1 / 100, 5)
    expect(c2.buildup).toBeCloseTo(c1.buildup, 5)
    // ② 电抗无视：只有 C2 起给，且值 = 18（旧实现错在 C1 且值 16）
    expect(c0.resIgnore).toBe(0)
    expect(c1.resIgnore).toBe(0)
    expect(c2.resIgnore).toBe(C2_RES_IGNORE)
    expect(C2_RES_IGNORE).toBe(18)
    // ③ 毁伤倍率 ×130%：C1 起给（执行行 override 恒存在，C0 = 表值 1625.6%、C1 起 ×1.3）
    expect(c0.maimMultiplier).toBeCloseTo(1625.6, 1)
    expect(c1.maimMultiplier).toBeCloseTo(1625.6 * C1_MAIM_MULT, 1)
    expect(c2.maimMultiplier).toBeCloseTo(c1.maimMultiplier, 1)
    // ④ 总伤害单调：C1/C2 都严格高于 C0（门槛生效的端到端证据）
    expect(c0.damage).toBeGreaterThan(0)
    expect(c1.damage).toBeGreaterThan(c0.damage)
    expect(c2.damage).toBeGreaterThan(c0.damage)
  })

  it('平A双基准：常态血锻 345.21%/s 与铭刻锻星 531.88%/s 按铭刻时间占比加权（改滑块结果确实变）', async () => {
    const { config, catalog } = await setup()
    const calc = useResourceCalc()
    const basicOf = () => calc.resourceResult.value!.characters
      .find(c => c.agentId === '1611')!.executions.find(e => e.moveId === 'basic_attack')!
    const srcOf = () => calc.resourceResult.value!.characters
      .find(c => c.agentId === '1611')!.claretSharpResourceSource!

    // 默认口径 = **账本推导**（滑块 0），总额口径（不算每窗摊多少连携）：
    //   铭刻总时间 = N×16s + 总延长秒（连携×2s + 停表白送时长）
    //   常态时间   = 平A总时间 − 铭刻总时间
    //   锐能总量   = 自动累积 1.5/s × **接战时间**（前后台都回，铭刻内也回）+ 血锻增益 3.0/s × 常态时间 ≥ N×60
    expect(config.getMechanicSetting('claret.inscriptionBasicTimeShare', 0)).toBe(0)
    expect(srcOf().inscriptionBasicTimeShareSource).toBe('ledger')
    expect(srcOf().ultimateCount).toBe(2)
    // 锐能收入两条腿：基础自动累积（catalog level60.sharpnessRegen）+ 血锻招式增益 = 4.5/s
    expect(srcOf().sharpnessAutoPerSec).toBeCloseTo(1.5, 5)
    // 自动累积的时长基准 = 接战时间（用户口径 2026-09-11：前后台都回，不是平A时间）
    expect(srcOf().combatTime).toBeGreaterThan(basicOf().totalTime)
    expect(srcOf().normalAttackSharpnessPerSec).toBeCloseTo(3, 5)
    expect(srcOf().normalSharpnessPerSec).toBeCloseTo(4.5, 5)
    // 总延长秒 = 连携×2s + (连携+终结)动作时长——**连携/大招不吃强化，故不消耗强化时间**（停表覆盖率 100%）
    //   可观测判据：链/大的实际动作时长必须被算进铭刻总时间（16s×轮 + 总延长）
    const chainExec = calc.resourceResult.value!.characters.find(c => c.agentId === '1611')!
      .executions.find(e => e.moveId === '1611020')
    const ultExec = calc.resourceResult.value!.characters.find(c => c.agentId === '1611')!
      .executions.find(e => e.moveId === '1611021')
    const chainSeconds = (chainExec?.actionTime ?? 0) * (chainExec?.count ?? 0)
    const ultSeconds = (ultExec?.actionTime ?? 0) * (ultExec?.count ?? 0)
    expect(chainSeconds).toBeGreaterThan(0)
    expect(ultSeconds).toBeGreaterThan(0)
    expect(srcOf().inscriptionWindowSeconds).toBeCloseTo(
      (chainExec?.count ?? 0) * 2 + chainSeconds + ultSeconds, 5,
    )
    expect(srcOf().inscriptionBasicTime).toBeCloseTo(
      srcOf().inscriptionEntries * 16 + srcOf().inscriptionWindowSeconds, 5,
    )
    expect(srcOf().inscriptionEntries).toBeGreaterThanOrEqual(1)
    // 口径自洽：铭刻 + 常态 恒 = 平A时间；share = 铭刻份额
    expect(srcOf().normalBasicTimeNeeded + srcOf().inscriptionBasicTime).toBeCloseTo(basicOf().totalTime, 5)
    expect(srcOf().inscriptionBasicTimeShare).toBeCloseTo(
      srcOf().inscriptionBasicTime / basicOf().totalTime, 5,
    )
    expect(srcOf().derivedInscriptionTimeShare).toBeCloseTo(srcOf().inscriptionBasicTimeShare, 5)
    expect(basicOf().damageMultiplier).toBeCloseTo(srcOf().basicDamagePerSec, 5)
    expect(basicOf().damageMultiplierOverride).toBe(true)
    expect(basicOf().dazeMultiplierOverride).toBe(true)
    // EX 发数 = 轮数
    const charOf = () => calc.resourceResult.value!.characters.find(c => c.agentId === '1611')!
    expect(charOf().executions.find(e => e.moveId === '1611010')?.count).toBe(srcOf().affordableExCount)

    // 滑块 1–100 = 手动覆盖；60% → 345.208×0.4 + 531.882×0.6 = 457.21；残痕 100×0.4+120×0.6 = 112
    config.setMechanicSetting('claret.inscriptionBasicTimeShare', 60)
    expect(srcOf().inscriptionBasicTimeShareSource).toBe('manual')
    expect(srcOf().basicDamagePerSec).toBeCloseTo(457.21, 1)
    expect(srcOf().basicGashPerSec).toBeCloseTo(112, 5)
    expect(basicOf().damageMultiplier).toBeCloseTo(457.21, 1)
    expect(basicOf().anomalyBuildUp).toBeCloseTo(112, 5)
    // 手动 60% ⇒ 常态段时间 = 平A时间 × 40%（= 滑块直接决定，不再看账本）
    expect(srcOf().normalBasicTimeNeeded).toBeCloseTo(basicOf().totalTime * 0.4, 5)
    // 滑块 20%：345.208×0.8 + 531.882×0.2 = 382.54；残痕 100×0.8+120×0.2 = 104
    config.setMechanicSetting('claret.inscriptionBasicTimeShare', 20)
    expect(srcOf().basicDamagePerSec).toBeCloseTo(345.21 * 0.8 + 531.88 * 0.2, 1)
    expect(srcOf().basicGashPerSec).toBeCloseTo(104, 5)
    // 滑块 → 100%：整段按铭刻锻星基准
    config.setMechanicSetting('claret.inscriptionBasicTimeShare', 100)
    expect(srcOf().basicDamagePerSec).toBeCloseTo(531.88, 1)
    expect(srcOf().basicGashPerSec).toBeCloseTo(120, 5)

    // 基准段来自真实倍率表行（不是硬编码）：1611003 血锻#3 / 1611007 锻星#3
    const moves = catalog.getAgentSkills('1611')!.categories.find(c => c.id === 'basic')!.moves
    const dps = (id: string) => {
      const m = moves.find(x => x.id === id)!
      return m.rows.find(r => r.id === 'damage')!.values[0] / (m.actionTime ?? 1)
    }
    expect(dps('1611003')).toBeCloseTo(345.21, 1)
    expect(dps('1611007')).toBeCloseTo(531.88, 1)
    // 残痕走 gachabase `gash_buildup` 独立列（≠ anomaly_buildup）：锻星 170/1.7 = 120
    const gash = (id: string) => {
      const m = moves.find(x => x.id === id)!
      return m.rows.find(r => r.id === 'gash_buildup')!.values[0] / (m.actionTime ?? 1)
    }
    expect(gash('1611007')).toBeCloseTo(120, 5)
    expect(gash('1611003')).toBeCloseTo(100, 2)
  })

  it('★R55 影画1 毁伤倍率 ×130%：执行行 override 生效（表值 1625.6% × 1.3 = 2113.28%）', async () => {
    const { config } = await setup()
    config.team[0].cinemaLevel = 1
    const calc = useResourceCalc()
    const row = calc.resourceResult.value!.characters.find(c => c.agentId === '1611')!
      .executions.find(e => e.moveId === '1611013' && (e.damageMultiplierOverride ?? false))
    expect(row).toBeTruthy()
    expect(row!.damageMultiplier).toBeCloseTo(1625.6 * C1_MAIM_MULT, 1)
  })
})

describe('克拉蕾初始暴伤→暴击率转化（核心被动：每 1% 初始暴伤 +0.35% 暴击率）', () => {
  function panelWith(initialCritDmg: number, inCombatCritDmg = 0) {
    const panel: any = { critRate: 19.4, critDmg: inCombatCritDmg }
    claretMechanic.applyPanel!({
      slot: 0,
      agent: {} as any,
      cinemaLevel: 0,
      potentialLevel: 6,
      team: [],
      outOfCombatPanel: { critDmg: initialCritDmg } as any,
      panel,
      settings: {},
      enemyStunVuln: 1.5,
    })
    return panel
  }

  it('初始暴伤 40 → 暴击率 +14（40×0.35），再叠核心被动 +30', () => {
    const p = panelWith(40)
    expect(INITIAL_CRIT_DMG_TO_CRIT_RATE).toBe(0.35)
    expect(p.critRate).toBeCloseTo(19.4 + 40 * 0.35 + 30, 5)
  })

  it('初始暴伤 0 → 只有核心被动 +30；局内暴伤拐（珂蕾妲潜能 +35）不参与转化', () => {
    expect(panelWith(0).critRate).toBeCloseTo(19.4 + 30, 5)
    expect(panelWith(0, 35).critRate).toBeCloseTo(19.4 + 30, 5)
  })
})
