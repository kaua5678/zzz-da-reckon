/**
 * 边际均衡器·集成测试：真实引擎上验证 set-read-restore 包装器接线正确、
 * 单调不劣化、总权重守恒、支援槽不动。
 *
 * 注：默认敌人（无 Boss 抗性差）下等权常已是局部最优，均衡器正确识别为「无需转移」；
 * 转移行为由 timeWeightBalancer.test.ts 的纯算法测试（假 evaluate 凹函数）覆盖。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { optimizeTeamTimeWeights } from '@/composables/teamTimeline'

describe('optimizeTeamTimeWeights（真实引擎接线）', () => {
  it('猫又+格莉丝+丽娜：均衡不劣于等权、总权重守恒、支援槽保持 0', async () => {
    await setupHarness([{ agentId: '1021' }, { agentId: '1181' }, { agentId: '1211' }])
    const config = useConfigStore()
    const calc = useResourceCalc()

    for (let s = 0; s < 3; s++) config.setBasicAttackTimeWeight(s, s === 2 ? 0 : 1)
    const base = calc.teamTotalDamage.value
    expect(base).toBeGreaterThan(0)

    const r = optimizeTeamTimeWeights(calc, config, { maxIter: 4 })

    expect(r.balanced).toBe(true)
    // 单调守卫：均衡结果绝不劣于等权
    expect(r.damage).toBeGreaterThanOrEqual(base - 1e-6)
    // 支援槽（丽娜=1211）平A权重恒 0
    expect(r.weights[2]).toBe(0)
    // 总权重守恒（猫又+格莉丝 初始 1+1=2）
    expect(r.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(2, 5)
    // 写回 store 与返回一致
    for (let s = 0; s < 3; s++) {
      expect(config.team[s].basicAttackTimeWeight).toBeCloseTo(r.weights[s], 5)
    }
  })

  it('单可调槽（双支援）不均衡，直接返回原权重', async () => {
    await setupHarness([{ agentId: '1021' }, { agentId: '1211' }, { agentId: '1151' }])
    const config = useConfigStore()
    const calc = useResourceCalc()
    for (let s = 0; s < 3; s++) config.setBasicAttackTimeWeight(s, s === 0 ? 1 : 0)
    const r = optimizeTeamTimeWeights(calc, config)
    expect(r.balanced).toBe(false)
    expect(r.weights).toEqual([1, 0, 0])
  })
})
