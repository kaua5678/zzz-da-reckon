import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computeBreakerCompare } from '@/composables/breakerCompare'
import { teamPresets } from '@/data/teamPresets'
const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')
const buffsText = readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const recsText = readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8')
const bossText = readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')
beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
    if (u.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(buffsText) }
    if (u.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(recsText) }
    if (u.includes('/static/boss-presets.json')) return { ok: true, json: async () => JSON.parse(bossText) }
    return { ok: false, json: async () => ({}) }
  }))
})
describe('击破手对比（breakerCompare）', () => {
  it('拐力差分：莱卡恩队关 buff 重算，buffContribution > 0 且占比合理（页面 run 需 await catalog/teammateBuffs）', async () => {
    // 页面修复后：run() 先 await catalog/teammateBuffs 再建 calc
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const calc = useResourceCalc()
    const bossFile = JSON.parse(bossText)
    const boss = bossFile.bosses[0]
    const phase = boss.phases[0]
    const lycaon = teamPresets.find(p => p.id === 'yidhari-lycaon-lucia')!
    const results = computeBreakerCompare(calc, [lycaon], boss, phase)
    const r = results[0]
    expect(r).toBeTruthy()
    expect(r.breakerName).toBe('莱卡恩')
    expect(r.totalDamage).toBeGreaterThan(0)
    // 拐力差分（失衡易伤 35 + 冰抗/六元素增伤）应显著贡献（>5% 总伤）
    expect(r.buffContribution).toBeGreaterThan(r.totalDamage * 0.05)
    // 自身直伤存在
    expect(r.selfDamage).toBeGreaterThan(0)
    expect(r.selfDamage + r.giftDamage + r.buffContribution + r.otherDamage).toBeLessThanOrEqual(r.totalDamage + 1)
  })
  it('赠送归因：琉音 好评转大 赠送队友终结技进入 gift 列（不并入目标原始终结技行）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const calc = useResourceCalc()
    const bossFile = JSON.parse(bossText)
    const boss = bossFile.bosses[0]
    const phase = boss.phases[0]
    const liuyin = teamPresets.find(p => p.id === 'yidhari-liuyin-lucia')!
    const results = computeBreakerCompare(calc, [liuyin], boss, phase)
    const r = results[0]
    expect(r).toBeTruthy()
    expect(r.breakerName).toBe('琉音')
    // 转大赠送队友终结技必须计入 gift 列
    expect(r.giftDamage).toBeGreaterThan(0)
  })
  it('转大 gift 行形状：独立成行、有倍率、不覆盖目标原始终结技行', async () => {
    // compare 结束时还原队伍，行形状需直接建队检查
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    const liuyin = teamPresets.find(p => p.id === 'yidhari-liuyin-lucia')!
    for (let slot = 0; slot < 3; slot++) {
      config.setAgent(slot, liuyin.team[slot])
      if (liuyin.wEngines?.[slot]) config.setWEngine(slot, liuyin.wEngines[slot])
      if (liuyin.chainCountPerStun) config.setChainCountPerStun(slot, liuyin.chainCountPerStun[slot])
    }
    config.useStunAxis = false
    config.syncTeammateBuffsFromTeam()
    const bossFile2 = JSON.parse(bossText)
    const boss2 = bossFile2.bosses[0]
    config.applyBossPreset({ id: boss2.id }, boss2.phases[0], boss2.monster, boss2.defaults)
    const calc = useResourceCalc()
    const giftRows = calc.damagePoolRows.value.filter(row => row.sourceTag === 'gift')
    expect(giftRows.length).toBeGreaterThan(0)
    expect(giftRows.every(row => (row.count ?? 0) > 0)).toBe(true)
    // 目标（伊德海莉）原始终结技行仍存在且 count 未被转大吞并
    const ownUlt = calc.damagePoolRows.value.filter(row => row.slot === 0 && row.moveId === '1051016' && row.sourceTag !== 'gift')
    expect(ownUlt.length).toBeGreaterThan(0)
    const ownCount = ownUlt.reduce((s, row) => s + (row.count ?? 0), 0)
    const giftCount = giftRows.reduce((s, row) => s + (row.count ?? 0), 0)
    expect(ownCount).toBeGreaterThan(0)
    expect(giftCount).toBeGreaterThan(0)
  })
})
