/**
 * 音擎下拉的**职业优先排序 / 分组**（用户 2026-10-26）。
 *
 * 用户原话：「这下拉菜单点进去太多了，能不能把同职业的放在前面，因为同职业才能触发武器效果。」
 *
 * ## 为什么职业要排前面（不是审美）
 *
 * 音擎的 `effect.requirement.specialty` 是**硬门槛**：`wEngineEffectRequirementMet`
 * （`core/wengineConditions.ts`）在 `wearerSpecialty !== req.specialty` 时直接 `return false`
 * ⇒ 不同职业的音擎穿上去**只有白值、被动全废**（实测同职业 A 级之间就差 3~8 个百分点，
 * 跨职业还多丢一整条被动）。所以列表按「能不能触发」分层，比按 id / 稀有度排有用得多。
 *
 * ## 三层顺序（与 `data/downgradeWEngines` 的三层代价同构）
 *
 * 1. **同职业 + 该角色常用的那几件**（`DOWNGRADE_WENGINES[agentId]`）——实战顶分里真有人穿过；
 * 2. **同职业其余**（其余不占限定金的 A 级 / 常驻 S，白值高的在前）；
 * 3. **跨职业**（折起来，标注「被动不触发」）——留着是因为用户可能就是想比较"少一条被动差多少"。
 *
 * 分组用 `n-select` 的 `type: 'group'`（naive-ui 原生分组），组名自带结论：
 * 「✓ 同职业（可触发）」「× 其它职业（被动不触发）」。
 *
 * ⚠ 本模块只排**显示顺序**，不改任何求值：穿什么仍由调用方给的那个 id 决定。
 */
import type { SelectGroupOption, SelectOption } from 'naive-ui'
import type { WEngine, Specialty } from '@/types/catalog'
import { DOWNGRADE_WENGINES, DOWNGRADE_BY_SPECIALTY } from '@/data/downgradeWEngines'
import { localized } from '@/utils/format'
// 限定金判定直接走单源，不转 `teamCompare.isLimitedWEngine`：那个包装要读 pinia store
  // （别名解析），在纯函数/单测里会炸「no active Pinia」。这里拿到的已经是 catalog 主 id。
import { isLimitedSWengineId } from '@/composables/limitedGold'

/**
 * naive-ui 的选项类型（直接引用库声明，不自己重述一遍形状——判据 29 会拦"类型字面量副本"）。
 * `SelectOption` = 叶子（value/label），`SelectGroupOption` = 分组标题 + children。
 */
export type EngineOption = SelectOption | SelectGroupOption

export interface EngineTier {
  /** 该件是否与该角色同职业（= 被动能触发） */
  matches: boolean
  /** 0 = 该角色常用件；1 = 同职业其余；2 = 跨职业 */
  tier: 0 | 1 | 2
}

/**
 * 判定一件音擎属于哪一层。
 *
 * 「同职业」以 **`effect.requirement.specialty`** 为准，无 requirement 的音擎（19/85 件）
 * 回落到 `w.specialty`（数据契约：音擎自身也有 specialty，两者只在少数通用件上不同）。
 */
export function engineTierOf(w: WEngine, agentSpecialty: Specialty | undefined, agentId: string | undefined): EngineTier {
  // `effect` 是必填字段（catalog 契约 85/85 都有），只有 `requirement` 是可选的
  const gate = w.effect.requirement?.specialty ?? w.specialty
  const matches = !!agentSpecialty && gate === agentSpecialty
  if (!matches) return { matches: false, tier: 2 }
  const own = agentId ? DOWNGRADE_WENGINES[agentId] : undefined
  if (own?.includes(w.id)) return { matches: true, tier: 0 }
  return { matches: true, tier: 1 }
}

/** 一件音擎的下拉标签：名字（稀有度[·限定]） */
export function engineLabelOf(w: WEngine): string {
  return `${localized(w.name, w.id)}（${w.rarity}${isLimitedSWengineId(w.id) ? '·限定' : ''}）`
}

/**
 * 把音擎列表排成 **同职业 → 跨职业** 的两组（组内按 tier 再按表内顺序）。
 *
 * `pool` 缺省 = 全部音擎；传了就只排那些 id（`data/downgradeWEngines` 的候选池走这条）。
 */
export function groupEnginesForAgent(
  engines: ReadonlyArray<WEngine>,
  agentSpecialty: Specialty | undefined,
  agentId: string | undefined,
  opts: { emptyLabel?: string } = {},
): EngineOption[] {
  const own: WEngine[] = []
  const other: WEngine[] = []
  for (const w of engines) {
    const t = engineTierOf(w, agentSpecialty, agentId)
    if (t.tier === 2) other.push(w)
    else own.push(w)
  }
  // 组内：先「该角色常用件」按表内顺序，再其余（保持调用方给的原顺序 = catalog 顺序，白值高的在前）
  const ownOrder = agentId ? (DOWNGRADE_WENGINES[agentId] ?? []) : []
  const rank = (w: WEngine): number => {
    const i = ownOrder.indexOf(w.id)
    return i >= 0 ? i : ownOrder.length + 1
  }
  own.sort((a, b) => rank(a) - rank(b))

  const out: EngineOption[] = []
  if (opts.emptyLabel) out.push({ value: '', label: opts.emptyLabel })
  if (own.length > 0) {
    out.push({ type: 'group', label: '✓ 同职业（被动可触发）', children: own.map(w => ({ value: w.id, label: engineLabelOf(w) })) })
  }
  if (other.length > 0) {
    out.push({ type: 'group', label: '× 其它职业（被动不触发）', children: other.map(w => ({ value: w.id, label: engineLabelOf(w) })) })
  }
  return out
}

/**
 * 下位候选（`DOWNGRADE_WENGINES` / `DOWNGRADE_BY_SPECIALTY` 给的 id 串）→ 选项，
 * **同职业的排前面**、跨职业的折进第二组。
 *
 * 与 `groupEnginesForAgent` 的差别：这里输入是 id 串（可能来自角色表，天然同职业；
 * 也可能来自职业表），输出要保持**原顺序**（表内顺序 = 频次/白值排序，不能重排），
 * 只把「跨职业」的挑出来放后面 —— 这是个纯分区，不是 sort。
 */
export function partitionEngineIds(
  ids: ReadonlyArray<string>,
  byId: (id: string) => WEngine | undefined,
  agentSpecialty: Specialty | undefined,
  agentId: string | undefined,
): { own: WEngine[]; other: WEngine[] } {
  const own: WEngine[] = []
  const other: WEngine[] = []
  for (const id of ids) {
    const w = byId(id)
    if (!w) continue
    if (engineTierOf(w, agentSpecialty, agentId).matches) own.push(w)
    else other.push(w)
  }
  return { own, other }
}

/** 该职业的全部下位候选（`DOWNGRADE_BY_SPECIALTY`）——「同职业其余」组的兜底来源 */
export function specialtyPoolOf(specialty: Specialty | undefined): readonly string[] {
  return specialty ? (DOWNGRADE_BY_SPECIALTY[specialty] ?? []) : []
}
