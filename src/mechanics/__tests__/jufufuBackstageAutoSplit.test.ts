/**
 * **橘福福虎釜震煞 = 后台连携自动攻击 ⇒ 按失衡时间占比，不按手捏认领**（T179，用户口径 2026-10-16）。
 *
 * ## 用户口径（逐字）
 *
 * > 「我说的自动是**橘福福后台连携**，扳机后台攻击，章鱼触手cd，卢西娅后台追击」
 * > 「**这个是通用逻辑，我认为自动攻击无需手捏计数，直接全局均匀计数，哪些吃易伤哪些打失衡就有了**」
 *
 * ## 修前缺陷
 *
 * 虎釜次数 = `floor(威风总量 / 100)`，而威风来自**虎威后台自动攻击**
 * （`floor(后场时间 / 4s)`，模块自述「后台每 4 秒 1 次（用户确认）」）⇒ **纯自动**；
 * 但它**未声明** `autoSplitByStun` ⇒ 手捏块把它的易伤归属切成任意形状（实测 `c=2 吃1.5 + c=22 吃1.0`），
 * 而它本该按**失衡时间占比**统一拆（与猫又/扳机/蕾米埃尔/伊德海莉同款通用机制）。
 *
 * ## 本文件锁什么
 *
 * ① 虎釜行带 `autoSplitByStun`；
 * ② **行为锁**：手捏虎釜块**不再把易伤切成「少数几次满易伤」**——轴内份数须与
 *    失衡时间占比一致量级（修前是 `c=2`，那是「块数×窗数」而非占比）；
 * ③ 反空洞：虎釜行必须存在、且**确实被拆成两段**（占比非 0/1）。
 *
 * ## ⚠ 刻意**不**锁「次数恒定」
 *
 * 虎釜**次数**仍会随轴块变化（实测 26↔24）——但那是**合法的时间账效应**：
 * 轴块占前台时间 ⇒ 后场时间 112.1→110.1s ⇒ 威风减少。实测三配置分离：
 * ①不放（轴不生效）次数 26 / ②放别槽块（轴生效）次数 26 / ③放别槽块+虎釜×1 次数 24。
 * ⇒ 次数变化**不是**本卡修的易伤归属问题，故**不**在此锁死（锁了会得到一条假判据）。
 *
 * ## 负控（删掉被锁行为后本测试确实变红）
 *
 * 去掉虎釜行的 `autoSplitByStun: true` ⇒ ② 红（易伤被切成 `c=2`）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'

const JUFUFU = '1391'
const TIGER_CHAIN = '1391013'

function teamChar(slot: number, agentId: string, overrides: Record<string, number> = {}) {
  return {
    slot, agentId, cinemaLevel: 0, wEngineId: '', wEngineModLevel: 1,
    driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
    parryCount: 6, blockCount: 0, dodgeCounterCount: 10, quickAssistCount: 3, chainCountPerStun: 1,
    basicAttackTimeWeight: 1, ...overrides,
  }
}

describe('T179 橘福福虎釜震煞：后台连携自动行，按失衡占比（用户口径「自动攻击无需手捏计数」）', () => {
  beforeEach(() => { newPinia(); mockStaticFetch() })

  it('① 虎釜行带 autoSplitByStun', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    const calc = useResourceCalc()
    config.team[0] = teamChar(0, JUFUFU) as never
    config.team[1] = teamChar(1, '1251') as never
    config.team[2] = teamChar(2, '1271') as never
    const row = calc.resourceResult.value!.characters.find(c => c.slot === 0)!
      .executions.find(e => e.moveId === TIGER_CHAIN)
    expect(row, '必须有虎釜执行行（否则本条零覆盖）').toBeTruthy()
    expect(row!.autoSplitByStun, '★ 虎釜震煞必须声明 autoSplitByStun（后台自动行通用机制）').toBe(true)
  })

  it('② 行为锁：手捏虎釜块**不**把易伤切成「少数几次满易伤」（且反空洞：确实按占比拆两段）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    const calc = useResourceCalc()
    config.team[0] = teamChar(0, JUFUFU) as never
    config.team[1] = teamChar(1, '1251') as never
    config.team[2] = teamChar(2, '1271') as never
    config.useStunAxis = true
    config.enemy.stunCountLock = 2
    // 轴里放**别人**的块（保证轴生效）+ 虎釜块（模拟手捏）
    config.stunAxes = [{
      name: 'x', count: 2,
      actions: [
        { slot: 1, moveId: '1251015', count: 1 },
        { slot: 0, moveId: TIGER_CHAIN, count: 1 },
      ] as never,
      basicFillerSlot: 0,
    }]
    const rows = calc.damagePoolRows.value as unknown as { moveId?: string; count?: number; stunMult?: number }[]
    const segs = rows.filter(r => r.moveId === TIGER_CHAIN)
    expect(segs.length, '反空洞：虎釜必须真的存在（否则本条零覆盖）').toBeGreaterThan(0)
    expect(segs.length, '★ 必须拆成两段（轴内吃满 / 轴外不吃），而不是单段').toBe(2)
    const inAxis = segs.find(s => s.stunMult === 1.5)
    expect(inAxis, '★ 必须有一段吃满易伤（轴内段）').toBeTruthy()
    /**
     * ★ 核心断言：轴内份数**由失衡时间占比决定、不是由「捏了几个块」决定**。
     * 修前手捏×1 ⇒ 轴内份数恒 = 1×窗数 = **2**（块数语义）；
     * 修后按占比 ⇒ 份数随总次数缩放（实测 c=4，总 24 次）。
     */
    expect(inAxis!.count, '★ 轴内份数必须按占比（修前是「块数×窗数」= 2）').toBeGreaterThan(2)
    // 另一段必须不吃易伤
    expect(segs.some(s => s.stunMult === 1), '必须有轴外段（不吃易伤）').toBe(true)
  })
})
