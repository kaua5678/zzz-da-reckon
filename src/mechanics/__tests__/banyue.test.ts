import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computeBanyueRageCycle, computeBanyueMingwangStacks, computeBanyueMingwangBlocks, computeBanyueInteractionTopUp } from '@/mechanics/agents/banyue'

describe('computeBanyueRageCycle（嗔火→怒相固定点，用户口径）', () => {
  it('默认（闪反10/招架6/金身20，地动山摇连段0）：怒相 4 次，怒相外 9 组全打论道连段', () => {
    const c = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0)
    expect(c.rageCount).toBe(4)
    expect(c.comboOutCount).toBe(9) // floor(闪能收入/60) 自动打满
    expect(c.furyTotal).toBeCloseTo(115 + 184 + 9 * 60 * 0.5, 1) // 569
    expect(c.lunDaoRageCount).toBe(8) // 4怒相 × 2连段（固定论道→狮子吼·怒）
    expect(c.shiZiHouNuCount).toBe(8)
    expect(c.lunDaoOutCount).toBe(9) // 全打论道连段
    expect(c.shiZiHouNuOutCount).toBe(9)
    expect(c.diDongComboCount).toBe(0)
    expect(c.diDongOutCount).toBe(0)
    expect(c.shanYaoNuOutCount).toBe(0)
    expect(c.shanYaoRageCount).toBe(0)
    expect(c.swayExCount).toBe(16)
  })

  it('地动山摇连段 2 组：怒相外 9 组里 2 组打地动→山摇·怒，其余 7 组打论道连段', () => {
    const c = computeBanyueRageCycle(10, 6, 20, 0, 2, 0, 0, 0)
    expect(c.comboOutCount).toBe(9)
    expect(c.diDongComboCount).toBe(2)
    expect(c.diDongOutCount).toBe(2)
    expect(c.shanYaoNuOutCount).toBe(2)
    expect(c.lunDaoOutCount).toBe(7)
    expect(c.shiZiHouNuOutCount).toBe(7)
  })

  it('地动山摇连段超过自动连段总数：封顶于总数', () => {
    const c = computeBanyueRageCycle(10, 6, 20, 0, 99, 0, 0, 0)
    expect(c.diDongComboCount).toBe(c.comboOutCount)
    expect(c.lunDaoOutCount).toBe(0)
    expect(c.shiZiHouNuOutCount).toBe(0)
  })

  it('影画2：山威强特额外回 5 闪能 → 闪能收入更高', () => {
    const c0 = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0)
    const c2 = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 2)
    expect(c2.flashIncome).toBeGreaterThan(c0.flashIncome)
  })

  it('无闪反/招架/金身时：自动连段收敛（rage=2、连段 8 组、嗔火 355）', () => {
    const c = computeBanyueRageCycle(0, 0, 0, 0, 0, 0, 0, 0)
    expect(c.rageCount).toBe(2)
    expect(c.comboOutCount).toBe(8)
    expect(c.furyTotal).toBeCloseTo(115 + 8 * 60 * 0.5, 1) // 355
    expect(c.swayExCount).toBe(8)
  })

  it('怒相内地动山摇连段（轴内捏 banyue-combo-didong）：论道组数让位、山威总额守恒', () => {
    // 4 怒相 × 2 组 = 8 组配额；1 组换地动→山摇·怒 → 论道组 7、地动组 1
    const c = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0, 1)
    expect(c.rageDiDongComboCount).toBe(1)
    expect(c.diDongRageCount).toBe(1)
    expect(c.shanYaoNuRageCount).toBe(1)
    expect(c.lunDaoRageCount).toBe(7)
    expect(c.shiZiHouNuCount).toBe(7)
    // 山威总额守恒：怒相内 4 强特/怒相（论道+狮吼怒×7 + 地动+山摇·怒×1 = 16 = 4×4）
    expect(c.lunDaoRageCount + c.shiZiHouNuCount + c.diDongRageCount + c.shanYaoNuRageCount).toBe(c.swayExCount)
    expect(c.shanYaoRageCount).toBe(0)
    // 怒相外连段不受影响（怒相外滑块仍 0）
    expect(c.comboOutCount).toBe(9)
    expect(c.diDongComboCount).toBe(0)
  })

  it('怒相内地动山摇组数超过配额：封顶于 2×怒相次数，论道组归 0', () => {
    const c = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0, 99)
    expect(c.rageDiDongComboCount).toBe(8) // 4怒相 × 2组
    expect(c.diDongRageCount).toBe(8)
    expect(c.shanYaoNuRageCount).toBe(8)
    expect(c.lunDaoRageCount).toBe(0)
    expect(c.shiZiHouNuCount).toBe(0)
    expect(c.diDongRageCount + c.shanYaoNuRageCount).toBe(c.swayExCount)
  })

  it('失衡外连段末尾后摇：默认 = 怒相外连段组数，嘲讽逐次取消、按两类连段占比拆分', () => {
    // 默认（闪反10/招架6/金身20）：怒相外 9 组全打论道连段 → 后摇 9 次
    const c0 = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0)
    expect(c0.comboOutRecoveryCount).toBe(9)
    expect(c0.lunDaoRecoveryCount).toBe(9)
    expect(c0.diDongRecoveryCount).toBe(0)
    expect(c0.tauntCancelCount).toBe(0)
    // 嘲讽取消 3 次 → 剩 6 次（全论道连段 → 全算论道）
    const c3 = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0, 0, 3)
    expect(c3.comboOutRecoveryCount).toBe(6)
    expect(c3.lunDaoRecoveryCount).toBe(6)
    expect(c3.diDongRecoveryCount).toBe(0)
    expect(c3.tauntCancelCount).toBe(3)
    // 嘲讽超过连段总数 → 后摇 0
    const c99 = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0, 0, 99)
    expect(c99.comboOutRecoveryCount).toBe(0)
    expect(c99.lunDaoRecoveryCount).toBe(0)
    expect(c99.diDongRecoveryCount).toBe(0)
    // 地动山摇连段 2 组（怒相外 9 = 论道7 + 地动2）：嘲讽 2 次按占比取消 → 剩 7 = 论道 5 + 地动 2
    const cd = computeBanyueRageCycle(10, 6, 20, 0, 2, 0, 0, 0, 0, 2)
    expect(cd.comboOutCount).toBe(9)
    expect(cd.comboOutRecoveryCount).toBe(7)
    expect(cd.lunDaoRecoveryCount).toBe(5)
    expect(cd.diDongRecoveryCount).toBe(2)
    expect(cd.lunDaoRecoveryCount + cd.diDongRecoveryCount).toBe(7)
  })

  it('轴模式（axisActive）：失衡外后摇 = 闪能连段为主（怒相基本在失衡内打完），轴内耗闪能越多失衡外连段越少', () => {
    // 非轴模式：怒相内连段视为失衡内全取消，只计怒相外自动连段（9 组 → 后摇 9）
    const c0 = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0, 0, 0, false)
    expect(c0.axisInComboCount).toBe(0)
    expect(c0.outStunComboCount).toBe(9)
    expect(c0.comboOutRecoveryCount).toBe(9)
    // 轴模式：轴内普通强特耗 200 闪能 → 怒相外自动连段降到 6 组；怒相内 8 组（4 怒相×2）全被
    // 轴内捏块覆盖（banyue-combo×6 + banyue-combo-didong×2 = 8）→ 失衡外 = 6 + 未覆盖 0 = 6 组后摇
    const cA = computeBanyueRageCycle(10, 6, 20, 0, 0, 200, 6, 0, 2, 0, true)
    expect(cA.rageCount).toBe(4)
    expect(cA.comboOutCount).toBe(6)
    expect(cA.axisInComboCount).toBe(8)
    expect(cA.outStunComboCount).toBe(6)
    expect(cA.comboOutRecoveryCount).toBe(6)
    // 轴内耗闪能更多（400）→ 失衡外闪能连段降到 3 组（怒相组数不参与失衡外池）
    const cHigh = computeBanyueRageCycle(10, 6, 20, 0, 0, 400, 6, 0, 2, 0, true)
    expect(cHigh.comboOutCount).toBe(3)
    expect(cHigh.outStunComboCount).toBe(3)
    // 轴内未覆盖怒相组：只捏 6 组（4+2）→ 怒相内 8 组剩 2 组未覆盖（最多一组怒相）→ 失衡外 = 6 + 2 = 8
    const cUncov = computeBanyueRageCycle(10, 6, 20, 0, 0, 200, 4, 0, 2, 0, true)
    expect(cUncov.axisInComboCount).toBe(6)
    expect(cUncov.outStunComboCount).toBe(8)
    expect(cUncov.comboOutRecoveryCount).toBe(8)
    // 失衡外 6 组后摇用嘲讽取消 4 次 → 剩 2
    const cT = computeBanyueRageCycle(10, 6, 20, 0, 0, 200, 6, 0, 2, 4, true)
    expect(cT.outStunComboCount).toBe(6)
    expect(cT.comboOutRecoveryCount).toBe(2)
    expect(cT.tauntCancelCount).toBe(4)
  })

  it('怒相内地动山摇连段不耗闪能、不影响嗔火固定点', () => {
    const c0 = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0)
    const c1 = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 0, 0, 2)
    expect(c1.rageCount).toBe(c0.rageCount)
    expect(c1.flashIncome).toBe(c0.flashIncome)
    expect(c1.flashSpent).toBe(c0.flashSpent)
    expect(c1.furyTotal).toBeCloseTo(c0.furyTotal, 6)
  })
})

describe('computeBanyueRageCycle（轴内普通强特扣闪能 → 自动连段缩水，用户口径）', () => {
  it('轴内强特消耗 300 闪能：怒相 4 次，自动连段缩到 4 组', () => {
    const c = computeBanyueRageCycle(10, 6, 20, 0, 0, 300, 0, 0)
    expect(c.axisExSpend).toBe(300)
    expect(c.comboOutCount).toBe(4)
    // 最后一怒相窗口的付费强特闪能(300/4=75)不产有效嗔火，569 - 75×0.5 = 531.5
    expect(c.furyTotal).toBeCloseTo(115 + 184 + (300 + 4 * 60 - 300 / 4) * 0.5, 1) // 531.5
    expect(c.rageCount).toBe(4)
    expect(c.flashSpent).toBe(300 + 4 * 60)
  })

  it('轴内强特耗尽闪能（500）：自动连段缩到 1 组', () => {
    const c = computeBanyueRageCycle(10, 6, 20, 0, 0, 500, 0, 0)
    expect(c.comboOutCount).toBe(1)
    expect(c.rageCount).toBe(4)
    expect(c.flashSpent).toBe(500 + 1 * 60)
  })

  it('轴内连段块（免费·山威）不耗闪能、不影响怒相外自动连段', () => {
    const c = computeBanyueRageCycle(10, 6, 20, 0, 0, 0, 2, 0)
    expect(c.axisComboCount).toBe(2)
    expect(c.axisExSpend).toBe(0) // 连段块不计闪能
    expect(c.comboOutCount).toBe(9) // 怒相外自动连段不受轴内免费连段块影响
    expect(c.furyTotal).toBeCloseTo(115 + 184 + 9 * 60 * 0.5, 1)
  })

  it('轴内普通强特耗闪能并回复嗔火，免费连段块不回复', () => {
    // 300 闪能普通强特：嗔火 = 115 + 184 + (300 + 4组连段×60 - 300/4)×0.5 = 531.5
    const c = computeBanyueRageCycle(10, 6, 20, 0, 0, 300, 0, 0)
    expect(c.axisExSpend).toBe(300)
    expect(c.flashSpent).toBe(300 + 4 * 60)
    expect(c.furyTotal).toBeCloseTo(115 + 184 + (300 + 4 * 60 - 300 / 4) * 0.5, 1)
    // 同 300 但加 2 个免费连段块：连段块不产嗔火、不耗闪能，怒相外自动连段仍 4 组
    const c2 = computeBanyueRageCycle(10, 6, 20, 0, 0, 300, 2, 0)
    expect(c2.axisComboCount).toBe(2)
    expect(c2.comboOutCount).toBe(4)
    expect(c2.flashSpent).toBe(300 + 4 * 60)
    expect(c2.furyTotal).toBeCloseTo(115 + 184 + (300 + 4 * 60 - 300 / 4) * 0.5, 1)
  })
})

describe('computeBanyueInteractionTopUp（轴模式自动补齐，保底语义）', () => {
  const axis8 = { 'banyue-combo': 8 } // 4 窗口 × 2 组连段块 = 4 次怒相

  it('资源充足（默认交互次数）：不补齐', () => {
    const t = computeBanyueInteractionTopUp({
      dodgeCount: 10, parryCount: 6, blockCount: 20, dualCounterCount: 5, cinemaLevel: 0,
      axisEx: axis8, ultimateCountNeeded: 4, ultimateCost: 3000, decibelHave: 20000,
    })
    expect(t).toEqual({ parry: 0, dual: 0 })
  })

  it('嗔火不足 → 抬双反；喧响不足 → 抬弹刀（分别按缺口 ÷ 10 / ÷ 215 向上取整）', () => {
    const t = computeBanyueInteractionTopUp({
      dodgeCount: 0, parryCount: 0, blockCount: 0, dualCounterCount: 0, cinemaLevel: 0,
      axisEx: axis8, ultimateCountNeeded: 4, ultimateCost: 3000, decibelHave: 8000,
    })
    // 低交互下嗔火只够 2 次怒相 → 差 2 次 × 120 = 240 嗔火 → 双反 ceil(240/10) = 24
    expect(t.dual).toBe(24)
    // 4 终结技 × 3000 = 12000 − 8000 = 4000 → 弹刀 ceil(4000/215) = 19
    expect(t.parry).toBe(19)
  })

  it('轴内连段块不是 2 的倍数：怒相次数向上取整；无终结技需求 → 不补弹刀', () => {
    const t = computeBanyueInteractionTopUp({
      dodgeCount: 0, parryCount: 0, blockCount: 0, dualCounterCount: 0, cinemaLevel: 0,
      axisEx: { 'banyue-combo': 6 }, ultimateCountNeeded: 0, ultimateCost: 3000, decibelHave: 0,
    })
    // 6 组块 = 3 次怒相 → 差 1 次 × 120 → 双反 12
    expect(t.dual).toBe(12)
    expect(t.parry).toBe(0)
  })
})

// ===== 集成：轴内捏地动/山摇·怒 → 反馈执行计划（先扣闪能，剩余自动补连段）=====
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getAgentMechanic } from '@/mechanics'

const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')
const buffsText = readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const recsText = readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8')
const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'fireDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

// 每个用例一份干净 pinia + fetch stub。
// 历史隐患：只有「轴内捏强特集成」describe 有 beforeEach，后面的 describe 靠上一个用例
// 泄漏的 pinia 运行 —— 任何用例调 setMechanicSetting 都会污染后续断言（覆盖率滑块修活后立刻暴露：
// 一个用例把 rageGainCoverage 调成 0.5，后面「怒相增益 300」用例就读到 150）。
beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
    if (u.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(buffsText) }
    if (u.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(recsText) }
    return { ok: false, json: async () => ({}) }
  }))
})

describe('般岳轴内捏强特集成（轴内强特反馈执行计划）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
      if (u.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(buffsText) }
      if (u.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(recsText) }
      return { ok: false, json: async () => ({}) }
    }))
  })

  async function setupTeam(axes: any[] | null) {
    const catalog = useCatalogStore()
    await catalog.load()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1471', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1481', cinemaLevel: 0, ...baseConfig } as any // 支援 → 触发额外能力
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    if (axes) {
      config.useStunAxis = true
      config.stunAxes = axes
    }
    return config
  }

  it('无轴：默认能量全打怒相外论道连段（论道+狮吼怒各 9），无地动/山摇·怒行', async () => {
    await setupTeam(null)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const rows = calc.damagePoolRows.value
    // enrichExecutionPlan 会用倍率表名/note 覆盖来源标注 → 按 moveId + count 匹配（怒相外论道连段 = 9 组自动打满）
    const lunDaoOut = rows.find(r => r.moveId === '1471015' && r.count === 9)
    const shiZiHouNuOut = rows.find(r => r.moveId === '1471016' && r.count === 9)
    expect(lunDaoOut).toBeDefined()
    expect(shiZiHouNuOut).toBeDefined()
    // 默认地动山摇连段 = 0 → 无地动/山摇·怒行
    expect(rows.some(r => r.moveId === '1471013' || r.moveId === '1471017')).toBe(false)
  })

  it('轴内捏地动×2/山摇·怒×1：执行计划出现对应行且吃失衡易伤', async () => {
    await setupTeam([{ name: '轴1', actions: [
      { slot: 0, moveId: '1471013', count: 2, startTime: 0 }, // 地动×2
      { slot: 0, moveId: '1471017', count: 1, startTime: 2 }, // 山摇·怒×1
    ] }])
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    expect(calc.stunAxisResult.value).not.toBeNull()
    const rows = calc.damagePoolRows.value
    const diDong = rows.find(r => r.moveId === '1471013')
    const shanYaoNu = rows.find(r => r.moveId === '1471017')
    expect(diDong).toBeDefined()
    expect(shanYaoNu).toBeDefined()
    // 次数 = 块数 × 轴窗口数（地动 2/窗；至少 1 窗口）
    expect(diDong!.count).toBeGreaterThanOrEqual(2)
    expect(shanYaoNu!.count).toBeGreaterThanOrEqual(1)
    // 轴内块吃失衡易伤（stunMult > 1）
    expect(diDong!.stunMult).toBeGreaterThan(1)
    expect(shanYaoNu!.stunMult).toBeGreaterThan(1)
  })

  it('轴内强特耗尽闪能（地动×4+山摇·怒×4/窗）：自动连段缩到 0', async () => {
    await setupTeam([{ name: '轴1', actions: [
      { slot: 0, moveId: '1471013', count: 4, startTime: 0 }, // 地动×4 = 80闪能/窗
      { slot: 0, moveId: '1471017', count: 4, startTime: 2 }, // 山摇·怒×4 = 160闪能/窗
    ] }])
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const rows = calc.damagePoolRows.value
    // 支出远超闪能收入 → 怒相外自动连段 0 组（轴内块优先，默认连段只在轴外剩余能量里补）
    const lunDaoOut = rows.find(r => r.moveId === '1471015' && r.count === 2)
    expect(lunDaoOut).toBeUndefined()
  })

  it('轴内捏地动山摇怒连段块（banyue-combo-didong）：怒相内出现山威免费地动/山摇·怒行，论道行让位', async () => {
    // 单窗口 1 个 didong 块 × 3 失衡窗口 → 怒相内 3 组地动山摇连段（rageDiDongCombo = 3）
    await setupTeam([{ name: '轴1', actions: [
      { slot: 0, moveId: 'banyue-combo-didong', count: 1, startTime: 0 },
    ] }])
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const rr = calc.resourceResult.value
    const cycle = rr!.characters[0].banyueRageCycle
    expect(cycle!.rageDiDongComboCount).toBeGreaterThan(0)
    // 怒相内山威免费地动/山摇·怒执行行存在（count>0、耗能 0；enrich 已覆盖 moveName/note，用能量区分免费/付费）
    const execs = rr!.characters[0].executions
    const diDongRage = execs.find(e => e.moveId === '1471013' && e.count > 0 && e.energyConsume === 0)
    const shanYaoNuRage = execs.find(e => e.moveId === '1471017' && e.count > 0 && e.energyConsume === 0)
    expect(diDongRage).toBeDefined()
    expect(shanYaoNuRage).toBeDefined()
    expect(diDongRage!.count).toBe(cycle!.diDongRageCount)
    expect(shanYaoNuRage!.count).toBe(cycle!.shanYaoNuRageCount)
    // 论道怒相内行让位（次数 = 配额 − didong 组数）
    const lunDaoRage = execs.find(e => e.moveId === '1471015' && e.count > 0 && e.energyConsume === 0)
    expect(lunDaoRage).toBeDefined()
    expect(lunDaoRage!.count).toBe(cycle!.lunDaoRageCount)
  })

  it('明王施加：6命全局 +39%；非6命非轴模式按覆盖率滑块（默认0.5 → +7.5，调1 → +15）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    const config = useConfigStore()
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')

    // 非6命 + 支援：AA 触发，非轴模式 → 面板不加（走伤害池覆盖率近似），面板差异 = 0
    config.team[0] = { slot: 0, agentId: '1471', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1481', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    const withSupport0 = computePanelPhases(0, config, catalog)!
    expect(withSupport0.inCombat.additionalAbilityActive).toBe(1)

    // 6命 + 支援：applyPanel 全局 +39%（3层×13%）；与 2命比（都有 C2 怒相增益 +15 火伤，只差明王）
    config.setCinemaLevel(0, 2)
    const withSupport2 = computePanelPhases(0, config, catalog)!
    config.setCinemaLevel(0, 6)
    const withSupport6 = computePanelPhases(0, config, catalog)!
    expect(withSupport6.inCombat.fireDmg - withSupport2.inCombat.fireDmg).toBeCloseTo(39, 1)

    // 无支援队友：AA 不触发 → 无明王（6命也不加）
    config.setCinemaLevel(0, 0)
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    const solo0 = computePanelPhases(0, config, catalog)!
    expect(solo0.inCombat.additionalAbilityActive).toBe(0)
    expect(withSupport0.inCombat.fireDmg - solo0.inCombat.fireDmg).toBeCloseTo(0, 1)
  })

  it('DEBUG 时间溢出：默认非轴配置的执行行与时间合计', async () => {
    await setupTeam(null)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 60))
    const c0 = calc.resourceResult.value!.characters[0]
    const rows = (c0.executions ?? []).filter(e => (e.totalTime ?? 0) > 0)
    let sum = 0
    for (const e of rows) {
      sum += e.totalTime ?? 0
      console.log(`[DEBUG] ${e.moveName} (${e.moveId}) ${(e.totalTime ?? 0).toFixed(1)}s ×${e.count} mult=${e.damageMultiplier}`)
    }
    console.log(`[DEBUG] 平A ${(c0.timeAllocation.basicAttackTime ?? 0).toFixed(1)}s necessary ${(c0.timeAllocation.necessaryTime ?? 0).toFixed(1)}s 动作合计 ${sum.toFixed(1)}s + 平A = ${(sum + (c0.timeAllocation.basicAttackTime ?? 0)).toFixed(1)}s | cycle.comboOutRecovery=${c0.banyueRageCycle?.comboOutRecoveryCount}`)
  })

  it('失衡外连段后摇：执行计划出现恢复行（0 倍率不进伤害池），占用战场时间 → 嘲讽取消后平A时间回升', async () => {
    await setupTeam(null)
    const config = useConfigStore()
    // 关掉金身/双反（其动作时间也计入必做前台，会把平A压到 0）→ 让后摇时间成为唯一变量
    config.setBlockCount(0, 0)
    config.setDualCounterCount(0, 0)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const rr = calc.resourceResult.value!
    const c0 = rr.characters[0]
    const cycle0 = c0.banyueRageCycle!
    expect(cycle0.comboOutRecoveryCount).toBeGreaterThan(0)
    // 恢复行存在：count = 后摇次数、0 倍率（不进伤害池）、totalTime > 0
    const rec = c0.executions.find(e => e.moveId === 'banyue-recovery-lundao')
    expect(rec).toBeDefined()
    expect(rec!.count).toBe(cycle0.lunDaoRecoveryCount)
    expect(rec!.damageMultiplier ?? 0).toBe(0)
    expect(rec!.totalTime).toBeGreaterThan(0)
    // 后摇计入必做前台时间 → 占用战场时间（平A池变小）
    expect(c0.timeAllocation.necessaryTime).toBeGreaterThan(0)
    const basic0 = c0.timeAllocation.basicAttackTime
    // 全嘲讽取消后摇 → 无恢复行、后摇 0 → 平A时间回升
    config.setTauntCancelCount(0, 99)
    await new Promise(r => setTimeout(r, 50))
    const c99 = calc.resourceResult.value!.characters[0]
    expect(c99.executions.some(e => e.moveId?.startsWith('banyue-recovery'))).toBe(false)
    expect(c99.banyueRageCycle!.comboOutRecoveryCount).toBe(0)
    expect(c99.timeAllocation.basicAttackTime).toBeGreaterThan(basic0)
  })

  it('具体数据（轴模式，每窗口 = 完整怒相序列 + 80 闪能强特）：失衡内外怒相次数、闪能消耗、失衡外后摇时间', async () => {
    // 轴1 单窗口 = 一次怒相的全部资源：怒相二连段×2（banyue-combo，山威免费）+ 倾山 + 摧岳
    // + 付费强特 地动×2 + 山摇·怒×1（80 闪能/窗）→ 4 窗口 = 4 怒相全在失衡内（怒相组全被轴覆盖）
    await setupTeam([{ name: '轴1', actions: [
      { slot: 0, moveId: 'banyue-combo', count: 2, startTime: 0 },
      { slot: 0, moveId: '1471009', count: 1, startTime: 6 }, // 倾山
      { slot: 0, moveId: '1471010', count: 1, startTime: 8 }, // 摧岳
      { slot: 0, moveId: '1471013', count: 2, startTime: 10 },
      { slot: 0, moveId: '1471017', count: 1, startTime: 12 },
    ] }])
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const c0 = calc.resourceResult.value!.characters[0]
    const cycle = c0.banyueRageCycle!
    // 失衡外怒相组 = 轴内未覆盖怒相组（≤2 组 = 最多一组怒相）
    const outStunRageGroups = cycle.outStunComboCount - cycle.comboOutCount
    const inStunFlash = cycle.axisExSpend // 失衡内闪能 = 轴内普通强特消耗
    const outStunFlash = cycle.comboOutCount * 60 // 失衡外闪能 = 自动连段 60/组
    const recoveryRows = (c0.executions ?? []).filter(e => e.moveId?.startsWith('banyue-recovery'))
    const recoveryTime = recoveryRows.reduce((s, e) => s + (e.totalTime ?? 0), 0)
    const lunDaoT = recoveryRows.find(e => e.moveId === 'banyue-recovery-lundao')?.actionTime ?? 0
    const diDongT = recoveryRows.find(e => e.moveId === 'banyue-recovery-didong')?.actionTime ?? 0
    console.log('[般岳具体数据] 怒相', cycle.rageCount, '次 = 失衡内', cycle.rageCount - Math.ceil(outStunRageGroups / 2), '次 + 失衡外', Math.ceil(outStunRageGroups / 2), '次',
      '| 闪能: 失衡内', inStunFlash, '/ 失衡外', outStunFlash, '(连段', cycle.comboOutCount, '组), 总', cycle.flashSpent,
      '| 轴内捏块: combo', cycle.axisComboCount, 'didong', cycle.rageDiDongComboCount, '→ axisIn', cycle.axisInComboCount, '| 失衡外后摇', cycle.comboOutRecoveryCount, '次 =', recoveryTime.toFixed(3), 's')
    // —— 具体数据（该固定场景实测值，管线确定性稳定）——
    // 失衡内/外怒相：怒相 4 次，轴覆盖 3 次（6 组连段块）→ 失衡内 3 次 + 失衡外 1 次（未覆盖 2 组 = 一组怒相封顶）。
    // 注：测试环境未挂真实 boss，失衡池收敛到 3 窗口；真实 4 窗口预设（每窗完整怒相序列）→ axisIn=8=rageGroups，未覆盖 0，怒相全在失衡内。
    expect(cycle.rageCount).toBe(4)
    expect(cycle.axisInComboCount).toBe(6)
    expect(outStunRageGroups).toBe(2)
    expect(Math.ceil(outStunRageGroups / 2)).toBe(1)
    // 公式关系：失衡外 = 闪能连段 + 轴内未覆盖怒相组（≤2）——不管收敛出几个窗口都成立
    expect(cycle.outStunComboCount).toBe(cycle.comboOutCount + outStunRageGroups)
    // 失衡内/外闪能：轴内 240（80/窗 × 3 窗口）+ 失衡外 300（5 组连段 × 60）= 总 540，守恒
    expect(cycle.axisExSpend).toBe(240)
    expect(cycle.comboOutCount).toBe(5)
    expect(cycle.flashSpent).toBe(540)
    expect(cycle.flashSpent).toBe(inStunFlash + outStunFlash)
    // 失衡外后摇：5 + 2 次 = 7 次；时间 = 狮子吼·怒 0.517s × 7 = 3.619s（= 恢复行总时长，已计入必做前台时间）
    expect(cycle.comboOutRecoveryCount).toBe(7)
    expect(recoveryTime).toBeCloseTo(cycle.lunDaoRecoveryCount * lunDaoT + cycle.diDongRecoveryCount * diDongT, 3)
    expect(recoveryTime).toBeCloseTo(3.619, 3)
    expect(c0.timeAllocation.necessaryTime).toBeGreaterThanOrEqual(recoveryTime - 1e-6)
  })

  it('轴模式自动补齐（保底）：低交互次数下自动抬双反/弹刀，怒相次数达到轴内需求，交互栏输入不被覆盖', async () => {
    // 每窗口厚需求：连段×4（2 次怒相/窗）+ 倾山 + 摧岳 + 终结技×2（撼天动地）；交互次数全部归 0 → 嗔火/喧响不足
    await setupTeam([{ name: '轴1', actions: [
      { slot: 0, moveId: 'banyue-combo', count: 4, startTime: 0 },
      { slot: 0, moveId: '1471009', count: 1, startTime: 8 },
      { slot: 0, moveId: '1471010', count: 1, startTime: 10 },
      { slot: 0, moveId: '1471021', count: 2, startTime: 12 }, // 撼天动地×2（终结技）
    ] }])
    const config = useConfigStore()
    config.setDodgeCounterCount(0, 0)
    config.setParryCount(0, 0)
    config.setBlockCount(0, 0)
    config.setDualCounterCount(0, 0)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 80))
    const c0 = calc.resourceResult.value!.characters[0]
    const cycle = c0.banyueRageCycle!
    // 自动补齐非零（双反补嗔火 / 弹刀补喧响），且不写回 store（保底语义：交互栏输入不变）
    const topUp = calc.banyueInteractionTopUp.value
    expect(topUp).not.toBeNull()
    expect(topUp!.slot).toBe(0)
    expect(config.team[0].parryCount).toBe(0)
    expect(config.team[0].dualCounterCount).toBe(0)
    // 怒相达到轴内需求（轴内连段块 ÷ 2 向上取整）；不补齐时低交互只有 2 次怒相
    const rageNeeded = Math.ceil(cycle.axisInComboCount / 2)
    expect(cycle.rageCount).toBeGreaterThanOrEqual(rageNeeded)
    // 资源卡片出现「轴模式自动补齐」行（含补齐量）
    const sections = getAgentMechanic('1471')?.resourceSections?.({ result: c0 }) ?? []
    expect(JSON.stringify(sections)).toContain('轴模式自动补齐')
  })

  it('非6命非轴模式：明王按覆盖率滑块进伤害池（默认0.5 → +7.5%，调1 → +15%）', async () => {
    await setupTeam(null)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const rows = calc.damagePoolRows.value
    const fenShen = rows.find(r => r.moveId === '1471027')
    expect(fenShen).toBeDefined()
    expect(fenShen!.note).toContain('明王+7.5%（覆盖率近似）')
    const config = useConfigStore()
    config.setMechanicSetting('banyue.mingwangCoverage', 1)
    await new Promise(r => setTimeout(r, 50))
    const rows2 = calc.damagePoolRows.value
    const fenShen2 = rows2.find(r => r.moveId === '1471027')
    expect(fenShen2!.note).toContain('明王+15.0%（覆盖率近似）')
  })

  // 生效测试：怒相增益覆盖率滑块必须真的改面板。
  // 历史缺陷（AGENT_RECORDING_SOP §3.5「面板 buff 施加点错误」）：applyPanel 读
  // `panel.banyueRageCoverage`，而该字段从未被任何代码写入 → 滑块恒等 1、静默失效。
  // 修法：AgentPanelInput 新增已解析的 settings，applyPanel 直接读滑块。
  // 本测试锁死「滑块 → 面板」这条链，防再次退化成死数据。
  it('怒相增益覆盖率滑块生效：0% → 不加怒相面板；100% → 贯穿/火伤/暴伤按 Lv.7 全量加', async () => {
    const config = await setupTeam(null)
    const catalog = useCatalogStore()
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')

    config.setMechanicSetting('banyue.rageGainCoverage', 0)
    const panel0 = computePanelPhases(0, config, catalog)!.inCombat

    config.setMechanicSetting('banyue.rageGainCoverage', 1)
    const panel1 = computePanelPhases(0, config, catalog)!.inCombat

    // 怒相增益（Lv.7，0 命）：贯穿+300 / 火伤+36% / 暴伤+36%
    expect((panel1.sheerForceFlat ?? 0) - (panel0.sheerForceFlat ?? 0)).toBeCloseTo(300, 6)
    expect((panel1.fireDmg ?? 0) - (panel0.fireDmg ?? 0)).toBeCloseTo(36, 6)
    expect((panel1.critDmg ?? 0) - (panel0.critDmg ?? 0)).toBeCloseTo(36, 6)

    // 半覆盖 = 线性折算（滑块真的按比例进面板，而不是 0/1 开关）
    config.setMechanicSetting('banyue.rageGainCoverage', 0.5)
    const panelHalf = computePanelPhases(0, config, catalog)!.inCombat
    expect((panelHalf.fireDmg ?? 0) - (panel0.fireDmg ?? 0)).toBeCloseTo(18, 6)
  })
})

describe('computeBanyueMingwangStacks（明王时间轴覆盖，非6命，用户口径）', () => {
  const axis = (actions: { moveId: string; count: number; startTime?: number }[]) => [
    { name: '轴1', count: 1, actions: actions.map(a => ({ slot: 0, ...a })) },
  ]

  it('怒相二连块触发 2 层窗口（8s），触发块自身不享受，窗口内后续招式按层数', () => {
    const m = computeBanyueMingwangStacks(0, axis([
      { moveId: 'banyue-combo', count: 1, startTime: 0 },
      { moveId: '1471009', count: 2, startTime: 2 },
      { moveId: '1471010', count: 1, startTime: 9 },
    ]), 0)
    expect(m.get('1471009')).toBe(2)
    expect(m.get('1471010')).toBeUndefined()
    expect(m.has('banyue-combo')).toBe(false)
  })

  it('窗口内再次触发 → 3 层并刷新窗口', () => {
    const m = computeBanyueMingwangStacks(0, axis([
      { moveId: 'banyue-combo', count: 1, startTime: 0 },
      { moveId: '1471009', count: 1, startTime: 3 },
      { moveId: 'banyue-combo', count: 1, startTime: 7 },
      { moveId: '1471010', count: 1, startTime: 12 },
      { moveId: '1471012', count: 1, startTime: 20 },
    ]), 0)
    expect(m.get('1471009')).toBe(2)
    expect(m.get('1471010')).toBe(3)
    expect(m.get('1471012')).toBeUndefined()
  })

  it('单招论道/狮子吼·怒是普通强特：不触发窗口（但窗口内可享受）', () => {
    // 单招论道@0 不触发 → 后续无窗口；连段块@0 触发 → 单招论道@2 落窗享受
    const m1 = computeBanyueMingwangStacks(0, axis([
      { moveId: '1471015', count: 1, startTime: 0 }, // 论道（普通强特）
      { moveId: '1471009', count: 1, startTime: 2 },
    ]), 0)
    expect(m1.get('1471009')).toBeUndefined() // 无窗口

    const m2 = computeBanyueMingwangStacks(0, axis([
      { moveId: 'banyue-combo', count: 1, startTime: 0 }, // 怒相连段触发
      { moveId: '1471015', count: 1, startTime: 2 }, // 单招论道落窗享受
      { moveId: '1471014', count: 1, startTime: 9 }, // 窗外
    ]), 0)
    expect(m2.get('1471015')).toBe(2)
    expect(m2.get('1471014')).toBeUndefined()
  })

  it('同招式多块按 count 实例加权平均层数', () => {
    const m = computeBanyueMingwangStacks(0, axis([
      { moveId: 'banyue-combo', count: 1, startTime: 0 },
      { moveId: '1471009', count: 1, startTime: 2 },
      { moveId: 'banyue-combo', count: 1, startTime: 6 },
      { moveId: '1471009', count: 2, startTime: 10 },
    ]), 0)
    expect(m.get('1471009')).toBeCloseTo(8 / 3, 6)
  })

  it('6命满覆盖：不扫描（返回空，伤害走全局 buff）', () => {
    const m = computeBanyueMingwangStacks(0, axis([
      { moveId: 'banyue-combo', count: 1, startTime: 0 },
      { moveId: '1471009', count: 1, startTime: 2 },
    ]), 6)
    expect(m.size).toBe(0)
  })

  it('非般岳槽位动作不参与', () => {
    const axes = [
      { name: '轴1', actions: [
        { slot: 1, moveId: 'banyue-combo', count: 1, startTime: 0 },
        { slot: 0, moveId: '1471009', count: 1, startTime: 2 },
      ] },
    ]
    expect(computeBanyueMingwangStacks(0, axes, 0).size).toBe(0)
  })

  it('地动山摇怒连段块（banyue-combo-didong）同样触发明王窗口', () => {
    const m = computeBanyueMingwangStacks(0, axis([
      { moveId: 'banyue-combo-didong', count: 1, startTime: 0 },
      { moveId: '1471013', count: 1, startTime: 2 }, // 地动（块内招式落窗）
      { moveId: '1471017', count: 1, startTime: 3 }, // 山摇·怒（落窗）
      { moveId: '1471010', count: 1, startTime: 9 }, // 窗外
    ]), 0)
    expect(m.get('1471013')).toBe(2)
    expect(m.get('1471017')).toBe(2)
    expect(m.get('1471010')).toBeUndefined()
    expect(m.has('banyue-combo-didong')).toBe(false)
    // 两个连段块可混合触发：didong@0 触发 2 层 → 论道块@5 触发 3 层刷新
    const m2 = computeBanyueMingwangStacks(0, axis([
      { moveId: 'banyue-combo-didong', count: 1, startTime: 0 },
      { moveId: 'banyue-combo', count: 1, startTime: 5 },
      { moveId: '1471009', count: 1, startTime: 10 },
    ]), 0)
    expect(m2.get('1471009')).toBe(3)
  })
})

describe('computeBanyueMingwangBlocks（轴编辑器块级标注）', () => {
  const axes = (banyueSlot = 0) => [{ name: '轴1', actions: [
    { slot: banyueSlot, moveId: 'banyue-combo', count: 1, startTime: 0 },
    { slot: banyueSlot, moveId: '1471009', count: 1, startTime: 2 },
    { slot: banyueSlot, moveId: '1471010', count: 1, startTime: 9 },
  ] }]

  it('触发块标 trigger，落窗块标层数，窗外块 0', () => {
    const m = computeBanyueMingwangBlocks(axes(), 0, 0)
    expect(m.get('0:0')).toEqual({ layers: 2, trigger: true })
    expect(m.get('0:1')).toEqual({ layers: 2, trigger: false })
    expect(m.get('0:2')).toEqual({ layers: 0, trigger: false })
  })

  it('6命不标注（满覆盖，UI 单独提示）', () => {
    expect(computeBanyueMingwangBlocks(axes(), 0, 6).size).toBe(0)
  })
})

describe('般琉通用预设轴（用户录入）：怒/普分化后的明王触发', () => {
  it('只有怒相连段块触发明王；单招论道/狮子吼·怒（普通强特）不触发但窗口内享受', async () => {
    const { default: preset } = await import('@/data/stunAxisPresets/般琉通用.json') as any
    const split = preset.plans[0].split
    const axes = [split.baseAxis, split.upgradeAxis]
    // 常规轴：连段@2.4 触发 2 层；连段@6.6 窗口内再触发 → 3 层并刷新到 14.6
    const m = computeBanyueMingwangStacks(0, axes, 0)
    expect(m.get('1471021')).toBe(3) // 转大块（4.1/7.8/8.3 落窗，加权）
    expect(m.get('1471009')).toBe(3) // 倾山@10.3
    expect(m.get('1471010')).toBe(3) // 摧岳@12.2
    // 单招狮子吼·怒@13.7、论道@14.2 是普通强特：不触发，但 13.7/14.2 < 14.6 → 落窗享受 3 层
    expect(m.get('1471016')).toBe(3)
    expect(m.get('1471015')).toBe(3)
    // 单招狮子吼@14.8 窗外（> 14.6）→ 不享受
    expect(m.get('1471014')).toBeUndefined()
  })
})

describe('资源池迭代口径（闪能/20 修复）', () => {
  it('calcEnergySource 计入般岳山威回闪能；state.exSpecialCount 用怒相循环强特总数（非 闪能/20）', async () => {
    const { calcTeamResources } = await import('@/core/resource')
    const catalog = useCatalogStore()
    await catalog.load()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1471', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    const { buildCharConfig } = await import('@/composables/resourceCalc/helpers')
    const cfg = buildCharConfig(0, config, catalog)!
    const rr = calcTeamResources({ characters: [cfg], totalTime: 180, stunCount: 3 } as any)
    const c0 = rr.characters[0]
    // 山威回闪能已计入闪能收入（rage=4 → 4×4×10 = 160）
    expect(c0.energySource.banyueSwayRefund).toBe(160)
    // 强特总数 = 怒相内（rage4 × 4 山威强特 = 16）+ 怒相外连段（2×9 = 18）= 34，而非 闪能/20
    expect(c0.exSpecialCount).toBe(34)
  })
})

describe('般岳交互板块（扬砾/昂霄/冲霄 招式映射，用户确认）', () => {
  it('通用路径：闪避→扬砾、弹刀→昂霄（与所有角色一致）；般岳专属：金身+双反→不动如山+冲霄', async () => {
    const banyueModule = await import('@/mechanics/agents/banyue') as any
    const banyueMechanic = banyueModule.banyueMechanic
    const cfg: any = {
      dodgeCounterCount: 10, parryCount: 6, blockCount: 20, dualCounterCount: 5,
      dodgeCounterMoveId: '1471019', // 通用 findDodgeCounter 已正确选中扬砾（timeType=dodgeCounter）
      dodgeCounterActionTime: 1, defensiveAssistActionTime: 1, assistFollowUpActionTime: 1,
      dodgeCounterDecibelRecovery: 0, defensiveAssistDecibelRecovery: 0, assistFollowUpDecibelRecovery: 0,
    }
    const state: any = { basicAttackTime: 0, exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 }
    const executions: any[] = []
    // 模拟通用 buildExecutions 生成的行：扬砾（闪避反击）+ 昂霄（支援突击）
    executions.push({ moveId: '1471019', moveName: '闪避反击（Dodge Counter）', category: 'dodge', count: cfg.dodgeCounterCount, actionTime: 1, comboAlignRatio: 0, totalTime: 10, totalComboAlignTime: 0, energyConsume: 0, totalEnergyConsume: 0, decibelRecovery: 0, totalDecibelRecovery: 0, energyRecovery: 0, totalEnergyRecovery: 0 })
    executions.push({ moveId: '1471026', moveName: '支援突击（Assist Follow-Up）', category: 'assist', count: cfg.parryCount, actionTime: 1, comboAlignRatio: 0, totalTime: 6, totalComboAlignTime: 0, energyConsume: 0, totalEnergyConsume: 0, decibelRecovery: 0, totalDecibelRecovery: 0, energyRecovery: 0, totalEnergyRecovery: 0 })
    banyueMechanic.patchExecutions?.({ cfg, state, executions })
    const yangLi = executions.find(e => e.moveId === '1471019')
    expect(yangLi).toBeDefined()
    expect(yangLi!.count).toBe(10) // 通用：闪避次数 → 扬砾
    const angXiao = executions.find(e => e.moveId === '1471026')
    expect(angXiao!.count).toBe(6) // 通用：普通弹刀 → 昂霄
    const chongXiao = executions.find(e => e.moveId === '1471029')
    expect(chongXiao).toBeDefined()
    expect(chongXiao!.count).toBe(25) // 般岳专属：金身20 + 双反5 → 冲霄
    const buDong = executions.find(e => e.moveId === '1471011')
    expect(buDong).toBeDefined()
    expect(buDong!.count).toBe(25)
    expect(buDong!.actionTime).toBeGreaterThan(0)
  })
})

describe('般岳自动轴 + 失衡窗口延时（用户口径）', () => {
  async function setupBanyueTeam() {
    const catalog = useCatalogStore()
    await catalog.load()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1471', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1481', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '1451', cinemaLevel: 0, ...baseConfig } as any
    return config
  }
  it('队伍 [1471,1481,1451]：通用自动轴生效并选中般琉通用预设（好评溢出爆发轴）', async () => {
    await setupBanyueTeam()
    const config = useConfigStore()
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 60))
    expect(calc.autoPreset.value).not.toBeNull()
    expect(calc.autoPreset.value?.id).toBe('preset-1471-1481-1451')
    expect(calc.autoActive.value).toBe(true)
    const axes = calc.effectiveStunAxes.value
    // split(goodReviewOverflow)：默认全打常规轴，好评溢出才打爆发轴；窗口数 = 各轴 count 之和
    expect(axes.length).toBeGreaterThanOrEqual(1)
    expect(axes.some(a => a.name === '常规')).toBe(true)
    // 轴带 60/90 转大块（好评消耗来源）
    expect(axes.some(a => a.actions.some(act => act.promoteVariant === '60' || act.promoteVariant === '90'))).toBe(true)
  })

  it('失衡窗口时长含全队失衡延时：琉音+2、般岳C1+2 → 12+4+2+2 = 20s', async () => {
    await setupBanyueTeam()
    const config = useConfigStore()
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.setCinemaLevel(0, 1) // 般岳 C1：摧岳命中失衡 +2s
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 60))
    expect(calc.windowDuration.value).toBe(12 + 4 + 2 + 2)
    // 无 C1：只有琉音 +2
    config.setCinemaLevel(0, 0)
    await new Promise(r => setTimeout(r, 60))
    expect(calc.windowDuration.value).toBe(12 + 4 + 2)
  })
})

describe('核心被动·群山如我（hp→贯穿力 0.1/点 = 命破通用公式，不重复叠加）', () => {
  it('sheerForceFlat 只含怒相增益 300×覆盖率（hp×0.1 由引擎通用基底承担）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1471', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p = computePanelPhases(0, config, catalog)!
    // sheerForceFlat = 怒相增益 300（覆盖率1），不含额外 hp×0.1（避免重复计入）
    expect(p.inCombat.sheerForceFlat ?? 0).toBeCloseTo(300, 1)
    // 贯穿力基底 = atk×0.3 + hp×0.1（通用，含核心被动描述）+ sheerForceFlat
    const base = p.inCombat.atk * 0.3 + p.inCombat.hp * 0.1 + (p.inCombat.sheerForceFlat ?? 0)
    expect(base).toBeGreaterThan(0)
  })
})

describe('般岳命座逐项验收（用户口径）', () => {
  async function panelAt(cinema: number) {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1471', cinemaLevel: cinema, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    return computePanelPhases(0, config, catalog)!.inCombat as any
  }

  it('C1：10 贯穿增伤区 + 2s 失衡延长（减抗在 teamBuff 已有）', async () => {
    const p0 = await panelAt(0)
    const p1 = await panelAt(1)
    expect(p1.sheerDmgBonus - p0.sheerDmgBonus).toBeCloseTo(10, 1)
    expect(p1.stunDurationBonusSeconds - p0.stunDurationBonusSeconds).toBeCloseTo(2, 1)
  })

  it('C2：怒相增益暴伤/火伤各 +15（回闪 +5 已有独立测试）', async () => {
    const p0 = await panelAt(0)
    const p2 = await panelAt(2)
    expect(p2.critDmg - p0.critDmg).toBeCloseTo(15, 1)
    expect(p2.fireDmg - p0.fireDmg).toBeCloseTo(15, 1)
  })

  it('C4：狮子吼·怒/山摇·怒/倾山/摧岳 +30% 普通增伤区（moveId 级）', async () => {
    const banyueModule = await import('@/mechanics/agents/banyue') as any
    const executions: any[] = []
    for (const id of ['1471016', '1471017', '1471009', '1471010']) {
      executions.push({ moveId: id, moveName: `m${id}`, category: 'special', count: 1, actionTime: 1, comboAlignRatio: 0, totalTime: 1, totalComboAlignTime: 0, energyConsume: 0, totalEnergyConsume: 0, decibelRecovery: 0, totalDecibelRecovery: 0, energyRecovery: 0, totalEnergyRecovery: 0, damageMultiplier: 100, damageMultiplierOverride: true })
    }
    executions.push({ moveId: '1471013', moveName: 'm地动', category: 'special', count: 1, actionTime: 1, comboAlignRatio: 0, totalTime: 1, totalComboAlignTime: 0, energyConsume: 20, totalEnergyConsume: 20, decibelRecovery: 0, totalDecibelRecovery: 0, energyRecovery: 0, totalEnergyRecovery: 0, damageMultiplier: 100, damageMultiplierOverride: true })
    const cfg = { dualCounterCount: 0, blockCount: 0, banyueCinemaLevel: 4 } as any
    banyueModule.banyueMechanic.patchExecutions?.({ cfg, state: {} as any, executions })
    for (const e of executions) {
      if (['1471016', '1471017', '1471009', '1471010'].includes(e.moveId)) {
        expect(e.dmgBonus).toBeCloseTo(30, 1)
      } else {
        expect(e.dmgBonus ?? 0).toBe(0) // 地动不受 C4 加成
      }
    }
  })

  it('本体怒相增益：贯穿+300 / 火伤+36% / 暴伤+36%（覆盖率100% = 永续口径）', async () => {
    const p = await panelAt(0)
    expect(p.sheerForceFlat).toBeCloseTo(300, 1)
    expect(p.fireDmg).toBeGreaterThanOrEqual(36)
    expect(p.critDmg).toBeGreaterThanOrEqual(36)
  })
})

describe('C1 战栗减抗生效（teammate-buffs 1471 组）', () => {
  it('1命时 enemyFireResReduction = 10（0命 = 0）；C1 提升显著高于无减抗', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1471', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1481', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '1451', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    expect(computePanelPhases(0, config, catalog)!.inCombat.enemyFireResReduction ?? 0).toBe(0)
    config.setCinemaLevel(0, 1)
    config.syncTeammateBuffsFromTeam()
    const p1 = computePanelPhases(0, config, catalog)!
    expect(p1.inCombat.enemyFireResReduction).toBe(10)
  })
})
