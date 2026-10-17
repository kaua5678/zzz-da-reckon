/**
 * 驱动盘「门槛 + 触发」两维正交：门槛自动判定，触发频率仍要用户给 uptime 滑块。
 *
 * 2026-10-18 修：`adjustable` 的判据此前是 `!gate && (...)` ⇒ 带门槛又带持续时间的效果
 * （拂晓生花 4pc 第二段「强攻角色发动强特/终结后普攻 +20%，25 秒」）被短路成无滑块，
 * 引擎恒按 100% 覆盖率结算 —— 页面上看起来「恒开」，实际是静默高估。
 * 门槛与 uptime 是**两个正交维度**：门槛由引擎按面板自动判定（不给用户拨），
 * 触发频率必须由用户表达（滑块）。本测试把这条口径钉死。
 *
 * ⚠ 组级 `condition` 只是**描述文本**（如荆棘玫瑰「伤害提升始终生效；暴击率按防御力自动判定」），
 * 不代表组内每条效果都触发 ⇒ 本测试只看**效果级** `condition` / `durationSeconds`。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildDiscEffectRows } from '@/utils/discEffectRows'
import { getStatMeta } from '@/utils/statMeta'
import { SPECIALTY_LABEL } from '@/utils/agentLabelMaps'

const catalog = JSON.parse(
  readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'),
) as { driveDiscSets: { id: string; name?: { zhCN?: string } }[] }
const setById = new Map(catalog.driveDiscSets.map(s => [String(s.id), s]))
const labels = { stat: (c: string) => getStatMeta(c).label, specialty: (c: string) => SPECIALTY_LABEL[c as never] ?? c }

describe('门槛 + 触发：门槛自动判定，但 uptime 仍给滑块', () => {
  it('拂晓生花 4pc 第二段（限强攻 + 25 秒）既标门槛也给滑块', () => {
    const rows = buildDiscEffectRows(setById.get('33300') as never, undefined, labels)
    const gated = rows.find(r => r.key === 'effect_wiki_1552_4pc_triggered_basic_dmg')!
    expect(gated.gateText, '门槛仍要标「自动判定」').toContain('限强攻角色')
    expect(gated.condition, '触发条件要写出来（tooltip）').toContain('强化特殊技')
    expect(gated.adjustable, '带持续时间的触发段必须给 uptime 滑块，否则引擎恒按 100%').toBe(true)
  }, 60000)

  it('只带门槛、没有触发/持续时间的段仍不给滑块（防双重打折）', () => {
    // 荆棘玫瑰 4pc：初始防御 ≥1000/1800 两档暴击，没有触发与持续时间
    const rows = buildDiscEffectRows(setById.get('34200') as never, undefined, labels)
    const gated = rows.filter(r => r.stat === 'critRate')
    expect(gated.length).toBe(2)
    for (const g of gated) expect(g.adjustable, '纯门槛段不给滑块').toBe(false)
  }, 60000)

  it('全库不变量：效果级带 condition/durationSeconds 的段必须给滑块（否则引擎恒 100%）', () => {
    const bad: string[] = []
    for (const set of catalog.driveDiscSets) {
      const raw = set as unknown as {
        twoPiece?: { effects?: { id?: string; condition?: string; durationSeconds?: number | null }[] }
        fourPiece?: {
          selfBuff?: { effects?: { id?: string; condition?: string; durationSeconds?: number | null }[] }
          teamBuff?: { effects?: { id?: string; condition?: string; durationSeconds?: number | null }[] }
        }
      }
      const timed = new Set<string>()
      for (const piece of [raw.twoPiece, raw.fourPiece?.selfBuff, raw.fourPiece?.teamBuff]) {
        for (const e of piece?.effects ?? []) {
          if (e.id && (e.condition || e.durationSeconds != null)) timed.add(e.id)
        }
      }
      for (const r of buildDiscEffectRows(set as never, undefined, labels)) {
        if (r.unmodeled || !timed.has(r.key)) continue
        if (!r.adjustable) bad.push(`${set.id} ${set.name?.zhCN ?? ''} ${r.key}（有触发/持续时间但无滑块）`)
      }
    }
    expect(bad, `触发类效果必须能折算 uptime：\n${bad.join('\n')}`).toEqual([])
  }, 60000)
})
