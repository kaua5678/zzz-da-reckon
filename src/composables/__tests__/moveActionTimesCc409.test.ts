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

  // CC-409 迁移模块各挑一条由模块自己 push 的行（这些行的 actionTime 原先是模块常量）
  // `catalogMoveId`：合成行（moveId ≠ 真实招式）用它指定行时长实际读的那条 catalog 招式。
  const CASES: Array<{ agentId: string; moveId: string; catalogMoveId?: string; cinema?: number }> = [
    { agentId: '1191', moveId: '1191011' }, // 艾莲 横扫（0 命 EX = 横扫+鲨卷风）
    { agentId: '1191', moveId: '1191012' }, // 艾莲 鲨卷风
    { agentId: '1321', moveId: '1321006' }, // 伊芙琳 绞勒式·I型
    { agentId: '1201', moveId: '1201024' }, // 悠真 残心·散华（随终结技）
    { agentId: '1461', moveId: '1461006' }, // 席德 落华·重戮
    { agentId: '1441', moveId: '1441013' }, // 震刀 归烬 #1
    { agentId: '1341', moveId: '1341008', cinema: 0 }, // 朝 最终裁决
    // T8（CC-409 续）：miyabi / yixuan / anbyZero / hugo 的迁移行
    { agentId: '1091', moveId: '1091029', cinema: 6 }, // 雅 霜月 #3（3.434s）
    { agentId: '1371', moveId: '1371026', cinema: 4 }, // 仪玄 墨烬影消（0.3s，轴外凝云链；C4 留 1 轮凝云保证行出现）
    { agentId: '1381', moveId: '1381023' }, // 零号·安比 苍光·临界（0.867s）
    { agentId: '1291', moveId: '1291_ex_verdict_final', catalogMoveId: '1291010' }, // 雨果 强特终结合成行（时长读 1291010 = 1.805s）
  ]

  it('真引擎：迁移模块的行 actionTime === catalog actionTime（至少 4 条行真实出现）', async () => {
    let seen = 0
    const seenAgents = new Set<string>()
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
      const expected = findMoveById(catalog.getAgentSkills(c.agentId), c.catalogMoveId ?? c.moveId)?.actionTime ?? -1
      expect(expected, `${c.agentId}/${c.moveId} catalog actionTime`).toBeGreaterThan(0)
      expect(row.actionTime, `${c.agentId}/${c.moveId}`).toBeCloseTo(expected, 9)
      expect(row.totalTime, `${c.agentId}/${c.moveId} totalTime`).toBeCloseTo(row.count * expected, 6)
      seen++
      seenAgents.add(c.agentId)
    }
    expect(seen).toBeGreaterThanOrEqual(4)
    // T8 的四个迁移模块必须各有一条行真实出现（缺行 = 夹具失效，不许静默跳过）
    for (const id of ['1091', '1371', '1381', '1291']) {
      expect(seenAgents.has(id), `T8 模块 ${id} 的迁移行未出现`).toBe(true)
    }
  })
})
