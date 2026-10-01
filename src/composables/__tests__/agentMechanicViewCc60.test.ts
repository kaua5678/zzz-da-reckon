/**
 * CC-60：自动失衡轴「章」档位 / 「有琉优先」→ 模块声明 axisPresetChapterOwner / axisPresetPreferred。
 * 对照 = 原 data/stunAxisPresets.ts#selectAutoStunAxisPreset 与 StunAxisPage 写死（伊德海莉 1051 / 琉音 1481）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { teamAxisPresetChapterOwnerSlot, teamHasAxisPresetPreferred } from '@/composables/agentMechanicView'
import { AUTO_AXIS_PRESET_HINTS } from '@/mechanics'
import { matchStunAxisPresets, selectAutoStunAxisPreset, stunAxisPresets, type StunAxisPreset } from '@/data/stunAxisPresets'

/** 原实现逐字（写死 id） */
function legacySelect(team: (string | undefined | null)[], cinemaBySlot: Record<number, number>, presets: StunAxisPreset[] = stunAxisPresets): StunAxisPreset | null {
  const ids = team.slice(0, 3)
  if (ids.length < 3 || ids.some(id => !id)) return null
  const matched = presets.filter(p => matchStunAxisPresets(ids, [p]).length > 0)
  if (matched.length === 0) return null
  let candidates = matched
  const yidhariSlot = ids.indexOf('1051')
  if (yidhariSlot >= 0) {
    const chapter = (cinemaBySlot[yidhariSlot] ?? 0) >= 1 ? 1 : 0
    const filtered = matched.filter(p => p.chapter === undefined || p.chapter === chapter)
    if (filtered.length > 0) candidates = filtered
  }
  const lukys = candidates.filter(p => p.team.includes('1481'))
  if (lukys.length > 0) candidates = lukys
  const plans = candidates.filter(p => p.plans && p.plans.length > 0)
  if (plans.length > 0) candidates = plans
  return candidates[0] ?? null
}

describe('CC-60 自动失衡轴选档提示 → 模块声明', () => {
  it('全 catalog 角色：提示 / 槽位 / 有琉 == 原写死', async () => {
    const { catalog } = await setupHarness([{ agentId: '1051' }, { agentId: '1481' }, ''])
    const ids = [...new Set(['', ...catalog.agentsMap.keys()])]
    expect(ids.length).toBeGreaterThan(30)
    let hc = 0, hp = 0
    for (const id of ids) {
      if (id) {
        expect(AUTO_AXIS_PRESET_HINTS.isChapterOwner(id), id).toBe(id === '1051')
        expect(AUTO_AXIS_PRESET_HINTS.isPreferred(id), id).toBe(id === '1481')
      }
      for (const pos of [0, 1, 2]) {
        const team = [{ agentId: '1211' }, { agentId: '' }, { agentId: '1051' }]
        team[pos] = { agentId: id }
        const slot = teamAxisPresetChapterOwnerSlot(team)
        expect(slot, `${id}@${pos}`).toBe(team.findIndex(c => c.agentId === '1051'))
        const liu = teamHasAxisPresetPreferred(team)
        expect(liu, `${id}@${pos}`).toBe(team.some(c => c.agentId === '1481'))
        if (slot === pos) hc++
        if (liu) hp++
      }
    }
    expect(hc).toBeGreaterThan(0)
    expect(hp).toBe(3)
  }, 60000)

  it('selectAutoStunAxisPreset(+模块提示) == 原实现：全部真实预设队伍 × 通配替换 × 命座', async () => {
    const { catalog } = await setupHarness([{ agentId: '1051' }, '', ''])
    const pool = ['1051', '1481', '1451', '1391', '1421', '1531', '1211', ...[...catalog.agentsMap.keys()].slice(0, 6)]
    const teams = new Set<string>()
    for (const p of stunAxisPresets) {
      for (const w of pool) teams.add(p.team.map(x => (x === '*' ? w : x)).join(','))
    }
    for (const a of ['1051', '1481']) for (const b of pool) for (const c of pool) teams.add([a, b, c].join(','))
    let hits = 0, diffNoHints = 0
    for (const key of teams) {
      const team = key.split(',')
      for (const cin of [0, 1, 6]) {
        const cinemaBySlot: Record<number, number> = { 0: cin, 1: cin, 2: cin }
        const want = legacySelect(team, cinemaBySlot)?.id ?? null
        expect(selectAutoStunAxisPreset(team, cinemaBySlot, undefined, AUTO_AXIS_PRESET_HINTS)?.id ?? null, `${key}/${cin}`).toBe(want)
        if (want) hits++
        if ((selectAutoStunAxisPreset(team, cinemaBySlot)?.id ?? null) !== want) diffNoHints++
      }
    }
    expect(hits).toBeGreaterThan(10)
    expect(diffNoHints).toBeGreaterThan(0) // 提示确实在起作用（不传提示会与原实现不同）
  }, 60000)

  it('源码锁：StunAxisPage 脚本与 selectAutoStunAxisPreset 不再写死 1051/1481；生产入口传模块提示', () => {
    const page = readFileSync(resolve(__dirname, '../../views/StunAxisPage.vue'), 'utf-8')
    const script = page.slice(page.indexOf('<script'))
    for (const id of ['1051', '1481']) expect(script).not.toContain(`'${id}'`)
    const data = readFileSync(resolve(__dirname, '../../data/stunAxisPresets.ts'), 'utf-8')
    const fn = data.slice(data.indexOf('export function selectAutoStunAxisPreset'))
    const body = fn.slice(0, fn.indexOf('\n}\n'))
    for (const id of ['1051', '1481']) expect(body).not.toContain(`'${id}'`)
    const ri = readFileSync(resolve(__dirname, '../resourceCalc/roundInputs.ts'), 'utf-8')
    // CC-349：生产入口收敛为 data#autoStunAxisPresetOf（roundInputs 与 UI store 保底预填同一选择口径），两处都传模块提示
    expect(ri).toContain('autoStunAxisPresetOf(configStore, AUTO_AXIS_PRESET_HINTS)')
    const store = readFileSync(resolve(__dirname, '../../stores/config.ts'), 'utf-8')
    expect(store).toMatch(/autoStunAxisPresetOf\([^\n]*, AUTO_AXIS_PRESET_HINTS\)/)
    const af = data.slice(data.indexOf('export function autoStunAxisPresetOf'))
    expect(af.slice(0, af.indexOf('\n}\n'))).toContain('cinemaBySlot, presets, hints)')
  })
})
