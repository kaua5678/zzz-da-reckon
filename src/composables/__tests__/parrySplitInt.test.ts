/**
 * Boss 预设弹刀反推集成测试（真实数据）：
 * 应用叶释渊预设（无敌 24s / 秽盾 1 / 默认弹刀总数 13）→ 自动勾选「保底4失衡」→
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
  it('预设字段落库：无敌 24s / 秽盾 1 / 弹刀总数 13，自动勾选「保底4失衡」', async () => {
    const { config } = await setupHarness([...STANDARD_TEAM])
    const { preset, phase, monster, defaults } = yeshiyuanPreset()
    expect(defaults.invincibleTime).toBe(24)
    expect(defaults.shieldCount).toBe(1)
    expect(defaults.parryTotal).toBe(13)

    config.applyBossPreset({ id: preset.id }, phase as never, monster as never, defaults as never)
    expect(config.enemy.invincibleTime).toBe(24)
    expect(config.enemy.shieldCount).toBe(1)
    expect(config.enemy.battleTime).toBe(180)
    expect(config.getMechanicSetting('guarantee.stun', 0)).toBe(1)
  })

  it('应用叶释渊 → 击破位弹刀反推、主C 拿剩余、失衡池达保底 4 次（注入自洽）', async () => {
    const { config } = await setupHarness([...STANDARD_TEAM])
    const { preset, phase, monster, defaults } = yeshiyuanPreset()
    config.applyBossPreset({ id: preset.id }, phase as never, monster as never, defaults as never)

    const calc = useResourceCalc()
    const split = calc.parrySplitResult.value
    expect(split).not.toBeNull()
    expect(split!.breakerSlot).toBe(1)
    // 拆分：击破位 = 反推、主C = 13 − 击破位（输入未填时）
    expect(split!.breakerParry).toBeGreaterThan(0)
    expect(split!.breakerParry).toBeLessThanOrEqual(13)
    expect(split!.mainDpsParry).toBe(13 - split!.breakerParry)

    // 注入自洽：失衡池里击破位弹刀行（招架支援 + 支援突击）count = 拆分出的击破位弹刀次数
    const sp = calc.stunPoolResult.value
    expect(sp).not.toBeNull()
    const breakerRows = sp!.contributions.filter(c => c.slot === 1 && (c.moveName.includes('招架') || c.moveName.includes('支援突击')))
    expect(breakerRows.length).toBe(2)
    for (const row of breakerRows) expect(row.count).toBe(split!.breakerParry)

    // 保底达成：失衡池原始次数 ≥ 4
    expect(sp!.stunCount).toBeGreaterThanOrEqual(4)

    // 反推自洽：T = ceil((4×失衡条 − 非弹刀基数) / 每次弹刀失衡)，封顶 13 = 拆分出的击破位次数
    const perParryDaze = breakerRows.reduce((s, c) => s + c.perHitStun, 0)
    const nonParryStun = sp!.totalStunBuildUp - breakerRows.reduce((s, c) => s + c.totalStun, 0)
    const T = Math.min(13, Math.ceil((4 * config.enemy.stunValue - nonParryStun) / perParryDaze))
    expect(split!.breakerParry).toBe(Math.max(0, T))
  })

  it('队伍失衡输出不足 → 击破位封顶弹刀总数（保底尽力而为，不虚标）', async () => {
    // 无装备的弱势击破位：13 次弹刀也到不了 4 次失衡 → 拆分如实封顶、主C 归 0
    const { config } = await setupHarness([
      { agentId: '1081', parryCount: 0 },
      { agentId: '1251', parryCount: 0 },
      { agentId: '1451', parryCount: 0 },
    ] as never)
    const { preset, phase, monster, defaults } = yeshiyuanPreset()
    config.applyBossPreset({ id: preset.id }, phase as never, monster as never, defaults as never)

    const calc = useResourceCalc()
    const split = calc.parrySplitResult.value
    expect(split).not.toBeNull()
    expect(split!.breakerParry).toBe(13)
    expect(split!.topUp).toBe(13)
    expect(split!.mainDpsParry).toBe(0)
    expect(calc.stunPoolResult.value!.stunCount).toBeLessThan(4)
  })

  it('未勾选「保底4失衡」→ 不反推（拆分不生效）', async () => {
    const { config } = await setupHarness([...STANDARD_TEAM])
    const { preset, phase, monster, defaults } = yeshiyuanPreset()
    config.applyBossPreset({ id: preset.id }, phase as never, monster as never, defaults as never)
    config.setMechanicSetting('guarantee.stun', 0) // 用户手动取消

    const calc = useResourceCalc()
    expect(calc.parrySplitResult.value).toBeNull()
  })

  it('主C 手填弹刀 → 不被默认拆分覆盖', async () => {
    const { config } = await setupHarness([
      { agentId: '1081', parryCount: 8 }, // 主C 手填 8
      gearedBreaker(),
      { agentId: '1451', parryCount: 0 },
    ] as never)
    const { preset, phase, monster, defaults } = yeshiyuanPreset()
    config.applyBossPreset({ id: preset.id }, phase as never, monster as never, defaults as never)

    const calc = useResourceCalc()
    const split = calc.parrySplitResult.value
    expect(split).not.toBeNull()
    expect(split!.mainDpsParry).toBe(8)
  })

  it('队伍无击破位（stun 特性）→ 不反推', async () => {
    const { config } = await setupHarness([
      { agentId: '1081', parryCount: 0 },
      { agentId: '1451', parryCount: 0 },
      { agentId: '1551', parryCount: 0 }, // 佩洛伊斯（attack）
    ] as never)
    const { preset, phase, monster, defaults } = yeshiyuanPreset()
    config.applyBossPreset({ id: preset.id }, phase as never, monster as never, defaults as never)

    const calc = useResourceCalc()
    expect(calc.parrySplitResult.value).toBeNull()
  })
})

describe('Boss 预设不带支援突击弹刀 + 喧响赠礼', () => {
  function bossById(id: string) {
    const preset = bossData.bosses.find(b => b.id === id)
    if (!preset) throw new Error(`boss-presets.json 缺 ${id} 预设`)
    return { preset, phase: preset.phases[0], monster: preset.monster, defaults: preset.defaults }
  }

  it('秽息司祭（15 无突击弹刀）→ 全部归击破位：轻弹刀行 count=15、无支援突击行', async () => {
    const { config } = await setupHarness([...STANDARD_TEAM])
    const { preset, phase, monster, defaults } = bossById('30033')
    expect(defaults.parryNoFollowUpTotal).toBe(15)
    config.applyBossPreset({ id: preset.id }, phase as never, monster as never, defaults as never)

    const calc = useResourceCalc()
    const split = calc.parrySplitResult.value
    expect(split).not.toBeNull()
    expect(split!.breakerNoFollowUp).toBe(15)
    expect(split!.breakerParry).toBe(0) // 无正常弹刀池

    // 击破位（槽位 1）失衡池：只有轻弹刀行（count=15）、无支援突击行
    const sp = calc.stunPoolResult.value!
    const defRow = sp.contributions.find(c => c.slot === 1 && c.moveName.includes('招架'))
    const fuRow = sp.contributions.find(c => c.slot === 1 && c.moveName.includes('支援突击'))
    expect(defRow).toBeTruthy()
    expect(defRow!.count).toBe(15)
    expect(fuRow).toBeUndefined()

    // 喧响：15 × 215 = 3225 计入特殊动作喧响（击破位 perSlotParry = 15）
    const bonus = calc.specialActionBonus.value
    expect(bonus).not.toBeNull()
    expect(bonus!.perSlotParry[1]).toBe(15)
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
    expect(split!.breakerNoFollowUp).toBe(2)
    expect(split!.breakerDecibelOnly).toBe(4)

    // 击破位失衡池：只有无突击弹刀的轻弹刀行（count=2）、无支援突击行；只给喧响弹刀不打 boss → 无行
    const sp = calc.stunPoolResult.value!
    const defRow = sp.contributions.find(c => c.slot === 1 && c.moveName.includes('招架'))
    const fuRow = sp.contributions.find(c => c.slot === 1 && c.moveName.includes('支援突击'))
    expect(defRow).toBeTruthy()
    expect(defRow!.count).toBe(2) // 2 次无突击弹刀（4 次只喧响弹刀无 daze → 不计行）
    expect(fuRow).toBeUndefined()

    // 喧响：击破位 perSlotParry = 2 无突击 + 4 只喧响 = 6
    const bonus = calc.specialActionBonus.value
    expect(bonus!.perSlotParry[1]).toBe(6)

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
