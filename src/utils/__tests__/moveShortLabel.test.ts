/**
 * 招式短标签（窄容器）——「一个名字认不出是哪招」的回归锁（2026-10-29）。
 *
 * 用户报（逐字）：「挽昼的失衡轴我根本看不清哪个招式是什么名字，**全是一个名字**。
 * 前面的招式名简写一下，**强特就是强特**。」
 *
 * 根因 = 轴编辑器把目录招式名 `.slice(0, 8)`：8 个字里前 6 个被「强化特殊技：」这类前缀吃掉，
 * 只剩 2 个字给招式本体。全 catalog 实测 **233 组重名**；挽昼(1601) 的四个强化特殊技直接塌成 2 个。
 *
 * 本测试钉三件事：
 *  ① 挽昼那四个强特必须两两不同（用户点名的那个 case，且**留一条反证**：旧 8 字口径确实塌了）；
 *  ② 前缀压短、本体一字不动（「强特就是强特」）；
 *  ③ catalog 全量不变量：**同角色内**不同招式名的短标签必须仍然不同 —— 这条能拦住任何
 *     「再砍一刀省点宽度」的后续改动（棋盘哨兵，不是快照）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { shortMoveLabel } from '@/utils/moveShortLabel'
import { SKILL_DMG_TARGET_LABELS, SKILL_DMG_TARGET_SHORT_LABELS } from '@/data/skillDamageTargets'

interface CatalogMove { id: string; name?: { zhCN?: string } }
interface CatalogAgentSkills {
  agentId: string
  categories: { moves: CatalogMove[] }[]
}

const catalog = JSON.parse(
  readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'),
) as { agentSkills: CatalogAgentSkills[] }

const agentSkills = (agentId: string) => catalog.agentSkills.find(a => a.agentId === agentId)!
const movesOf = (agentId: string): CatalogMove[] =>
  agentSkills(agentId).categories.flatMap(c => c.moves)
const nameOf = (agentId: string, moveId: string) =>
  movesOf(agentId).find(m => m.id === moveId)?.name?.zhCN ?? ''

describe('招式短标签', () => {
  it('压前缀、留本体：强特就是强特', () => {
    expect(shortMoveLabel('强化特殊技：燃灯·永昼之炬')).toBe('强特：燃灯·永昼之炬')
    expect(shortMoveLabel('普通攻击：执旌')).toBe('普攻：执旌')
    expect(shortMoveLabel('终结技：「此愿，重塑万象」')).toBe('终结：「此愿，重塑万象」')
    expect(shortMoveLabel('快速支援：锋芒所向')).toBe('快支：锋芒所向')
    // 半角冒号同样识别（模块自造名 / 手工预设里出现过）；分隔符统一成全角「：」，
    // 免得同一个招式在两个容器里长得不一样
    expect(shortMoveLabel('特殊技:焚夜')).toBe('特技：焚夜')
  })

  it('★ 挽昼四个强化特殊技两两不同（用户报的「全是一个名字」）', () => {
    // 1601106 焚夜·曦生 / 1601016 焚夜·曦生（改） / 1601006 燃灯·晦尽 / 1601115 燃灯·晦尽（改）
    const ids = ['1601106', '1601016', '1601006', '1601115']
    const full = ids.map(id => nameOf('1601', id))
    for (const n of full) expect(n, '目录里找不到挽昼的强特名，本用例失效').toContain('强化特殊技')
    // 反证：旧口径（砍 8 个字）确实把它们压成了同一个名字 —— 这条挂了说明根因描述过期了
    expect(new Set(full.map(n => n.slice(0, 8))).size, '旧 8 字口径应当塌成 2 个名字').toBeLessThan(4)
    const labels = full.map(n => shortMoveLabel(n))
    expect(labels.every(l => l.startsWith('强特：')), `短标签未生效：${labels.join(' / ')}`).toBe(true)
    expect(new Set(labels).size, `四个强特必须两两不同，实测 ${labels.join(' / ')}`).toBe(4)
    // 变体后缀是唯一区分点，不许被顺手剥掉
    expect(labels.some(l => l.includes('（改）')), '（改）变体后缀被吃掉了').toBe(true)
  })

  it('catalog 全量：同角色内不同招式名的短标签不得重合', () => {
    const clashes: string[] = []
    for (const a of catalog.agentSkills) {
      const byShort = new Map<string, Set<string>>()
      for (const m of a.categories.flatMap(c => c.moves)) {
        const zh = m.name?.zhCN
        if (!zh) continue
        const key = shortMoveLabel(zh)
        const fulls = byShort.get(key) ?? new Set<string>()
        fulls.add(zh)
        byShort.set(key, fulls)
      }
      for (const [short, fulls] of byShort) {
        if (fulls.size > 1) clashes.push(`${a.agentId}: 「${short}」 ← ${[...fulls].join(' / ')}`)
      }
    }
    expect(clashes, `短标签还在制造重名（${clashes.length} 组）:\n${clashes.slice(0, 12).join('\n')}`).toEqual([])
  })

  it('招式族短名表与全名表同键（同表语义：改全名必须同时改短名）', () => {
    expect(Object.keys(SKILL_DMG_TARGET_SHORT_LABELS).sort()).toEqual(Object.keys(SKILL_DMG_TARGET_LABELS).sort())
    for (const [k, short] of Object.entries(SKILL_DMG_TARGET_SHORT_LABELS)) {
      expect(short.length, `${k} 的短标签没比全名短`).toBeLessThan((SKILL_DMG_TARGET_LABELS as Record<string, string>)[k].length)
    }
  })

  it('无前缀 / 空前缀 / 未登记前缀：原样返回，不猜不砍', () => {
    expect(shortMoveLabel('论道')).toBe('论道')            // 连段块（模块自造名）
    expect(shortMoveLabel('单次')).toBe('单次')
    expect(shortMoveLabel('玄墨：whatever')).toBe('玄墨：whatever') // 未登记前缀不动
    expect(shortMoveLabel('强化特殊技：')).toBe('强化特殊技：')     // 空前缀不动
    expect(shortMoveLabel('')).toBe('')
    expect(shortMoveLabel(undefined, '1234567')).toBe('1234567')   // 空名回落 moveId，不编名字
  })
})
