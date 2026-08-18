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
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'iceDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

describe('莱卡恩（1141）拐力生效（teammate-buffs.json 承载，spec 不重复录入）', () => {
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

  // 安比（1011）无自定义机制、无 teammate-buffs 组，是干净的拐力接收者
  async function setup(withLycaon: boolean) {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: withLycaon ? '1141' : '1011', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1011', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    return { catalog, config }
  }

  it('莱卡恩在队：队友（安比）面板获得 冰抗-25 + 非冰六元素增伤30 + 失衡易伤35（2.6 潜能激发后口径）', async () => {
    const { catalog, config } = await setup(true)
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const ally = computePanelPhases(1, config, catalog)!.inCombat as any
    expect(ally.enemyIceResReduction).toBe(25)
    // 用户确认：boss 受非冰属性伤害提升 → 普通直伤增伤区（非贯穿/异常增伤）→ 元素增伤六项各 30（不含冰）
    for (const stat of ['physicalDmg', 'fireDmg', 'electricDmg', 'etherDmg', 'windDmg', 'lumifluxDmg']) {
      expect(ally[stat]).toBe(30)
    }
    expect(ally.stunDmgMultiplierBonus).toBe(35)
  })

  it('防死数据：莱卡恩不在队时上述字段全为 0（效果确由莱卡恩提供）', async () => {
    const { catalog, config } = await setup(false)
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const ally = computePanelPhases(1, config, catalog)!.inCombat as any
    expect(ally.enemyIceResReduction ?? 0).toBe(0)
    for (const stat of ['physicalDmg', 'fireDmg', 'electricDmg', 'etherDmg', 'windDmg', 'lumifluxDmg']) {
      expect(ally[stat] ?? 0).toBe(0)
    }
    expect(ally.stunDmgMultiplierBonus ?? 0).toBe(0)
  })

  it('includeOwner：莱卡恩自身也吃核心被动拐力（冰抗 debuff 对自己冰伤有效）', async () => {
    const { catalog, config } = await setup(true)
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const self = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(self.enemyIceResReduction).toBe(25)
    expect(self.stunDmgMultiplierBonus).toBe(35)
  })
})

describe('莱卡恩围猎（2.6 潜能激发，后台自动释放；用户口径）', () => {
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

  async function setupWithHunt(stunCountLock: number) {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1141', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1011', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    config.enemy.stunCountLock = stunCountLock // 锁定失衡次数（围猎次数 = 失衡次数）
    return { catalog, config }
  }

  it('4 次失衡：双冰舞×2 + 后台闪反 + 蓄力平A（#2→#4→#6）；冰舞有积蓄/喧响，后台招式仅伤害+失衡', async () => {
    const { config } = await setupWithHunt(4)
    const calc = useResourceCalc()
    const out = calc.resourceResult.value
    expect(out).not.toBeNull()
    const lycaon = out!.characters.find(c => c.agentId === '1141')!

    // 每次围猎 = 开场冰舞 + 收尾冰舞（一轮失衡两个冰舞）。enrich 把 moveName 覆盖成倍率表名，
    // 按 moveId 匹配：通用支援突击是 1141026，1141027 只有围猎行（count = 2 × 失衡次数）
    const huntIces = lycaon.executions.filter(e => e.moveId === '1141027')
    expect(huntIces.length).toBe(1)
    expect(huntIces[0].count).toBe(8) // 2 × 4 次失衡
    // 冰舞是完整招式：有异常积蓄与喧响（仅后台闪反/蓄力平A无积蓄/喧响）
    expect(huntIces[0].anomalyBuildUp ?? 0).toBeGreaterThan(0)
    expect(huntIces[0].decibelRecovery ?? 0).toBeGreaterThan(0)

    // 后台跟随闪反：1141019 且 totalTime=0（通用闪反 totalTime=3.6 区分），次数 = 队伍其他角色闪反之和（安比 6）
    const huntDodge = lycaon.executions.find(e => e.moveId === '1141019' && e.totalTime === 0)
    expect(huntDodge).toBeTruthy()
    expect(huntDodge!.count).toBe(6)
    expect(huntDodge!.anomalyBuildUp ?? 0).toBe(0)
    expect(huntDodge!.decibelRecovery ?? 0).toBe(0)
    expect(huntDodge!.energyRecovery ?? 0).toBe(0)

    // 后台蓄力平A：basic_attack 且 damageMultiplierOverride（围猎行；通用平A无 override）
    const huntBasic = lycaon.executions.find(e => e.moveId === 'basic_attack' && e.moveName?.includes('围猎'))
    expect(huntBasic).toBeTruthy()
    expect(huntBasic!.totalTime).toBeGreaterThan(0)
    expect(huntBasic!.totalTime).toBeLessThanOrEqual(4 * 8)
    expect(huntBasic!.anomalyBuildUp ?? 0).toBe(0)
    // 蓄力段秒均 = #2+#4+#6 三段和 ÷ 三段时长 = 387.7 / 0.939 ≈ 412.9%/s
    expect(huntBasic!.damageMultiplier).toBeCloseTo((74.5 + 113.6 + 199.6) / (0.115 + 0.313 + 0.511), 1)

    // 失衡池：冰舞（完整）+ 后台闪反 + 蓄力平A 都贡献失衡
    const rows = calc.damagePoolRows.value
    const iceRow = rows.find(r => r.moveId === '1141027')
    expect(iceRow).toBeTruthy()
    expect(iceRow!.count).toBe(8)
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)
  })

  it('防死数据：0 次失衡时无围猎行（围猎次数 = 失衡次数）', async () => {
    const { config } = await setupWithHunt(0)
    const calc = useResourceCalc()
    const out = calc.resourceResult.value
    expect(out).not.toBeNull()
    const lycaon = out!.characters.find(c => c.agentId === '1141')!
    expect(lycaon.executions.some(e => e.moveName?.includes('围猎'))).toBe(false)
  })

  it('后台时间预算：无敌时间占用越多 → 围猎平A总时长越短（每次围猎打不满 8s）', async () => {
    await setupWithHunt(4)
    const config = useConfigStore()
    // 无敌 0：后台时间 = 180 - 0 - 4×16 - 莱卡恩前台 − 闪反时间 ≈ 剩余较多
    config.enemy.invincibleTime = 0
    const calc = useResourceCalc()
    const secA = calc.resourceResult.value!.characters.find(c => c.agentId === '1141')!
      .executions.find(e => e.moveId === 'basic_attack' && e.moveName?.includes('围猎'))?.totalTime ?? 0
    expect(secA).toBeGreaterThan(0)
    // 无敌 120：后台时间被压缩 → 围猎平A总时长更短（打不满 32s）
    config.enemy.invincibleTime = 120
    const secB = calc.resourceResult.value!.characters.find(c => c.agentId === '1141')!
      .executions.find(e => e.moveId === 'basic_attack' && e.moveName?.includes('围猎'))?.totalTime ?? 0
    expect(secB).toBeLessThan(secA)
    expect(secB).toBeLessThan(4 * 8)
  })
})

describe('莱卡恩命座与乘区（用户口径）', () => {
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

  async function setup(cinemaLevel: number, chainPerStun = 0) {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1141', cinemaLevel, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1011', cinemaLevel: 0, ...baseConfig, chainCountPerStun: chainPerStun } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    config.enemy.stunCountLock = 4
    return { catalog, config }
  }

  it('核心被动/潜能影像进面板乘区：basic/dodgeCounter/dashAttack 失衡+80，局内冲击 ×1.15', async () => {
    const { catalog, config } = await setup(0)
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p.stunBuildUpBonus__basic).toBe(80)
    expect(p.stunBuildUpBonus__dodgeCounter).toBe(80)
    expect(p.stunBuildUpBonus__dashAttack).toBe(80)
    expect(p.impact).toBeCloseTo(137 * 1.15, 1) // 基础冲击 137 × 潜能 1.15
  })

  it('影画6：莱卡恩自己 dmgBonus +50（全覆盖，用户口径）', async () => {
    const { catalog, config } = await setup(6)
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p6 = computePanelPhases(0, config, catalog)!.inCombat as any
    const { config: cfg0 } = await setup(0)
    const p0 = computePanelPhases(0, cfg0, catalog)!.inCombat as any
    expect(p6.dmgBonus - p0.dmgBonus).toBe(50)
  })

  it('影画1 + 默认全长按：强特只有长按组 #1+#3，C1 强化行 stunBonus 12/22（乘区加算字段）', async () => {
    const { config } = await setup(1)
    const calc = useResourceCalc()
    const lycaon = calc.resourceResult.value!.characters.find(c => c.agentId === '1141')!
    // 默认全长按 → 无点按 #2（1141016）
    expect(lycaon.executions.some(e => e.moveId === '1141016')).toBe(false)
    const ex1 = lycaon.executions.find(e => e.moveId === '1141015')
    const ex3 = lycaon.executions.find(e => e.moveId === '1141017')
    expect(ex1).toBeTruthy()
    expect(ex3).toBeTruthy()
    // 4 次失衡锁定下强特次数 > 0 且全部强化（180s/8s CD = 22 次上限 > 强特次数）
    expect(ex1!.count).toBeGreaterThan(0)
    expect(ex1!.stunBuildUpBonus).toBe(12)
    expect(ex3!.stunBuildUpBonus).toBe(22) // 长按蓄力 #3：12 + 10
  })

  it('滑块 exHoldRatio=0（全点按）：强特只有点按组 #1+#2，无长按 #3', async () => {
    const { config } = await setup(1)
    config.setMechanicSetting('lycaon.exHoldRatio', 0)
    const calc = useResourceCalc()
    const lycaon = calc.resourceResult.value!.characters.find(c => c.agentId === '1141')!
    expect(lycaon.executions.some(e => e.moveId === '1141017')).toBe(false)
    expect(lycaon.executions.some(e => e.moveId === '1141016')).toBe(true)
  })

  it('影画2：回能 = (失衡次数 + 队友连携总次数) × 5，排除莱卡恩自己的连携（用户确认：队友连携才给）', async () => {
    const { config } = await setup(2, 1)
    // 莱卡恩自己也设 1 连携/失衡（应被排除）：队友连携 = 1×4 = 4，莱卡恩自己的 4 不计
    config.team[0].chainCountPerStun = 1
    const calc = useResourceCalc()
    const lycaon = calc.resourceResult.value!.characters.find(c => c.agentId === '1141')!
    expect(lycaon.energySource.lycaonC2Energy).toBe((4 + 4) * 5) // 4 失衡 + 4 队友连携（非 8）
    // 0 命无回能
    const { config: cfg0 } = await setup(0, 1)
    const calc0 = useResourceCalc()
    const lycaon0 = calc0.resourceResult.value!.characters.find(c => c.agentId === '1141')!
    expect(lycaon0.energySource.lycaonC2Energy ?? 0).toBe(0)
  })

  it('前台普攻：全部蓄力段平均秒均 × 平A时间（玩家只打蓄力段，用户口径；失衡提升吃面板 basic 区）', async () => {
    const { config } = await setup(0)
    const calc = useResourceCalc()
    const lycaon = calc.resourceResult.value!.characters.find(c => c.agentId === '1141')!
    const plainBasic = lycaon.executions.find(e => e.moveId === 'basic_attack' && !e.moveName?.includes('围猎'))
    // 全部蓄力段 #2/#4/#6/#8/#10/#11：2077.8% / 5.469s ≈ 379.9%/s；失衡 864.9/5.469 ≈ 158.1/s
    expect(plainBasic).toBeTruthy()
    expect(plainBasic!.damageMultiplier).toBeCloseTo(2077.8 / 5.469, 1)
    expect(plainBasic!.dazeMultiplier).toBeCloseTo(864.9 / 5.469, 1)
    // 围猎行独立存在（后台短循环 412.9，不同于前台的 379.9）
    const huntBasic = lycaon.executions.filter(e => e.moveId === 'basic_attack' && e.moveName?.includes('围猎'))
    expect(huntBasic.length).toBe(1) // stunCountLock=4 → 有围猎行
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)
  })
})
