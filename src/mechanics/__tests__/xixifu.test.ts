import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { xixifuMechanic } from '@/mechanics/agents/xixifu'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, defAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1,
}

async function setup(mateId = '1621', cinemaLevel = 0) {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (const buff of config.globalBuffs) buff.enabled = false
  // slot0 希希芙，slot1 队友（1621 洛克茜 = 风·击破 → 触发额外能力）
  config.team[0] = { slot: 0, agentId: '1521', cinemaLevel, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

/** 核心被动电系无视防御公式（Lv.12）：clamp(floor((回能-1.4)/0.12)+6, 6, 25) */
function defIgnoreExpected(regen: number): number {
  return Math.min(25, Math.max(6, Math.floor((regen - 1.4) / 0.12) + 6))
}

/** T9（CC-408）：引擎路径下 1521019/1521006 的 damage 行值由 buildCharConfig 读表进 cfg.mechanicRowValues；
 *  手搭 cfg 直调 buildExecutions 的用例须自填表值（catalog Lv.12），否则缺表为 0。 */
const ROW_VALUES = { '1521019': 254.4, '1521006': 1009.1 }

describe('希希芙（1521）核心被动电系无视防御公式', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('按希希芙局外回能取公式值；影画1 放大140%并附带5%电抗无视', async () => {
    const { catalog, config } = await setup('1621', 0)
    const phases0 = computePanelPhases(0, config, catalog)!
    const out = phases0.outOfCombat as any
    const regen = out.energyRegen * (1 + (out.energyRegenBonusPct ?? 0) / 100) + (out.energyRegenBonusFlat ?? 0)
    const expected0 = defIgnoreExpected(regen)

    const withBuff = (computePanelPhases(1, config, catalog)!.inCombat as any).enemyElectricDefReduction as number
    config.toggleTeammateBuff('xixifu.core_electric_def_ignore', false)
    const withoutBuff = (computePanelPhases(1, config, catalog)!.inCombat as any).enemyElectricDefReduction as number
    config.toggleTeammateBuff('xixifu.core_electric_def_ignore', true)
    expect(withBuff - withoutBuff).toBeCloseTo(expected0, 5)
    expect(expected0).toBeGreaterThan(6)

    // 影画1：公式×1.4（先 clamp 后放大）+ 全队电抗无视5%
    config.team[0].cinemaLevel = 1
    config.syncTeammateBuffsFromTeam()
    const p1 = computePanelPhases(1, config, catalog)!.inCombat as any
    expect(p1.enemyElectricDefReduction - withoutBuff).toBeCloseTo(expected0 * 1.4, 5)
    expect(p1.enemyElectricResReduction).toBeCloseTo(5, 5)
  })
})

describe('希希芙额外能力·毒素发酵（全队暴伤+40%、自身额外+10%）', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('自身额外+10%：按 additionalAbilityActive 门控施加', () => {
    const mk = (active: number) => ({
      slot: 0, agent: { id: '1521' } as any, cinemaLevel: 0, team: [],
      panel: { critDmg: 50, additionalAbilityActive: active } as any,
    })
    const on = mk(1); xixifuMechanic.applyPanel!(on as any)
    expect((on.panel as any).critDmg).toBeCloseTo(60, 5)

    const off = mk(0); xixifuMechanic.applyPanel!(off as any)
    expect((off.panel as any).critDmg).toBeCloseTo(50, 5)
  })

  it('门控：[击破]或同属性（电）队友激活 → 队友暴伤+40%、希希芙自己+50%；命破/强攻不生效', async () => {
    // 正例1：1621 洛克茜（风·击破=stun，非电属性 → 纯专精命中）
    const pos1 = await setup('1621', 0)
    const phases1 = computePanelPhases(0, pos1.config, pos1.catalog)!
    expect((phases1.inCombat as any).additionalAbilityActive).toBe(1)
    // 关闭洛克茜的队友 buff（核心被动+32%暴伤、额外能力失衡易伤），避免干扰希希芙自身暴伤测算
    const roxyBuffs = ['roxy_core_team_crit_dmg', 'roxy_extra_stun_vulnerability']
    for (const id of roxyBuffs) pos1.config.toggleTeammateBuff(id, false)
    const critBase = (phases1.outOfCombat as any).critDmg as number
    const selfCd = (computePanelPhases(0, pos1.config, pos1.catalog)!.inCombat as any).critDmg as number
    pos1.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', false)
    const selfCdOff = (computePanelPhases(0, pos1.config, pos1.catalog)!.inCombat as any).critDmg as number
    pos1.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', true)
    for (const id of roxyBuffs) pos1.config.toggleTeammateBuff(id, true)
    expect(selfCd - selfCdOff).toBeCloseTo(40, 5) // 全队 buff 部分
    expect(selfCdOff - critBase).toBeCloseTo(15, 5) // 模块自身+10% + 终结技帷幕+5%
    expect(selfCd - critBase).toBeCloseTo(55, 5) // 合计

    const mateCd = (computePanelPhases(1, pos1.config, pos1.catalog)!.inCombat as any).critDmg as number
    pos1.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', false)
    const mateCdOff = (computePanelPhases(1, pos1.config, pos1.catalog)!.inCombat as any).critDmg as number
    pos1.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', true)
    expect(mateCd - mateCdOff).toBeCloseTo(40, 5)

    // 正例2：1181 格莉丝（电属性，同属性命中）
    const pos2 = await setup('1181', 0)
    expect((computePanelPhases(0, pos2.config, pos2.catalog)!.inCombat as any).additionalAbilityActive).toBe(1)

    // 负例1：1441 真斗（命破=rupture，原文不触发——击破≠命破，最易混淆项）
    const neg1 = await setup('1441', 0)
    const pNeg1On = computePanelPhases(0, neg1.config, neg1.catalog)!.inCombat as any
    neg1.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', false)
    const pNeg1Off = computePanelPhases(0, neg1.config, neg1.catalog)!.inCombat as any
    neg1.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', true)
    expect(pNeg1On.additionalAbilityActive ?? 0).toBe(0)
    expect(pNeg1On.critDmg).toBeCloseTo(pNeg1Off.critDmg, 5)

    // 负例2：1081 比利（强攻，狡兔屋）→ 不激活，开关无差分
    const neg = await setup('1081', 0)
    const pNegOn = computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any
    neg.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', false)
    const pNegOff = computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any
    neg.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', true)
    expect(pNegOn.additionalAbilityActive ?? 0).toBe(0)
    expect(pNegOn.critDmg).toBeCloseTo(pNegOff.critDmg, 5)
  })
})

describe('希希芙毒素资源循环、蚀骨与蛇吻', () => {
  /**
   * 夹具状态（2026-10-25 更新：补 `totalEnergy`）。
   *
   * 为什么必须补：毒牙长按的**额外打击要花能量**（用户 2026-10-25 逐字「强特长按会先扣除65能量
   * 回复5能量打出一个毒牙#1，后面每花费20能量可以打一个毒牙#2，最多打3个」），
   * 模块按「满长按一次 120 能量」从 `state.totalEnergy` 里买次数。缺这格 = 买不起 = 毒素恒 0，
   * 夹具会静默测不到毒牙分支。240 = 恰好买得起 2 次满长按。
   */
  const mkState = () => ({
    basicAttackTime: 20, exSpecialCount: 2, chainCountTotal: 1, ultimateCount: 1,
    totalEnergy: 240,
    frontlineTime: 40, backstageTime: 0,
  }) as any
  /** 连携次数来源：`chainCountTotalOverride ?? chainCountPerStun × 失衡次数`（state 里那格轴模式恒 0） */
  const chainCfg = { chainCountPerStun: 1, xixifuStunCount: 1 }

  /**
   * ⚠ **2026-10-25 锚值重算（规则 10 四步）**：
   * ① 量 delta：吐信第四段 10 次 → **7 次**（20/2=10 变为 floor(20/4.483)=4 个连段 + 毒牙 2 + 连携 1），
   *    毒素总量 46 → 38；毒牙/连携/终结三条未变。
   * ② 根因：原文「每获得6点毒素…第四段攻击命中后获得2点」——第四段是**四段连段**的第 4 段，
   *    引擎缺省按「每 2 秒一次」估；倍率表实测连段 = 0.653+1.047+0.91+1.873 = **4.483 秒**。
   *    另按原文「招式发动后，可直接衔接第四段普通攻击：吐信」补上**毒牙后 + 连携后**的免费第四段机会。
   * ③ 确认有意：用户 2026-10-25「e后面可以直接跟a4，连携后面也可以。单c情况下a4的机会比较多」。
   * ④ 同时把「毒牙长按额外打击的能量」计入（不再是白拿）。
   */
  it('毒素账目：进场3+吐信段7×2+失衡占比0.5+毒牙3×2+长按3×2+连携3+终结3；蚀骨次数=总量', () => {
    const cfg: any = { ...chainCfg }
    const result: any = xixifuMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    const toxin = result.specResources.xixifu_toxin
    expect(toxin).toBeTruthy()
    expect(toxin.initialValue).toBe(3)
    expect(toxin.maxValue).toBe(125)
    expect(toxin.gains.toxin_tuxin_stage4).toBeCloseTo(14, 5)      // a4 7 次 × 2
    expect(toxin.gains.toxin_tuxin_stunned_bonus).toBeCloseTo(3.5, 5) // 7 × 1 × 0.5
    expect(toxin.gains.toxin_duya_base).toBeCloseTo(6, 5)          // 能量买得起 2 次
    expect(toxin.gains.toxin_duya_hold).toBeCloseTo(6, 5)
    expect(toxin.gains.toxin_chain).toBeCloseTo(3, 5)
    expect(toxin.gains.toxin_ultimate).toBeCloseTo(3, 5)
    // 蚀骨次数 = 初始3 + 总获取35.5 = 38（cost 1，向下取整）
    expect(toxin.spendCounts.toxin_shigu_spend).toBe(38)
  })

  it('buildExecutions：蚀骨（基础254.4%随等级 + 附加335% flat）+ 蛇吻（1009.1%×7）', () => {
    const cfg: any = { xixifuElectricCount: 1, xixifuAtk: 3000, mechanicRowValues: { ...ROW_VALUES }, ...chainCfg }
    const executions: any[] = []
    xixifuMechanic.buildExecutions!({ cfg, state: mkState(), executions } as any)
    // 38 毒素 → 蚀骨 38 次 + 蛇吻 floor(38/6)=6 次（无特殊蚀骨）
    expect(executions.length).toBe(2)
    const shigu = executions.find((e: any) => e.moveId === '1521019')
    const shekiss = executions.find((e: any) => e.moveId === '1521006')
    expect(shigu).toBeTruthy()
    expect(shigu.count).toBe(38)
    expect(shigu.damageMultiplier).toBeCloseTo(254.4, 5) // 基础随等级
    expect(shigu.flatDamageBonus).toBeCloseTo(3000 * 3.35, 5) // 附加 335% 不随等级
    expect(shigu.element).toBe('electric')
    expect(shigu.stunBuildUpBonus).toBe(40) // 1 名电属性
    expect(shigu.resIgnore ?? 0).toBe(0) // 影画0 无
    expect(shekiss).toBeTruthy()
    expect(shekiss.count).toBe(6)
    expect(shekiss.damageMultiplier).toBeCloseTo(1009.1, 5)
    expect(shekiss.dmgBonus ?? 0).toBe(0)

    // 空 state 仍有进场初始3点毒素 → 蚀骨×3（蛇吻 floor(3/6)=0，无蛇吻行）
    const empty: any[] = []
    xixifuMechanic.buildExecutions!({ cfg: { xixifuElectricCount: 1, xixifuAtk: 3000, mechanicRowValues: { ...ROW_VALUES } }, state: { basicAttackTime: 0, exSpecialCount: 0, chainCountTotal: 0, ultimateCount: 0 } as any, executions: empty } as any)
    expect(empty.length).toBe(1)
    expect(empty[0].moveId).toBe('1521019')
    expect(empty[0].count).toBe(3)
  })

  it('影画1：进场毒素 3→6（蚀骨次数随之+3）', () => {
    const cfg0: any = { xixifuCinemaLevel: 0 }
    const r0: any = xixifuMechanic.buildResourceResult!({ cfg: cfg0, state: mkState() } as any)
    const cfg1: any = { xixifuCinemaLevel: 1 }
    const r1: any = xixifuMechanic.buildResourceResult!({ cfg: cfg1, state: mkState() } as any)
    expect(r0.specResources.xixifu_toxin.initialValue).toBe(3)
    expect(r1.specResources.xixifu_toxin.initialValue).toBe(6)
    expect(r1.specResources.xixifu_toxin.spendCounts.toxin_shigu_spend
      - r0.specResources.xixifu_toxin.spendCounts.toxin_shigu_spend).toBe(3)
  })

  it('影画2：蛇吻伤害 +35%（dmgBonus 定向）', () => {
    const executions: any[] = []
    xixifuMechanic.buildExecutions!({ cfg: { xixifuCinemaLevel: 2, xixifuElectricCount: 1, mechanicRowValues: { ...ROW_VALUES } }, state: mkState(), executions } as any)
    const shekiss = executions.find((e: any) => e.moveId === '1521006')
    expect(shekiss.dmgBonus).toBe(35)
  })

  it('影画2：失衡下连携/终结额外+3毒素（连携全吃 + min(终结, 失衡)）', () => {
    const cfg: any = { xixifuCinemaLevel: 2, ...chainCfg }
    const result: any = xixifuMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    const toxin = result.specResources.xixifu_toxin
    // 连携 1 + min(终结 1, 失衡 1) = 2 次 × 3 = 6
    expect(toxin.gains.toxin_c2_stunned_chain_ultimate).toBeCloseTo(6, 5)
    // 无失衡（stunCount=0）时只剩连携 1×3 = 3
    const cfg0: any = { xixifuCinemaLevel: 2, chainCountPerStun: 1, xixifuStunCount: 0 }
    const r0: any = xixifuMechanic.buildResourceResult!({ cfg: cfg0, state: mkState() } as any)
    expect(r0.specResources.xixifu_toxin.gains.toxin_c2_stunned_chain_ultimate).toBeCloseTo(3, 5)
  })

  it('影画2 轴模式：axisUltimateTotal 精确反推，不吃 min(终结, 失衡) 折扣', () => {
    // 轴内终结块 3 次（> 失衡 1）：非轴口径 min(3,1)=1，轴口径全额 3
    const cfg: any = { xixifuCinemaLevel: 2, ...chainCfg, axisUltimateTotal: 3 }
    const result: any = xixifuMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    // 连携 1 + 终结 3 = 4 次 × 3 = 12
    expect(result.specResources.xixifu_toxin.gains.toxin_c2_stunned_chain_ultimate).toBeCloseTo(12, 5)
  })

  it('影画4：觉悟计数器（强特2+连携1+终结1=4层）→ 特殊蚀骨 4（无失衡值假 id）', () => {
    const executions: any[] = []
    xixifuMechanic.buildExecutions!({ cfg: { xixifuCinemaLevel: 4, xixifuElectricCount: 1, xixifuAtk: 3000, mechanicRowValues: { ...ROW_VALUES } }, state: mkState(), executions } as any)
    const special = executions.find((e: any) => e.moveId === 'xixifu_shigu_special')
    expect(special).toBeTruthy()
    // 觉悟 = 强特2 + 连携1 + 终结1 = 4（默认全消耗）；影画4 已含影画1 → 毒素总量 49
    expect(special.count).toBe(4)
    expect(special.damageMultiplier).toBeCloseTo(254.4, 5)
    expect(special.flatDamageBonus).toBeCloseTo(3000 * 3.35, 5)
  })

  /**
   * ⚠ **2026-10-25 锚值重算**（同「毒素账目」那条的归因：吐信四段频率按四段连段 4.483s + 毒牙/连携后衔接）。
   * 影画6 含影画1/2/4：进场 6 + C2 连携 3 + 常规 35.5 = 毒素总量 44.5 → 蚀骨 **44**；
   * 觉悟 4、印记 min(44+4, 180/3=60)=48 ⇒ 特殊蚀骨 = 4 + 48 = **52**。
   */
  it('影画6：印记计数器 → 特殊蚀骨 = 觉悟4 + min(蚀骨44+4, 180/3=60)=48 = 52', () => {
    const executions: any[] = []
    xixifuMechanic.buildExecutions!({ cfg: { xixifuCinemaLevel: 6, xixifuElectricCount: 1, xixifuAtk: 3000, battleTime: 180, mechanicRowValues: { ...ROW_VALUES } }, state: mkState(), executions } as any)
    const special = executions.find((e: any) => e.moveId === 'xixifu_shigu_special')
    expect(special).toBeTruthy()
    expect(special.count).toBe(52)
    const shigu = executions.find((e: any) => e.moveId === '1521019')
    expect(shigu.count).toBe(44)
  })

  it('影画1：蚀骨伤害无视 10% 电抗（resIgnore 招式限定）', () => {
    const executions: any[] = []
    xixifuMechanic.buildExecutions!({ cfg: { xixifuCinemaLevel: 1, xixifuElectricCount: 1, xixifuAtk: 3000, mechanicRowValues: { ...ROW_VALUES } }, state: mkState(), executions } as any)
    const shigu = executions.find((e: any) => e.moveId === '1521019')
    expect(shigu.resIgnore).toBe(10)
  })

  it('蚀骨自拐暴击率：+6%×3层 = +18%（applyPanel 面板直加，无条件）', () => {
    const mk = (critRate: number) => ({
      slot: 0, agent: { id: '1521' } as any, cinemaLevel: 0, team: [],
      panel: { critRate, additionalAbilityActive: 0 } as any,
    })
    const on = mk(50); xixifuMechanic.applyPanel!(on as any)
    expect((on.panel as any).critRate).toBeCloseTo(68, 5)
  })

  it('蚀骨失衡值 +40%/60%：按队伍电属性角色数门控', () => {
    const one: any[] = []
    xixifuMechanic.buildExecutions!({ cfg: { xixifuElectricCount: 1, mechanicRowValues: { ...ROW_VALUES } }, state: mkState(), executions: one } as any)
    expect(one.find((e: any) => e.moveId === '1521019').stunBuildUpBonus).toBe(40)

    const two: any[] = []
    xixifuMechanic.buildExecutions!({ cfg: { xixifuElectricCount: 2, mechanicRowValues: { ...ROW_VALUES } }, state: mkState(), executions: two } as any)
    expect(two.find((e: any) => e.moveId === '1521019').stunBuildUpBonus).toBe(60)
  })

  it('resourceSections 输出蛇吻次数卡 = floor(毒素总量/6)（与资源账自洽，不写死绝对数）', () => {
    const cfg: any = { ...chainCfg }
    const result: any = xixifuMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    const sections = xixifuMechanic.resourceSections!({ result, cfg } as any)
    expect(sections.some((s: any) => s.title?.includes('毒素'))).toBe(true)
    const shekiss = sections.find((s: any) => s.id === 'xixifu-shekiss')
    expect(shekiss).toBeTruthy()
    // 判据「卡片 = floor(毒素总量/6)」本身，而不是某个编号：毒素总量随模型改动时这条不该跟着重钉
    const toxinTotal = result.specResources.xixifu_toxin.total as number
    expect(shekiss!.summary).toContain(String(Math.floor(toxinTotal / 6)))
  })
})

describe('希希芙终结技帷幕（全队暴伤+5%）', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('队友面板暴伤差分 +5%', async () => {
    const { catalog, config } = await setup('1621', 0)
    const on = (computePanelPhases(1, config, catalog)!.inCombat as any).critDmg as number
    config.toggleTeammateBuff('xixifu.ultimate_curtain_crit_dmg', false)
    const off = (computePanelPhases(1, config, catalog)!.inCombat as any).critDmg as number
    config.toggleTeammateBuff('xixifu.ultimate_curtain_crit_dmg', true)
    expect(on - off).toBeCloseTo(5, 5)
  })
})
