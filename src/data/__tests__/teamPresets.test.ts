import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { classifyPreset } from '../../../scripts/lib/presetCategories.mjs'
import { teamPresets, teamPresetGroupOptions, UNGROUPED_LABEL, PRESET_UNGROUPED_SUB, presetSubgroupLabelsFor, presetsForFilter } from '@/data/teamPresets'

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

  it('带琉音的预设都有对应的诺姆版队伍（琉音→诺姆，其余成员不变；auto- 孪生也算，手编优先）', () => {
    const key = (team: string[]) => [...team].sort().join('|')
    // 诺姆版队伍：手编优先，手编没有时认 auto- 孪生。2026-09-11 删掉 8 条与 auto- 完全重复的手编预设后，
    // 般岳+诺姆+卢西娅 这一版只剩 `auto-1471-1571-1451`（来源 = 实战顶分归档）——规则仍成立。
    const byReplacedTeam = new Map<string, (typeof teamPresets)[number]>()
    for (const p of teamPresets) {
      if (!p.team.includes(NORMA)) continue
      const k = key(p.team.map(id => (id === NORMA ? LIUYIN : id)))
      const prev = byReplacedTeam.get(k)
      if (!prev || (prev.id.startsWith('auto-') && !p.id.startsWith('auto-'))) byReplacedTeam.set(k, p)
    }
    // 手编琉音队 = 般琉卢的 2 个难度变体（普通轴 / 5嗔火10大）；其余 4 条手编琉音队与 auto- 孪生重复，已删
    const liuyinPresets = teamPresets.filter(p => p.team.includes(LIUYIN) && !p.id.startsWith('auto-'))
    expect(liuyinPresets.length).toBe(2)
    for (const liuyinPreset of liuyinPresets) {
      const normaTwin = byReplacedTeam.get(key(liuyinPreset.team))
      expect(normaTwin, `缺少 ${liuyinPreset.id} 的诺姆版队伍`).toBeDefined()
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

describe('预设分组（两级下拉：分类 → 队伍）', () => {
  it('每个预设都有非空 group，不落「未分组」（新预设必须归类）', () => {
    for (const preset of teamPresets)
      expect(preset.group?.trim(), `${preset.id} 缺一级分类 group（下拉第一级）`).toBeTruthy()
    expect(teamPresetGroupOptions.some(o => 'label' in o && o.label === UNGROUPED_LABEL)).toBe(false)
  })

  it('分组 options 恰好覆盖全部预设，组内成员与 preset.group 一致且无空组', () => {
    type Option = (typeof teamPresetGroupOptions)[number]
    const isGroup = (o: Option): o is { type: 'group'; label: string; children: { value: string; label: string }[] } =>
      (o as { type?: unknown }).type === 'group'
    const groups = teamPresetGroupOptions.filter(isGroup)
    expect(groups.length).toBeGreaterThan(0)
    const ids = groups.flatMap(g => g.children.map(c => c.value)).sort()
    expect(ids).toEqual(teamPresets.map(p => p.id).sort())
    for (const g of groups) {
      expect(g.children.length).toBeGreaterThan(0)
      for (const c of g.children) {
        const preset = teamPresets.find(p => p.id === c.value)!
        expect(preset, `选项 ${c.value} 无对应预设`).toBeTruthy()
        expect(c.label).toBe(preset.name)
        expect(g.label, `${preset.id} 归组与 preset.group/subgroup 合成不一致`).toBe([preset.group, preset.subgroup].filter(Boolean).join(' · '))
      }
    }
  })

  // 用户裁决 2026-09-08：一级分类只允许「输出定位」的队名；击破/支援/防护是辅助位，
  // 「他们是辅助，怎么能作为一个命名呢」→ 这两个分类从菜单里删除（口径单源
  // scripts/lib/presetCategories.mjs，validate:data 逐条重算护栏）。
  it('一级分类只含输出定位队名（击破队/支援队/防护队 不许出现）', () => {
    expect([...new Set(teamPresets.map(p => p.group))].sort()).toEqual(
      ['命破队', '强攻队', '锋御队', '异常队'].sort(),
    )
    for (const p of teamPresets) {
      expect(['击破队', '支援队', '防护队'], `${p.id} 用了辅助位当一级分类`).not.toContain(p.group)
    }
  })

  // 二级=主C属性（用户「自动按主C属性分」）。手编预设漏填 subgroup 曾让「命破·火」
  // 只出 1 条自动队，般岳其余配队全掉进「未分属性」。
  it('每条预设都有二级分类，不落「未分属性」兜底桶', () => {
    for (const p of teamPresets)
      expect(p.subgroup?.trim(), `${presetDesc(p)} 缺二级分类 subgroup`).toBeTruthy()
    for (const group of new Set(teamPresets.map(p => p.group?.trim() ?? '')))
      expect(presetSubgroupLabelsFor(group), `${group} 不该出现「未分属性」`).not.toContain(PRESET_UNGROUPED_SUB)
  })

  it('筛选按主C归类：选「命破队·火」出般岳全部预设配队（含手编，不只是自动收录那条）', () => {
    const fire = presetsForFilter('命破队', '火')
    const banyue = teamPresets.filter(p => p.team[0] === '1471')
    expect(banyue.length, '般岳预设不该少于 6 条').toBeGreaterThanOrEqual(6)
    expect(fire.map(p => p.id).sort(), '般岳系（火主C）应全部落在 命破队·火')
      .toEqual(expect.arrayContaining(banyue.map(p => p.id).sort()))
    // 反向：别的属性组里不该混进般岳队
    for (const sub of presetSubgroupLabelsFor('命破队').filter(s => s !== '火'))
      expect(presetsForFilter('命破队', sub).some(p => p.team[0] === '1471'), `般岳队漏进 命破队·${sub}`).toBe(false)
  })

  it('锋御队已收录（克拉蕾主C 两条：击破位 珂蕾妲 / 洛克茜，支援位 丽娜）', () => {
    const fengyu = teamPresets.filter(p => p.group === '锋御队')
    expect(fengyu.map(p => p.id).sort()).toEqual(['claret-koleda-rina', 'claret-roxy-rina'])
    for (const p of fengyu) {
      expect(p.team[0], '锋御队主C 必须是克拉蕾').toBe('1611')
      expect(p.team[2], '第三位固定丽娜').toBe('1211')
      expect(p.subgroup, '克拉蕾=电 → 二级按主C属性').toBe('电')
    }
    expect(fengyu.map(p => p.team[1]).sort()).toEqual(['1101', '1621'])
  })

  it('辅助位带队的自动预设按队内输出位归类（旧版会塞进「支援队/击破队」）', () => {
    // 耀嘉音(支援)+希希芙(强攻)+扳机 → 强攻队·电；南宫羽(击破)+维琳娜(异常)+柚叶 → 异常队·风
    expect(pick('auto-1311-1521-1361')).toMatchObject({ group: '强攻队', subgroup: '电' })
    expect(pick('auto-1511-1561-1411')).toMatchObject({ group: '异常队', subgroup: '风' })
    expect(pick('auto-1411-1171-1561')).toMatchObject({ group: '异常队', subgroup: '火' })
    // 朱鸢特化修正（原文=强攻）后，她的自动收录队落强攻队·以太，不再是「击破队」
    expect(pick('auto-1241-1031-1311')).toMatchObject({ group: '强攻队', subgroup: '以太' })
    // 流明属性预设不再写原始英文键
    expect(pick('auto-1581-1261-1561').subgroup).toBe('流明')
  })

  // 分类口径单源 = scripts/lib/presetCategories.mjs（validate:data 用它护栏，这里再跑一遍）
  it('每条预设的 group/subgroup 都等于按分类口径重算的结果（含输出核心判定）', () => {
    for (const p of teamPresets) {
      const verdict = classifyPreset(p.team as string[], agentOf)
      expect(verdict, `${presetDesc(p)} 队内无输出位，不该作为预设存在`).toBeTruthy()
      expect([p.group, p.subgroup], `${presetDesc(p)} 分类与口径不符（跑 node scripts/sync-preset-categories.mjs）`)
        .toEqual([verdict!.group, verdict!.subgroup])
    }
  })
})

const presetDesc = (p: { id: string; name: string }) => `${p.id}（${p.name}）`
const pick = (id: string) => {
  const p = teamPresets.find(x => x.id === id)
  if (!p) throw new Error(`预设 ${id} 不存在（被删了？分类断言要同步）`)
  return p
}
const agentById = new Map<string, any>(catalog.agents.map((a: any) => [String(a.id), a]))
const agentOf = (id: string) => agentById.get(String(id))
