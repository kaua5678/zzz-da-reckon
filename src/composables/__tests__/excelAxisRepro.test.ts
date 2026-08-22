import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'

const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')
const teammateBuffsText = readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const recsText = readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8')

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
    if (u.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(teammateBuffsText) }
    if (u.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(recsText) }
    return { ok: false, json: async () => ({}) }
  }))
})

function teamChar(slot: number, agentId: string, cinemaLevel = 0, overrides: Record<string, unknown> = {}) {
  return {
    slot, agentId, cinemaLevel, wEngineId: '', wEngineModLevel: 5,
    driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {} as any, subStatAllocation: {} },
    parryCount: 0, blockCount: 0, dodgeCounterCount: 0, quickAssistCount: 0,
    chainCountPerStun: 1, basicAttackTimeWeight: 1, ...overrides,
  } as any
}

function report(calc: ReturnType<typeof useResourceCalc>, title: string) {
  const out = calc.resourceResult.value!
  const sp = calc.stunPoolResult.value
  const ap = calc.anomalyPoolResult.value
  console.log(`\n======== ${title} ========`)
  console.log(`失衡次数: ${sp?.stunCount ?? 'n/a'}（全队失衡值 ${Math.round(sp?.totalStunBuildUp ?? 0)}）`)
  const anomalyTotal = (ap?.perSlotAnomalyTriggers ?? []).reduce((a: number, b: number) => a + b, 0)
  const disorderTotal = (ap?.perSlotDisorderTriggers ?? []).reduce((a: number, b: number) => a + b, 0)
  console.log(`异常触发 ${anomalyTotal} 次 / 紊乱 ${disorderTotal} 次 / 乱流 ${(ap?.perSlotTurbulenceTriggers ?? []).reduce((a: number, b: number) => a + b, 0)} 次`)
  for (const c of out.characters) {
    const t = c.timeAllocation
    console.log(`[${c.slot}] ${c.agentId}: 强特 ${fmtN(c.exSpecialCount)} 次 | 终结技 ${c.ultimateCount} 次 | 喧响 ${Math.round(c.decibelSource.total)} | 连携 ${c.chainCountTotal} | 前台 ${fmtN(t.frontlineTime)}s 平A ${fmtN(t.basicAttackTime)}s`)
  }
  // 按角色伤害汇总
  const rows = calc.damagePoolRows.value
  const bySlot: Record<number, number> = {}
  for (const r of rows) bySlot[r.slot] = (bySlot[r.slot] ?? 0) + r.totalDamage
  for (const [slot, dmg] of Object.entries(bySlot)) {
    console.log(`  伤害 slot${slot}: ${(dmg / 1e6).toFixed(1)}M (${((dmg / calc.teamTotalDamage.value) * 100).toFixed(1)}%)`)
  }
  console.log(`全队总伤: ${(calc.teamTotalDamage.value / 1e6).toFixed(1)}M`)
  expect(calc.teamTotalDamage.value).toBeGreaterThan(0)
}

function fmtN(v: number | undefined): string {
  return v == null ? 'n/a' : String(Math.round(v * 100) / 100)
}

describe('Excel 轴复现：资源计算产出', () => {
  it('队伍A 星辉比利（1531 比利0+专武 / 1481 琉音0 / 1451 卢西娅0）vs Excel 总伤 203M', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    // Excel 操作表：比利 0命 专武；琉 0命；卢 0命 专武（琉音"火锅"/卢西娅专武未录入 catalog，留空）
    config.team[0] = teamChar(0, '1531', 0, { wEngineId: '13004' })
    config.team[1] = teamChar(1, '1481', 0, { parryCount: 10 })
    config.team[2] = teamChar(2, '1451', 0, { parryCount: 1 })
    config.team[0].parryCount = 4
    // Excel boss：鳄鱼，失衡 14068，无敌飞天 21s，180s
    config.setEnemy({ stunValue: 14068, invincibleTime: 21, battleTime: 180 })
    config.syncTeammateBuffsFromTeam()
    const calc = useResourceCalc()
    report(calc, '队伍A 星辉比利（对照 Excel：4 失衡 / 总伤 203M / 比利占 90%）')

    // 裸面板（无驱动盘/琉音·卢西娅专武未入库）下锁定资源结构，防止口径回归
    const out = calc.resourceResult.value!
    const billy = out.characters.find(c => c.agentId === '1531')!
    expect(billy.exSpecialCount).toBeGreaterThanOrEqual(6)
    // 时间桶恒等式（2026-08）：前台模块行对自家账本折叠后，平A池收缩 → 喧响回收减少，
    // 终结技从 3 掉到 2（此前 3 是未入账模块行白占时间轴的虚高）
    expect(billy.ultimateCount).toBeGreaterThanOrEqual(2)
    expect(calc.stunPoolResult.value!.stunCount).toBeGreaterThanOrEqual(3)
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)
  })

  it('队伍B 普罗米娅白巧（1541 普1命 / 1511 南宫羽0+专武 / 1411 柚叶0）vs Excel 总伤 226M', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    // Excel 操作表：普 1命（专武 false）；南 0命 专武（南宫羽专武未录入，留空）；柚 0命
    config.team[0] = teamChar(0, '1541', 1)
    config.team[1] = teamChar(1, '1511', 0)
    config.team[2] = teamChar(2, '1411', 0)
    // Boss 魔法屠夫：失衡 15486，160s 有效（Excel：整局取 160s）
    config.setEnemy({ stunValue: 15486, battleTime: 160, invincibleTime: 0 })
    config.syncTeammateBuffsFromTeam()
    const calc = useResourceCalc()
    report(calc, '队伍B 普罗米娅白巧（对照 Excel：5 失衡 / 7轮双紊乱 / 总伤 226M / 普占 68%）')

    // 裸面板（无驱动盘/专武）下锁定资源结构，防止口径回归；普罗米娅无机制模块，寒蚀/霜刑/异放不生效
    const out = calc.resourceResult.value!
    const promeia = out.characters.find(c => c.agentId === '1541')!
    expect(promeia.exSpecialCount).toBeGreaterThan(0)
    expect(promeia.ultimateCount).toBeGreaterThanOrEqual(1)
    expect(calc.stunPoolResult.value!.stunCount).toBeGreaterThanOrEqual(2)
    expect(calc.anomalyPoolResult.value!.perSlotAnomalyTriggers.reduce((a: number, b: number) => a + b, 0)).toBeGreaterThan(0)
  })
})
