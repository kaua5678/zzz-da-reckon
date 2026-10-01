/**
 * CC-259：**引擎实打交互次数**的唯一模块（难度 x 轴的输入）。
 *
 * 散点页（`teamCompare` 生成点）、难度曲线（`difficultyCurve#measureOperationalDifficulty`）、难度下降
 * （`difficultyDescent`）三处共用：两图注释与 @fact 都声称「同一函数同一单位、可直接对齐比较」，
 * 修前散点读**预设声明**、曲线读**引擎实打** ⇒ 97/104 个预设两图 x 不同（§24.100）。
 *
 * 为什么独立成模块：`difficultyCurve` → `teamCompare` 是单向依赖（曲线要用 computeDifficulty 等），
 * 散点也要用 liveInteractions ⇒ 放任一侧都会成环或复制。本模块只依赖类型与 agentMechanicView（纯读模块声明）。
 */
import type { useConfigStore } from '@/stores/config'
import { interactionFieldTypeOf } from '@/composables/agentMechanicView'
import type { InteractionItem, TeamPreset } from '@/types/teamPreset'
import type { TeamResourceResult } from '@/types/resource'
import { DOWNSCALED_INTERACTION_FIELDS, downscaleInteractionCount } from '@/composables/resourceCalc/feasibilitySearch'

const DOWNSCALED = new Set<string>(DOWNSCALED_INTERACTION_FIELDS)

/**
 * **交互次数按装配期截断存活率缩**（用户 2026-09-11：「不上升合轴率导致招式截断，
 * 那么对应的资源回复也应该降低，或者交互次数应该降低」）：每槽 `kept / requested`（`convergence.truncationBySlot`）。
 * 无截断（或没传 rr）⇒ 因子 1 ⇒ 零变化。近似口径与 A 项（截断回灌资源循环）见 `core/resource.ts` 的 debt 标记。
 * （CC-259 删去散点专用的团队聚合版 teamInteractionSurvival / shrinkInteractionsByTruncation：散点改读实打次数后天然按槽。）
 */
export function interactionSurvivalBySlot(rr?: TeamResourceResult | null): Map<number, number> {
  const out = new Map<number, number>()
  for (const s of rr?.convergence?.truncationBySlot ?? []) {
    out.set(s.slot, s.requested > 0 ? Math.max(0, Math.min(1, s.kept / s.requested)) : 1)
  }
  return out
}

/**
 * 缩后的交互次数保留 2 位小数（**必须**）：不取整会在明细里打出 `弹刀7.244532236386592×1`
 * ——实机点通实测把散点明细表的「交互明细」列撑到 538px、表格横向溢出 36px（2026-09-11）。
 * 难度轴本来就是主观量，2 位小数足够，页面/明细都可读。
 */
export function roundInteractionCount(v: number): number {
  return Math.round(v * 100) / 100
}

/**
 * 引擎侧交互字段 ↔ 难度交互类型（`computeDifficulty` 的入参口径）。
 * 只列**有引擎字段**的类型（全局类型名）；角色专属类型名由模块 `interactionFieldTypes` 按槽位覆盖
 * （CC-258：般岳 blockCount = 金身格挡 `banyueGoldenParry`，修前按普通 `block` 计、又从预设声明补一次 = 双计）。
 * 只经 `engineInteractionItems` 读取。
 */
const ENGINE_INTERACTION_FIELDS: { type: string; field: keyof ReturnType<typeof useConfigStore>['team'][number] }[] = [
  { type: 'parry', field: 'parryCount' },
  { type: 'dodge', field: 'dodgeCounterCount' },
  { type: 'quickAssist', field: 'quickAssistCount' },
  { type: 'block', field: 'blockCount' },
  // 2026-09-20：需怪攻击的两类（用户口径点名）——它们此前只在角色模块内部消费，没进难度轴，
  // 于是「仪玄 e 弹 5 次」对操作难度零贡献。补进来后默认吃非失衡占比修正
  // （见 `teamCompare#BOSS_ATTACK_INTERACTIONS`）。
  { type: 'yixuanPerfectBlock', field: 'yixuanPerfectBlockCount' },
  { type: 'perfectBlock', field: 'perfectBlockCount' },
  { type: 'tauntCancel', field: 'tauntCancelCount' },
]

/** CC-258：只有角色声明了专属类型名才进难度轴的引擎字段（般岳双反；通用角色的 dualCounterCount 恒 0 且无全局类型） */
const OVERRIDE_ONLY_INTERACTION_FIELDS = ['dualCounterCount'] as const

/**
 * CC-258：**引擎侧实打交互次数**的唯一读取（难度曲线 `liveInteractions` 与难度下降 `difficultyDescent` 共用）。
 * 逐字段 × 逐槽：类型名 = 该槽模块 `interactionFieldTypes[field]` ?? 全局类型名；同名求和。
 * 全局类型即使 0 次也保留（明细要能照抄字段）；`shrink(slot, raw)` 负责截断存活率缩与取位。
 * CC-263：`interactionScale`（= `rr.convergence.interactionScale`）先按引擎口径降配取整，再交给 `shrink`
 * （引擎顺序同：合并 cfg 时缩放 → 装配期截断）。缺省 / ≥1 ⇒ 逐位不变。
 */
export function engineInteractionItems(
  config: ReturnType<typeof useConfigStore>,
  shrink: (slot: number, raw: number) => number,
  interactionScale?: number,
): InteractionItem[] {
  const byType = new Map<string, number>()
  for (const { type } of ENGINE_INTERACTION_FIELDS) byType.set(type, 0)
  const fields: { type?: string; field: string }[] = [
    ...ENGINE_INTERACTION_FIELDS.map(f => ({ type: f.type, field: f.field as string })),
    ...OVERRIDE_ONLY_INTERACTION_FIELDS.map(field => ({ field })),
  ]
  for (const { type, field } of fields) {
    for (let slot = 0; slot < 3; slot++) {
      const char = config.team[slot]
      const t = interactionFieldTypeOf(char?.agentId, field) ?? type
      if (!t) continue
      const stored = Number((char as Record<string, unknown> | undefined)?.[field] ?? 0)
      const raw = DOWNSCALED.has(field) ? downscaleInteractionCount(stored, interactionScale) : stored
      byType.set(t, (byType.get(t) ?? 0) + shrink(slot, raw))
    }
  }
  return [...byType].map(([type, count]) => ({ type, count }))
}

/**
 * **当前配置**（不是预设声明）的交互清单，并按**装配期截断存活率**缩到「180s 里真打的次数」——
 * 难度曲线的「交互值」自变量必须是**这一档实际打的次数**：G2 联合策略会改弹刀、般岳会补交互、
 * 角点解会压非主C平A，读预设声明就量不出这些变化。
 *
 * 存活率（用户 2026-09-11 口径：「不上升合轴率导致招式截断，那么对应的资源回复也应该降低，
 * 或者交互次数应该降低」）：`kept / requested` 取自 `rr.convergence.truncationBySlot`
 * （Σ截断前招式行秒 → Σ保留）——引擎的截断是**整槽按比例缩**，故同比例缩该槽的交互次数即
 * 「这一槽的招式被砍掉多少，交互也就少打多少」。无截断（或没传 `rr`）时因子 = 1，
 * **不产生任何数值变化**（所以只有带截断的队会动）。
 *
 * ⚠️ 这是**止血近似**（A 项「截断回灌资源循环」的前置）：按槽缩而没按交互类型精确缩
 * （如般岳 金身/双反 共用一行「冲霄」），且资源账本仍是未截断的（见 `core/resource.ts` 的 debt 标记）。
 */
export function liveInteractions(
  config: ReturnType<typeof useConfigStore>,
  preset?: Pick<TeamPreset, 'interactions'>,
  rr?: TeamResourceResult | null,
): InteractionItem[] {
  const survival = interactionSurvivalBySlot(rr)
  // 缩后保留 2 位小数（roundInteractionCount）：不取整会在难度明细里打出 15 位浮点尾巴（实测撑破散点明细表）
  const shrink = (slot: number, count: number) => roundInteractionCount(count * (survival.get(slot) ?? 1))
  const out: InteractionItem[] = engineInteractionItems(config, shrink, rr?.convergence?.interactionScale)
  const engineTypes = new Set(out.map(i => i.type))
  // 反制支援（角力化解一组控制技）：次数不是 store 字段而是**运行时折算**（boss 控制技组 ×
  // 队内有反制支援招式的角色），按承接槽位的截断存活率缩。
  //
  // @fact engine:操作难度/角力权重 口径: 反制支援每次角力 = 一次弹刀同权重（1.0），单列类型 `counterAssist` 以便明细可读、用户仍可单独覆盖；次数取运行时折算结果（`configStore.counterAssistSlot` ≥0 时的 `appliedBoss.counterAssistGroups.length`），并按承接槽位截断存活率缩，与其余交互同口径 | 据 用户@2026-09-12「角力的操作就是一次弹刀而已，计同等权重就行，确实不难」·复核@2026-09-25·复核@2026-09-30 | 验 src/composables/__tests__/counterAssist.test.ts::角力 = 一次弹刀同权重 | 锚 src/composables/liveInteractions.ts#liveInteractions | 信 确认
  const caSlot = config.counterAssistSlot
  const caCount = caSlot >= 0 ? shrink(caSlot, config.appliedBoss?.counterAssistGroups?.length ?? 0) : 0
  if (caCount > 0) out.push({ type: 'counterAssist', count: caCount, slot: caSlot })
  for (const it of preset?.interactions ?? []) {
    // 引擎侧已给出实打次数的类型不再吃预设声明（防双计）
    if (engineTypes.has(it.type)) continue
    if (it.type === 'counterAssist' && caCount > 0) continue
    out.push({ ...it, count: shrink(it.slot ?? 0, it.count) })
  }
  return out
}
