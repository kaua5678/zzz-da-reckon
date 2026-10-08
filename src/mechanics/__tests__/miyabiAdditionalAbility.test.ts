/**
 * 星见雅(1091) 额外能力·同沐霜雪 门控生效测试。
 *
 * 口径（spec `src/specs/agents/1091.json` additionalAbility.teamConditions，三臂任一满足即触发）：
 *   ① 队中存在「支援」角色 ② 队中存在与自身**同阵营**角色 ③ 队中存在「异常」角色。
 * 生效面（`applyMiyabiPanel`）：enemyIceResReduction +30（紊乱→霜月无视 30% 冰抗）
 *   与 skillDmgBonus__basic +60（霜月伤害 +60%）。
 *
 * 背景（本文件是回归网）：模块原手写判定 `isAdditionalAbilityActive` 的第三臂写成
 * `member.agent.id === agent.id`（同**角色 id**），而 spec 声明的是 `sameFactionAsSelf`
 * （同**阵营**）⇒ 悠真(1201，第六课·强攻) 在队时额外能力被漏判，面板缺 30 冰抗无视与 60 增伤。
 * 修复 = 直接消费声明式判定 `evalAdditionalAbility`（单源，消除 spec↔模块漂移）。
 *
 * 对照面：四组反例/正例钉住三臂语义，防"修好一臂改坏另两臂"。
 */
import { describe, expect, it } from 'vitest'
import { panelAt } from '@/core/panel'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness, type HarnessTeamSlot } from '@/test/harness'
import type { PanelValues } from '@/types/catalog'

/** 跑全管线取槽位 0（雅）的面板；关掉全局 buff 以隔离队伍条件本身的影响 */
async function miyabiPanel(team: Array<HarnessTeamSlot | ''>): Promise<PanelValues> {
  const { config } = await setupHarness(team)
  for (const buff of config.globalBuffs) buff.enabled = false
  const calc = useResourceCalc()
  void calc.damagePoolRows.value // 触发 calcOutput 全链路
  const panel = panelAt(calc.panels.value, 0)
  if (!panel) throw new Error('槽位 0 无面板（雅未装配成功）')
  return panel
}

const aaOf = (panel: PanelValues) => panel.additionalAbilityActive
const iceResOf = (panel: PanelValues) => panel.enemyIceResReduction ?? 0
const basicBonusOf = (panel: PanelValues) => panel['skillDmgBonus__basic'] ?? 0

describe('星见雅额外能力·同沐霜雪 门控（同阵营臂：spec sameFactionAsSelf）', () => {
  it('★ 悠真(1201) 在队：同阵营（第六课）强攻 ⇒ 额外能力触发（aa=1、冰抗-30、基本增伤+60）', async () => {
    const panel = await miyabiPanel([{ agentId: '1091', cinemaLevel: 0 }, { agentId: '1201', cinemaLevel: 0 }, ''])
    expect(aaOf(panel)).toBe(1)
    expect(iceResOf(panel)).toBe(30)
    expect(basicBonusOf(panel)).toBe(60)
  })
})

describe('星见雅额外能力 四组对照（防修一臂坏两臂）', () => {
  it('① 单飞（无队友）⇒ 不触发', async () => {
    const panel = await miyabiPanel([{ agentId: '1091', cinemaLevel: 0 }, '', ''])
    expect(aaOf(panel)).toBe(0)
    expect(iceResOf(panel)).toBe(0)
    expect(basicBonusOf(panel)).toBe(0)
  })

  it('② 朱鸢(1241)：强攻且**异阵营**（新艾利都治安局）⇒ 不触发（钉住"同阵营"不是"任意强攻"）', async () => {
    const panel = await miyabiPanel([{ agentId: '1091', cinemaLevel: 0 }, { agentId: '1241', cinemaLevel: 0 }, ''])
    expect(aaOf(panel)).toBe(0)
    expect(iceResOf(panel)).toBe(0)
    expect(basicBonusOf(panel)).toBe(0)
  })

  it('③ 苍角(1131)：支援臂 ⇒ 触发', async () => {
    const panel = await miyabiPanel([{ agentId: '1091', cinemaLevel: 0 }, { agentId: '1131', cinemaLevel: 0 }, ''])
    expect(aaOf(panel)).toBe(1)
    expect(iceResOf(panel)).toBe(30)
    expect(basicBonusOf(panel)).toBe(60)
  })

  it('④ 月城柳(1221)：异常臂 ⇒ 触发', async () => {
    const panel = await miyabiPanel([{ agentId: '1091', cinemaLevel: 0 }, { agentId: '1221', cinemaLevel: 0 }, ''])
    expect(aaOf(panel)).toBe(1)
    expect(iceResOf(panel)).toBe(30)
    expect(basicBonusOf(panel)).toBe(60)
  })
})
