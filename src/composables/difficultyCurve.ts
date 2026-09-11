/**
 * 难度曲线展示层：把 `climbDifficultyLadder` 的逐队贪心阶梯变成可画、可比的形状。
 *
 * 用户 2026-09-10 口径（改这里前先读）：
 *  ① **x 轴 = 每队自己的优化路径**，纵轴伤害、**x 是「自动算的操作难度」绝对值**
 *     （= Σ交互次数×权重 + **时间压力秒×权重**，与散点页横轴同一把尺；用户 2026-09-10：「难度系数肯定是自动算呀，
 *     参数可以修改，自变量就是交互值、吃掉队友的合轴时间等」）——**各队起点/走向不齐是特性**，
 *     对比看的是形状（起点 / 斜率 / 天花板 / 提升倍数）；
 *     ⚠️ 时间压力 = 硬溢出 + 合轴抵扣 **一笔秒数**（用户 2026-09-11：「通过合轴来让溢出时间降低这俩其实是一个东西」），
 *     只挂一个权重；x 仍**不保证单调**：有的杠杆减少交互次数（难度降、伤害升 = 白拿的优化，贪心优先做）；
 *  ② 点 = 累积开启的优化目标，档位数 = 录取到的目标数（最简版就是「全关 / 全开」两点）；
 *  ③ 开启顺序由贪心决定 ⇒ 这条曲线 = **该队的最优提升路径**。
 *
 * **口径（与散点页对齐，别各自发明）**：
 *  · 全关基线 = `help teamCompare#applyTeamToStore`（预设声明的静态权重 / 交互 / 音擎 / 驱动盘）
 *    + `clearDifficultyLevers`（保底关、计数投影 off）+ `timeWeightStrategy='static'`（不跑自动分配）；
 *  · Boss / 期数 = 当前选中的期数视图（与散点同一入口）；
 *  · 金档可调（走 `applyGoldSteps`，缺省 = 该队基础金）；**不含 buff、不含「最优加金 / 自动下位」**
 *    （曲线要的是跨队同口径的形状）⇒ 起点 ≠ 散点页某个点，页面已注明。
 *
 * **关键次数标注**（用户 2026-09-10 口径：「难度上升到关键变化后可以标注，比如大招多了一次，
 * 毁伤多一次，异常角色就紊乱多一次乱流多一次」）：阶梯每档采一次 `captureKeyCounts` 快照，
 * 相邻档差分后**只标注 Δ≥1 的跃迁**（引擎次数常带小数，+0.1 的微调不算"多一次"，只进 tooltip）；
 * 另加一项**「合轴节省」（秒）**——合轴率优化解放出来的前台时间，是 G5 的主指标（用户口径：只看省出多少秒）。
 * 队伍级 7 项来自引擎字段，角色专属项来自模块自己的 `resourceSections` 展示行（`<数> 次`）——
 * **不在这里硬编码角色**，新增角色只要模块有那行就自动被标注。
 *
 * **伤害归因**：同一份快照里还采「伤害按来源分组」（直伤行用招式名、异常行用行 `type`），
 * 相邻档差分 → 「这一档 +N 伤害是谁贡献的，又被谁挤掉了」。**Σ 分组 ≡ 该档总伤害**
 * （`teamTotalDamage` 就是 `damagePoolRows` 求和）⇒ 归因是精确账，不是启发式；判据测试按这条不变量钉住。
 *
 * `buildCurveChart` 是纯函数（不碰 store / 引擎），判据测试在同名单测文件里。
 *
 * @fact engine:难度曲线/x轴 口径: x = **自动算的操作难度绝对值** = `computeDifficulty`(当前档实打交互次数, 时间压力秒, 用户权重) —— 与散点页横轴同一函数同一单位（故可直接对齐比较）；**时间压力 = 硬溢出 overflowSeconds + 合轴抵扣 saved，一笔秒数只挂一个权重**（用户 2026-09-11「合轴本身就有难度，通过合轴来让溢出时间降低这俩其实是一个东西」）；各队起点不齐是特性，且 x 不保证单调（杠杆可减少交互 ⇒ 难度降伤害升 = 白拿） | 据 用户@2026-09-10·口径合并@2026-09-11 | 验 difficultyCurve.test.ts::集成：x 轴 = 实测操作难度 | 锚 src/composables/difficultyCurve.ts#measureOperationalDifficulty | 信 确认
 * @fact engine:难度曲线/伤害归因 口径: 每档伤害按来源分组（直伤行 = 招式名、异常行 = 行 `type`，同名跨槽位合并），Σ 分组 ≡ 该档总伤害 ⇒ 归因精确；相邻档差分 = 正贡献 top + 被挤掉（最负在前）+ 其余，三段合计 ≡ 总 Δ | 据 实测@2026-09-10 | 验 difficultyCurve.test.ts::伤害归因 | 锚 src/composables/difficultyCurve.ts#attributeDmgChanges | 信 确认
 * @fact engine:难度曲线/关键次数标注 口径: 图上标注与「关键变化」面板只显示 Δ≥1 的次数跃迁（「多了一次」），Δ<1 的小数级微调只进 tooltip；关键次数 = 队伍级 7 项（大招/强特/连携/失衡/异常触发/紊乱/乱流，取自引擎结果字段）+ 角色专属「N 次」行（模块 `resourceSections` 自报，零角色硬编码） | 据 用户@2026-09-10 | 验 difficultyCurve.test.ts::只认「变多」 | 锚 src/composables/difficultyCurve.ts#diffKeyCounts | 信 确认
 * @fact engine:难度曲线/全关基线 口径: 「全关」= 散点页口径（`applyTeamToStore` 预设静态权重/交互 + `clearDifficultyLevers` + timeWeightStrategy=static），**不是** `resetDifficultyGoals` 的 agent 默认权重 ⇒ 展示层必须用 `opts.base` 覆盖；不含 buff/加金/自动下位，故曲线起点 ≠ 散点页的点（页面已注明） | 据 用户@2026-09-10 | 验 difficultyCurve.test.ts::computeDifficultyCurves | 锚 src/composables/difficultyCurve.ts#computeDifficultyCurves | 信 确认
 */
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  clearDifficultyLevers, climbDifficultyLadder, summarizeLadder,
  type DifficultyGoal, type LadderResult, type LadderSnapshot,
} from '@/composables/difficultyLadder'
import {
  applyAxisBinding, applyGoldSteps, applyTeamToStore, baseGoldOf, computeDifficulty,
  restoreStore, snapshotStore, type DifficultyWeights,
} from '@/composables/teamCompare'
import { frontlineOccupationBreakdown } from '@/core/resource/helpers'
import { getAgentMechanic } from '@/mechanics'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'
import type { AnomalyPoolResult, CharacterResourceResult, StunPoolResult } from '@/types/resource'
import type { InteractionItem, TeamPreset } from '@/types/teamPreset'

type Calc = ReturnType<typeof useResourceCalc>

export interface DifficultyCurveOptions {
  presets: TeamPreset[]
  boss: BossPreset
  /** 目标期数（与散点页同一入口：`selectedPhase`） */
  phase: BossPresetPhase
  /** 目标集（缺省 = DIFFICULTY_GOALS） */
  goals?: DifficultyGoal[]
  /** 相对门槛（缺省 1e-4） */
  minGainRatio?: number
  /**
   * 操作难度权重（主观量，页面「难度权重」弹层；缺省 = `INTERACTION_WEIGHTS` 默认表 + 时间压力 1 秒 = 1 点）。
   * 直接决定 x 轴：`computeDifficulty` 的 Σ(交互×权重) + 时间压力秒×权重（时间压力 = 硬溢出 + 合轴抵扣）。
   */
  difficultyWeights?: DifficultyWeights
  /**
   * **目标限定金**（缺省 = 该队预设基础金 `baseGoldOf(preset)`）。
   * 金步走 `teamCompare#applyGoldSteps`（= 散点页同源，含 `standardSteps` 常驻全量应用），
   * 越界自动钳制到该队档位范围；**不含**散点页的「最优加金 / 自动下位」两层。
   */
  goldLevel?: number
}

/** 一队的阶梯结果（展示层行） */
export interface DifficultyCurveRow {
  presetId: string
  name: string
  ladder: LadderResult
}

/**
 * 逐队算难度曲线（同步）。调用方按队分批调度避免卡 UI（同 `computeTeamComparePoints`）。
 * 计算完成/异常后恢复现场（队伍/敌方/轴/全局 buff + 机制开关 + 权重分配策略）。
 */
export function computeDifficultyCurves(calc: Calc, options: DifficultyCurveOptions): DifficultyCurveRow[] {
  const configStore = useConfigStore()
  const snap = snapshotStore(configStore)
  // 机制开关与权重策略**不在** StoreSnapshot 里（散点页不碰它们，故不去改那个共享契约）
  const extra = {
    strategy: configStore.timeWeightStrategy,
    mechanics: { ...configStore.mechanicSettings },
  }
  const rows: DifficultyCurveRow[] = []
  try {
    configStore.applyBossPreset({ id: options.boss.id }, options.phase, options.boss.monster, options.boss.defaults)
    // 「全关」= 不跑自动权重分配；阶梯里的 G1/G2 自己显式跑均衡/联合
    configStore.timeWeightStrategy = 'static'
    for (const preset of options.presets) {
      applyAxisBinding(configStore, snap, preset)
      // 配装口径：套该队**预设基础金**的 `applyGoldSteps`（含 standardSteps 常驻步；缺省路径也走它，
      // 否则「预设基础档」会漏掉常驻步而出现两个数）。曲线**不提供**金数档覆盖——金数提升属于
      // 「提升率」类图表，不是难度曲线的事（用户 2026-09-10 口径）。
      const applied = applyGoldSteps(
        preset.goldSteps, baseGoldOf(preset), baseGoldOf(preset), preset.standardSteps ?? [], preset.wEngines ?? [],
      )
      const ladder = climbDifficultyLadder({ config: configStore, calc }, preset.team as [string, string, string], {
        goals: options.goals,
        minGainRatio: options.minGainRatio,
        capture: ctx => captureLadderSnapshot(ctx.calc),
        // x 轴 = 自动算的操作难度（不是手填代价）：每个目标实测 Δ难度
        costOf: ctx => measureOperationalDifficulty(ctx, preset, options.difficultyWeights),
        base: (ctx, team) => {
          clearDifficultyLevers(ctx)
          applyTeamToStore(ctx.config, preset)
          // 金步叠加：影画/精炼/音擎（驱动盘与权重/交互已由 applyTeamToStore 套好，金步不碰）
          for (let slot = 0; slot < 3; slot++) {
            ctx.config.setCinemaLevel(slot, applied.cinemas[slot])
            ctx.config.setWEngineModLevel(slot, applied.wengineMods[slot])
            if (applied.wEngines[slot]) ctx.config.setWEngine(slot, applied.wEngines[slot])
          }
          void team
          return ctx.calc.teamTotalDamage.value
        },
      })
      rows.push({ presetId: preset.id, name: preset.name, ladder })
    }
  } finally {
    configStore.timeWeightStrategy = extra.strategy
    for (const k of Object.keys(configStore.mechanicSettings)) delete configStore.mechanicSettings[k]
    Object.assign(configStore.mechanicSettings, extra.mechanics)
    restoreStore(configStore, snap)
  }
  return rows
}

// ========== 操作难度：自动算的 x 轴（用户 2026-09-10 口径） ==========

/**
 * 引擎侧交互字段 ↔ 难度交互类型（`computeDifficulty` 的入参口径）。
 * 只列**有引擎字段**的类型；角色专属类型（如般岳·金身弹刀/双反）不进引擎字段，
 * 由 `liveInteractions` 从预设声明里补回来。
 */
const ENGINE_INTERACTION_FIELDS: { type: string; field: keyof ReturnType<typeof useConfigStore>['team'][number] }[] = [
  { type: 'parry', field: 'parryCount' },
  { type: 'dodge', field: 'dodgeCounterCount' },
  { type: 'quickAssist', field: 'quickAssistCount' },
  { type: 'block', field: 'blockCount' },
  { type: 'tauntCancel', field: 'tauntCancelCount' },
]

/**
 * **当前配置**（不是预设声明）的交互清单：难度曲线的「交互值」自变量必须是**这一档实际打的次数** ——
 * G2 联合策略会改弹刀、般岳会补交互、角点解会压非主C平A，读预设声明就量不出这些变化。
 * 无引擎字段的角色专属类型沿用预设声明（它们只进难度、不进引擎）。
 */
export function liveInteractions(
  config: ReturnType<typeof useConfigStore>,
  preset: TeamPreset,
): InteractionItem[] {
  const out: InteractionItem[] = []
  for (const { type, field } of ENGINE_INTERACTION_FIELDS) {
    let count = 0
    for (let slot = 0; slot < 3; slot++) count += Number(config.team[slot]?.[field] ?? 0)
    out.push({ type, count })
  }
  for (const it of preset.interactions ?? []) {
    if (!ENGINE_INTERACTION_FIELDS.some(f => f.type === it.type)) out.push(it)
  }
  return out
}

/**
 * **自动算的操作难度**（x 轴自变量）＝ 既有单一事实源 `teamCompare#computeDifficulty`：
 *   Σ(交互次数 × 权重) + **时间压力秒 × 权重**
 * 其中「交互次数」取**当前档的实打次数**；「时间压力」= 引擎 `overflowSeconds`（合轴抵扣后仍装不下、
 * 被时间线截断掉的秒数）+ `frontlineOccupationBreakdown().saved`（合轴把队友前台压出去、解放成可用前台的秒数）。
 * **这两个是同一笔秒数**（用户 2026-09-11 口径：「允许溢出一部分的原因是队友可以合轴，而合轴的效果是
 * 总动作时间可以溢出一部分」）⇒ `computeDifficulty` 相加后只乘一个权重，不再各挂一个。
 * 权重是主观量、可改（页面「难度权重」弹层，localStorage），优先级见该函数注释。
 *
 * ⚠️ 与散点页**同一个函数、同一个单位** ⇒ 两张图的 x 轴可对齐比较（这正是难度曲线要解决的对比问题）。
 */
export function measureOperationalDifficulty(
  ctx: { config: ReturnType<typeof useConfigStore>; calc: Calc },
  preset: TeamPreset,
  weights?: DifficultyWeights,
): number {
  const rr = ctx.calc.resourceResult.value
  const overflow = rr?.overflowSeconds ?? 0
  // 合轴抵扣出去的秒数：与硬溢出同属「必做前台超出 180s」这一笔，故交给 computeDifficulty 合成一项
  const saved = rr ? frontlineOccupationBreakdown(rr).saved : 0
  return computeDifficulty(liveInteractions(ctx.config, preset), preset.team, overflow, weights, saved).difficulty
}

// ========== 伤害归因：这一档 +N 伤害是谁贡献的（同一份快照里采） ==========

/**
 * 伤害按来源分组：**键 = 直伤行的招式名 / 异常行（非直伤）的 `type`**，
 * 值 = 该来源的伤害合计。Σ 值 == 该档总伤害（`teamTotalDamage` 就是 `damagePoolRows` 求和，
 * 所以归因是**精确**的、不是启发式）——判据测试按这条不变量钉住。
 *
 * 口径说明：同名招式跨槽位合并（同一招在两槽各打一次 = 一个来源），异常行按类型分
 * （乱流/紊乱/异放/灼烧/…），不再按角色拆——难度曲线关心的是「这一档买了什么伤害」。
 */
export function captureDmgBySource(calc: Calc): Record<string, number> {
  const rows = calc.damagePoolRows.value ?? []
  const out: Record<string, number> = {}
  for (const r of rows) {
    const key = r.type === '直伤' ? (r.name || r.source || '直伤') : r.type
    out[key] = (out[key] ?? 0) + (r.totalDamage || 0)
  }
  return out
}

export interface DmgSourceChange {
  label: string
  delta: number
}

/** 相邻两档的伤害来源差分（按 Δ 降序：正贡献在前，被挤掉的负贡献在后） */
export function diffDmgBySource(
  prev: Record<string, number> | undefined,
  next: Record<string, number> | undefined,
): DmgSourceChange[] {
  if (!prev || !next) return []
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  const out: DmgSourceChange[] = []
  for (const label of keys) {
    const delta = (next[label] ?? 0) - (prev[label] ?? 0)
    if (Math.abs(delta) > 1e-6) out.push({ label, delta })
  }
  return out.sort((a, b) => b.delta - a.delta)
}

/**
 * 次数 ↔ 伤害来源的**同类对照表**（`大招` 那一档看终结技系伤害变化了多少）。
 *
 * ⚠️ 这是**同档同类来源 Δ，不是因果声明**：一处次数跃迁与同类伤害行在同一档一起变，
 * 但伤害同时受权重/易伤/覆盖率影响。所以展示端一律写成「终结技系 Δ +x」而不是「因为大招+1 所以 +x」。
 * 匹配口径沿用仓库既有约定（`ResourceResultCard#ACTION_ROW_DEFS` 也是按这些招式名前缀分类）。
 */
const COUNT_DMG_CATEGORY: { count: string; label: string; match: (src: string) => boolean }[] = [
  { count: '大招', label: '终结技系', match: s => s.includes('终结技') },
  { count: '强特', label: '强化特殊技系', match: s => s.includes('强化特殊技') },
  { count: '连携', label: '连携技系', match: s => s.includes('连携技') },
  { count: '紊乱', label: '紊乱', match: s => s === '紊乱' || s === '极性紊乱' },
  { count: '乱流', label: '乱流', match: s => s === '乱流' },
]

export interface CountDmgLink {
  /** 同类来源的展示名（如 `终结技系`） */
  label: string
  delta: number
}

/** 给一处次数跃迁找**同档同类来源**的伤害 Δ；没有对应类别（失衡/异常触发/角色专属）返回 null */
export function linkCountToDmg(countLabel: string, dmgChanges: DmgSourceChange[]): CountDmgLink | null {
  const def = COUNT_DMG_CATEGORY.find(d => d.count === countLabel)
  if (!def) return null
  const delta = dmgChanges.filter(c => def.match(c.label)).reduce((s, c) => s + c.delta, 0)
  return Math.abs(delta) > 1e-6 ? { label: def.label, delta } : null
}

export interface DmgAttribution {
  /** 正贡献 top N（按 Δ 降序） */
  top: DmgSourceChange[]
  /** 被挤掉最狠的 top M（**最负的在前**；`dmgChanges` 自身是 Δ 降序，负贡献那一头是反的） */
  squeezed: DmgSourceChange[]
  /** 没被 top / squeezed 列出的其余来源 Δ 合计（含符号；用来把账对齐到 totalDelta） */
  restDelta: number
  /** 本档总 Δ（≡ Σ 全部 dmgChanges） */
  totalDelta: number
}

/**
 * 把差分压成可展示的归因摘要（页面与探针共用，避免各自写一套取数逻辑）。
 * `restDelta` 保证「top + squeezed + rest ≡ totalDelta」，展示端不会漏账。
 */
export function attributeDmgChanges(changes: DmgSourceChange[], topN = 3, squeezeN = 2): DmgAttribution {
  const totalDelta = changes.reduce((s, c) => s + c.delta, 0)
  const top = changes.filter(c => c.delta > 0).slice(0, topN)
  const squeezed = changes.filter(c => c.delta < 0).slice(-squeezeN).reverse()
  const shown = new Set([...top, ...squeezed].map(c => c.label))
  const restDelta = changes.reduce((s, c) => (shown.has(c.label) ? s : s + c.delta), 0)
  return { top, squeezed, restDelta, totalDelta }
}

/** 一档快照（构成 = 关键次数 + 伤害来源），交给 `climbDifficultyLadder#opts.capture` */
export function captureLadderSnapshot(calc: Calc): LadderSnapshot {
  return { counts: captureKeyCounts(calc), dmgBySource: captureDmgBySource(calc) }
}

// ========== 关键次数：采集 + 差分（用户 2026-09-10 口径：难度上升到关键变化要标注） ==========

/**
 * 队伍级「关键次数」7 项（单一来源 = 引擎结果字段，不在这里复制口径）。
 * 玩家看得懂的跃迁就是这些：多放一次大招 / 多打一次强特 / 多一次失衡连携 /
 * 异常角色多一次紊乱、多一次乱流。
 */
const TEAM_KEY_COUNTS: { label: string; pick: (i: KeyCountInput) => number }[] = [
  { label: '大招', pick: i => sumBy(i.characters, c => c.ultimateCount) },
  { label: '强特', pick: i => sumBy(i.characters, c => c.exSpecialCount) },
  { label: '连携', pick: i => sumBy(i.characters, c => c.chainCountTotal) },
  { label: '失衡', pick: i => i.stun?.stunCount ?? 0 },
  { label: '异常触发', pick: i => i.anomaly?.totalTriggerCount ?? 0 },
  { label: '紊乱', pick: i => i.anomaly?.disorderCount ?? 0 },
  { label: '乱流', pick: i => sumBy(i.anomaly?.perSlotTurbulenceTriggers ?? [], n => n) },
]

interface KeyCountInput {
  characters: CharacterResourceResult[]
  stun: StunPoolResult | null
  anomaly: AnomalyPoolResult | null
}

function sumBy<T>(arr: T[], pick: (t: T) => number): number {
  let s = 0
  for (const t of arr) s += pick(t) || 0
  return s
}

/** 角色专属「N 次」行：`毁伤触发 3 次` 这类由模块自报的展示行（唯一来源 = 模块 resourceSections） */
const AGENT_COUNT_ROW = /^(-?\d+(?:\.\d+)?)\s*次$/

/**
 * 采一档「关键次数」快照。键 = **可读标签**（`大招` / `克拉蕾·毁伤触发`），值 = 次数。
 *
 * 角色专属项**不在这里硬编码角色**：模块自己的 `resourceSections` 展示行里，
 * 凡是 `value` 形如 `<数> 次` 的行就是模块自报的次数口径（毁伤触发/剑意/嗔火…），
 * 直接拿来当关键次数——新增角色只要模块有这行就自动被标注。
 */
export function captureKeyCounts(calc: Calc): Record<string, number> {
  const input: KeyCountInput = {
    characters: calc.resourceResult.value?.characters ?? [],
    stun: calc.stunPoolResult.value ?? null,
    anomaly: calc.anomalyPoolResult.value ?? null,
  }
  const out: Record<string, number> = {}
  // 「合轴节省」放最前：用户口径「队友合轴率本来就是把队友招式的时间节约出来给主c…只需管合轴了多少时间出来」。
  // 单位是**秒**（不是次数）——标签自带限定词，读起来不歧义。
  out['合轴节省'] = calc.resourceResult.value ? frontlineOccupationBreakdown(calc.resourceResult.value).saved : 0
  for (const def of TEAM_KEY_COUNTS) out[def.label] = def.pick(input)
  const names = calc.agentNames.value
  for (const c of input.characters) {
    const sections = getAgentMechanic(c.agentId)?.resourceSections?.({ result: c, anomalyPoolResult: input.anomaly }) ?? []
    // 展示名优先取 catalog 中文名（引擎结果里的 agentName 是 id，见 core/resource.ts「名称由上层填充」）
    const who = names[c.agentId] || c.agentName || c.agentId
    for (const s of sections) {
      for (const row of s.rows) {
        const m = AGENT_COUNT_ROW.exec((row.value ?? '').trim())
        if (m) out[`${who}·${row.label}`] = Number(m[1])
      }
    }
  }
  return out
}

export interface KeyCountChange {
  /** 可读标签（= 快照键） */
  label: string
  from: number
  to: number
  delta: number
  /**
   * **「多了一次」** = `delta ≥ 1`：玩家确实多拿到一次离散动作/事件（大招/强特/失衡/紊乱…）。
   * 引擎的次数常带小数（覆盖率折算/外层不动点），+0.09 这种微调**不算**关键变化 ⇒
   * 图上的标注与「关键变化」面板只显示 `major`，原始 from→to 仍在 tooltip / 数据里。
   */
  major: boolean
}

/**
 * 相邻两档做差，**只标注「变多」的项**（用户口径：「难度上升到关键变化后可以标注，比如大招多了一次」）。
 * 变少 / 缺席不标注（避免把抖动当成果）；阈值 1e-6 防浮点噪声。
 */
export function diffKeyCounts(
  prev: Record<string, number> | undefined,
  next: Record<string, number> | undefined,
): KeyCountChange[] {
  if (!prev || !next) return []
  const out: KeyCountChange[] = []
  for (const [label, to] of Object.entries(next)) {
    const from = prev[label]
    if (from === undefined) continue
    const delta = to - from
    if (delta > 1e-6) out.push({ label, from, to, delta, major: delta >= 1 - 1e-6 })
  }
  return out
}

/** 只留「多了一次」量级的跃迁（图标注 / 关键变化面板用） */
export function majorChanges(changes: KeyCountChange[]): KeyCountChange[] {
  return changes.filter(c => c.major)
}

/**
 * 图上标标注防重叠：按 x 从左到右贪心**分道**（返回每条标注的道号，0 = 最靠近点，越大越往上抬）。
 *
 * 为什么需要：金档/更多目标会让一条曲线上出现 6+ 处跃迁，文字标注会叠在一起
 * （实机点通实测 1 对重叠）。宽度由调用方按「字数 × 经验字宽」估（渲染前拿不到真实宽），
 * 估宽偏小最多退化成轻微重叠，不会崩。
 */
export function assignLabelLanes(items: { x: number; width: number }[], maxLanes = 3): number[] {
  const lanes = new Array<number>(items.length).fill(0)
  const laneRight: number[] = [] // 每道当前占用的最右端
  const order = items.map((it, i) => ({ i, x: it.x, half: Math.max(1, it.width) / 2 })).sort((a, b) => a.x - b.x)
  for (const it of order) {
    let lane = laneRight.findIndex(right => right < it.x - it.half - 2)
    if (lane === -1) {
      if (laneRight.length < maxLanes) {
        lane = laneRight.length
        laneRight.push(0)
      } else {
        // 道满了：退回「当前最空」的那道（宁可轻微重叠，也不把标注甩出画面）
        lane = laneRight.indexOf(Math.min(...laneRight))
      }
    }
    lanes[it.i] = lane
    laneRight[lane] = it.x + it.half
  }
  return lanes
}

/**
 * 贪心挑**互不重叠**的标注（按 `priority` 从高到低录取；返回 keep 掩码）。
 *
 * 为什么需要：分道只能解决「同一行放不下」，道数与行高有限（G5 之后一条曲线能有 7+ 处跃迁），
 * 实测仍会叠。这里用**估宽当上界的轴对齐矩形**做碰撞剔除——宁可少标两个，也不让文字糊成一团
 * （完整清单始终在「关键变化」面板与 tooltip 里）。
 */
export function pickNonOverlapping(
  boxes: { x: number; width: number; y: number; height: number }[],
  priority: number[],
): boolean[] {
  const keep = new Array<boolean>(boxes.length).fill(false)
  const order = boxes.map((_, i) => i).sort((a, b) => (priority[b] ?? 0) - (priority[a] ?? 0))
  const kept: typeof boxes = []
  for (const i of order) {
    const b = boxes[i]!
    const hit = kept.some(k =>
      b.x - b.width / 2 < k.x + k.width / 2 && k.x - k.width / 2 < b.x + b.width / 2
      && b.y - b.height / 2 < k.y + k.height / 2 && k.y - k.height / 2 < b.y + b.height / 2)
    if (hit) continue
    keep[i] = true
    kept.push(b)
  }
  return keep
}

/** 标注文字估宽（font-size 9 + 加粗：中日韩 ≈10.5px/字，其余 ≈6.5px；宁可高估，低估会漏判重叠） */
export function estimateLabelWidth(text: string): number {
  let w = 0
  for (const ch of text) w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 10.5 : 6.5
  return w + 8
}

// ========== 图表数据（纯函数） ==========

export interface CurveDatum {
  /** 累积难度代价（该队自己的 x） */
  cost: number
  dmg: number
  /** 伤害 / Boss 血量 × 100% */
  ratio: number
  /** 这一档新录取的目标 id（null = 全关起点） */
  opened: string | null
  /** 相对上一档**变多**的关键次数（空 = 这一档没有次数跃迁） */
  changes: KeyCountChange[]
  /**
   * 相对上一档的**伤害归因**（按 Δ 降序，正贡献在前、被挤掉的在后）；
   * Σ `delta` ≡ 本档伤害 − 上一档伤害（伤害池按来源分组求和 == 总伤害，故精确）。
   */
  dmgChanges: DmgSourceChange[]
}

export interface CurveSeries {
  presetId: string
  name: string
  points: CurveDatum[]
  base: number
  final: number
  /** 提升倍数（终点 / 起点，1 = 无提升） */
  gainX: number
  gainPct: number
  totalCost: number
  /** % / 难度点（代价 0 时按总增益，除零保护见 summarizeLadder） */
  slope: number
  opened: string[]
  dropped: { id: string; gain: number }[]
  /** 一个目标都没录取（曲线是单点）：没有可优化的空间 */
  flat: boolean
  /**
   * **关键次数跃迁档**（只含 `major` = 「多了一次」的档）：图上标注与「关键变化」面板的唯一数据源。
   * 空数组 = 这条曲线爬升过程中没有出现「多放一次大招 / 多一次紊乱」这类台阶。
   */
  jumps: CurveDatum[]
}

export interface CurveChartData {
  series: CurveSeries[]
  costMax: number
  ratioMax: number
  costTicks: number[]
}

/** 曲线数据 → 图表（x = 累积代价，y = 伤害/血量%）；空输入返回可画的空图 */
export function buildCurveChart(rows: DifficultyCurveRow[], hp: number): CurveChartData {
  const safeHp = hp > 0 ? hp : 1
  const series: CurveSeries[] = rows.map(r => {
    const s = summarizeLadder(r.ladder)
    const points: CurveDatum[] = r.ladder.points.map((p, i) => ({
      cost: p.x,
      dmg: p.dmg,
      ratio: (p.dmg / safeHp) * 100,
      opened: p.opened,
      changes: diffKeyCounts(r.ladder.points[i - 1]?.counts, p.counts),
      dmgChanges: diffDmgBySource(r.ladder.points[i - 1]?.dmgBySource, p.dmgBySource),
    }))
    return {
      presetId: r.presetId,
      name: r.name,
      points,
      jumps: points
        .filter(p => p.changes.some(c => c.major))
        .map(p => ({ ...p, changes: majorChanges(p.changes) })),
      base: s.base,
      final: s.final,
      gainX: r.ladder.base > 0 ? r.ladder.final / r.ladder.base : 1,
      gainPct: s.gainPct,
      totalCost: s.totalCost,
      slope: s.slope,
      opened: r.ladder.opened,
      dropped: r.ladder.dropped,
      flat: r.ladder.opened.length === 0,
    }
  })
  const costMax = Math.max(1, ...series.map(s => s.totalCost))
  const ratioMax = Math.max(100, Math.ceil(Math.max(...series.map(s => Math.max(...s.points.map(p => p.ratio), 0)), 150) / 50) * 50)
  const costStep = Math.max(1, Math.ceil(costMax / 5))
  const costTicks: number[] = []
  for (let v = 0; v <= costMax; v += costStep) costTicks.push(v)
  if (costTicks[costTicks.length - 1] !== costMax) costTicks.push(costMax)
  return { series, costMax, ratioMax, costTicks }
}
