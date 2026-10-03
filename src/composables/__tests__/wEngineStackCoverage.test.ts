/**
 * 音擎叠层覆盖率的自动回填（数据源 `src/data/wEngineStackCoverage.ts`，口径 @fact 在其头注释）。
 *
 * 核心语义（用户裁决 2026-10-01）：嵌合编译器叠层 = **能量扣除事件次数**——一段持续耗能只算
 * 1 次（无论秒数），每个固定能量段（爆炸/下砸/追加戳）各 1 次。引擎把多段耗能聚合成整数招，
 * 所以**行数/招式数 ≠ 事件数**，必须逐角色按耗能段结构折算。
 *
 * 防的回归形态（般岳 rageGainCoverage 同款）：滑块/折算改了，面板与伤害却不变 = 通道静默断。
 * 实测基准（180s 局；⚠ 下面这组数字是按「夹具支援/防护 weight=0」量的，而 harness 默认仍是每槽 1——
 * T11 把生产口径做成 opt-in `productionBasicWeights: true`；本文件断言的是「通道活着」而不是这些绝对值）：
 *   格莉丝主C独吞平A池 ⇒ 普E吃满覆盖 100；与异常队友(维丹队)分平A池(30.1s) ⇒ 强特12+普E8
 *   =20事件 ⇒ 覆盖 29.6%（+22.2 精通 vs 旧满层 +75）；
 *   柏妮思(维丹队) ⇒ 单/双喷各5.3次×2事件=21事件 ⇒ 覆盖 31.4%（+23.6 精通）；
 *   柳 C6 追加戳 ⇒ 事件数 = exSpecialCount×(1+extraThrusts)，远高于招式数（C0 41.5% / C6 53.3%）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { stackEnergyEvents, stacksToCoverage } from '@/data/wEngineStackCoverage'
import type { SkillExecution } from '@/types/resource'

const EFFECT_ID = 'effect_wiki_214_self_ap' // 嵌合编译器 异常精通 25×3层/8s
const row = (moveId: string, count: number): SkillExecution =>
  ({ moveId, moveName: moveId, category: 'special', count, actionTime: 1, totalTime: count }) as unknown as SkillExecution

describe('音擎叠层覆盖率自动回填（嵌合编译器 14118，能耗事件口径）', () => {
  it('逐角色能耗事件折算：柳 / 柏妮思 / 格莉丝 / 通用回退', () => {
    // 柳：exSpecialCount=4，追加突刺行 count=4（extraThrusts=1）⇒ 4×(1+1)=8 事件
    expect(stackEnergyEvents(EFFECT_ID, {
      agentId: '1221', exSpecialCount: 4, executions: [row('1221022', 4)],
    })).toBe(8)
    // 柳 C0（无追加突刺行）⇒ 4×1 = 4
    expect(stackEnergyEvents(EFFECT_ID, { agentId: '1221', exSpecialCount: 4, executions: [] })).toBe(4)
    // 柳 C6 追加 4 戳（行 count=16）⇒ 4×(1+4)=20
    expect(stackEnergyEvents(EFFECT_ID, {
      agentId: '1221', exSpecialCount: 4, executions: [row('1221022', 16)],
    })).toBe(20)
    // 柏妮思：单喷持续行 2 次 + 双喷持续行 2 次（各 2 事件/施放）⇒ 2×(2+2)=8
    expect(stackEnergyEvents(EFFECT_ID, {
      agentId: '1171', exSpecialCount: 4, executions: [row('1171010', 2), row('1171012', 2)],
    })).toBe(8)
    // 格莉丝：普E 8 + 强特 2 ⇒ 10
    expect(stackEnergyEvents(EFFECT_ID, {
      agentId: '1181', exSpecialCount: 2, executions: [row('1181005', 8), row('1181006', 2)],
    })).toBe(10)
    // 通用回退（未登记角色）：= exSpecialCount
    expect(stackEnergyEvents(EFFECT_ID, { agentId: '1241', exSpecialCount: 5, executions: [] })).toBe(5)
    // 未登记效果 ⇒ null
    expect(stackEnergyEvents('effect_unknown', { agentId: '1181', exSpecialCount: 1, executions: [] })).toBeNull()
  })

  it('时间加权：稀疏 ⇒ <100；频繁 ⇒ 封顶 100；非法 ⇒ null 不折算', () => {
    expect(stacksToCoverage(4, 8, 180, 3)).toBeCloseTo(5.93, 1)   // 4×8/180/3
    expect(stacksToCoverage(24, 8, 180, 3)).toBeCloseTo(35.56, 1) // 格莉丝实测 24 事件
    expect(stacksToCoverage(100, 8, 90, 3)).toBe(100)
    expect(stacksToCoverage(4, 8, 0, 3)).toBeNull()
  })

  it('通道活着：格莉丝主C回填后异常精通面板显著低于满层默认，覆盖率落时间加权口径', async () => {
    // 格莉丝主C + 双异常队友（维琳娜/月城柳，weight 1 与她分平A池，她分不全 ⇒ 普E受限、覆盖<100）。
    // 不用支援队友：夹具按生产口径支援 weight=0，此时格莉丝独吞平A池普E吃满覆盖 100（测不出「<60」）。
    const { config } = await setupHarness([{ agentId: '1181' }, { agentId: '1561' }, { agentId: '1221' }])
    config.team[0].wEngineId = '14118'
    const calc = useResourceCalc()
    void calc.panels.value // 触发回填链
    const stored = config.getWEngineEffectCoverage(EFFECT_ID)
    // 与异常队友分平A池 ⇒ 普E受限 ⇒ 覆盖显著低于旧行为恒 100
    expect(stored).toBeLessThan(60)
    expect(stored).toBeGreaterThan(0)
    const panel = calc.panels.value.find(p => (p as { slot?: number }).slot === 0)
    const ap = (panel as { anomalyProficiency?: number } | undefined)?.anomalyProficiency ?? 0
    // 满层 +75 ⇒ 基础 90 + 75 = 165；回填后应明显低于 165
    expect(ap).toBeLessThan(160)
  })

  it('柳(C6 追加戳)能耗事件数高于招式数 ⇒ 覆盖率高于纯招式数口径', async () => {
    const { config } = await setupHarness([{ agentId: '1221', cinemaLevel: 6 }, { agentId: '1411' }, { agentId: '1211' }])
    config.team[0].wEngineId = '14118'
    const calc = useResourceCalc()
    void calc.panels.value
    const stored = config.getWEngineEffectCoverage(EFFECT_ID)
    // C6 追加戳 ⇒ 事件数 = exCount×(1+追加)，显著高于 exCount ⇒ 覆盖应明显高于「4×8/180/3=5.9%」
    expect(stored).toBeGreaterThan(5.93)
  })

  it('手调优先：用户拖过滑块后自动回填不再覆盖该效果', async () => {
    const { config } = await setupHarness([{ agentId: '1181' }, { agentId: '1411' }, { agentId: '1211' }])
    config.team[0].wEngineId = '14118'
    const configStore = useConfigStore()
    configStore.setWEngineEffectCoverage(EFFECT_ID, 80)
    const calc = useResourceCalc()
    void calc.panels.value
    expect(configStore.getWEngineEffectCoverage(EFFECT_ID)).toBe(80)
  })

  it('未带该音擎的队伍不受影响（无回填对象）', async () => {
    const { config } = await setupHarness([{ agentId: '1181' }, { agentId: '1411' }, { agentId: '1211' }])
    const calc = useResourceCalc()
    void calc.panels.value
    expect(config.getWEngineEffectCoverage(EFFECT_ID)).toBe(100)
  })
})
