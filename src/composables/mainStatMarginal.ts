/**
 * 驱动盘主词条「边际效用」（CC-346，2026-10-02 arena-E r376）：对当前队伍每个槽位 4 / 5 / 6 号位主词条，
 * 逐个试换成候选词条，读替换后的队伍总伤与相对当前的增量。
 *
 * 为什么独立成模块（原先整段写在 `components/MarginalUtilityCard.vue`）：
 * - 旧实现直接改写 **UI config store** 的主词条、每个候选让出一次主线程、`finally` 里写回——
 *   页面上所有绑在 UI store 的计算都为每个候选重算，用户此时的编辑会被写回覆盖；
 *   原先没有主词条的位置写回时被写成 `''`（现场被改）。这是 CC-343 用独立场景消除的结构。
 * - **旧实现的数值缺陷**：候选之间**不还原**。同一槽位 4 号位试完最后一个候选后，5 号位的候选是在
 *   「4 号位 = 上一个候选」的配装上测的，表里「替换后伤害 / 相对增量」除第一组外都混进了前一组的替换。
 *   页面文案是「估算替换后的伤害增量」（单项替换），所以这里每个候选都在**原配装**上只换这一处（试完即还原）。
 *   这是有意的口径修正，不是零差搬迁；A/B 与反证见 docs/mcp-analyzer-scenario-isolation.md §3.7。
 */
import type { AnalysisContext } from '@/composables/analysisScenario'
import { isBatchAborted, type BatchControl } from '@/composables/batchTask'
import type { ConfigModel } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'

/** 主词条候选（按盘位） */
export const MAIN_STAT_CANDIDATES: Readonly<Record<4 | 5 | 6, readonly string[]>> = {
  4: ['anomalyProficiency', 'atkPct', 'critRate', 'critDmg'],
  5: ['penRatio', 'atkPct', 'physicalDmg', 'fireDmg', 'iceDmg', 'electricDmg', 'etherDmg', 'windDmg'],
  6: ['atkPct', 'anomalyMastery', 'energyRegen', 'impact'],
}

const STAT_LABELS: Record<string, string> = {
  anomalyProficiency: '精通', atkPct: '攻击%', critRate: '暴击率', critDmg: '暴伤',
  penRatio: '穿透率', physicalDmg: '物理增伤', fireDmg: '火增伤', iceDmg: '冰增伤',
  electricDmg: '电增伤', etherDmg: '以太增伤', windDmg: '风增伤',
  anomalyMastery: '异常掌控', energyRegen: '能量回复', impact: '冲击力',
}

/** 5 号位元素增伤 → 角色 damageElement（只保留与角色属性匹配的元素增伤） */
const ELEMENT_DMG_TO_AGENT: Record<string, string> = {
  physicalDmg: 'physical', fireDmg: 'fire', iceDmg: 'ice',
  electricDmg: 'electric', etherDmg: 'ether', windDmg: 'wind', lumifluxDmg: 'lumiflux',
}

export interface MainStatCandidate { slot: number; slotNum: 4 | 5 | 6; statId: string; label: string }
export interface MainStatMarginalRow extends MainStatCandidate { damage: number; pct: number }
export interface MainStatMarginals {
  baseDamage: number
  /** 按候选生成顺序（槽位 → 盘位 → 候选表顺序）；排序交给展示层 */
  rows: MainStatMarginalRow[]
  /** 被取消 ⇒ false（rows 只含已算部分） */
  complete: boolean
}

const yieldToMacrotask = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/** 当前队伍的全部候选（跳过空槽、无主词条的槽、与当前相同的词条、不匹配角色属性的元素增伤） */
export function mainStatCandidates(config: ConfigModel): MainStatCandidate[] {
  const catalog = useCatalogStore()
  const out: MainStatCandidate[] = []
  for (let slot = 0; slot < 3; slot++) {
    const char = config.team[slot]
    if (!char?.agentId) continue
    const disc = char.driveDisc
    if (!disc?.mainStats) continue
    const agentElement = catalog.getAgent(char.agentId)?.damageElement
    for (const slotNum of [4, 5, 6] as const) {
      const current = disc.mainStats[slotNum]
      for (const statId of MAIN_STAT_CANDIDATES[slotNum]) {
        if (statId === current) continue
        if (slotNum === 5 && ELEMENT_DMG_TO_AGENT[statId] && agentElement && ELEMENT_DMG_TO_AGENT[statId] !== agentElement) continue
        out.push({ slot, slotNum, statId, label: `槽${slot + 1} #${slotNum} → ${STAT_LABELS[statId] ?? statId}` })
      }
    }
  }
  return out
}

/** 在场景上逐个试换候选（每个候选只换一处、试完还原）；被取消时在下一个候选之前停 */
export async function computeMainStatMarginals(
  scenario: AnalysisContext,
  opts: { control?: BatchControl } = {},
): Promise<MainStatMarginals> {
  const { config, calc } = scenario
  const candidates = mainStatCandidates(config)
  await yieldToMacrotask()
  const baseDamage = calc.teamTotalDamage.value
  const rows: MainStatMarginalRow[] = []
  for (const c of candidates) {
    if (isBatchAborted(opts.control)) return { baseDamage, rows, complete: false }
    const mainStats = config.team[c.slot]!.driveDisc.mainStats
    const original = mainStats[c.slotNum]
    mainStats[c.slotNum] = c.statId
    await yieldToMacrotask()
    const damage = calc.teamTotalDamage.value
    mainStats[c.slotNum] = original
    rows.push({ ...c, damage, pct: baseDamage > 0 ? ((damage - baseDamage) / baseDamage) * 100 : 0 })
  }
  return { baseDamage, rows, complete: true }
}
