/**
 * 喧响账本行级 Σ parity（记账层 == 展示层，2026-09-08 债务清偿的生效测试）。
 *
 * 锁定三件事：
 * ① 恒等式：calcRawDecibelParts.skillRegen == Σ buildExecutions 行的行级喧响
 *    （rowDecibelTotal 分支语义 == enrichExecutionPlan decibel 分支——账本与展示同源，
 *    消灭旧「次数×常量」聚合与倍率行双口径）；
 * ② 债务清偿个案：洛克茜自旋每秒口径（decibelRecoveryOverride）、艾莲霜锋行表值回填
 *    （旧 decibelRecovery:0 硬编码删除）；
 * ③ NaN 免疫：畸形/不完整配置的行值绝不把账本毒成 NaN（NaN 会毒化次数迭代并被
 *    环检测签名物化成 null）。
 *
 * 本文件是以下 @fact 的「验」锚点：
 * - engine:喧响收入行级Σ（src/core/resource/helpers.ts#rowDecibelTotal）
 * - agent:1621/自旋喧响每秒口径（src/mechanics/agents/roxy.ts#SPIN_SECOND_MOVE_ID）
 * - agent:1191/喧响行级回填审计（src/mechanics/agents/ellen.ts#pushEllenExecution）
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { ROXY_FULL_SPIN_SECONDS } from '@/mechanics/agents/roxy'
import { buildExecutions } from '@/core/resource/rowBuild'
import { calcRawDecibelParts } from '@/core/resource/resourceIncome'
import { emptyPanel } from '@/core/panel'
import type { CharacterOperationConfig, IterationState, ResourceCalcConfig, SkillExecution } from '@/types/resource'

/** rowDecibelTotal 分支语义复刻（= enrichExecutionPlan decibel 分支）——记账层==展示层的规格锁 */
function expectedRowDecibel(cfg: CharacterOperationConfig, row: SkillExecution): number {
  const fin = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  if (row.moveId === 'basic_attack') return fin(row.totalDecibelRecovery)
  const table = cfg.decibelRecoveryByMoveId
  if (!table || !Object.prototype.hasOwnProperty.call(table, row.moveId)) return fin(row.totalDecibelRecovery)
  const perCount = row.decibelRecoveryOverride
    ? fin(row.decibelRecovery)
    : row.decibelRecovery === 0
      ? 0
      : (fin(table[row.moveId]) || fin(row.decibelRecovery) || 0)
  return fin(perCount * Math.max(0, fin(row.count)))
}

function stateOf(over: Partial<IterationState> = {}): IterationState {
  return {
    basicAttackTime: 20,
    exSpecialCount: 3,
    ultimateCount: 2,
    chainCountTotal: 2,
    totalEnergy: 200,
    totalDecibel: 5000,
    necessaryTime: 30,
    frontlineTime: 50,
    backstageTime: 130,
    comboAlignTime: 0,
    ...over,
  }
}

/** 真实 harness 装配的 ResourceCalcConfig（含 buildCharConfig 写入的 decibelRecoveryByMoveId 表） */
async function builtConfig(team: Array<{ agentId: string; cinemaLevel?: number }>): Promise<ResourceCalcConfig> {
  await setupHarness(team)
  const calc = useResourceCalc()
  for (let i = 0; i < 50; i++) {
    void calc.resourceResult.value
    const v = calc.resourceConfig.value
    if (v && v.characters.length === team.length) return JSON.parse(JSON.stringify(v)) as ResourceCalcConfig
    await new Promise(r => setTimeout(r, 10))
  }
  throw new Error('resourceConfig 未就绪')
}

const TEAMS: Array<Array<{ agentId: string; cinemaLevel?: number }>> = [
  [{ agentId: '1051' }, { agentId: '1141' }, { agentId: '1451' }], // 伊德海莉队（模块行大户+终局整数重推）
  [{ agentId: '1191' }, { agentId: '1571' }, { agentId: '1011' }], // 艾莲队（霜锋行债务清偿）
  [{ agentId: '1621' }, { agentId: '1141' }],                     // 洛克茜队（自旋 override）
  [{ agentId: '1371' }, { agentId: '1251' }, { agentId: '1271' }], // 仪玄队（后台合轴二选一）
]

const STATES: Array<Partial<IterationState>> = [
  {},
  { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 },
  { exSpecialCount: 7.5, ultimateCount: 1, basicAttackTime: 41.2 },
  { basicAttackTime: 0, exSpecialCount: 12, ultimateCount: 4, chainCountTotal: 6 },
]

describe('喧响账本行级 Σ parity（记账层 == 展示层）', () => {
  it('真实队伍 × 合成状态：skillRegen == Σ 行级喧响，且恒有限', async () => {
    for (const team of TEAMS) {
      const rc = await builtConfig(team)
      for (const cfg of rc.characters) {
        for (const over of STATES) {
          const st = stateOf(over)
          const teamFront = 100
          const parts = calcRawDecibelParts(cfg, st, st.chainCountTotal, st.exSpecialCount, st.ultimateCount, 180, teamFront)
          const rows = buildExecutions(cfg, st, st.chainCountTotal, teamFront)
          const sum = rows.reduce((s, r) => s + expectedRowDecibel(cfg, r), 0)
          const tag = `${cfg.agentId} ex=${st.exSpecialCount} bat=${st.basicAttackTime}`
          expect(Number.isFinite(parts.skillRegen), `${tag} 账本必须有限`).toBe(true)
          expect(parts.skillRegen, `${tag} 账本 == Σ 行级喧响`).toBe(sum)
        }
      }
    }
  }, 120000)

  it('洛克茜自旋（1621008）：行值 = 每秒表值 × spinSeconds，override 跳过表值覆盖', async () => {
    const rc = await builtConfig([{ agentId: '1621' }, { agentId: '1141' }])
    const roxy = rc.characters.find(c => c.agentId === '1621')!
    const perSec = Number((roxy as unknown as Record<string, unknown>).roxySpinSecondDecibel ?? 0)
    expect(perSec, '自旋每秒喧响表值（catalog 1621008 decibel_recovery=84.343）').toBeGreaterThan(0)
    // ⚠ 2026-10-19 用户裁决：自旋秒数**不再是滑块**（`setting:roxy.spinSeconds` 已删）⇒
    // 实际自旋秒数 = 满发 2.5s × 满发次数 + 1 次零散发，由能量预算决定（见 `computeRoxyExCount`）。
    // 本用例改用**实际自旋总秒数**做基准（口径与 `buildRoxyExecutions` 同源）。
    const spinSeconds = ROXY_FULL_SPIN_SECONDS
    expect(spinSeconds).toBeGreaterThan(0)
    const st = stateOf({ exSpecialCount: 3 })
    const rows = buildExecutions(roxy, st, st.chainCountTotal, 50)
    const spinRows = rows.filter(r => r.moveId === '1621008')
    const spin = spinRows[0]
    expect(spin, '自旋行必须物化').toBeTruthy()
    /** 自旋可能拆成「满发行 + 零散发行」两行（用户口径 2026-10-19）⇒ 总量按 Σ 判 */
    const spinTotalDecibel = spinRows.reduce((a, r) => a + Number(r.totalDecibelRecovery ?? 0), 0)
    expect(spin!.decibelRecoveryOverride, '每秒口径必须走 override（表值直填会少算 spinSeconds 倍）').toBe(true)
    // 行内 `decibelRecovery` 是**单发**口径 = 每秒值 × 该行的秒数（满发行 = 满发秒）。
    expect(spin!.decibelRecovery).toBeCloseTo(perSec * spinSeconds, 6)
    /**
     * 合成 state 带 `totalEnergy: 200` ⇒ 有能量预算 ⇒ 3 发里 **2 发满发 + 1 发零散**（200 = 2×85 + 30 剩余）。
     * 这正是用户口径 2026-10-19「放多次满秒数和 1 次零散的，打出全部能量」的形态。
     */
    // 由**行自身**反推实际自旋总秒（`buildExecutions` 不产 `roxyWindEnergySource`，那是 buildResourceResult 的活）
    const spinSecondsTotal = spinRows.reduce((a, r) => a + Number(r.totalDecibelRecovery ?? 0) / perSec, 0)
    expect(spinRows.length, '满发 + 零散 ⇒ 两行（200 能量 = 2×85 + 30 剩余）').toBe(2)
    expect(spinRows[1].count, '零散发行只打一次').toBe(1)
    // 200 能量：2 发满发(85×2=170) + 零散发(剩余 30 ⇒ 启动 10 + 自旋 20/30 = 0.667s)
    expect(spinSecondsTotal, 'Σ实际自旋秒 = 2×满发 + 零散(0.667s)').toBeCloseTo(2 * spinSeconds + (30 - 10) / 30, 6)
    expect(spinTotalDecibel, 'Σ行总量 = 每秒值 × 实际自旋总秒').toBeCloseTo(perSec * spinSecondsTotal, 6)
    const parts = calcRawDecibelParts(roxy, st, st.chainCountTotal, st.exSpecialCount, st.ultimateCount, 180, 50)
    // 账本含 自旋总量 = 每秒 × 实际自旋总秒（旧 decibelRecovery:0 硬编码曾全额漏计）
    expect(parts.skillRegen).toBeGreaterThanOrEqual(perSec * spinSeconds * 3 - 1e-6)
  }, 60000)

  it('艾莲霜锋（1191027）：删 0 硬编码后按倍率表每次值进账本', async () => {
    const rc = await builtConfig([{ agentId: '1191' }, { agentId: '1571' }, { agentId: '1011' }])
    const ellen = rc.characters.find(c => c.agentId === '1191')!
    const table = ellen.decibelRecoveryByMoveId ?? {}
    expect(table['1191027'], '挥刀表值 6.435（每次）').toBeGreaterThan(0)
    const st = stateOf({ exSpecialCount: 3 })
    const rows = buildExecutions(ellen, st, st.chainCountTotal, 100)
    const swing = rows.filter(r => r.moveId === '1191027')
    expect(swing.length, '霜锋挥刀行必须物化（免费自动）').toBeGreaterThan(0)
    const swingTotal = swing.reduce((s, r) => s + expectedRowDecibel(ellen, r), 0)
    expect(swingTotal).toBeGreaterThan(0)
    const parts = calcRawDecibelParts(ellen, st, st.chainCountTotal, st.exSpecialCount, st.ultimateCount, 180, 100)
    expect(parts.skillRegen).toBeGreaterThanOrEqual(swingTotal - 1e-6)
  }, 60000)

  it('NaN 免疫：畸形合成配置（模块字段缺失）行值为 NaN 时账本仍有限', () => {
    // 复刻 luciaElowen.test 的合成口径：yidhariChargeSlam 只有 actionTime（无 id/decibel），
    // 模块行 moveId=undefined、totalDecibelRecovery=NaN——旧路径 NaN 进账本会毒化次数迭代
    // 并被环检测 JSON 签名物化成 null（实测合成队 ex/ult 全 null）。
    const cfg = {
      slot: 0,
      agentId: '1051',
      isFlashUser: false,
      panel: emptyPanel(),
      basicAttackRegenPerSec: 0,
      basicAttackDecibelPerSec: 0,
      exSpecialMoveId: 'ex1',
      exSpecialEnergyConsume: 60,
      exSpecialActionTime: 2,
      exSpecialDecibelRecovery: 0,
      ultimateMoveId: 'ult1',
      ultimateCost: 3000,
      ultimateActionTime: 2,
      ultimateDecibelRecovery: 0,
      chainMoveId: 'chain1',
      chainActionTime: 2,
      chainDecibelRecovery: 0,
      chainCountPerStun: 0,
      parryCount: 0,
      dodgeCounterCount: 0,
      initialEnergyGift: 40,
      initialDecibelGift: 1000,
      extraSelfDecibelReward: 0,
      decibelShareRatio: 0.5,
      timeWeight: 1,
      resourceUtilization: {},
      yidhariChargeSlam: { actionTime: 1.2917 },
      yidhariBasicFollow: { actionTime: 1.55 },
      yidhariDecibelPerHpPct: 10,
    } as unknown as CharacterOperationConfig
    const st = stateOf({ basicAttackTime: 20, exSpecialCount: 2, ultimateCount: 1 })
    const parts = calcRawDecibelParts(cfg, st, 0, 2, 1, 180, 30)
    expect(Number.isFinite(parts.skillRegen), '账本绝不带 NaN').toBe(true)
    expect(Number.isFinite(parts.shareableTotal)).toBe(true)
  })
})
