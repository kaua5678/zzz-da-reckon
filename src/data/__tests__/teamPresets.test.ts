import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { teamPresets } from '@/data/teamPresets'

const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')
const catalog = JSON.parse(catalogText) as {
  agents: { id: string }[]
  wEngines: { id: string; ownerAgentId?: string }[]
}
const agentIds = new Set(catalog.agents.map(a => a.id))
const wEngineIds = new Set(catalog.wEngines.map(w => w.id))

const LIUYIN = '1481'
const NORMA = '1571'

describe('teamPresets 预设队伍库', () => {
  it('每个预设的角色/音擎 id 都存在于 catalog，槽位与步数合法', () => {
    expect(teamPresets.length).toBeGreaterThan(0)
    for (const preset of teamPresets) {
      for (const agentId of preset.team) {
        expect(agentIds.has(agentId), `${preset.id} 角色 ${agentId} 不在 catalog`).toBe(true)
      }
      if (preset.wEngines) {
        expect(preset.wEngines).toHaveLength(3)
        for (const wEngineId of preset.wEngines) {
          if (wEngineId === '') continue // '' = 自动推荐
          expect(wEngineIds.has(wEngineId), `${preset.id} 音擎 ${wEngineId} 不在 catalog`).toBe(true)
        }
      }
      for (const step of [...preset.goldSteps, ...(preset.standardSteps ?? [])]) {
        expect(step.slot, `${preset.id} 步骤槽位越界`).toBeGreaterThanOrEqual(0)
        expect(step.slot, `${preset.id} 步骤槽位越界`).toBeLessThanOrEqual(2)
      }
    }
  })

  it('预设 id 唯一', () => {
    const ids = teamPresets.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('带琉音的预设都有对应的诺姆复制版（琉音→诺姆，其余成员不变）', () => {
    const key = (team: string[]) => [...team].sort().join('|')
    const byReplacedTeam = new Map(
      teamPresets
        .filter(p => p.team.includes(NORMA))
        .map(p => [key(p.team.map(id => (id === NORMA ? LIUYIN : id))), p]),
    )
    // 般琉卢带 2 个难度变体（普通轴 / 5嗔火10大）展开成 2 条 → 琉音队共 5 条
    const liuyinPresets = teamPresets.filter(p => p.team.includes(LIUYIN))
    expect(liuyinPresets.length).toBe(5)
    for (const liuyinPreset of liuyinPresets) {
      const normaTwin = byReplacedTeam.get(key(liuyinPreset.team))
      expect(normaTwin, `缺少 ${liuyinPreset.id} 的诺姆复制版`).toBeDefined()
    }
  })

  it('难度变体（队伍分类）：带 variants 的预设展开成独立条目，本体不再单独出现', () => {
    const ids = teamPresets.map(p => p.id)
    expect(ids).not.toContain('banyue-liuyin-lucia')
    const normal = teamPresets.find(p => p.id === 'banyue-liuyin-lucia__normal')
    const wrath = teamPresets.find(p => p.id === 'banyue-liuyin-lucia__wrath5-ult10')
    expect(normal).toBeDefined()
    expect(wrath).toBeDefined()
    for (const v of [normal!, wrath!]) {
      expect(v.name).toContain('般岳+琉音+卢西娅·')
      // 队伍/音擎/加金步与本体共用（金数口径不变）
      expect(v.team).toEqual(['1471', '1481', '1451'])
      expect(v.wEngines).toEqual(['14147', '14148', '14145'])
      expect(v.goldSteps.length).toBeGreaterThan(0)
      expect(v.interactions.length).toBeGreaterThan(0)
      // 展开标记：指向源预设（保存回写 goldSteps 时重定向到源文件）
      expect(v.variantOf).toBe('banyue-liuyin-lucia')
      expect(v.variants).toBeUndefined()
    }
    expect(normal!.name).toContain('普通轴')
    expect(normal!.stunAxisPresetId).toBe('preset-1471-1481-1451')
    expect(wrath!.name).toContain('5嗔火10大')
    // 5嗔火10大 达成条件记在 note：5 次嗔火 + 琉音回能高（好评 ≥390 → 10 大）
    expect(wrath!.note).toContain('好评 ≥390')
  })

  it('诺姆复制版的专武随角色替换（专武 14157 首席跟班，或常驻击破音擎）', () => {
    const normaSig = catalog.wEngines.find(w => w.ownerAgentId === NORMA)!.id
    expect(normaSig).toBe('14157')
    for (const preset of teamPresets.filter(p => p.team.includes(NORMA))) {
      const slot = preset.team.indexOf(NORMA)
      const wEngineId = preset.wEngines?.[slot]
      if (wEngineId && wEngineId !== '') {
        // 用了专武（限定，计入基础金）或常驻击破音擎（不计金），二选一由 note 口径决定
        expect(['14157', '14110'], `${preset.id} 诺姆音擎 ${wEngineId} 口径待确认`).toContain(wEngineId)
      }
    }
  })
})
