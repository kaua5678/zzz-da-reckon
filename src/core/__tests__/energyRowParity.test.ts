/**
 * 能量账本行级 Σ parity（记账层 == 展示层，2026-09-09 债务清偿的生效测试，decibelRowParity 同构）。
 *
 * 锁定三件事：
 * ① 恒等式：calcEnergySource.skillRegen == Σ buildExecutions 行的行级能量
 *    （rowEnergyTotal 分支语义 == enrichExecutionPlan energy 分支——账本与展示同源，
 *    消灭旧「平A时间 × 秒均回能」聚合与倍率行双口径）；
 * ② 债务清偿个案：艾莲霜锋行表值回填（旧 energyRecovery:0 硬编码删除）、伊德海莉蓄力循环
 *    模块行（slam/follow 表值 0 落行值、平A载体被模块置 0——Σ 如实反映）；
 * ③ NaN 免疫：畸形/不完整配置的行值绝不把账本毒成 NaN（NaN 会毒化次数迭代并被
 *    环检测签名物化成 null）。
 *
 * 本文件是以下 @fact 的「验」锚点：
 * - engine:能量收入行级Σ（src/core/resource/helpers.ts#rowEnergyTotal）
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { buildExecutions, calcEnergySource } from '@/core/resource/helpers'
import { emptyPanel } from '@/core/panel'
import type { CharacterOperationConfig, IterationState, ResourceCalcConfig, SkillExecution } from '@/types/resource'

/** rowEnergyTotal 分支语义复刻（= enrichExecutionPlan energy 分支）——记账层==展示层的规格锁 */
function expectedRowEnergy(cfg: CharacterOperationConfig, row: SkillExecution): number {
  const fin = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  if (row.moveId === 'basic_attack') return fin(row.totalEnergyRecovery)
  const table = cfg.energyRecoveryByMoveId
  if (!table || !Object.prototype.hasOwnProperty.call(table, row.moveId)) return fin(row.totalEnergyRecovery)
  const perCount = row.energyRecovery === 0
    ? 0
    : (fin(table[row.moveId]) || fin(row.energyRecovery) || 0)
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

/** 真实 harness 装配的 ResourceCalcConfig（含 buildCharConfig 写入的 energyRecoveryByMoveId 表） */
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

function energyOf(cfg: CharacterOperationConfig, st: IterationState, teamFront: number) {
  return calcEnergySource(cfg, st, [cfg], 0, 0, st.chainCountTotal, 180, teamFront)
}

const TEAMS: Array<Array<{ agentId: string; cinemaLevel?: number }>> = [
  [{ agentId: '1051' }, { agentId: '1141' }, { agentId: '1451' }], // 伊德海莉队（蓄力循环模块行+refund 解析不动点）
  [{ agentId: '1191' }, { agentId: '1571' }, { agentId: '1011' }], // 艾莲队（霜锋/冰渊潜袭行债务清偿）
  [{ agentId: '1621' }, { agentId: '1141' }],                     // 洛克茜队
  [{ agentId: '1371' }, { agentId: '1251' }, { agentId: '1271' }], // 仪玄队（额外闪能通道与行级 Σ 并存）
  [{ agentId: '1131' }, { agentId: '1141' }],                     // 苍角队（自我能量循环：占位删除→表值回填）
]

const STATES: Array<Partial<IterationState>> = [
  {},
  { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 },
  { exSpecialCount: 7.5, ultimateCount: 1, basicAttackTime: 41.2 },
  { basicAttackTime: 0, exSpecialCount: 12, ultimateCount: 4, chainCountTotal: 6 },
]

describe('能量账本行级 Σ parity（记账层 == 展示层）', () => {
  it('真实队伍 × 合成状态：skillRegen == Σ 行级能量，且恒有限', async () => {
    for (const team of TEAMS) {
      const rc = await builtConfig(team)
      for (const cfg of rc.characters) {
        for (const over of STATES) {
          const st = stateOf(over)
          const teamFront = 100
          const src = energyOf(cfg, st, teamFront)
          const rows = buildExecutions(cfg, st, st.chainCountTotal, teamFront)
          const sum = rows.reduce((s, r) => s + expectedRowEnergy(cfg, r), 0)
          const tag = `${cfg.agentId} ex=${st.exSpecialCount} bat=${st.basicAttackTime}`
          expect(Number.isFinite(src.skillRegen), `${tag} 账本必须有限`).toBe(true)
          expect(src.skillRegen, `${tag} 账本 == Σ 行级能量`).toBe(sum)
          expect(Number.isFinite(src.total), `${tag} 总能量必须有限`).toBe(true)
        }
      }
    }
  }, 120000)

  it('艾莲霜锋（1191027）：删 0 硬编码后按倍率表每次值进账本', async () => {
    const rc = await builtConfig([{ agentId: '1191' }, { agentId: '1571' }, { agentId: '1011' }])
    const ellen = rc.characters.find(c => c.agentId === '1191')!
    const table = ellen.energyRecoveryByMoveId ?? {}
    expect(table['1191027'], '挥刀表值（每次）> 0').toBeGreaterThan(0)
    const st = stateOf({ exSpecialCount: 3 })
    const rows = buildExecutions(ellen, st, st.chainCountTotal, 100)
    const swing = rows.filter(r => r.moveId === '1191027')
    expect(swing.length, '霜锋挥刀行必须物化（免费自动）').toBeGreaterThan(0)
    const swingTotal = swing.reduce((s, r) => s + expectedRowEnergy(ellen, r), 0)
    expect(swingTotal).toBeGreaterThan(0)
    const src = energyOf(ellen, st, 100)
    expect(src.skillRegen).toBeGreaterThanOrEqual(swingTotal - 1e-6)
  }, 60000)

  it('伊德海莉蓄力循环：平A载体置 0、slam/follow 模块行值进账本（表值 0 落行值）', async () => {
    const rc = await builtConfig([{ agentId: '1051' }, { agentId: '1141' }, { agentId: '1451' }])
    const yidhari = rc.characters.find(c => c.agentId === '1051')!
    const st = stateOf({ basicAttackTime: 30 })
    const rows = buildExecutions(yidhari, st, st.chainCountTotal, 100)
    const slam = rows.filter(r => r.moveId === '1051007')
    expect(slam.length, '蓄力下砸行必须物化（basicAttackTime 足够折循环）').toBeGreaterThan(0)
    const slamTotal = slam.reduce((s, r) => s + expectedRowEnergy(yidhari, r), 0)
    expect(slamTotal, '模块行值（flash 预计算）必须进账本').toBeGreaterThan(0)
    const src = energyOf(yidhari, st, 100)
    expect(src.skillRegen).toBeGreaterThanOrEqual(slamTotal - 1e-6)
    // refund 通道与行级 Σ 并存不互斥（refund 是强特耗能返还，行值是蓄力循环闪能收入——不同物理量）
    expect(Number.isFinite(src.yidhariRefund)).toBe(true)
  }, 60000)

  it('NaN 免疫：畸形合成配置（模块字段缺失）行值为 NaN 时账本仍有限', () => {
    // 复刻 decibelRowParity 的合成口径：yidhariChargeSlam 只有 actionTime（无 id/flash），
    // 模块行 moveId=undefined、totalEnergyRecovery=NaN——旧路径 NaN 进账本会毒化次数迭代
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
      quickAssistCount: 0,
      initialEnergyGift: 40,
      initialDecibelGift: 1000,
      extraSelfDecibelReward: 0,
      decibelShareRatio: 0.5,
      timeWeight: 1,
      yidhariChargeSlam: { actionTime: 1.2917 },
      yidhariBasicFollow: { actionTime: 1.55 },
      yidhariDecibelPerHpPct: 10,
      yidhariExHealMissingHpPct: 0.75,
    } as unknown as CharacterOperationConfig
    const st = stateOf({ basicAttackTime: 20, exSpecialCount: 2, ultimateCount: 1 })
    const src = energyOf(cfg, st, 30)
    expect(Number.isFinite(src.skillRegen), '账本绝不带 NaN').toBe(true)
    expect(Number.isFinite(src.total)).toBe(true)
  })
})
