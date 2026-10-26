/**
 * 属性配置页「危局环境 Buff」卡的**行为面**判据（2026-10-26）。
 *
 * 与 `utils/__tests__/phaseEnvironmentBuff.test.ts`（纯函数 + 源码锁）分工：
 * 那边锁解析口径与页面写法，这边锁**真管线**——页面选牌 → 全局 Buff 表 → 引擎真的收下并按当前队伍解析 `cond`。
 * 没有这一条，界面可以「有按钮、能点、行也写了」，而引擎一行都不认（R65 的死控件同型）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness, setTeam } from '@/test/harness'
import { resolveSlotPanelBuffInputs } from '@/composables/resourceCalc/panelPhases'
import { applyPeriodBuff } from '@/composables/runArchiveDeploy'
import { resolvePhaseEnvironment, selectedPeriodBuffCard, periodBuffRowsOf } from '@/utils/phaseBuff'
import type { BossPresetFile, PhaseBuffCard } from '@/types/bossPreset'
import type { useConfigStore } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'

const bp = JSON.parse(
  readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8'),
) as BossPresetFile

/** 引擎实际收下的全局 Buff（1 号位面板输入）：stat → Σvalue */
function engineGlobals(
  config: ReturnType<typeof useConfigStore>,
  catalog: ReturnType<typeof useCatalogStore>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const b of resolveSlotPanelBuffInputs(0, config, catalog).teammateBuffs) {
    if (b.sourceKind !== 'global') continue
    for (const e of b.effects) if (e.type === 'fixed') out[e.stat] = (out[e.stat] ?? 0) + e.value
  }
  return out
}

const clearRows = (config: ReturnType<typeof useConfigStore>) => config.globalBuffs.splice(0, config.globalBuffs.length)

/** 找一期「有 ≥1 张真正进引擎的牌」的期（测试服占位牌除外） */
function phaseWithUsableCard(): { phaseId: string; card: PhaseBuffCard } {
  for (const v of bp.phaseViews ?? []) {
    const env = resolvePhaseEnvironment(bp, null, v.phaseId)
    const card = env?.selectable.find(c => !c.testOnly && c.effects.some(e => e.stat))
    if (card) return { phaseId: v.phaseId, card }
  }
  throw new Error('boss-presets.json 里没有可用的当期牌')
}

describe('页面选牌 → 全局 Buff 表 → 引擎（真管线）', () => {
  it('★ 选中的牌真的进引擎：表里出现该期的行，且引擎按 stat 收到数值', async () => {
    const { phaseId, card } = phaseWithUsableCard()
    const { config, catalog } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }])
    clearRows(config)

    // 页面做的事：applyPeriodBuff(configStore, envPhaseId, card)
    expect(applyPeriodBuff(config, phaseId, card)).toBe(true)
    expect(periodBuffRowsOf(config.globalBuffs, phaseId).length, '表里必须有本期行').toBe(card.effects.filter(e => e.stat).length)

    // 引擎收下的值 = 牌的数值（无条件牌）/ 条件牌按当前队伍判定后可能为 0 条
    const got = engineGlobals(config, catalog)
    const unconditional = card.effects.filter(e => e.stat && !e.cond)
    const total = Object.values(got).reduce((s, v) => s + v, 0)
    expect(total, '引擎至少收到一些数值').toBeGreaterThan(0)
    for (const e of unconditional) {
      expect(got[e.stat], `${e.stat} 应进引擎`).toBeDefined()
    }
  }, 120_000)

  it('★ 「不用」清掉本期行（换牌不叠加）：旧牌的行必须消失', async () => {
    const { phaseId, card } = phaseWithUsableCard()
    const { config } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }])
    clearRows(config)
    applyPeriodBuff(config, phaseId, card)
    expect(periodBuffRowsOf(config.globalBuffs, phaseId).length).toBeGreaterThan(0)
    expect(applyPeriodBuff(config, phaseId, null)).toBe(false)
    expect(periodBuffRowsOf(config.globalBuffs, phaseId)).toEqual([])
  }, 120_000)

  it('★ 选中态由表派生：写牌后 resolvePhaseEnvironment + selectedPeriodBuffCard 能认回同一张', async () => {
    const { phaseId, card } = phaseWithUsableCard()
    const { config } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }])
    clearRows(config)
    applyPeriodBuff(config, phaseId, card)
    const env = resolvePhaseEnvironment(bp, null, phaseId)
    expect(selectedPeriodBuffCard(config.globalBuffs, phaseId, env!.selectable)?.title).toBe(card.title)
  }, 120_000)

  it('★ 条件牌按**当前队伍**换档：同一批行，1 异常队不吃、3 异常队取满档（页面不预先筛队）', async () => {
    // ★ 必须用 **countTier（人数分档）** 的牌：二元特性限定对「1 异常 vs 3 异常」无判别力
    // （两支队伍里都有异常角色 ⇒ 两档都成立，读数逐位相同恰好会让判据无牙）。数据里 18 条分档行。
    let found: { phaseId: string; card: PhaseBuffCard } | null = null
    for (const v of bp.phaseViews ?? []) {
      const env = resolvePhaseEnvironment(bp, null, v.phaseId)
      const c = env?.selectable.find(x => !x.testOnly && x.effects.some(e => e.stat && e.cond?.countTier))
      if (c) { found = { phaseId: v.phaseId, card: c }; break }
    }
    expect(found, '数据里应有带人数分档的当期牌').toBeTruthy()
    const { config, catalog } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }])
    clearRows(config)
    applyPeriodBuff(config, found!.phaseId, found!.card)
    await Promise.resolve()

    const condStats = [...new Set(found!.card.effects.filter(e => e.cond?.countTier && e.stat).map(e => e.stat))]
    expect(condStats.length, '前提：这张牌确有条件行').toBeGreaterThan(0)
    const oneAnomaly = engineGlobals(config, catalog)

    setTeam(config, [{ agentId: '1561' }, { agentId: '1261' }, { agentId: '1171' }])
    const threeAnomaly = engineGlobals(config, catalog)

    // 至少一条条件 stat 的数字随队伍变（同一批行、同一个 store，只有队伍变了）
    const moved = condStats.filter(s => (oneAnomaly[s] ?? 0) !== (threeAnomaly[s] ?? 0))
    expect(moved.length, `条件行必须按队伍换档（${condStats.join('/')} 三档读数逐位相同 = 条件没判定）`).toBeGreaterThan(0)
    // 且方向正确：3 异常队不会比 1 异常队低（低档 ≤ 满档；不计队伍自身差异，只看同一 stat 的总量）
    // 低档可能整条不生效（键缺席 = 0）⇒ 比大小前先归一
    for (const s of moved) expect(threeAnomaly[s] ?? 0, `${s}：3 异常队应 ≥ 1 异常队`).toBeGreaterThanOrEqual(oneAnomaly[s] ?? 0)
  }, 120_000)

  it('★ 不是死控件：选牌后**队总伤害**真的变（拿掉牌回到原值）', async () => {
    // 挑「无条件 + 通用 stat（暴伤/攻击%/增伤/穿透/减抗）」的牌：元素伤牌对不匹配的队伍天然 0 收益、
    // 特性限定牌对不满足条件的队伍也 0 —— 用它们做判据会得到「无判别力的绿」。
    const UNIVERSAL = new Set(['atkPct', 'dmgBonus', 'critDmg', 'critRate', 'penRatio', 'enemyResReduction', 'enemyDefReduction', 'enemyDamageTakenBonus'])
    let picked: { phaseId: string; card: PhaseBuffCard } | null = null
    for (const v of bp.phaseViews ?? []) {
      const env = resolvePhaseEnvironment(bp, null, v.phaseId)
      const c = env?.selectable.find(x => !x.testOnly && x.effects.some(e => e.stat && !e.cond && !e.targetSkillType && UNIVERSAL.has(e.stat)))
      if (c) { picked = { phaseId: v.phaseId, card: c }; break }
    }
    expect(picked, '数据里应有「无条件通用 stat」的当期牌').toBeTruthy()
    const { phaseId, card } = picked!
    const { config } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }], { recommendedBuild: true })
    clearRows(config)
    const { useResourceCalc } = await import('@/composables/useResourceCalc')
    const calc = useResourceCalc()
    const without = calc.teamTotalDamage.value ?? 0
    applyPeriodBuff(config, phaseId, card)
    const withCard = calc.teamTotalDamage.value ?? 0
    expect(without, '前提：基线伤害非 0').toBeGreaterThan(0)
    expect(withCard, `选了「${card.title}」总伤必须变（逐位相同 = 死控件）`).not.toBe(without)
    applyPeriodBuff(config, phaseId, null)
    expect(calc.teamTotalDamage.value, '清掉牌必须回到原值').toBe(without)
  }, 300_000)
})
