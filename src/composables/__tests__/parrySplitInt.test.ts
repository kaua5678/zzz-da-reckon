/**
 * Boss 预设弹刀反推集成测试（真实数据）：
 * 应用叶释渊预设（无敌 24s / 秽盾 1 / 默认弹刀总数 13）→ 自动勾选「失衡次数四舍五入」→
 * 计算器按当前队伍反推击破位弹刀、主C 拿剩余 → 失衡池达保底 4 次（注入自洽）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import type { BossPresetFile } from '@/types/bossPreset'

const bossData = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile

/** 叶释渊（30042）真预设：首个期相位 + 手动默认值 */
function yeshiyuanPreset() {
  const preset = bossData.bosses.find(b => b.id === '30042')
  if (!preset) throw new Error('boss-presets.json 缺 叶释渊 预设')
  return { preset, phase: preset.phases[0], monster: preset.monster, defaults: preset.defaults }
}

/** 击破位（青衣）配好装：冲击力 6 号位 + 震星迪斯科 4 件套 + 专武 → 失衡输出接近实战 */
function gearedBreaker() {
  return {
    agentId: '1251',
    parryCount: 0,
    wEngineId: '14125',
    driveDisc: {
      fourPieceSetId: '31200', // 震星迪斯科
      twoPieceSetId: '',
      mainStats: { 4: 'atkPct', 5: 'electricDmg', 6: 'impact' },
      subStatAllocation: { impact: 6, atkPct: 6 },
    },
  }
}

/** 主C + 击破 + 支援 标准队（弹刀全部未填 = 默认拆分触发条件） */
const STANDARD_TEAM = [
  { agentId: '1081', parryCount: 0 }, // 星徽·比利（attack）主C
  gearedBreaker(),                    // 青衣（stun）击破位
  { agentId: '1451', parryCount: 0 }, // 卢西娅（support）支援
] as never

describe('Boss 预设弹刀反推（叶释渊）', () => {
  it('预设字段落库：无敌 24s / 秽盾 1 / 弹刀总数 13；不再自动勾选目标次数', async () => {
    const { config } = await setupHarness([...STANDARD_TEAM])
    const { preset, phase, monster, defaults } = yeshiyuanPreset()
    expect(defaults.invincibleTime).toBe(24)
    expect(defaults.shieldCount).toBe(1)
    // parryTotal 仍落库（Boss 声明），但它**不再是引擎的优化目标**
    expect(defaults.parryTotal).toBe(13)

    config.applyBossPreset({ id: preset.id }, phase as never, monster as never, defaults as never)
    expect(config.enemy.invincibleTime).toBe(24)
    expect(config.enemy.shieldCount).toBe(1)
    expect(config.enemy.battleTime).toBe(180)
    // ✅ 2026-11-03：人为目标退场 —— 不再自动写「失衡次数四舍五入」
    expect(config.getMechanicSetting('guarantee.stun', 0)).toBe(0)
  })

  /**
   * ⚠ **2026-11-03 用户裁决：普通弹刀不再按目标次数反推**
   *
   * 用户原话：「4 失衡不是下限，甚至不能作为一个指引目标」/「我用四舍五入其实是近似代替了梯度下降的局部最优」。
   * ⇒ 下列用例的旧主题（击破位反推 / 封顶 parryTotal / 主C 拿剩余）**整组作废**；
   * 新主题 = 「用户手填多少就是多少，引擎不改写」+「Boss 特殊交互仍静态分配」。
   */
  it('应用叶释渊 → 普通弹刀直接取 store 输入，引擎不改写', async () => {
    const { config } = await setupHarness([...STANDARD_TEAM])
    const { preset, phase, monster, defaults } = yeshiyuanPreset()
    config.applyBossPreset({ id: preset.id }, phase as never, monster as never, defaults as never)

    const before = config.team.map(c => c.parryCount)
    const calc = useResourceCalc()
    calc.stunPoolResult.value
    // 引擎跑完一轮后，store 里的弹刀次数逐槽不变（没有任何反推写回）
    expect(config.team.map(c => c.parryCount)).toEqual(before)
    // 结果池仍然有效（不是空转）
    expect(calc.stunPoolResult.value).not.toBeNull()
  })

  it('队伍失衡输出不足 → 如实反映，不再按 parryTotal 封顶填充', async () => {
    const { config } = await setupHarness([
      { agentId: '1081', parryCount: 0 },
      { agentId: '1141', parryCount: 0 },
      { agentId: '1211', parryCount: 0 },
    ])
    const { preset, phase, monster, defaults } = yeshiyuanPreset()
    config.applyBossPreset({ id: preset.id }, phase as never, monster as never, defaults as never)
    const calc = useResourceCalc()
    const sp = calc.stunPoolResult.value
    expect(sp).not.toBeNull()
    // 零弹刀输入 ⇒ 池里没有弹刀行（旧实现会按 parryTotal 灌 13 刀）
    // 只认「招架」行（弹刀本体）；「支援突击」也可能是角色自身强特（如莱卡恩的复仇反扑）
    const parryRows = sp!.contributions.filter(c => c.moveName.includes('招架'))
    expect(parryRows.length, '引擎不再替用户灌弹刀').toBe(0)
  })

  it('未勾选「失衡次数四舍五入」→ 行为不变（该开关已无引擎语义）', async () => {
    const { config } = await setupHarness([...STANDARD_TEAM])
    const { preset, phase, monster, defaults } = yeshiyuanPreset()
    config.applyBossPreset({ id: preset.id }, phase as never, monster as never, defaults as never)
    config.setMechanicSetting('guarantee.stun', 0)
    const before = config.team.map(c => c.parryCount)
    const calc = useResourceCalc()
    calc.stunPoolResult.value
    expect(config.team.map(c => c.parryCount)).toEqual(before)
  })

  it('主C 手填弹刀 → 原样保留（既不覆盖也不补）', async () => {
    const { config } = await setupHarness([...STANDARD_TEAM])
    const { preset, phase, monster, defaults } = yeshiyuanPreset()
    config.applyBossPreset({ id: preset.id }, phase as never, monster as never, defaults as never)
    config.setActionCount(0, 'parryCount', 7)
    const calc = useResourceCalc()
    calc.stunPoolResult.value
    expect(config.team[0].parryCount).toBe(7)
  })

  it('队伍无击破位（stun 特性）→ 普通弹刀仍按各槽输入，不做槽位回落分配', async () => {
    const { config } = await setupHarness([
      { agentId: '1371', parryCount: 3 },
      { agentId: '1481', parryCount: 2 },
      { agentId: '1451', parryCount: 0 },
    ])
    const { preset, phase, monster, defaults } = yeshiyuanPreset()
    config.applyBossPreset({ id: preset.id }, phase as never, monster as never, defaults as never)
    const calc = useResourceCalc()
    calc.stunPoolResult.value
    expect([config.team[0].parryCount, config.team[1].parryCount]).toEqual([3, 2])
  })

})

describe('Boss 预设不带支援突击弹刀 + 喧响赠礼', () => {
  function bossById(id: string) {
    const preset = bossData.bosses.find(b => b.id === id)
    if (!preset) throw new Error(`boss-presets.json 缺 ${id} 预设`)
    return { preset, phase: preset.phases[0], monster: preset.monster, defaults: preset.defaults }
  }

  it('秽息司祭（15 无突击弹刀）→ **对半分** 8/7：两槽各有轻弹刀行、无支援突击行', async () => {
    const { config } = await setupHarness([...STANDARD_TEAM])
    const { preset, phase, monster, defaults } = bossById('30033')
    expect(defaults.parryNoFollowUpTotal).toBe(15)
    config.applyBossPreset({ id: preset.id }, phase as never, monster as never, defaults as never)

    const calc = useResourceCalc()
    const split = calc.parrySplitResult.value
    expect(split).not.toBeNull()
    expect(split!.breakerNoFollowUp).toBe(8) // 对半分，奇数归击破位（用户口径 2026-09-10）
    expect(split!.mainDpsNoFollowUp).toBe(7)
    expect(split!.breakerParry).toBe(0) // 无正常弹刀池

    // 击破位（槽位 1）失衡池：只有轻弹刀行（count=8 = 对半分中击破位那半）、无支援突击行
    const sp = calc.stunPoolResult.value!
    const defRow = sp.contributions.find(c => c.slot === 1 && c.moveName.includes('招架'))
    const fuRow = sp.contributions.find(c => c.slot === 1 && c.moveName.includes('支援突击'))
    expect(defRow).toBeTruthy()
    expect(defRow!.count).toBe(8)
    expect(fuRow).toBeUndefined()

    // 喧响：击破位那半 8 次计入特殊动作喧响（perSlotParry = 8；主C 另 7 次计入自己槽位）
    const bonus = calc.specialActionBonus.value
    expect(bonus).not.toBeNull()
    expect(bonus!.perSlotParry[1]).toBe(8)
  })

  it('未知复合侵蚀体 → 6000 喧响赠礼给 1 号位（叠加在进场喧响之上）', async () => {
    const { config } = await setupHarness([...STANDARD_TEAM])
    const { preset, phase, monster, defaults } = bossById('30009')
    expect(defaults.decibelGift).toEqual({ slot: 1, amount: 6000 })

    // 基线：不应用 boss 的 1 号位开局赠送（每人 1000）
    const calcBase = useResourceCalc()
    const baseInitial = calcBase.resourceResult.value?.characters.find(c => c.slot === 1)?.decibelSource?.initialGift ?? 0
    expect(baseInitial).toBeCloseTo(1000, 0)

    config.applyBossPreset({ id: preset.id }, phase as never, monster as never, defaults as never)
    const calc = useResourceCalc()
    const giftInitial = calc.resourceResult.value?.characters.find(c => c.slot === 1)?.decibelSource?.initialGift ?? 0

    // 赠礼 6000 叠加在基础 1000 之上 → 开局赠送 ≈ 7000
    expect(giftInitial - baseInitial).toBeCloseTo(6000, 0)
  })

  it('亵渎者 → 只给喧响弹刀 4（无行）+ 白送 30% 失衡上限', async () => {
    const { config } = await setupHarness([...STANDARD_TEAM])
    const { preset, phase, monster, defaults } = bossById('30038')
    expect(defaults.parryDecibelOnlyTotal).toBe(4)
    expect(defaults.stunGiftRatio).toBe(0.3)

    config.applyBossPreset({ id: preset.id }, phase as never, monster as never, defaults as never)
    // 白送 30% 失衡上限 → bossStunGift = 0.3 × stunValue
    expect(config.enemy.bossStunGift).toBe(Math.round(0.3 * phase.stunValue))

    const calc = useResourceCalc()
    const split = calc.parrySplitResult.value
    expect(split).not.toBeNull()
    expect(split!.breakerNoFollowUp).toBe(1) // 总数 2 → 对半分 1/1（用户口径 2026-09-10）
    expect(split!.mainDpsNoFollowUp).toBe(1)
    expect(split!.breakerDecibelOnly).toBe(4)

    // 击破位失衡池：只有无突击弹刀的轻弹刀行（count=1 = 对半分中击破位那半）、无支援突击行；
    // 只给喧响弹刀不打 boss → 无行
    const sp = calc.stunPoolResult.value!
    const defRow = sp.contributions.find(c => c.slot === 1 && c.moveName.includes('招架'))
    const fuRow = sp.contributions.find(c => c.slot === 1 && c.moveName.includes('支援突击'))
    expect(defRow).toBeTruthy()
    expect(defRow!.count).toBe(1) // 2 次无突击弹刀对半分 → 击破位 1 次（4 次只喧响弹刀无 daze → 不计行）
    expect(fuRow).toBeUndefined()

    // 喧响：击破位 perSlotParry = 1 无突击（对半分） + 4 只喧响 = 5
    const bonus = calc.specialActionBonus.value
    expect(bonus!.perSlotParry[1]).toBe(5)

    // 白送失衡值计入失衡池：总失衡 ≥ bossStunGift
    expect(sp.totalStunBuildUp).toBeGreaterThan(0)
  })

  it('彷徨猎手无敌 2s / 太初梦魇秽盾 2 落库', async () => {
    const { config } = await setupHarness([...STANDARD_TEAM])
    const ph = bossById('30041')
    expect(ph.defaults.invincibleTime).toBe(2)
    config.applyBossPreset({ id: ph.preset.id }, ph.phase as never, ph.monster as never, ph.defaults as never)
    expect(config.enemy.invincibleTime).toBe(2)

    const tm = bossById('40000')
    expect(tm.defaults.shieldCount).toBe(2)
    config.applyBossPreset({ id: tm.preset.id }, tm.phase as never, tm.monster as never, tm.defaults as never)
    expect(config.enemy.shieldCount).toBe(2)
  })
})
