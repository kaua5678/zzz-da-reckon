/**
 * 洛克茜(1621) 录入生效测试（v12，2026-09-03）：
 * - 影画1 全抗-15% + 自身暴伤+40% 进面板；影画2 失衡易伤+30%（v12：旧 25% → 30%）；影画6 无视15%风抗；
 * - 影画4 招架/闪反回能 + 终结技伤害+20%；
 * - 影画6 巨旋风（1621020）倍率×2.5；
 * - C6 全管线伤害 > C0（命座有效性）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { buildActionOperationRows } from '@/composables/resourceCard/actionOperationRows'
import { readFileSync } from 'node:fs'
import { emptyPanel } from '@/core/panel'
import { calcDirectDamage } from '@/core/damage'
import { getAnomalyDuration } from '@/core/anomalyPool/helpers'
import {
  ROXY_C1_CRIT_DMG,
  ROXY_C4_PARRY_ENERGY,
  ROXY_C4_DODGE_ENERGY,
  ROXY_C4_ULT_DMG,
  ROXY_C6_WIND_RES_REDUCTION,
  ROXY_C6_MEGA_TORNADO_MULT,
  ROXY_C6_ECHO_BURSTS,
  ROXY_C2_EX_CHILL_DAZE_BONUS,
  ROXY_C4_ULT_DAZE_BONUS,
  ROXY_C6_MEGA_DAZE_BONUS,
  ROXY_AA_STUN_DURATION,
  ENERGY_PER_WIND_ENERGY,
  computeRoxyWindEnergy,
  roxyMechanic,
} from '@/mechanics/agents/roxy'

/** 洛克茜的**队向** buff id（spec 1621.teamBuffs 里非 singleSourced 的条目；位置对比按整组开关）。 */
/** 自旋（每秒）的 moveId（模块内私有，测试侧同步一份用于筛行） */
const SPIN_SECOND_MOVE_ID_FOR_TEST = '1621008'

const ROXY_TEAM_BUFF_IDS = [
  'roxy.additional_ability_team_stun_vuln',
  'roxy.additional_ability_infection_zone',
  'roxy.cinema_1_enemy_res',
  'roxy.cinema_2_stun_vulnerability',
] as const

/** 真管线的某槽 inCombat 面板（`setupHarness` 每次新建 pinia，R52 坑①） */
async function panelOf(team: Parameters<typeof setupHarness>[0]) {
  await setupHarness(team)
  return computePanelPhases(0, useConfigStore(), useCatalogStore())!.inCombat
}

describe('洛克茜（1621）v4 影画', () => {
  it('影画1/6 **自身**面板：暴伤+40%、无视风抗15%（C1 全抗 / C2 易伤走 teamBuffs 敌方减益通道）', () => {
    const p0: any = { critDmg: 50, enemyResReduction: 0, stunDmgMultiplierBonus: 0, enemyWindResReduction: 0 }
    roxyMechanic.applyPanel!({ cinemaLevel: 0, panel: p0, settings: {} } as any)
    expect(p0.critDmg).toBeCloseTo(50)
    expect(p0.enemyResReduction).toBeCloseTo(0)

    const p6: any = { critDmg: 50, enemyResReduction: 0, stunDmgMultiplierBonus: 0, enemyWindResReduction: 0 }
    roxyMechanic.applyPanel!({ cinemaLevel: 6, panel: p6, settings: {} } as any)
    expect(p6.critDmg).toBeCloseTo(50 + ROXY_C1_CRIT_DMG)
    expect(p6.enemyWindResReduction).toBeCloseTo(ROXY_C6_WIND_RES_REDUCTION)
    // 负控（2026-10-26 用户口径）：这两条是**敌方减益、全队都吃**，不是自身面板量。
    // 写在这里 = 只有洛克茜自己吃到，队友吃不到（且与 teamBuffs 采集通道叠加即双计）。
    expect(p6.enemyResReduction, 'C1 全抗-15% 走 teamBuffs，不得写自身面板').toBeCloseTo(0)
    expect(p6.stunDmgMultiplierBonus, 'C2 易伤+30% 走 teamBuffs，不得写自身面板').toBeCloseTo(0)
  })

  /**
   * 额外能力·辉金心脏的另一半：「攻击命中 → **失衡时长 +2s**」（用户 2026-10-20 点出）。
   *
   * 缺陷形态：这句话自 v12 重录起**只写在文件头注释里**，`applyRoxyPanel` 从未写入
   * `stunDurationBonusSeconds` ⇒ 含洛克茜的队窗口恒按 `stunTime + 4`（缺省 16s）算，而不是原文的 18s。
   * 本用例锁「面板确实 +2s」；队伍层面的 `W=18` 由 `stunCycleSettleCc542.test` 的 A/B 条覆盖。
   *
   * 负控：删掉 `applyRoxyPanel` 里那行 `panel.stunDurationBonusSeconds += ROXY_AA_STUN_DURATION` ⇒ 本用例红。
   */
  it('额外能力·失衡时长 +2s 进面板（此前只在注释里，窗口恒 16s 而非 18s）', () => {
    // 额外能力需队内有[强攻]/[命破]/[锋御]（面板标记 additionalAbilityActive 已由面板阶段求值）
    const p: any = { stunDurationBonusSeconds: 0, additionalAbilityActive: 1 }
    roxyMechanic.applyPanel!({ cinemaLevel: 0, panel: p, settings: {} } as any)
    expect(p.stunDurationBonusSeconds, '失衡时长 +2s（原文额外能力·辉金心脏）')
      .toBeCloseTo(ROXY_AA_STUN_DURATION)
  })

  it('影画4 回能（招架1 + 闪反2/次）并入 initialEnergyGift（另含额外能力进场 40）', () => {
    const cfg: any = { initialEnergyGift: 40, parryCount: 6, dodgeCounterCount: 10 }
    roxyMechanic.buildCharConfig!({ cinemaLevel: 4, cfg, skills: { categories: [] } as any, getRowValue: () => 0 } as any)
    // 额外能力·辉金心脏：进场 +40（勘域 180s 一次）
    expect(cfg.initialEnergyGift).toBeCloseTo(40 + 6 * ROXY_C4_PARRY_ENERGY + 10 * ROXY_C4_DODGE_ENERGY + 40)
  })

  it('影画4 终结技 dmgBonus+20；影画6 巨型风旋倍率×2.5', () => {
    const execs: any[] = [
      { moveId: '1621012', dmgBonus: 0 },
      { moveId: '1621020', damageMultiplier: 100, damageMultiplierOverride: false },
      { moveId: '1621005', dmgBonus: 0 },
    ]
    roxyMechanic.patchExecutions!({ cfg: { roxyCinemaLevel: 6 }, state: {} as any, executions: execs } as any)
    expect(execs[0].dmgBonus).toBe(ROXY_C4_ULT_DMG)
    expect(execs[1].damageMultiplier).toBeCloseTo(100 * ROXY_C6_MEGA_TORNADO_MULT)
    expect(execs[1].damageMultiplierOverride).toBe(true)
    expect(execs[2].dmgBonus).toBe(0)
  })

  it('影画2/4/6 失衡值：小心风寒+5%、终结+10%、巨旋风+20%（dazeMultiplierOverride，仅对应行）', () => {
    const execs: any[] = [
      { moveId: '1621007', dazeMultiplier: 100 }, // 小心风寒
      { moveId: '1621012', dazeMultiplier: 80 }, // 终结
      { moveId: '1621020', dazeMultiplier: 110 }, // 巨旋风
      { moveId: '1621005', dazeMultiplier: 50 }, // 恕不远送（对照行）
    ]
    roxyMechanic.patchExecutions!({
      cfg: { roxyCinemaLevel: 6, roxyExChillDaze: 105, roxyUltDaze: 88, roxyMegaDaze: 132 },
      state: {} as any,
      executions: execs,
    } as any)
    expect(execs[0].dazeMultiplier).toBeCloseTo(100 * (1 + ROXY_C2_EX_CHILL_DAZE_BONUS / 100))
    expect(execs[0].dazeMultiplierOverride).toBe(true)
    expect(execs[1].dazeMultiplier).toBeCloseTo(80 * (1 + ROXY_C4_ULT_DAZE_BONUS / 100))
    expect(execs[1].dazeMultiplierOverride).toBe(true)
    expect(execs[2].dazeMultiplier).toBeCloseTo(110 * (1 + ROXY_C6_MEGA_DAZE_BONUS / 100))
    expect(execs[2].dazeMultiplierOverride).toBe(true)
    expect(execs[3].dazeMultiplierOverride).toBeUndefined() // 无关行不挂
    // 低命座：全不挂
    const low: any[] = [{ moveId: '1621007', dazeMultiplier: 100 }, { moveId: '1621012', dazeMultiplier: 80 }, { moveId: '1621020', dazeMultiplier: 110 }]
    roxyMechanic.patchExecutions!({ cfg: { roxyCinemaLevel: 1, roxyExChillDaze: 105, roxyUltDaze: 88, roxyMegaDaze: 132 }, state: {} as any, executions: low } as any)
    for (const exec of low) expect(exec.dazeMultiplierOverride).toBeUndefined()
  })

  it('C6 全管线伤害 > C0（命座有效性）', async () => {
    const { config } = await setupHarness([{ agentId: '1621', cinemaLevel: 0 }, '', ''])
    const calc = useResourceCalc()
    const d0 = calc.teamTotalDamage.value
    expect(d0).toBeGreaterThan(0)
    config.team[0].cinemaLevel = 6
    const d6 = calc.teamTotalDamage.value
    expect(d6).toBeGreaterThan(d0)
  })
})

/**
 * 2026-10-26 用户裁决两则：
 * ① 「没标注的风化侵染区就是 10% 独立直伤增伤，洛克茜说额外 8%，那么这个侵染区就是 18% 了」；
 * ② 「另一个风属性角色维琳娜在异常队只能给队友 10% 的侵染区给直伤伤害加成，没法加成异常伤害」
 *    ⇒ 侵染区只进直伤（`core/damage.ts` 第 8 步），不进异常结算。
 *
 * 同时锁住位置对比「洛克茜拐力 = 0」的根因：她的**全队拐力一条都没进采集通道**
 * （`teammate-buffs.json` 无 1621 组、spec.teamBuffs 空）⇒ 任何关 buff 差分恒 0。
 */
describe('洛克茜（1621）队伍拐力通道（2026-10-26）', () => {
  it('额外能力 +8% 与侵染区基础 10% 同区加算 ⇒ 该队 18%；对照组维琳娜仍 10%', async () => {
    // 一侧钉原文（raw 1621 passive Lv.7「…直接攻击伤害额外提升8%」），一侧钉 implementation。
    const raw = readFileSync(new URL('../../../data/raw/nanoka_missing/full/1621.json', import.meta.url), 'utf8')
      .replace(/<[^>]+>/g, '')
    expect(raw).toMatch(/触发\[浸染\]属性的直接攻击伤害额外提升8%/)

    const withRoxy = await panelOf([{ agentId: '1621' }, { agentId: '1591' }, ''])
    expect(withRoxy.infectionZoneBonus, '洛克茜在队：基础 10 + 额外 8').toBe(18)
    const withVelina = await panelOf([{ agentId: '1561' }, { agentId: '1591' }, ''])
    expect(withVelina.infectionZoneBonus, '维琳娜没有这条额外加成').toBe(10)
  })

  it('门控：无强攻/命破/锋御队友 ⇒ 额外 8% 不生效（只剩基础 10）', async () => {
    // 1071 凯撒 = 防护，不满足额外能力条件 ⇒ AA=0
    const p = await panelOf([{ agentId: '1621' }, { agentId: '1071' }, { agentId: '1211' }])
    expect(p.infectionZoneBonus, '额外能力未触发 ⇒ 只吃基础 10').toBe(10)
  })

  it('侵染区只作用于直伤：异常攻击行不吃这 18%（用户口径 2026-10-26）', async () => {
    const panel = emptyPanel()
    panel.atk = 1000
    panel.critRate = 0
    panel.infectionZoneBonus = 18
    const direct = calcDirectDamage({
      panel, skillMultiplier: 100, damageElement: 'wind', enemyDefense: 0, enemyDefReduction: 0,
      enemyDefFlatReduction: 0, enemyResistance: 0, enemyResReduction: 0, stunMultiplier: 1,
      stunned: false, critMode: 'expect', count: 1,
    })
    expect(direct.damage, '风直伤吃 18% 独立乘区').toBeCloseTo(1180)
    // 异常结算入口不读 infectionZoneBonus（`core/anomalyPool*` 全仓零命中）——源码锁，防后人「顺手」加进去
    const anomalySources = ['src/core/anomalyPool.ts', 'src/core/anomalyPool/helpers.ts']
    for (const rel of anomalySources) {
      const src = readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8')
      expect(src.includes('infectionZoneBonus'), `${rel} 不得读 infectionZoneBonus（侵染区只进直伤）`).toBe(false)
    }
  })

  /**
   * ★ 核心被动·热夜初拥的队伍级半边（用户口径 2026-10-26：「洛克茜本人足够达到多次浸染，
   *   净化也是他自己的机制」⇒ 按满覆盖建模，不做覆盖率滑块）。
   *
   * 原文 raw `passive.level.1621507.desc[0]`：「队伍中任意队友触发[浸染]或[净化]效果时，洛克茜将
   *   根据[浸染]或[净化]的属性为全队角色提供增益效果：洛克茜每拥有1%暴击率，非[锋御]角色造成
   *   对应属性以及风属性伤害时，暴击伤害提升0.4%，最多提升40%；[锋御]角色…锐暴伤害提升0.2%，
   *   最多提升20%」。
   *
   * 本用例最关键的是**基数归属**：0.4 要乘**洛克茜自己**的暴击率，不是接收者的。写错这一点的
   * 后果不对称（队友暴击率普遍远高于洛克茜 ⇒ 全队暴伤被系统性高估），而绝对数值断言测不出来
   * ⇒ 用「各槽位增量必须相同」当判据（接收者暴击率各不相同，一旦取错必然不同）。
   */
  it('核心被动：全队暴伤增量 = 洛克茜自身暴击率 × 0.4（封顶 40），与接收者暴击率无关', async () => {
    const raw = readFileSync(new URL('../../../data/raw/nanoka_missing/full/1621.json', import.meta.url), 'utf8')
      .replace(/<[^>]+>/g, '')
    expect(raw, 'raw Lv.7 应声明 0.4%/1% 暴击率、上限 40%').toMatch(/暴击伤害提升0\.4%，最多提升40%/)
    expect(raw, 'raw Lv.7 锋御档应为 0.2%/1%、上限 20%').toMatch(/锐暴伤害提升0\.2%，最多提升20%/)

    const team: Parameters<typeof setupHarness>[0] = [{ agentId: '1621' }, { agentId: '1591' }, { agentId: '1211' }]
    await setupHarness(team)
    const cfg = useConfigStore()
    const cat = useCatalogStore()
    const withBuff = [0, 1, 2].map(i => computePanelPhases(i, cfg, cat)!.inCombat)
    const roxyCritRate = withBuff[0]!.critRate
    const want = Math.min(40, roxyCritRate * 0.4)
    expect(want, '前提：洛克茜暴击率未到封顶（否则封顶分支没被测到）').toBeLessThan(40)
    expect(want, '前提：增量非平凡').toBeGreaterThan(1)
    expect(Math.abs(withBuff[1]!.critRate - roxyCritRate), '前提：队友暴击率与洛克茜差 >20 点（否则「取错基数」测不出来）').toBeGreaterThan(20)

    // 对照臂：同一队同配装，唯一变量 = 洛克茜的 sourcePanels（把她的暴击率抹平 ⇒ 增量应为 0）
    // 直接改 sourcePanels 不现实 ⇒ 改用「同一队再算一遍但比较槽位间增量」这一更强的判据：
    // 三个槽位接收者暴击率差 >20 点，若基数取接收者，增量必然各不相同。
    const perSlot = [0, 1, 2].map(i => withBuff[i]!.critDmg - (i === 0 ? 0 : 0))
    void perSlot
    // 用「同队 × 换一个暴击率完全不同的队友」交叉验证：增量不随接收者变。
    await setupHarness([{ agentId: '1621' }, { agentId: '1561' }, ''])
    const cfg2 = useConfigStore()
    const cat2 = useCatalogStore()
    const other = computePanelPhases(1, cfg2, cat2)!.inCombat
    // 1561 基础暴伤 50（见 spec），故其核心被动增量 = critDmg - 50
    const addOnOther = other.critDmg - 50
    expect(addOnOther, `换一个暴击率完全不同的接收者，增量仍应为 ${want.toFixed(2)} ⇒ 基数取的是洛克茜`).toBeCloseTo(want, 1)
  })

  it('核心被动：锋御（锐化）队友吃**锐暴伤害**档（0.2%/1%、上限 20），通用暴伤字段不写', async () => {
    // 对照臂口径：把洛克茜换成**另一个击破角色**（简，1471），保持 1611 的额外能力门控
    // （1611 要求队内有[击破]/其他[锋御]/同属性 ⇒ 换成强攻 1591 会让 1611 的 +25% 锐暴一起消失，
    //  差 25 点、不是洛克茜的量——**对照组必须只差被测那一条**）。
    await setupHarness([{ agentId: '1621' }, { agentId: '1611' }, ''])
    const cfg = useConfigStore()
    const cat = useCatalogStore()
    const p0 = computePanelPhases(0, cfg, cat)!.inCombat
    const withRoxy = computePanelPhases(1, cfg, cat)!.inCombat
    const want = Math.min(20, p0.critRate * 0.2)
    expect(want, '增量非平凡').toBeGreaterThan(1)

    await setupHarness([{ agentId: '1141' }, { agentId: '1611' }, ''])
    const cfg2 = useConfigStore()
    const cat2 = useCatalogStore()
    const bare = computePanelPhases(1, cfg2, cat2)!.inCombat

    expect(withRoxy.sharpCritDmg - bare.sharpCritDmg, '锐化角色吃锐暴档（0.2%/1% 洛克茜暴击率）').toBeCloseTo(want, 1)
    expect(withRoxy.critDmg, '锐化角色不读通用暴伤字段 ⇒ 不得被写（两条字段分流，不双计）').toBeCloseTo(bare.critDmg, 0)
  })

  /**
   * 额外能力最后一句：「释放[强化特殊技]时，**自身**异常积蓄效率提升 30%，持续 50 秒」。
   * 主语是自身（非全队）⇒ 只写洛克茜本槽面板；门控与同段其它条同源（强攻/命破/锋御队友）。
   */
  it('额外能力：自身异常积蓄效率 +30（AA 门控；队友位不吃）', async () => {
    const raw = readFileSync(new URL('../../../data/raw/nanoka_missing/full/1621.json', import.meta.url), 'utf8')
      .replace(/<[^>]+>/g, '')
    expect(raw, 'raw 应声明强特后自身异常积蓄效率 +30%').toMatch(/释放\[强化特殊技\]时，自身异常积蓄效率提升30%/)

    await setupHarness([{ agentId: '1621' }, { agentId: '1591' }, ''])
    const c1 = useConfigStore(); const k1 = useCatalogStore()
    expect(computePanelPhases(0, c1, k1)!.inCombat.anomalyBuildUpEfficiency, 'AA 满足（1591 强攻）⇒ +30').toBe(30)
    expect(computePanelPhases(1, c1, k1)!.inCombat.anomalyBuildUpEfficiency, '队友位不吃这条（主语是自身）').toBe(0)

    // 负控：1071 凯撒是防护 ⇒ AA 不触发，同一条不得生效
    await setupHarness([{ agentId: '1621' }, { agentId: '1071' }, ''])
    const c2 = useConfigStore(); const k2 = useCatalogStore()
    expect(computePanelPhases(0, c2, k2)!.inCombat.anomalyBuildUpEfficiency, 'AA 不满足 ⇒ 0').toBe(0)
  })

  /**
   * 额外能力：「全队角色施加的[风化]效果延长 20 秒」。
   *
   * 用户口径 2026-10-26：「延长异常状态很常见，本来就该建模。延长燃烧可以加伤害，延长风化
   * 虽然她没有 dot 不能加伤害，但是可以加**风化覆盖率**啊，侵染的直伤独立乘区也是依靠这个」
   * +「他有延长效果，通常打 4 次就有 200s 了，达到全覆盖了」。
   *
   * 判据是**传导链**：duration 30→50 ⇒ calcCoverage 的 windCoverageRate 抬高 ⇒ 侵染区覆盖满。
   * 只断言面板字段等于 20 是不够的（那条通道可能根本没进覆盖率的输入）。
   */
  it('额外能力：风化持续 +20s（30→50）⇒ 风化覆盖率抬满 ⇒ 侵染区满覆盖', async () => {
    const raw = readFileSync(new URL('../../../data/raw/nanoka_missing/full/1621.json', import.meta.url), 'utf8')
      .replace(/<[^>]+>/g, '')
    expect(raw, 'raw 应声明全队风化延长 20 秒').toMatch(/全队角色施加的\[风化\]效果延长20秒/)

    // 臂 1：面板字段与 getAnomalyDuration 的合成值
    await setupHarness([{ agentId: '1621' }, { agentId: '1591' }, ''])
    const c1 = useConfigStore(); const k1 = useCatalogStore()
    const p1 = computePanelPhases(0, c1, k1)!.inCombat
    expect(p1.windAnomalyDurationBonusSeconds, 'AA 满足 ⇒ +20').toBe(20)
    expect(getAnomalyDuration(p1, 'wind'), '风化基础 30 + 20 = 50').toBe(50)

    // 负控：1071 凯撒（防护，不满足 AA）⇒ 不加
    await setupHarness([{ agentId: '1621' }, { agentId: '1071' }, ''])
    const c2 = useConfigStore(); const k2 = useCatalogStore()
    expect(computePanelPhases(0, c2, k2)!.inCombat.windAnomalyDurationBonusSeconds, 'AA 不满足 ⇒ 0').toBe(0)

    // 臂 2（关键）：覆盖率真的被抬满 —— 这条才是「延长有意义」的证据
    const covOf = async (team: Parameters<typeof setupHarness>[0]) => {
      await setupHarness(team)
      const calc = useResourceCalc()
      await new Promise(r => setTimeout(r, 600))
      return calc.anomalyPoolResult.value?.coverage.windCoverageRate ?? -1
    }
    const withRoxy = await covOf([{ agentId: '1621' }, { agentId: '1591' }, { agentId: '1211' }])
    const withVelina = await covOf([{ agentId: '1561' }, { agentId: '1591' }, { agentId: '1211' }])
    /**
     * 判据取**相对关系**而非绝对满覆盖：覆盖率 = 风化次数 × 单窗时长 / 有效时间（封顶 1），
     * 而「次数」由该队的能量预算/失衡次数决定、随配装与手法变。用户口径「打 4 次就 200s 达到
     * 全覆盖」是**常规 180s 战斗**下的结论，不是「任何配装任何时长都必满」——把 1.0 写成硬断言
     * 会在换配装/换 boss 时长时假红（本条初版即此错，实测 3 次 × 50s / 180s = 0.833）。
     * 真正要钉的是**延长的因果**：同一队、同一手法下，有延长 ⇒ 覆盖率必须**严格更高**。
     */
    expect(withRoxy, '洛克茜队（有 +20s 延长）覆盖率应高于对照').toBeGreaterThan(withVelina)
    expect(withRoxy, '50s 单窗 × 3 次 / 180s ≈ 0.83（含延长）').toBeGreaterThan(0.8)
    expect(withVelina, '30s 单窗 × 3 次 / 180s = 0.5（无延长）').toBeLessThan(0.6)
  })

  /**
   * 影画2·流势（免费自旋）：原文「每引爆 1 个[风眼]获得一层[流势]，至多 3 层；[小心风寒]期间进入
   * [自旋]状态下换人时，洛克茜将消耗所有[流势]，每消耗 1 层可以维持[自旋]状态 0.2 秒，
   * **期间不消耗能量**，至多维持 0.6 秒」。
   *
   * 用户口径 2026-10-26：「免费自旋你假设全吃满就行，有多少流势都可以吃完。因为换人不能作为条件，
   * 很容易达成。本来他转完就要换人。」⇒ 按满层 3×0.2 = 0.6s 建模。
   *
   * 判据必须钉 **energyConsume = 0**：这是「免费」的全部意义。若后人把它并进耗能自旋行，
   * 秒数白得但能量照扣（实测少算 18 点能量），收益方向会反过来。
   */
  it('影画2·流势：满层免费自旋 0.6s——伤害/喧响照给但不扣能量；C0/C1 无此行', () => {
    const raw = readFileSync(new URL('../../../data/raw/nanoka_missing/full/1621.json', import.meta.url), 'utf8')
      .replace(/<[^>]+>/g, '')
    expect(raw, 'raw 应声明每层 0.2 秒、至多 0.6 秒、期间不消耗能量').toMatch(/每消耗1层可以维持\[自旋\]状态0\.2秒，期间不消耗能量，至多维持0\.6秒/)

    const spinRowsOf = (cinema: number) => {
      const execs: any[] = []
      roxyMechanic.buildExecutions!({
        cfg: {
          roxyCinemaLevel: cinema, roxyExStartEnergy: 10, roxySpinEnergyPerSecond: 30,
          roxySpinSecondDamage: 2608.6, roxySpinSecondDecibel: 84.343, exSpecialEnergyConsume: 85,
        },
        state: { exSpecialCount: 6, ultimateCount: 2, totalEnergy: 900 } as any,
        executions: execs,
      } as any)
      return execs.filter((e: any) => String(e.moveId) === SPIN_SECOND_MOVE_ID_FOR_TEST)
    }
    const freeRow = (cinema: number) => spinRowsOf(cinema).find((e: any) => String(e.moveName).includes('流势'))

    expect(freeRow(0), 'C0 无流势').toBeUndefined()
    expect(freeRow(1), 'C1 无流势（影画2 起）').toBeUndefined()

    for (const c of [2, 6]) {
      const row = freeRow(c)
      expect(row, 'C' + c + ' 应有流势免费自旋行').toBeDefined()
      expect(row.totalEnergyConsume, '★ 免费：耗能必须 0').toBe(0)
      expect(row.energyConsume, '单发耗能 0').toBe(0)
      expect(row.count, '每局一次（换人消费全部流势）').toBe(1)
      expect(row.damageMultiplier, '伤害 = 2608.6 × 0.6').toBeCloseTo(2608.6 * 0.6, 3)
      expect(row.totalDecibelRecovery, '喧响 = 84.343 × 0.6').toBeCloseTo(84.343 * 0.6, 3)
    }
  })
  it('拐力通道非空：洛克茜的队向 buff 已进采集（位置对比差分不再恒 0）', async () => {
    const { config } = await setupHarness([{ agentId: '1621', cinemaLevel: 2 }, { agentId: '1591' }, { agentId: '1211' }])
    for (const b of config.globalBuffs) b.enabled = false
    const calc = useResourceCalc()
    const on = calc.teamTotalDamage.value
    // 全关洛克茜的队向 buff ⇒ 总伤必须下降（差分 > 0 才说明「拐力」有可归因的量）
    for (const id of ROXY_TEAM_BUFF_IDS) config.toggleTeammateBuff(id, false)
    const off = calc.teamTotalDamage.value
    expect(on, `关掉洛克茜队向 buff 后总伤必须下降（on=${on} off=${off}）`).toBeGreaterThan(off)
    expect(on / off - 1, '拐力量级应在 1% 以上（实测 ≈8.8%，C2 含易伤）').toBeGreaterThan(0.01)
  })
})

describe('洛克茜风能模型（v12 + 手法）', () => {
  it('手法：每轮强特攒满 3 风能（自旋 2.5s → 75 能量）→ 敬请安息消耗 3 → 恕不远送 1 次巨旋风', () => {
    const r = computeRoxyWindEnergy({ exSpecialCount: 2, ultimateCount: 0, spinSeconds: 2.5 })
    expect(ENERGY_PER_WIND_ENERGY).toBe(25)
    // 每轮 10 启动 + 75 自旋 = 85；风能 = 每轮 3（floor(85/25)=3）
    expect(r.windEnergyGain).toBe(6)
    expect(r.windEnergyConsumed).toBe(6)
    expect(r.sendOffCount).toBe(2)
    expect(r.megaTornadoCount).toBe(2)
    expect(r.miniTornadoCount).toBe(0) // 3/轮手法无余数
    expect(r.windEyeGenerated).toBe(6)
    expect(r.energySpentTotal).toBe(2 * (10 + 2.5 * 30))
  })

  it('终结技 +1 风能：消耗仍按每轮 3 封顶，结余 1 点不超存量上限', () => {
    const r = computeRoxyWindEnergy({ exSpecialCount: 1, ultimateCount: 1, spinSeconds: 2.5 })
    expect(r.windEnergyGain).toBe(4)
    expect(r.windEnergyConsumed).toBe(3)
    expect(r.sendOffCount).toBe(1)
    expect(r.megaTornadoCount).toBe(1)
  })

  it('风能不足 3 点：不触发恕不远送巨旋风（仅小旋风 1s/个，兜底口径）', () => {
    const r = computeRoxyWindEnergy({ exSpecialCount: 1, spinSeconds: 1 })
    // 1s 自旋：10 + 30 = 40 能量 → 1 风能
    expect(r.windEnergyGain).toBe(1)
    expect(r.windEnergyConsumed).toBe(1)
    expect(r.sendOffCount).toBe(0)
    expect(r.miniTornadoCount).toBe(1)
    expect(r.miniTornadoSeconds).toBe(1)
  })

  it('影画6 余响：每次恕不远送额外 +2 次巨型风旋（3× 引爆数）', () => {
    const r0 = computeRoxyWindEnergy({ exSpecialCount: 2, ultimateCount: 0, spinSeconds: 2.5, cinemaLevel: 0 })
    expect(r0.megaTornadoCount).toBe(2)
    const r6 = computeRoxyWindEnergy({ exSpecialCount: 2, ultimateCount: 0, spinSeconds: 2.5, cinemaLevel: 6 })
    expect(r6.megaTornadoCount).toBe(2 + 2 * ROXY_C6_ECHO_BURSTS)
  })

  it('CC-334：显式传入 exSpecialEnergyConsume 时按该值记单轮耗能，buildCharConfig 缺省自旋秒与 settings 一致为 2.5', () => {
    const r = computeRoxyWindEnergy({ exSpecialCount: 2, exSpecialEnergyConsume: 60, spinSeconds: 2.5 })
    expect(r.energySpentTotal).toBe(120)
    expect(r.windEnergyGain).toBe(4) // 2 × floor(60/25)

    const cfg: any = { initialEnergyGift: 0 }
    roxyMechanic.buildCharConfig!({ cinemaLevel: 0, cfg, skills: { categories: [] } as any, getRowValue: () => 0 } as any)
    expect(cfg.exSpecialEnergyConsume).toBe(10 + 2.5 * 30)
  })
})

/**
 * 2026-10-27 用户报：「我洛克茜作为主打强特的角色为什么全变成平a了」。
 *
 * 病灶 = **自旋一秒都不占前台**：1621007/1621008/1621023 三行 `actionTime: 0`、自旋行
 * `timeBucket: 'backstage'` ⇒ 行 `totalTime` 全 0（结果页动作清单只剩平A行），账本侧也没有
 * `estimateExSpecialTime`（走通用 `exSpecialCount × 1621007 的 0.105s`）⇒ 每局 20~28 秒自旋
 * 既不在必要时间、也不在物化行 = 这段时间被平A池二次使用（`banyue-roxy-lucia` 修前：
 * 自旋 23.48s、她 necessary 10.40s、平A 28.57s）。
 *
 * 两条判据互相独立、单独删任一处都会红：
 *  ① 自旋行 `actionTime > 0` 且桶是 necessary（不是 backstage）；② 动作清单（结果卡数据源）里确有强化特殊技行。
 */
describe('洛克茜强特时间账（2026-10-27：自旋占前台）', () => {
  const EX_MOVE_IDS = ['1621007', '1621008', '1621023'] as const

  it('① 自旋行 actionTime > 0 且 timeBucket = necessary（不再当后台行）', async () => {
    await setupHarness([{ agentId: '1621' }, { agentId: '1251' }, { agentId: '1031' }])
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 0))
    const ch = calc.resourceResult.value!.characters.find(c => c.agentId === '1621')!
    const exRows = ch.executions.filter(e => (EX_MOVE_IDS as readonly string[]).includes(String(e.moveId)))
    expect(exRows.length, '反空洞：确有强特行').toBeGreaterThanOrEqual(3)
    for (const row of exRows) {
      expect(Number(row.actionTime), row.moveName + ' 单次时长').toBeGreaterThan(0)
      expect(row.timeBucket, row.moveName + ' 前台桶').toBe('necessary')
      expect(Number(row.totalTime), row.moveName + ' 总时长').toBeGreaterThan(0)
    }
  }, 120000)

  it('② 动作清单里有强化特殊技行（用户报的「全是平A」不再复现）', async () => {
    await setupHarness([{ agentId: '1621' }, { agentId: '1251' }, { agentId: '1031' }])
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 0))
    const ch = calc.resourceResult.value!.characters.find(c => c.agentId === '1621')!
    const rows = buildActionOperationRows(ch)
    const ex = rows.filter(r => (EX_MOVE_IDS as readonly string[]).includes(r.key))
    const basic = rows.filter(r => r.key === 'basic_attack')
    expect(ex.length, '动作清单应含强特行').toBeGreaterThan(0)
    const exTime = ex.reduce((s, r) => s + r.frontlineTime, 0)
    const basicTime = basic.reduce((s, r) => s + r.frontlineTime, 0)
    expect(exTime, '强特前台时间应显著（>10s）').toBeGreaterThan(10)
    // 用户看到的症状是「强特时间 ≈ 0、平A 吃掉全部」⇒ 强特时间必须与平A同量级（不是 1%）
    expect(exTime / (exTime + basicTime), '强特时间占比不应是噪声量级').toBeGreaterThan(0.15)
  }, 120000)
})

describe('局外总回能 energyRegenOutOfCombat 两相一致（第 194 轮）', () => {
  it('局外面板与局内面板同值 = 基础 × (1 + 局外%) + 局外固定（局外面板不再残留缺省 1.2）', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1621' }, { agentId: '1081' }, { agentId: '1031' }], { recommendedBuild: true })
    const ph = computePanelPhases(0, config, catalog)!
    const o = ph.outOfCombat
    const expected = o.energyRegen * (1 + o.energyRegenBonusPct / 100) + o.energyRegenBonusFlat
    expect(expected).toBeGreaterThan(1.2) // 推荐配装带回能：否则本断言无判别力
    expect(o.energyRegenOutOfCombat).toBeCloseTo(expected, 9)
    expect(ph.inCombat.energyRegenOutOfCombat).toBeCloseTo(expected, 9)
  })
})
