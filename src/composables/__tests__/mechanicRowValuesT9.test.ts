import { describe, expect, it } from 'vitest'
import { getRowValue, findMoveById } from '@/data/moveTableQueries'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { HUGO_VERDICT_BASE_MULTIPLIER, computeHugoVerdictMultiplier } from '@/mechanics/agents/hugo'
import { GRACE_C4_ENERGY_EFFICIENCY, graceMechanic } from '@/mechanics/agents/grace'

/**
 * T9（CC-408 同款）：模块内「= catalog 行值」的倍率常量改读表，零差。
 *
 * 雨果强特终结 1291010 damage 行原由模块常量 `HUGO_EX_FINAL_BASE_MULTIPLIER = 709.8` 结算；
 * 现由 `buildHugoCharConfig` 读 catalog 进 `cfg.mechanicRowValues['1291010']`，执行行从该处取。
 * 反空洞：真引擎跑出的行倍率必须等于 catalog 该行值（而不是任何写死的数字），且行真实出现。
 *
 * 口径适配（卡面未说清，取最小改动）：C6 下 `1291_ex_normal_final` 恒被 `count = 0` 短路
 * （轴外强特转 `1291_c6_out_of_stun_verdict`），该行在 C6 **不会出现**。故：
 * - C0（exVerdictRatio 0.5）→ `1291_ex_normal_final` 出现，断言 === 表值；
 * - C6（exVerdictRatio 0.5）→ `1291_c6_out_of_stun_verdict` 出现，断言 === 表值 + 决算基础倍率（同源表值）；
 * 两级另断言决算行 `1291_ex_verdict_final` === 表值 + 决算额外倍率。
 */
describe('T9 雨果强特终结 1291010 倍率来自 catalog（cfg.mechanicRowValues）', () => {
  const CASES: Array<{ cinema: number; normalMoveId: string }> = [
    { cinema: 0, normalMoveId: '1291_ex_normal_final' },
    { cinema: 6, normalMoveId: '1291_c6_out_of_stun_verdict' },
  ]

  it('真引擎：C0/C6 决算与非决算行倍率 === catalog 1291010 damage 行值（行真实出现）', async () => {
    for (const c of CASES) {
      const { catalog, config } = await setupHarness([
        { agentId: '1291', cinemaLevel: c.cinema, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
        { agentId: '1141', cinemaLevel: 0 },
        '',
      ])
      // exVerdictRatio < 1 ⇒ 出现「非决算」强特终结行（C6 下走轴外荆棘决算行）
      config.setMechanicSetting('hugo.exVerdictRatio', 0.5)
      const calc = useResourceCalc()
      const ch = calc.resourceResult.value!.characters.find(x => x.agentId === '1291')!
      const tableDamage = getRowValue(findMoveById(catalog.getAgentSkills('1291'), '1291010'), 'damage')
      expect(tableDamage, 'catalog 1291010 damage 行值').toBeGreaterThan(0)

      const normal = ch.executions.find(e => e.moveId === c.normalMoveId)
      expect(normal, `C${c.cinema} ${c.normalMoveId} 行真实出现`).toBeTruthy()
      const expectedNormal = c.cinema >= 6 ? tableDamage + HUGO_VERDICT_BASE_MULTIPLIER : tableDamage
      expect(normal!.damageMultiplier, `C${c.cinema} ${c.normalMoveId}`).toBeCloseTo(expectedNormal, 9)

      // 决算行：表值 + 决算额外倍率（决算倍率 = 1000 + 剩余秒数动态，与表值无关；默认滑块剩余 5 秒）
      const verdict = ch.executions.find(e => e.moveId === '1291_ex_verdict_final')
      expect(verdict, `C${c.cinema} 决算行真实出现`).toBeTruthy()
      const expectedVerdictExtra = computeHugoVerdictMultiplier(5)
      expect(verdict!.damageMultiplier! - tableDamage, `C${c.cinema} 决算额外倍率`)
        .toBeCloseTo(expectedVerdictExtra, 9)
      expect(verdict!.damageMultiplier!).toBeGreaterThan(tableDamage)
    }
  })
})

/**
 * 希希芙（1521）蚀骨 1521019 / 蛇吻 1521006 damage 行原由模块常量 `XIXIFU_SHIGU_BASE = 254.4`
 * 与 `XIXIFU_SHEKISS_RATIO = 1009.1` 结算；现由 `buildXixifuCharConfig` 读 catalog 进
 * `cfg.mechanicRowValues`，执行行从该处取。反空洞：真引擎跑出的行倍率必须 === catalog 该行值，
 * 且两行真实出现（蛇吻需毒素 ≥6，180s 默认战斗时长下必然出现）。
 */
describe('T9 希希芙蚀骨/蛇吻倍率来自 catalog（cfg.mechanicRowValues）', () => {
  it('真引擎：1521019 / 1521006 行倍率 === catalog damage 行值（行真实出现）', async () => {
    const { catalog } = await setupHarness([
      { agentId: '1521', cinemaLevel: 0 },
      { agentId: '1621', cinemaLevel: 0 }, // 洛克茜（风·击破）触发额外能力，且战斗时长下毒素充足
      '',
    ])
    const calc = useResourceCalc()
    const ch = calc.resourceResult.value!.characters.find(x => x.agentId === '1521')!

    for (const moveId of ['1521019', '1521006']) {
      const tableDamage = getRowValue(findMoveById(catalog.getAgentSkills('1521'), moveId), 'damage')
      expect(tableDamage, `catalog ${moveId} damage 行值`).toBeGreaterThan(0)
      const exec = ch.executions.find(e => e.moveId === moveId)
      expect(exec, `${moveId} 行真实出现`).toBeTruthy()
      expect(exec!.damageMultiplier, `${moveId} 倍率 === 表值`).toBeCloseTo(tableDamage, 9)
    }
  })
})

/**
 * T9 格莉丝（CC-415）：A1-A4 每段能量回复原为模块常量 0.615/1.189/2.454/4.081，现由 `buildGraceCharConfig`
 * 读 catalog energy_recovery 进 `cfg.mechanicRowValues['1181001'..'1181004']`，影画4 爆破电容按段折算从该处取。
 * 反空洞两层：① 真 catalog + 真 buildCharConfig 写出的四个行值 === 表值且 > 0；
 * ② materializePhaseState 的 C4 回能 = 20% × Σ(受益段表值)（exUsed=1 ⇒ 6 段 = 整轮 4 段 + A1 + A2），
 *    且去掉表值（缺表）时回能为 0 —— 证明口径只来自表，没有常量兜底。
 */
describe('T9 格莉丝 A1-A4 回能来自 catalog（cfg.mechanicRowValues）', () => {
  const SEG = ['1181001', '1181002', '1181003', '1181004']

  it('buildCharConfig 写出的四段 energy_recovery === 表值；C4 回能 = 20% × 受益段表值之和；缺表 = 0', async () => {
    const { catalog } = await setupHarness([{ agentId: '1181', cinemaLevel: 4 }, '', ''])
    const skills = catalog.getAgentSkills('1181')!
    const table = SEG.map(id => getRowValue(findMoveById(skills, id), 'energy_recovery'))
    for (const [i, v] of table.entries()) expect(v, `catalog ${SEG[i]} energy_recovery`).toBeGreaterThan(0)

    const cfg: any = { initialEnergyGift: 0, moveActionTimes: { '1181001': 0.171, '1181002': 0.33, '1181003': 0.682, '1181004': 1.134, '1181005': 0.2, '1181006': 0.342 } }
    graceMechanic.buildCharConfig!({ cinemaLevel: 4, cfg, panel: {} as any, skills, settings: {} } as any)
    for (const [i, id] of SEG.entries()) expect(cfg.mechanicRowValues?.[id], `cfg.mechanicRowValues[${id}]`).toBeCloseTo(table[i], 12)

    // 平A池 60s ⇒ cycles ≥ 2；exUsed = 1 ⇒ 受益 6 段 = 整轮(4 段) + A1 + A2
    const state: any = { exSpecialCount: 1, basicAttackTime: 60, ultimateCount: 0 }
    graceMechanic.materializePhaseState!({ cfg, state })
    const expected = (GRACE_C4_ENERGY_EFFICIENCY / 100) * (table[0] + table[1] + table[2] + table[3] + table[0] + table[1])
    expect(cfg.initialEnergyGift, 'C4 回能 = 20% × 受益段表值之和').toBeCloseTo(expected, 9)

    const bare: any = { ...cfg, mechanicRowValues: {}, initialEnergyGift: 0, graceC4EnergyGift: 0 }
    graceMechanic.materializePhaseState!({ cfg: bare, state })
    expect(bare.initialEnergyGift ?? 0, '缺表 ⇒ 回能 0（无常量兜底）').toBe(0)
  })
})
