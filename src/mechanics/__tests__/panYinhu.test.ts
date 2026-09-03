import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { panYinhuMechanic } from '@/mechanics/agents/panYinhu'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, defAssistCount: 0,
  quickAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1,
}

async function setup(mateId = '1441', cinemaLevel = 0) {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (const buff of config.globalBuffs) buff.enabled = false
  // slot0 潘引壶，slot1 队友（1441 真斗 = 命破 → 触发额外能力）
  config.team[0] = { slot: 0, agentId: '1421', cinemaLevel, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('潘引壶（1421）核心被动[通窍]贯穿力', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('队友入场获得贯穿力 = 潘引壶初始攻×18%（cap 540）；影画6 放大至24%（cap 720）', async () => {
    const { catalog, config } = await setup('1441', 0)
    const phases0 = computePanelPhases(0, config, catalog)!
    const panAtkOut = (phases0.outOfCombat as any).atk as number

    const withBuff = (computePanelPhases(1, config, catalog)!.inCombat as any).sheerForceFlat as number
    config.toggleTeammateBuff('pan_yinhu.core_open_meridians_sheer_force', false)
    const withoutBuff = (computePanelPhases(1, config, catalog)!.inCombat as any).sheerForceFlat as number
    config.toggleTeammateBuff('pan_yinhu.core_open_meridians_sheer_force', true)

    const expected0 = Math.min(540, panAtkOut * 0.18)
    expect(withBuff - withoutBuff).toBeCloseTo(expected0, 0)
    expect(expected0).toBeGreaterThan(0)

    // 影画6：buffModifiers ×4/3 → 比例24%、上限720（引擎同步放大 cap）
    config.team[0].cinemaLevel = 6
    config.syncTeammateBuffsFromTeam()
    const withC6 = (computePanelPhases(1, config, catalog)!.inCombat as any).sheerForceFlat as number
    const expected6 = Math.min(720, panAtkOut * 0.24)
    expect(withC6 - withoutBuff).toBeCloseTo(expected6, 0)
  })
})

describe('潘引壶额外能力·食铁纳金与影画1（[气绝]增伤门控）', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('[命破]或同阵营（云岿山）队友：气绝增伤+20%、影画1再+10%；无命破非同阵营：全部门控', async () => {
    // 正例1：1441 真斗（命破，怪啖屋 ≠ 云岿山 → 纯专精命中）
    const pos1 = await setup('1441', 0)
    const on1 = (computePanelPhases(1, pos1.config, pos1.catalog)!.inCombat as any).dmgBonus as number
    pos1.config.toggleTeammateBuff('pan_yinhu.additional_stupefaction_dmg', false)
    const off1 = (computePanelPhases(1, pos1.config, pos1.catalog)!.inCombat as any).dmgBonus as number
    pos1.config.toggleTeammateBuff('pan_yinhu.additional_stupefaction_dmg', true)
    expect((computePanelPhases(0, pos1.config, pos1.catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    expect(on1 - off1).toBeCloseTo(20, 5)

    // 正例2：1391 橘福福（击破，云岿山同阵营 → 纯阵营命中）
    const pos2 = await setup('1391', 0)
    expect((computePanelPhases(0, pos2.config, pos2.catalog)!.inCombat as any).additionalAbilityActive).toBe(1)

    // 影画1：气绝敌人增伤再+10%（与额外能力同源门控）
    pos1.config.team[0].cinemaLevel = 1
    pos1.config.syncTeammateBuffsFromTeam()
    const on1c1 = (computePanelPhases(1, pos1.config, pos1.catalog)!.inCombat as any).dmgBonus as number
    expect(on1c1 - on1).toBeCloseTo(10, 5)

    // 负例：1081 比利（强攻，狡兔屋）→ 额外能力与影画1 均被门控，开关无差分
    const neg = await setup('1081', 1)
    const pNeg = computePanelPhases(1, neg.config, neg.catalog)!.inCombat as any
    neg.config.toggleTeammateBuff('pan_yinhu.additional_stupefaction_dmg', false)
    neg.config.toggleTeammateBuff('pan_yinhu.cinema_1_stupefaction_dmg', false)
    const pNegOff = computePanelPhases(1, neg.config, neg.catalog)!.inCombat as any
    expect((computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
    expect(pNeg.dmgBonus).toBeCloseTo(pNegOff.dmgBonus, 5)
  })
})

describe('潘引壶 EX 自动连段：断脉破穴手×3', () => {
  it('每发强特（贴山震脉靠）后自动释放 3 段断脉破穴手（后台追攻行，不占前台）', () => {
    const cfg: any = { panYinhuCinemaLevel: 0, initialEnergyGift: 40 }
    const executions: any[] = []
    panYinhuMechanic.buildExecutions!({ cfg, state: { exSpecialCount: 3 }, executions } as any)
    const chains = executions.filter(e => ['1421007', '1421008', '1421009'].includes(e.moveId))
    expect(chains).toHaveLength(3)
    // 每段各 1 次/EX → 3 发 EX = count 3；后台行不占前台
    expect(chains.map(e => e.count)).toEqual([3, 3, 3])
    for (const e of chains) {
      expect(e.moveId).toMatch(/^142100[789]$/)
      expect(e.category).toBe('special')
      expect(e.timeBucket).toBe('backstage')
      expect(e.actionTime).toBe(0)
      expect(e.totalTime).toBe(0)
    }
    // 0 发 EX 不生成连段行
    const empty: any[] = []
    panYinhuMechanic.buildExecutions!({ cfg, state: { exSpecialCount: 0 }, executions: empty } as any)
    expect(empty.filter(e => ['1421007', '1421008', '1421009'].includes(e.moveId))).toHaveLength(0)
  })

  it('连段行不受影画等级门控（C0 也生成）；与影画2 破劲换能互不干扰', () => {
    const cfg: any = { panYinhuCinemaLevel: 6, initialEnergyGift: 40 }
    const executions: any[] = []
    panYinhuMechanic.buildExecutions!({ cfg, state: { exSpecialCount: 4 }, executions } as any)
    expect(executions.filter(e => ['1421007', '1421008', '1421009'].includes(e.moveId))).toHaveLength(3)
    // 破劲换能照旧：3×4=12 → 2 组 → +8 能量
    expect(cfg.initialEnergyGift).toBe(48)
  })
})

describe('潘引壶 全链集成：断脉破穴手进入执行计划', () => {
  it('resourceResult 含 3 段连段行，倍率表回填 195.2% 且不占前台', async () => {
    const { config } = await setupHarness([
      { agentId: '1421', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1441', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      '',
    ])
    for (const buff of config.globalBuffs) buff.enabled = false
    const calc = useResourceCalc()
    const row = calc.resourceResult.value!.characters.find(ch => ch.agentId === '1421')!
    const chains = row.executions.filter(e => ['1421007', '1421008', '1421009'].includes(e.moveId))
    expect(chains).toHaveLength(3)
    for (const e of chains) {
      expect(e.count).toBeGreaterThan(0)
      expect(e.damageMultiplier).toBeCloseTo(195.2, 1)
      expect(e.dazeMultiplier).toBeCloseTo(62.6, 1)
      expect((e as any).skillTableResolved).toBe(true)
      expect(e.timeBucket).toBe('backstage')
      expect(e.totalTime).toBe(0)
    }
  })
})

describe('潘引壶影画2 破劲换能', () => {
  it('每消耗6点破劲回4能量 = 4×floor(3×强特/6)，幂等注入 initialEnergyGift', () => {
    const cfg: any = { panYinhuCinemaLevel: 2, initialEnergyGift: 40 }
    panYinhuMechanic.buildExecutions!({ cfg, state: { exSpecialCount: 4 }, executions: [] } as any)
    // 破劲消耗 = 3×4 = 12 → floor(12/6)=2 组 → 8 能量
    expect(cfg.initialEnergyGift).toBe(48)
    expect(cfg.panYinhuC2EnergyTotal).toBe(8)

    // 幂等：重复调用不叠加（内层迭代收敛）
    panYinhuMechanic.buildExecutions!({ cfg, state: { exSpecialCount: 4 }, executions: [] } as any)
    expect(cfg.initialEnergyGift).toBe(48)

    // 低命不注入
    const cfg0: any = { panYinhuCinemaLevel: 1, initialEnergyGift: 40 }
    panYinhuMechanic.buildExecutions!({ cfg: cfg0, state: { exSpecialCount: 4 }, executions: [] } as any)
    expect(cfg0.initialEnergyGift).toBe(40)
  })
})
