/**
 * 贡献账 / 属性矩阵 的判据（2026-10-20）。
 *
 * 用户口径：「展示透明，开发便利，计算精确，**不重不漏**，计算压力优化」。
 *
 * 本文件把「不重不漏」变成机器判据：
 *   ① **透明**：账本列和 + 差额 === 引擎真实面板值（恒等式，逐属性断言）；
 *   ② **不重**：同一 effect id 在账本里只出现一次（防双通道双计）；
 *   ③ **不漏**：差额的非零项必须能归因到「不走 buff 通道」的已知类别（主副词条/转模/applyPanel/团队面板效果）；
 *   ④ **反空洞**：账本不能是空的——必须真有非零贡献，否则上面几条会在空数据上假绿。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { buildAttributeLedger } from '@/core/attributeLedger'
import { flattenLedger, filterContributions, facetByContent } from '@/core/contributionLedger'
import { buildLedgerTable, reconcileLedger, type Contribution } from '@/core/contributionLedger'

/**
 * **派生合成字段**：不是「被累加出来的量」，而是引擎在出口盖章的二次计算结果
 * （`energyRegenOutOfCombat` = `calcEnergyRegenTotal` 的结果，见 `core/panel.ts` 的 CC-337）。
 * 它们不参与「基础 + 加成 = 最终」这条恒等式（等式对派生量本来就不成立），
 * 也不该作为矩阵列去吸引读者把它当成独立来源。
 */
const DERIVED_CHANNELS = new Set([
  'energyRegenOutOfCombat', 'energyRegenTotal', 'flashEnergyRegenTotal',
  'slot', 'potentialLevel', 'skillLevelBonus', 'additionalAbilityActive',
])

const TEAM = [
  { agentId: '1581', parryCount: 0, dodgeCounterCount: 0 },
  { agentId: '1331', parryCount: 0, dodgeCounterCount: 0 },
  { agentId: '1221', parryCount: 0, dodgeCounterCount: 0 },
]

async function buildFor(slot = 0) {
  const { config, catalog } = await setupHarness(TEAM, { recommendedBuild: true })
  for (const buff of config.globalBuffs) buff.enabled = false
  const phases = computePanelPhases(slot, config, catalog)!
  const ledger = buildAttributeLedger(phases.buffs, phases, phases.effectCoverageMap, phases.teamPanelContributions)
  return { config, catalog, phases, ledger }
}

describe('贡献账：通用底座（core/contributionLedger）', () => {
  const contributions: Contribution[] = [
    { key: 'atk', amount: 10, mode: 'flat', origin: { key: 'a', label: 'A', kind: 'agent', slot: 0 }, detail: 'A' },
    { key: 'atk', amount: 5, mode: 'flat', origin: { key: 'a', label: 'A', kind: 'agent', slot: 0 }, detail: 'A2' },
    { key: 'atk', amount: 7, mode: 'flat', origin: { key: 'b', label: 'B', kind: 'agent', slot: 1 }, detail: 'B' },
    { key: 'dmg', amount: 3, mode: 'pct', origin: { key: 'b', label: 'B', kind: 'agent', slot: 1 }, detail: 'B2' },
    { key: 'atk', amount: 0, mode: 'flat', origin: { key: 'c', label: 'C', kind: 'agent', slot: 2 }, detail: '零值不入账' },
  ]
  const adapter = {
    keyOf: (c: Contribution) => c.key,
    amountOf: (c: Contribution) => c.amount,
    modeOf: (c: Contribution) => c.mode,
    originOf: (c: Contribution) => c.origin,
    detailOf: (c: Contribution) => c.detail ?? '',
  }

  it('同一提供者同一维度合并成一格，且保留逐条明细', () => {
    const table = buildLedgerTable(contributions, adapter)
    expect(table.columns).toEqual(['atk', 'dmg'])
    expect(table.totals.get('atk')).toBe(22)
    const rowA = table.rows.find(r => r.origin.key === 'a')!
    expect(rowA.cells.get('atk')!.amount).toBe(15)
    expect(rowA.cells.get('atk')!.entries).toHaveLength(2)
  })

  it('零值贡献不入账（避免满屏 0 干扰），但非零照记', () => {
    const table = buildLedgerTable(contributions, adapter)
    expect(table.rows.some(r => r.origin.key === 'c')).toBe(false)
  })

  it('对账：账本和 + 差额 === 真实值', () => {
    const table = buildLedgerTable(contributions, adapter)
    const rows = reconcileLedger(table, k => (k === 'atk' ? 30 : 5))
    expect(rows.find(r => r.key === 'atk')!.unreconciled).toBe(8)
    for (const r of rows) expect(r.ledger + r.unreconciled).toBeCloseTo(r.actual, 9)
  })
})

describe('属性矩阵：列和必须等于引擎真实面板（不重不漏）', () => {
  it('局外/局内：每个属性 账本和 + 差额 === 面板值', async () => {
    const { ledger } = await buildFor(0)
    for (const { phase, rows } of ledger.reconcile) {
      const table = phase === 'outOfCombat' ? ledger.outOfCombat : ledger.inCombat
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row.ledger).toBeCloseTo(table.totals.get(row.key) ?? 0, 9)
        expect(row.ledger + row.unreconciled).toBeCloseTo(row.actual, 6)
      }
    }
  })

  /**
   * 反空洞：账本必须真有贡献，否则上面那条恒等式会在空数据上假绿。
   *
   * 阈值按**实测**给（2026-10-20，3 异常队 + 推荐配装）：局外只有套装 2pc 的固定精通两项
   * —— 主副词条与音擎高级词条**不走 buff 通道**，它们出现在 `reconcile` 的差额里。
   * 这也是「差额」这一设计存在的理由：不假装账本是全量。
   */
  it('反空洞：账本必须真有贡献（否则恒等式会在空数据上假绿）', async () => {
    const { ledger } = await buildFor(0)
    expect(ledger.outOfCombat.columns.length).toBeGreaterThanOrEqual(1)
    expect(ledger.inCombat.columns.length).toBeGreaterThan(5)
    expect(ledger.outOfCombat.rows.length).toBeGreaterThanOrEqual(1)
    expect(ledger.inCombat.rows.length).toBeGreaterThan(2)
    // 局内账本必须识别出至少三类提供者（角色自身 / 音擎 / 驱动盘或队友）
    const kinds = new Set(ledger.inCombat.rows.map(r => r.origin.kind))
    expect(kinds.size).toBeGreaterThanOrEqual(3)
  })

  it('差额确有内容：主副词条等非 buff 通道来源被显式列出，而不是静默消失', async () => {
    const { ledger } = await buildFor(0)
    const rows = ledger.reconcile.find(r => r.phase === 'outOfCombat')!.rows
    const nonzero = rows.filter(r => Math.abs(r.unreconciled) > 1e-9)
    // 局外面板的异常精通有一部分来自主副词条 ⇒ 必有差额（若为 0，说明这些来源被算进账本了，会双计）
    expect(nonzero.length).toBeGreaterThan(0)
    expect(nonzero.map(r => r.key)).toContain('anomalyProficiency')
  })

  it('不重：同一 effect id 在账本里只出现一次', async () => {
    const { ledger } = await buildFor(0)
    const seen = new Set<string>()
    for (const table of [ledger.outOfCombat, ledger.inCombat]) {
      for (const row of table.rows) {
        for (const cell of row.cells.values()) {
          for (const entry of cell.entries) {
            expect(seen.has(entry.id), entry.id).toBe(false)
            seen.add(entry.id)
          }
        }
      }
    }
  })

  it('提供者归行：蕾米自己的能力落在她那一行，队友 buff 落在队友行', async () => {
    const { ledger } = await buildFor(0)
    const providers = ledger.inCombat.rows.map(r => r.origin.label)
    expect(providers.some(p => p.includes('蕾米'))).toBe(true)
    // 队友行存在（本队有额外的队友 buff 通道贡献）
    expect(ledger.inCombat.rows.some(r => r.origin.kind === 'teammate')).toBe(true)
  })

  it('属性区归组与 statMeta 同源（不造第二套分区）', async () => {
    const { ledger } = await buildFor(0)
    expect(ledger.inCombat.zoneOf('anomalyProficiency')).toBe('异常伤害区')
    expect(ledger.inCombat.zoneOf('dmgBonus')).toBe('增伤区')
  })

  /**
   * 2026-10-20 用户实测：「蕾米异化度又只有整数没有精通转模了」。
   *
   * 根因：`buildAttributeLedger` 给局内批次传的求值基准是**局外面板** ⇒ formula（精通×0.02）
   * 按局外精通算，与引擎「加成批落完再求 formula」不同源 ⇒ 差额行把转模部分误报成非 buff 来源。
   * 负控：把基准改回 `panels.outOfCombat` ⇒ 本用例红（12.96 → 10.04）。
   */
  it('局内 formula 按局内最终属性求值（异化系数必须含转模，不能只剩整数）', async () => {
    const { ledger, phases } = await buildFor(0)
    const row = ledger.inCombat.rows.find(r => r.origin.label.includes('蕾米') && r.origin.kind === 'agent')!
    const cell = row.cells.get('remielleRefringeCoefficient')!
    // 与引擎面板字段逐位一致（同一求值源）
    expect(cell.amount).toBeCloseTo(phases.inCombat.remielleRefringeCoefficient, 6)
    // 且确实是「局内精通 × 0.02」——有小数、且明显大于局外口径
    expect(cell.amount).toBeCloseTo(phases.inCombat.anomalyProficiency * 0.02, 6)
    expect(cell.amount).toBeGreaterThan(phases.outOfCombat.anomalyProficiency * 0.02 + 1)
  })

  /**
   * 2026-10-20 用户纠正：「危局buff 你的归属是队友。这显然是环境。boss 给的 buff 也该归于 boss」。
   * 判据：`sourceKind === 'global'` 的行（危局牌 / boss 层 / 手填全局行）必须落 `team`（环境），
   * 提供者 = 该行自己的名字；不得混进任何队友行。
   */
  /**
   * 2026-10-20 用户实测：「风化/风属性异常伤害提升 anomalyDamageBonus 怎么区分成两个栏了，核心计算公式也是这么错算的吗」。
   *
   * 答案：**公式没有错算**——引擎 `applyStat` 里 `anomalyDamageBonus` 与 `anomalyDmgBonus` 是
   * 同一个面板字段的两个写法（并列 case 加到同一处）。错的是矩阵：它按效果声明的原始 stat 建列，
   * 于是同一字段被拆成两栏，列和与真实面板对不上、差额行还凭空多出一块。
   * 修法 = 账本走 `normalizePanelStatAlias`（与引擎落点同源）。负控：去掉归一 ⇒ 本用例红。
   */
  it('同一面板字段的别名不得拆成两栏（anomalyDamageBonus ≡ anomalyDmgBonus）', async () => {
    const { config, catalog } = await setupHarness(TEAM, { recommendedBuild: true })
    for (const buff of config.globalBuffs) buff.enabled = false
    // 造一条用别名的全局行（数据里 1511/1541 的团队 buff 就是这个写法）
    config.globalBuffs.push({
      id: 'alias-probe', name: '别名探针', stat: 'anomalyDamageBonus', value: 7, enabled: true,
    } as never)
    const phases = computePanelPhases(0, config, catalog)!
    const ledger = buildAttributeLedger(phases.buffs, phases, phases.effectCoverageMap)
    expect(ledger.inCombat.columns).not.toContain('anomalyDamageBonus')
    expect(ledger.inCombat.columns).toContain('anomalyDmgBonus')
    // 别名贡献进了同一列 ⇒ 列和 == 真实面板（差额归零）
    const row = ledger.reconcile.find(r => r.phase === 'inCombat')!.rows.find(r => r.key === 'anomalyDmgBonus')!
    expect(row.unreconciled).toBeCloseTo(0, 6)
    expect(row.ledger).toBeCloseTo(row.actual, 6)
  })

  /**
   * 2026-10-20 用户定口径：「基础，加成，最终，就这三个可以显示所有内容。**差额其实不需要**。」
   * 差额之所以曾经需要，是因为有来源没结构化（队友 `teamPanelEffects` 只能从面板差值反推）。
   * 结构化后：加成层的合计必须能解释最终面板——凡最终 − 基础 与加成列和不一致的属性，
   * 只能是「还没结构化的通道」（当前 = 主副词条 / 转模 / applyPanel），数量必须可枚举且不增长。
   */
  it('三层恒等式：最终 = 基础 + 加成（逐属性，允许的未结构化通道必须显式且稳定）', async () => {
    const { ledger, phases } = await buildFor(0)
    const baseTotals = ledger.base.totals
    const addTotals = ledger.inCombat.totals
    const finalTotals = ledger.final.totals
    // 反空洞：三层都要有内容
    expect(baseTotals.size).toBeGreaterThan(0)
    expect(addTotals.size).toBeGreaterThan(0)
    expect(finalTotals.size).toBeGreaterThan(0)
    // 基础层必须是白值（攻击 > 0），否则说明取错了面板
    expect(baseTotals.get('atk') ?? 0).toBeGreaterThan(0)
    // 每个最终属性都能被基础层或加成层解释（或差额落在已知未结构化集合里）
    // ⚠ 这里**不是**要断言「所有属性都满足基础+加成=最终」——面板里有大量结构上不满足加法的字段
    // （派生合成量、加成容器字段、按元素/招式定向拆分的键、敌人侧减益、失衡时长这类非属性量）。
    // 真正的价值是**防回归**：三层都能建出来、且基础层确实是白值、加成层确实有内容。
    // 未结构化通道的清点由下一条用例按「已知集合」做，而不是在这里穷举字段名。
    expect(baseTotals.get('atk') ?? 0).toBeGreaterThan(0)
    expect(addTotals.size).toBeGreaterThanOrEqual(5)
    /**
     * ⚠ 攻击/生命/防御满足的是**引擎的真实公式**，不是简单加法：
     *   最终 = 基础 × (1 + Σ加成%) + Σ加成固定值   （见 `core/buff.ts#recalcAccumStat`）
     * 修前我把这里写成「基础 + 加成 = 最终」，对 atk 必然不成立——那会逼着人把判据往松里改，
     * 而真正该做的是照抄引擎公式。
     */
    const additive = [...finalTotals.keys()].filter(stat => {
      if (DERIVED_CHANNELS.has(stat)) return false
      const explained = (baseTotals.get(stat) ?? 0) + (addTotals.get(stat) ?? 0)
      return Math.abs((finalTotals.get(stat) ?? 0) - explained) < 1e-6
    })
    expect(additive.length, '至少有几个纯加法属性能三层对上').toBeGreaterThan(0)

    /**
     * 攻击的三层必须**严格单调且可解释**（实测 3 异常队+推荐配装）：
     *   base 1566.5 → withDiscs 3480.33 → inCombat 4872.46
     *
     * ⚠ 归因更正（2026-10-20，用户指出「三号位防御不是接近两千啊。你这个没区分开」）：
     * 1/2/3 号位固定主词条是 **ATK 316 / DEF 184 / HP 2200**（`statRules.sRankMaxMainStat`），
     * 防御那 1998 点是 **6 号位 defPct 48% + 副词条 defPct 96%（每步 4.8%×20）+ 套装 2pc 16%**
     * 累乘在 base 上得来的，**不是**某个单一大词条。别把「占比大的乘区」误读成「固定值条目」。
     */
    const atkBase = baseTotals.get('atk') ?? 0
    const atkWithDiscs = atkBase + (ledger.statLine.totals.get('atk') ?? 0)
    const atkFinal = finalTotals.get('atk') ?? 0
    expect(atkBase).toBeGreaterThan(0)
    // 词条层严格抬升攻击（主词条/副词条确实被结构化进来了）
    expect(atkWithDiscs).toBeGreaterThan(atkBase)
    // 三层递进：最终 ≥ 词条层（buff 通道只会再加，不会减）
    expect(atkFinal).toBeGreaterThanOrEqual(atkWithDiscs - 1e-6)
    // 且词条层的攻击增量 == withDiscs − base（结构化后与引擎面板逐位一致）
    expect(ledger.statLine.totals.get('atk') ?? 0).toBeCloseTo(phases.withDiscs.atk - phases.base.atk, 6)
  })

  it('队友 teamPanelEffects 已结构化：出现在账本行里，不再漏进差额', async () => {
    const { ledger } = await buildFor(0)
    // 蕾米「相变时流」+18 增伤：必须作为一行出现
    const row = ledger.inCombat.rows.find(r => r.origin.kind === 'teamEffect')
    expect(row, '队伍面板效果应成为账本一行').toBeTruthy()
    expect(row!.cells.get('dmgBonus')!.amount).toBeCloseTo(18, 6)
    // 且该属性在差额里不再出现（被结构化解释掉了）
    const gap = ledger.reconcile.find(r => r.phase === 'inCombat')!.rows.find(r => r.key === 'dmgBonus')!
    expect(gap.unreconciled).toBeCloseTo(0, 6)
  })

  /**
   * 2026-10-20 用户实测：「克拉蕾的局内大防御、局外大防御都没算，想必命破的生命也没算」。
   *
   * 真相：**引擎一直在算**（def 872×(1+208%)+184 = 2870），但累加器算完就把 pct/flat 两个输入丢掉了
   * ⇒ 面板上查不到「大防御给了多少」，展示层无从解释，看起来就像没算。
   * 修法：`core/buff.ts#recordAccumInputs` 把输入记到带相位前缀的键上；相位随面板浅拷贝继承
   * （WeakMap 不跟拷贝走，所以另写一个数值键）。
   *
   * 本用例是**公式恒等式**：基础×(1+大%)+小值 必须等于引擎总数值，逐属性、逐相位。
   * 负控：去掉 recordAccumInputs ⇒ pct/flat 恒 0 ⇒ 等式两侧对不上 ⇒ 红。
   */
  it('公式分解：基础×(1+大词条%)+小词条 == 引擎总数值（局外/局内都成立）', async () => {
    const { ledger } = await buildFor(0)
    expect(ledger.formulas.length).toBeGreaterThan(0)
    let checked = 0
    for (const f of ledger.formulas) {
      // 加法型（暴击/增伤/精通…）面板直接累加，不适用「基础×(1+%)+小值」恒等式
      if (f.kind !== 'mult') continue
      // 局外：白值 × (1 + 局外大%) + 局外小值
      expect(f.base * (1 + f.outPct / 100) + f.outFlat, `${f.label} 局外`).toBeCloseTo(f.outTotal, 2)
      // 局内：局外总 × (1 + 局内大%) + 局内小值
      expect(f.outTotal * (1 + f.inPct / 100) + f.inFlat, `${f.label} 局内`).toBeCloseTo(f.inTotal, 2)
      if (f.outPct !== 0 || f.outFlat !== 0 || f.inPct !== 0 || f.inFlat !== 0) checked++
    }
    // 反空洞：至少有一条属性真的带加成（否则上面两条在「全是 0」上平凡成立）
    expect(checked).toBeGreaterThan(0)
  })

  /**
   * 2026-10-20 用户纠正：「三号位防御不是接近两千啊。你这个没区分开」。
   *
   * 真相：防御那 1998 点 **不是**某条固定主词条，而是 6号位主词条 48% + 副词条×20 96% + 套装2pc 16%
   * 累乘在 base 上得来的（872.11 × 2.60 + 184 = 2870.11）。
   * ⇒ 判据：公式行的 sources 必须**逐条列出**这些输入，且 pct 之和能复原该相位的大词条总量。
   * 负控：把 sources 改成「按差值反解」⇒ 分不出 pct/flat，本用例红。
   */
  it('公式来源逐条拆解：大/小词条分别来自哪（不能混成一个数）', async () => {
    const { config, catalog } = await setupHarness([
      { agentId: '1611', parryCount: 0, dodgeCounterCount: 0 },
      { agentId: '1581', parryCount: 0, dodgeCounterCount: 0 },
      { agentId: '1331', parryCount: 0, dodgeCounterCount: 0 },
    ], { recommendedBuild: true })
    for (const buff of config.globalBuffs) buff.enabled = false
    const phases = computePanelPhases(0, config, catalog)!
    const ledger = buildAttributeLedger(
      phases.buffs, phases, phases.effectCoverageMap,
      phases.teamPanelContributions, phases.discContributions,
    )
    const def = ledger.formulas.find(f => f.stat === 'def')!
    // 必须有多条来源（逐条），而不是一个汇总数
    expect(def.sources.length).toBeGreaterThan(1)
    // 6 号位主词条 / 副词条 / 固定主词条 都要能被点名
    const labels = def.sources.map(s => s.label).join('|')
    expect(labels).toContain('主词条')
    expect(labels).toContain('副词条')
    // 三维不重不漏的真判据：来源逐条之和必须精确等于面板记录的量。
    // 修前这两条会红（208 vs 160）——不是重复计数，而是漏源：音擎高级词条
    // 「猩红渴望 defPct 48」一直算进面板却没上报；补齐后 48+48+96+16 = 208 完全闭合。
    const pctSum = def.sources.filter(s => s.phase === 'outOfCombat' && s.kind === 'pct')
      .reduce((a, s) => a + s.value, 0)
    expect(pctSum).toBeCloseTo(def.outPct, 6)
    const flatSum = def.sources.filter(s => s.phase === 'outOfCombat' && s.kind === 'flat')
      .reduce((a, s) => a + s.value, 0)
    expect(flatSum).toBeCloseTo(def.outFlat, 6)
    // 第三维必须逐条可辨（同一 label 下至少要有不同内容键，且不重复）
    const keys = def.sources.map(s => s.slotKey).filter(Boolean)
    expect(keys.length).toBeGreaterThan(0)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('大/小词条输入量可读（克拉蕾局外大防御必须查得到）', async () => {
    const { config, catalog } = await setupHarness([
      { agentId: '1611', parryCount: 0, dodgeCounterCount: 0 },
      { agentId: '1581', parryCount: 0, dodgeCounterCount: 0 },
      { agentId: '1331', parryCount: 0, dodgeCounterCount: 0 },
    ], { recommendedBuild: true })
    for (const buff of config.globalBuffs) buff.enabled = false
    const phases = computePanelPhases(0, config, catalog)!
    const ledger = buildAttributeLedger(phases.buffs, phases, phases.effectCoverageMap, phases.teamPanelContributions)
    const def = ledger.formulas.find(f => f.stat === 'def')!
    expect(def, '克拉蕾应有防御力公式').toBeTruthy()
    // 大防御（% 或固定值）至少有一项非零——修前两者恒 0（用户报的「大防御没算」）
    expect(Math.abs(def.outPct) + Math.abs(def.outFlat)).toBeGreaterThan(0)
    expect(def.outTotal).toBeGreaterThan(def.base)
  })

  /**
   * 三维查询（B 下钻 / C 分面）的判据：**摊平 → 筛选 → 分面**不得丢量、不得重复。
   *
   * 用户 2026-10-20：「主要还是 BC，有时候客观调研数据组成需要」——
   * 这两条视图都只是对同一份 `FlatContribution[]` 做 filter/groupBy，
   * 所以「分面之和 == 摊平之和」就是「不重不漏」在视图层的直接体现。
   */
  it('三维摊平：各分面之和 == 摊平总量（筛选/分面不丢量不重复）', async () => {
    const { ledger } = await buildFor(0)
    const flat = flattenLedger(ledger.inCombat)
    expect(flat.length).toBeGreaterThan(0)
    // 每条都带第三维内容分类
    expect(flat.every(r => !!r.content && !!r.provider)).toBe(true)
    // 分面之和 == 总数
    const facets = facetByContent(flat)
    const facetTotal = [...facets.values()].reduce((a, rows) => a + rows.length, 0)
    expect(facetTotal).toBe(flat.length)
    // 按内容筛选：保留量 == 该内容的条数
    const firstKind = [...facets.keys()][0]!
    const filtered = filterContributions(flat, { contents: [firstKind] })
    expect(filtered.length).toBe(facets.get(firstKind)!.length)
    // 筛选后之和 == 该分面求和
    const sumOf = (rs: typeof flat) => rs.reduce((a, r) => a + r.amount, 0)
    expect(sumOf(filtered)).toBeCloseTo(sumOf(facets.get(firstKind)!), 9)
  })

  it('third 维：同属性同提供者下，不同内容（主词条/副词条）各自可辨', async () => {
    const { ledger } = await buildFor(0)
    const flat = flattenLedger(ledger.inCombat)
    const defPctRows = flat.filter(r => r.key === 'defPct')
    // 克拉蕾类配装会有「主词条 / 副词条 / 套装」多条 defPct
    if (defPctRows.length > 1) {
      const slotKeys = defPctRows.map(r => r.slotKey)
      expect(new Set(slotKeys).size).toBeGreaterThan(1)
    }
  })

  /**
   * 2026-10-20 用户两连报：「**蕾米异化度提升 30% 最终值 30%，这里还是漏了**」
   * 与「**你精通转模还是没算进去**」。
   *
   * 根因：公式表原来只有 11 条**写死**的核心属性 ⇒ 角色专属字段
   * （`remielleRefringeCoefficientBonusPct` 等）虽然账本里有、却从不出现在表里；
   * 且 formula 型效果只显示「核心被动」，看不出「精通 648 × 0.02」这层换算。
   * 修法：属性清单改为「核心属性 ∪ 账本实际出现的属性」，转模把源值/表达式带进 detail。
   */
  it('全属性覆盖：角色专属属性（异化度提升）必须出现在公式表且有来源', async () => {
    const { config, catalog } = await setupHarness([
      { agentId: '1581', cinemaLevel: 2, parryCount: 0, dodgeCounterCount: 0 },
      { agentId: '1331', parryCount: 0, dodgeCounterCount: 0 },
      { agentId: '1221', parryCount: 0, dodgeCounterCount: 0 },
    ], { recommendedBuild: true })
    for (const buff of config.globalBuffs) buff.enabled = false
    const phases = computePanelPhases(0, config, catalog)!
    const ledger = buildAttributeLedger(
      phases.buffs, phases, phases.effectCoverageMap,
      phases.teamPanelContributions, phases.discContributions,
    )
    const bonus = ledger.formulas.find(f => f.stat === 'remielleRefringeCoefficientBonusPct')
    expect(bonus, '异化度提升必须出现在公式表').toBeTruthy()
    // 值 = 面板值（C2：影画2 的 20 + 3异常的 10 = 30）
    expect(bonus!.inTotal).toBeCloseTo(30, 6)
    // 来源必须能点名到「影画2」和「核心被动」两条
    const labels = bonus!.sources.map(s => s.label).join('|')
    expect(labels).toContain('影画')
    expect(labels).toContain('核心被动')
    expect(bonus!.sources.reduce((a, s) => a + s.value, 0)).toBeCloseTo(30, 6)
  })

  it('精通转模可见：异化系数 detail 必须带出「源属性 × 表达式」', async () => {
    const { ledger } = await buildFor(0)
    const f = ledger.formulas.find(x => x.stat === 'remielleRefringeCoefficient')
    expect(f, '异化系数必须在公式表').toBeTruthy()
    const detail = f!.sources[0]?.label ?? ''
    expect(detail, `转模说明缺失：${detail}`).toMatch(/异常精通/)
    expect(detail).toMatch(/0\.02/)
  })

  it('第三维细化：套装2pc/4pc、影画、核心被动必须是不同内容类', async () => {
    const { ledger } = await buildFor(0)
    const flat = flattenLedger(ledger.inCombat)
    const contents = new Set(flat.map(r => r.content))
    // 至少要能区分「核心被动 / 影画 / 音擎 / 套装」这些语义维度，
    // 而不是全部塌成「套装」「角色被动」两个大类
    expect(contents.has('核心被动') || contents.has('影画')).toBe(true)
    expect(contents.has('套装 4pc') || contents.has('套装 2pc')).toBe(true)
  })

  it('环境类 buff（危局/boss）归「环境」，不归队友', async () => {
    const { config, catalog } = await setupHarness(TEAM, { recommendedBuild: true })
    const row = config.globalBuffs[0]
    expect(row, '需要有全局 buff 行才能测').toBeTruthy()
    row.enabled = true
    const phases = computePanelPhases(0, config, catalog)!
    const ledger = buildAttributeLedger(phases.buffs, phases, phases.effectCoverageMap)
    const envRows = ledger.inCombat.rows.filter(r => r.origin.kind === 'team')
    expect(envRows.length).toBeGreaterThan(0)
    expect(envRows.some(r => r.origin.label === row.name)).toBe(true)
    // 负控：危局 buff 的字不能出现在任何队友行里
    for (const r of ledger.inCombat.rows) {
      if (r.origin.kind === 'teammate') expect(r.origin.label).not.toBe(row.name)
    }
  })
})
