/**
 * CC-342（arena-D 第 363 轮）：Boss 房间上下文唯一写入口 `bossRoom#applyBossRoom`。
 * 分析见 docs/mcp-boss-room-context.md §1.2 / §3。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyBossRoom, findBossBrief } from '@/composables/bossRoom'
import { createEngineOracle } from '@/composables/pullPlannerEngine'
import type { BossPreset, BossPresetFile, PhaseView } from '@/types/bossPreset'

const bp = JSON.parse(
  readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8'),
) as BossPresetFile
const presets = bp.bosses as BossPreset[]
const phaseViews = (bp.phaseViews ?? []) as PhaseView[]

/** 找一个带数值关卡 buff 的 (Boss, 期)：真数据里 148/159 个 brief 有 */
function roomWithLayerBuff() {
  for (const v of phaseViews) {
    for (const b of [...(v.criticalAssault ? [v.criticalAssault] : []), ...(v.defense ?? [])]) {
      const preset = presets.find(p => p.id === b.presetId)
      const phase = preset?.phases.find(p => p.phaseId === v.phaseId)
      if (preset && phase && (b.bossBuffs ?? []).some(c => (c.effects ?? []).some(e => e.stat))) return { preset, phase, brief: b }
    }
  }
  throw new Error('no room with layer buff')
}

const layerRows = (rows: { id: string | number }[]) => rows.filter(r => String(r.id).startsWith('layer-buff:'))
const STALE = { id: 'layer-buff:stale:atkPct:99', name: '关卡·上一个 Boss', stat: 'atkPct', value: 99, enabled: true }

describe('bossRoom', () => {
  it('findBossBrief：按 (phaseId, presetId) 唯一定位；期或 Boss 不在 ⇒ null', () => {
    const { preset, phase, brief } = roomWithLayerBuff()
    expect(findBossBrief(phaseViews, phase.phaseId, preset.id)).toBe(brief)
    expect(findBossBrief(phaseViews, '999999', preset.id)).toBeNull()
    expect(findBossBrief(phaseViews, phase.phaseId, '40404')).toBeNull()
    expect(findBossBrief([], phase.phaseId, preset.id)).toBeNull()
  })

  it('applyBossRoom：清掉旧 layer-buff 行、写入该期该 Boss 的；无 brief 时只清不写', async () => {
    const { config } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }])
    const { preset, phase, brief } = roomWithLayerBuff()
    config.globalBuffs.push({ ...STALE } as never)
    expect(applyBossRoom(config, preset, phase, phaseViews)).toBe(brief)
    const rows = layerRows(config.globalBuffs)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some(r => r.id === STALE.id)).toBe(false)
    expect(config.appliedBoss?.presetId).toBe(preset.id)
    applyBossRoom(config, preset, phase, [])
    expect(layerRows(config.globalBuffs)).toEqual([])
  }, 60000)

  it('抽卡规划逐房也写关卡 buff（修前只切敌人，用户现场的 layer-buff 行泄漏进每一房）', async () => {
    const { config } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }])
    const { preset, phase, brief } = roomWithLayerBuff()
    config.globalBuffs.push({ ...STALE } as never)
    const engine = createEngineOracle({ calc: useResourceCalc(), bosses: [preset], periodViews: phaseViews, candidatePool: [] })
    engine.applyPeriodContext({ id: phase.phaseId, label: '', date: '', bosses: [{ bossId: preset.id, phaseId: phase.phaseId, bossName: preset.name, hp: phase.hp }] })
    const rows = layerRows(config.globalBuffs)
    expect(rows.some(r => r.id === STALE.id)).toBe(false)
    expect(rows.every(r => String(r.id).startsWith(`layer-buff:${brief.monsterId}:`))).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
  }, 60000)

  it('源码锁：applyBossPreset 只经 bossRoom 调用；未迁移的分析器列在白名单里（CC-342 第 3 步待定口径）', () => {
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
    // 第 3 步（docs/mcp-boss-room-context.md §3）：这些分析器「不写不清」关卡 buff，口径待定后迁移并从这里删掉
    const PENDING_STEP3 = [
      'composables/difficultyCurve.ts',
      'composables/freeCompare/engine.ts',
      'composables/positionCompare.ts',
      'composables/teamCompare.ts',
      'composables/teamTimeline.ts',
    ]
    expect(hits.sort()).toEqual(['composables/bossRoom.ts', ...PENDING_STEP3].sort())
  })
})
