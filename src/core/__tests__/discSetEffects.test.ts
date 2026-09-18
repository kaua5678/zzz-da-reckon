/**
 * 驱动盘套装 2pc/4pc 生效测试（2026-09 审计修复配套）
 *
 * 覆盖：震星迪斯科/极地重金属/自由蓝调 4pc 补录、啄木鸟 3 层、摇摆爵士 teamBuff、
 * 如影相随/山大王 2pc 补录、requirement 门槛（def/AM/critRate/specialty/attribute）、
 * {attribute} stat 模板、teamBuff 装备者门槛（山大王/月光骑士颂/雪兔）。
 * 数据：scripts/patch-disc-sets.mjs 写入 catalog.json；消费端：buff.ts collectDriveDiscBuffs
 * + inCombatBuffs.ts discTeamRequirementMet。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calcPanel, emptyPanel } from '@/core/panel'
import { buildTeammateBuffSourceContext } from '@/core/teammateBuffSource'
import { getStunBuildUpBonus, getTargetedStat } from '@/core/buff'
import { getElementEnemyAnomalyResReduction, resolveStatElement, getElementDmgKey } from '@/core/anomalyPool/helpers'
import { normalizeResourceSkillType } from '@/composables/resourceCalc/helpers'
import { calcDirectDamage } from '@/core/damage'
import { setupHarness } from '@/test/harness'
import { computePanel } from '@/composables/resourceCalc/helpers'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'

function loadCatalog() {
  return JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))
}

const cat = loadCatalog() as any
const setsMap = new Map<string, any>(cat.driveDiscSets.map((s: any) => [String(s.id), s]))
const statRules = cat.statRules
const getAgent = (id: string) => cat.agents.find((a: any) => a.id === id || a.teammateBuffId === id)

function disc(overrides: Record<string, any> = {}): any {
  return {
    fourPieceSetId: '',
    twoPieceSetId: '',
    mainStats: {},
    subStatAllocation: {},
    ...overrides,
  }
}

function panelFor(agentId: string, d: any) {
  const agent = getAgent(agentId)
  return calcPanel(agent, undefined, d, setsMap, [], statRules, { cinemaLevel: 0, wEngineModLevel: 1 })
}

/** 队友面板增量：owner 穿 fourPiece 后，target/owner 面板相对 owner 空盘基线的变化 */
function teammatePanels(ownerId: string, ownerIdDisc: any) {
  const targetAgent = getAgent('1241')
  const ownerAgent = getAgent(ownerId)
  const run = (ownerDisc: any) => {
    const team = [
      { agentId: ownerId, driveDisc: ownerDisc, cinemaLevel: 0, wEngineModLevel: 1 },
      { agentId: '1241', driveDisc: disc(), cinemaLevel: 0, wEngineModLevel: 1 },
    ]
    const ctx = buildTeammateBuffSourceContext(team, {
      teammateBuffGroups: [],
      driveDiscSetsMap: setsMap,
      statRules,
      getAgent,
      getWEngine: () => undefined,
      isTeammateBuffEnabled: () => false,
    })
    const target = calcPanel(targetAgent, undefined, disc(), setsMap, ctx.enabledTeammateBuffs, statRules, {
      cinemaLevel: 0,
      wEngineModLevel: 1,
      sourcePanelsByOwner: ctx.sourcePanelsByOwner,
    })
    // owner 自己也带队友 buff 计算（includeOwner 语义：驱动盘 teamBuff 装备者同样生效）
    const owner = calcPanel(ownerAgent, undefined, ownerDisc, setsMap, ctx.enabledTeammateBuffs, statRules, {
      cinemaLevel: 0,
      wEngineModLevel: 1,
      sourcePanelsByOwner: ctx.sourcePanelsByOwner,
    })
    return { target, owner }
  }
  const baseline = run(disc())
  const withSet = run(ownerIdDisc)
  return { target: withSet.target, owner: withSet.owner, baseline }
}

const EMPTY = disc()

describe('驱动盘 4pc 补录', () => {
  it('震星迪斯科 4pc：普攻/冲刺/闪避反击失衡值+20，其他招式不生效', () => {
    const p = panelFor('1481', disc({ fourPieceSetId: '31200', mainStats: { 6: 'impact' } })).inCombat
    const base = panelFor('1481', disc({ mainStats: { 6: 'impact' } })).inCombat
    expect(getStunBuildUpBonus(p, 'basic') - getStunBuildUpBonus(base, 'basic')).toBe(20)
    expect(getStunBuildUpBonus(p, 'dashAttack') - getStunBuildUpBonus(base, 'dashAttack')).toBe(20)
    expect(getStunBuildUpBonus(p, 'dodgeCounter') - getStunBuildUpBonus(base, 'dodgeCounter')).toBe(20)
    expect(getStunBuildUpBonus(p, 'ultimate') - getStunBuildUpBonus(base, 'ultimate')).toBe(0)
  })

  it('极地重金属 4pc：普攻/冲刺伤害+40（基础20+冻结段20），其他招式不生效', () => {
    const p = panelFor('1341', disc({ fourPieceSetId: '32500' })).inCombat
    expect(getTargetedStat(p, 'dmgBonus', 'basic')).toBe(40)
    expect(getTargetedStat(p, 'dmgBonus', 'dashAttack')).toBe(40)
    expect(getTargetedStat(p, 'dmgBonus', 'ultimate')).toBe(0)
    expect(p.dmgBonus).toBe(0)
  })

  it('自由蓝调 4pc：挂敌人 8s，全队同属性积蓄受益（teamBuff 按装备者属性落键）', () => {
    // 苍角(1131·冰)装备 → 队友(朱鸢·以太)面板拿到的是【冰】减抗（按装备者属性，不是受益者属性）
    const r = teammatePanels('1131', disc({ fourPieceSetId: '31300' }))
    expect(r.target.inCombat.enemyIceAnomalyResReduction).toBe(20)
    expect(r.target.inCombat.enemyEtherAnomalyResReduction ?? 0).toBe(0)
    // 装备者自己同样吃到（includeOwner）
    expect(r.owner.inCombat.enemyIceAnomalyResReduction).toBe(20)
    // 雅的烈霜(frostfire) 属性数值口径全按冰（用户口径 2026-09-05）：
    // 积蓄减抗、敌方积蓄抗性、增伤键都读冰
    expect(getElementEnemyAnomalyResReduction(r.target.inCombat, 'frostfire')).toBe(20)
    expect(resolveStatElement('frostfire')).toBe('ice')
    expect(getElementDmgKey('frostfire')).toBe('iceDmg')
  })
})

describe('招式类型定向接线（字段对应）', () => {
  it('normalizeResourceSkillType：冲刺招式按名称归类 dashAttack（catalog skillType 误标 dodge 的纠正）', () => {
    const skills = cat.agentSkills.find((s: any) => String(s.agentId) === '1131')
    const move = skills.categories.flatMap((c: any) => c.moves).find((m: any) => m.id === '1131016')
    expect(move.skillType).toBe('dodge')
    expect(normalizeResourceSkillType(move, '1131016')).toBe('dashAttack')
    expect(normalizeResourceSkillType(move, '1131016')).not.toBe('dodgeCounter')
  })

  it('烈霜(frostfire) 伤害按冰族读增伤与敌方冰抗（雅吃冰伤冰抗）', () => {
    const p = emptyPanel()
    p.atk = 1000
    p.iceDmg = 50
    const baseInput = {
      panel: p,
      skillMultiplier: 100,
      damageBasis: 'atk',
      enemyDefense: 1000,
      enemyDefReduction: 0,
      enemyDefFlatReduction: 0,
      enemyLevel: 70,
      enemyResReduction: 0,
      stunMultiplier: 1,
      stunned: false,
      critMode: 'nonCrit' as const,
      count: 1,
    }
    const withIce = calcDirectDamage({ ...baseInput, damageElement: 'frostfire' as any, enemyResistance: 0 }).damage
    const noIceEl = calcDirectDamage({ ...baseInput, damageElement: 'physical', enemyResistance: 0 }).damage
    // frostfire 行吃到 iceDmg+50%（physical 行不吃）
    expect(withIce).toBeGreaterThan(noIceEl * 1.4)
    // 敌方冰抗 20% 生效在 frostfire 行上
    const withRes = calcDirectDamage({ ...baseInput, damageElement: 'frostfire' as any, enemyResistance: 20 }).damage
    expect(withRes).toBeLessThan(withIce)
  })

  it('元素暴伤族接入暴击乘区（焰心桂冠 iceCritDmg/fireCritDmg 此前纯死数据）', () => {
    const p = emptyPanel()
    p.atk = 1000
    p.critRate = 100
    const baseInput = {
      panel: p,
      skillMultiplier: 100,
      damageBasis: 'atk',
      enemyDefense: 1000,
      enemyDefReduction: 0,
      enemyDefFlatReduction: 0,
      enemyLevel: 70,
      enemyResistance: 0,
      enemyResReduction: 0,
      stunMultiplier: 1,
      stunned: false,
      count: 1,
    }
    const noBuff = calcDirectDamage({ ...baseInput, damageElement: 'fire', critMode: 'crit' }).damage
    const withBuff = calcDirectDamage({ ...baseInput, damageElement: 'fire', critMode: 'crit', panel: { ...p, fireCritDmg: 30 } }).damage
    expect(withBuff).toBeCloseTo(noBuff * 1.2, 6)
    // 其它元素行不吃火元素暴伤
    const otherEl = calcDirectDamage({ ...baseInput, damageElement: 'electric', critMode: 'crit', panel: { ...p, fireCritDmg: 30 } }).damage
    expect(otherEl).toBe(noBuff)
    // 烈霜行按冰读 iceCritDmg
    const frost = calcDirectDamage({ ...baseInput, damageElement: 'frostfire' as any, critMode: 'crit', panel: { ...p, iceCritDmg: 30 } }).damage
    const frostNone = calcDirectDamage({ ...baseInput, damageElement: 'frostfire' as any, critMode: 'crit' }).damage
    expect(frost).toBeCloseTo(frostNone * 1.2, 6)
  })

  it('条件效果覆盖率滑块：炎狱 4pc 50% → critRate +14（28 的一半），面板页与资源管线同源', async () => {
    const { catalog, config } = await setupHarness(['', '', ''])
    config.setAgent(0, '1131')
    config.team[0].driveDisc.fourPieceSetId = '32200'
    const full = computePanel(0, config, catalog)!
    expect(full.critRate).toBeGreaterThan(0)
    config.setDiscEffectCoverage('effect_inferno_metal_4pc_crit_rate', 50)
    const half = computePanel(0, config, catalog)!
    expect(full.critRate - half.critRate).toBeCloseTo(14, 6)
  })

  // 2026-09-08：这批效果此前「页面上没有滑块」被用户读成「属性没做」——补 condition 后
  // 滑块出现，此测试钉住新暴露的滑块确实接线（改滑块 → 面板变）。
  it('囚徒手记 4pc 覆盖率滑块（新补 condition 段）：异放段 50% → 异常精通 +24', async () => {
    const { catalog, config } = await setupHarness(['', '', ''])
    config.setAgent(0, '1541') // 普罗米娅（冰异常）
    config.team[0].driveDisc.fourPieceSetId = '33800'
    config.team[0].driveDisc.twoPieceSetId = ''
    const full = computePanel(0, config, catalog)!
    config.setDiscEffectCoverage('effect_b4b0ddbf11', 50)
    const half = computePanel(0, config, catalog)!
    config.team[0].driveDisc.fourPieceSetId = ''
    const none = computePanel(0, config, catalog)!
    expect(full.anomalyProficiency - none.anomalyProficiency, '默认满覆盖拿满 +48').toBe(48)
    expect(full.anomalyProficiency - half.anomalyProficiency, '50% 覆盖率折算一半').toBeCloseTo(24, 6)
  })

  it('标准 exec 行携带 skillDamageTarget；极地重金属 4pc 普攻/冲刺限定增伤在伤害行生效', async () => {
    const run = async (fourPieceSetId: string, twoPieceSetId: string) => {
      await setupHarness(['', '', ''])
      const config = useConfigStore()
      config.setAgent(0, '1131')
      config.team[0].driveDisc.fourPieceSetId = fourPieceSetId
      config.team[0].driveDisc.twoPieceSetId = twoPieceSetId
      const calc = useResourceCalc()
      return { rr: calc.resourceResult.value!, rows: calc.damagePoolRows.value }
    }
    // 两臂都带 2pc（冰伤+10%），只差 4pc 的普攻/冲刺定向段 → 冲刺/普攻行变强，强特行不变
    const base = await run('', '32500')
    const with4 = await run('32500', '32500')
    const execs = with4.rr.characters[0].executions
    const dashExec = execs.find(e => e.moveId === '1131016')
    expect(dashExec?.skillDamageTarget).toBe('dashAttack')
    const basicExec = execs.find(e => e.moveId === '1131006' || e.moveId === 'basic_attack')
    expect(basicExec?.skillDamageTarget).toBe('basic')
    const rowOf = (rows: ReturnType<typeof useResourceCalc>['damagePoolRows']['value'], moveId: string) =>
      rows.find(r => r.moveId === moveId)
    const dashBase = rowOf(base.rows, '1131016')
    const dashWith = rowOf(with4.rows, '1131016')
    expect(dashBase && dashWith).toBeTruthy()
    expect(dashWith!.totalDamage).toBeGreaterThan(dashBase!.totalDamage)
    const basicWith = with4.rows.filter(r => r.moveId === '1131006' || r.moveId === 'basic_attack')
    const basicBase = base.rows.filter(r => r.moveId === '1131006' || r.moveId === 'basic_attack')
    expect(basicWith.reduce((s, r) => s + r.totalDamage, 0)).toBeGreaterThan(basicBase.reduce((s, r) => s + r.totalDamage, 0))
    // 强特行不吃 4pc 定向段（两臂 2pc 相同 → 逐位相等）
    const exBase = rowOf(base.rows, '1131011')
    const exWith = rowOf(with4.rows, '1131011')
    expect(exWith!.totalDamage).toBe(exBase!.totalDamage)
  })
})

describe('驱动盘 4pc 口径修正', () => {
  it('啄木鸟电音 4pc：3 层×9%=27% 攻击力（原只录单层）', () => {
    const withSet = panelFor('1131', disc({ fourPieceSetId: '31000', twoPieceSetId: '31000' }))
    const without = panelFor('1131', EMPTY)
    // 局内攻击增量 = 局外攻击 × 27%（2pc 暴击率不叠攻击）
    expect(withSet.inCombat.atk - without.inCombat.atk).toBeCloseTo(withSet.outOfCombat.atk * 0.27, 4)
    expect(withSet.inCombat.critRate - without.inCombat.critRate).toBe(8)
  })

  it('摇摆爵士 4pc：全队 +15% 只录 teamBuff——装备者恰好吃一份（15），不得双计 30', () => {
    const team = teammatePanels('1411', disc({ fourPieceSetId: '31600' }))
    expect(team.target.inCombat.dmgBonus - team.baseline.target.inCombat.dmgBonus).toBe(15)
    expect(team.owner.inCombat.dmgBonus - team.baseline.owner.inCombat.dmgBonus).toBe(15)
  })
})

describe('驱动盘 2pc 补录', () => {
  it('如影相随 2pc：追加/冲刺伤害+15%（定向），不进全局增伤', () => {
    const p = panelFor('1131', disc({ twoPieceSetId: '32900' })).inCombat
    expect(getTargetedStat(p, 'dmgBonus', 'dashAttack')).toBe(15)
    expect(getTargetedStat(p, 'dmgBonus', 'additionalAttack')).toBe(15)
    expect(getTargetedStat(p, 'dmgBonus', 'basic')).toBe(0)
  })

  it('山大王 2pc：攻击失衡值+6%', () => {
    const p = panelFor('1481', disc({ twoPieceSetId: '33200' })).inCombat
    const base = panelFor('1481', EMPTY).inCombat
    expect(getStunBuildUpBonus(p, 'all') - getStunBuildUpBonus(base, 'all')).toBe(6)
  })
})

describe('requirement 门槛', () => {
  it('荆棘玫瑰 4pc：防御<1000 零档，双防主词条+副词条过 1800 双档', () => {
    // 凯撒 defBase=754：无防主词条 → 粗算 def=754 <1000 → 两档都不给
    const none = panelFor('1071', disc({ fourPieceSetId: '34200' })).inCombat
    const baseNone = panelFor('1071', EMPTY).inCombat
    expect(none.critRate - baseNone.critRate).toBe(0)
    // 双防%主词条 + 防%副词条 → ≥1800 → 两档 +16
    const both = panelFor('1071', disc({
      fourPieceSetId: '34200',
      mainStats: { 4: 'defPct', 5: 'defPct' },
      subStatAllocation: { defPct: 20 },
    })).inCombat
    const baseBoth = panelFor('1071', disc({
      mainStats: { 4: 'defPct', 5: 'defPct' },
      subStatAllocation: { defPct: 20 },
    })).inCombat
    expect(both.critRate - baseBoth.critRate).toBe(16)
  })

  it('折枝剑歌 4pc：异常掌控≥115 才给暴伤+30（6号位掌控主词条达标）', () => {
    const withAm = panelFor('1481', disc({ fourPieceSetId: '32700', mainStats: { 6: 'anomalyMastery' } })).inCombat
    const baseWithAm = panelFor('1481', disc({ mainStats: { 6: 'anomalyMastery' } })).inCombat
    // 1481 琉音 AM=94 + 30 主词条 = 124 ≥115 → 生效（2pc 暴伤16 + 4pc 暴伤30）
    expect(withAm.critDmg - baseWithAm.critDmg).toBe(30 + 16)
    const noAm = panelFor('1481', disc({ fourPieceSetId: '32700' })).inCombat
    const baseNoAm = panelFor('1481', EMPTY).inCombat
    // 94 < 115 → 4pc 暴伤段不生效（2pc 暴伤16 照常）；暴击率段无门槛照常
    expect(noAm.critDmg - baseNoAm.critDmg).toBe(16)
    expect(noAm.critRate - baseNoAm.critRate).toBe(12)
  })

  /**
   * ★★ round 29（R28-J1 扫描收口）：**门槛判据必须真的跨过阈值**，否则判据对门槛输入不可见。
   *
   * 实测证据（本轮注入法扫描，见 `.claude/PROMPT-handoff-round29.md` §1）：
   * 上面两条门槛判据（折枝剑歌 / 荆棘玫瑰）**都只用了同侧的臂**——
   * - 折枝剑歌用 1481（基础 94）：pct 口径 `94×1.3 = 122.2`、flat 口径 `94+30 = 124`，
   *   **两者都 ≥115** ⇒ 无论门槛输入怎么算，套装都发放 ⇒ 判据看不见。
   * - 荆棘玫瑰用 1071（基础 753.9）：`753.9` 与 `753.9+184 = 937.9` **都 <1000**；
   *   双防%臂 `2201.7` 与 `2385.7` **都 ≥1800** ⇒ 两臂都不跨阈 ⇒ 同样看不见。
   * ⇒ 实测注入 `roughStats.def` 丢掉 3 号位固定主词条 184（`buff.ts`）⇒ **全套 2994 例 0 红**。
   *
   * **一条判据要能看见门槛输入，必须至少有一条臂落在「改前不过、改后过」的跨阈区**。
   * 下面两例就是按这个口径挑的（穷举 62 角色 × 配置后取最近阈值的一对）。
   */
  it('★ 荆棘玫瑰 4pc：3号位固定主词条 184 必须计入 `roughStats.def`（用跨阈配置，非达标/非全不达标）', () => {
    // 1561 维琳娜 defBase=612.6；防%副词条 7 步 ⇒ 无 184 时 818.4 <1000、有 184 时 1002.4 ≥1000。
    // ⇒ 这一对配置让「184 是否计入」直接决定第一档发放与否。
    const straddle = { fourPieceSetId: '34200', subStatAllocation: { defPct: 7 } }
    const withSet = panelFor('1561', disc(straddle)).inCombat
    const base = panelFor('1561', disc({ subStatAllocation: { defPct: 7 } })).inCombat
    // 有 184 ⇒ 常规增伤 15 + 1000 档暴击率 8；1800 档仍不达（1002.4 <1800）
    expect(withSet.critRate - base.critRate, '1000 档必须发放（184 计入后 1002.4）').toBe(8)
    expect(withSet.dmgBonus - base.dmgBonus, '常驻 15% 增伤段').toBe(15)
    // 负控：砍掉 1 步副词条 ⇒ 612.6×1.288 = 789.0，即使有 184 也只有 973.0 <1000 ⇒ 零档
    const below = panelFor('1561', disc({ fourPieceSetId: '34200', subStatAllocation: { defPct: 6 } })).inCombat
    const belowBase = panelFor('1561', disc({ subStatAllocation: { defPct: 6 } })).inCombat
    expect(below.critRate - belowBase.critRate, '973.0 <1000 ⇒ 第一档也不发').toBe(0)
  })

  it('★ 折枝剑歌 4pc：门槛吃 `roughStats`（加点口径），用「pct 不过 / flat 过」的跨阈角色', () => {
    // 1111 安东基础掌控 86：pct 口径 86×1.3 = 111.8 <115；flat 口径 86+30 = 116 ≥115。
    // ⇒ 这一例对「门槛用什么口径算掌控」**直接可见**（1481 的 94 在两种口径下都 ≥115，看不见）。
    const withSet = panelFor('1111', disc({ fourPieceSetId: '32700', mainStats: { 6: 'anomalyMastery' } })).inCombat
    const base = panelFor('1111', disc({ mainStats: { 6: 'anomalyMastery' } })).inCombat
    // 4pc 暴伤 30 段必须发放（门槛按 86+30 = 116 ≥115），2pc 暴伤 16 照常
    expect(withSet.critDmg - base.critDmg, '116 ≥115 ⇒ 4pc 暴伤段发放').toBe(30 + 16)
    // 负控：不装 6 号位掌控 ⇒ roughStats.anomalyMastery = 86 <115 ⇒ 只有 2pc 的 16
    const noMain = panelFor('1111', disc({ fourPieceSetId: '32700' })).inCombat
    const noMainBase = panelFor('1111', EMPTY).inCombat
    expect(noMain.critDmg - noMainBase.critDmg, '86 <115 ⇒ 4pc 段不发').toBe(16)
  })

  /**
   * ★ round 28（R27-J2 结案）：6 号位掌控主词条的数值口径 —— **加点（flat）而非乘基础值（pct）**。
   *
   * ⚠⚠ **为什么必须钉**：上面那条断言（`critDmg − critDmg === 46`）**算术上抓不到这个 bug**：
   * 4pc 门槛吃的是 `buff.ts#collectAllBuffs` 的 `roughStats`（口径恒为 `level60.anomalyMastery + maxMain`，
   * **无论 `inferStatMode` 怎么判**），而 1481 基础 94 在**两种口径下都 ≥115**
   * （pct: `94×1.3 = 122.2` / flat: `94+30 = 124`）⇒ 套装照常发放、断言照常绿。
   * 修前实测：`inferStatMode` 把 `display = "number"` 的 `anomalyMastery` 当 pct ⇒ **全仓无一条测试断言过面板绝对值**
   * ⇒ 「已发放的基线」在修前是**假绿**的（口径错但判据全绿）。
   * ⇒ 本条直接钉**面板绝对值**，与 `statDisplay.display` 的语义绑定。
   *
   * 四个独立来源一致指向 `94 + 30 = 124`：
   * ① `statDisplay.anomalyMastery.display = "number"`（＝加点）；② 上面的 `roughStats`；
   * ③ `STAT_META.anomalyMastery.mode = 'flat'`；④ `docs/GAME_TERM_TO_CODE_FIELD.md` §11.2。
   */
  it('6号位掌控主词条 = 加点（+30）而非乘基础值（×1.3）—— 与 statDisplay.display="number" 同口径', () => {
    // 1481 琉音：基础 94 → 94 + 30 = 124（pct 口径会得 94×1.3 = 122.2）
    const am = panelFor('1481', disc({ mainStats: { 6: 'anomalyMastery' } })).inCombat
    expect(am.anomalyMastery).toBe(124)
    expect(am.anomalyMastery).not.toBeCloseTo(94 * 1.3, 5)
    // 低掌控侧：基础 86 → 86 + 30 = 116（**≥115 门槛**；pct 口径的 111.8 会让面板与 4pc 门槛自相矛盾）
    for (const id of ['1111', '1121', '1271', '1291']) {
      const a = getAgent(id)
      expect(a.level60.anomalyMastery, `${id} 基础掌控应为 86`).toBe(86)
      const p = panelFor(id, disc({ mainStats: { 6: 'anomalyMastery' } })).inCombat
      expect(p.anomalyMastery, `${id} 6号位掌控主词条`).toBe(116)
    }
    // 2pc 异常掌控 +8% 仍是 **pct**（display="percent"）⇒ 两处口径在同一面板上并存且互不干扰
    const amPct = panelFor('1481', disc({ mainStats: { 6: 'anomalyMastery' } })).withDiscs
    expect(amPct.anomalyMastery).toBe(124)
  })

  /**
   * ★ round 28：**反向**钉住 `inferStatMode` 不得改读 `STAT_META.mode`（防后人「统一口径」时把
   * `energyRegen` 的 6 号位 `+60%` 变成 `+60 点/秒`）。
   *
   * ⚠ 这里必须读 `statDisplay.display`（catalog），**不能**读 `STAT_META`：
   * 两者对 `energyRegen` 结论相反（display=percent / STAT_META.mode=flat）。
   * ⚠⚠ 注意 `energyRegen` 的口径错**在面板字段上看不见**（`energyRegenBonusPct` vs `BonusFlat`
   * 是两个不同的字段），所以本判据直接钉**字段落点**，而不是钉 `panel.energyRegen`。
   */
  it('6号位能量回复主词条 = percent 口径（落 BonusPct 字段），未与 STAT_META.flat 合并', () => {
    const pct = panelFor('1481', disc({ mainStats: { 6: 'energyRegen' } })).inCombat
    const none = panelFor('1481', EMPTY).inCombat
    // display="percent" ⇒ maxMain.energyRegen = 60 走 pct 累加器
    expect(pct.energyRegenBonusPct - none.energyRegenBonusPct).toBe(60)
    expect(pct.energyRegenBonusFlat - none.energyRegenBonusFlat).toBe(0)
  })

  it('6号位冲击力/异常精通 = 固定值加点（display="number"/"integer"）', () => {
    const impact = panelFor('1481', disc({ mainStats: { 6: 'impact' } })).withDiscs
    expect(impact.impact - panelFor('1481', EMPTY).withDiscs.impact).toBe(18)
    const prof = panelFor('1481', disc({ mainStats: { 4: 'anomalyProficiency' } })).withDiscs
    expect(prof.anomalyProficiency - panelFor('1481', EMPTY).withDiscs.anomalyProficiency).toBe(92)
  })

  it('拂晓生花 4pc：非强攻角色只拿第一段（要求 specialty=attack）', () => {
    const attack = panelFor('1521', disc({ fourPieceSetId: '33300' })).inCombat
    expect(getTargetedStat(attack, 'dmgBonus', 'basic')).toBe(15 + 40)
    const support = panelFor('1411', disc({ fourPieceSetId: '33300' })).inCombat
    expect(getTargetedStat(support, 'dmgBonus', 'basic')).toBe(15 + 20)
  })

  it('拂晓行纪 4pc：以太属性才给暴伤+30（要求 attribute=ether）', () => {
    const ether = panelFor('1311', disc({ fourPieceSetId: '34000' })).inCombat
    const base = panelFor('1311', EMPTY).inCombat
    expect(ether.critDmg - base.critDmg).toBe(30)
    const nonEther = panelFor('1411', disc({ fourPieceSetId: '34000' })).inCombat
    const baseNon = panelFor('1411', EMPTY).inCombat
    expect(nonEther.critDmg - baseNon.critDmg).toBe(0)
  })

  it('谶羽之誓 4pc：流明属性额外+15% 属性异常伤害', () => {
    const lum = panelFor('1581', disc({ fourPieceSetId: '34100' })).inCombat
    const baseLum = panelFor('1581', EMPTY).inCombat
    expect(lum.anomalyProficiency - baseLum.anomalyProficiency).toBe(30 + 50)
    expect(lum.anomalyDmgBonus - baseLum.anomalyDmgBonus).toBe(15)
    const ether = panelFor('1311', disc({ fourPieceSetId: '34100' })).inCombat
    const baseEther = panelFor('1311', EMPTY).inCombat
    expect(ether.anomalyProficiency - baseEther.anomalyProficiency).toBe(30 + 50)
    expect(ether.anomalyDmgBonus - baseEther.anomalyDmgBonus).toBe(0)
  })
})

describe('teamBuff 装备者门槛', () => {
  it('山大王 4pc：击破位传播全队暴伤；装备者暴击率≥50% 第二段才生效', () => {
    // 1481 琉音(击破) 无暴击配置 → 5+24(4号位主)=29 <50 → 只有第一段 15
    const low = teammatePanels('1481', disc({ fourPieceSetId: '33200', mainStats: { 4: 'critRate' } }))
    expect(low.target.inCombat.critDmg - low.baseline.target.inCombat.critDmg).toBe(15)
    // 4号位主24 + 17条×2.4=40.8 + 5 = 69.8 ≥50 → 两段 30
    const high = teammatePanels('1481', disc({
      fourPieceSetId: '33200',
      mainStats: { 4: 'critRate' },
      subStatAllocation: { critRate: 17 },
    }))
    expect(high.target.inCombat.critDmg - high.baseline.target.inCombat.critDmg).toBe(30)
  })

  it('山大王 4pc：非击破位装备者不传播', () => {
    const r = teammatePanels('1521', disc({ fourPieceSetId: '33200' }))
    expect(r.target.inCombat.critDmg - r.baseline.target.inCombat.critDmg).toBe(0)
  })

  it('月光骑士颂 4pc：支援位传播全队伤害+18%，强攻位不传播', () => {
    const support = teammatePanels('1411', disc({ fourPieceSetId: '33400' }))
    expect(support.target.inCombat.dmgBonus - support.baseline.target.inCombat.dmgBonus).toBe(18)
    const attack = teammatePanels('1521', disc({ fourPieceSetId: '33400' }))
    expect(attack.target.inCombat.dmgBonus - attack.baseline.target.inCombat.dmgBonus).toBe(0)
  })

  // 面板页把全队段也挂上了覆盖率滑块（2026-09-08），此测试钉住 teamBuff 通道同样按效果 id 折算
  it('山大王 4pc 全队段覆盖率 50% → 队友暴伤 +7.5（teamBuff 通道的滑块确实接线）', async () => {
    const { catalog, config } = await setupHarness([
      { agentId: '1481', driveDisc: { fourPieceSetId: '33200', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} } } as never,
      { agentId: '1241' } as never,
      '',
    ])
    const full = computePanel(1, config, catalog)!
    config.setDiscEffectCoverage('effect_e044f6f6b8', 50)
    const half = computePanel(1, config, catalog)!
    expect(full.critDmg - half.critDmg, '全队暴伤 15% 段按 50% 覆盖率折算').toBeCloseTo(7.5, 5)
  })

  it('雪兔梦游仙境 4pc：防护位传播全队伤害+18%（6%×3 层），强攻位不传播', () => {
    const defense = teammatePanels('1071', disc({ fourPieceSetId: '33700' }))
    expect(defense.target.inCombat.dmgBonus - defense.baseline.target.inCombat.dmgBonus).toBe(18)
    const attack = teammatePanels('1521', disc({ fourPieceSetId: '33700' }))
    expect(attack.target.inCombat.dmgBonus - attack.baseline.target.inCombat.dmgBonus).toBe(0)
  })
})
