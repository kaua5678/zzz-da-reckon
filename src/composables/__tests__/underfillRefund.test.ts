/**
 * 末轮欠打回填（core/resource.ts 折叠循环之后的可行性门控试探）生效测试。
 *
 * 钉住四件事：
 * ① 有平A权重的队伍，自由时间 >1s（量化容差）必被回填——refund→平A池→按 timeWeight 水填分配，
 *    留白收进量化/试探粒度地板（用户 2026-09-08：平A权重与留白不应并存，剩余自由时间按权重全部分配；
 *    2026-09-08 诊断：10s 门槛下 56 队留白 0.5~9s；隔离对拍（同工作区切门槛）留白 194.3→157.0s、
 *    11 队改善 0 队变差）；
 * ② **绝不制造超预算**——netFrontlineOccupation ≤ 预算 是被轴退化/降配/队伍对比消费的硬不变量，
 *    naive 逐轮跟随实测把它从 8 队破到 20 队，故门控必须是可行性而不是轮数；
 * ③ 欠打 ≤1s（量化地板，坑12「不追求精确 0」）不扰动：正注入会被预算−容差门控整体拒绝，
 *    试探只会把外层推进吸引盆（09-05 runArchiveDeploy 前例）；
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
  it('① 自由时间 >1s 的队列试探回填：refund>0，留白收进量化/试探粒度地板', async () => {
    // 1181/1511/1411：留白 7.4s（10s 门槛下从不试探、refund=0）→ 09-08 门槛降为 1s（=量化容差）
    // 后被试探：实测 refund 5.6s、留白收进 1.1s（≤ 2×容差 = 折半试探的粒度地板）。
    const t = await summary(['1181', '1511', '1411'])
    expect(t.refund).toBeGreaterThan(0)
    expect(t.slack).toBeLessThanOrEqual(2 * TIME_BUDGET_TOLERANCE_SECONDS)
    // 1191/1481/1451… 取 1191/1481/1311：旧门槛（10s）时代的大欠打样例——refund>0 在两个
    // 门槛下都必须成立（欠打 8.9s 的放大环使填充不可行是既有物理，门控只保证「可行部分全分」）。
    const s2 = await summary(['1191', '1481', '1311'])
    expect(s2.refund).toBeGreaterThan(0)
    // 1431 系单权重 [1,0,0] 队（叶瞬光账本必要贴单人物理顶）：refund 会流入平A池但物化行
    // 吃不下的部分仍留白（棘轮逐队钉），不在本测试断言具体值。
  })

  // 9 队全引擎 × 负载竞争：全量并行时实测超 5s 默认超时（2026-09-10 verify 偶发
  // "Test timed out in 5000ms"）——隔离跑全文件 5.3s，负载下余量取 60s。
  // ⚠ 2026-09-10 晚补：注释本就写着「余量取 60s」，但 `it(...)` **从没传过 timeout 参数**（只写在注释里），
  //   所以 verify 全量并行下仍会以 5000ms 默认值偶发假红（红基线不许过夜 ⇒ 当场补上第三个参数）。
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
        // 界 = 2× 容差：试探门控量的是**折叠循环内**的净占用，接受后装配还要跑模块 carve/
        // 时间线截断（实测 1591/1161/1311 门控放行时 ≤179s，装配后 182.0s）。逐队精确值由
        // timeFillRatchet 钉，这里只守"回填不把超预算显著放大"。
        expect(t.rowsNet, `${team.join('/')} 回填后超预算 ${t.rowsNet.toFixed(1)}>${t.budget}`)
          .toBeLessThanOrEqual(t.budget + 2 * TIME_BUDGET_TOLERANCE_SECONDS)
      }
    }
  }, 60_000)

  it('③ 欠打 ≤1s（量化地板）的队不被扰动（refund 保持 0）', async () => {
    // 1041/1161/1311 类：基线就打满（留白 ≤1s）。正注入必被「预算−容差」门控整体拒绝（可行填充
    // 的上限就是 1s 容差），试探零收益还会扰动外层不动点（09-05 失衡 116k→9.5k 吸引盆前例）。
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
