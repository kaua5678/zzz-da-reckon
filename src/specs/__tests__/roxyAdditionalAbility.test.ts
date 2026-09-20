/**
 * 洛克茜(1621) 额外能力·辉金心脏 —— **声明面与原文逐条对账**（R56 结清 §R55-J2 横向排查）。
 *
 * ## 缺陷（R56 机械扫描 + 外部复核发现）
 *
 * `spec/1621.json` 的 `additionalAbility` 两处与 v12 原文不符：
 * | | 原文（raw `passive.level.1621507.desc`） | 旧声明 | 判定 |
 * |---|---|---|---|
 * | **触发条件** | 「[强攻]角色或**[命破]角色**或[锋御]角色」 | `attack` + `sharpen`（**漏 rupture**） | **错** |
 * | **note 正文** | 造成伤害 +8%（+1.2%/级，上限 **80%**） | 「暴击伤害+10%且每级+2%，上限 **130%**」 | **错**（整条是**旧版 kit**文案） |
 *
 * ## 根因（本仓 git 历史自证，与 R55 克拉蕾同构）
 *
 * `data/raw/nanoka_1621.json`（旧版 raw，英文）原文即「CRIT DMG increases by 10% … up to a
 * maximum increase of **130%**」+ 触发条件只写 `[Attack]`/`[Armorer]` —— 即 **spec 的 note 是
 * 旧版 kit 的逐字残留**。v12（`d056e11`）把 raw 刷新成「造成伤害+8%…上限80%」并把触发条件
 * 扩为「[强攻]/[命破]/[锋御]」，但 **spec 声明没跟着重排** ⇒ 又一次「raw 文案更新 ≠ 机制重排」。
 *
 * ## 判据设计（为什么不是同义反复）
 *
 * 硬约束「跨路径恒等式先查同义反复：两边同读一个常量 ⇒ 它不是判据」⇒ 本文件**从原文出发**：
 * 直接读 `data/raw/nanoka_missing/full/1621.json` 的 `passive.level` 文本，断言
 * ① 门控词表**逐个**取自原文（原文出现 `[命破]` ⇒ spec 必须有 `rupture`），
 * ② note 的数值**等于原文数值**（80% 而非 130%），并**反锁**旧值不得复现。
 * 原文改了本测试必红，不是两边同读一个常量。
 *
 * ⚠ 行为面（面板 dmgBonus 实际取值）不在本文件——本文件的缺陷面是**声明/门控**，
 *   行为面由 `roxy.test.ts` 与 `allAgentsSweep` 覆盖。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getAgentSpec } from '@/specs/registry'
import { evalAdditionalAbility } from '@/specs/teamCondition'
import { ROXY_AA_DMG_BONUS_LV60 } from '@/mechanics/agents/roxy'
import type { Agent } from '@/types/catalog'
import type { MechanicTeamMember } from '@/mechanics/types'

/** 原文（判据的一侧钉在这里，不许只读实现常量） */
function rawPassiveText(agentId: string): string {
  const p = resolve(process.cwd(), `data/raw/nanoka_missing/full/${agentId}.json`)
  const data = JSON.parse(readFileSync(p, 'utf-8')) as {
    passive?: { level?: Record<string, { desc?: string[] }> }
  }
  const levels = data.passive?.level ?? {}
  // 取最长的一条（= 满级 Lv.7 文本，与仓库既有约定一致）
  return Object.values(levels)
    .map(v => (v.desc ?? []).join('\n'))
    .sort((a, b) => b.length - a.length)[0] ?? ''
}

const strip = (s: string) => s.replace(/<[^>]*>/g, '')

const agent = (id: string, specialty: string): Agent => ({ id, specialty } as Agent)

function member(slot: number, id: string, specialty: string): MechanicTeamMember {
  return {
    slot, agentId: id, agent: agent(id, specialty),
    cinemaLevel: 0, potentialLevel: 0, wEngineId: '', wEngineModLevel: 1,
  }
}

/** 原文 → 特化枚举（游戏词 → 代码词，规则 15：绑定关系写在一处，不靠名字联想） */
const SPECIALTY_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['[强攻]', 'attack'],
  ['[击破]', 'stun'],
  ['[异常]', 'anomaly'],
  ['[支援]', 'support'],
  ['[防护]', 'defense'],
  ['[命破]', 'rupture'],
  ['[锋御]', 'sharpen'],
]

/** 只取「额外能力触发条件」那一行（`队伍中…触发：`），避开正文里同名词的干扰 */
function triggerLine(rawText: string): string {
  const lines = strip(rawText).split('\n').map(l => l.trim())
  // ⚠ 测试服角色带 `(Test1)` 前缀 ⇒ 必须整组可选 `(?:\(Test1\))?`；
  //   写成 `\(Test1\)?` 只让右括号可选 ⇒ 反而要求字面 `(Test1`（R56 踩到）
  const gates = lines.filter(l => /^(?:\(Test1\))?队伍中/.test(l) && l.endsWith('触发：'))
  return gates[gates.length - 1] ?? ''
}

describe('洛克茜(1621) 额外能力声明 —— 门控词表钉原文', () => {
  it('原文门控出现的每个特化，spec.teamConditions 必须逐条覆盖（含 [命破]→rupture）', () => {
    const gate = triggerLine(rawPassiveText('1621'))
    // 前提：确实抓到了门控行（否则下面的断言是空转）
    expect(gate).toContain('触发：')

    const fromRaw = SPECIALTY_WORDS.filter(([zh]) => gate.includes(zh)).map(([, code]) => code)
    expect(fromRaw.length).toBeGreaterThan(0)

    const spec = getAgentSpec('1621')!.additionalAbility
    const declared = new Set(
      (spec?.teamConditions ?? [])
        .filter(c => c.type === 'specialty')
        .flatMap(c => (c as { values: string[] }).values),
    )
    // 双向锁：原文有的必须有；spec 有的必须是原文真的（防将来反向漂移）
    expect([...fromRaw].sort()).toEqual([...declared].sort())
  })

  it('行为面：[命破](rupture) 队友确实让门控为真（旧声明下必红）', () => {
    const spec = getAgentSpec('1621')!.additionalAbility
    // 1471 般岳 = 命破；旧声明只有 attack/sharpen ⇒ 本断言在旧声明下为 false
    const withRupture = [member(0, '1621', 'stun'), member(1, '1471', 'rupture')]
    expect(evalAdditionalAbility(withRupture, 0, agent('1621', 'stun'), spec)).toBe(true)
    // 负例：防护队友不满足（原文门控没有 [防护]）
    const withDefense = [member(0, '1621', 'stun'), member(1, '1171', 'defense')]
    expect(evalAdditionalAbility(withDefense, 0, agent('1621', 'stun'), spec)).toBe(false)
  })
})

describe('洛克茜(1621) 额外能力 note —— 数值钉原文（旧版 kit 文案不得复现）', () => {
  it('note 的伤害上限取原文 80%，且不含旧版 kit 的 130%/暴击伤害口径', () => {
    const rawText = strip(rawPassiveText('1621'))
    // 原文侧：v12 是「造成伤害提升8%…最多提升80%」
    expect(rawText).toContain('造成的伤害提升8%')
    expect(rawText).toContain('最多提升80%')

    const note = getAgentSpec('1621')!.additionalAbility?.note ?? ''
    expect(note).not.toBe('')
    // 与原文同值（不是两边同读一个常量：一侧是 raw 文件，一侧是 spec 声明）
    expect(note).toContain('80%')
    // 反锁：旧版 kit 口径（10%/2%/130%/暴击伤害）不得复现
    expect(note).not.toContain('130%')
    expect(note).not.toContain('暴击伤害+10%')
    // 原文的其余可核对子句也必须被 note 覆盖
    expect(note).toContain('30%')   // 失衡易伤
    expect(note).toContain('2s')    // 失衡时长延长
    expect(note).toContain('8%')    // 风化/浸染直伤
  })

  it('旧版 raw（nanoka_1621.json）确实写着 130% —— 证明 note 曾是旧 kit 残留而非笔误', () => {
    const legacy = strip(readFileSync(
      resolve(process.cwd(), 'data/raw/nanoka_1621.json'), 'utf-8',
    ))
    // 这是**根因证据**：旧 raw 里 130% 与「CRIT DMG ... 10%」逐字存在
    expect(legacy).toContain('130%')
    expect(legacy).toMatch(/CRIT DMG increases by 10%/)
    // 而 v12 raw 里已经没有 130%
    expect(strip(rawPassiveText('1621'))).not.toContain('130%')
  })
})

describe('洛克茜(1621) 额外能力伤害 —— 「每级」是**角色等级**轴（非核心被动等级）', () => {
  it('该子句在 7 条 passive.level 里逐字恒定 ⇒ 不是被动等级轴；cap 取 Lv60', () => {
    const p = resolve(process.cwd(), 'data/raw/nanoka_missing/full/1621.json')
    const data = JSON.parse(readFileSync(p, 'utf-8')) as {
      passive?: { level?: Record<string, { desc?: string[] }> }
    }
    const levels = Object.keys(data.passive?.level ?? {}).sort()
    expect(levels.length).toBe(7)

    // 机械判据：真正走被动等级轴的子句会**逐级递增**（如 1611 核心 20→50），
    // 而本条 8%/1.2%/80% 三级在所有 7 条里完全相同 ⇒ 轴是「角色等级」。
    const perLevel = levels.map(k => {
      const t = strip((data.passive!.level![k].desc ?? []).join('\n'))
      const m = t.match(/造成的伤害提升(\d+)%[^；\n]*每级增加([\d.]+)%，最多提升(\d+)%/)
      return m ? m.slice(1).join('/') : null
    })
    expect(perLevel.filter(Boolean).length).toBe(7)
    expect(new Set(perLevel).size).toBe(1)
    expect(perLevel[0]).toBe('8/1.2/80')

    // 对照组（同文件、同格式）：1611 核心被动**逐级递增** ⇒ 证明上面的判据不是恒真
    const c = JSON.parse(readFileSync(
      resolve(process.cwd(), 'data/raw/nanoka_missing/full/1611.json'), 'utf-8',
    )) as { passive?: { level?: Record<string, { desc?: string[] }> } }
    const claretVals = Object.keys(c.passive!.level!).sort()
      .map(k => strip((c.passive!.level![k].desc ?? []).join('\n')).match(/残痕积蓄效率提升(\d+)%/)?.[1])
    expect(new Set(claretVals).size).toBeGreaterThan(1)
  })

  it('实现常量 == 原文上限 80（8+1.2×60 自洽），且不等于误按被动 Lv.7 读的 15.2', () => {
    // 一侧钉在原文（上面已断言 80），一侧是实现常量 ⇒ 不是两边同读一个常量
    expect(ROXY_AA_DMG_BONUS_LV60).toBe(80)
    expect(ROXY_AA_DMG_BONUS_LV60).not.toBe(8 + 1.2 * 6)
    // 自洽性：原文「每级增加1.2%，最多提升80%」在角色满级 60 处恰好触顶
    expect(8 + 1.2 * 60).toBe(80)
  })
})
