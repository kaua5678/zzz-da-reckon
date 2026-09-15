/**
 * 回避支援（Evade Assist）行生效测试。
 *
 * 口径单源：`@fact engine:time/回避支援`（`src/core/resource/helpers.ts#buildExecutions`）。
 * 用户 2026-09-15：「弹刀和回避支援本身都是对黄光的一次交互…一个角色要么只能弹刀，要么只能回避」
 * 「只是前面弹刀的1.16秒换成了1.16秒的时停效果，纯亏时间」
 * ⇒ 回避行**占 1.166s 必要前台、零伤害零失衡**，且与轻弹刀行**互斥**（判据 = 该角色有无招架支援）。
 *
 * 同时钉住 1631/1641 的招架命名修复：它们的 catalog `en` 名不带 `#N`（zh 侧写「·轻招架/·重招架/·连续招架」），
 * 原 `findDefensiveAssist` 要求 `en` 含 `#1` ⇒ 返回 null ⇒ **这两个角色从来没产过轻弹刀行**
 * （白丢每次交互 1.166s 与 366 失衡）。修复 = 优先 `#1`，无 `#N` 约定时按 id 升序取第一条。
 *
 * 判分纪律：本文件每条都是「删掉对应生产代码就会红」的生效测试，不是快照。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { EVADE_ASSIST_ACTION_TIME_SECONDS, EVADE_ASSIST_MOVE_ID } from '@/data/resourceDefaults'

interface AssistRows {
  evade?: any
  lightParry?: any
  followUp?: any
}

/** 单人队（槽0 = 被测角色），显式给黄光交互次数，取装配后的执行行 */
async function runAssistRows(agentId: string, parryCount: number): Promise<AssistRows> {
  const { catalog, config } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  config.setAgent(0, agentId)
  config.setParryCount(0, parryCount)
  const calc = useResourceCalc()
  const rr = calc.resourceResult.value
  expect(rr).toBeTruthy()
  const rows: any[] = (rr!.characters[0] as any)?.executions ?? []
  return {
    evade: rows.find(e => e.moveId === EVADE_ASSIST_MOVE_ID),
    // 轻弹刀行 moveId 逐角色不同，且 `enrichExecutionPlan` 会把 moveName **换成 catalog 真名**
    // （如 1401 → 「招架支援：对抗防守 #1」），所以只能按 catalog 命名族的「招架支援」定位；
    // 而合成行 `evade_assist` 查不到倍率表 ⇒ moveName 保持引擎写入值，按 moveId 定位。
    lightParry: rows.find(e => (e.moveName ?? '').includes('招架支援')),
    followUp: rows.find(e => (e.moveName ?? '').includes('支援突击')),
  }
}

describe('回避支援行（无招架支援角色的黄光交互）', () => {
  it('回避型：产 1.166s 必要前台、零伤害零失衡，次数 = 黄光交互数', async () => {
    // 1241 朱鸢 = 回避型（原文「发动[回避支援]后，点按[普通攻击]发动 支援突击：自卫还击」）
    const { evade, lightParry, followUp } = await runAssistRows('1241', 6)
    expect(evade).toBeTruthy()
    expect(evade.count).toBe(6)
    expect(evade.actionTime).toBeCloseTo(EVADE_ASSIST_ACTION_TIME_SECONDS, 6)
    expect(evade.totalTime).toBeCloseTo(6 * EVADE_ASSIST_ACTION_TIME_SECONDS, 6)
    expect(evade.category).toBe('assist')
    expect(evade.timeBucket).toBe('necessary')
    // 「纯亏时间」：不产伤害，也不产失衡（enrich 查不到该合成 moveId 的倍率行 ⇒ 保持 0）
    expect(evade.damageMultiplier ?? 0).toBe(0)
    expect(evade.daze ?? 0).toBe(0)
    // 互斥：有回避行就不得再有轻弹刀行；支援突击照常（自卫还击本体伤害行）
    expect(lightParry).toBeUndefined()
    expect(followUp).toBeTruthy()
  })

  it('招架型：产轻弹刀行、不产回避行（两者互斥）', async () => {
    // 1401 爱丽丝 = 招架型（catalog 有 Defensive Assist: ... #1）
    const { evade, lightParry } = await runAssistRows('1401', 6)
    expect(lightParry).toBeTruthy()
    expect(lightParry.count).toBe(6)
    expect(evade).toBeUndefined()
  })

  it('1631/1641 招架命名修复：现在产轻弹刀行（此前恒缺），且不被误判成回避型', async () => {
    for (const agentId of ['1631', '1641']) {
      const { lightParry, evade } = await runAssistRows(agentId, 6)
      expect(lightParry, `${agentId} 应产轻弹刀行（en 名无 #N 约定的回退）`).toBeTruthy()
      expect(lightParry.count, `${agentId} 轻弹刀次数`).toBe(6)
      // 轻招架段 = id 升序第一条（1631015 / 1641015），实测 1.166s
      expect(lightParry.actionTime, `${agentId} 轻招架动作时间`).toBeCloseTo(1.166, 6)
      expect(evade, `${agentId} 是招架型，不得产回避行`).toBeUndefined()
    }
  })

  it('真斗 1441：有招架 moveId 但 actionTime=0 ⇒ 不被误判成回避型（既存数据缺口另案）', async () => {
    const { evade } = await runAssistRows('1441', 6)
    expect(evade).toBeUndefined()
  })

  it('交互数 = 0 ⇒ 不产任何黄光交互行', async () => {
    const { evade, lightParry } = await runAssistRows('1241', 0)
    expect(evade).toBeUndefined()
    expect(lightParry).toBeUndefined()
  })
})
