/**
 * CC-259：**引擎实打交互次数**的唯一模块（难度 x 轴的输入）。
 *
 * 散点页（`teamCompare` 生成点）与难度曲线（`difficultyCurve#measureOperationalDifficulty`）两处共用：
 * 两图注释与 @fact 都声称「同一函数同一单位、可直接对齐比较」，
 * 修前散点读**预设声明**、曲线读**引擎实打** ⇒ 97/104 个预设两图 x 不同（§24.100）。
 *
 * 为什么独立成模块：`difficultyCurve` → `teamCompare` 是单向依赖（曲线要用 computeDifficulty 等），
 * 散点也要用 liveInteractions ⇒ 放任一侧都会成环或复制。本模块只依赖类型与 agentMechanicView（纯读模块声明）。
 */
import type { ConfigModel } from '@/stores/config'
import { interactionFieldTypeOf } from '@/composables/agentMechanicView'
import type { InteractionItem, TeamPreset } from '@/types/teamPreset'
import type { TeamResourceResult } from '@/types/resource'
import { DOWNSCALED_INTERACTION_FIELDS, downscaleInteractionCount } from '@/composables/resourceCalc/feasibilitySearch'

const DOWNSCALED = new Set<string>(DOWNSCALED_INTERACTION_FIELDS)

/**
 * **交互次数按装配期截断存活率缩**（用户 2026-09-11：「不上升合轴率导致招式截断，
 * 那么对应的资源回复也应该降低，或者交互次数应该降低」）：每槽 `kept / requested`（`convergence.truncationBySlot`）。
 * 槽账只在该槽真被截断时产出，requested > 0、0 ≤ kept ≤ requested（`SlotTruncation` 契约），因子天然落在 [0, 1]，不钳。
 * 无截断（或没传 rr）⇒ 因子 1 ⇒ 零变化。近似口径与 A 项（截断回灌资源循环）见 `core/resource.ts` 的 debt 标记。
 * （CC-259 删去散点专用的团队聚合版 teamInteractionSurvival / shrinkInteractionsByTruncation：散点改读实打次数后天然按槽。）
 */
export function interactionSurvivalBySlot(rr?: TeamResourceResult | null): Map<number, number> {
  const out = new Map<number, number>()
  for (const s of rr?.convergence.truncationBySlot ?? []) {
    out.set(s.slot, s.kept / s.requested)
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
const ENGINE_INTERACTION_FIELDS: { type: string; field: keyof ConfigModel['team'][number] }[] = [
  { type: 'parry', field: 'parryCount' },
  { type: 'dodge', field: 'dodgeCounterCount' },
  { type: 'block', field: 'blockCount' },
  // 2026-09-20：需怪攻击的两类（用户口径点名）——它们此前只在角色模块内部消费，没进难度轴，
  // 于是「仪玄 e 弹 5 次」对操作难度零贡献。补进来后默认吃非失衡占比修正
  // （见 `teamCompare#BOSS_ATTACK_INTERACTIONS`）。
  { type: 'yixuanPerfectBlock', field: 'yixuanPerfectBlockCount' },
  { type: 'perfectBlock', field: 'perfectBlockCount' },
  { type: 'tauntCancel', field: 'tauntCancelCount' },
  // 赛维里安·自动闪避（a4 闪避判定 / 前三段受击）：需 boss 出手 ⇒ 默认吃非失衡占比修正
  { type: 'severianAutoEvade', field: 'autoEvadeCount' },
  // 克拉蕾·葬血强袭打断（用户技巧 2026-10-09）：角色专属交互，权重 = 一次闪反（1.2），
  // 公式 `c*w`（不吃非失衡占比修正——它不需要 boss 先出手，与快支/嘲讽取消同类）。
  { type: 'claretBurialInterrupt', field: 'claretBurialInterruptCount' },
]

/** CC-258：只有角色声明了专属类型名才进难度轴的引擎字段（般岳双反；通用角色的 dualCounterCount 恒 0 且无全局类型） */
const OVERRIDE_ONLY_INTERACTION_FIELDS = ['dualCounterCount'] as const

/**
 * CC-258：**引擎侧实打交互次数**的唯一读取（`liveInteractions` 经此读取，散点与难度曲线共用）。
 * 逐字段 × 逐槽：类型名 = 该槽模块 `interactionFieldTypes[field]` ?? 全局类型名；同名求和。
 * 全局类型即使 0 次也保留（明细要能照抄字段）；`shrink(slot, raw)` 负责截断存活率缩与取位。
 * CC-263：`interactionScale`（= `rr.convergence.interactionScale`）先按引擎口径降配取整，再交给 `shrink`
 * （引擎顺序同：合并 cfg 时缩放 → 装配期截断）。缺省 / ≥1 ⇒ 逐位不变。
 */
export function engineInteractionItems(
  config: ConfigModel,
  shrink: (slot: number, raw: number) => number,
  interactionScale?: number,
  /**
   * **引擎实打值覆盖**（按槽 × 字段）：给了就以它为准，不读 store、也不再乘 `shrink`。
   *
   * 用途 = 「store 里填的是**意图**、引擎会按物理上限 clamp」的那类交互。当前唯一消费方 =
   * 般岳的嘲讽取消（`tauntCancelCount`）：store 写 99 = 「拉到后摇归零」，引擎
   * `computeBanyueRageCycle` 用 `min(手填, 失衡外连段数)` 截断，实际可能只有十几次。
   * 难度 x 若读 store 原值，会把「意图」当成「操作量」（实测虚高 5~10 倍，见
   * `difficultyLadder#applyInteractionKnob` 的注释）。
   */
  actualOf?: (slot: number, field: string) => number | undefined,
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
      const actual = actualOf?.(slot, field)
      if (actual !== undefined) {
        // 引擎实打值 = 已经交付的次数 ⇒ 不再走降配缩放 / 截断存活率缩（双重折损会把真账压小）
        byType.set(t, (byType.get(t) ?? 0) + actual)
        continue
      }
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
/**
 * @fact engine:操作难度/交互项读实打 口径: 难度 x 的交互项一律读**引擎实打次数**——降配按 `interactionScale` 缩、截断按槽存活率缩；**store 里填的是意图**的字段（当前唯一 = 般岳 `tauntCancelCount`，引擎按 `min(手填, 失衡外连段数)` clamp）改读 `banyueRageCycle.tauntCancelCount`；无 `rr` = 缩前量 ⇒ 不覆盖（两口径泾渭分明） | 据 用户@2026-10-23「难度曲线斜率太低」→ 实测写满 99×3 槽使 x 虚高 356 点而伤害逐位不变 | 验 src/composables/__tests__/tauntCancelLever.test.ts::★ ③′ | 锚 src/composables/liveInteractions.ts#liveInteractions | 信 确认
 * ⟳复核: 新增「store 是意图、引擎会 clamp」的交互字段时，确认是否纳入 `actualOf` 覆盖（否则难度 x 会读意图值虚高） | 到期 2027-04-30
 */
export interface LiveInteractionOptions {
  /**
   * `false` = **不缩**（不给降配 / 截断存活率打折），只吃 `actualOf` 的引擎 clamp。
   * 用途 = 难度曲线「缩前量」那一读口（`captureLadderSnapshot#interactionsFilled`）：
   * 它要的是「这一档配了多少」，而不是「时间线交付了多少」——但`store 是意图`的字段
   * （嘲讽取消 99 = 「拉到后摇归零」）仍必须按引擎 clamp 后的物理上限算，
   * 否则截断提醒会把「引擎物理上限」误报成「被时间砍掉 92 次」。
   */
  shrink?: boolean
}

export function liveInteractions(
  config: ConfigModel,
  preset?: Pick<TeamPreset, 'interactions'>,
  rr?: TeamResourceResult | null,
  opts?: LiveInteractionOptions,
): InteractionItem[] {
  const shrinkEnabled = opts?.shrink !== false
  const survival = shrinkEnabled ? interactionSurvivalBySlot(rr) : new Map<number, number>()
  // 缩后保留 2 位小数（roundInteractionCount）：不取整会在难度明细里打出 15 位浮点尾巴（实测撑破散点明细表）
  const shrink = (slot: number, count: number) => roundInteractionCount(count * (survival.get(slot) ?? 1))
  /**
   * 引擎实打值（只覆盖「store = 意图、引擎会 clamp」的字段）：嘲讽取消。
   * 读 `CharacterResourceResult.banyueRageCycle.tauntCancelCount`（`banyue.ts` 已按
   * `min(手填, 失衡外连段数)` 截断）⇒ 难度 x 的该项 = **真取消了几次**，不是填了几个。
   * 无 `rr`（缩前量 / 纯展示诊断）⇒ 不覆盖，退回 store 值。
   */
  const actualOf = (slot: number, field: string): number | undefined => {
    if (field !== 'tauntCancelCount') return undefined
    /**
     * `rr` 可能是**部分 mock**（`difficultyCurve.test` 的纯函数用例只造 `convergence`）⇒
     * 按诚实类型读（判据 28：类型说必有的字段不写 `?.`，缺值场景在**读点**声明）。
     */
    const partial: Partial<TeamResourceResult> | null | undefined = rr
    const c = partial?.characters?.find(x => x.slot === slot)
    const v = c?.banyueRageCycle?.tauntCancelCount
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : undefined
  }
  const out: InteractionItem[] = engineInteractionItems(
    config, shrink, shrinkEnabled ? rr?.convergence.interactionScale : 1, actualOf,
  )
  const engineTypes = new Set(out.map(i => i.type))
  // 反制支援（角力化解一组控制技）：次数不是 store 字段而是**运行时折算**（boss 控制技组 ×
  // 队内有反制支援招式的角色），按承接槽位的截断存活率缩。
  //
  // @fact engine:操作难度/角力权重 口径: 反制支援每次角力 = 一次弹刀同权重（1.0），单列类型 `counterAssist` 以便明细可读、用户仍可单独覆盖；次数取运行时折算结果（`configStore.counterAssistSlot` ≥0 时的 `appliedBoss.counterAssistGroups.length`），并按承接槽位截断存活率缩，与其余交互同口径 | 据 用户@2026-09-12「角力的操作就是一次弹刀而已，计同等权重就行，确实不难」·复核@2026-09-25·复核@2026-09-30·复核@2026-10-07 | 验 src/composables/__tests__/counterAssist.test.ts::角力 = 一次弹刀同权重 | 锚 src/composables/liveInteractions.ts#liveInteractions | 信 确认
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
