/**
 * 3.4 测试服首版（v1 占位）新驱动盘 / 新音擎的生效判据（2026-10-25）。
 *
 * 口径（用户裁决 2026-10-25）：测试服数据录成 **v1 占位条目**——id 与名字带 `v1` 后缀
 * （`14160` → `14160v1`、`34300` → `34300v1`），与 beta 快照的 `<agentId>v<n>` 同一命名纪律：
 * 正式服同 id 的条目之后照常录入、两者同时存在、各自可选用，互不覆盖。盘/音擎的名字在
 * 测试服构建里是占位符，v1 只要求「能算」，不要求定稿名。
 *
 * 数据：`scripts/import-nanoka-wengine.mjs --tag v1` / `scripts/import-nanoka-disc-set.mjs --tag v1`
 * （来源 nanoka 3.4.1+19836465，raw 存档 `data/raw/nanoka_wengine_141{60,66}_{zh,en}.json`、
 * `data/raw/nanoka_equipment_3.4.1+19836465.json`）。
 * 消费端：`core/buff.ts#collectAllBuffs`（音擎自身/团队）、`core/inCombatBuffs.ts`（团队效果）、
 * `core/panel.ts#calcPanel`（驱动盘 2pc/4pc）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calcPanel } from '@/core/panel'
import { buildTeammateBuffSourceContext } from '@/core/teammateBuffSource'
import { getStunBuildUpBonus, getTargetedElementStat } from '@/core/buff'
import { getPanelStat } from '@/utils/panelStat'

function loadCatalog() {
  return JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))
}

const cat = loadCatalog() as any
const setsMap = new Map<string, any>(cat.driveDiscSets.map((s: any) => [String(s.id), s]))
const statRules = cat.statRules
const getAgent = (id: string) => cat.agents.find((a: any) => a.id === id || a.teammateBuffId === id)
const getWEngine = (id: string) => cat.wEngines.find((w: any) => String(w.id) === String(id))

function disc(overrides: Record<string, any> = {}): any {
  return { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {}, ...overrides }
}

/** 单角色面板（队友 buff 空集、命座 0、精炼按 modLevel） */
function panelFor(agentId: string, opts: { wEngineId?: string, discConfig?: any, modLevel?: number } = {}) {
  return calcPanel(
    getAgent(agentId),
    opts.wEngineId ? getWEngine(opts.wEngineId) : undefined,
    opts.discConfig ?? disc(),
    setsMap,
    [],
    statRules,
    { cinemaLevel: 0, wEngineModLevel: opts.modLevel ?? 1 },
  )
}

/** 一次装配：owner 穿指定音擎/盘，target（1241 朱鸢·攻击位）只吃拐；返回两者面板 */
function runTeam(ownerId: string, opts: { wEngineId?: string, discConfig?: any } = {}) {
  const team = [
    { agentId: ownerId, driveDisc: opts.discConfig ?? disc(), cinemaLevel: 0, wEngineModLevel: 1, wEngineId: opts.wEngineId },
    { agentId: '1241', driveDisc: disc(), cinemaLevel: 0, wEngineModLevel: 1, wEngineId: undefined },
  ]
  const ctx = buildTeammateBuffSourceContext(team, {
    teammateBuffGroups: [],
    driveDiscSetsMap: setsMap,
    statRules,
    getAgent,
    getWEngine,
    isTeammateBuffEnabled: () => false,
  })
  const target = calcPanel(getAgent('1241'), undefined, disc(), setsMap, ctx.enabledTeammateBuffs, statRules, {
    cinemaLevel: 0,
    wEngineModLevel: 1,
    sourcePanelsByOwner: ctx.sourcePanelsByOwner,
  })
  const owner = calcPanel(getAgent(ownerId), opts.wEngineId ? getWEngine(opts.wEngineId) : undefined, opts.discConfig ?? disc(), setsMap, ctx.enabledTeammateBuffs, statRules, {
    cinemaLevel: 0,
    wEngineModLevel: 1,
    sourcePanelsByOwner: ctx.sourcePanelsByOwner,
  })
  return { target, owner }
}

describe('v1 占位条目：目录契约', () => {
  it('四件都进了 catalog，id/名字带 v1，正式 id 槽位没有被占', () => {
    for (const id of ['14160v1', '14166v1']) {
      const w = getWEngine(id)
      expect(w, `缺音擎 ${id}`).toBeTruthy()
      expect(w.name.zhCN.endsWith(' v1')).toBe(true)
      expect(w.verification).toMatchObject({ dataVersion: 'v1', sourceVersion: '3.4.1+19836465' })
    }
    for (const id of ['34300v1', '34400v1']) {
      const d = setsMap.get(id)
      expect(d, `缺驱动盘 ${id}`).toBeTruthy()
      expect(d.name.zhCN.endsWith(' v1')).toBe(true)
      expect(d.sources.join(' ')).toContain('3.4.1+19836465')
    }
    // 专武归属：**默认不声明**（正式服同 id 落地时才建 ownerAgentId，否则两把武器会抢同一角色）。
    // 例外 = 角色正式服还没上线、而音擎只有 v1 占位 ⇒ 归属落到这唯一一把上（用户 2026-11-10：
    // 「挽昼柯雷妲知更鸟的预设为什么点进来带的乱七八糟的专武」——不登记的话预设会给她们穿同职业别人的 A 级）。
    // 首例：挽昼 1601 → 14160v1、知更鸟 1661 → 14166v1（scripts/tag-wengine-owner.mjs）。
    // 3.4 正式音擎（14160/14166）上线后：先 --clear 这两条，再按常规导入正式 id。
    expect(getWEngine('14160v1').ownerAgentId).toBe('1601')
    expect(getWEngine('14166v1').ownerAgentId).toBe('1661')
    // 正式 id 留给正式包：v1 只占自己的槽
    expect(getWEngine('14160')).toBeUndefined()
    expect(getWEngine('14166')).toBeUndefined()
    expect(setsMap.has('34300')).toBe(false)
    expect(setsMap.has('34400')).toBe(false)
  })
})

describe('14160v1（挽昼专武·锋御）', () => {
  it('基础防御力主词条落到「防御」而不是攻击，副属性防御力 48%', () => {
    const agent = getAgent('1601')
    const base = panelFor('1601')
    const w = panelFor('1601', { wEngineId: '14160v1' })
    expect(w.outOfCombat.atk).toBeCloseTo(base.outOfCombat.atk, 6)
    // 角色自身模块在累加器之外补的固定防御（625.1145 − 441.1145 = 184）：不吃音擎百分比
    const flatOutside = base.outOfCombat.def - agent.level60.defBase
    expect(w.outOfCombat.def).toBeCloseTo((agent.level60.defBase + 446) * 1.48 + flatOutside, 4)
  })

  it('暴击率 / 火属性伤害 / 火属性锐化伤害按精炼阶梯生效（1 档 / 5 档）', () => {
    const base = panelFor('1601')
    const w1 = panelFor('1601', { wEngineId: '14160v1', modLevel: 1 })
    expect(w1.inCombat.critRate - base.inCombat.critRate).toBeCloseTo(20, 6)
    expect(w1.inCombat.fireDmg - base.inCombat.fireDmg).toBeCloseTo(22, 6)
    // 火属性锐化增伤走元素键族（fireSharpDmg 是动态键，按伤害池同一个读取口取）
    expect(getTargetedElementStat(w1.inCombat, 'sharpDmg', 'fire', 'all')
      - getTargetedElementStat(base.inCombat, 'sharpDmg', 'fire', 'all')).toBeCloseTo(10, 6)

    const w5 = panelFor('1601', { wEngineId: '14160v1', modLevel: 5 })
    expect(w5.inCombat.critRate - base.inCombat.critRate).toBeCloseTo(28, 6)
    expect(w5.inCombat.fireDmg - base.inCombat.fireDmg).toBeCloseTo(35.2, 6)
    expect(getTargetedElementStat(w5.inCombat, 'sharpDmg', 'fire', 'all')
      - getTargetedElementStat(base.inCombat, 'sharpDmg', 'fire', 'all')).toBeCloseTo(16, 6)
  })
})

describe('14166v1（知更鸟专属·防护）', () => {
  it('护盾→全队防御 +10%，追加攻击→全队增伤 10%×2 层（队友与装备者都吃到）', () => {
    const noW = runTeam('1661')
    const withW = runTeam('1661', { wEngineId: '14166v1' })
    expect(withW.target.inCombat.dmgBonus - noW.target.inCombat.dmgBonus).toBeCloseTo(20, 6) // 2 层 × 10%
    expect(withW.target.inCombat.def).toBeCloseTo(noW.target.inCombat.def * 1.1, 3)
    // 装备者自己同样生效
    expect(withW.owner.inCombat.dmgBonus - noW.owner.inCombat.dmgBonus).toBeCloseTo(20, 6)
  })

  it('精炼阶梯：全队增伤 10→16（每层）、防御 10→16 按 1..5 档', () => {
    const team = getWEngine('14166v1').effect.teamBuff.effects
    const dmg = team.find((e: any) => e.stat === 'dmgBonus')
    const def = team.find((e: any) => e.stat === 'inCombatDefPct')
    expect(dmg.modificationValues.valuePerStack).toEqual([10, 11.5, 13, 14.5, 16])
    expect(def.modificationValues.value).toEqual([10, 11.5, 13, 14.5, 16])
    expect(dmg.defaultStacks).toBe(2)
  })
})

describe('34300v1（火锐化 4pc）', () => {
  it('2pc 防御 +16%（局外百分比，按基础防御力乘）', () => {
    const agent = getAgent('1601')
    const base = panelFor('1601')
    const two = panelFor('1601', { discConfig: disc({ twoPieceSetId: '34300v1' }) })
    expect(getPanelStat(two.outOfCombat, 'outOfCombatDefPct')).toBeCloseTo(16, 6)
    const flatOutside = base.outOfCombat.def - agent.level60.defBase
    expect(two.outOfCombat.def).toBeCloseTo(agent.level60.defBase * 1.16 + flatOutside, 4)
  })

  it('4pc 暴击率 +12 且火属性防御区无视 16%', () => {
    const base = panelFor('1601')
    const p = panelFor('1601', { discConfig: disc({ fourPieceSetId: '34300v1' }) })
    expect(p.inCombat.critRate - base.inCombat.critRate).toBeCloseTo(12, 6)
    expect(p.inCombat.enemyFireDefReduction - base.inCombat.enemyFireDefReduction).toBeCloseTo(16, 6)
  })
})

describe('34400v1（回能 / 击破锐化增伤 4pc）', () => {
  it('2pc 能量自动回复 +20%', () => {
    const base = panelFor('1601')
    const two = panelFor('1601', { discConfig: disc({ twoPieceSetId: '34400v1' }) })
    expect(two.outOfCombat.energyRegenBonusPct - base.outOfCombat.energyRegenBonusPct).toBeCloseTo(20, 6)
  })

  it('4pc 暴击率门槛：<50% 不给暴伤/失衡，≥50% 才给（门槛读局外面板，含副词条与 2pc）', () => {
    // 1481 琉音（击破）局外暴击 19.4：4 号位暴击主词条 +24 ⇒ 43.4（不达标）
    const lowDisc = disc({ fourPieceSetId: '34400v1', mainStats: { 4: 'critRate' } })
    const lowBase = disc({ mainStats: { 4: 'critRate' } })
    const low = panelFor('1481', { discConfig: lowDisc })
    const lowNoSet = panelFor('1481', { discConfig: lowBase })
    expect(low.inCombat.critDmg - lowNoSet.inCombat.critDmg).toBeCloseTo(0, 6)
    expect(getStunBuildUpBonus(low.inCombat, 'basic') - getStunBuildUpBonus(lowNoSet.inCombat, 'basic')).toBeCloseTo(0, 6)

    // 再加 2pc 啄木鸟电音 +8% ⇒ 51.4（达标）
    const highDisc = disc({ fourPieceSetId: '34400v1', twoPieceSetId: '31000', mainStats: { 4: 'critRate' } })
    const highBase = disc({ twoPieceSetId: '31000', mainStats: { 4: 'critRate' } })
    const high = panelFor('1481', { discConfig: highDisc })
    const highNoSet = panelFor('1481', { discConfig: highBase })
    expect(high.inCombat.critRate).toBeGreaterThanOrEqual(50)
    expect(high.inCombat.critDmg - highNoSet.inCombat.critDmg).toBeCloseTo(30, 6)
    expect(getStunBuildUpBonus(high.inCombat, 'basic') - getStunBuildUpBonus(highNoSet.inCombat, 'basic')).toBeCloseTo(5, 6)
  })

  it('全队锐化增伤 +8：只有击破装备者才给队友，非击破装备者不给', () => {
    const stunBase = runTeam('1481')
    const stun = runTeam('1481', { discConfig: disc({ fourPieceSetId: '34400v1' }) })
    expect((stun.target.inCombat.sharpDmgBonus ?? 0) - (stunBase.target.inCombat.sharpDmgBonus ?? 0)).toBeCloseTo(8, 6)

    const attackBase = runTeam('1601')
    const attack = runTeam('1601', { discConfig: disc({ fourPieceSetId: '34400v1' }) })
    expect((attack.target.inCombat.sharpDmgBonus ?? 0) - (attackBase.target.inCombat.sharpDmgBonus ?? 0)).toBeCloseTo(0, 6)
  })
})
