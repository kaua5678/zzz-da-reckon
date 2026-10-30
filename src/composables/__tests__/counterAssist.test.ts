/**
 * 反制支援（Counter Assist）整组替换控制技（紫光技）——通道与口径回归。
 *
 * 游戏口径（`data/raw/nanoka_missing/noun_3.2.3.json` 术语 2000003 + 克拉蕾 1611 招式原文）：
 * [控制技] = 无闪光提示的连续数段攻击，须逐段[招架支援]应对，全部成功 → [完美反制]；
 * [反制支援]「与怪物进行角力，**一次动作整组化解**敌人的控制技」。
 *
 * 用户口径（2026-09-12）：
 * - 预设逐组记段数（`defaults.counterAssistGroups`），有反制支援角色在场时**直接不把这些弹刀计进去**
 *   （不并入 = 无需反扣）；队内没有 / 用户关掉时按旧录入口径并入强制弹刀总数；
 * - 一次反制支援 = 本体(1611028) + 专属支援突击(1611030 琢形) **两行都算**（融合成一次动作）；
 * - 喧响**完全不拿弹刀 215**，只算行内 decibel_recovery；
 * - 承接槽位**可设置**（`boss.counterAssistSlot`，缺省自动取队内有该招式的角色）。
 *
 * 时间口径（用户 2026-09-12）：这两招的秽盾公式是 **300 + 100t** →
 * 1611028 t=(671.67−300)/100=3.717s、1611030 t=(411.67−300)/100=1.117s（catalog 曾按 ether/100 直录）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import type { BossPresetFile, BossPresetDefaults } from '@/types/bossPreset'
import { CLARET_COUNTER_ASSIST, COUNTER_ASSIST_REGISTRY, ROBIN_COUNTER_ASSIST, SUNBRINGER_COUNTER_ASSIST, counterAssistOf } from '@/data/counterAssists'
import { COUNTER_ASSIST_ETHER_BASE } from '../../../scripts/lib/type-bonus-time.mjs'
import { CLARET_COUNTER_ASSIST as CLARET_FUSION } from '@/data/moveFusions'
import { fusedGroupMetrics } from '@/core/resource/moveLookup'
import { getAgentMechanic } from '@/mechanics'
import { liveInteractions } from '@/composables/liveInteractions'
import { fusedRowValue } from '@/data/moveTableQueries'
import { computeDifficulty } from '@/composables/teamCompare'
import { INTERACTION_WEIGHTS } from '@/types/teamPreset'

const bossData = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile
const catalog = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))

const skillsOf = (agentId: string) => catalog.agentSkills.find((s: { agentId: string }) => s.agentId === agentId)
const moveOf = (agentId: string, moveId: string) => {
  for (const cat of skillsOf(agentId)?.categories ?? []) {
    const m = cat.moves.find((x: { id: string }) => x.id === moveId)
    if (m) return m
  }
  return null
}
const rowOf = (move: { rows: { id: string; values: number[] }[] } | null, id: string) =>
  move?.rows.find(r => r.id === id)?.values[0] ?? 0

/** 主C(1081 attack) / 击破(1251 stun) / 克拉蕾(1611 锋御，非主C非击破 → 自身不被分派 boss 弹刀) */
const TEAM_WITH_CLARET = [
  { agentId: '1081', parryCount: 0 },
  { agentId: '1251', parryCount: 0 },
  { agentId: '1611', parryCount: 0 },
] as never
/** 同队但把克拉蕾换成支援位卢西娅 → 队内无反制支援角色 */
const TEAM_WITHOUT_CLARET = [
  { agentId: '1081', parryCount: 0 },
  { agentId: '1251', parryCount: 0 },
  { agentId: '1451', parryCount: 0 },
] as never

/** 叶释渊预设（真数据：弹刀总数 13）+ 控制技组（用户裁决「暂不录数据」→ 测试内注入，形如 2 组各 3/4 段） */
function presetWith(groups?: number[]) {
  const preset = bossData.bosses.find(b => b.id === '30042')
  if (!preset) throw new Error('boss-presets.json 缺 叶释渊 预设')
  const defaults = { ...preset.defaults } as BossPresetDefaults & { counterAssistGroups?: number[] }
  if (groups) defaults.counterAssistGroups = groups
  return { preset, phase: preset.phases[0], monster: preset.monster, defaults }
}

function applyBoss(config: ReturnType<typeof useConfigStore>, groups?: number[]) {
  const { preset, phase, monster, defaults } = presetWith(groups)
  config.applyBossPreset({ id: preset.id }, phase as never, monster as never, defaults as never)
}

describe('反制支援秽盾定点基数 300（全库一行不漏）', () => {
  it('每个「反制支援」行的 actionTime 都等于 (秽盾−300)/100', () => {
    const hits: { agentId: string, id: string, zh: string, at: number, ether: number }[] = []
    for (const skills of catalog.agentSkills as { agentId: string, categories: { moves: { id: string, name?: { zhCN?: string }, actionTime?: number, rows: { id: string, values: number[] }[] }[] }[] }[]) {
      for (const cat of skills.categories) {
        for (const m of cat.moves) {
          if (!/^反制支援/.test(m.name?.zhCN ?? '')) continue
          hits.push({ agentId: skills.agentId, id: m.id, zh: m.name?.zhCN ?? '', at: m.actionTime ?? 0, ether: m.rows.find(r => r.id === 'ether_purify')?.values[0] ?? 0 })
        }
      }
    }
    // 克拉蕾 1611028 / 挽昼 1601204 / 知更鸟 1661017 —— 三个独立样本反解同一个 300
    expect(hits.length, '全库应有反制支援行').toBeGreaterThanOrEqual(3)
    for (const h of hits) {
      expect(h.ether - COUNTER_ASSIST_ETHER_BASE, `${h.agentId} ${h.id} 的秽盾 ${h.ether} 必须大于基数 300`).toBeGreaterThan(0)
      expect(h.at, `${h.agentId} ${h.id}「${h.zh}」的 actionTime 没扣反制支援基数 300（秽盾 ${h.ether}）`)
        .toBeCloseTo((h.ether - COUNTER_ASSIST_ETHER_BASE) / 100, 3)
    }
  })

  it('基数只认反制支援系（负控）：普通支援突击不扣 300', () => {
    const followUp = moveOf('1601', '1601013') // 支援突击：虔志如初（跟招架支援，不是反制支援）
    expect(followUp).toBeTruthy()
    expect(rowOf(followUp, 'ether_purify') - COUNTER_ASSIST_ETHER_BASE).toBeLessThan(0)
    expect(followUp!.actionTime).toBeGreaterThan(1) // 扣 300 会折成负数/0 —— 这行必须保持原值
  })
})

describe('反制支援登记表与倍率表一致性', () => {
  it('登记的 moveId 在 catalog 存在，且确为「反制支援 / 支援突击」两行（防 id 漂移）', () => {
    const decl = counterAssistOf('1611')
    expect(decl).toEqual(CLARET_COUNTER_ASSIST)
    expect(moveOf('1611', decl!.moveId)?.name?.zhCN).toContain('反制支援')
    expect(moveOf('1611', decl!.followUpMoveId)?.name?.zhCN).toContain('支援突击')
    // 该角色 assist 段里确有两条「支援突击」——名字匹配会挑错行，故必须登记 id（见 counterAssists.ts 头注释）
    const followUps = (skillsOf('1611').categories.find((c: { id: string }) => c.id === 'assist').moves)
      .filter((m: { name?: { en?: string } }) => /assist follow-?up/i.test(m.name?.en ?? ''))
    expect(followUps.length).toBeGreaterThanOrEqual(2)
  })

  it('秽盾 300+100t：两行 actionTime 已扣基数（3.717 / 1.117），融合后一次动作 4.834s', () => {
    const body = moveOf('1611', CLARET_COUNTER_ASSIST.moveId)
    const followUp = moveOf('1611', CLARET_COUNTER_ASSIST.followUpMoveId)
    // catalog 的 actionTime 折到 3 位小数（round(t*1000)/1000）→ 断言精度取 3
    expect(rowOf(body, 'ether_purify')).toBeCloseTo(671.67, 2)
    expect(body!.actionTime).toBeCloseTo((rowOf(body, 'ether_purify') - 300) / 100, 3)
    expect(rowOf(followUp, 'ether_purify')).toBeCloseTo(411.67, 2)
    expect(followUp!.actionTime).toBeCloseTo((rowOf(followUp, 'ether_purify') - 300) / 100, 3)
    // 融合组「一次动作」= 本体 + 琢形（两段都占前台）
    const fused = fusedGroupMetrics(skillsOf('1611'), CLARET_FUSION.moveId)
    expect(fused).not.toBeNull()
    expect(fused!.actionTime).toBeCloseTo(body!.actionTime + followUp!.actionTime, 4)
    expect(fused!.decibelRecovery).toBeCloseTo(
      rowOf(body, 'decibel_recovery') + rowOf(followUp, 'decibel_recovery'), 3)
  })

  it('gash_buildup 同样走融合口径：反制支援一次动作 = 本体 446 + 琢形 134 = 580 点', () => {
    // 残痕按「全招式积累」计（2026-09-12 更正），反制支援行是融合行 → 表值必须同为融合和，
    // 否则一次动作只记本体那 446、琢形的 134 静默丢失。
    expect(fusedRowValue(skillsOf('1611') as never, CLARET_COUNTER_ASSIST.moveId, 'gash_buildup'))
      .toBeCloseTo(446 + 134, 3)
  })

  it('登记表覆盖三家（克拉蕾 / 挽昼 / 知更鸟）——反制支援不再是锋御专属', () => {
    // 用户 2026-10-30：「接吧，有反制支援的角色越来越多了，不再是克拉蕾专属」
    expect(COUNTER_ASSIST_REGISTRY.map(m => m.agentId).sort()).toEqual(['1601', '1611', '1661'])
    for (const decl of COUNTER_ASSIST_REGISTRY) {
      expect(moveOf(decl.agentId, decl.moveId)?.name?.zhCN, `${decl.agentId} 本体应是反制支援`).toContain('反制支援')
      expect(moveOf(decl.agentId, decl.followUpMoveId)?.name?.zhCN, `${decl.agentId} 追击应是支援突击`).toContain('支援突击')
    }
  })

  it('挽昼 1601：反制支援融合（本体 + 灯塔），知更鸟 1661：只登记不融合', () => {
    // 挽昼：原文「发动[反制支援]后，点按 攻击 发动」⇒ 同一动作两段，时间/喧响/伤害都取整段
    const body = moveOf('1601', SUNBRINGER_COUNTER_ASSIST.moveId)
    const follow = moveOf('1601', SUNBRINGER_COUNTER_ASSIST.followUpMoveId)
    expect(body!.actionTime).toBeCloseTo(3, 3)
    expect(follow!.actionTime).toBeCloseTo(2, 3)
    const fused = fusedGroupMetrics(skillsOf('1601'), SUNBRINGER_COUNTER_ASSIST.moveId)
    expect(fused!.actionTime).toBeCloseTo(5, 4) // 3 + 2
    expect(fused!.decibelRecovery).toBeCloseTo(rowOf(body, 'decibel_recovery') + rowOf(follow, 'decibel_recovery'), 2)
    // 知更鸟：1661019 是「其他角色发动反制支援后」自动触发 ⇒ **不得**并入她那次动作
    expect(fusedGroupMetrics(skillsOf('1661'), ROBIN_COUNTER_ASSIST.moveId)).toBeNull()
    expect(fusedGroupMetrics(skillsOf('1661'), ROBIN_COUNTER_ASSIST.followUpMoveId)).toBeNull()
  })

  it('融合组登记与招式登记表同源（同一对 moveId，防两处漂移）', () => {
    expect(CLARET_FUSION.terms.map(t => t.moveId)).toEqual([
      CLARET_COUNTER_ASSIST.moveId, CLARET_COUNTER_ASSIST.followUpMoveId,
    ])
    expect(getAgentMechanic('1611')).toBeTruthy()
  })
})

describe('挽昼 / 知更鸟 接入后的整链（引擎真跑一次）', () => {
  it('挽昼：一组控制技 → 一行反制支援，时间/喧响取「希望堡垒+灯塔」整段，且灯塔送 1 层残痕', async () => {
    const { config } = await setupHarness([{ agentId: '1601' }, { agentId: '1101' }, { agentId: '1661' }])
    applyBoss(config, [3]) // 1 组控制技；槽 0 = 挽昼（有反制支援）⇒ 自动承接
    expect(config.counterAssistSlot).toBe(0)
    const calc = useResourceCalc()
    const sun = calc.resourceResult.value?.characters.find(c => c.agentId === '1601')
    const row = (sun?.executions ?? []).find(e => e.moveId === SUNBRINGER_COUNTER_ASSIST.moveId)
    expect(row, '挽昼应产出反制支援行').toBeTruthy()
    expect(row!.count).toBe(1)
    // 融合：一次动作 = 本体 3.0s + 灯塔 2.0s；伤害 = 1757.6 + 939.1
    const body = moveOf('1601', SUNBRINGER_COUNTER_ASSIST.moveId)
    const follow = moveOf('1601', SUNBRINGER_COUNTER_ASSIST.followUpMoveId)
    expect(row!.actionTime).toBeCloseTo(5, 3)
    expect(row!.damageMultiplier).toBeCloseTo(rowOf(body, 'damage') + rowOf(follow, 'damage'), 1)
    // 灯塔送层：整组化解比「不化解」多 1 层残痕 ⇒ 毁伤次数真的涨（不是只多一行展示）
    const maimOf = () => (calc.resourceResult.value?.characters.find(c => c.agentId === '1601')?.executions ?? [])
      .filter(e => e.moveId === '1601114').reduce((s, e) => s + e.count, 0)
    const withGift = maimOf()
    config.setMechanicSetting('boss.counterAssistReplace', 0) // 关掉替换 → 不产反制支援、不送层
    const withoutGift = maimOf()
    expect(withGift, '灯塔送层应抬毁伤次数').toBeGreaterThan(withoutGift)
  })

  it('知更鸟 1661019：队友发动反制支援 ⇒ 自动段按 1:1 触发（不占前台、不产喧响）', async () => {
    // 克拉蕾（有反制支援，承接槽 0） + 知更鸟（槽 2，自己不承接）
    const { config } = await setupHarness([{ agentId: '1611' }, { agentId: '1201' }, { agentId: '1661' }])
    applyBoss(config, [4, 3]) // 2 组控制技
    expect(config.counterAssistSlot, '承接槽 = 克拉蕾').toBe(0)
    const calc = useResourceCalc()
    const robin = () => calc.resourceResult.value?.characters.find(c => c.agentId === '1661')
    const rows = () => (robin()?.executions ?? []).filter(e => String(e.moveId) === ROBIN_COUNTER_ASSIST.followUpMoveId)
    const row = rows()[0]
    expect(row, '应产出角力协同突击行').toBeTruthy()
    expect(row!.count, '触发次数 = 队友反制支援次数（2 组）').toBe(2)
    expect(row!.actionTime, '自动段不占前台时间').toBe(0)
    expect(row!.decibelRecovery, '不产喧响').toBe(0)
    expect(row!.damageMultiplier).toBeCloseTo(rowOf(moveOf('1661', ROBIN_COUNTER_ASSIST.followUpMoveId), 'damage'), 1)

    // 负控 A：没有队友有反制支援 ⇒ 一行都不产
    const solo = await setupHarness([{ agentId: '1661' }, { agentId: '1201' }])
    solo.config.setAgent(2, '1101')
    expect(solo.config.counterAssistSlot).toBe(-1)
    const soloCalc = useResourceCalc()
    solo.config.applyBossPreset(
      { id: '40000' } as never,
      (JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8'))
        .bosses.find((b: { id: string }) => b.id === '40000')).phases[0],
      (JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8'))
        .bosses.find((b: { id: string }) => b.id === '40000')).monster,
      { ...(JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8'))
        .bosses.find((b: { id: string }) => b.id === '40000')).defaults, counterAssistGroups: [4] },
    )
    const soloRows = (soloCalc.resourceResult.value?.characters.find(c => c.agentId === '1661')?.executions ?? [])
      .filter(e => String(e.moveId) === ROBIN_COUNTER_ASSIST.followUpMoveId)
    expect(soloRows.length, '队友无反制支援 ⇒ 不触发').toBe(0)
  })

  it('知更鸟 1661019：只数「队友」的反制支援——她自己承接时不算触发（原文「队伍中其他角色」）', async () => {
    // 只有知更鸟有反制支援 ⇒ 她自己承接、自己打反制支援；1661019 需要**别人**发动 ⇒ 0 次
    const { config } = await setupHarness([{ agentId: '1661' }, { agentId: '1201' }, { agentId: '1101' }])
    applyBoss(config, [4])
    expect(config.counterAssistSlot, '承接槽 = 知更鸟自己').toBe(0)
    const calc = useResourceCalc()
    const robin = calc.resourceResult.value?.characters.find(c => c.agentId === '1661')
    expect((robin?.executions ?? []).some(e => String(e.moveId) === ROBIN_COUNTER_ASSIST.moveId), '她自己的反制支援照打').toBe(true)
    const autoRows = (robin?.executions ?? []).filter(e => String(e.moveId) === ROBIN_COUNTER_ASSIST.followUpMoveId)
    expect(autoRows.length, '自己的反制支援不触发自己的角力协同突击').toBe(0)
  })

  it('知更鸟：同样能承接（不再是锋御专属），产出一行且时间只算本体 3.784s（1661019 不并入）', async () => {
    const { config } = await setupHarness([{ agentId: '1661' }, { agentId: '1101' }, { agentId: '1201' }])
    applyBoss(config, [3])
    expect(config.counterAssistSlot).toBe(0)
    const calc = useResourceCalc()
    const robin = calc.resourceResult.value?.characters.find(c => c.agentId === '1661')
    const row = (robin?.executions ?? []).find(e => e.moveId === ROBIN_COUNTER_ASSIST.moveId)
    expect(row, '知更鸟应产出反制支援行').toBeTruthy()
    expect(row!.actionTime).toBeCloseTo(3.784, 3)
    expect(row!.damageMultiplier).toBeCloseTo(rowOf(moveOf('1661', ROBIN_COUNTER_ASSIST.moveId), 'damage'), 1)
  })
})

describe('Boss 交互计划折算（store 侧，控制技组 → 弹刀 or 反制支援）', () => {
  it('无反制支援角色在场 → 每组按「1 次正常弹刀 + 段数−1 无突击弹刀」并入强制总数', async () => {
    const { config } = await setupHarness([...TEAM_WITHOUT_CLARET])
    applyBoss(config) // 基线：无组
    expect(config.bossParryTotals.parryTotal).toBe(13)
    expect(config.bossParryTotals.parryNoFollowUpTotal).toBe(0)
    expect(config.counterAssistSlot).toBe(-1)

    applyBoss(config, [3, 4])
    expect(config.counterAssistSlot).toBe(-1) // 队内无人有反制支援
    expect(config.bossParryTotals.parryTotal).toBe(13 + 2)
    expect(config.bossParryTotals.parryNoFollowUpTotal).toBe((3 - 1) + (4 - 1))
  })

  it('有反制支援角色在场 → 整组不并入（无需反扣），并折算到该槽位', async () => {
    const { config } = await setupHarness([...TEAM_WITH_CLARET])
    applyBoss(config, [3, 4])
    expect(config.counterAssistSlot).toBe(2) // 克拉蕾在 3 号位（槽 2）
    expect(config.bossParryTotals.parryTotal).toBe(13) // 未被并入
    expect(config.bossParryTotals.parryNoFollowUpTotal).toBe(0)

    // 关掉开关 → 立刻退回「按弹刀计」，且数值可逆（幂等：反复折算不累积）
    config.setMechanicSetting('boss.counterAssistReplace', 0)
    expect(config.counterAssistSlot).toBe(-1)
    expect(config.bossParryTotals.parryTotal).toBe(15)
    expect(config.bossParryTotals.parryNoFollowUpTotal).toBe(5)
    config.setMechanicSetting('boss.counterAssistReplace', 1)
    expect(config.bossParryTotals.parryTotal).toBe(13)
    expect(config.bossParryTotals.parryNoFollowUpTotal).toBe(0)
    config.setMechanicSetting('boss.counterAssistReplace', 0)
    expect(config.bossParryTotals.parryTotal).toBe(15)
  })

  it('承接槽位可设置：指定无该招式的槽位时回退自动，指定有该招式的槽位时用指定值', async () => {
    const { config } = await setupHarness([...TEAM_WITH_CLARET])
    applyBoss(config, [3])
    config.setMechanicSetting('boss.counterAssistSlot', 0) // 主C 没有反制支援 → 回退自动（槽 2）
    expect(config.counterAssistSlot).toBe(2)
    config.setMechanicSetting('boss.counterAssistSlot', 2)
    expect(config.counterAssistSlot).toBe(2)
  })
})

describe('反制支援执行行与资源账本（真数据）', () => {
  it('开启替换 → 克拉蕾产出一行反制支援，次数 = 控制技组数，倍率/失衡/喧响 = 融合两行之和', async () => {
    const { config } = await setupHarness([...TEAM_WITH_CLARET])
    applyBoss(config, [3, 4])
    const calc = useResourceCalc()
    const claret = calc.resourceResult.value?.characters.find(c => c.agentId === '1611')
    const row = (claret?.executions ?? []).find(e => e.moveId === CLARET_COUNTER_ASSIST.moveId)
    expect(row, '应有反制支援行').toBeTruthy()
    expect(row!.count).toBe(2)
    expect(row!.moveName).toContain('反制支援')
    const body = moveOf('1611', CLARET_COUNTER_ASSIST.moveId)
    const followUp = moveOf('1611', CLARET_COUNTER_ASSIST.followUpMoveId)
    expect(row!.damageMultiplier).toBeCloseTo(rowOf(body, 'damage') + rowOf(followUp, 'damage'), 1)
    expect(row!.dazeMultiplier).toBeCloseTo(rowOf(body, 'daze') + rowOf(followUp, 'daze'), 1)
    expect(row!.decibelRecovery).toBeCloseTo(
      rowOf(body, 'decibel_recovery') + rowOf(followUp, 'decibel_recovery'), 2)
    // 前台时间：一次动作 = 本体 + 琢形（catalog 行各按 300+100t 折到 3 位小数：3.717 + 1.117）
    expect(row!.actionTime).toBeCloseTo(body!.actionTime + followUp!.actionTime, 4)
    expect(row!.actionTime).toBeCloseTo(4.834, 3)
    expect(row!.totalTime).toBeCloseTo(2 * 4.834, 3)
  })

  it('不拿弹刀 215 特殊动作奖励：克拉蕾的该分量与「无控制技」基线逐位相同', async () => {
    const { config } = await setupHarness([...TEAM_WITH_CLARET])
    applyBoss(config) // 无控制技组
    const calc = useResourceCalc()
    const baseBonus = calc.resourceResult.value?.characters.find(c => c.agentId === '1611')?.decibelSource.specialActionBonus
    expect(baseBonus).toBeTypeOf('number')

    applyBoss(config, [3, 4]) // 整组替换生效
    const caRow = (calc.resourceResult.value?.characters.find(c => c.agentId === '1611')?.executions ?? [])
      .find(e => e.moveId === CLARET_COUNTER_ASSIST.moveId)
    expect(caRow).toBeTruthy() // 她确实打了反制支援
    expect(calc.resourceResult.value?.characters.find(c => c.agentId === '1611')?.decibelSource.specialActionBonus)
      .toBe(baseBonus) // 但一次也没进 215 通道（行内喧响另计）
  })

  it('关掉替换 → 不再产反制支援行，控制技组回到弹刀通道（强制弹刀总数上升）', async () => {
    const { config } = await setupHarness([...TEAM_WITH_CLARET])
    applyBoss(config, [3, 4])
    const calc = useResourceCalc()
    const damageOn = calc.teamTotalDamage.value
    expect((calc.resourceResult.value?.characters.find(c => c.agentId === '1611')?.executions ?? [])
      .some(e => e.moveId === CLARET_COUNTER_ASSIST.moveId)).toBe(true)

    config.setMechanicSetting('boss.counterAssistReplace', 0)
    expect((calc.resourceResult.value?.characters.find(c => c.agentId === '1611')?.executions ?? [])
      .some(e => e.moveId === CLARET_COUNTER_ASSIST.moveId)).toBe(false)
    // 并入生效：boss 强制弹刀总数 13 → 15 无突击 +5，弹刀反推随之重排
    expect(config.bossParryTotals.parryTotal).toBe(15)
    const split = calc.parrySplitResult.value
    expect(split).not.toBeNull()
    expect(split!.breakerParry + split!.mainDpsParry).toBeLessThanOrEqual(15)
    // 开关不是空转：两种交互形态给出不同总伤
    expect(calc.teamTotalDamage.value).not.toBe(damageOn)
  })

  it('琢形送残痕：整组化解每组直接 +1 层，并真抬毁伤次数与伤害（不是只多一行展示）', async () => {
    const { config } = await setupHarness([...TEAM_WITH_CLARET])
    applyBoss(config, [3, 4])
    const calc = useResourceCalc()
    const src = () => calc.resourceResult.value?.characters.find(c => c.agentId === '1611')?.claretSharpResourceSource
    const maimRows = () => (calc.resourceResult.value?.characters.find(c => c.agentId === '1611')?.executions ?? [])
      .filter(e => e.moveId === '1611013').reduce((s, e) => s + e.count, 0)
    const on = src()
    expect(on).toBeTruthy()
    expect(on!.counterAssistGashStacks).toBe(2) // 2 组 → 琢形送 2 层
    expect(on!.gashStacks).toBeGreaterThanOrEqual(2)
    const damageOn = calc.teamTotalDamage.value
    const maimOn = maimRows()
    // 关掉替换：不产反制支援 → 不送层 → 毁伤次数不增（送层的真实效果）
    config.setMechanicSetting('boss.counterAssistReplace', 0)
    const off = src()
    expect(off!.counterAssistGashStacks).toBe(0)
    expect(maimRows()).toBeLessThanOrEqual(maimOn)
    expect(on!.maimCount).toBeGreaterThanOrEqual(off!.maimCount)
    expect(calc.teamTotalDamage.value).not.toBe(damageOn)
  })
})

describe('难度口径：角力 = 一次弹刀同权重（用户 2026-09-12）', () => {
  it('INTERACTION_WEIGHTS.counterAssist 与 parry 同档', () => {
    expect(INTERACTION_WEIGHTS.counterAssist).toBe(INTERACTION_WEIGHTS.parry)
  })

  it('liveInteractions 计入反制支援次数（按承接槽位缩），明细里以「反制支援（角力）」露出', async () => {
    const { config } = await setupHarness([...TEAM_WITH_CLARET])
    applyBoss(config, [3, 4])
    const items = liveInteractions(config, { team: ['1611', '1251', '1081'] } as never)
    const ca = items.find(i => i.type === 'counterAssist')
    expect(ca?.count).toBe(2)
    expect(ca?.slot).toBe(2) // 承接槽位 = 克拉蕾
    const { difficulty, detail } = computeDifficulty(items, ['1611', '1251', '1081'])
    expect(detail).toContain('反制支援（角力）2×1')
    expect(difficulty).toBeGreaterThanOrEqual(2)

    // 关掉替换 → 角力条目消失（那几组回到弹刀通道，不再计这条交互）
    config.setMechanicSetting('boss.counterAssistReplace', 0)
    expect(liveInteractions(config, { team: ['1611', '1251', '1081'] } as never)
      .some(i => i.type === 'counterAssist')).toBe(false)
  })
})

describe('真实 Boss 控制技默认值（用户 2026-09-13 录入：段数即「招架段数」= 反制支援化解的一组）', () => {
  const defOf = (id: string) => bossData.bosses.find((b: { id: string }) => b.id === id)?.defaults
  it('清道夫 40002/40003=1组5段、始主 40000=1组4段、余火 40005=1组4段（与用户口径逐字对齐）', () => {
    expect(defOf('40002')?.counterAssistGroups).toEqual([5])
    expect(defOf('40003')?.counterAssistGroups).toEqual([5])
    expect(defOf('40000')?.counterAssistGroups).toEqual([4])
    expect(defOf('40005')?.counterAssistGroups).toEqual([4])
  })
  it('防双计：这些 Boss 的强制弹刀总数清空（控制技只走组通道，非替换时由折算并回）', () => {
    for (const id of ['40002', '40003', '40000', '40005']) {
      const d = defOf(id)!
      expect(d.parryTotal ?? 0, `${id} 不该再静态记正常弹刀`).toBe(0)
      expect(d.parryNoFollowUpTotal ?? 0, `${id} 不该再静态记无突击弹刀`).toBe(0)
    }
  })
  it('始主组折算逐位等于旧静态录入（正常1+无突击3=[4]折出），纯增益=可被整组化解', async () => {
    // [4] → 1 次正常弹刀 + 3 无突击，与 BOSS_DEFAULTS 旧值 {parryTotal:1, parryNoFollowUpTotal:3} 一致
    const { config } = await setupHarness([...TEAM_WITHOUT_CLARET])
    const preset = bossData.bosses.find((b: { id: string }) => b.id === '40000')!
    expect(preset, 'boss-presets.json 缺 40000 始主预设').toBeTruthy()
    config.applyBossPreset({ id: preset.id }, preset.phases[0] as never, preset.monster as never, preset.defaults as never)
    expect(config.bossParryTotals.parryTotal).toBe(1)
    expect(config.bossParryTotals.parryNoFollowUpTotal).toBe(3)
  })
})

describe('控制技组用户可编辑（Boss 卡对默认值不满意可调整，引擎全链读同一活引用）', () => {
  it('改段数 / 加组 / 删组 / 清空 → 折算即时重算；清空回落无组', async () => {
    const { config } = await setupHarness([...TEAM_WITHOUT_CLARET])
    applyBoss(config, [3, 4])
    expect(config.bossParryTotals.parryTotal).toBe(15)   // 13 + 2 组
    expect(config.bossParryTotals.parryNoFollowUpTotal).toBe(2 + 3) // (3-1)+(4-1)=5

    config.setCounterAssistGroups([6])
    expect(config.bossParryTotals.parryTotal).toBe(13 + 1)
    expect(config.bossParryTotals.parryNoFollowUpTotal).toBe(5)

    config.setCounterAssistGroups([])                 // 清空 = 无控制技
    expect(config.appliedBoss?.counterAssistGroups).toBeUndefined()
    expect(config.bossParryTotals.parryTotal).toBe(13)
    expect(config.bossParryTotals.parryNoFollowUpTotal).toBe(0)
  })
  it('越界钳制：段数 1~12、组数 ≤8、非正数回 1（防脏输入击穿折算）', async () => {
    const { config } = await setupHarness([...TEAM_WITHOUT_CLARET])
    applyBoss(config, [3])
    config.setCounterAssistGroups([0, -5, 999, ...Array(10).fill(2)])
    const g = config.appliedBoss?.counterAssistGroups ?? []
    expect(g.length).toBe(8)
    expect(g[0]).toBe(1); expect(g[1]).toBe(1); expect(g[2]).toBe(12)
    // 无替换折算上限：8 组 → 正常 +8
    expect(config.bossParryTotals.parryTotal).toBe(13 + 8)
  })
  it('有克拉蕾在场时编辑段数：反制支援次数 = 组数（化解动作数随组数变），弹刀侧仍不并入', async () => {
    const { config } = await setupHarness([...TEAM_WITH_CLARET])
    applyBoss(config, [5])
    expect(config.counterAssistSlot).toBe(2)
    expect(config.bossParryTotals.parryTotal).toBe(13)   // 整组不并入
    config.setCounterAssistGroups([5, 5, 5])          // 三组
    const items = liveInteractions(config, { team: ['1611', '1251', '1081'] } as never)
    expect(items.find(i => i.type === 'counterAssist')?.count).toBe(3)
    expect(config.bossParryTotals.parryTotal).toBe(13)   // 仍不并入
  })
})
