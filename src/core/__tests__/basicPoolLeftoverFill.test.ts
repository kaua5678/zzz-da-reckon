/**
 * 平A池第二层兜底填充（用户口径 2026-10-21「留白正常情况是 0…其他所有空白队都应该自动填充」）。
 *
 * 病灶（交接 brief `docs/HANDOFF_BASIC_FILL_SLACK.md` 的待查方向 B，本轮实测确认为真因）：
 * `iterate` 的水填法只绕 `effectiveWeights[i] > 0` 的槽转 —— 主C 的份额贴到**单人物理上限**
 * （`totalTime` 减 `necessary`）后退出，池里剩下的秒数没有任何槽能接，直接蒸发成留白。
 * 实测 `auto-1091-1031-1311`（雅 + 妮可 + 耀嘉音，权重 1/0/0）：池 122.56s、雅只装得下 92.40s
 * ⇒ 剩 30.16s 无主，物化净占用 146.41/180、留白 33.59s（破 `timeFillRatchet` 的 30s 绝对地板）。
 *
 * 判据（三条，缺一条就退回旧行为）：
 * ① **只在第一层分完还有剩**时启动 ⇒ 正权重槽没贴顶的队逐位不变；
 * ② 零权重槽之间**等分**（水填，逐个退出，单人物理上限照旧）；
 * ③ 模块**显式声明**「不打通用平A」（`defaultBasicAttackTimeWeight === 0` —— 蕾米埃尔后台飞行 /
 *    薇薇安合轴快切 / 卢西娅计划内 A5）的槽**不接**，单人队也不接。
 *
 * 为什么等分而不是按伤害最优化：引擎不能判断「这 30s 给谁最划算」，等分是诚实的选择 —— 与
 * 第三层降级（`feasibleScale` 全员等比）的用户口径同一句「简单逻辑无法识别压缩谁最有利，只能全部都平等了」。
 */
import { describe, it, expect } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { buildTeamTimeSummary } from '@/composables/teamTimeSummary'
import { useConfigStore } from '@/stores/config'
import { teamPresets } from '@/data/teamPresets'

/** 交接 brief 点名的主队：权重 1/0/0，主C 贴顶 ⇒ 旧实现留白 33.6s */
const TEAM_MAIN = 'auto-1091-1031-1311'
/** 同形态第二队：权重 1/0/0，留白 26.9s */
const TEAM_SECOND = 'auto-1401-1411-1031'

async function measure(id: string) {
  const preset = teamPresets.find(p => p.id === id)
  await setupHarness(['', '', ''])
  const config = useConfigStore()
  for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i]!)
  const calc = useResourceCalc()
  const rr = calc.resourceResult.value
  expect(rr).toBeTruthy()
  const t = buildTeamTimeSummary({
    rr: rr!, battleTime: rr!.totalTime,
    invincibleTime: config.enemy.invincibleTime ?? 0,
    nameOf: (_a, slot) => '槽' + slot,
  })
  return { config, rr: rr!, t, basic: rr!.characters.map(c => c.timeAllocation.basicAttackTime) }
}

describe('平A池第二层兜底填充（贴顶后剩余池不再蒸发）', () => {
  /**
   * ⚠ 2026-10-24 夹具前提再变（落霜五源 + 刀数走「攒满 6 点」口径的连带结果，**不是**本功能退化）：
   * 落霜 21 → 82（补上「强化特殊技 +2 / 终结技 +3」两条原文来源；它们在初始提交里整块缺失），
   * 霜月 3 → 12 刀 ⇒ 雅的前台重新被霜月占住（`nec` 73、`basic` 107，仍贴 180 顶、留白 0），
   * 但**池又有了余量**（霜月合轴率 0.709 ⇒ 每刀只有 1s 净占）⇒ 妮可正确拿到 12.3s 平A。
   * ⇒ 本队重新变成「第二层兜底真的会填」的正面样本（这与 2026-10-23 那次「吃满到 0」是同一算术的
   *   不同解，两次都不是回归）。判据同时守住三条：留白 0、主C 贴顶、妮可 > 0。
   */
  it('主队 auto-1091-1031-1311：留白归零、主C 贴顶、妮可接手剩余池', async () => {
    const { basic, t } = await measure(TEAM_MAIN)
    expect(t.slack, '留白必须归零（旧实现 33.59s）').toBeLessThan(1)
    expect(basic[0], '主C 自己的物理时间轴贴顶').toBeGreaterThan(70)
    expect(basic[1], '池有余量 ⇒ 妮可（零权重、未声明不打平A）必须接住').toBeGreaterThan(1)
    expect(basic[2], '耀嘉音不能打平A（`defaultBasicAttackTimeWeight = 0`）⇒ 不接').toBe(0)
  }, 300_000)

  it('第二队 auto-1401-1411-1031：同形态留白归零（不是单队特判）', async () => {
    const { t, basic } = await measure(TEAM_SECOND)
    expect(t.slack, '留白必须归零（旧实现 26.89s）').toBeLessThan(1)
    expect(basic[1]! + basic[2]!).toBeGreaterThan(1)
  }, 300_000)

  it('边界：第一层没贴顶时第二层不启动（行为与修前逐位相同）', async () => {
    await setupHarness(['', '', ''])
    const config = useConfigStore()
    for (const [i, id] of ['1261', '1561', '1411'].entries()) config.setAgent(i, id!)
    expect(config.team.map(c => c.basicAttackTimeWeight)).toEqual([1, 1, 0])
    const calc = useResourceCalc()
    const basic = calc.resourceResult.value!.characters.map(c => c.timeAllocation.basicAttackTime)
    expect(basic[2], '零权重槽不接（第一层已把池分完，第二层不启动）').toBe(0)
    expect(basic[0]).toBeCloseTo(basic[1]!, 6)
  }, 300_000)

  it('边界：模块声明决定谁接兜底池（耀嘉音 0 不接 / 蕾米埃尔 0 不接 / 未声明的支援槽接）', async () => {
    await setupHarness(['', '', ''])
    const config = useConfigStore()
    for (const [i, id] of ['1581', '1211', '1451'].entries()) config.setAgent(i, id!)
    expect(config.team.map(c => c.basicAttackTimeWeight), '夹具前提：三人权重都是 0').toEqual([0, 0, 0])
    const calc = useResourceCalc()
    const basic = calc.resourceResult.value!.characters.map(c => c.timeAllocation.basicAttackTime)
    expect(basic[0], '全队皆 0 ⇒ 一号位独享仍生效').toBeGreaterThan(1)
    expect([basic[1], basic[2]], '其余槽不接兜底池（模块声明 0 = 不打通用平A）').toEqual([0, 0])
  }, 300_000)

  /**
   * **合轴时间只能给队友**（用户口径 2026-10-22：「雅和爱丽丝这种自带基础合轴率的，其合轴时间只能给队友分配，
   * 这部分时间是空余的原因吗。那只能默认设置给队友吃了，没有权重也得战场」）。
   *
   * 物理含义：`comboAlignCredit` = 本槽动作**与队友前台并行的秒数**。队友不在场就没有并行对象 ⇒
   * 这部分抵扣是幻觉（把不存在的时间从账本里扣掉了两次：一次扩池、一次减净占用）。
   * 本断言把这句话变成逐队零容差判据：
   *   ∀槽 i：`comboAlignCredit_i ≤ Σ_{j≠i} frontlineTime_j`
   *
   * 实测：本轮修前 `auto-1091-1031-1311` 的雅 credit **38.94s** 而两名队友前台只有 14.65s
   * ⇒ 24.30s 幻觉抵扣（同形态 `auto-1401-1411-1031` 13.00s）；第二层兜底让队友上场后，全库 0 违反。
   */
  it('不变量：每槽合轴抵扣 ≤ 队友前台之和（合轴只能与队友并行，队友不上场就没有并行对象）', async () => {
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    const bad: string[] = []
    for (const p of presets) {
      const { rr } = await measure(p.id)
      for (const ch of rr.characters) {
        const credit = Math.max(0, ch.timeAllocation.comboAlignCredit ?? 0)
        const mates = rr.characters.reduce((acc, x) => (x.slot === ch.slot ? acc : acc + x.timeAllocation.frontlineTime), 0)
        if (credit - mates > 1) {
          bad.push(`${p.id} 槽${ch.slot}(${ch.agentId}) 合轴抵扣 ${credit.toFixed(2)}s > 队友前台 ${mates.toFixed(2)}s（幻觉 ${(credit - mates).toFixed(2)}s）`)
        }
      }
    }
    expect(bad, '合轴抵扣超过队友前台 = 抵扣了不存在并行对象的时间').toEqual([])
  }, 600_000)
  it('不变量：全库预设物化净占用仍不超预算（第二层不制造超预算）', async () => {
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    const bad: string[] = []
    for (const p of presets) {
      const { t } = await measure(p.id)
      if (t.slack < -1) bad.push(p.id + ' 超预算 ' + (-t.slack).toFixed(2) + 's')
    }
    expect(bad, '第二层只负责把池分出去；可行性仍由欠打试探 fitsBudget 兜底').toEqual([])
  }, 600_000)
})
