/**
 * 反制支援（Counter Assist）整组替换控制技（紫光技）——通道与口径回归。
 *
 * 游戏口径（`data/raw/nanoka_missing/noun_3.2.3.json` 术语 2000003 + 克拉蕾 1611 招式原文）：
 * [控制技] = 无闪光提示的连续数段攻击，须逐段[招架支援]应对，全部成功 → [完美反制]；
 * [反制支援]「与怪物进行角力，**一次动作整组化解**敌人的控制技」。
 *
 * 用户口径（2026-09-12）：
 * - 预设逐组记段数（`defaults.counterAssistGroups`），有反制支援角色在场时**直接不把这些弹刀计进去**
 *   （不并入 = 无需反扣）；队内没有 / 用户关掉时按旧录入口径并入强制弹刀总数；
 * - 一次反制支援 = 本体(1611028) + 专属支援突击(1611030 琢形) **两行都算**（融合成一次动作）；
 * - 喧响**完全不拿弹刀 215**，只算行内 decibel_recovery；
 * - 承接槽位**可设置**（`boss.counterAssistSlot`，缺省自动取队内有该招式的角色）。
 *
 * 时间口径（用户 2026-09-12）：这两招的秽盾公式是 **300 + 100t** →
 * 1611028 t=(671.67−300)/100=3.717s、1611030 t=(411.67−300)/100=1.117s（catalog 曾按 ether/100 直录）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import type { BossPresetFile, BossPresetDefaults } from '@/types/bossPreset'
import { CLARET_COUNTER_ASSIST, counterAssistOf } from '@/data/counterAssists'
import { CLARET_COUNTER_ASSIST as CLARET_FUSION } from '@/data/moveFusions'
import { fusedGroupMetrics } from '@/core/resource'
import { getAgentMechanic } from '@/mechanics'
import { liveInteractions } from '@/composables/difficultyCurve'
import { fusedRowValue } from '@/composables/resourceCalc/helpers'
import { computeDifficulty } from '@/composables/teamCompare'
import { INTERACTION_WEIGHTS } from '@/types/teamPreset'

const bossData = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile
const catalog = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))

const skillsOf = (agentId: string) => catalog.agentSkills.find((s: { agentId: string }) => s.agentId === agentId)
const moveOf = (agentId: string, moveId: string) => {
  for (const cat of skillsOf(agentId)?.categories ?? []) {
    const m = cat.moves.find((x: { id: string }) => x.id === moveId)
    if (m) return m
  }
  return null
}
const rowOf = (move: { rows: { id: string; values: number[] }[] } | null, id: string) =>
  move?.rows.find(r => r.id === id)?.values[0] ?? 0

/** 主C(1081 attack) / 击破(1251 stun) / 克拉蕾(1611 锋御，非主C非击破 → 自身不被分派 boss 弹刀) */
const TEAM_WITH_CLARET = [
  { agentId: '1081', parryCount: 0 },
  { agentId: '1251', parryCount: 0 },
  { agentId: '1611', parryCount: 0 },
] as never
/** 同队但把克拉蕾换成支援位卢西娅 → 队内无反制支援角色 */
const TEAM_WITHOUT_CLARET = [
  { agentId: '1081', parryCount: 0 },
  { agentId: '1251', parryCount: 0 },
  { agentId: '1451', parryCount: 0 },
] as never

/** 叶释渊预设（真数据：弹刀总数 13）+ 控制技组（用户裁决「暂不录数据」→ 测试内注入，形如 2 组各 3/4 段） */
function presetWith(groups?: number[]) {
  const preset = bossData.bosses.find(b => b.id === '30042')
  if (!preset) throw new Error('boss-presets.json 缺 叶释渊 预设')
  const defaults = { ...preset.defaults } as BossPresetDefaults & { counterAssistGroups?: number[] }
  if (groups) defaults.counterAssistGroups = groups
  return { preset, phase: preset.phases[0], monster: preset.monster, defaults }
}

function applyBoss(config: ReturnType<typeof useConfigStore>, groups?: number[]) {
  const { preset, phase, monster, defaults } = presetWith(groups)
  config.applyBossPreset({ id: preset.id }, phase as never, monster as never, defaults as never)
}

describe('反制支援登记表与倍率表一致性', () => {
  it('登记的 moveId 在 catalog 存在，且确为「反制支援 / 支援突击」两行（防 id 漂移）', () => {
    const decl = counterAssistOf('1611')
    expect(decl).toEqual(CLARET_COUNTER_ASSIST)
    expect(moveOf('1611', decl!.moveId)?.name?.zhCN).toContain('反制支援')
    expect(moveOf('1611', decl!.followUpMoveId)?.name?.zhCN).toContain('支援突击')
    // 该角色 assist 段里确有两条「支援突击」——名字匹配会挑错行，故必须登记 id（见 counterAssists.ts 头注释）
    const followUps = (skillsOf('1611').categories.find((c: { id: string }) => c.id === 'assist').moves)
      .filter((m: { name?: { en?: string } }) => /assist follow-?up/i.test(m.name?.en ?? ''))
    expect(followUps.length).toBeGreaterThanOrEqual(2)
  })

  it('秽盾 300+100t：两行 actionTime 已扣基数（3.717 / 1.117），融合后一次动作 4.834s', () => {
    const body = moveOf('1611', CLARET_COUNTER_ASSIST.moveId)
    const followUp = moveOf('1611', CLARET_COUNTER_ASSIST.followUpMoveId)
    // catalog 的 actionTime 折到 3 位小数（round(t*1000)/1000）→ 断言精度取 3
    expect(rowOf(body, 'ether_purify')).toBeCloseTo(671.67, 2)
    expect(body!.actionTime).toBeCloseTo((rowOf(body, 'ether_purify') - 300) / 100, 3)
    expect(rowOf(followUp, 'ether_purify')).toBeCloseTo(411.67, 2)
    expect(followUp!.actionTime).toBeCloseTo((rowOf(followUp, 'ether_purify') - 300) / 100, 3)
    // 融合组「一次动作」= 本体 + 琢形（两段都占前台）
    const fused = fusedGroupMetrics(skillsOf('1611'), CLARET_FUSION.moveId)
    expect(fused).not.toBeNull()
    expect(fused!.actionTime).toBeCloseTo(body!.actionTime + followUp!.actionTime, 4)
    expect(fused!.decibelRecovery).toBeCloseTo(
      rowOf(body, 'decibel_recovery') + rowOf(followUp, 'decibel_recovery'), 3)
  })

  it('gash_buildup 同样走融合口径：反制支援一次动作 = 本体 446 + 琢形 134 = 580 点', () => {
    // 残痕按「全招式积累」计（2026-09-12 更正），反制支援行是融合行 → 表值必须同为融合和，
    // 否则一次动作只记本体那 446、琢形的 134 静默丢失。
    expect(fusedRowValue(skillsOf('1611') as never, CLARET_COUNTER_ASSIST.moveId, 'gash_buildup'))
      .toBeCloseTo(446 + 134, 3)
  })

  it('融合组登记与招式登记表同源（同一对 moveId，防两处漂移）', () => {
    expect(CLARET_FUSION.terms.map(t => t.moveId)).toEqual([
      CLARET_COUNTER_ASSIST.moveId, CLARET_COUNTER_ASSIST.followUpMoveId,
    ])
    expect(getAgentMechanic('1611')).toBeTruthy()
  })
})

describe('Boss 交互计划折算（store 侧，控制技组 → 弹刀 or 反制支援）', () => {
  it('无反制支援角色在场 → 每组按「1 次正常弹刀 + 段数−1 无突击弹刀」并入强制总数', async () => {
    const { config } = await setupHarness([...TEAM_WITHOUT_CLARET])
    applyBoss(config) // 基线：无组
    expect(config.appliedBoss?.parryTotal).toBe(13)
    expect(config.appliedBoss?.parryNoFollowUpTotal ?? 0).toBe(0)
    expect(config.counterAssistSlot).toBe(-1)

    applyBoss(config, [3, 4])
    expect(config.counterAssistSlot).toBe(-1) // 队内无人有反制支援
    expect(config.appliedBoss?.parryTotal).toBe(13 + 2)
    expect(config.appliedBoss?.parryNoFollowUpTotal).toBe((3 - 1) + (4 - 1))
  })

  it('有反制支援角色在场 → 整组不并入（无需反扣），并折算到该槽位', async () => {
    const { config } = await setupHarness([...TEAM_WITH_CLARET])
    applyBoss(config, [3, 4])
    expect(config.counterAssistSlot).toBe(2) // 克拉蕾在 3 号位（槽 2）
    expect(config.appliedBoss?.parryTotal).toBe(13) // 未被并入
    expect(config.appliedBoss?.parryNoFollowUpTotal ?? 0).toBe(0)

    // 关掉开关 → 立刻退回「按弹刀计」，且数值可逆（幂等：反复折算不累积）
    config.setMechanicSetting('boss.counterAssistReplace', 0)
    expect(config.counterAssistSlot).toBe(-1)
    expect(config.appliedBoss?.parryTotal).toBe(15)
    expect(config.appliedBoss?.parryNoFollowUpTotal).toBe(5)
    config.setMechanicSetting('boss.counterAssistReplace', 1)
    expect(config.appliedBoss?.parryTotal).toBe(13)
    expect(config.appliedBoss?.parryNoFollowUpTotal).toBe(0)
    config.setMechanicSetting('boss.counterAssistReplace', 0)
    expect(config.appliedBoss?.parryTotal).toBe(15)
  })

  it('承接槽位可设置：指定无该招式的槽位时回退自动，指定有该招式的槽位时用指定值', async () => {
    const { config } = await setupHarness([...TEAM_WITH_CLARET])
    applyBoss(config, [3])
    config.setMechanicSetting('boss.counterAssistSlot', 0) // 主C 没有反制支援 → 回退自动（槽 2）
    expect(config.counterAssistSlot).toBe(2)
    config.setMechanicSetting('boss.counterAssistSlot', 2)
    expect(config.counterAssistSlot).toBe(2)
  })
})

describe('反制支援执行行与资源账本（真数据）', () => {
  it('开启替换 → 克拉蕾产出一行反制支援，次数 = 控制技组数，倍率/失衡/喧响 = 融合两行之和', async () => {
    const { config } = await setupHarness([...TEAM_WITH_CLARET])
    applyBoss(config, [3, 4])
    const calc = useResourceCalc()
    const claret = calc.resourceResult.value?.characters.find(c => c.agentId === '1611')
    const row = (claret?.executions ?? []).find(e => e.moveId === CLARET_COUNTER_ASSIST.moveId)
    expect(row, '应有反制支援行').toBeTruthy()
    expect(row!.count).toBe(2)
    expect(row!.moveName).toContain('反制支援')
    const body = moveOf('1611', CLARET_COUNTER_ASSIST.moveId)
    const followUp = moveOf('1611', CLARET_COUNTER_ASSIST.followUpMoveId)
    expect(row!.damageMultiplier).toBeCloseTo(rowOf(body, 'damage') + rowOf(followUp, 'damage'), 1)
    expect(row!.dazeMultiplier).toBeCloseTo(rowOf(body, 'daze') + rowOf(followUp, 'daze'), 1)
    expect(row!.decibelRecovery).toBeCloseTo(
      rowOf(body, 'decibel_recovery') + rowOf(followUp, 'decibel_recovery'), 2)
    // 前台时间：一次动作 = 本体 + 琢形（catalog 行各按 300+100t 折到 3 位小数：3.717 + 1.117）
    expect(row!.actionTime).toBeCloseTo(body!.actionTime + followUp!.actionTime, 4)
    expect(row!.actionTime).toBeCloseTo(4.834, 3)
    expect(row!.totalTime).toBeCloseTo(2 * 4.834, 3)
  })

  it('不拿弹刀 215 特殊动作奖励：克拉蕾的该分量与「无控制技」基线逐位相同', async () => {
    const { config } = await setupHarness([...TEAM_WITH_CLARET])
    applyBoss(config) // 无控制技组
    const calc = useResourceCalc()
    const baseBonus = calc.resourceResult.value?.characters.find(c => c.agentId === '1611')?.decibelSource.specialActionBonus
    expect(baseBonus).toBeTypeOf('number')

    applyBoss(config, [3, 4]) // 整组替换生效
    const caRow = (calc.resourceResult.value?.characters.find(c => c.agentId === '1611')?.executions ?? [])
      .find(e => e.moveId === CLARET_COUNTER_ASSIST.moveId)
    expect(caRow).toBeTruthy() // 她确实打了反制支援
    expect(calc.resourceResult.value?.characters.find(c => c.agentId === '1611')?.decibelSource.specialActionBonus)
      .toBe(baseBonus) // 但一次也没进 215 通道（行内喧响另计）
  })

  it('关掉替换 → 不再产反制支援行，控制技组回到弹刀通道（强制弹刀总数上升）', async () => {
    const { config } = await setupHarness([...TEAM_WITH_CLARET])
    applyBoss(config, [3, 4])
    const calc = useResourceCalc()
    const damageOn = calc.teamTotalDamage.value
    expect((calc.resourceResult.value?.characters.find(c => c.agentId === '1611')?.executions ?? [])
      .some(e => e.moveId === CLARET_COUNTER_ASSIST.moveId)).toBe(true)

    config.setMechanicSetting('boss.counterAssistReplace', 0)
    expect((calc.resourceResult.value?.characters.find(c => c.agentId === '1611')?.executions ?? [])
      .some(e => e.moveId === CLARET_COUNTER_ASSIST.moveId)).toBe(false)
    // 并入生效：boss 强制弹刀总数 13 → 15 无突击 +5，弹刀反推随之重排
    expect(config.appliedBoss?.parryTotal).toBe(15)
    const split = calc.parrySplitResult.value
    expect(split).not.toBeNull()
    expect(split!.breakerParry + split!.mainDpsParry).toBeLessThanOrEqual(15)
    // 开关不是空转：两种交互形态给出不同总伤
    expect(calc.teamTotalDamage.value).not.toBe(damageOn)
  })

  it('琢形送残痕：整组化解每组直接 +1 层，并真抬毁伤次数与伤害（不是只多一行展示）', async () => {
    const { config } = await setupHarness([...TEAM_WITH_CLARET])
    applyBoss(config, [3, 4])
    const calc = useResourceCalc()
    const src = () => calc.resourceResult.value?.characters.find(c => c.agentId === '1611')?.claretSharpResourceSource
    const maimRows = () => (calc.resourceResult.value?.characters.find(c => c.agentId === '1611')?.executions ?? [])
      .filter(e => e.moveId === '1611013').reduce((s, e) => s + e.count, 0)
    const on = src()
    expect(on).toBeTruthy()
    expect(on!.counterAssistGashStacks).toBe(2) // 2 组 → 琢形送 2 层
    expect(on!.gashStacks).toBeGreaterThanOrEqual(2)
    const damageOn = calc.teamTotalDamage.value
    const maimOn = maimRows()
    // 关掉替换：不产反制支援 → 不送层 → 毁伤次数不增（送层的真实效果）
    config.setMechanicSetting('boss.counterAssistReplace', 0)
    const off = src()
    expect(off!.counterAssistGashStacks).toBe(0)
    expect(maimRows()).toBeLessThanOrEqual(maimOn)
    expect(on!.maimCount).toBeGreaterThanOrEqual(off!.maimCount)
    expect(calc.teamTotalDamage.value).not.toBe(damageOn)
  })
})

describe('难度口径：角力 = 一次弹刀同权重（用户 2026-09-12）', () => {
  it('INTERACTION_WEIGHTS.counterAssist 与 parry 同档', () => {
    expect(INTERACTION_WEIGHTS.counterAssist).toBe(INTERACTION_WEIGHTS.parry)
  })

  it('liveInteractions 计入反制支援次数（按承接槽位缩），明细里以「反制支援（角力）」露出', async () => {
    const { config } = await setupHarness([...TEAM_WITH_CLARET])
    applyBoss(config, [3, 4])
    const items = liveInteractions(config, { team: ['1611', '1251', '1081'] } as never)
    const ca = items.find(i => i.type === 'counterAssist')
    expect(ca?.count).toBe(2)
    expect(ca?.slot).toBe(2) // 承接槽位 = 克拉蕾
    const { difficulty, detail } = computeDifficulty(items, ['1611', '1251', '1081'])
    expect(detail).toContain('反制支援（角力）2×1')
    expect(difficulty).toBeGreaterThanOrEqual(2)

    // 关掉替换 → 角力条目消失（那几组回到弹刀通道，不再计这条交互）
    config.setMechanicSetting('boss.counterAssistReplace', 0)
    expect(liveInteractions(config, { team: ['1611', '1251', '1081'] } as never)
      .some(i => i.type === 'counterAssist')).toBe(false)
  })
})
