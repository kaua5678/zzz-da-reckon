/**
 * 「声明已实现、本表却 `NONE`（三通道全零）」的**逐格归因判据**（2026-11-06）。
 *
 * ## 它锁什么
 * `docs/cinema-classification.md` 的「28 格归因」一节（实际 29 格，交接文档漏了 `1141C2`）
 * 是**实测结论**，不是推断。本文件把那三组结论变成红灯：
 *
 * | 组 | 断言 | 失败意味着 |
 * |---|---|---|
 * | **A 夹具缺席** | 单人 = 0，换 1 个条件队友 > 0 | 要么机制退化，要么「夹具缺席」这个归因是错的 |
 * | **B 原文不建模** | 单人 = 0（且状态表仍声明 implemented） | 有人偷偷接了防御向通道，文档要改 |
 * | **C 夹具缺交互行** | 补上弹刀/闪反次数后 > 0 | 交互通道与命座的联动断了 |
 * | **C 资源不传导** | 伤害 = 0 **但**失衡值/能量确实动了 | 要么资源通道断了，要么归因错了 |
 * | **C 如实无增量** | 伤害 = 0 | 同上 |
 * | **★ 夹具不可换** | `1351C4` 单人 +6.98，加第 3 人 → 0.00 | 见下 |
 *
 * ## ★ 为什么必须有「夹具不可换」这条
 * 分类表要的是「只换命座等级、其他都不变」。若为了触发条件而**加第 3 个人**，
 * 平A 预算被三人分走、时间账重排 ⇒ 原本非零的格子塌成 0（2026-11-06 实测：
 * `1351C4` +6.98% → 0.00%，`1451C4` +5.23% → 0.00%）。
 * 所以本表**保持单人夹具**，条件型命座用本节「换 1 个队友（仍是 2 人队）」的读数，
 * **不写回表**。这条判据就是那个决定的证据，别删。
 *
 * ## 判定口径（沿用 R58~R63 模板）
 * 真 `setupHarness` → 真 `computeCinemaBreakdown`（**不重写任何公式**，规则：自写乘区连乘必错）。
 * 期望值来自 2026-11-06 实测读数，不是从被测模块导出常量里读的。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { collectCinemaMetrics } from '@/composables/cinemaUplift'
import { bindPoolStore, computeCinemaBreakdown } from '@/composables/cinemaUpliftBreakdown'
import { loadConstellations } from '@/test/cinemaClassify'

/** 零判定门槛（%）：与 `BREAKDOWN_EPSILON_PCT` 同口径 */
const EPS = 0.05
/** 实测读数比对容差（%）：表里的数字是 2 位小数 */
const TOL = 0.06

interface Reading {
  total: number
  resource: number
  exec: number
  attr: number
  tier: string
  /** 非伤害通道的增量（失衡值 / 能量 / 异常积蓄）——用来证明「资源动了但没传导」 */
  dStunBuildUp: number
  dEnergy: number
  dAnomBuildUp: number
}

/**
 * 只跑 C(n-1) / C(n) 两个现场（不是 0..6）——本文件要的是单格读数，跑满七级是纯浪费。
 * 夹具口径与 `cinemaClassifyRows` 逐位一致：单人 / `stunCountLock = -1` / `syncTeammateBuffsFromTeam`。
 */
async function readCell(
  agentId: string,
  cinema: number,
  opts: { mates?: string[]; slotPatch?: Record<string, unknown> } = {},
): Promise<Reading> {
  const team: Array<Record<string, unknown> | ''> = [
    { agentId, ...(opts.slotPatch ?? {}) },
    ...(opts.mates ?? []).map(id => ({ agentId: id })),
  ]
  while (team.length < 3) team.push('')
  const { config } = await setupHarness(team as never)
  config.enemy.stunCountLock = -1
  const calc = useResourceCalc()
  const shots: Array<{ ctx: never; panels: never[]; metrics: Record<string, number> }> = []
  for (const level of [cinema - 1, cinema]) {
    config.setCinemaLevel(0, level)
    config.syncTeammateBuffsFromTeam()
    const ctx = calc.damagePoolContext.value
    shots.push({
      ctx: bindPoolStore(ctx, { 0: level }) as never,
      panels: [...ctx.damagePanels] as never[],
      metrics: collectCinemaMetrics({
        characters: calc.resourceResult.value?.characters,
        stunPool: calc.stunPoolResult.value,
        anomalyPool: calc.anomalyPoolResult.value,
      }),
    })
  }
  const b = computeCinemaBreakdown({
    beforeCtx: shots[0].ctx,
    afterCtx: shots[1].ctx,
    beforePanels: shots[0].panels,
    afterPanels: shots[1].panels,
    withPanels: (ctx, next) => calc.damagePoolContextWithPanels(next, ctx),
    slots: [0],
  })
  const d = (key: string) => shots[1].metrics[key] - shots[0].metrics[key]
  return {
    total: b.totalPct,
    resource: b.resourcePct,
    exec: b.execPct,
    attr: b.attrPct,
    tier: b.tier,
    dStunBuildUp: d('stunBuildUp'),
    dEnergy: d('energyTotal'),
    dAnomBuildUp: d('anomBuildUp'),
  }
}

const isZero = (v: number) => Math.abs(v) < EPS

interface ACell {
  agentId: string
  cinema: number
  name: string
  mates: string[]
  total: number
  tier: string
  /**
   * ⚠ **入口门默认开启（`PROBE_STUN_STABLE_BAND`）后的读数**（规则 10 重钉）。
   * 稳定停点入口门把交付 K 抬 +1 ⇒ 本格的失衡**窗数**跨过阈值 ⇒ 读数与通道标签都变。
   * 只对受影响的格子给出；`=off` 时仍回到 `total` / `tier`（原口径）。
   */
  totalOn?: number
  tierOn?: string
}

/**
 * A 类：**夹具缺席**。单人必 0，换 1 个条件队友（仍是 2 人队）即 > 0。
 * 队友按该格 `spec.additionalAbility.teamConditions` 解析选取（确定性：id 升序第一个命中者）。
 */
const A_CLASS: ACell[] = [
  // 3.4.3（2026-11-07）：知更鸟基础伤害因「进战 +3000 喧响 ⇒ 多一发终结技」抬高（1661 各级 +7.2~7.3%），
  // C6 的**相对**贡献被分母摊薄 ⇒ 7.71% → 5.97%（机制没退化：影画6 仍是必定暴击 + 生命值系数 ×2）。
  { agentId: '1661', cinema: 6, name: '知更鸟', mates: ['1011'], total: 5.97, tier: 'EXEC' },
  { agentId: '1151', cinema: 6, name: '露西', mates: ['1021'], total: 5.35, tier: 'RESOURCE+EXEC' },
  { agentId: '1421', cinema: 1, name: '潘引壶', mates: ['1051'], total: 4.53, tier: 'ATTR' },
  { agentId: '1421', cinema: 6, name: '潘引壶', mates: ['1051'], total: 2.91, tier: 'ATTR' },
  { agentId: '1311', cinema: 4, name: '耀嘉音', mates: ['1021'], total: 2.88, tier: 'EXEC' },
  // ⚠ 2026-11-08 入口门默认开启：本格 C3→C4 的失衡窗数 2→3（=off 时仍 2→2）⇒ 后场电回能之外
  //    又多跨了一次失衡阈值，读数 1.49% → **9.65%**、通道标签多出 ATTR。
  //    「资源动了但没传导」的原归因在 =off 口径下仍成立（见下方 total/tier 两字段）。
  { agentId: '1011', cinema: 4, name: '安比', mates: ['1041', '1211'], total: 1.49, tier: 'RESOURCE+EXEC', totalOn: 9.65, tierOn: 'RESOURCE+EXEC+ATTR' },
  { agentId: '1211', cinema: 1, name: '丽娜', mates: ['1011'], total: 1.16, tier: 'ATTR' },
  { agentId: '1461', cinema: 4, name: '「席德」', mates: ['1021'], total: 1.07, tier: 'EXEC' },
  { agentId: '1161', cinema: 4, name: '莱特', mates: ['1021'], total: 0.92, tier: 'RESOURCE+EXEC' },
  { agentId: '1351', cinema: 1, name: '波可娜', mates: ['1021'], total: 0.77, tier: 'ATTR' },
]

/** B 类：原文逐字写「不建模」——0 是**预期**，不是缺陷 */
const B_CLASS: Array<[string, number, string]> = [
  ['1031', 4, '妮可'], ['1041', 4, '「11号」'], ['1101', 2, '珂蕾妲'], ['1111', 2, '安东'],
  ['1121', 1, '本'], ['1141', 4, '莱卡恩'], ['1271', 1, '赛斯'], ['1421', 4, '潘引壶'],
]

describe('命座零收益格：逐格归因（docs/cinema-classification.md「28 格归因」节）', () => {
  describe('A 类 · 夹具缺席：单人 0，配 1 个条件队友即测出', () => {
    for (const cell of A_CLASS) {
      const key = `${cell.agentId}C${cell.cinema}`
      it(`${key} ${cell.name}：单人 0 → 配队友 ~+${cell.total}%（${cell.tier}）`, async () => {
        const solo = await readCell(cell.agentId, cell.cinema)
        expect(
          isZero(solo.total),
          `${key} 单人夹具读出 ${solo.total.toFixed(2)}%（预期 0）——` +
          '若真变成非零，说明该命座不依赖队友，「夹具缺席」这条归因要重写',
        ).toBe(true)
        const withMate = await readCell(cell.agentId, cell.cinema, { mates: cell.mates })
        const gateOn = process.env.PROBE_STUN_STABLE_BAND !== 'off'
        const expTotal = gateOn ? (cell.totalOn ?? cell.total) : cell.total
        const expTier = gateOn ? (cell.tierOn ?? cell.tier) : cell.tier
        expect(
          withMate.total,
          `${key} 配队友 ${JSON.stringify(cell.mates)} 后读数 ${withMate.total.toFixed(2)}%` +
          `（预期 ~+${expTotal}，口径=${gateOn ? '入口门开' : '入口门=off'}）——机制退化或被另一个通道抵消（tier=${withMate.tier}）`,
        ).toBeCloseTo(expTotal, 0)
        expect(Math.abs(withMate.total - expTotal)).toBeLessThan(TOL * 10)
        expect(withMate.tier, `${key} 通道标签变了（预期 ${expTier}）`).toBe(expTier)
      })
    }
  })

  describe('B 类 · 原文声明不建模：0 是预期值，别去"修"', () => {
    for (const [agentId, cinema, name] of B_CLASS) {
      const key = `${agentId}C${cinema}`
      it(`${key} ${name}：声明 implemented_approximation 且实测 0（防御向/无乘区）`, async () => {
        const reading = await readCell(agentId, cinema)
        expect(reading.total, `${key} 实测 ${reading.total.toFixed(2)}%——防御向效果被接进伤害通道了？`).toBeLessThan(EPS)
        expect(Math.abs(reading.total), `${key} 实测 ${reading.total.toFixed(2)}%`).toBeLessThan(EPS)
      })
    }
  })

  describe('C 类 · 夹具缺交互行：补上弹刀/闪反次数后才有收益', () => {
    const cells: Array<{ agentId: string; cinema: number; name: string; patch: Record<string, unknown>; mates: string[]; total: number }> = [
      { agentId: '1081', cinema: 2, name: '比利', patch: { dodgeCounterCount: 10 }, mates: [], total: 0.96 },
      { agentId: '1441', cinema: 6, name: '真斗', patch: { parryCount: 6 }, mates: [], total: 1.4 },
      { agentId: '1411', cinema: 4, name: '柚叶', patch: { parryCount: 6 }, mates: ['1051'], total: 0.29 },
    ]
    for (const cell of cells) {
      const key = `${cell.agentId}C${cell.cinema}`
      it(`${key} ${cell.name}：夹具默认交互 0 ⇒ 0；补 ${JSON.stringify(cell.patch)} 后 ~+${cell.total}%`, async () => {
        const bare = await readCell(cell.agentId, cell.cinema, { mates: cell.mates })
        expect(isZero(bare.total), `${key} 未补交互时读出 ${bare.total.toFixed(2)}%（预期 0）`).toBe(true)
        const fed = await readCell(cell.agentId, cell.cinema, { mates: cell.mates, slotPatch: cell.patch })
        expect(Math.abs(fed.total - cell.total), `${key} 补交互后读数 ${fed.total.toFixed(2)}%（预期 ~+${cell.total}）`).toBeLessThan(TOL * 10)
      })
    }
  })

  describe('C 类 · 资源通道动了但没传导到伤害（失衡窗数没跨过阈值）', () => {
    const cells: Array<{ agentId: string; cinema: number; name: string; daze: boolean }> = [
      { agentId: '1101', cinema: 1, name: '珂蕾妲', daze: true },
      // 1141C1 已迁出本组（2026-11-08 入口门默认开启后失衡窗数 3→4 跨阈 ⇒ 资源已传导），
      // 见下方「C 类 · 1141C1」单独 describe 的双口径钉法。
      { agentId: '1131', cinema: 2, name: '苍角', daze: false },
      { agentId: '1151', cinema: 1, name: '露西', daze: false },
      { agentId: '1141', cinema: 2, name: '莱卡恩', daze: false },
    ]
    for (const cell of cells) {
      const key = `${cell.agentId}C${cell.cinema}`
      it(`${key} ${cell.name}：伤害 0，但${cell.daze ? '失衡值' : '能量'}确实涨了（归因成立）`, async () => {
        const reading = await readCell(cell.agentId, cell.cinema)
        expect(isZero(reading.total), `${key} 伤害读出 ${reading.total.toFixed(2)}%（预期 0）`).toBe(true)
        const moved = cell.daze ? reading.dStunBuildUp : reading.dEnergy
        expect(
          moved,
          `${key} 的非伤害通道没动（${cell.daze ? '失衡值' : '能量'} Δ=${moved.toFixed(2)}）——` +
          '「资源动了但没传导」这条归因不成立，要么通道断了要么归因错了',
        ).toBeGreaterThan(0)
      })
    }
  })

  describe('C 类 · 如实无增量（原文/口径上就没有伤害通道）', () => {
    const cells: Array<{ agentId: string; cinema: number; name: string; why: string }> = [
      { agentId: '1281', cinema: 6, name: '派派', why: '动力时长恒满口径 ⇒ 持续 12→16s 无伤害增量' },
      {
        agentId: '1131',
        cinema: 1,
        name: '苍角',
        why: '满覆盖口径（用户 2026-11-06 裁决）⇒ 展旗增益时长 +8s 无伤害增量',
      },
    ]
    for (const cell of cells) {
      it(`${cell.agentId}C${cell.cinema} ${cell.name}：实测 0（${cell.why}）`, async () => {
        const reading = await readCell(cell.agentId, cell.cinema)
        expect(isZero(reading.total), `${cell.agentId}C${cell.cinema} 实测 ${reading.total.toFixed(2)}%：${cell.why}`).toBe(true)
      })
    }

    /**
     * 苍角的**满覆盖口径是用户裁决，不是实现漏了**（2026-11-06 逐字：「苍角算满覆盖就好」）。
     *
     * 为什么要把状态表原文也锁住：这一格唯一的「证据」就是那句口径。若有人把状态表改回
     * 「时长 +8s」（读起来像待办）或订正成 `partially_implemented`（读起来像缺口），
     * 下一个人就会去 `soukaku.ts` 里硬加一个 `cinemaLevel >= 1` 分支——那是**错的**。
     */
    it('1131C1 状态表原文必须写着「满覆盖 ⇒ 0 是预期」，别让它退回「像待办」的措辞', () => {
      const constellations = loadConstellations()
      const status = (constellations.characters['1131']?.cinemas ?? []).find(c => c.cinema === 1)
      expect(status?.status, '1131C1 不再声明 implemented* —— 满覆盖口径的前提没了').toBe('implemented_approximation')
      const text = (status?.implemented ?? []).join(' ')
      expect(text, '1131C1 的原文没写「满覆盖」口径，下一个人会把它当缺口去补 C1 分支').toContain('满覆盖')
      expect(text, '1131C1 的原文没写「0 是预期值」').toContain('预期')
    })
  })

  /**
   * ★ 本表的夹具**不许换成多人队**（2026-11-06 实测，交接文档 §3 的证伪闸门）。
   * 加第 3 个人 = 平A 预算重分、时间账重排 ⇒ 原本非零的格子塌成 0。
   */
  it('★ 夹具不可换：1351C4 单人 +6.98% ⇒ 加第 3 人后塌成 0.00%（本表保持单人夹具的理由）', async () => {
    const solo = await readCell('1351', 4)
    expect(Math.abs(solo.total - 6.98), `1351C4 单人读数 ${solo.total.toFixed(2)}%（预期 +6.98）`).toBeLessThan(TOL * 10)
    const three = await readCell('1351', 4, { mates: ['1021'] })
    expect(
      isZero(three.total),
      `1351C4 加第 3 人后读出 ${three.total.toFixed(2)}%（预期 0）——` +
      '若不再塌，说明时间账对队伍人数的敏感性变了，section「为什么这张表用单人夹具」的论据要重验',
    ).toBe(true)
  })

  it('29 格口径：状态表声明 implemented 且本表 NONE 的格子一格里没有「死数据」', async () => {
    // 只锁集合规模与归属完备性：任何一格都必须落进上面某个 describe 的名单里，否则就是新的待查项
    const constellations = loadConstellations()
    const covered = new Set<string>([
      ...A_CLASS.map(c => `${c.agentId}C${c.cinema}`),
      ...B_CLASS.map(([a, c]) => `${a}C${c}`),
      '1081C2', '1441C6', '1411C4', '1271C4',
      '1101C1', '1141C1', '1131C2', '1151C1', '1141C2',
      '1281C6', '1131C1',
    ])
    // 交接文档列的 28 格 + 它漏掉的 1141C2（状态 implemented、表里 NONE、能量 +15 不传导伤害）
    const handoff = [
      '1661C6', '1311C4', '1421C1', '1421C6', '1211C1', '1161C4', '1461C4', '1011C4',
      '1031C4', '1101C2', '1111C2', '1121C1', '1141C4', '1271C1', '1421C4',
      '1081C2', '1101C1', '1131C1', '1131C2', '1141C1', '1151C1', '1151C6', '1271C4',
      '1281C6', '1351C1', '1411C4', '1441C6', '1141C2',
    ]
    const missing = handoff.filter(key => !covered.has(key))
    expect(missing, '这些格被交接文档点名、却没有落进任何归因组').toEqual([])
    // 状态表侧：B 类必须仍声明 implemented*（否则「0 是预期」的前提不成立）
    for (const [agentId, cinema] of B_CLASS) {
      const status = (constellations.characters[agentId]?.cinemas ?? []).find(c => c.cinema === cinema)?.status ?? ''
      expect(status.startsWith('implemented'), `${agentId}C${cinema} 状态表已不是 implemented 了（${status}）——B 类归因要重写`).toBe(true)
    }
  })
})