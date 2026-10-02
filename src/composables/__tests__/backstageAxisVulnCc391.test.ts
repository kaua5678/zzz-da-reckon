/**
 * CC-391 锁（D1，用户 2026-09-25 裁决）：失衡轴模式下，轴槽位里「没放进轴」的招式的易伤口径。
 *
 * 规则：只有后台 / 自动攻击类才回落失衡覆盖率；主动招式没放进轴 = 轴外，零易伤。
 * 引擎里已有三条通道，本锁要求每条后台行（`timeBucket: 'backstage'`）都明确走其中一条：
 *   (b) CD / 时间驱动的自动行 → 行上 `autoSplitByStun`（按失衡时间占比拆段）；
 *   (a) 依附父动作的伴随行   → 模块 `attachedEvents` 登记（跟随父动作的轴内占比）；
 *   (c) 玩家主动打的招式     → 按放置（`axisSplitFor`），没放 = 0 —— 只能写进下面的白名单并注明理由。
 * 新模块加后台行却不归类 ⇒ 普查断言红，逼出 D1 的归类决定（不再静默落进 (c) 的零易伤）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getAgentMechanic } from '@/mechanics'
import type { StunAxisAction } from '@/types/resource'

const tick = () => new Promise(r => setTimeout(r, 40))

/** 已核实不属于 (a)/(b) 单父动作的后台行：`agentId:moveId` → 理由。改动前先读 docs/mcp-calc-core-architecture.md CC-391。 */
const UNCLASSIFIED_OK: Record<string, string> = {
  '1331:1331010': '(c) 薇薇安强化特殊技全部合轴：玩家主动打，按放置',
  '1301:1301009': '(c) 奥菲丝席德队前台小心脚下：前台主动施放，与必做行同 moveId，按放置',
}

async function runAxis(team: string[], actions: StunAxisAction[], cinemaLevel = 0) {
  const { config } = await setupHarness(team.map(agentId => ({ agentId, cinemaLevel })))
  config.autoYidhariAxis = false
  config.stunAxisPlans = []
  config.stunAxes = [{ name: '轴1', actions }]
  config.useStunAxis = true
  const calc = useResourceCalc()
  await tick()
  return { config, calc }
}
const basicOnly = (): StunAxisAction[] => [0, 1, 2].map(slot => ({ slot, moveId: 'basic', count: 1, startTime: slot }))

function inAxisDamage(calc: ReturnType<typeof useResourceCalc>, slot: number, moveId: string) {
  const rs = calc.damagePoolRows.value.filter(r => r.slot === slot && r.moveId === moveId && r.type === '直伤')
  return { total: rs.reduce((s, r) => s + r.totalDamage, 0), inAxis: rs.filter(r => (r.stunCoverage ?? 0) > 0).reduce((s, r) => s + r.totalDamage, 0) }
}

describe('CC-391 D1 后台行在失衡轴模式下的易伤归类', () => {
  for (const cinemaLevel of [0, 6]) {
    it(`普查（命座 ${cinemaLevel}）：全部角色的后台行都已归类（auto / attached / 白名单）`, async () => {
      const first = await setupHarness([{ agentId: '1211' }, { agentId: '1181' }, { agentId: '1031' }])
      const ids = [...first.catalog.agentsMap.keys()].sort()
      const unclassified: string[] = []
      let auto = 0, attached = 0, total = 0
      for (let i = 0; i < ids.length; i += 3) {
        const team = ids.slice(i, i + 3)
        while (team.length < 3) team.push(ids[team.length])
        const { calc } = await runAxis(team, basicOnly(), cinemaLevel)
        for (const c of calc.resourceResult.value?.characters ?? []) {
          const children = new Set(Object.values(getAgentMechanic(c.agentId)?.attachedEvents ?? {}).flat())
          for (const e of c.executions ?? []) {
            if (e.timeBucket !== 'backstage' || !e.moveId || e.moveId === 'basic_attack' || (e.count ?? 0) <= 0) continue
            total++
            if (e.autoSplitByStun) auto++
            else if (children.has(e.moveId)) attached++
            else if (!UNCLASSIFIED_OK[`${c.agentId}:${e.moveId}`]) unclassified.push(`${c.agentId}:${e.moveId} ${e.moveName ?? ''}`)
          }
        }
      }
      expect(total, '反空洞：普查确有后台行').toBeGreaterThanOrEqual(15)
      expect(auto, '反空洞：确有 autoSplitByStun 行').toBeGreaterThanOrEqual(8)
      expect(attached, '反空洞：确有 attachedEvents 子行').toBeGreaterThanOrEqual(3)
      expect(unclassified).toEqual([])
    })
  }

  it('(b) 自动行：轴里只放 basic 时仍按失衡占比吃到易伤', async () => {
    for (const [team, rows] of [
      [['1421', '1301', '1491'], [[1, '1301010'], [2, '1491_bubble_auto_attack'], [2, '1491_gaze_attack_trigger']]],
      [['1341', '1411', '1581'], [[0, '1341008'], [1, '1411018'], [1, '1411020'], [1, '1411021'], [2, '1581010']]],
    ] as [string[], [number, string][]][]) {
      const { calc } = await runAxis(team, basicOnly())
      for (const [slot, moveId] of rows) {
        const d = inAxisDamage(calc, slot, moveId)
        expect(d.total, `反空洞 ${moveId}`).toBeGreaterThan(0)
        expect(d.inAxis, `${moveId} 应有失衡内段`).toBeGreaterThan(0)
        expect(d.inAxis, `${moveId} 不应全段吃易伤`).toBeLessThan(d.total)
      }
    }
  })

  it('(a) 伴随行：父动作放进轴才有失衡内段；父动作不放 = 零易伤', async () => {
    const team = ['1421', '1301', '1621']
    const kids: [number, string][] = [[0, '1421007'], [0, '1421009'], [1, '1301016'], [2, '1621008']]
    const placed = await runAxis(team, [
      { slot: 0, moveId: '1421006', count: 1, startTime: 0 },
      { slot: 1, moveId: '1301015', count: 1, startTime: 1 },
      { slot: 2, moveId: '1621007', count: 1, startTime: 2 },
    ])
    for (const [slot, moveId] of kids) {
      const d = inAxisDamage(placed.calc, slot, moveId)
      expect(d.total, `反空洞 ${moveId}`).toBeGreaterThan(0)
      expect(d.inAxis, `${moveId} 父动作在轴内 ⇒ 有失衡内段`).toBeGreaterThan(0)
    }
    const bare = await runAxis(team, basicOnly())
    for (const [slot, moveId] of kids) expect(inAxisDamage(bare.calc, slot, moveId).inAxis, moveId).toBe(0)
  })

  it('(a) 多父伴随（CC-392）：只放一个父动作 ⇒ 子行按全部父动作合计拆段（不是被某一个父动作覆盖成 0 或满）', async () => {
    // 薇薇安悬落 1331006 的父 = 1331010 / 1331014 / 1331019 / 1331013；波可娜噬爪的父 = 1351008 / 1351014 / 1351011 / 1351012。
    // 只放终结技：多父合计 ⇒ 0 < 失衡内 < 全部；修前逐父覆盖 ⇒ 结果取决于登记顺序（最后一个父动作没放就是 0）。
    const { calc } = await runAxis(['1621', '1331', '1351'], [
      { slot: 1, moveId: '1331014', count: 1, startTime: 0 },
      { slot: 2, moveId: '1351012', count: 1, startTime: 1 },
    ])
    for (const [slot, moveId] of [[1, '1331006'], [2, '1351006'], [2, '1351007']] as [number, string][]) {
      const d = inAxisDamage(calc, slot, moveId)
      expect(d.total, `反空洞 ${moveId}`).toBeGreaterThan(0)
      expect(d.inAxis, `${moveId} 有失衡内段`).toBeGreaterThan(0)
      expect(d.inAxis, `${moveId} 只放一个父动作 ⇒ 不全段`).toBeLessThan(d.total)
    }
  })

  it('(c) 主动招式没放进轴 = 零易伤（薇薇安合轴强化特殊技 1331010 不回落覆盖率）', async () => {
    const { calc } = await runAxis(['1621', '1331', '1351'], basicOnly())
    const d = inAxisDamage(calc, 1, '1331010')
    expect(d.total, '反空洞').toBeGreaterThan(0)
    expect(d.inAxis).toBe(0)
  })
})
