import { describe, expect, it } from 'vitest'
import { moveActionTimesOf, findMoveById } from '@/data/moveTableQueries'
import { cfgMoveActionTime } from '@/utils/moveActionTimeCfg'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

/**
 * CC-409：招式 actionTime 单一来源 = catalog。
 * 引擎在 buildCharConfig 预填 cfg.moveActionTimes，模块经 cfgMoveActionTime 读；模块里不再有 `X_ACTION_TIME = 1.55` 常量。
 * 反空洞：真引擎跑出的模块行 actionTime 必须等于 catalog 该招式的 actionTime（而不是任何写死的数字）。
 */
describe('CC-409 招式 actionTime 来自 catalog（cfg.moveActionTimes）', () => {
  it('moveActionTimesOf 只收 >0 的 actionTime；cfgMoveActionTime 缺表为 0', () => {
    const skills = {
      categories: [
        { moves: [{ id: 'a', actionTime: 1.5 }, { id: 'b', actionTime: 0 }, { id: 'c', actionTime: null }, { id: 'd' }] },
        { moves: [{ id: 'e', actionTime: 0.25 }] },
      ],
    }
    expect(moveActionTimesOf(skills as any)).toEqual({ a: 1.5, e: 0.25 })
    expect(cfgMoveActionTime({ moveActionTimes: { a: 1.5 } }, 'a')).toBe(1.5)
    expect(cfgMoveActionTime({ moveActionTimes: { a: 1.5 } }, 'zz')).toBe(0)
    expect(cfgMoveActionTime({}, 'a')).toBe(0)
    expect(cfgMoveActionTime(undefined, 'a')).toBe(0)
  })

  // 6 个 CC-409 迁移模块各挑一条由模块自己 push 的行（这些行的 actionTime 原先是模块常量）
  const CASES: Array<{ agentId: string; moveId: string; cinema?: number }> = [
    { agentId: '1191', moveId: '1191011' }, // 艾莲 横扫（0 命 EX = 横扫+鲨卷风）
    { agentId: '1191', moveId: '1191012' }, // 艾莲 鲨卷风
    { agentId: '1321', moveId: '1321006' }, // 伊芙琳 绞勒式·I型
    { agentId: '1201', moveId: '1201024' }, // 悠真 残心·散华（随终结技）
    { agentId: '1461', moveId: '1461006' }, // 席德 落华·重戮
    { agentId: '1441', moveId: '1441013' }, // 震刀 归烬 #1
    { agentId: '1341', moveId: '1341008', cinema: 0 }, // 朝 最终裁决
  ]

  it('真引擎：迁移模块的行 actionTime === catalog actionTime（至少 4 条行真实出现）', async () => {
    let seen = 0
    for (const c of CASES) {
      const { catalog } = await setupHarness([
        { agentId: c.agentId, cinemaLevel: c.cinema ?? 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
        '',
        '',
      ])
      const calc = useResourceCalc()
      const ch = calc.resourceResult.value!.characters.find(x => x.agentId === c.agentId)!
      const row = ch.executions.find(e => e.moveId === c.moveId)
      if (!row) continue
      const expected = findMoveById(catalog.getAgentSkills(c.agentId), c.moveId)?.actionTime ?? -1
      expect(expected, `${c.agentId}/${c.moveId} catalog actionTime`).toBeGreaterThan(0)
      expect(row.actionTime, `${c.agentId}/${c.moveId}`).toBeCloseTo(expected, 9)
      expect(row.totalTime, `${c.agentId}/${c.moveId} totalTime`).toBeCloseTo(row.count * expected, 6)
      seen++
    }
    expect(seen).toBeGreaterThanOrEqual(4)
  })
})
