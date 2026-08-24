import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { getTargetedStat } from '@/core/buff'
import { calcCrossAgentEnergy } from '@/core/resource/helpers'
import { xideMechanic } from '@/mechanics/agents/xide'

const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')
const buffsText = readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const recsText = readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8')

const baseConfig = {
  wEngineId: '', wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, defAssistCount: 0,
  quickAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1,
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const value = String(url)
    if (value.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
    if (value.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(buffsText) }
    if (value.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(recsText) }
    return { ok: false, json: async () => ({}) }
  }))
}

async function setup(mateId = '1081', cinemaLevel = 0) {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (const buff of config.globalBuffs) buff.enabled = false
  // slot0 席德，slot1 队友（1081 比利 = 物理·强攻 → 正兵/额外能力触发）
  config.team[0] = { slot: 0, agentId: '1461', cinemaLevel, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('席德（1461）正兵拐门控（核心被动/影画2）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })

  it('[强攻]队友在队：明攻攻击+1000/暴伤+30%/围杀增伤+25%；命破/击破队友不生效', async () => {
    // 正例：1081 比利（强攻）
    const pos = await setup('1081', 0)
    expect((computePanelPhases(0, pos.config, pos.catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    const pPos = computePanelPhases(1, pos.config, pos.catalog)!
    const atkOn = (pPos.inCombat as any).atk as number
    const cdOn = (pPos.inCombat as any).critDmg as number
    const dmgOn = (pPos.inCombat as any).dmgBonus as number
    pos.config.toggleTeammateBuff('seed.core_vanguard_bright_attack', false)
    const pOff = computePanelPhases(1, pos.config, pos.catalog)!.inCombat as any
    pos.config.toggleTeammateBuff('seed.core_vanguard_bright_attack', true)
    expect(atkOn - pOff.atk).toBeCloseTo(1000, 0)
    expect(cdOn - pOff.critDmg).toBeCloseTo(30, 5)
    expect(dmgOn - pOff.dmgBonus).toBeCloseTo(25, 5)

    // 负例1：1441 真斗（命破=rupture，原文不触发——击破/命破最易混淆项）
    const neg1 = await setup('1441', 0)
    expect((computePanelPhases(0, neg1.config, neg1.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
    const n1On = computePanelPhases(1, neg1.config, neg1.catalog)!.inCombat as any
    neg1.config.toggleTeammateBuff('seed.core_vanguard_bright_attack', false)
    const n1Off = computePanelPhases(1, neg1.config, neg1.catalog)!.inCombat as any
    neg1.config.toggleTeammateBuff('seed.core_vanguard_bright_attack', true)
    expect(n1On.atk).toBeCloseTo(n1Off.atk, 5)

    // 负例2：1621 洛克茜（击破，无 buff 组）→ 同样不触发
    const neg2 = await setup('1621', 0)
    expect((computePanelPhases(0, neg2.config, neg2.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('影画2：围杀无视20%防御（enemyDefReduction，按额外能力门控）', async () => {
    const pos = await setup('1081', 2)
    const on = (computePanelPhases(1, pos.config, pos.catalog)!.inCombat as any).enemyDefReduction as number
    pos.config.toggleTeammateBuff('seed.cinema_2_encirclement_def_ignore', false)
    const off = (computePanelPhases(1, pos.config, pos.catalog)!.inCombat as any).enemyDefReduction as number
    pos.config.toggleTeammateBuff('seed.cinema_2_encirclement_def_ignore', true)
    expect(on - off).toBeCloseTo(20, 5)

    // 门控：无强攻队友时开关无差分
    const neg = await setup('1441', 2)
    const nOn = (computePanelPhases(1, neg.config, neg.catalog)!.inCombat as any).enemyDefReduction as number
    neg.config.toggleTeammateBuff('seed.cinema_2_encirclement_def_ignore', false)
    const nOff = (computePanelPhases(1, neg.config, neg.catalog)!.inCombat as any).enemyDefReduction as number
    neg.config.toggleTeammateBuff('seed.cinema_2_encirclement_def_ignore', true)
    expect(nOn).toBeCloseTo(nOff, 5)
  })
})

describe('席德自身机制（额外能力/影画4/影画6）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })

  it('额外能力：落华/崩坠/终结技增伤+30%与无视25%电抗（patchExecutions 招式限定）', () => {
    const cfg: any = { xideCinemaLevel: 0, xideAAActive: 1 }
    const moves = ['1461006', '1461007', '1461008', '1461015'].map(moveId => ({ moveId, skillTableNote: '' }) as any)
    const other = { moveId: '1461001', skillTableNote: '' } as any // 霜蕊轮舞#1，不吃
    xideMechanic.patchExecutions!({ cfg, state: {} as any, executions: [...moves, other], teamFrontlineSeconds: 0 } as any)
    for (const e of moves) {
      expect(e.dmgBonus).toBe(30)
      expect(e.resIgnore).toBe(25)
    }
    expect(other.dmgBonus ?? 0).toBe(0)
    expect(other.resIgnore ?? 0).toBe(0)

    // 负例：additionalAbilityActive=0 不施加
    const cfgOff: any = { xideCinemaLevel: 0, xideAAActive: 0 }
    const z = { moveId: '1461006', skillTableNote: '' } as any
    xideMechanic.patchExecutions!({ cfg: cfgOff, state: {} as any, executions: [z], teamFrontlineSeconds: 0 } as any)
    expect(z.dmgBonus ?? 0).toBe(0)
    expect(z.resIgnore ?? 0).toBe(0)
  })

  it('影画差分：4命终结技+20%与喧响效率+10%、6命暴伤+50%', async () => {
    const { catalog, config } = await setup('1081', 0)
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    const ult0 = getTargetedStat(p0, 'skillDmgBonus', 'ultimate')

    config.team[0].cinemaLevel = 4
    config.syncTeammateBuffsFromTeam()
    const p4 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(getTargetedStat(p4, 'skillDmgBonus', 'ultimate') - ult0).toBeCloseTo(20, 5)
    expect(p4.decibelGainEfficiency - (p0.decibelGainEfficiency ?? 0)).toBeCloseTo(10, 5)

    config.team[0].cinemaLevel = 6
    config.syncTeammateBuffsFromTeam()
    const p6 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p6.critDmg - p4.critDmg).toBeCloseTo(50, 5)
  })

  it('影画6 激光：patchExecutions 给落华·重戮行附加 3×165% 攻击力', () => {
    const cfg: any = { xideCinemaLevel: 6, xideAtk: 3000 }
    const laser = { moveId: '1461006', skillTableNote: '' } as any
    const other = { moveId: '1461001', skillTableNote: '' } as any
    xideMechanic.patchExecutions!({ cfg, state: {} as any, executions: [laser, other], teamFrontlineSeconds: 0 } as any)
    expect(laser.flatDamageBonus).toBeCloseTo(3000 * 4.95, 5)
    expect(other.flatDamageBonus ?? 0).toBeCloseTo(0, 5)

    const cfg5: any = { xideCinemaLevel: 5, xideAtk: 3000 }
    const exec5 = { moveId: '1461006', skillTableNote: '' } as any
    xideMechanic.patchExecutions!({ cfg: cfg5, state: {} as any, executions: [exec5], teamFrontlineSeconds: 0 } as any)
    expect(exec5.flatDamageBonus ?? 0).toBeCloseTo(0, 5)
  })
})

describe('席德钢能资源循环（spec resource）', () => {
  const mkState = () => ({
    exSpecialCount: 4, ultimateCount: 2, chainCountTotal: 0,
    basicAttackTime: 0, frontlineTime: 30, backstageTime: 0,
  }) as any
  // 正兵实际耗能 180（严格读 cfg.xideVanguardEnergySpent）→ 180×0.5=90 钢能；攻击数据默认 0
  const mkCfg = (cinema: number, opts: Record<string, any> = {}) => ({
    xideCinemaLevel: cinema,
    exSpecialEnergyConsume: 45,
    xideVanguardEnergySpent: 180,
    xideBasicSteelPerSec: 0,
    xideAttackDataMap: {},
    xideAttackSteel: 0,
    ...opts,
  }) as any

  it('获取=自身耗能×0.5+正兵耗能×0.5+终结技60×次数，消耗=崩坠每次120', () => {
    const cfg = mkCfg(0)
    const result: any = xideMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    const steel = result.specResources.xide_steel_energy
    expect(steel).toBeTruthy()
    expect(steel.initialValue).toBe(60)
    expect(steel.maxValue).toBe(150)
    expect(steel.gains.xide_self_energy_to_steel).toBeCloseTo(90, 5)
    expect(steel.gains.xide_vanguard_energy_to_steel).toBeCloseTo(90, 5)
    expect(steel.gains.xide_ultimate_steel).toBeCloseTo(120, 5)
    expect(steel.gains.xide_c1_ultimate_steel ?? 0).toBeCloseTo(0, 5)
    // 崩坠次数 = floor((60 + 90 + 90 + 120) / 120) = 3
    expect(steel.spendCounts.xide_bengzhui_spend).toBe(3)
    expect(steel.remaining).toBeCloseTo(360 - 3 * 120, 5)
  })

  it('影画1：进场+40、终结技额外+20、崩坠消耗降至100', () => {
    const cfg = mkCfg(1)
    const result: any = xideMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    const steel = result.specResources.xide_steel_energy
    expect(steel.initialValue).toBe(100)
    expect(steel.gains.xide_c1_ultimate_steel).toBeCloseTo(40, 5)
    // total = 100 + 90 + 90 + 120 + 40 = 440 → floor(440/100) = 4 次，余 40
    expect(steel.spendCounts.xide_bengzhui_spend).toBe(4)
    expect(steel.remaining).toBeCloseTo(40, 5)
  })

  it('正兵耗能严格读 cfg.xideVanguardEnergySpent（正兵耗能0则不计）', () => {
    const cfg = mkCfg(0, { xideVanguardEnergySpent: 0 })
    const result: any = xideMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    const steel = result.specResources.xide_steel_energy
    expect(steel.gains.xide_vanguard_energy_to_steel).toBeCloseTo(0, 5)
    // total = 60 + 90 + 120 = 270 → 2 次
    expect(steel.spendCounts.xide_bengzhui_spend).toBe(2)
  })

  it('钢能攻击数据：buildExecutions 统一对全部执行行求和（attack_data_0，平A秒均×时间 + 各招式×次数）', () => {
    const cfg = mkCfg(0, {
      xideVanguardEnergySpent: 0,
      xideBasicSteelPerSec: 11, // attack_data_0 秒均 ≈ 11
      xideAttackDataMap: { '1461009': 29.7, '1461014': 29.5, '1461013': 24.487, '1461016': 7.7 },
    })
    const executions: any[] = [
      { moveId: 'basic_attack', totalTime: 10, count: 0 },
      { moveId: '1461009', count: 4, totalTime: 0 },
      { moveId: '1461014', count: 2, totalTime: 0 },
      { moveId: '1461013', count: 1, totalTime: 0 },  // 闪避反击：取 attack_data_0=24.487
      { moveId: '1461016', count: 3, totalTime: 0 },  // 快速支援：取 attack_data_0=7.7
    ]
    xideMechanic.buildExecutions!({ cfg, state: mkState(), executions } as any)
    // 11×10 + 29.7×4 + 29.5×2 + 24.487×1 + 7.7×3 = 110 + 118.8 + 59 + 24.487 + 23.1 = 335.387
    expect((cfg as any).xideAttackSteel).toBeCloseTo(335.387, 3)
  })

  it('钢能攻击数据：buildResourceResult 读取 cfg.xideAttackSteel 并重算崩坠次数', () => {
    const cfg = mkCfg(0, { xideVanguardEnergySpent: 0, xideAttackSteel: 375.8 })
    const result: any = xideMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    const steel = result.specResources.xide_steel_energy
    // total = 60(初始) + 90(自身耗能) + 120(终结) + 375.8(攻击) = 645.8 → floor(645.8/120)=5
    expect(steel.totalGain).toBeCloseTo(90 + 120 + 375.8, 1)
    expect(steel.spendCounts.xide_bengzhui_spend).toBe(5)
  })

  it('buildExecutions：钢能出口三招落华（重戮+一式+二式）+ 铁萼雨幕衔接重戮', () => {
    // cinema 0：energySpent=4×45=180 → 钢能 60+90+90+120=360 → 3 周期
    const cfg = mkCfg(0)
    const executions: any[] = []
    xideMechanic.buildExecutions!({ cfg, state: mkState(), executions } as any)
    const steel = executions.find((e: any) => e.moveName.includes('钢能快速释放'))
    const rain = executions.find((e: any) => e.moveName.includes('铁萼雨幕衔接'))
    const b1 = executions.find((e: any) => e.moveId === '1461007')
    const b2 = executions.find((e: any) => e.moveId === '1461008')
    expect(steel).toBeTruthy()
    expect(steel.count).toBe(3)
    expect(steel.actionTime).toBeCloseTo(1.316, 5)
    expect(b1.count).toBe(3)
    expect(b2.count).toBe(3)
    expect(rain).toBeTruthy()
    expect(rain.count).toBe(4) // exSpecialCount 4
    expect(rain.dmgBonus ?? 0).toBe(0) // cinema 0 无影画2
    // 三招落华的时间 = 3 × (1.316+0.617+1.534)
    const loopTime = executions
      .filter((e: any) => e.moveName.includes('钢能快速释放') || e.moveId === '1461007' || e.moveId === '1461008')
      .reduce((s: number, e: any) => s + (e.totalTime ?? 0), 0)
    expect(loopTime).toBeCloseTo(3 * (1.316 + 0.617 + 1.534), 5)
  })

  it('buildExecutions：影画2 铁萼雨幕衔接重戮 +60%（每5能量+5% × 60能量）', () => {
    const cfg = mkCfg(2)
    const executions: any[] = []
    xideMechanic.buildExecutions!({ cfg, state: mkState(), executions } as any)
    const rain = executions.find((e: any) => e.moveName.includes('铁萼雨幕衔接'))
    expect(rain.dmgBonus).toBe(60)
  })

  it('patchExecutions：影画1 崩坠暴伤+30% 只挂在 1461007/1461008', () => {
    const cfg: any = { xideCinemaLevel: 1, xideAtk: 3000 }
    const b1 = { moveId: '1461007', skillTableNote: '' } as any
    const b2 = { moveId: '1461008', skillTableNote: '' } as any
    const other = { moveId: '1461006', skillTableNote: '' } as any
    xideMechanic.patchExecutions!({ cfg, state: {} as any, executions: [b1, b2, other], teamFrontlineSeconds: 0 } as any)
    expect(b1.critDmgBonus).toBe(30)
    expect(b2.critDmgBonus).toBe(30)
    expect(other.critDmgBonus ?? 0).toBe(0)
  })

  it('resourceSections 输出钢能资源卡', () => {
    const cfg = mkCfg(0)
    const result: any = xideMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    const sections = xideMechanic.resourceSections!({ result, cfg } as any)
    expect(sections.length).toBeGreaterThan(0)
    expect(sections.some((s: any) => s.title?.includes('钢能'))).toBe(true)
  })
})

describe('席德额外能力为正兵回能（applyTeamConfig + calcCrossAgentEnergy）', () => {
  const mkMember = (slot: number, agentId: string, specialty: string, atkBase: number) => ({
    slot, agentId, cinemaLevel: 0, wEngineId: '', wEngineModLevel: 1,
    agent: { specialty, level60: { atkBase } },
  }) as any

  it('applyTeamConfig：正兵槽位 = 初始攻击最高的强攻队友（击破/异常队友排除）', () => {
    const characters = [
      { agentId: '1461', slot: 0 },
      { agentId: '1081', slot: 1 },
      { agentId: '1621', slot: 2 },
    ] as any
    const team = [
      mkMember(0, '1461', 'attack', 800),
      mkMember(1, '1081', 'attack', 900),
      mkMember(2, '1621', 'stun', 1000), // 击破队友攻击更高但非强攻，排除
    ]
    xideMechanic.applyTeamConfig!({
      slot: 0, agent: null, cinemaLevel: 0, characters, team, settings: {},
      phase: 'build', combatTime: 180, exCounts: [0, 0, 0], stunCount: 0, teamEnergyConsumed: 0,
    } as any)
    expect(characters[0].xideVanguardSlot).toBe(1)
  })

  it('applyTeamConfig：无强攻队友时正兵槽位 = -1', () => {
    const characters = [
      { agentId: '1461', slot: 0 },
      { agentId: '1621', slot: 1 },
    ] as any
    const team = [
      mkMember(0, '1461', 'attack', 800),
      mkMember(1, '1621', 'stun', 1000),
    ]
    xideMechanic.applyTeamConfig!({
      slot: 0, agent: null, cinemaLevel: 0, characters, team, settings: {},
      phase: 'build', combatTime: 180, exCounts: [0, 0], stunCount: 0, teamEnergyConsumed: 0,
    } as any)
    expect(characters[0].xideVanguardSlot).toBe(-1)
  })

  it('calcCrossAgentEnergy：正兵回能取操作时间（前台−合轴）+ 写正兵实际耗能给席德', () => {
    const configs = [
      { agentId: '1461', slot: 0, xideVanguardSlot: 1, exSpecialEnergyConsume: 60 },
      { agentId: '1081', slot: 1, exSpecialEnergyConsume: 80 },
      { agentId: '', slot: 2 },
    ] as any
    const states = [
      { frontlineTime: 30, comboAlignTime: 10, ultimateCount: 0, exSpecialCount: 0, chainCountTotal: 0 }, // 席德：操作时间 20s
      { frontlineTime: 10, comboAlignTime: 0, ultimateCount: 0, exSpecialCount: 3, chainCountTotal: 0 },  // 正兵：3 次强特
      { frontlineTime: 0, comboAlignTime: 0, ultimateCount: 0, exSpecialCount: 0, chainCountTotal: 0 },
    ] as any
    const vanguard = calcCrossAgentEnergy(1, configs, states)
    expect(vanguard.xideVanguardEnergy).toBeCloseTo(40, 5) // (30−10) × 2
    // 算席德自己时写入正兵实际耗能 = 3 × 80 = 240
    const self = calcCrossAgentEnergy(0, configs, states)
    expect(self.xideVanguardEnergy).toBe(0)
    expect((configs[0] as any).xideVanguardEnergySpent).toBe(240)
  })
})
