import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { inferSkillDamageTarget } from '@/core/damage'
import { getTargetedStat } from '@/core/buff'
import { orphieMechanic } from '@/mechanics/agents/orphie'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, defAssistCount: 0,
  quickAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1,
}

async function setup(mateId = '1621', cinemaLevel = 0) {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (const buff of config.globalBuffs) buff.enabled = false
  config.team[0] = { slot: 0, agentId: '1301', cinemaLevel, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

/** 原文视为[追加攻击]的招式（高压火枪全6段为用户确认口径） */
const ADDITIONAL_MOVE_IDS = new Set([
  '1301001', '1301002', '1301003', '1301004', '1301005', '1301006',
  '1301009', '1301010', '1301011', '1301022', '1301014', '1301015', '1301016',
])

describe('奥菲丝（1301）追加攻击 tag 与定向增伤', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('catalog 打标：13 个原文招式带 additionalAttack，其余招式不带', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    const skills = catalog.getAgentSkills('1301')
    expect(skills).toBeTruthy()
    const seen: string[] = []
    for (const category of skills!.categories) {
      for (const move of category.moves) {
        const tagged = (move.skillTags ?? []).includes('additionalAttack')
        expect(tagged, `${move.id} ${move.name?.zhCN}`).toBe(ADDITIONAL_MOVE_IDS.has(move.id))
        seen.push(move.id)
      }
    }
    for (const id of ADDITIONAL_MOVE_IDS) expect(seen).toContain(id)
  })

  it('inferSkillDamageTarget：additionalAttack tag 优先于类别推断', () => {
    const fakeCategory = { id: 'chain' } as any
    const tagged = { id: 'x', name: { zhCN: '连携技：枪管过热' }, skillTags: ['additionalAttack'] } as any
    const plain = { id: 'y', name: { zhCN: '连携技：某招式' } } as any
    expect(inferSkillDamageTarget(fakeCategory, tagged)).toBe('additionalAttack')
    expect(inferSkillDamageTarget(fakeCategory, plain)).toBe('chain')
  })

  it('核心被动自身面板：暴击率+25%、追加攻击增伤+85% 只进增伤区的 additionalAttack 定向', async () => {
    const { catalog, config } = await setup('1621', 0)
    const phases = computePanelPhases(0, config, catalog)!
    const out = phases.outOfCombat as any
    const inC = phases.inCombat as any
    expect(inC.critRate - out.critRate).toBeCloseTo(25, 5)
    const additionalBonus = getTargetedStat(inC, 'skillDmgBonus', 'additionalAttack')
      - getTargetedStat(out, 'skillDmgBonus', 'additionalAttack')
    expect(additionalBonus).toBeCloseTo(85, 5)
    // 其他招式类别不吃这 85%（增伤区按 tag 定向，不是全局增伤）
    expect(getTargetedStat(inC, 'skillDmgBonus', 'basic') - getTargetedStat(out, 'skillDmgBonus', 'basic')).toBeCloseTo(0, 5)
    expect((inC.skillDmgBonus ?? 0) - (out.skillDmgBonus ?? 0)).toBeCloseTo(0, 5)
  })

  it('影画差分：1命火抗无视15%、2命攻击+20%、4命终结技增伤+40%', async () => {
    const { catalog, config } = await setup('1621', 0)
    const phases0 = computePanelPhases(0, config, catalog)!
    const p0 = phases0.inCombat as any

    config.team[0].cinemaLevel = 1
    config.syncTeammateBuffsFromTeam()
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    // 影画1 火抗无视15% 已改 moveId 级 resIgnore（不再面板宽泛）
    expect((p1.enemyFireResReduction ?? 0) - (p0.enemyFireResReduction ?? 0)).toBeCloseTo(0, 5)
    const cfg1: any = { orphieCinemaLevel: 1 }
    const exRes: any = { moveId: '1301008' }
    orphieMechanic.patchExecutions!({ cfg: cfg1, state: {} as any, executions: [exRes], teamFrontlineSeconds: 0 } as any)
    expect(exRes.resIgnore).toBe(15) // 招式限定精确（不是全火伤面板）

    config.team[0].cinemaLevel = 2
    config.syncTeammateBuffsFromTeam()
    const phases2 = computePanelPhases(0, config, catalog)!
    const p2 = phases2.inCombat as any
    // 影画2 按面板攻击乘20%近似（velina 先例）
    expect(p2.atk - p1.atk).toBeCloseTo(p1.atk * 0.2, 0)

    config.team[0].cinemaLevel = 4
    config.syncTeammateBuffsFromTeam()
    const p4 = computePanelPhases(0, config, catalog)!.inCombat as any
    const ultDmg4 = getTargetedStat(p4, 'skillDmgBonus', 'ultimate')
    const ultDmg2 = getTargetedStat(p2, 'skillDmgBonus', 'ultimate')
    expect(ultDmg4 - ultDmg2).toBeCloseTo(40, 5)
  })
})

describe('奥菲丝影画6 激光附加伤害（patchExecutions moveId 限定）', () => {
  const mkExec = (moveId: string) => ({ moveId, skillTableNote: '', actionTime: 1 }) as any

  it('6命：蓄热充能/与火共舞行附加 250% 局内攻（按动作时长/0.5 折算段数）；其余招式与非6命不附加', () => {
    const cfg: any = { orphieCinemaLevel: 6, orphieAtk: 3000 }
    const laser = mkExec('1301011')
    const ult1 = mkExec('1301015')
    const ult2 = mkExec('1301016')
    const other = mkExec('1301009')
    orphieMechanic.patchExecutions!({ cfg, state: {} as any, executions: [laser, ult1, ult2, other], teamFrontlineSeconds: 0 } as any)
    expect(laser.flatDamageBonus).toBeCloseTo(3000 * 2.5 * (1 / 0.5), 5) // 1s / 0.5 = 2 段
    expect(ult1.flatDamageBonus).toBeCloseTo(3000 * 2.5 * (1 / 0.5), 5)
    expect(ult2.flatDamageBonus).toBeCloseTo(3000 * 2.5 * (1 / 0.5), 5)
    expect(other.flatDamageBonus ?? 0).toBeCloseTo(0, 5)
    expect(laser.skillTableNote).toContain('影画6')

    // 非6命不附加
    const cfg5: any = { orphieCinemaLevel: 5, orphieAtk: 3000 }
    const exec5 = mkExec('1301011')
    orphieMechanic.patchExecutions!({ cfg: cfg5, state: {} as any, executions: [exec5], teamFrontlineSeconds: 0 } as any)
    expect(exec5.flatDamageBonus ?? 0).toBeCloseTo(0, 5)
  })

  it('buildCharConfig 预存命座与局内攻（flatDamageBonus 基数）', () => {
    const cfg: any = {}
    orphieMechanic.buildCharConfig!({ cfg, cinemaLevel: 6, panel: { atk: 4321 } } as any)
    expect(cfg.orphieCinemaLevel).toBe(6)
    expect(cfg.orphieAtk).toBe(4321)
  })
})

describe('奥菲丝蓄炎资源循环（spec resource）', () => {
  const mkState = () => ({
    exSpecialCount: 2, chainCountTotal: 1, ultimateCount: 1,
    basicAttackTime: 10, frontlineTime: 30, backstageTime: 0,
  }) as any

  it('获取=强特20×2+连携20+终结20+蚀光一闪(战斗时长×4)，消耗=蓄热充能每次100', () => {
    const cfg: any = { orphieCinemaLevel: 0, battleTime: 100 }
    const result: any = orphieMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    const xuyan = result.specResources.orphie_xuyan
    expect(xuyan).toBeTruthy()
    expect(xuyan.initialValue).toBe(100)
    expect(xuyan.maxValue).toBe(125)
    expect(xuyan.gains.xuyan_ex_special_gain).toBeCloseTo(40, 5)
    expect(xuyan.gains.xuyan_chain_gain).toBeCloseTo(20, 5)
    expect(xuyan.gains.xuyan_ultimate_gain).toBeCloseTo(20, 5)
    expect(xuyan.gains.xuyan_shiguang_gain).toBeCloseTo(400, 5)
    expect(xuyan.gains.xuyan_c6_blade_gain ?? 0).toBeCloseTo(0, 5)
    // 蓄热充能次数 = floor((初始100 + 总获取520) / 100)
    expect(xuyan.spendCounts.xuyan_heat_charge_spend).toBe(Math.floor((100 + 40 + 20 + 20 + 400) / 100))
  })

  it('影画6 火刀+10 按 cinema>=6 门控（次数=floor(普攻时间/2)）', () => {
    const cfg6: any = { orphieCinemaLevel: 6, battleTime: 100 }
    const r6: any = orphieMechanic.buildResourceResult!({ cfg: cfg6, state: mkState() } as any)
    expect(cfg6.orphieBladeHits).toBe(5)
    expect(r6.specResources.orphie_xuyan.gains.xuyan_c6_blade_gain).toBeCloseTo(50, 5)

    const cfg5: any = { orphieCinemaLevel: 5, battleTime: 100 }
    const r5: any = orphieMechanic.buildResourceResult!({ cfg: cfg5, state: mkState() } as any)
    expect(cfg5.orphieBladeHits).toBe(0)
    expect(r5.specResources.orphie_xuyan.gains.xuyan_c6_blade_gain ?? 0).toBeCloseTo(0, 5)
  })

  it('resourceSections 输出蓄炎资源卡', () => {
    const cfg: any = { orphieCinemaLevel: 0, battleTime: 100 }
    const result: any = orphieMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    const sections = orphieMechanic.resourceSections!({ result, cfg } as any)
    expect(sections.length).toBeGreaterThan(0)
    expect(sections.some((s: any) => s.title?.includes('蓄炎'))).toBe(true)
  })
})


describe('奥菲丝后台自动招式（2026-08-27 口径补录）', () => {
  function build(
    team: Array<{ agentId: string; specialty: string }>,
    cfgOver: Record<string, unknown> = {},
    stateOver: Record<string, unknown> = {},
    presetExecutions: Array<Record<string, unknown>> = [],
  ) {
    const cfg: any = {
      slot: 0,
      agentId: '1301',
      initialEnergyGift: 0,
      basicAttackRegenPerSec: 0,
      'setting:orphie.backstageCastCount': -1,
      'setting:orphie.frontEnergyRatio': -1,
      ...cfgOver,
    }
    // 真实流：CharacterOperationConfig 同时是 applyTeamConfig.characters[slot] 与 buildExecutions.cfg
    ;(orphieMechanic.applyTeamConfig as any)!({
      phase: 'build', slot: 0, characters: [cfg],
      team: team.map((t, i) => ({ slot: i, agentId: t.agentId, agent: { id: t.agentId, specialty: t.specialty } })),
    })
    const executions: any[] = [...presetExecutions]
    const state: any = { backstageTime: 150, totalEnergy: Number(cfgOver.totalEnergy ?? 0), basicAttackTime: 8, ...stateOver }
    orphieMechanic.buildExecutions!({ cfg, state, executions } as any)
    return executions
  }

  it('副C（队有他强攻）：后台 30 次 = 蚀光一闪 + 灼红旋涡（能量替换），带追击 tag + backstage 桶', () => {
    const ex = build([{ agentId: '1301', specialty: 'attack' }, { agentId: '1011', specialty: 'attack' }], { totalEnergy: 60 })
    const shiguang = ex.find(e => e.moveId === '1301008')
    const vortex = ex.find(e => e.moveId === '1301010')
    expect(shiguang).toBeTruthy()
    expect(shiguang.timeBucket).toBe('backstage')
    expect(shiguang.skillDamageTarget).toBe('additionalAttack')
    expect(vortex).toBeTruthy()
    expect(vortex.count).toBe(2) // 60/30 = 2
    expect(shiguang.count + vortex.count).toBe(30) // 副C 30
  })

  it('2026-08-30 起不再分主/副C 档：次数 = 有效后台时间 / 相位延后等效 CD；席德队 80% 前台小心脚下', () => {
    // 主C（无他强攻）：与副C 同口径——F=0 时 floor(150/5)=30，前台占比由等效 CD 接管
    const mainC = build([{ agentId: '1301', specialty: 'attack' }, { agentId: '1211', specialty: 'support' }])
    const total = mainC.filter(e => e.moveId === '1301008' || e.moveId === '1301010').reduce((s, e) => s + e.count, 0)
    expect(total).toBe(30)

    // 相位延后：本人前台 90s / 有效战斗 180s（p=0.5）→ 等效 CD 5×1.25=6.25 → floor(150/6.25)=24
    const delayed = build(
      [{ agentId: '1301', specialty: 'attack' }, { agentId: '1211', specialty: 'support' }],
      {},
      { frontlineTime: 90 },
    )
    const delayedTotal = delayed.filter(e => e.moveId === '1301008' || e.moveId === '1301010').reduce((s, e) => s + e.count, 0)
    expect(delayedTotal).toBe(24)

    // 前台块长由「切上前台频率 × 前台动作次数」决定：前台 90s、动作 15 次、100% → 块长 6s
    // p = 0.5 → c' = 5 + 0.5×3 = 6.5 → floor(150/6.5) = 23；20% 滑块 → 切上 3 次 → 块长 30s
    // → c' = 5 + 0.5×15 = 12.5 → floor(150/12.5) = 12
    const withActions = build(
      [{ agentId: '1301', specialty: 'attack' }, { agentId: '1211', specialty: 'support' }],
      {},
      { frontlineTime: 90 },
      [{ moveId: 'x1', category: 'special', count: 15, totalTime: 90, timeBucket: 'necessary' }],
    )
    const withActionsTotal = withActions.filter(e => e.moveId === '1301008' || e.moveId === '1301010').reduce((s, e) => s + e.count, 0)
    expect(withActionsTotal).toBe(23)
    const rare = build(
      [{ agentId: '1301', specialty: 'attack' }, { agentId: '1211', specialty: 'support' }],
      { 'setting:orphie.frontSwitchRatio': 0.2 },
      { frontlineTime: 90 },
      [{ moveId: 'x1', category: 'special', count: 15, totalTime: 90, timeBucket: 'necessary' }],
    )
    const rareTotal = rare.filter(e => e.moveId === '1301008' || e.moveId === '1301010').reduce((s, e) => s + e.count, 0)
    expect(rareTotal).toBe(12)

    // 动作融合（2026-08-31）：支援突击必须接在弹刀后连着 → 融合进弹刀块不单独计数，弹刀本体照计
    const fused = build(
      [{ agentId: '1301', specialty: 'attack' }, { agentId: '1211', specialty: 'support' }],
      { assistFollowUpMoveId: 'a1' },
      { frontlineTime: 90 },
      [
        { moveId: 'p1', category: 'assist', count: 6, totalTime: 6, timeBucket: 'necessary' },
        { moveId: 'a1', category: 'assist', count: 6, totalTime: 6, timeBucket: 'necessary' },
        { moveId: 'x1', category: 'special', count: 9, totalTime: 81, timeBucket: 'necessary' },
      ],
    )
    // 前台动作数 = 6(弹刀) + 9(强特) = 15（支援突击 6 次融合）→ 块长 90/15 = 6s → c' = 6.5 → 23
    const fusedTotal = fused.filter(e => e.moveId === '1301008' || e.moveId === '1301010').reduce((s, e) => s + e.count, 0)
    expect(fusedTotal).toBe(23)

    const xide = build([{ agentId: '1301', specialty: 'attack' }, { agentId: '1461', specialty: 'attack' }])
    const foot = xide.find(e => e.moveId === '1301009')
    expect(foot).toBeTruthy()
    expect(foot.count).toBe(24) // 30 × 0.8
  })
})

describe('奥菲丝倍率融合（2026-08-27）', () => {
  it('蓄热充能打完自动接燥焰迸射；大招 #1+#2 合一追加 #2', () => {
    const cfg: any = { orphieCinemaLevel: 6, orphieAtk: 1000 }
    const executions: any[] = [
      { moveId: '1301011', moveName: '蓄热充能', category: 'special', count: 3, actionTime: 1, comboAlignRatio: 0, totalTime: 3, totalComboAlignTime: 0, energyConsume: 0, totalEnergyConsume: 0, decibelRecovery: 0, totalDecibelRecovery: 0, energyRecovery: 0, totalEnergyRecovery: 0 },
      { moveId: '1301015', moveName: '与火共舞 #1', category: 'chain', count: 2, actionTime: 2, comboAlignRatio: 0, totalTime: 4, totalComboAlignTime: 0, energyConsume: 0, totalEnergyConsume: 0, decibelRecovery: 0, totalDecibelRecovery: 0, energyRecovery: 0, totalEnergyRecovery: 0 },
    ]
    orphieMechanic.patchExecutions!({ cfg, state: {}, executions } as any)
    const burst = executions.find(e => e.moveId === '1301022')
    const ult2 = executions.find(e => e.moveId === '1301016')
    expect(burst).toBeTruthy()
    expect(burst.count).toBe(3) // 蓄热充能 3 次 → 燥焰迸射 3 次
    expect(ult2).toBeTruthy()
    expect(ult2.count).toBe(2) // 大招 #1 2 次 → #2 2 次（合一）
  })
})

describe('奥菲丝滑块生效差分（防守卫冻结，SOP §3.5）', () => {
  it('orphie.bladeLinkRatio → 影画6火刀衔接灼红旋涡次数差分（buildExecutions）', () => {
    const mk = (ratio: number) => {
      const executions: any[] = []
      orphieMechanic.buildExecutions!({
        cfg: { orphieCinemaLevel: 6, 'setting:orphie.bladeLinkRatio': ratio },
        state: { basicAttackTime: 60 },
        executions,
      } as never)
      const rows = executions.filter(e => (e.skillTableNote ?? '').includes('火刀衔接') || (e.moveName ?? '').includes('火刀衔接'))
      return rows.reduce((s, e) => s + (e.count ?? 0), 0)
    }
    const on = mk(1)
    const half = mk(0.5)
    const off = mk(0)
    // 60s 平A → 30 次火刀；全衔接 30，半衔接 15，0 无行
    expect(on).toBe(30)
    expect(half).toBe(15)
    expect(off).toBe(0)
  })
})
