/**
 * 青衣（1251）影画4·稳态电弧屏障回能差分断言（W17）。
 *
 * 背景：档案段 1251 记录「影画4 护盾刷新回 5 能量 / 10s」有生产写入方与消费者，
 * 但 `grep -rn qingyiC4Energy src --include=*.test.ts` 零命中——即该机制**没有生效测试**，
 * 改了 `C4_ENERGY_PER_TRIGGER` / 写入条件都不会变红。本文件补上这条「会对错误变红」的断言。
 *
 * 链路（三处符号）：
 * - 写入方 `src/mechanics/agents/qingyi.ts#buildQingyiCharConfig`：
 *     `cfg.qingyiC4EnergyPerTrigger = cinemaLevel >= 4 ? C4_ENERGY_PER_TRIGGER : 0`（C4 = 5）
 *     `cfg.qingyiC4TriggerInterval = C4_TRIGGER_INTERVAL`（10s）
 * - 消费者 `src/mechanics/agents/qingyi.ts#bonusEnergy`（模块能力，CC-14a）：
 *     `value = floor(totalTime / interval) × perTrigger`，经 `calcEnergySource` 计入 `e0`/`total`
 * - 展示 `src/components/ResourceResultCard.vue`：`result.energySource.bonusEntries`
 *
 * 断言面用 `energySource.bonusEntries` 里的 `qingyiC4Energy` 项（结果对象只读），`totalTime`
 * 一律从结果对象 `TeamResourceResult.totalTime` 读取，**不写死 180**。
 *
 * 为什么不锁「C4 合计 − C3 合计 == qingyiC4Energy」：实测该差值 = 89.04 而非 90——C4 的
 * 额外能量把 `exSpecialCount` 从 6 顶到 8，多打的强特改变了行级 `skillRegen`（97.422 → 96.462，
 * −0.96），故合计差受**其它 C4 派生效应**扰动。按卡面口径只断言 ①②（分项本身），
 * 不做会被无关效应污染的合计断言。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

/** 同一队伍，仅青衣命座不同（其余槽位/配置逐位一致） */
function team(cinemaLevel: number) {
  return [
    { agentId: '1251', cinemaLevel, parryCount: 10, defAssistCount: 20 },
    { agentId: '1391' },
    { agentId: '1241', wEngineId: '14124' },
  ]
}

/** 跑一条队伍并取青衣那行结果 */
async function qingyiResult(cinemaLevel: number) {
  await setupHarness(team(cinemaLevel))
  const calc = useResourceCalc()
  const result = calc.resourceResult.value!
  const qingyi = result.characters.find(c => c.agentId === '1251')!
  return { result, qingyi }
}

describe('青衣（1251）影画4·稳态电弧屏障回能（护盾刷新 5/10s）', () => {
  it('C3 该项为 0；C4 = floor(totalTime / 10) × 5', async () => {
    const c3 = await qingyiResult(3)
    const c4 = await qingyiResult(4)

    // ① C3（未解锁影画4）该项为 0 —— 写入方的 cinemaLevel >= 4 门控
    expect(c3.qingyi.energySource.bonusEntries.find(e => e.key === 'qingyiC4Energy')?.value ?? 0).toBe(0)

    // ② C4 → floor(totalTime / interval) × perTrigger；totalTime 从结果对象读（不写死 180）
    const totalTime = c4.result.totalTime
    const expected = Math.floor(totalTime / 10) * 5
    expect(c4.qingyi.energySource.bonusEntries.find(e => e.key === 'qingyiC4Energy')?.value ?? 0).toBe(expected)
  })
})
