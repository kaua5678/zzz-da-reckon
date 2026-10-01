/**
 * CC-342：Boss 房间上下文唯一写入口 `bossRoom#applyBossRoom`（第 363 轮立入口；第 364 轮关卡 buff 改为随 phase 数据走，
 * 5 个分析器迁入）。分析见 docs/mcp-boss-room-context.md。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { applyBossRoom } from '@/composables/bossRoom'
import { createEngineOracle } from '@/composables/pullPlannerEngine'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { applyBuffToStore } from '@/composables/teamCompare'
import type { BossPreset, BossPresetFile, PhaseView } from '@/types/bossPreset'

const bp = JSON.parse(
  readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8'),
) as BossPresetFile
const presets = bp.bosses as BossPreset[]
const phaseViews = (bp.phaseViews ?? []) as PhaseView[]
const briefsOf = (v: PhaseView) => [...(v.criticalAssault ? [v.criticalAssault] : []), ...(v.defense ?? [])]

/** 找一个带数值关卡 buff 的 (Boss, 期) */
function roomWithLayerBuff() {
  for (const preset of presets) {
    for (const phase of preset.phases) {
      if ((phase.layerBuffs ?? []).some(c => (c.effects ?? []).some(e => e.stat))) return { preset, phase }
    }
  }
  throw new Error('no room with layer buff')
}

const layerRows = (rows: { id: string | number }[]) => rows.filter(r => String(r.id).startsWith('layer-buff:'))
const STALE = { id: 'layer-buff:stale:atkPct:99', name: '关卡·上一个 Boss', stat: 'atkPct', value: 99, enabled: true }

describe('bossRoom', () => {
  it('数据锁：每个预设 phase 都有 layerBuffs，且与期视图同一关的 brief.bossBuffs 完全一致（生成脚本同一次解析）', () => {
    for (const p of presets) for (const ph of p.phases) expect(Array.isArray(ph.layerBuffs), `${p.id}/${ph.phaseId}`).toBe(true)
    let matched = 0
    for (const v of phaseViews) {
      for (const b of briefsOf(v)) {
        if (!b.presetId) continue
        const phase = presets.find(p => p.id === b.presetId)?.phases.find(ph => ph.phaseId === v.phaseId)
        expect(phase, `${b.presetId}/${v.phaseId}`).toBeTruthy()
        expect(phase!.layerBuffs, `${b.presetId}/${v.phaseId}`).toEqual(b.bossBuffs ?? [])
        matched++
      }
    }
    expect(matched).toBeGreaterThan(100)
  })

  it('applyBossRoom：清掉旧 layer-buff 行、写入该 phase 的；phase 无 layerBuffs 时只清不写', async () => {
    const { config } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }])
    const { preset, phase } = roomWithLayerBuff()
    config.globalBuffs.push({ ...STALE } as never)
    applyBossRoom(config, preset, phase)
    const rows = layerRows(config.globalBuffs)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => String(r.id).startsWith(`layer-buff:${preset.id}:${phase.phaseId}:`))).toBe(true)
    expect(config.appliedBoss?.presetId).toBe(preset.id)
    applyBossRoom(config, preset, { ...phase, layerBuffs: undefined })
    expect(layerRows(config.globalBuffs)).toEqual([])
  }, 60000)

  it('抽卡规划逐房也写关卡 buff（第 362 轮前只切敌人，用户现场的 layer-buff 行泄漏进每一房）', async () => {
    const { config } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }])
    const { preset, phase } = roomWithLayerBuff()
    config.globalBuffs.push({ ...STALE } as never)
    const before = JSON.stringify(config.globalBuffs.map(r => r.id))
    // r372：规划跑在独立场景上 ⇒ 关卡 buff 写进场景，UI store 的全局 Buff 一行都不该被碰
    await withAnalysisScenario(scenario => {
      const engine = createEngineOracle({ scenario, bosses: [preset], candidatePool: [] })
      engine.applyPeriodContext({ id: phase.phaseId, label: '', date: '', bosses: [{ bossId: preset.id, phaseId: phase.phaseId, bossName: preset.name, hp: phase.hp }] })
      const rows = layerRows(scenario.config.globalBuffs)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every(r => String(r.id).startsWith(`layer-buff:${preset.id}:${phase.phaseId}:`))).toBe(true)
    })
    expect(JSON.stringify(config.globalBuffs.map(r => r.id))).toBe(before)
  }, 60000)

  it('队伍对比换牌：整表替换成所选牌，但保留关卡 buff 行（第 364 轮前连关卡 buff 一起清掉）', async () => {
    const { config } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }])
    const { preset, phase } = roomWithLayerBuff()
    applyBossRoom(config, preset, phase)
    const layer = layerRows(config.globalBuffs).map(r => r.id)
    config.globalBuffs.push({ id: 'user:x', name: '用户手填', stat: 'atkPct', value: 5, enabled: true } as never)
    applyBuffToStore(config, { title: '牌', testOnly: false, effects: [{ stat: 'atkPct', value: 10 }], unparsed: [] })
    expect(layerRows(config.globalBuffs).map(r => r.id)).toEqual(layer)
    expect(config.globalBuffs.some(r => r.id === 'user:x')).toBe(false)
    expect(config.globalBuffs.filter(r => String(r.id).startsWith('phase-buff:')).length).toBe(1)
    applyBuffToStore(config, null)
    expect(config.globalBuffs.map(r => r.id)).toEqual(layer)
  }, 60000)

  it('CC-350：进房间写敌方体型 = Boss 体型，未录入按中型', async () => {
    const { config } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }])
    const sized = presets.find(p => p.bodySize && p.bodySize !== 'medium')
    const unsized = presets.find(p => !p.bodySize)
    expect(sized, '数据里应有录了非中型体型的 Boss').toBeTruthy()
    expect(unsized, '数据里应有未录体型的 Boss').toBeTruthy()
    config.setEnemy({ bodySize: 'small' })
    applyBossRoom(config, sized!, sized!.phases[0]!)
    expect(config.enemy.bodySize).toBe(sized!.bodySize)
    applyBossRoom(config, unsized!, unsized!.phases[0]!)
    expect(config.enemy.bodySize).toBe('medium')
  }, 60000)

  it('CC-350 源码锁：页面不再自己写敌方体型（体型只经房间入口 / 属性页手改）', () => {
    const page = readFileSync(join(__dirname, '..', '..', 'views', 'TeamComparePage.vue'), 'utf8')
    expect(page).not.toMatch(/setEnemy\(\{\s*bodySize/)
  })

  it('源码锁：applyBossPreset 只经 bossRoom 调用（所有分析器都进同一种房间）', () => {
    const root = join(__dirname, '..', '..')
    const hits: string[] = []
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f)
        if (statSync(p).isDirectory()) { if (f !== '__tests__') walk(p); continue }
        if (!/\.(ts|vue)$/.test(f)) continue
        if (/\.applyBossPreset\(/.test(readFileSync(p, 'utf8'))) hits.push(relative(root, p).split('\\').join('/'))
      }
    }
    walk(root)
    expect(hits).toEqual(['composables/bossRoom.ts'])
  })
})
