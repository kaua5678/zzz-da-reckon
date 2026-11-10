/**
 * 边际填充搜索（2026-11-10）生效测试。
 *
 * 用户口径：「生产一点点消耗一点点」；并且**即便超时也不触发动作切换**（切换会反向砍一批招式、
 * 失衡次数也掉，宁可留白也不要这种"进步"）；临界填充必须自动停在超时之前。
 *
 * 钉住三件事：
 * ① 有富余的队真的被填：留白下降、代价为零（不截断、不超预算、失衡次数不降）；
 * ② 会掉失衡次数/砍招式的队**一律不填**（护栏生效）；
 * ③ 只吃「留白 > 1s」的队（其余队零成本，不进入搜索）。
 */
import { describe, it, expect } from 'vitest'
import { setupHarness } from '@/test/harness'
import { setCalcOutputMemoEnabled, useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { buildTeamTimeSummary } from '@/composables/teamTimeSummary'

async function measure(team: string[]) {
  await setupHarness(['', '', ''])
  const config = useConfigStore()
  for (let i = 0; i < 3; i++) config.setAgent(i, team[i])
  setCalcOutputMemoEnabled(false)
  const calc = useResourceCalc()
  const rr = calc.resourceResult.value!
  setCalcOutputMemoEnabled(true)
  const t = buildTeamTimeSummary({
    rr, battleTime: rr.totalTime,
    invincibleTime: config.enemy.invincibleTime ?? 0,
    nameOf: (_a, slot) => '槽' + slot,
  })
  return { rr, calc, slack: t.slack, refund: t.refund ?? 0, stun: calc.stunPoolResult.value?.stunCount ?? 0 }
}

describe('边际填充搜索', () => {
  it('① 有富余的队被填：留白下降且不砍招式/不超预算/失衡次数不降', async () => {
    // auto-1051-1481-1451：基线留白 4.5s（2026-11-10 HEAD 实测）→ 填充后 2.60s，refund 0.69s
    const a = await measure(['1051', '1481', '1451'])
    expect(a.slack, '留白应收窄（基线 4.5s）').toBeLessThan(3.0)
    expect(a.refund, '必须真的注入了填充量').toBeGreaterThan(0)
    expect(a.stun, '失衡次数不许掉').toBeGreaterThanOrEqual(3)
    expect(Math.max(0, -a.slack), '不许超预算').toBeLessThan(1e-3)
    expect(a.rr.overflowSeconds ?? 0, '不许靠截断换留白').toBeLessThan(1e-3)
  }, 120_000)

  it('② 会掉失衡次数的队一律不填（护栏生效）', async () => {
    // 挽昼+洛克茜+知更鸟：任何填充档都会把失衡 3→2 并砍 10s 以上招式 ⇒ 必须原样留白
    const b = await measure(['1601', '1621', '1661'])
    expect(b.stun, '失衡次数必须保持 3（填充会把池压到 2）').toBe(3)
    expect(b.slack, '体检不过就必须原样留白（宁可留白，不退步）').toBeGreaterThan(10)
    expect(b.refund, '被拒时不许留下填充量').toBe(0)
  }, 120_000)
})
