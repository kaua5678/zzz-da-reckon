/**
 * 局内生命构成拆解（CC-209，自 `components/FinalPanel.vue` 迁出）。
 *
 * 用途：FinalPanel「局内生命构成」核对表——谁提供了局内生命、提供多少。
 * 与引擎的关系（口径纪律）：
 * - 队友 buff 与全局 Buff 取引擎同一份输入 `resolveSlotPanelBuffInputs(...).teammateBuffs`（CC-208）；
 * - 覆盖率取引擎同一张 `effectCoverageMap`（calcPanel 实际用的那张：队友滑块 / 音擎效果滑块 / 全队驱动盘滑块），
 *   缺省回落 `effect.coverage.default`——与 `core/buff.ts#applyEffect` 的 `coverage ?? effect.coverage?.default ?? 1` 同式；
 *   此前只读 `coverage.default`，用户拖滑块后核对表与面板对不上；
 * - 模块 `applyPanel` / `teamPanelEffects` 在 calcPanel 之后直写面板、转模 / 公式条目本表只标注不计数
 *   ⇒ 逐条相加不保证等于引擎局内生命。`residualHp` = 引擎局内 hp − 按本表重建值，
 *   作为「未逐条列出」行显示，使公式行恒等于引擎结果（差额非零即提示去模块里找）。
 */
import type { BuffEffect, BuffGroup } from '@/types/catalog'
import type { ConfigModel } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import { resolveSlotPanelBuffInputs } from '@/composables/resourceCalc/helpers'
import { isPctStat } from '@/utils/statMeta'
import { effectAtModLevel, wEngineEffectBlockReason } from '@/composables/wEngineEffectDisplay'
import { fmt, pct, localized } from '@/utils/format'

/** 生命类 buff 字段（局内大生命 = inCombatHpPct / 局内 hpPct，局内小生命 = inCombatHpFlat / 局内 hpFlat） */
export const HP_PCT_STATS = new Set(['hpPct', 'inCombatHpPct'])
export const HP_FLAT_STATS = new Set(['hpFlat', 'inCombatHpFlat'])

export interface HpSourceRow { key: string; source: string; item: string; stat: string; value: string; num: number; phase: 'in' | 'out' }

/** effect 是否生命类及其阶段（局内/局外）；非生命类返回 null */
function hpPhase(effect: BuffEffect, group: BuffGroup | null | undefined): 'in' | 'out' | null {
  const stat = effect.stat
  if (!stat) return null
  if (stat === 'inCombatHpPct' || stat === 'inCombatHpFlat') return 'in'
  if (HP_PCT_STATS.has(stat) || HP_FLAT_STATS.has(stat)) {
    return group?.scope === 'inCombat' ? 'in' : 'out'
  }
  return null
}

/** effect 数值展示 + 实际生效数值（fixed 按精炼等级取 modificationValues × 覆盖率；derived/formula 标注动态，num=0） */
function hpEffectValue(raw: BuffEffect, cov: number, modLevel?: number): { text: string; num: number } {
  // CC-210：精炼取值走引擎同一函数（此前只替换 value，stacked 的 valuePerStack 用原值）
  const effect = effectAtModLevel(raw, modLevel)
  const suffix = modLevel && raw.modificationValues ? `（精炼${modLevel}）` : ''
  // 全局 buff 等无 type 的项按 fixed 处理
  if (!effect.type || effect.type === 'fixed') {
    const v = effect.value ?? 0
    const text = `${suffix}${isPctStat(effect.stat) ? pct(v) : fmt(v, 0)}${cov < 1 ? ` × 覆盖率${pct(cov * 100)}` : ''}`
    return { text, num: v * cov }
  }
  if (effect.type === 'stacked') {
    const per = effect.valuePerStack ?? effect.value ?? 0
    const stacks = effect.defaultStacks ?? effect.maxStacks ?? 1
    return { text: `${suffix}${per} × ${stacks}层${cov < 1 ? ` × 覆盖率${pct(cov * 100)}` : ''}`, num: per * stacks * cov }
  }
  if (effect.type === 'derived') {
    return {
      text: `转模 ${pct(effect.ratio ?? 0)}×${localized(effect.sourceLabel) || effect.basis || '来源'}` + (effect.cap != null ? `（上限 ${fmt(effect.cap, 0)}）` : ''),
      num: 0,
    }
  }
  if (effect.type === 'formula') {
    return { text: `公式${effect.formula?.expression ? `：${effect.formula.expression.slice(0, 40)}` : ''}`, num: 0 }
  }
  return { text: String(effect.value ?? 0), num: Number(effect.value ?? 0) }
}

/**
 * 收集指定槽位的全部生命类 buff 来源（局内大/小生命、局外生命）。
 */
export function collectHpSources(
  slot: number,
  configStore: ConfigModel,
  catalogStore: ReturnType<typeof useCatalogStore>,
): HpSourceRow[] {
  const rows: HpSourceRow[] = []
  const char = configStore.team[slot]
  if (!char?.agentId) return rows
  const agent = catalogStore.getAgent(char.agentId)
  if (!agent) return rows
  const { teammateBuffs, effectCoverageMap } = resolveSlotPanelBuffInputs(slot, configStore, catalogStore, configStore.displayWEngineEffectCoverages)

  const add = (source: string, item: string, group: BuffGroup | null | undefined, modLevel?: number, keep: (effect: BuffEffect) => boolean = () => true) => {
    for (const effect of group?.effects ?? []) {
      if (!keep(effect)) continue
      const phase = hpPhase(effect, group)
      if (!phase) continue
      const cov = effectCoverageMap.get(effect.id) ?? effect.coverage?.default ?? 1
      const { text, num } = hpEffectValue(effect, cov, modLevel)
      rows.push({ key: `${source}-${item}-${effect.stat}-${rows.length}`, source, item, stat: effect.stat, value: text, num, phase })
    }
  }

  // 1. 角色自身 combatBuffs（核心被动/额外能力/命座）
  const self = agent.name?.zhCN || agent.id
  add(self, '核心被动', agent.combatBuffs?.corePassive)
  add(self, '额外能力', agent.combatBuffs?.additionalAbility)
  for (const cinema of agent.combatBuffs?.cinemaBuffs ?? []) {
    if (cinema.cinemaLevel <= (char.cinemaLevel ?? 0)) add(self, `影画${cinema.cinemaLevel}`, cinema.buff)
  }

  // 2. 队友 buff：引擎同一份输入（CC-208；拥有者在队 / 门控 / 钩子否决 / 接收槽 / 修饰器改写均已生效）。
  //    全局 Buff 也在这份输入里（scope 'inCombat'，与引擎同口径），放到第 5 步单列。
  for (const buff of teammateBuffs) {
    if (buff.sourceKind === 'global') continue
    add(`${localized(buff.ownerName) || buff.ownerId}`, localized(buff.sourceLabel) || buff.id, buff)
  }

  // 3. 音擎：逐条按引擎发放口径（职业 / 组条件 / 效果限定，CC-211）；数值按精炼等级取（CC-210）
  const wEngine = char.wEngineId ? catalogStore.getWEngine(char.wEngineId) : undefined
  if (wEngine) {
    const modLevel = Math.max(1, Math.min(5, char.wEngineModLevel ?? 1))
    const weakness = configStore.enemy.weakness
    for (const [item, group] of [['自身效果', wEngine.effect?.selfBuff], ['团队效果', wEngine.effect?.teamBuff]] as const) {
      add(localized(wEngine.name) || wEngine.id, item, group, modLevel, e => wEngineEffectBlockReason(wEngine, group, e, agent, weakness) === null)
    }
  }

  // 4. 驱动盘套装
  const four = char.driveDisc?.fourPieceSetId ? catalogStore.getDriveDiscSet(char.driveDisc.fourPieceSetId) : undefined
  const two = char.driveDisc?.twoPieceSetId ? catalogStore.getDriveDiscSet(char.driveDisc.twoPieceSetId) : undefined
  if (four) {
    // 驱动盘 2 件套只有 effects（无 scope）；局外效果显式写出，与 hpPhase 的判定一致
    add(localized(four.name) || four.id, '2件套', { scope: 'outOfCombat', effects: four.twoPiece.effects })
    add(localized(four.name) || four.id, '4件套自身', four.fourPiece?.selfBuff)
    add(localized(four.name) || four.id, '4件套团队', four.fourPiece?.teamBuff)
  }
  if (two && two.id !== four?.id) add(localized(two.name) || two.id, '2件套', { scope: 'outOfCombat', effects: two.twoPiece.effects })

  // 5. 全局 Buff（属性配置页手动添加）：取引擎并入后的条目——此前自己包成无 scope 的伪分组，
  //    hpPct 会被判成「局外」，而引擎按局内结算
  for (const buff of teammateBuffs) {
    if (buff.sourceKind !== 'global') continue
    add('全局 Buff', localized(buff.ownerName) || buff.id, buff)
  }

  return rows
}

/** 按核对表重建的局内生命与引擎值的差额（模块直写 / 转模 / 公式 / 未列来源）。 */
export function hpBreakdownTotals(rows: readonly HpSourceRow[], outHp: number, inHp: number): { inHpPctTotal: number; inHpFlatTotal: number; residualHp: number } {
  const inHpPctTotal = rows.filter(r => r.phase === 'in' && HP_PCT_STATS.has(r.stat)).reduce((s, r) => s + r.num, 0)
  const inHpFlatTotal = rows.filter(r => r.phase === 'in' && HP_FLAT_STATS.has(r.stat)).reduce((s, r) => s + r.num, 0)
  const residualHp = inHp - (outHp * (1 + inHpPctTotal / 100) + inHpFlatTotal)
  return { inHpPctTotal, inHpFlatTotal, residualHp }
}
