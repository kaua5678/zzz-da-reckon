/**
 * 预设队伍对比：批量计算服务
 *
 * 对每个 (预设队伍 × 金数) 组合应用配置到 configStore → 读 useResourceCalc 的
 * teamTotalDamage（computed 惰性求值，读即重算）→ 收集散点 → 恢复现场。
 *
 * 金数口径（用户定义）：**总限定金** = 限定 S 角色本体1 + 限定音擎本体1 + 影画/精炼每级1。
 * 常驻 S 角色（莱卡恩/丽娜/猫又/11号/珂蕾妲/格莉丝）与 A 级角色不计限定金；常驻音擎不计。
 * 选择的目标限定金落在队伍 [基础金, 基础金+goldSteps 数] 之外时**钳制到最近档位**。
 * 常驻配置走 preset.standardSteps（不占限定金，预设默认全量应用，改文件后重跑）。
 * 自动下位音擎（缺省开）：基础音擎非限定的槽位在「下位装填池」内按伤害试算择优
 * （默认池 = 常驻 S + 预设常用 A 级，页面可增删；A 默认精炼 5、常驻默认 3，页面可调）；
 * 预设 wEngines 仅限定音擎（占金的真实持有物）保留，常驻/A/空槽位以择优结果为准。
 * 加金步支持「音擎本体」获取（GoldStep.kind='wengine' + wEngineId = 1 限定金）；
 * preset.wEngines = 基础音擎（常驻/A 不计金），限定专武从基础往上买（最优加金逐档含「买哪把专武」候选）。
 * 难度口径：横轴难度 = Σ(count × weight)，权重查 INTERACTION_WEIGHTS，条目可覆盖。
 * 难度变体（队伍分类）：预设带 variants 时由加载器展开成多个条目（普通轴 / 5嗔火10大 等），
 * 变体可覆盖 interactions、绑定额轴预设（stunAxisPresetId，对比时优先用该轴）、
 * 设 minGold 门槛（低于该总限定金不生成点，表达「配置要求」）。
 * 纵轴：伤害 / Boss 血量 × 100%（100 = 击杀，200 = 两倍血量）。
 */
import { applyBossRoom } from '@/composables/bossRoom'
import { clearInteractions } from '@/composables/interactionControls'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'
import { INTERACTION_MODE_SETTING, INTERACTION_OPTIMUM_MODE } from '@/data/interactionOptimization'
import { applyTimeWeightAllocation, INTERACTION_OPTIMUM_STRATEGY_ID } from '@/composables/timeWeightAllocation'
import { isLimitedSAgentId, isLimitedSWengineId, runLimitedGold } from '@/composables/limitedGold'
import { stunWindowRatioOf } from '@/composables/difficultyRatio'
import { captureState, stateDeltaOf } from '@/composables/configDelta'
import { liveInteractions } from '@/composables/liveInteractions'
import { interactionFieldForType } from '@/composables/agentMechanicView'
import { type StunAxisState, type ConfigModel } from '@/stores/config'
import type { AnalysisContext } from '@/composables/analysisScenario'
import { useCatalogStore } from '@/stores/catalog'
import type { BossPreset, BossPresetPhase, PhaseBuffCard } from '@/types/bossPreset'
import { phaseBuffRows, LAYER_BUFF_PREFIX } from '@/utils/phaseBuff'
import { stunAxisPresets } from '@/data/stunAxisPresets'
import { fmt, localized } from '@/utils/format'
import {
  type GoldStep,
  type InteractionItem,
  type TeamComparePoint,
  type TeamPreset,
} from '@/types/teamPreset'
import type { ResourceCalc } from '@/composables/useResourceCalc'
import type { TeamGoldState } from '@/composables/teamTimeline'
import { takeBestGoldStep } from '@/composables/goldGreedy'
import { catalogGoldSteps, goldStepsForPreset, presetBaseEngines } from '@/composables/goldStepsFromCatalog'
import { signatureWEngineOf } from '@/composables/signatureWEngine'
import { downgradePoolFor } from '@/data/downgradeWEngines'
import { applySlotOverrides, NO_SLOT_OVERRIDES, type SlotOverrides } from '@/composables/presetSlotOverrides'
import { DOWNGRADE_MODS, downgradeCandidateOf, wearBestWEngine, type DowngradeCandidate } from '@/composables/downgradeWEngine'
import ENGINE_POOLS_SRC from '@/data/enginePools.json'
const ENGINE_POOLS = ENGINE_POOLS_SRC as Record<string, string[]>
import { frontlineOccupationBreakdown, netFrontlineOccupation } from '@/core/resource/timeOccupation'

type Calc = ResourceCalc

/** 常驻角色/音擎名单在 @/data/standardMultiplierTable，本文件不转出口。焰心桂冠 14116 是限定，不在常驻 6 把里。 */

/**
 * 自动下位的**兜底**候选池 —— 2026-10-26 起从 `src/data/downgradeWEngines.ts` 派生（单一事实源），
 * 不再手抄一份「用户准信五件」。语义：只在**下位表两层都没命中**时才用（正常路径见 `computeAutoEnginePicks`）。
 * 精炼档沿用 A 默认 5、常驻 S 默认 3（`DOWNGRADE_MODS`，页面可调）。
 */
export const DEFAULT_AUTO_ENGINE_POOL = ['13005', '14110', '13115', '14002', '14121']

/**
 * 音擎是否算限定金。CC-271：store 里可能是旧 localStorage 的别名 id（legacyIds，如 zzz_wiki_218 = 14121 啜泣摇篮），
 * 先经 catalog 解析成主 id（`mainWEngineId`），再交给 limitedGold 的单一定义 `isLimitedSWengineId`（141 前缀 ∧ 非常驻）。
 * 修前按 catalog 稀有度判定、却拿**原始**别名 id 查常驻名单 ⇒ 常驻 S 的别名被当成限定（多记金）；
 * catalog 未加载时把任何非常驻 id（含 A 级）都当限定。前缀判定与 catalog 稀有度的一致性由 limitedAgentSingleSource.test 锁。
 * 角色侧没有这层包装：角色 id 无别名，直接用 limitedGold.isLimitedSAgentId（CC-270；只转发的 isLimitedAgent 已在 r734 删除）。
 */
export function isLimitedWEngine(wEngineId: string): boolean {
  return isLimitedSWengineId(mainWEngineId(wEngineId))
}

/** store 音擎 id → catalog 主 id（旧别名经 `getWEngine` 的 legacyIds 解析；未收录原样返回；空串不碰 store） */
function mainWEngineId(id: string): string {
  return id ? (useCatalogStore().getWEngine(id)?.id ?? id) : ''
}

/** 同金分配候选 + 所属预设（`TeamCompareOptions.goldAlternatives` 的元素，对比页「同金分配」表的行） */
export type PresetGoldAlternative = GoldAllocationAlternative & { presetId: string; presetName: string }

export interface TeamCompareOptions {
  /** 参与对比的预设队伍 */
  presets: TeamPreset[]
  /** 每个队伍跑的金数档位（如 [0, 2, 4, 6]） */
  goldLevels: number[]
  /**
   * 收集「同队同金不同分配」候选（用户 2026-09-14）：传入数组即逐队逐档追加；缺省不收集 = 零额外开销。
   * r728 前是布尔开关 + 返回数组上的不可枚举属性 `.goldAlternatives`，读的一侧要断言成 `T[] & { … }`。
   */
  goldAlternatives?: PresetGoldAlternative[]
  /** 目标 Boss */
  boss: BossPreset
  /** 目标期数 */
  phase: BossPresetPhase
  /** 当期 buff 牌（空数组 = 不应用 buff） */
  buffs?: PhaseBuffCard[]
  /** 手动指定 buff 标题（缺省 = 每队自动取三张牌中伤害最高） */
  manualBuffTitle?: string
  /**
   * 最优加金（≤ GOLD_OPTIMIZE_CAP 金）：不用预设 goldSteps 的排列顺序，
   * 逐金贪婪挑伤害提升最大的可用步骤（计算量约每队多几轮全量伤害）。
   * 12 金以上仍按预设顺序。缺省 false = 按 goldSteps 顺序取前 N 步。
   */
  optimalGold?: boolean
  /**
   * 自动下位音擎（缺省 true）：基础音擎非限定的槽位，运行时从 A 级 ∪ 常驻 S 池
   * 按全队伤害试算择优穿戴（不计金）；关闭则回退预设 wEngines。
   */
  autoEngine?: boolean
  /** 自动下位的默认精炼档：A 级 / 常驻 S（缺省 5 / 3），钳制 1..5 */
  autoEngineMods?: { aRank?: number; standard?: number }
  /**
   * 自动下位候选池（装填框，音擎 id 列表）：择优只在池内试算，避免全目录遍历过慢。
   * 缺省 = DEFAULT_AUTO_ENGINE_POOL（用户准信五件）；池内限定音擎可选，选中按本体（精炼1）
   * 如实计入总限定金（有金就是金）。
   */
  autoEnginePool?: string[]
  /**
   * 难度权重覆盖（主观量，用户在对比页「难度权重」弹层自填，localStorage 持久化）：
   * interaction = 交互类型 → 权重（未覆盖类型用 INTERACTION_WEIGHTS 默认）；
   * timePressure = 「时间压力」（难度点/秒，默认 1），见 `computeDifficulty`。
   */
  difficultyWeights?: DifficultyWeights
  // @fact ui:比较入口/散点档位 口径: 散点图上**一个点 = 一个金档**（`goldLevels` 的一档），点它就地打开该金档的**完整资源池**（与难度曲线同一条链：`useCurvePointPool` → `ResourcePoolView`）；展示层靠该点的现场差分（本开关）重放，**重放伤害 === 该点 `damage`**（逐位相等） | 据 用户@2026-11-03（「每个点都代表一个金，只有这个能看资源池了」） | 验 src/composables/__tests__/pointSceneCapture.test.ts::★ 每个点都带现场差分，且重放伤害 ≡ 该点 damage；UI 现场不被污染 | 锚 src/types/teamPreset.ts#TeamComparePoint | 信 确认
  // ⟳复核: 散点的档位语义（`goldLevels` / 贪婪链取哪些档）再变时，复核「重放伤害 ≡ 该点 damage」仍逐位成立 | 到期 2026-12-31
  /**
   * **每点采一次现场差分**（缺省不采 = 零开销；用户口径 2026-11-03「每个点都代表一个金，只有这个
   * 能看资源池了」⇒ 散点每一档也要能就地打开完整资源池）。
   *
   * 成本：每点一次 `captureState`（全表深拷贝 ~11KB）+ `stateDeltaOf`（JSON 比对 ~0.2ms），
   * 相对一次全队求值（50–120ms）可忽略；不采时**一个字节都不花**。
   */
  collectScenes?: boolean
  /** 每一金档可选手填、全0或统一最优；缺省最高档。 */
  interactionLevel?: 'manual' | 'zero' | 'optimal' | 'max'
  /**
   * 逐槽锁定（用户 2026-10-25「修改自由度大一点」）：配置码形式的最终配装，锁了的槽不参与加金。
   * 缺口省 = `NO_SLOT_OVERRIDES`（逐位不变）。口径见 `presetSlotOverrides.ts`。
   */
  slotOverrides?: SlotOverrides
}

import { computeDifficulty, type DifficultyWeights } from '@/composables/operationalDifficulty'

/**
 * 队伍基础限定金 = 预设声明的 0命1精 配装（`preset.wEngines`）的总限定金（teamGoldOf）：限定 S 角色本体 + 限定音擎本体（每项 1 金）。
 * 常驻 S 角色（莱卡恩等）本体/专武、A/B 级角色、常驻音擎都不计。
 * 例：伊德海莉+莱卡恩+卢西娅（全带专武）= 2 + 2 = 4 金（莱卡恩与拘缚者不计）。
 */
/**
 * 预设基础金（0 步加金时的总限定金）。
 *
 * `slotCodes` 固定槽的金必须算进来（2026-10-25）：「诺姆 30 + 丽娜 65 + 克拉蕾 61」这支队的基础金
 * 是 3 角色本体 + 丽娜专武 + 丽娜 5 精炼 + 克拉蕾专武 …… 而不是三件 0 命 1 精——不算就会把
 * 「预支的金」当成 0，散点/曲线的金数标签全错。
 */
export function baseGoldOf(preset: TeamPreset): number {
  const locked = preset.slotCodes
  if (!locked || locked.every(c => c === null)) {
    return teamGoldOf(preset.team, presetBaseEngines(preset, useCatalogStore()), [0, 0, 0], [1, 1, 1])
  }
  // 固定槽的音擎按「右位 ≥1 ⇒ 该角色专武」解析（wEngines 留空 = 自动推荐，不是"没武器"）；
  // 右位 0（无专武）⇒ 空，不计音擎金。
  const catalog = useCatalogStore()
  const wEngines = [0, 1, 2].map(s => {
    const c = locked[s]
    if (!c) return presetBaseEngines(preset, catalog)[s]
    const agentId = preset.team[s]
    return c.wengine >= 1 && agentId ? (signatureWEngineOf(catalog, agentId)?.id ?? '') : ''
  })
  return teamGoldOf(
    preset.team,
    wEngines,
    locked.map(c => c?.cinema ?? 0),
    locked.map(c => c?.wengine ?? 1),
  )
}

/**
 * 队伍配置 → 总限定金（「预设金数」弹窗实时显示；基础金 baseGoldOf / teamTimelineStore.baseGoldOfTeam 也走这里）。
 * 公式只在 limitedGold#memberLimitedGold 一处，与归档统计同一口径（限定 S 角色本体 1 + 影画每级 1；
 * 限定音擎本体 1 + 精炼每级 1，精炼1 = 本体；常驻角色/音擎、A/B 级不计）。本函数只管两件事：
 * 空槽不计（含残留音擎）；音擎 id 先解析成 catalog 主 id（mainWEngineId，CC-271）。
 * cinemas 0-6、wengineMods 1-5。例：全队 0命1精带专武 = 6 金；212121 = 12 金。
 */
export function teamGoldOf(
  agentIds: (string | null | undefined)[],
  wEngineIds: (string | null | undefined)[],
  cinemas: number[],
  wengineMods: number[],
): number {
  return runLimitedGold(agentIds.flatMap((agentId, slot) => agentId
    ? [{ agentId, mindscape: cinemas[slot], phase: wengineMods[slot], weaponId: mainWEngineId(wEngineIds[slot] ?? '') }]
    : []))
}

/** 「预设金数」弹窗「保存到预设文件」用的队伍槽位信息 */
export interface GoldConfigTeamSlot {
  agentId: string
  wEngineId: string
}

/**
 * 当前队伍命座/精炼/音擎 → 加金步骤（「预设金数」弹窗「保存到预设文件」写回 goldSteps/standardSteps 用）。
 * 口径：限定 S 角色/音擎的影画与精炼步进 goldSteps（占限定金）；
 * 常驻 S / A 级角色与常驻音擎的步进 standardSteps（不占金，默认全量应用）。
 * 限定音擎且与预设基础音擎（baseWEngineIds）不一致时先写「本体」步（1 金），再写精炼 2..M 步；
 * 每槽位按 影画 1..N 再 音擎展开；applyGoldSteps 按槽位取 max，顺序不影响结果。
 * 精炼1 = 本体不计步；wEngineId 为空时该槽位不写音擎步；空槽位跳过。
 */
export function buildGoldStepsFromConfig(
  team: GoldConfigTeamSlot[],
  cinemas: number[],
  wengineMods: number[],
  baseWEngineIds: (string | null | undefined)[] = [],
): { goldSteps: GoldStep[]; standardSteps: GoldStep[] } {
  const goldSteps: GoldStep[] = []
  const standardSteps: GoldStep[] = []
  const catalog = useCatalogStore()
  for (let slot = 0; slot < 3; slot++) {
    const { agentId, wEngineId } = team[slot] ?? {}
    if (!agentId) continue
    const agent = catalog.getAgent(agentId)
    const name = localized(agent?.name, `槽位${slot + 1}`)
    // 影画步进（限定 → goldSteps，常驻/A级 → standardSteps）
    const cinema = Math.max(0, Math.min(6, cinemas[slot] ?? 0))
    const cTarget = isLimitedSAgentId(agentId) ? goldSteps : standardSteps
    for (let c = 1; c <= cinema; c++) cTarget.push({ label: `${name} ${c}命`, slot, kind: 'cinema', value: c })
    // 精炼步进（精炼1 = 本体不计步；wEngineId 为空不写）
    if (wEngineId) {
      const mod = Math.max(1, Math.min(5, wengineMods[slot] ?? 1))
      const wTarget = isLimitedWEngine(wEngineId) ? goldSteps : standardSteps
      const isSignature = catalog.getWEngine(wEngineId)?.ownerAgentId === agentId
      const labelBase = `${name}${isSignature ? ' 专武' : ' 音擎'}`
      // 音擎本体获取：当前带限定音擎且不是预设基础音擎 → 先记本体步（1 金），之后才是精炼步
      if (isLimitedWEngine(wEngineId) && baseWEngineIds[slot] !== wEngineId) {
        wTarget.push({ label: `${labelBase}（本体）`, slot, kind: 'wengine', value: 1, wEngineId })
      }
      for (let m = 2; m <= mod; m++) wTarget.push({ label: `${labelBase}精炼${m}`, slot, kind: 'wengine', value: m })
    }
  }
  return { goldSteps, standardSteps }
}

/**
 * 解析一个目标限定金档位：把选择的目标总限定金钳制到队伍可达范围
 * [baseGold, baseGold + goldSteps.length]，返回实际总金与应用的步数。
 * 选择大于预设最高 → 取最高（全部步数）；小于预设最低 → 取最低（0 步）。
 */
export function resolveGoldLevel(goldSteps: GoldStep[], targetTotalGold: number, baseGold: number): { totalGold: number; stepsApplied: number } {
  const maxGold = baseGold + goldSteps.length
  const totalGold = Math.max(baseGold, Math.min(maxGold, targetTotalGold))
  return { totalGold, stepsApplied: totalGold - baseGold }
}

/**
 * 应用前 N 个加金步骤（同角色取步骤最大值；音擎获取步先装备本体，精炼步再叠加）。
 * 金数口径（用户定义）：**总限定金** = 角色本体1 + 限定音擎本体1 + 影画/精炼每级1；
 * targetTotalGold 为**目标总限定金**，越界按 resolveGoldLevel 钳制到最近档位。
 * standardSteps 为常驻配置：不占限定金，默认全量应用（决定常驻角色最终命座/精炼/音擎）；
 * 但常驻精炼不残留到被获取步换装的槽位（换上限定专武即回精炼1）。
 * baseWEngines = 各槽位基础音擎（缺省 ''，通常传 preset.wEngines）；音擎获取步从它出发换装。
 */
export function applyGoldSteps(
  goldSteps: GoldStep[],
  targetTotalGold: number,
  baseGold: number,
  standardSteps: GoldStep[] = [],
  baseWEngines: (string | null | undefined)[] = [],
) {
  const { totalGold, stepsApplied } = resolveGoldLevel(goldSteps, targetTotalGold, baseGold)
  const steps = goldSteps.slice(0, stepsApplied)
  const cinemas: [number, number, number] = [0, 0, 0]
  const wengineMods: [number, number, number] = [1, 1, 1] // 精炼1 = 本体，不算步
  const wEngines: [string, string, string] = [
    baseWEngines[0] ?? '',
    baseWEngines[1] ?? '',
    baseWEngines[2] ?? '',
  ]
  // 音擎获取步先应用（装备本体），随后影画/精炼步按 max 合并
  for (const s of [...steps, ...standardSteps]) {
    if (s.kind === 'wengine' && s.wEngineId) wEngines[s.slot] = s.wEngineId
  }
  for (const s of steps) {
    if (s.kind === 'cinema') cinemas[s.slot] = Math.max(cinemas[s.slot], s.value)
    else if (!s.wEngineId) wengineMods[s.slot] = Math.max(wengineMods[s.slot], s.value)
  }
  // 常驻精炼只对未被获取步换装的槽位生效：旧音擎的精炼不残留到新专武（新专武从精炼1起）
  const acquiredSlots = new Set(steps.filter(s => s.kind === 'wengine' && s.wEngineId).map(s => s.slot))
  for (const s of standardSteps) {
    if (s.kind === 'cinema') cinemas[s.slot] = Math.max(cinemas[s.slot], s.value)
    else if (!s.wEngineId && !acquiredSlots.has(s.slot)) wengineMods[s.slot] = Math.max(wengineMods[s.slot], s.value)
  }
  const clamped = stepsApplied !== targetTotalGold - baseGold
  const label = stepsApplied === 0
    ? `${totalGold}金（基础：限定角色0命+精炼1${clamped ? '，已钳制' : ''}）`
    : `${totalGold}金${clamped ? '（钳制）' : ''}：${steps.map(s => s.label).join(' + ')}`
  const standardLabel = standardSteps.length === 0 ? '' : `常驻：${standardSteps.map(s => s.label).join(' + ')}`
  return { cinemas, wengineMods, wEngines, label, standardLabel, totalGold, stepsApplied }
}

// ========== 自动下位音擎（A ∪ 常驻池择优） ==========

/** 一个槽位的自动下位择优结果（音擎 / 精炼 / 展示名 / 是否限定见 `DowngradeCandidate`） */
export interface AutoEnginePick extends DowngradeCandidate {
  slot: number
}

function clampMod(v: number | undefined | null, fallback: number): number {
  const n = Math.floor(Number(v ?? fallback))
  return Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : fallback
}

/**
 * 把自动下位择优结果替换进一个配装态：仅当该槽位最终音擎**非限定**时覆盖
 * （含空音擎与 standardSteps 写入的常驻/A 音擎——预设不作为下位口径的事实源）；
 * 已花金买到的限定专武不动。返回实际生效（仍穿在身上）的**限定**下位件数——
 * 口径「有金就是金」：这些件各按本体计入总限定金；`acquiredSlots`（被预算步购买过音擎的
 * 槽位）不计——那件金已含在预算步里，重复计就是双算。
 */
function substituteAutoEngines(
  wEngines: string[],
  wengineMods: number[],
  picks: AutoEnginePick[],
  acquiredSlots: ReadonlySet<number> = new Set(),
): number {
  let limitedApplied = 0
  for (const p of picks) {
    if (!isLimitedWEngine(wEngines[p.slot] ?? '')) {
      wEngines[p.slot] = p.id
      wengineMods[p.slot] = p.mod
      if (p.limited && !acquiredSlots.has(p.slot)) limitedApplied++
    }
  }
  return limitedApplied
}

/** 配装态里仍穿在身上的限定下位件数（未被预算步购买顶替的才计；有穿就算金，不双算） */
function countLimitedAutoApplied(
  wEngines: string[],
  picks: AutoEnginePick[],
  acquiredSlots: ReadonlySet<number> = new Set(),
): number {
  return picks.filter(p => p.limited && wEngines[p.slot] === p.id && !acquiredSlots.has(p.slot)).length
}

/**
 * 自动下位音擎择优：对每个「基础音擎非限定」的槽位（限定基础音擎 = 占金的真实持有物，保留），
 * 在候选装填池内试穿择优（`wearBestWEngine`：读全队伤害取最高，读数非有限不选、并列取先、单件不试算，
 * 与自由对比「无专武」档同一实现），按 `downgradeCandidateOf` 的精炼穿戴（A 级默认 5、常驻默认 3，
 * 经 preset.autoEngine.mods / options.autoEngineMods 调整；限定按本体 1）。逐槽贪心、顺序提交：后一槽的试算在前一槽已定的基础上进行。
 * 候选池缺省 = DEFAULT_AUTO_ENGINE_POOL（用户准信五件），页面装填框可增删；
 * 池内未知 id 过滤；**限定音擎可选**——按本体（精炼1）参与择优，选中由调用方如实计金。
 * **不做全目录遍历。**
 * 音擎被动带专精要求 → 试算天然只让匹配角色吃满；击破系等低收益音擎可能落选（按伤害择优的预期行为）。
 * 调用方须已应用 boss/buff（择优从真实场景出发）；池为空的槽位不出结果。
 * 计算量：池大小 × 有角色槽位数（≤3）次全量伤害，每队一次。
 */
export function computeAutoEnginePicks(
  calc: Calc,
  configStore: ConfigModel,
  preset: TeamPreset,
  options: Pick<TeamCompareOptions, 'autoEngineMods' | 'autoEnginePool'> = {},
): AutoEnginePick[] {
  const catalog = useCatalogStore()
  const requested = options.autoEnginePool ?? []
  const byId = new Map(catalog.displayWEngines.map(w => [w.id, w]))
  const toWengines = (ids: string[]) =>
    [...new Set(ids)].flatMap(id => {
      const w = byId.get(id)
      return w ? [w] : []
    })
  // 预设级声明解析（声明即覆盖页面设置）
  const cfg = preset.autoEngine
  const layerIds = (layer?: { pool?: string[]; poolRef?: string }): string[] => [
    ...(layer?.pool ?? []),
    ...(layer?.poolRef ? ENGINE_POOLS[layer.poolRef] ?? [] : []),
  ]
  /**
   * 每槽取池优先级：bySlot[slot] > byAgent[该槽角色] > 整队 pool/poolRef > **下位表（角色 → 职业）**
   * > 页面装填框 > 默认五件。
   *
   * 下位表（`data/downgradeWEngines`）插在页面设置之前：用户 2026-10-26 口径「想找下位也有默认下位表，
   * 找不到再启动更重的算法」——表是**实战用过的**那几把，比页面缺省五件更贴角色；
   * 用户显式填了装填框 = 明确意图，仍然压过表。
   */
  const resolveSlotPool = (slot: number): { ids: string[]; fromTable: boolean } => {
    for (const layer of [cfg?.bySlot?.[String(slot)], preset.team[slot] ? cfg?.byAgent?.[preset.team[slot]] : undefined]) {
      const ids = layerIds(layer)
      if (ids.length > 0) return { ids, fromTable: false }
    }
    const top = layerIds(cfg)
    if (top.length > 0) return { ids: top, fromTable: false }
    if (requested.length === 0) {
      const table = downgradePoolFor(preset.team[slot], catalog.getAgent(preset.team[slot])?.specialty)
      if (table) return { ids: [...table.ids], fromTable: true }
      return { ids: DEFAULT_AUTO_ENGINE_POOL, fromTable: false }
    }
    return { ids: requested, fromTable: false }
  }
  // 精炼档：preset.mods 覆盖页面输入；缺省 DOWNGRADE_MODS（A 级 5、常驻 S 3）
  const mods = {
    aRank: clampMod(cfg?.mods?.aRank ?? options.autoEngineMods?.aRank, DOWNGRADE_MODS.aRank),
    standard: clampMod(cfg?.mods?.standard ?? options.autoEngineMods?.standard, DOWNGRADE_MODS.standard),
  }
  const picks: AutoEnginePick[] = []
  for (let slot = 0; slot < 3; slot++) {
    if (!preset.team[slot]) continue
    // 基础音擎判定与 baseGoldOf 同源（presetBaseEngines）：setAgent 会给角色自动推荐专属音擎，
    // 回读 store 会把「预设没声明的限定专武」误当成已持有物而跳过替换。
    // 限定基础音擎 = 占金的真实持有物 ⇒ 不参与下位择优（那一档已经是「有专武」）。
    if (isLimitedWEngine(presetBaseEngines(preset, catalog)[slot])) continue
    // 赢家留在 store：下一槽的试算场景包含本槽结果
    const { pick } = wearBestWEngine(calc, configStore, slot, toWengines(resolveSlotPool(slot).ids).map(w => downgradeCandidateOf(w, mods)))
    if (pick) picks.push({ slot, ...pick })
  }
  return picks
}

// ========== 最优加金（≤ GOLD_OPTIMIZE_CAP 金） ==========

/** 最优加金的封顶总限定金（用户口径：12 金 = 全队 2命1精前用自动计算，之后按预设顺序） */
const GOLD_OPTIMIZE_CAP = 12

/** 最优加金的一个档位分配 */
export interface OptimalGoldAllocation {
  /** 总限定金（= baseGold + 已选步骤数 + 仍穿在身上的限定下位件数——有金就是金） */
  totalGold: number
  /** 预算口径金数（= baseGold + 已选步骤数，不含限定下位）；点循环按它查档与钳制 */
  budgetGold: number
  cinemas: [number, number, number]
  wengineMods: [number, number, number]
  /** 该档最终装备的音擎 id（base 档 = 基础音擎，常驻/A 不计金） */
  wEngines: [string, string, string]
  /** 如 "8金（最优）：主C 2命 + 卢西娅 1命"；base 档为 "N金（基础）" */
  label: string
  /** 该分配下（boss/buff 已应用）的总伤害 */
  damage: number
}

/**
 * 同一金档下的**一个候选分配**（「同队同金不同分配」对比的原料，用户 2026-09-14 需求）。
 *
 * 为什么要它：贪婪搜索在每金档已经**试算了所有候选**（每个槽位的下一级影画/精炼/音擎本体），
 * 但只把赢家写进 `OptimalGoldAllocation`、其余扔掉。用户要看「8 金时这笔金投给主C 2命
 * 还是投给卢西娅 1命」，正是那些被扔掉的候选 ⇒ **记录它们几乎零成本**（伤害已算过）。
 *
 * 口径：`isBest` 标出贪婪实际选中的那个（= 该档 `OptimalGoldAllocation` 的来源）；
 * `deltaVsBest` = 本候选伤害 − 该档最优伤害（≤0，绝对值 = 「选错这一步的代价」）。
 */
export interface GoldAllocationAlternative {
  budgetGold: number
  /** 本候选相对「上一档已提交状态」新增的那一步（与预设加金步同形：获取步 = 带 wEngineId 的 wengine 步） */
  step: GoldStep
  damage: number
  /** 该档最优伤害 */
  bestDamage: number
  /** 伤害差（本候选 − 最优，≤0） */
  deltaVsBest: number
  /** 相对最优的损失百分比（(best − 本)/best × 100，≥0） */
  lossPct: number
  isBest: boolean
  /**
   * 本候选的**完整状态**（提交这一步后的影画/精炼/音擎），供 UI 显示「这套分配长什么样」。
   * 注：音擎 id 需要 `wEngineNameOf` 才能显示名字，这里只给 id（保持纯数据）。
   */
  state: TeamGoldState
}

/**
 * 最优加金分配：在预设 goldSteps 定义的可用步骤里，逐金做贪婪搜索。
 * 每金档试算所有「下一个可用级别」（每槽位影画/精炼各一 + 音擎本体获取各一，只列作者写过的级别），
 * 提交伤害提升最大的那个——忽略作者手排顺序，自动优先选优质金。
 * 音擎获取：槽位当前带非限定音擎（常驻/A/空）时，可花 1 金装备作者声明的限定音擎本体（通常 = 专武），每槽至多买一次；
 * 精炼候选只对已带限定音擎的槽位开放，且换装后该槽位精炼从 1 重算（旧音擎的常驻精炼不虚标到新专武）。
 * 这样低金档（如 4 限金 = 3 角色 + 1 专武）也能被正确表达。
 * 口径：候选只来自 preset.goldSteps（尊重作者设定的音擎/命座/精炼范围）；standardSteps 全量应用（不占金）；
 * autoPicks（自动下位择优）覆盖 standardSteps 之后的非限定音擎槽位；
 * 每步同场景对比（boss/buff 已由调用方应用，只变这一级）。
 * 计算量：每金档 × 候选数（≤ 9）次全量伤害，封顶 12 金内最多 ~100 次/队。
 * 调用方须已 applyTeamToStore 并应用 boss/buff；结果按 totalGold 升序（含 base 档）。
 * 试算 / 还原 / 提交与时间线 computeOptimalTeamAllocation 共用 goldGreedy#takeBestGoldStep（r733）：
 * 候选顺序 = 获取步在前，再按各条线在 goldSteps 里首次出现的顺序；伤害并列取先出现的。
 */
export function computeOptimalGoldAllocations(
  calc: Calc,
  configStore: ConfigModel,
  preset: TeamPreset,
  baseGold: number,
  autoPicks: AutoEnginePick[] = [],
  /** 收集每档的全部候选（同队同金不同分配对比用）：传入数组即逐档追加；缺省不收集 = 零额外开销 */
  opts: { alternatives?: GoldAllocationAlternative[] } = {},
  /** 加金阶梯覆盖（缺省 = 预设自己的 goldSteps）：空 goldSteps 的预设由调用方传 catalog 阶梯 */
  steps: GoldStep[] = preset.goldSteps,
): OptimalGoldAllocation[] {
  const sink = opts.alternatives
  // 音擎获取候选：每个槽位第一条带 wEngineId 的 wengine 步（作者声明的升级音擎，通常 = 专武本体）
  const acquireBySlot = new Map<number, GoldStep>()
  // 影画 / 精炼候选：steps 按 (slot, kind) 分线，每条线按级别升序（获取步除外）
  const ladders = new Map<string, GoldStep[]>()
  for (const s of steps) {
    if (s.kind === 'wengine' && s.wEngineId) {
      if (!acquireBySlot.has(s.slot)) acquireBySlot.set(s.slot, s)
      continue
    }
    const key = `${s.slot}:${s.kind}`
    const ladder = ladders.get(key)
    if (ladder) ladder.push(s)
    else ladders.set(key, [s])
  }
  for (const ladder of ladders.values()) ladder.sort((a, b) => a.value - b.value)

  // CC-339：基础档（0 步限定金 + 全量常驻配置 + 预设基础音擎）统一复用 applyGoldSteps，消除三处手写初始化重复
  const { cinemas, wengineMods, wEngines } = applyGoldSteps(
    steps,
    baseGold,
    baseGold,
    preset.standardSteps ?? [],
    presetBaseEngines(preset, useCatalogStore()),
  )
  // 自动下位：非限定槽位换成装填池择优结果（覆盖 standardSteps 写入的常驻/A 音擎）；
  // 生效的限定下位按本体如实计入总限定金（有金就是金）
  const baseAutoLimited = substituteAutoEngines(wEngines, wengineMods, autoPicks)
  let state: TeamGoldState = { cinemas, wengineMods, wEngines }
  applyGoldAllocationToStore(configStore, state)

  const allocations: OptimalGoldAllocation[] = [{
    totalGold: baseGold + baseAutoLimited,
    budgetGold: baseGold,
    ...state,
    label: `${baseGold + baseAutoLimited}金（基础${baseAutoLimited ? `，含下位限定 ${baseAutoLimited} 金` : ''}）`,
    damage: calc.teamTotalDamage.value,
  }]

  const taken: GoldStep[] = []
  /** 已用预算买过本体的槽位：不再出获取候选，槽上原先的限定下位也不再计金 */
  const acquiredSlots = new Set<number>()
  // 自动下位穿上的限定件不阻止购买：买同一把 / 另一把都合法，金数经 acquiredSlots 去重
  const autoLimitedSlots = new Set(autoPicks.filter(p => p.limited).map(p => p.slot))
  while (baseGold + taken.length < GOLD_OPTIMIZE_CAP) {
    const budgetGold = baseGold + taken.length + 1
    const candidates: GoldStep[] = []
    // 候选1：音擎获取（槽位当前非限定音擎、或限定件只是自动下位穿的 → 装备作者声明的限定音擎本体，1 金）
    for (const [slot, acq] of acquireBySlot) {
      if (acquiredSlots.has(slot)) continue
      if (isLimitedWEngine(state.wEngines[slot]) && !autoLimitedSlots.has(slot)) continue
      candidates.push(acq)
    }
    // 候选2：各条线的下一级影画 / 精炼（精炼仅当槽位已带限定音擎）
    for (const ladder of ladders.values()) {
      const { slot, kind } = ladder[0]
      if (kind === 'wengine' && !isLimitedWEngine(state.wEngines[slot])) continue
      const current = kind === 'cinema' ? state.cinemas[slot] : state.wengineMods[slot]
      const next = ladder.find(s => s.value > current)
      if (next) candidates.push(next)
    }
    // 同场景对比：boss/buff 已由调用方应用，每个候选只变这一级
    const { trials, best } = takeBestGoldStep(configStore, state, candidates, () => calc.teamTotalDamage.value)
    if (!best) break // 无更多候选
    state = best.state
    if (best.step.wEngineId) acquiredSlots.add(best.step.slot)
    taken.push(best.step)
    // 归集本档候选（同队同金不同分配对比）：标记赢家 + 相对最优的损失
    if (sink) {
      for (const t of trials) {
        sink.push({
          budgetGold,
          step: t.step,
          damage: t.damage,
          bestDamage: best.damage,
          deltaVsBest: t.damage - best.damage,
          lossPct: best.damage > 0 ? ((best.damage - t.damage) / best.damage) * 100 : 0,
          isBest: t === best,
          state: t.state,
        })
      }
    }
    // 总金如实：预算金 + 仍穿在身上的限定下位（买专武可能顶掉下位限定 → 总金不变但结构更优）
    const autoLimited = countLimitedAutoApplied(state.wEngines, autoPicks, acquiredSlots)
    allocations.push({
      totalGold: budgetGold + autoLimited,
      budgetGold,
      ...state,
      label: `${budgetGold + autoLimited}金（最优）${autoLimited ? `（含下位限定 ${autoLimited} 金）` : ''}：${taken.map(t => t.label).join(' + ')}`,
      damage: best.damage,
    })
  }
  return allocations
}

// ========== 应用到 store ==========

/**
 * 把 buff 牌写进全局 Buff 表（**整表替换**＝只留这张牌；CC-343 起分析器在独立场景里跑，UI store 不被碰）。
 * CC-341：走唯一映射 `phaseBuffRows`，`cond` 原样写入，由管线按当前队伍解析（修前在这里按预设队伍预解析；
 * 写入时 store 里已是该预设的队伍 ⇒ 结果逐位相同）。
 */
export function applyBuffToStore(configStore: ConfigModel, card: PhaseBuffCard | null) {
  const rows = card ? phaseBuffRows(card, (_e, i) => `phase-buff:${card.title}:${i}`, card.title) : []
  // 整表替换成所选牌（本页口径：用户手填的全局 buff 不参与对比），但关卡固有 buff 属于房间、由 applyBossRoom 写入，保留
  // （CC-342 第 364 轮；修前连关卡 buff 一起清掉 ⇒ 队伍对比恒按「无关卡 buff」算）
  const layer = configStore.globalBuffs.filter(r => String(r.id).startsWith(LAYER_BUFF_PREFIX))
  configStore.globalBuffs.splice(0, configStore.globalBuffs.length, ...layer, ...rows)
}

/**
 * 自动推荐：对每张可用牌应用后算一次伤害，取最高者（测试服占位牌同样参选，只在展示层标注）。
 * 用第一个金数档位做推荐（buff 选择对队伍而言跨金档基本稳定）。
 */
function pickBestBuff(
  calc: Calc,
  configStore: ConfigModel,
  options: TeamCompareOptions,
): PhaseBuffCard | null {
  const cards = options.buffs ?? []
  if (cards.length === 0) return null
  let best: PhaseBuffCard | null = null
  let bestDmg = -1
  for (const card of cards) {
    applyBuffToStore(configStore, card)
    const dmg = calc.teamTotalDamage.value
    if (dmg > bestDmg) {
      bestDmg = dmg
      best = card
    }
  }
  return best
}

/**
 * 换人 + 音擎 + 驱动盘 + 连携/平A 权重 + 交互参数（队伍级，每 preset 一次）。
 * **难度曲线的「全关」基线也用它**（`difficultyCurve.ts`）：曲线必须与散点同口径
 * （预设声明的静态权重/交互，而不是 `setAgent` 的 agent 默认值），见该文件头。
 */
export function applyTeamToStore(configStore: ConfigModel, preset: TeamPreset) {
  // CC-339：换人前先把三槽复位为 0命1精，防止上一预设末尾的高命座/高精炼残留进 setAgent 内的 syncTeammateBuffsFromTeam 与配装推荐
  for (let slot = 0; slot < 3; slot++) {
    configStore.setCinemaLevel(slot, 0)
    configStore.setWEngineModLevel(slot, 1)
  }
  applyTeamPresetConfig(configStore, preset)
}

/**
 * CC-351：**队伍预设 → store 的唯一映射**（主页选预设 `TeamConfigPage#onPresetSelect` 与分析器 `applyTeamToStore` 共用）。
 * = 逐槽 `setAgent`（换人 + 推荐配装）→ 预设声明的音擎 / 驱动盘 / 连携 / 平A 权重覆盖 → 预设交互。
 * 用逐槽 `setAgent` 而非 `applyTeamPreset`：后者在推荐未加载时抛错，而分析器单测普遍不加载推荐（金标在兜底盘上录制），
 * 换过去会让金标整体漂移；主页入口自己先查 `catalogStore.buildRecsLoaded`（未就绪就提示返回），防线不丢。
 * **不动命座 / 精炼**：分析器在外层先复位 0命1精（CC-339）；主页保留用户所选档位（有意的 UX，见 store#setAgent 注释）。
 * 修前主页只做 `applyTeamPreset` + 交互 ⇒ 拿的是**推荐音擎**而非预设 `wEngines`（104 预设里 65 个槽不同，多为辅助位
 * 预设用非限定音擎、推荐给限定专武）：主页算的不是队伍对比报的那支队，「预设金数 → 保存到预设文件」还会把推荐专武
 * 当成「换限定音擎」凭空写出一条本体加金步（`buildGoldStepsFromConfig` 以预设 wEngines 为基础音擎比对）。
 */
export function applyTeamPresetConfig(configStore: ConfigModel, preset: TeamPreset) {
  for (let slot = 0; slot < 3; slot++) {
    configStore.setAgent(slot, preset.team[slot])
    // 基础音擎 = presetBaseEngines（字段缺席 ⇒ catalog 派生 = 主页一键搭配口径）。
    // 显式空串 = 「这个槽不带专武」⇒ 不覆盖 store（保留 setAgent 的推荐，由下位表/自动下位接手），
    // 与 baseGoldOf 对空串计 0 金一致。
    const baseEngine = presetBaseEngines(preset, useCatalogStore())[slot]
    if (baseEngine) configStore.setWEngine(slot, baseEngine)
    // 驱动盘不来自预设：预设文件只带 team（用户 2026-10-26「预设队伍只需带 3 个人的信息就行」），
    // 且 validate:data 与 teamPresetPayload.test 把 driveDiscs 列为**禁止出现**的配装字段
    // ⇒ 原 preset.driveDiscs?.[slot] 分支按其构造永远进不去（死通道），2026-10-29 删除。
    if (preset.chainCountPerStun) configStore.setActionCount(slot, 'chainCountPerStun', preset.chainCountPerStun[slot])
    if (preset.basicAttackTimeWeight) configStore.setActionCount(slot, 'basicAttackTimeWeight', preset.basicAttackTimeWeight[slot])
  }
  applyPresetInteractions(configStore, preset.interactions)
}

/**
 * CC-257：**预设交互条目 → 引擎字段**的唯一映射（主页选预设 `TeamConfigPage#onPresetSelect` 与分析器装配
 * `applyTeamToStore` 共用；条目 slot 缺省 0；未列类型只进难度、不写引擎）。
 * 修前两份副本词表不同：主页认 banyueGoldenParry / banyueDualCounter、不认 block / tauntCancel；
 * 此处反之（旧注释「角色专属类型只进难度」）。般岳的 `blockCount` 就是金身格挡
 * （banyue.ts `interactionInputs.block = 金身格挡`）⇒ 两个名字是同一物理交互，取并集。
 * CC-259：专属类型不再写死般岳名，改由**该槽角色**模块 `interactionFieldTypes` 反查字段——
 * 专属类型挂在别的角色槽上（如测试夹具给维琳娜声明 banyueGoldenParry）不写引擎、只进难度（修前会误写 blockCount 再按普通格挡计一次）。
 * 现存预设里声明般岳类型的有 banyue-liuyin-lucia / banyue-norma-lucia 两条（般岳在 slot 0），
 * 值同模块 interactionDefaults（2026-10-11 用户口径下调后 = 12 / 3，原 20 / 5 会把轴挤出预算）。
 */
export function applyPresetInteractions(
  configStore: ConfigModel,
  items: readonly InteractionItem[] | undefined,
): void {
  for (const it of items ?? []) {
    const slot = it.slot ?? 0
    const own = interactionFieldForType(configStore.team[slot]?.agentId, it.type)
    if (own === 'blockCount') { configStore.setActionCount(slot, 'blockCount', it.count); continue }
    if (own === 'dualCounterCount') { configStore.setActionCount(slot, 'dualCounterCount', it.count); continue }
    switch (it.type) {
      case 'parry': configStore.setActionCount(slot, 'parryCount', it.count); break
      case 'dodge': configStore.setActionCount(slot, 'dodgeCounterCount', it.count); break
      case 'block': configStore.setActionCount(slot, 'blockCount', it.count); break
      case 'tauntCancel': configStore.setActionCount(slot, 'tauntCancelCount', it.count); break // 般岳：嘲讽取消失衡外连段后摇
      case 'claretBurialInterrupt': configStore.setActionCount(slot, 'claretBurialInterruptCount', it.count); break // 克拉蕾：打断葬血强袭（数值减半、毁伤照常）
      /**
       * 仪玄·e 弹（完美格挡）→ 本槽 (`yixuanPerfectBlockCount`)。
       * ⚠ 2026-10-26 补：该类型早就在 `INTERACTION_WEIGHTS` / `INTERACTION_LABELS` /
       * `BOSS_ATTACK_INTERACTIONS` 三处登记，**却漏了本 switch 的 case** ⇒ 用户填的次数不落 cfg，
       * 仪玄的闪能/日珥收入与「#2 赠送」全按 0 算（引擎侧字段与消费者全都现成，只差这一行转发）。
       * 注意**不是** `perfectBlockCount`——那是佩洛伊斯（phoenix）的字段，两者语义不同不可共用。
       */
      case 'yixuanPerfectBlock': configStore.setActionCount(slot, 'yixuanPerfectBlockCount', it.count); break
      /** 佩洛伊斯·完美格挡 → `perfectBlockCount`（phoenix.ts#phoenixEmberIncome 消费） */
      case 'perfectBlock': configStore.setActionCount(slot, 'perfectBlockCount', it.count); break
      /**
       * `counterAssist`（反制支援/角力）**刻意不在此处**：它的次数不是用户交互项，而是由 **boss 预设**
       * 的控制技组数推出（`configStore.counterAssistSlot` + `appliedBoss.counterAssistGroups`，
       * 见 `resourceCalc/helpers.ts#counterAssistCount`）。在交互栏再填一遍会与 boss 推导**双计**。
       * 它出现在 `INTERACTION_WEIGHTS` / `BOSS_ATTACK_INTERACTIONS` 里是为了**难度权重**（每组算一次弹刀），
       * 不是为了让用户填次数。
       */
    }
  }
}

/** 把金档状态（影画 / 精炼 / 音擎）写进 configStore（CC-337 单一实现） */
export function applyGoldAllocationToStore(
  configStore: ConfigModel,
  alloc: { cinemas: readonly number[]; wengineMods: readonly number[]; wEngines: readonly string[] },
): void {
  for (let slot = 0; slot < 3; slot++) {
    configStore.setCinemaLevel(slot, alloc.cinemas[slot] ?? 0)
    configStore.setWEngineModLevel(slot, alloc.wengineMods[slot] ?? 1)
    if (alloc.wEngines[slot]) configStore.setWEngine(slot, alloc.wEngines[slot]!)
  }
}

export function applyGoldToStore(
  configStore: ConfigModel,
  preset: TeamPreset,
  targetTotalGold: number,
  autoPicks: AutoEnginePick[] = [],
  /** 加金阶梯覆盖（缺省 = 预设自己的 goldSteps）：`computeTeamComparePoints` 传「作者没排就按 catalog 推」的那份 */
  goldSteps: GoldStep[] = preset.goldSteps,
) {
  const applied = applyGoldSteps(
    goldSteps,
    targetTotalGold,
    baseGoldOf(preset),
    preset.standardSteps ?? [],
    preset.wEngines ?? [],
  )
  const { cinemas, wengineMods, wEngines } = applied
  // 被预算步购买过音擎的槽位（其金已在预算内，避免下位限定双算）
  const acquiredSlots = new Set(
    goldSteps.slice(0, applied.stepsApplied)
      .filter(s => s.kind === 'wengine' && s.wEngineId)
      .map(s => s.slot),
  )
  // 自动下位：最终非限定的槽位换成装填池择优结果（已买到限定专武的槽位不动）
  const autoLimitedGold = substituteAutoEngines(wEngines, wengineMods, autoPicks, acquiredSlots)
  applyGoldAllocationToStore(configStore, { cinemas, wengineMods, wEngines })
  return { ...applied, autoLimitedGold }
}

/**
 * 难度变体的轴绑定：preset.stunAxisPresetId 指向 stunAxisPresets 里的预设时，
 * 对比计算用该轴（固定 axes → 写 stunAxes；条件 plans → 写 stunAxisPlans，二者互斥防遮蔽），
 * 保证「普通轴 / 5嗔火10大」等难度档各自算各自的轴，不受用户当前手动轴干扰。
 * 未绑定 / 预设 id 不存在 → 恢复快照轴状态（自动匹配 / 用户轴，与旧口径一致）。
 * 每队先恢复快照，同一次批量计算内各队轴状态互相隔离。
 */
export function applyAxisBinding(
  configStore: ConfigModel,
  snap: StunAxisState,
  preset: Pick<TeamPreset, 'stunAxisPresetId'>,
): boolean {
  configStore.setAxisState(snap)
  if (!preset.stunAxisPresetId) return false
  const axisPreset = stunAxisPresets.find(p => p.id === preset.stunAxisPresetId)
  if (!axisPreset) return false
  return configStore.applyStunAxisPreset(axisPreset) // 方案 / 固定轴互斥写入的唯一实现（arena-D 第 368 轮）
}

/**
 * 从引擎资源结果提取总动作时间（秒）= 前台净占用（单一事实源 netFrontlineOccupation：
 * Σ物化前台行 − 轴内合轴节省 − 招式合轴抵扣；后台行如莱卡恩围猎蓄力不占共享时间轴）。
 * 引擎折叠循环已把前台净占用对其账本收敛（Σ前台净占用 ≡ 账本 ≤ 战斗时间 + 合轴抵扣），仍超出 = 收敛残差/极端配置。
 */
function actionTimeTotal(
  calc: Calc,
  invincibleTime: number,
  battleTime: number,
): { timeExceeded: boolean; timeDetail: string } {
  const rr = calc.resourceResult.value
  const totalActionTime = rr ? netFrontlineOccupation(rr) : 0
  const available = battleTime - invincibleTime
  // 容差 1s：引擎折叠循环按文档容忍 ±1s 量化残差（resource.ts「floor 次数导致残差 ~1s
  // 属合轴可覆盖，不追求精确 0」）；零容差会把「贴线打满 + 收敛残差」误报为超时
  // （2026-09-03 异常利用率修正后 伊德海莉队实测 180.0053s 被 1e-6 容差误报为超时）
  const exceeded = totalActionTime > available + 1
  // 降配提示（引擎 axisFallback / interactionScale）：轴需求或手填交互超出时间预算时
  // 引擎自动降配——弃轴退化一般轴 / 缩放交互次数（boss 强制弹刀不缩）。
  const notes: string[] = []
  if (rr?.convergence.axisFallback) notes.push('轴需求超出时间预算，已退化为一般轴')
  const scale = rr?.convergence.interactionScale
  if (scale !== undefined && scale < 1) notes.push(`交互次数已降配 ×${fmt(scale, 2)}`)
  const fallbackNote = notes.length > 0 ? `｜${notes.join('；')}` : ''
  return {
    timeExceeded: exceeded,
    timeDetail: exceeded
      ? `⚠ 超时：动作总时间 ${fmt(totalActionTime, 1)}s > 可用 ${fmt(available, 0)}s（战斗${fmt(battleTime, 0)}s − 无敌${fmt(invincibleTime, 0)}s）${fallbackNote}`
      : `✓ 可行：动作总时间 ${fmt(totalActionTime, 1)}s ≤ 可用 ${fmt(available, 0)}s${fallbackNote}`,
  }
}

// ========== 批量计算 ==========

/**
 * 计算所有点（同步）。调用方负责分批调度避免卡 UI（见 TeamComparePage）。
 * 计算完成/异常后自动恢复现场。
 */
/** 比较点先选交互档，再同刻取数和现场；不在金数候选 readDamage 回调中写搜索状态。 */
function applyComparisonInteractionLevel(ctx: import('@/composables/timeWeightAllocation').TimeWeightAllocationContext, level: NonNullable<TeamCompareOptions['interactionLevel']>): void {
  if (ctx.configStore.interactionsLocked || ctx.configStore.enemy.stunCountLock >= 0 || level === 'manual') return
  if (level === 'zero') {
    ctx.configStore.setTimeWeightStrategy('zero')
    clearInteractions({ config: ctx.configStore, calc: ctx.calc })
    ctx.configStore.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0)
    return
  }
  ctx.configStore.setMechanicSetting(INTERACTION_MODE_SETTING, INTERACTION_OPTIMUM_MODE)
  applyTimeWeightAllocation({ ...ctx, interactionOptions: { maximizeNetGains: level === 'max' } }, INTERACTION_OPTIMUM_STRATEGY_ID)
}

export function computeTeamComparePoints(scenario: AnalysisContext, options: TeamCompareOptions): TeamComparePoint[] {
  const { config: configStore, calc } = scenario
  const baseAxis = configStore.getAxisState()
  /**
   * 现场差分基线 = **本次运行的起点**（在改写任何配置**之前**采一次；每个调用方在自己的场景里跑，
   * 故 base 与该次运行的第一档现场逐字节相同）。见 `configDelta` 的语义三条。
   */
  const sceneBase = options.collectScenes ? captureState(configStore) : null
  const points: TeamComparePoint[] = []
  const overrides = options.slotOverrides ?? NO_SLOT_OVERRIDES
  for (const rawPreset of options.presets) {
    // 逐槽锁定：剔除锁定槽的加金/常驻步（无锁定 ⇒ 原对象引用原样返回）
    const { preset, locked, pageLocked } = applySlotOverrides(rawPreset, overrides, useCatalogStore())
    // 只有**页面**覆盖才算「预支的金要补进显示」；预设自带 slotCodes 的金已由 baseGoldOf 计入
    const hasPageLock = pageLocked.some(Boolean)
    const hasLock = locked.some(l => l !== null)
    applyTeamToStore(configStore, preset)
    // 难度变体轴绑定（未绑定 = 恢复快照轴状态，走自动匹配/用户轴）
    applyAxisBinding(configStore, baseAxis, preset)
    const baseGold = baseGoldOf(preset)
    /**
     * 本队实际可用的加金阶梯。
     *
     * ⚠ **用户裁决 2026-10-26**（逐字）：「加金不该有排好的序……我想等我把计算逻辑算好后，
     * 跑一遍贪婪算出一份提升表，作为快速默认值……但目前引擎还远远不完善，只能说全01这一片单薄的
     * 预设就行，要么给 ui 自己改，要么勾选贪婪，提示下一步。」
     *
     * ⇒ 默认路径**不再造顺序**：只有**用户显式配置**（预设文件里写回的 `goldSteps` / 逐槽锁定）
     * 才当作阶梯；没有就是**空阶梯** ⇒ `resolveGoldLevel` 钳到 `[基础金, 基础金]` ⇒
     * 只出「全 01」一个点。要更多金档必须**显式**选：勾「最优加金」（贪婪）或逐槽锁定。
     * 修前这里会在空 goldSteps 时用 `catalogGoldSteps` 临时排一份（主C 影画 1..6 → 精炼 → 队友…），
     * 实测那份顺序在 96 队 285 档里 **227 档选错配装、均值低 10.32%、最大低 43.40%**
     * ——把「我们自己编的顺序」当成默认结果报给用户，正是「自动加金完全不准」的来源。
     */
    const goldSteps = goldStepsForPreset(preset, useCatalogStore())
    /**
     * **贪婪的候选池**（与默认阶梯分开，用户裁决 2026-10-26）：
     * 默认阶梯 = 用户显式配置（空 ⇒ 只出全 01 一个点）；勾了「最优加金」时，
     * 搜索空间 = 预设写回的 `goldSteps`（有的话）**或** catalog 推的候选池。
     * 两者只有在用户真的勾了贪婪/写了配置时才会产生「多金档位」，不会静默替用户做决定。
     */
    const goldCandidates = goldSteps.length > 0
      ? goldSteps
      : catalogGoldSteps(preset.team, presetBaseEngines(preset, useCatalogStore()), useCatalogStore())
    // CC-339：无论是否开启 optimalGold，均先把队伍置于该预设基础金分配（基础音擎 + 0命1精 + standardSteps），
    // 保证 buff 自动推荐（pickBestBuff）、自动下位音擎择优（computeAutoEnginePicks）与贪婪搜索从同一真实基础档出发
    applyGoldAllocationToStore(
      configStore,
      applyGoldSteps(goldSteps, baseGold, baseGold, preset.standardSteps ?? [], presetBaseEngines(preset, useCatalogStore())),
    )
    // boss 一次应用（与金数档无关）；必须在选 buff 前应用，推荐排序才基于所选期数的敌人配置
    applyBossRoom(configStore, options.boss, options.phase)
    // 选 buff：手动指定 > 每队自动取三张牌伤害最高（用第一个金数档推荐）
    let chosen: PhaseBuffCard | null = null
    if (options.manualBuffTitle) {
      chosen = (options.buffs ?? []).find(b => b.title === options.manualBuffTitle) ?? null
    } else {
      chosen = pickBestBuff(calc, configStore, options)
    }
    applyBuffToStore(configStore, chosen)
    // 自动下位音擎（缺省开）：boss/buff 已应用，从真实场景出发在装填池内择优；每队一次
    const autoPicks = options.autoEngine === false
      ? []
      : computeAutoEnginePicks(calc, configStore, preset, options)
    // 最优加金：预计算 ≤12 金各档的最优分配（含伤害，避免点循环里重算）
    // 候选只在页面要「同队同金不同分配」表时才收集（调用方传 options.goldAlternatives；缺省零额外开销）
    const optimalMap = new Map<number, OptimalGoldAllocation>()
    if (options.optimalGold) {
      const sink = options.goldAlternatives
      const alternatives: GoldAllocationAlternative[] = []
      const allocs = computeOptimalGoldAllocations(
        calc, configStore, preset, baseGold, autoPicks,
        sink ? { alternatives } : {},
        goldCandidates,
      )
      for (const a of allocs) {
        optimalMap.set(a.budgetGold, a) // 预算域键：resolveGoldLevel 的钳制口径不含限定下位附加
      }
      if (sink) for (const alt of alternatives) sink.push({ ...alt, presetId: preset.id, presetName: preset.name })
    }
    const seen = new Set<number>()
    for (const gold of options.goldLevels) {
      // 难度门槛：低于该难度要求的最低总限定金不生成点（如 5嗔火10大 需琉音配置足够高）
      if (gold < (preset.minGold ?? 0)) continue
      // 目标限定金越界时钳制到最近档位；同一队伍同一钳制结果只出一个点
      /**
       * 可达档位：
       * - **默认**（不勾贪婪）= 用户显式阶梯。空 ⇒ 钳到 `[基础金, 基础金]` ⇒ 只有「全 01」一个点。
       * - **勾了贪婪** = 候选池（贪婪链能走到哪一档就出哪一档，与候选池的顺序无关）。
       * 这两条必须分开：若默认也用候选池，`applyGoldToStore` 会按候选池的**排列顺序**取前缀，
       * 那正是用户 2026-10-26 明确否掉的行为。
       */
      const ladderForPoints = options.optimalGold ? goldCandidates : goldSteps
      const { totalGold } = resolveGoldLevel(ladderForPoints, gold, baseGold)
      if (seen.has(totalGold)) continue
      seen.add(totalGold)
      const opt = optimalMap.get(totalGold)
      const applied = opt ? null : applyGoldToStore(configStore, preset, gold, autoPicks, ladderForPoints)
      if (opt) {
        applyGoldAllocationToStore(configStore, opt)
      }
      // 逐槽锁定：加金分配之后再盖上（锁定槽"预支"自己的配装，不参与上面的预算分配）。
      // 必须在读伤害之前写，否则读到的还是算法分配的配装。
      if (hasLock) {
        for (let s = 0; s < 3; s++) {
          const lock = locked[s]
          if (!lock) continue
          configStore.setCinemaLevel(s, lock.cinema)
          configStore.setWEngineModLevel(s, lock.wengine)
        }
      }
      // 有任意锁（页面或预设自带）都不能用贪心预算里的读数：那份读数是没盖锁的配置算出来的
      applyComparisonInteractionLevel({ calc, configStore }, options.interactionLevel ?? 'manual')
      const damage = calc.teamTotalDamage.value
      // 时间可行性校验：从引擎资源结果取精确动作总时间
      const invTime = configStore.enemy.invincibleTime
      const battleTime = configStore.enemy.battleTime
      const { timeExceeded, timeDetail } = actionTimeTotal(calc, invTime, battleTime)
      // 时间压力（硬溢出 + 合轴抵扣，同一笔秒数）并入操作难度：默认 1 秒 = 1 难度点，权重可被用户覆盖（难度权重弹层）
      const rrHere = calc.resourceResult.value
      const { difficulty, detail } = computeDifficulty(
        // CC-259：交互项 = 引擎实打次数（与难度曲线同一函数 liveInteractions：按槽截断存活率缩；预设只补引擎没有的类型）。
        // 修前读预设声明（auto 预设 parry8/dodge4 = 未校准占位，用户 2026-09-11「完全不需要以前这个死数值」），
        // 而同一个点的伤害按 setAgent 预填 + 预设覆盖的实打次数算 ⇒ 97/104 个预设 x 与伤害不同口径。
        liveInteractions(configStore, preset, rrHere), preset.team, rrHere?.overflowSeconds ?? 0,
        options.difficultyWeights,
        // 合轴抵扣掉的那一半（两图同一把尺：难度曲线也用它）
        rrHere ? frontlineOccupationBreakdown(rrHere).saved : 0,
        /**
         * 非失衡占比修正（用户口径 2026-09-20）——**散点页与难度曲线页必须同一把尺**，
         * 漏传会让同一支队在两张图上得到不同 x（实机点通抓到：散点明细缺 `÷非失衡占比…` 项）。
         * 口径 = `calc.stunCoverage`（含决算截断损失秒的权威值）。
         */
        stunWindowRatioOf(calc, configStore.enemy),
      )
      const std = preset.standardSteps ?? []
      // 逐槽锁定：展示用的影画/精炼以锁定值为准（上面已写进 store，这里只是把它带进结果行）
      const cinemas: [number, number, number] = [0, 1, 2].map(s => locked[s as 0 | 1 | 2]?.cinema ?? (opt ? opt.cinemas[s]! : applied!.cinemas[s]!)) as [number, number, number]
      const wengineMods: [number, number, number] = [0, 1, 2].map(s => locked[s as 0 | 1 | 2]?.wengine ?? (opt ? opt.wengineMods[s]! : applied!.wengineMods[s]!)) as [number, number, number]
      const label = opt ? opt.label : applied!.label
      // 自动下位中「仍穿在身上」的限定件数：有金就是金，按本体各计 1 金入总限定金
      const autoLimitedGold = opt ? Math.max(0, opt.totalGold - totalGold) : applied!.autoLimitedGold
      let standardLabel = opt
        ? (std.length === 0 ? '' : `常驻：${std.map(s => s.label).join(' + ')}`)
        : applied!.standardLabel
      // 常驻配置行追加自动下位说明（两分支同格式：常驻：…｜自动下位：…｜含下位限定 N 金）
      const autoParts: string[] = []
      if (autoPicks.length > 0) autoParts.push(`自动下位：${autoPicks.map(p => p.label).join('、')}`)
      if (autoLimitedGold > 0) autoParts.push(`含下位限定 ${autoLimitedGold} 金`)
      const autoLabel = autoParts.join('｜')
      const withAuto = (base: string) => [base, autoLabel].filter(Boolean).join('｜')
      standardLabel = withAuto(standardLabel)
      // 有锁定时"预支"的金不在 totalGold 里 ⇒ 补上锁定槽的增量（teamGoldOf 是唯一金数口径）。
      // ⚠ 不能整队读 store 重算：store 里 setAgent 自动上的**专武**不是预设声明的基础音擎
      // （freeCompare/engine.ts 同款坑），整队重算会多算那几件。这里只算**锁定槽相对基础档的增量**。
      // 无锁定走原表达式（逐位不变，既有 100+ 用例的金数断言不受影响）。
      let lockedGold = totalGold + autoLimitedGold
      if (hasPageLock) {
        for (let s = 0; s < 3; s++) {
          const lock = locked[s]
          if (!lock || !pageLocked[s]) continue
          const agentId = configStore.team[s]?.agentId ?? ''
          const wId = configStore.team[s]?.wEngineId ?? ''
          const goldOf = (cinema: number, mod: number) => teamGoldOf([agentId], [wId], [cinema], [mod])
          lockedGold += goldOf(lock.cinema, lock.wengine) - goldOf(0, 1)
        }
      }
      points.push({
        presetId: preset.id,
        presetName: preset.name,
        // 显示用金数 = 总限定金（限定角色本体+限定音擎本体+影画/精炼步+仍穿的限定下位本体；
        // 有逐槽锁定时按最终配置重算，见上）
        goldCount: lockedGold,
        goldLabel: label,
        standardGoldLabel: standardLabel || undefined,
        cinemas,
        wengineMods,
        difficulty,
        difficultyDetail: detail,
        interactions: preset.interactions,
        damage,
        hpRatio: Math.round((damage / options.phase.hp) * 10000) / 100,
        bossHp: options.phase.hp,
        buffTitle: chosen?.title,
        timeExceeded,
        timeDetail,
        // 这一档的现场（差分）——与上面的读数**同刻**采，供展示层按需重算该档完整资源池
        scene: sceneBase ? { base: sceneBase, delta: stateDeltaOf(sceneBase, captureState(configStore)) } : undefined,
      })
    }
  }
  return points
}
