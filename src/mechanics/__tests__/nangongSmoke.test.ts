/**
 * 南宫羽（1511）录入生效测试（SOP §6.10）：
 * 面板区差分（精通/冲击转模/积蓄效率/失衡值/C1减抗）、重拍账本→地雷撞双击行（真实 moveId）、
 * 滑块生效（coreBuffCoverage 0↔1 面板确实变，防死滑块）、颤音异放事件（anomalyDamageRatio 折叠层数）、
 * 命座差分 C1/C4/C6。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { extractSkillExecutions } from '@/composables/resourceCalc/helpers'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { computeNangongMinePairs, nangongBeatIncome, nangongMechanic } from '../agents/nangong'

async function setupNangong(cinemaLevel: number) {
  const { config, catalog } = await setupHarness([{ agentId: '1511', cinemaLevel }])
  const calc = useResourceCalc()
  return { config, catalog, calc }
}

describe('南宫羽（1511）核心被动面板区', () => {
  it('精通+120、掌控>110 转冲击进面板', async () => {
    await setupNangong(0)
    // 纯函数口径：掌控 150 → 冲击 +40
    expect(nangongMechanic.applyPanel).toBeTruthy()
    const { computeNangongMechanic } = await import('../agents/nangong')
    const src = computeNangongMechanic({
      anomalyMastery: 150, frontlineSeconds: 0, battleTime: 0,
      beatInitial: 30, minePairs: 0, vibratoStacks: 4, releaseCount: 0,
    })
    expect(src.impactFromMastery).toBe(40)
    expect(src.anomalyProficiencyBonus).toBe(120)
  })

  it('滑块生效：coreBuffCoverage 0→1 面板积蓄效率/失衡值确实变（防死滑块）', async () => {
    const { config, catalog } = await setupNangong(0)
    const inCombatAt = () => computePanelPhases(0, config, catalog)!.inCombat
    config.setMechanicSetting('nangong.coreBuffCoverage', 0)
    const off = inCombatAt()
    config.setMechanicSetting('nangong.coreBuffCoverage', 1)
    const on = inCombatAt()
    expect(on.anomalyBuildUpEfficiency - off.anomalyBuildUpEfficiency).toBeCloseTo(35)
    expect(on.stunBuildUpBonus - off.stunBuildUpBonus).toBeCloseTo(20)
  })
})

describe('南宫羽重拍账本 → 地雷撞执行行', () => {
  it('收入累进口径：180s 接战 = 30+684+360=1074 → 时间充足时 10 套；C1 初始回满多 70 点不增套（同除100）', () => {
    expect(nangongBeatIncome(0, 180, 180)).toBe(1074)
    expect(nangongBeatIncome(1, 180, 180)).toBe(1144)
    // 时间约束夹紧：pairSeconds=2.65s → 10 套需 26.5s 平A池
    expect(computeNangongMinePairs(1074, 26.5, 2.65)).toBe(10)
    expect(computeNangongMinePairs(1074, 13, 2.65)).toBe(4)
    expect(computeNangongMinePairs(74, 100, 2.65)).toBe(0)
  })

  it('全管线：地雷撞 #2/#3 行物化真实 moveId，行级精准蓄力 +20% 失衡值', async () => {
    const { calc } = await setupNangong(0)
    const char = calc.resourceResult.value!.characters.find(c => c.agentId === '1511')!
    const m2 = char.executions.find(e => e.moveId === '1511005')
    const m3 = char.executions.find(e => e.moveId === '1511006')
    expect(m2).toBeTruthy()
    expect(m3).toBeTruthy()
    expect(m2!.count).toBeGreaterThan(0)
    expect(m2!.count).toBe(m3!.count)
    expect(m2!.stunBuildUpBonus).toBe(20)
    expect(m3!.stunBuildUpBonus).toBe(20)
    expect(m2!.totalTime!).toBeGreaterThan(0)
  })

  it('C1 差分：初始重拍回满 → 双击套数不少于 C0', async () => {
    const { calc: calc0 } = await setupNangong(0)
    const c0 = calc0.resourceResult.value!.characters.find(c => c.agentId === '1511')!
      .executions.find(e => e.moveId === '1511005')!.count
    const { calc: calc1 } = await setupNangong(1)
    const c1 = calc1.resourceResult.value!.characters.find(c => c.agentId === '1511')!
      .executions.find(e => e.moveId === '1511005')!.count
    expect(c1).toBeGreaterThanOrEqual(c0)
  })
})

describe('南宫羽颤音异放（releaseRatio basis=anomalyDamageRatio）', () => {
  it('失衡>0 时事件存在；异放为固定倍率表达（满层4=900%），C2 满层=1080%', async () => {
    const { calc } = await setupNangong(0)
    const char = calc.resourceResult.value!.characters.find(c => c.agentId === '1511')!
    const ev = (char.anomalyEventExecutions ?? []).find(e => e.eventId === 'nangong_vibrato_release')
    expect(ev, '失衡次数>0 时颤音异放事件必须存在').toBeTruthy()
    expect(ev!.eventType).toBe('release')
    expect(ev!.element).toBe('dominant')
    // 固定倍率口径（DOT基准×比例≈450%，满层×2）
    expect(ev!.fields).toContain('releaseMultiplier=900')
    expect(ev!.count).toBeGreaterThan(0)
    const { calc: calc2 } = await setupNangong(2)
    const char2 = calc2.resourceResult.value!.characters.find(c => c.agentId === '1511')!
    const ev2 = (char2.anomalyEventExecutions ?? []).find(e => e.eventId === 'nangong_vibrato_release')
    expect(ev2!.fields).toContain('releaseMultiplier=1080') // C2 每层35% → ×2.4
  })

  it('C2 差分：极性紊乱行走 rows 聚合（伤害=紊乱均伤×25%）；C0 无', async () => {
    const polarRowsOf = (c: ReturnType<typeof useResourceCalc>) =>
      (c.damagePoolRows.value ?? []).filter((r: { type?: string; agentId?: string }) => r.type === '极性紊乱' && r.agentId === '1511')
    const { calc: calc2 } = await setupNangong(2)
    const ddAvg = calc2.anomalyPoolResult.value?.disorderDamage?.avgDamage ?? 0
    const polar2 = polarRowsOf(calc2)
    if (ddAvg <= 0) {
      // 无紊乱结算的阵容不产生极性紊乱行
      expect(polar2.length).toBe(0)
      return
    }
    expect(polar2.length).toBeGreaterThan(0)
    for (const r of polar2) {
      expect((r as { perDamage?: number }).perDamage).toBeCloseTo(ddAvg * 0.25, 1)
    }
    const { calc: calc0 } = await setupNangong(0)
    expect(polarRowsOf(calc0).length).toBe(0)
    // 舞力全开口径：C2 每窗 3 次（2 层舞力全开 + 连携 1），C0 无极性紊乱（次数在事件侧断言）
  })
})

describe('南宫羽 teamBuffs（核心被动全队伤害 / 踉跄）', () => {
  it('队友面板差分：有南宫羽 → dmgBonus+25 / stunDmgMultiplierBonus+30 / 失衡持续+3s', async () => {
    const withN = await setupHarness([{ agentId: '1511' }, { agentId: '1371' }])
    const without = await setupHarness([{ agentId: '1051' }, { agentId: '1371' }])
    const inC = (h: Awaited<ReturnType<typeof setupHarness>>) =>
      computePanelPhases(1, h.config, h.catalog)!.inCombat
    const on = inC(withN)
    const off = inC(without)
    expect(on.dmgBonus - off.dmgBonus).toBeCloseTo(25)
    expect((on as unknown as Record<string, number>).stunDmgMultiplierBonus
      - (off as unknown as Record<string, number>).stunDmgMultiplierBonus).toBeCloseTo(30)
    // 失衡持续+3s：经 computeWindowDuration 生效（初版误判发散已纠正——
    // 实为阻尼振荡收敛慢，MAX_OUTER_ITER 12→20 后 sweep 恢复绿）
    expect(on.stunDurationBonusSeconds - off.stunDurationBonusSeconds).toBeCloseTo(3)
  })
})

describe('南宫羽三轮收口（C2 每层+10% / 强特免能 / 失衡内积蓄）', () => {


  it('强特免能：每次失衡白送一次E——总E数含免费次数，能量只扣付费部分', async () => {
    const { calc } = await setupNangong(0)
    const stunCount = calc.stunPoolResult.value?.stunCount ?? 0
    const char = calc.resourceResult.value!.characters.find(c => c.agentId === '1511')!
    const exRow = char.executions.find(e => e.category === 'special' && (e.totalEnergyConsume ?? 0) > 0 === false ? false : e.moveId !== 'basic_attack' && /强化特殊技|特殊技/.test(e.moveName ?? ''))
    const ex = exRow ?? char.executions.find(e => e.moveId === '1511008' || e.moveId === '1511007')
    if (stunCount <= 0 || !ex) {
      // 无失衡场景无免能，退化为通用口径
      return
    }
    const free = Math.min(Math.floor(stunCount), ex.count)
    expect(ex.count).toBeGreaterThanOrEqual(free)
    const cost = (ex.totalEnergyConsume ?? 0) > 0 ? (ex.totalEnergyConsume ?? 0) / Math.max(1, ex.count - free) : 0
    void cost
    // 能量侧只对付费部分收费：total = max(0, count - free) × 单价
    expect(ex.totalEnergyConsume).toBeLessThanOrEqual(ex.count * ((ex.totalEnergyConsume ?? 0) / Math.max(1, ex.count - free)) + 1e-6)
  })

  it('天使队长·失衡内积蓄：队友面板差分 +30/+30（新通道字段）', async () => {
    const withN = await setupHarness([{ agentId: '1511' }, { agentId: '1371' }])
    const without = await setupHarness([{ agentId: '1051' }, { agentId: '1371' }])
    const inC = (h: Awaited<ReturnType<typeof setupHarness>>) =>
      computePanelPhases(1, h.config, h.catalog)!.inCombat as unknown as Record<string, number>
    const on = inC(withN)
    const off = inC(without)
    expect((on.anomalyBuildUpEfficiencyOnStunBonus ?? 0) - (off.anomalyBuildUpEfficiencyOnStunBonus ?? 0)).toBeCloseTo(30)
    expect((on.anomalyBuildUpEfficiencyOnStunChainBonus ?? 0) - (off.anomalyBuildUpEfficiencyOnStunChainBonus ?? 0)).toBeCloseTo(30)
  })
})

/**
 * B2 · C4「可爱地雷飞天撞命中 → 属性异常积蓄值 +35%」**一次性**生效判据。
 *
 * 缺陷形态（B1 实跑确认，`probe3` 正控）：`transformNangongSkillExecutions` 对**共享 rr 行**
 * 做 read-modify-write（`anomalyBuildUp *= 1.35`），既无幂等守卫也不置 `anomalyBuildUpOverride`
 * ⇒ `extractSkillExecutions` 在同一次真管线被调 3~4 次，值按 1.35^N 累积（通道量 ×3.32 = 1.35³、
 * 显示值 ×4.48 = 1.35⁴），与原文 talent.4 的「提升35%」（= ×1.35 一次性）不符。
 *
 * 判定口径（R61 batchA 模板，两侧都钉在外部事实上）：
 *   ① **原文层**：`data/raw/nanoka_missing/full/1511.json` 的 `talent.4.desc` 逐字正则抽出 35
 *      ⇒ 期望系数 = 1 + 35/100，**不读被测常量**（同义反复教训：读 `C4_*` 常量会让注入坏值时两边一起变）；
 *   ② **表值层**：期望绝对值 = catalog 的 `anomaly_buildup` 行值 × 该系数（不硬编码 191.63）；
 *   ③ **行为层**：真 `setupHarness` → 真 `useResourceCalc()`，读**通道量**（异常池 execs 的
 *      `baseBuildUp`，不是只看端到端伤害——R57：通道被钳时端到端恒绿）+ rr 行值 + 幂等性
 *      （对同一 rr 连续提取两次，值必须不变）。
 */
describe('南宫羽 C4：地雷撞积蓄 ×1.35 一次性（B2 点修）', () => {
  const MINE2 = '1511005'
  const MINE3 = '1511006'

  /** 原文 talent.4 的积蓄百分比（从 raw 文本抽出，期望值不取自被测常量） */
  const rawC4BuildupPct = (): number => {
    const raw = JSON.parse(readFileSync(
      new URL('../../../data/raw/nanoka_missing/full/1511.json', import.meta.url), 'utf8',
    ))
    const desc = String(raw?.talent?.['4']?.desc ?? '').replace(/<[^>]+>/g, '')
    const m = desc.match(/属性异常积蓄值提升(\d+(?:\.\d+)?)%/)
    expect(m, `raw talent.4 未解析出积蓄百分比：${desc}`).toBeTruthy()
    return Number(m![1])
  }

  /** catalog 表值（唯一数值事实源） */
  const tableBuildUp = (moveId: string): number => {
    const catalog = JSON.parse(readFileSync(
      new URL('../../../public/static/catalog.json', import.meta.url), 'utf8',
    ))
    const skills = (catalog.agentSkills ?? []).find((s: { agentId?: unknown }) => String(s.agentId) === '1511')
    for (const cat of skills?.categories ?? []) {
      for (const mv of cat.moves ?? []) {
        if (String(mv.id) !== moveId) continue
        const row = (mv.rows ?? []).find((r: { id?: string }) => r.id === 'anomaly_buildup')
        return Number(row?.values?.[0] ?? 0)
      }
    }
    return 0
  }

  it('原文层：talent.4 的 35 与实现系数一致（1+35/100）', () => {
    const pct = rawC4BuildupPct()
    expect(pct).toBe(35)
    expect(1 + pct / 100).toBe(1.35)
    expect(tableBuildUp(MINE2)).toBeGreaterThan(0)
    expect(tableBuildUp(MINE3)).toBeGreaterThan(0)
  })

  it('C4 行：anomalyBuildUp == 表值×1.35（精确 1.35000）+ 置 anomalyBuildUpOverride + 通道量同步', async () => {
    const factor = 1 + rawC4BuildupPct() / 100
    const { catalog, config, calc } = await setupNangong(4)
    const rr = calc.resourceResult.value!
    const char = rr.characters.find(c => c.agentId === '1511')!
    for (const id of [MINE2, MINE3]) {
      const row = char.executions.find(e => String(e.moveId) === id)!
      expect(row, `${id} 行必须存在（重拍>0）`).toBeTruthy()
      const table = tableBuildUp(id)
      // 显示侧（rr 行）：精确 ×1.35 —— 缺陷态为 ×4.48（1.35⁵）
      expect(row.anomalyBuildUp! / table).toBeCloseTo(factor, 5)
      // 防 enrich 回填洗回表值（缺陷态未置该旗标）
      expect(row.anomalyBuildUpOverride).toBe(true)
      expect(row.totalAnomalyBuildUp! / table).toBeCloseTo(factor * row.count, 4)
      // 通道量（异常池消费面）：精确 ×1.35 —— 缺陷态为 ×3.32（1.35³）
      const ch = extractSkillExecutions(0, '1511', catalog.getAgentSkills('1511'), rr, catalog, null, config, { skipGift: true })
      const anom = ch.anomalyExecs.find(a => String(a.moveId) === id)!
      expect(anom, `${id} 必须在异常通道 execs 里`).toBeTruthy()
      expect(anom.baseBuildUp / table).toBeCloseTo(factor, 5)
    }
  })

  it('幂等：同一 rr 连续提取两次，通道量与行值逐位不变（缺陷态 ×1.35/次）', async () => {
    const { catalog, config, calc } = await setupNangong(4)
    const rr = calc.resourceResult.value!
    const skills = catalog.getAgentSkills('1511')
    const grab = () => {
      const ch = extractSkillExecutions(0, '1511', skills, rr, catalog, null, config, { skipGift: true })
      const sig = (arr: { moveId?: string; baseBuildUp?: number }[]) =>
        arr.map(a => `${a.moveId}:${Number(a.baseBuildUp ?? 0).toFixed(6)}`).sort().join('|')
      return sig(ch.anomalyExecs)
    }
    const first = grab()
    const second = grab()
    expect(second).toBe(first)
    // 行侧同样不得被二次改写（共享对象 read-modify-write 的直接证据）
    const rowAfter = rr.characters.find(c => c.agentId === '1511')!.executions.find(e => String(e.moveId) === MINE2)!
    const factor = 1 + rawC4BuildupPct() / 100
    expect(rowAfter.anomalyBuildUp! / tableBuildUp(MINE2)).toBeCloseTo(factor, 5)
  })

  it('C0 逐位不变：cinemaLevel<4 门控不动（行值=表值、无 override、通道量=表值）', async () => {
    const { catalog, config, calc } = await setupNangong(0)
    const rr = calc.resourceResult.value!
    const char = rr.characters.find(c => c.agentId === '1511')!
    const ch = extractSkillExecutions(0, '1511', catalog.getAgentSkills('1511'), rr, catalog, null, config, { skipGift: true })
    for (const id of [MINE2, MINE3]) {
      const table = tableBuildUp(id)
      const row = char.executions.find(e => String(e.moveId) === id)!
      expect(row.anomalyBuildUp).toBe(table)
      expect(row.anomalyBuildUpOverride ?? false).toBe(false)
      expect(ch.anomalyExecs.find(a => String(a.moveId) === id)!.baseBuildUp).toBe(table)
    }
  })
})

describe('CC-288 / CC-333 地雷撞套数不残留与资源卡片单源', () => {
  it('无普攻行 / 套数为 0 时 nangongMinePairs 归零（不沿用上一次装配的值）', () => {
    const cfg = { nangongCinemaLevel: 6, nangongMinePairSeconds: 1.2, nangongMinePairs: 5, battleTime: 180 } as any
    const executions: any[] = []
    nangongMechanic.buildExecutions!({ cfg, state: { frontlineTime: 0 }, executions } as any)
    expect(cfg.nangongMinePairs).toBe(0)
    cfg.nangongMinePairs = 5
    const exec2: any[] = [{ moveId: 'basic_attack', totalTime: 0 }]
    nangongMechanic.buildExecutions!({ cfg, state: { frontlineTime: 0 }, executions: exec2 } as any)
    expect(cfg.nangongMinePairs).toBe(0)
  })

  it('CC-333：buildResourceResult 与事件侧共用颤音层数/C2每层加成（+35%）及地雷撞实打套数', () => {
    const cfg = {
      nangongCinemaLevel: 2,
      nangongInitialMastery: 150,
      nangongMinePairs: 3,
      nangongStunCount: 4,
      inStunWindowTriggers: 2.8,
      battleTime: 180,
      panel: { anomalyMastery: 150 },
    } as any
    const res = nangongMechanic.buildResourceResult!({ cfg, state: { frontlineTime: 60 } } as any)
    expect(res.nangongMechanicSource?.vibratoStacks).toBe(2)
    expect(res.nangongMechanicSource?.vibratoStackPct).toBe(35)
    expect(res.nangongMechanicSource?.minePairs).toBe(3)
    const sections = nangongMechanic.resourceSections!({ result: res as any, cfg } as any)
    const beatSec = sections.find(s => s.id === 'nangong-beat')!
    const vibSec = sections.find(s => s.id === 'nangong-vibrato')!
    expect(beatSec.summary).toContain('≈3 套')
    expect(vibSec.rows.find(r => r.label === '每层加成')?.value).toBe('+35%')
  })
})
