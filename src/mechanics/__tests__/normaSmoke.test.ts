import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'

const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')
const buffsText = readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const recsText = readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8')

const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'fireDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

describe('诺姆（1571）全管线冒烟：膛温/弹幕/炮塔/火力实验/命座（用户确认口径）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
      if (u.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(buffsText) }
      if (u.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(recsText) }
      return { ok: false, json: async () => ({}) }
    }))
  })

  async function setup(cinemaLevel: number) {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1571', cinemaLevel, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1191', cinemaLevel: 0, ...baseConfig } as any // 艾莲强攻 → 额外能力
    config.team[2] = { slot: 2, agentId: '1011', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    config.enemy.stunCountLock = 4
    return { catalog, config }
  }

  it('膛温完整模型：进场+60 + 接战×1.5 + 弹幕×16 + 长按×8/s + 终结×30 → 帽子把戏 = floor(膛温/80)', async () => {
    const { config } = await setup(0)
    const calc = useResourceCalc()
    const norma = calc.resourceResult.value!.characters.find(c => c.agentId === '1571')!
    const src = norma.normaMechanicSource!
    expect(src.heatInitial).toBe(60)
    expect(src.heatFromExSpecial).toBeGreaterThan(0) // 弹幕次数 > 0
    expect(src.heatFromHold).toBe(2 * 8) // 默认长按 2s × 8
    expect(src.heatTotal).toBeGreaterThan(60 + 8 * 2)
    expect(src.hatToChainCount).toBe(Math.floor(src.heatTotal / 80))
  })

  it('嗯呢弹幕执行：点射×次数 + 破甲/高爆按失衡占比拆 + 延长行；炮塔全程 3s 间隔', async () => {
    const { config } = await setup(0)
    const calc = useResourceCalc()
    const norma = calc.resourceResult.value!.characters.find(c => c.agentId === '1571')!
    expect(norma.exSpecialCount).toBeGreaterThan(0)
    const moveIds = new Set(norma.executions.map(e => e.moveId))
    expect(moveIds.has('1571007')).toBe(true) // 点射
    expect(moveIds.has('1571008')).toBe(true) // 破甲弹头（默认全非失衡）
    // 炮塔自动射击 1571013：floor(180/3) = 60 发
    const tower = norma.executions.find(e => e.moveId === '1571013')
    expect(tower).toBeTruthy()
    expect(tower!.count).toBe(Math.floor(180 / 3))
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)
  })

  it('火力实验导弹舱：失衡+膛温换连携次数 × 8s（C1 12s），失衡内高爆/超出破甲', async () => {
    const { config } = await setup(1)
    const calc = useResourceCalc()
    const norma = calc.resourceResult.value!.characters.find(c => c.agentId === '1571')!
    const src = norma.normaMechanicSource!
    expect(src.missileBayCount).toBeGreaterThanOrEqual(4) // 4 失衡 + 膛温换连携
    expect(src.boostedShotTotal).toBeGreaterThan(0)
    const ap = norma.executions.find(e => e.moveId === '1571014')
    const he = norma.executions.find(e => e.moveId === '1571015')
    expect(ap || he).toBeTruthy() // 至少一种弹头
  })

  it('额外能力（艾莲强攻触发）：失衡易伤 30（teammate-buff 承载，无双计）+ 失衡+2s + 攻击提升', async () => {
    const { catalog, config } = await setup(0)
    const { computePanelPhases, buildCharConfig } = await import('@/composables/resourceCalc/helpers')
    const display = computePanelPhases(0, config, catalog)!.inCombat as any
    const cfg = buildCharConfig(0, config, catalog)!
    // 无双计：展示面板（teammate-buff 30）与计算面板（cfg.panel）一致
    expect(display.stunDmgMultiplierBonus).toBe(30)
    expect(cfg.panel.stunDmgMultiplierBonus).toBe(30)
    expect(display.stunDurationBonusSeconds).toBe(2) // +2s 已进展示面板（applyPanel 修复）
    expect(cfg.normaTechGapStunBonus).toBe(30)
    expect(cfg.normaExtraAbilityAtkBonus).toBe(870)
    const calc = useResourceCalc()
    expect(calc.windowDuration.value).toBe(12 + 4 + 2) // 失衡窗口含 +2s
  })

  it('影画2：技术鸿沟 6%/层 = 60（teammate-buff 30 + cinema_2 30），无重复', async () => {
    const { catalog, config } = await setup(2)
    const { computePanelPhases, buildCharConfig } = await import('@/composables/resourceCalc/helpers')
    const display = computePanelPhases(0, config, catalog)!.inCombat as any
    const cfg = buildCharConfig(0, config, catalog)!
    expect(display.stunDmgMultiplierBonus).toBe(60)
    expect(cfg.panel.stunDmgMultiplierBonus).toBe(60)
    expect(cfg.normaC2EnergyPerTrigger).toBe(25)
    // C2 回能：180s / 20s 冷却 = 9 次 × 25
    const calc = useResourceCalc()
    const norma = calc.resourceResult.value!.characters.find(c => c.agentId === '1571')!
    expect(norma.normaMechanicSource!.c2EnergyTotal).toBe(9 * 25)
  })

  it('影画6：导弹轰击（min(失衡, floor(180/30)) × 8 发）+ 破甲弹头失衡+30% / 高爆弹头伤害+30%', async () => {
    const { config } = await setup(6)
    config.setMechanicSetting('norma.barrageStunShare', 0.5) // 失衡期占比 50% → 破甲/高爆都生成
    const calc = useResourceCalc()
    const norma = calc.resourceResult.value!.characters.find(c => c.agentId === '1571')!
    const src = norma.normaMechanicSource!
    expect(src.c6MissileCount).toBe(Math.min(4, Math.floor(180 / 30)) * 8) // 4×8 = 32
    const c6 = norma.executions.find(e => e.moveId === 'norma_c6_missile')
    expect(c6).toBeTruthy()
    expect(c6!.count).toBe(32)
    expect(c6!.damageMultiplier).toBe(200)
    // C6 技能专属：破甲弹头 daze ×1.3（1571008 表值 324.7 → 422.11）、高爆弹头 dmg ×1.3（1571009 表值 683.5 → 888.55）
    const ap = norma.executions.find(e => e.moveId === '1571008')
    const he = norma.executions.find(e => e.moveId === '1571009')
    expect(ap).toBeTruthy()
    expect((ap as any).dazeMultiplier).toBeCloseTo(324.7 * 1.3, 1)
    expect(he).toBeTruthy()
    expect((he as any).damageMultiplier).toBeCloseTo(683.5 * 1.3, 1)
    // 火力实验弹头同样缩放（1571014 破甲 daze 52.6→68.4、1571015 高爆 dmg 184.7→240.1）
    const ap14 = norma.executions.find(e => e.moveId === '1571014')
    const he15 = norma.executions.find(e => e.moveId === '1571015')
    expect((ap14 as any).dazeMultiplier).toBeCloseTo(52.6 * 1.3, 1)
    expect((he15 as any).damageMultiplier).toBeCloseTo(184.7 * 1.3, 1)
  })

  it('膛温换连携：赠送连携 = 上一位队友本人的连携技（艾莲雪崩 1191016，非诺姆冲击钻探 1571018）并进伤害池', async () => {
    const { config } = await setup(4)
    config.team[1] = { slot: 1, agentId: '1011', cinemaLevel: 0, ...baseConfig, chainCountPerStun: 0 } as any
    config.team[2] = { slot: 2, agentId: '1191', cinemaLevel: 0, ...baseConfig } as any // 上一位队友（环绕）= slot 2
    const calc = useResourceCalc()
    const rows = calc.damagePoolRows.value
    // 帽子把戏替换的是上一位队友的快速支援 → 该队友本人连携技，不许再出现诺姆自己的 1571018
    expect(rows.some(r => r.moveId === '1571018')).toBe(false)
    const gifted = rows.filter(r => r.moveId === '1191016' && r.count > 0)
    // 上一位队友（slot 2）有赠送连携行且有伤害
    const allyGift = gifted.find(r => r.slot === 2)
    expect(allyGift).toBeTruthy()
    expect(allyGift!.count).toBeGreaterThan(0)
    expect(allyGift!.totalDamage).toBeGreaterThan(0)
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)
    // 展示层：赠送执行带 normaGiftChain 标记，招式名与倍率取艾莲技能表
    const ally = calc.resourceResult.value!.characters.find(c => c.slot === 2)!
    const giftExec = ally.executions.find(e => e.normaGiftChain)
    expect(giftExec).toBeTruthy()
    expect(giftExec!.moveId).toBe('1191016')
    expect(giftExec!.moveName).toBe('连携技：雪崩（诺姆膛温替换）')
    expect(giftExec!.damageMultiplier).toBeCloseTo(1589.9, 1)
    expect(giftExec!.actionTime).toBeCloseTo(3.233, 2)
  })

  it('失衡轴：无琉音时 promoteVariant 块不执行；诺姆转连携自动全打且展示层可见', async () => {
    const { config } = await setup(0)
    // 队伍无琉音（1571+1191+1011），轴里捏 promoteVariant 90（艾莲终结技 1191017）
    config.team[1] = { slot: 1, agentId: '1191', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '1011', cinemaLevel: 0, ...baseConfig } as any
    config.useStunAxis = true
    config.stunAxes = [{
      name: '轴1', count: 2,
      actions: [
        { slot: 1, moveId: '1191017', count: 1, promoteVariant: '90', startTime: 0 },
        { slot: 0, moveId: '1571013', count: 1, startTime: 2 },
      ],
      basicFillerSlot: 0,
    }]
    config.enemy.stunCountLock = 3
    const calc = useResourceCalc()
    const rows = calc.damagePoolRows.value
    // 无琉音：promoteVariant 块被跳过（艾莲终结技只来自她自己的轴外次数，不因转大块增加）。
    // 轴外次数口径：特殊动作/异常奖励已计入喧响推导（弹刀10×215+闪反+伴随 ≈ 3000+）→ 3 次
    const ultRow = rows.find(r => r.moveId === '1191017')
    const ellen = calc.resourceResult.value!.characters.find(c => c.agentId === '1191')!
    expect(ultRow?.count ?? 0).toBe(3)
    expect(ultRow?.count ?? 0).toBe(ellen.ultimateCount)
    // 展示层（resourceResult）可见诺姆赠送连携：上一位队友 slot 2（安比）的 executions 含其本人
    // 连携技 1011010（电磁引擎，带 normaGiftChain 标记）
    const rr = calc.resourceResult.value!
    const ally = rr.characters.find(c => c.slot === 2)!
    expect(ally.executions.some(e => e.moveId === '1011010' && e.normaGiftChain)).toBe(true)
    expect(ally.chainCountTotal).toBeGreaterThan(0)
  })

  it('膛温接战按整局时间（帽子后场同速积蓄）：180×1.5=270，赠送连携 ≥4 次', async () => {
    const { config } = await setup(0)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const norma = calc.resourceResult.value!.characters.find(c => c.agentId === '1571')!
    const src = norma.normaMechanicSource!
    expect(src.heatFromFrontline).toBeCloseTo(180 * 1.5, 1) // 接战自动回复按整局战斗时间
    expect(src.hatToChainCount).toBeGreaterThanOrEqual(4) // 用户口径：一局 4 次往上很容易
  })

  it('轴内「怒焰·赠」块（sourceTag=gift）：不占目标普通连携次数、赠送连携吃易伤由块标记', async () => {
    const { config } = await setup(0)
    // 上一位队友 = slot 2 安比；般岳不在队 → 用艾莲(slot1)当目标？不——直接沿用 setup 队伍：
    // 诺姆 slot0，上一位队友 slot2（安比 1011）。给安比槽位放「怒焰·赠」块（连携技 1011010 sourceTag=gift）。
    config.useStunAxis = true
    config.enemy.stunCountLock = 4
    config.stunAxes = [{
      name: '轴1',
      actions: [
        { slot: 2, moveId: '1011010', count: 1, startTime: 0 },
        { slot: 2, moveId: '1011010', count: 1, startTime: 4, sourceTag: 'gift' as const },
      ],
    }]
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const rr = calc.resourceResult.value!
    const ally = rr.characters.find(c => c.slot === 2)!
    // 普通连携 = 仅非 gift 块（1×4窗 = 4 次），gift 块不占用（chainCountTotal 另含赠送 hatCount）
    const ownChain = ally.executions.find(e => e.moveId === '1011010' && !e.normaGiftChain)
    expect(ownChain?.count).toBe(4)
    expect(ally.chainCountTotal).toBe(4 + (rr.characters.find(c => c.agentId === '1571')!.normaMechanicSource!.hatToChainCount))
    // 赠送连携行存在且按 gift 块吃易伤（4 窗 × 1 = 4 次轴内）
    const rows = calc.damagePoolRows.value
    const giftRows = rows.filter(r => r.moveId === '1011010' && r.sourceTag === 'gift')
    expect(giftRows.length).toBeGreaterThan(0)
    const inStun = giftRows.filter(r => (r.stunMult ?? 0) > 1).reduce((s, r) => s + (r.count ?? 0), 0)
    expect(inStun).toBeGreaterThan(0)
    // 普通连携行仍存在（stun 归因）
    expect(rows.some(r => r.moveId === '1011010' && r.sourceTag !== 'gift')).toBe(true)
  })
})
