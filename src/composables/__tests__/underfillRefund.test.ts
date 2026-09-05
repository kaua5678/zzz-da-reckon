/**
 * 末轮欠打回填（core/resource.ts 折叠循环之后的可行性门控试探）生效测试。
 *
 * 钉住四件事：
 * ① 回填真的生效（此前 refund 冻结在 pass0 → 96/125 预设 refund=0、41 队留白 >1s、最大 93.7s，
 *    而 timeBudgetConverged 仍报 true）；
 * ② **绝不制造超预算**——netFrontlineOccupation ≤ 预算 是被轴退化/降配/队伍对比消费的硬不变量，
 *    naive 逐轮跟随实测把它从 8 队破到 20 队，故门控必须是可行性而不是轮数；
 * ③ 门槛以下不扰动（近均衡队被扰动会掉进 stunCount=0 吸引盆：runArchiveDeploy 前例）；
 * ④ 被拒试探不留副作用（冷/热启动逐位一致）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { clearWarmStartCache, calcTeamResources } from '@/core/resource'
import { UNDERFILL_PROBE_THRESHOLD_SECONDS, TIME_BUDGET_TOLERANCE_SECONDS } from '@/core/resource'
import { buildTeamTimeSummary } from '@/composables/teamTimeSummary'

beforeEach(() => clearWarmStartCache())

async function summary(team: string[]) {
  await setupHarness(['', '', ''])
  const config = useConfigStore()
  for (let i = 0; i < 3; i++) config.setAgent(i, team[i])
  const calc = useResourceCalc()
  const rr = calc.resourceResult.value
  expect(rr).toBeTruthy()
  return buildTeamTimeSummary({
    rr: rr!, battleTime: rr!.totalTime,
    invincibleTime: config.enemy.invincibleTime ?? 0,
    nameOf: (_a, slot) => `槽${slot}`,
  })
}

describe('末轮欠打回填', () => {
  it('① 明显欠打的队被回填：refund>0 且留白显著收小', async () => {
    // 希格莉德/莱卡恩/妮可：修复前 refund=0、留白 66s → 回填后打满
    //（朱鸢/妮可/苍角曾是本机制的旗舰样例：留白 93.7→30.1s；2026-09-05 查清她剩下的 30.1s
    //  不是欠打而是**压制以太弹与平A聚合行重复计费**，修掉后留白归零，见 zhuYuan.test.ts）
    const t = await summary(['1591', '1161', '1311'])
    expect(t.refund).toBeGreaterThan(10)
    expect(t.slack).toBeLessThanOrEqual(UNDERFILL_PROBE_THRESHOLD_SECONDS)
    // 星徽·比利/琉音/卢西娅：整数结构模块队，回填把留白收进门槛
    const s2 = await summary(['1531', '1481', '1451'])
    expect(s2.slack).toBeLessThanOrEqual(UNDERFILL_PROBE_THRESHOLD_SECONDS + 5)
  })

  it('② 回填不制造超预算（硬不变量：物化净占用 ≤ 预算 + 容差）', async () => {
    const teams: string[][] = [
      ['1241', '1031', '1311'], ['1591', '1161', '1311'], ['1591', '1481', '1311'],
      ['1531', '1481', '1451'], ['1191', '1161', '1311'], ['1051', '1481', '1451'],
      ['1431', '1341', '1031'], ['1061', '1071', '1151'], ['1471', '1191', '1481'],
    ]
    for (const team of teams) {
      const t = await summary(team)
      // 只约束「本步不该让超预算变多」：基线本就超预算的队（厚轴/厚交互）不在此列
      if (t.refund > 0) {
        expect(t.rowsNet, `${team.join('/')} 回填后超预算 ${t.rowsNet.toFixed(1)}>${t.budget}`)
          .toBeLessThanOrEqual(t.budget + TIME_BUDGET_TOLERANCE_SECONDS)
      }
    }
  })

  it('③ 门槛以下的近均衡队不被扰动（refund 保持 0）', async () => {
    // 莱卡恩/诺姆/苍角类：基线就打满（留白 ≤1s），试探只会把外层推进错误吸引盆
    const t = await summary(['1041', '1161', '1311'])
    expect(t.slack).toBeLessThanOrEqual(UNDERFILL_PROBE_THRESHOLD_SECONDS)
    expect(t.refund).toBe(0)
  })

  it('④ 冷启动与热启动逐位一致（被拒试探不留 cfg 副作用）', async () => {
    await setupHarness(['', '', ''])
    const config = useConfigStore()
    // 1241 队：回填真的触发（refund>0），且热启动仍逐位透明（缓存存的是试探前末态）
    for (let i = 0; i < 3; i++) config.setAgent(i, ['1241', '1031', '1311'][i])
    const calc = useResourceCalc()
    void calc.resourceResult.value
    const cfg = calc.resourceConfig.value!
    const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
    const pick = (rr: ReturnType<typeof calcTeamResources>) => JSON.stringify(
      rr?.characters.map(c => [c.exSpecialCount, c.ultimateCount,
        c.timeAllocation.basicAttackTime, c.timeAllocation.necessaryTime]))
    clearWarmStartCache()
    const cold = pick(calcTeamResources(copy(cfg)))
    // 第二次同配置：命中热启动缓存（试探前末态作初值）——回填试探若在被拒轮留下 cfg 副作用、
    // 或把回填后的末态写进缓存，这里就会分叉（实测 1241/1191 队曾因此由一致变不一致）。
    const warm = pick(calcTeamResources(copy(cfg)))
    expect(warm).toBe(cold)
  })
})
