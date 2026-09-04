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
import { useConfigStore, type CharacterConfig, type EnemyConfig } from '@/stores/config'
import type { SkillDamageTarget } from '@/types/catalog'
import { useCatalogStore } from '@/stores/catalog'
import type { BossPreset, BossPresetPhase, PhaseBuffCard, PhaseBuffEffect } from '@/types/bossPreset'
import { cloneStunAxes, stunAxisPresets } from '@/data/stunAxisPresets'
import { fmt } from '@/utils/format'
import {
  INTERACTION_WEIGHTS,
  type GoldStep,
  type InteractionItem,
  type TeamComparePoint,
  type TeamPreset,
} from '@/types/teamPreset'
import type { useResourceCalc } from '@/composables/useResourceCalc'
import ENGINE_POOLS_SRC from '@/data/enginePools.json'
const ENGINE_POOLS = ENGINE_POOLS_SRC as Record<string, string[]>
import { netFrontlineOccupation } from '@/core/resource/helpers'

type Calc = ReturnType<typeof useResourceCalc>

/**
 * 常驻 S 角色（获取不消耗限定金）。常驻音擎 = 这些角色的专武本体。
 * 依据：ZZZ 常驻池 S 角色 = 猫又(1021)/11号(1041)/珂蕾妲(1101)/莱卡恩(1141)/格莉丝(1181)/丽娜(1211)；
 * 对应专武：钢铁肉垫(14102)/硫磺石(14104)/燃狱齿轮(14110)/拘缚者(14114)/嵌合编译器(14118)/啜泣摇篮(14121)。
 * 注意：焰心桂冠(14116) 是莱特专武（限定），不在常驻清单。
 * 名单本体在 @/data/standardMultiplierTable（标准倍率表稀有度分档共用），此处转出口保持原 API。
 */
import { STANDARD_S_AGENT_IDS } from '@/data/standardMultiplierTable'
export { STANDARD_S_AGENT_IDS }
export const STANDARD_S_WENGINE_IDS = new Set(['14102', '14104', '14110', '14114', '14118', '14121'])

/**
 * 自动下位默认候选池（用户准信，2026-08）：击破 = 人为刀俎(A)/燃狱齿轮(S常驻)，
 * 辅助 = 好斗的阿炮(A)/逍遥游球(A)/啜泣摇篮(S常驻)。精炼档沿用 A 默认 5、常驻 S 默认 3
 * （与准信 精5/精3 一一对应，页面可调）。只是试算起点，不是口径上限——装填框可增删任意音擎，
 * 限定音擎也可加入：选中即按本体（精炼1）如实计入总限定金（有金就是金）。
 */
export const DEFAULT_AUTO_ENGINE_POOL = ['13005', '14110', '13115', '14002', '14121']

/** 角色是否算限定金（S 级且非常驻；A/B 级不算）。catalog 未加载时按常驻清单兜底。 */
export function isLimitedAgent(agentId: string): boolean {
  if (!agentId) return false
  const agent = useCatalogStore().getAgent(agentId)
  if (agent) return agent.rarity === 'S' && !STANDARD_S_AGENT_IDS.has(agentId)
  return !STANDARD_S_AGENT_IDS.has(agentId)
}

/** 音擎是否算限定金（S 级且非常驻音擎；A/B 级不算）。catalog 未加载时按常驻清单兜底。 */
export function isLimitedWEngine(wEngineId: string): boolean {
  if (!wEngineId) return false
  const w = useCatalogStore().getWEngine(wEngineId)
  if (w) return w.rarity === 'S' && !STANDARD_S_WENGINE_IDS.has(wEngineId)
  return !STANDARD_S_WENGINE_IDS.has(wEngineId)
}

export interface TeamCompareOptions {
  /** 参与对比的预设队伍 */
  presets: TeamPreset[]
  /** 每个队伍跑的金数档位（如 [0, 2, 4, 6]） */
  goldLevels: number[]
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
}

/** 效果是否对当前队伍生效（特性限定 / 特性人数分档）。导出供测试。 */
export function resolveBuffEffect(eff: PhaseBuffEffect, preset: TeamPreset): PhaseBuffEffect | null {
  if (!eff.cond) return eff
  const { specialty, countTier } = eff.cond
  if (specialty) {
    const has = preset.team.some(id => specialtyOf(id) === specialtyEn(specialty))
    if (!has) return null
  }
  if (countTier) {
    const n = preset.team.filter(id => specialtyOf(id) === specialtyEn(countTier.specialty)).length
    const value = n >= countTier.thresholds[1] ? countTier.values[1] : n >= countTier.thresholds[0] ? countTier.values[0] : null
    if (value == null) return null
    return { ...eff, value }
  }
  return eff
}

function specialtyOf(agentId: string): string {
  return useCatalogStore().getAgent(agentId)?.specialty ?? ''
}

/** 特性中文（parser 产出的 cond.specialty）→ 引擎英文 specialty */
const SPECIALTY_ZH_EN: Record<string, string> = {
  强攻: 'attack', 异常: 'anomaly', 击破: 'stun', 命破: 'rupture', 支援: 'support', 防护: 'defense', 锋御: 'sharpen',
}
function specialtyEn(zh: string): string {
  return SPECIALTY_ZH_EN[zh] ?? zh
}
const INTERACTION_LABELS: Record<string, string> = {
  parry: '弹刀',
  dodge: '闪避',
  quickAssist: '快支',
  block: '格挡',
  banyueGoldenParry: '般岳·金身弹刀',
  banyueDualCounter: '般岳·双反',
  tauntCancel: '嘲讽取消',
}

/** 补全 0 值交互条目（内置三类型 + 队伍角色专属），让预设里为 0 的字段也显示出来，方便照抄字段填数字。 */
function completeInteractionList(interactions: InteractionItem[], team: (string | null | undefined)[]): InteractionItem[] {
  const present = new Set(interactions.map(i => i.type))
  const out = [...interactions]
  for (const t of ['parry', 'dodge', 'quickAssist'] as const) {
    if (!present.has(t)) out.push({ type: t, count: 0 })
  }
  if (team.includes('1471')) {
    for (const t of ['banyueGoldenParry', 'banyueDualCounter'] as const) {
      if (!present.has(t)) out.push({ type: t, count: 0, slot: 0 })
    }
  }
  return out
}

/** 交互清单 → 难度 = Σ(count × weight)，附明细文案（含 0 值条目，标注 ×0 供照抄字段） */
export function computeDifficulty(
  interactions: InteractionItem[],
  team: (string | null | undefined)[] = [],
): { difficulty: number; detail: string } {
  const items = completeInteractionList(interactions, team)
  let total = 0
  const parts: string[] = []
  for (const it of items) {
    const weight = it.weight ?? INTERACTION_WEIGHTS[it.type] ?? 1
    total += it.count * weight
    if (weight <= 0) continue // 配置类交互（如嘲讽取消，weight 0）不进难度明细
    const label = it.label ?? INTERACTION_LABELS[it.type] ?? it.type
    parts.push(`${label}${it.count}×${weight}`)
  }
  return { difficulty: Math.round(total * 100) / 100, detail: parts.join(' + ') || '无交互' }
}

/**
 * 队伍基础限定金 = 限定 S 角色本体 + 限定音擎本体（每项 1 金）。
 * 常驻 S 角色（莱卡恩等）本体/专武、A/B 级角色、常驻音擎都不计。
 * 例：伊德海莉+莱卡恩+卢西娅（全带专武）= 2 + 2 = 4 金（莱卡恩与拘缚者不计）。
 */
export function baseGoldOf(preset: TeamPreset): number {
  let gold = 0
  for (let slot = 0; slot < 3; slot++) {
    if (isLimitedAgent(preset.team[slot] ?? '')) gold += 1
    const wId = preset.wEngines?.[slot] ?? ''
    if (isLimitedWEngine(wId)) gold += 1
  }
  return gold
}

/**
 * 当前队伍配置 → 总限定金（「预设金数」弹窗实时显示用）。
 * 口径与 baseGoldOf/applyGoldSteps 一致：限定 S 角色本体 1 金 + 限定音擎本体 1 金 +
 * 影画每级 1 金 + 精炼每级 1 金（精炼1 = 本体，不计步）；常驻角色/音擎、A/B 级不计。
 * cinemas 0-6、wengineMods 1-5。例：全队 0命1精带专武 = 6 金；212121 = 12 金。
 */
export function teamGoldOf(
  agentIds: (string | null | undefined)[],
  wEngineIds: (string | null | undefined)[],
  cinemas: number[],
  wengineMods: number[],
): number {
  let gold = 0
  for (let slot = 0; slot < 3; slot++) {
    if (isLimitedAgent(agentIds[slot] ?? '')) gold += 1 + Math.max(0, cinemas[slot] ?? 0)
    if (isLimitedWEngine(wEngineIds[slot] ?? '')) gold += 1 + Math.max(0, (wengineMods[slot] ?? 1) - 1)
  }
  return gold
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
    const name = agent?.name.zhCN ?? agent?.name.en ?? `槽位${slot + 1}`
    // 影画步进（限定 → goldSteps，常驻/A级 → standardSteps）
    const cinema = Math.max(0, Math.min(6, cinemas[slot] ?? 0))
    const cTarget = isLimitedAgent(agentId) ? goldSteps : standardSteps
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

/** 一个槽位的自动下位择优结果 */
export interface AutoEnginePick {
  slot: number
  /** 选中的音擎 id */
  id: string
  /** 穿戴精炼档（限定候选按本体精炼1） */
  mod: number
  /** 如 "燃狱齿轮 R3"（悬停/明细表展示用；限定为 "焰心桂冠 R1（限定）"） */
  label: string
  /** 是否限定音擎（选中即按本体如实计入总限定金） */
  limited: boolean
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
 * 在候选装填池内逐个试算全队伤害取最高者，按默认精炼穿戴（A 级默认 5、常驻默认 3，
 * 经 options.autoEngineMods 调整）。逐槽贪心、顺序提交：后一槽的试算在前一槽已定的基础上进行。
 * 候选池缺省 = DEFAULT_AUTO_ENGINE_POOL（用户准信五件），页面装填框可增删；
 * 池内未知 id 过滤；**限定音擎可选**——按本体（精炼1）参与择优，选中由调用方如实计金。
 * **不做全目录遍历。**
 * 音擎被动带专精要求 → 试算天然只让匹配角色吃满；击破系等低收益音擎可能落选（按伤害择优的预期行为）。
 * 调用方须已应用 boss/buff（择优从真实场景出发）；池为空返回 []。
 * 计算量：池大小 × 有角色槽位数（≤3）次全量伤害，每队一次。
 */
export function computeAutoEnginePicks(
  calc: Calc,
  configStore: ReturnType<typeof useConfigStore>,
  preset: TeamPreset,
  options: Pick<TeamCompareOptions, 'autoEngineMods' | 'autoEnginePool'> = {},
): AutoEnginePick[] {
  const catalog = useCatalogStore()
  const requested = options.autoEnginePool ?? []
  const byId = new Map((catalog.displayWEngines ?? []).map(w => [w.id, w]))
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
  /** 每槽取池优先级：bySlot[slot] > byAgent[该槽角色] > 整队 pool/poolRef > 页面装填框 > 默认五件 */
  const resolveSlotPool = (slot: number): string[] => {
    for (const layer of [cfg?.bySlot?.[String(slot)], preset.team[slot] ? cfg?.byAgent?.[preset.team[slot]] : undefined]) {
      const ids = layerIds(layer)
      if (ids.length > 0) return ids
    }
    const top = layerIds(cfg)
    if (top.length > 0) return top
    return requested.length > 0 ? requested : DEFAULT_AUTO_ENGINE_POOL
  }
  // 精炼档：preset.mods 覆盖页面输入；A 级默认 5 不变，常驻 S 可调（缺省 3）
  const aMod = clampMod(cfg?.mods?.aRank ?? options.autoEngineMods?.aRank, 5)
  const stdMod = clampMod(cfg?.mods?.standard ?? options.autoEngineMods?.standard, 3)
  const picks: AutoEnginePick[] = []
  for (let slot = 0; slot < 3; slot++) {
    if (!preset.team[slot]) continue
    const pool = toWengines(resolveSlotPool(slot))
    if (pool.length === 0) continue
    // 基础音擎只认预设声明（与 baseGoldOf 同源）：setAgent 会给角色自动推荐专属音擎，
    // 回读 store 会把「预设没声明的限定专武」误当成已持有物而跳过替换
    const baseId = preset.wEngines?.[slot] ?? ''
    if (isLimitedWEngine(baseId)) continue
    let best: { id: string; mod: number; label: string; damage: number } | null = null
    for (const w of pool) {
      // 限定候选按本体（精炼1）试算：下位拿限定 = 只买本体 1 金，不预设精炼投入
      const mod = isLimitedWEngine(w.id) ? 1 : w.rarity === 'A' ? aMod : stdMod
      configStore.setWEngine(slot, w.id)
      configStore.setWEngineModLevel(slot, mod)
      const damage = calc.teamTotalDamage.value
      if (!best || damage > best.damage) {
        const limited = isLimitedWEngine(w.id)
        best = { id: w.id, mod, label: `${w.name.zhCN ?? w.name.en ?? w.id} R${mod}${limited ? '（限定）' : ''}`, damage }
      }
    }
    if (best) {
      // 提交最优并留在 store：下一槽的试算场景包含本槽结果
      configStore.setWEngine(slot, best.id)
      configStore.setWEngineModLevel(slot, best.mod)
      picks.push({ slot, id: best.id, mod: best.mod, label: best.label, limited: isLimitedWEngine(best.id) })
    }
  }
  return picks
}

// ========== 最优加金（≤ GOLD_OPTIMIZE_CAP 金） ==========

/** 最优加金的封顶总限定金（用户口径：12 金 = 全队 2命1精前用自动计算，之后按预设顺序） */
export const GOLD_OPTIMIZE_CAP = 12

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
 * 最优加金分配：在预设 goldSteps 定义的可用步骤里，逐金做贪婪搜索。
 * 每金档试算所有「下一个可用级别」（每槽位影画/精炼各一 + 音擎本体获取各一，只列作者写过的级别），
 * 提交伤害提升最大的那个——忽略作者手排顺序，自动优先选优质金。
 * 音擎获取：槽位当前带非限定音擎（常驻/A/空）时，可花 1 金装备作者声明的限定音擎本体（通常 = 专武）；
 * 精炼候选只对已带限定音擎的槽位开放，且换装后该槽位精炼从 1 重算（旧音擎的常驻精炼不虚标到新专武）。
 * 这样低金档（如 4 限金 = 3 角色 + 1 专武）也能被正确表达。
 * 口径：候选只来自 preset.goldSteps（尊重作者设定的音擎/命座/精炼范围）；standardSteps 全量应用（不占金）；
 * autoPicks（自动下位择优）覆盖 standardSteps 之后的非限定音擎槽位；
 * 每步同场景对比（boss/buff 已由调用方应用，只变这一级）。
 * 计算量：每金档 × 候选数（≤ 9）次全量伤害，封顶 12 金内最多 ~100 次/队。
 * 调用方须已 applyTeamToStore 并应用 boss/buff；结果按 totalGold 升序（含 base 档）。
 */
export function computeOptimalGoldAllocations(
  calc: Calc,
  configStore: ReturnType<typeof useConfigStore>,
  preset: TeamPreset,
  baseGold: number,
  autoPicks: AutoEnginePick[] = [],
): OptimalGoldAllocation[] {
  // 音擎获取候选：每个槽位第一条带 wEngineId 的 wengine 步（作者声明的升级音擎，通常 = 专武本体）
  const acquireBySlot = new Map<number, { id: string; label: string }>()
  // 影画/精炼候选：goldSteps 按 (slot, kind) 去重，级别升序（同 key 同值只留一份；获取步排除）
  const stepsByKey = new Map<string, { values: number[]; labelOf: Map<number, string> }>()
  for (const s of preset.goldSteps) {
    if (s.kind === 'wengine' && s.wEngineId) {
      if (!acquireBySlot.has(s.slot)) acquireBySlot.set(s.slot, { id: s.wEngineId, label: s.label })
      continue
    }
    const key = `${s.slot}:${s.kind}`
    let entry = stepsByKey.get(key)
    if (!entry) {
      entry = { values: [], labelOf: new Map() }
      stepsByKey.set(key, entry)
    }
    entry.values.push(s.value)
    entry.labelOf.set(s.value, s.label)
  }
  for (const e of stepsByKey.values()) e.values.sort((a, b) => a - b)

  const cinemas: [number, number, number] = [0, 0, 0]
  const wengineMods: [number, number, number] = [1, 1, 1]
  // 基础音擎只认预设声明（与 baseGoldOf 同源）：不回读 store——setAgent 的自动推荐专武
  // 不是持有物，泄漏进来会让下位替换被跳过、伤害虚高
  const wEngines: [string, string, string] = [
    preset.wEngines?.[0] ?? '',
    preset.wEngines?.[1] ?? '',
    preset.wEngines?.[2] ?? '',
  ]
  // 常驻配置（不占限定金，全量应用；含常驻音擎换装）
  for (const s of preset.standardSteps ?? []) {
    if (s.kind === 'cinema') cinemas[s.slot] = Math.max(cinemas[s.slot], s.value)
    else if (s.kind === 'wengine' && s.wEngineId) wEngines[s.slot] = s.wEngineId
    else wengineMods[s.slot] = Math.max(wengineMods[s.slot], s.value)
  }
  // 自动下位：非限定槽位换成装填池择优结果（覆盖 standardSteps 写入的常驻/A 音擎）；
  // 生效的限定下位按本体如实计入总限定金（有金就是金）
  const baseAutoLimited = substituteAutoEngines(wEngines, wengineMods, autoPicks)
  const autoLimitedNow = () => countLimitedAutoApplied(wEngines, autoPicks, acquiredSlots)
  const applyState = (c: number[], m: number[], w: string[]) => {
    for (let i = 0; i < 3; i++) {
      configStore.setCinemaLevel(i, c[i])
      configStore.setWEngineModLevel(i, m[i])
      if (w[i]) configStore.setWEngine(i, w[i])
    }
  }
  applyState(cinemas, wengineMods, wEngines)

  const allocations: OptimalGoldAllocation[] = [{
    totalGold: baseGold + baseAutoLimited,
    budgetGold: baseGold,
    cinemas: [...cinemas] as [number, number, number],
    wengineMods: [...wengineMods] as [number, number, number],
    wEngines: [...wEngines] as [string, string, string],
    label: `${baseGold + baseAutoLimited}金（基础${baseAutoLimited ? `，含下位限定 ${baseAutoLimited} 金` : ''}）`,
    damage: calc.teamTotalDamage.value,
  }]

  const taken: { label: string }[] = []
  const acquiredSlots = new Set<number>()
  while (true) {
    const nextGold = baseGold + taken.length + 1
    if (nextGold > GOLD_OPTIMIZE_CAP) break
    let best: {
      slot: number
      kind: 'cinema' | 'wengine' | 'acquire'
      value: number
      id?: string
      label: string
      damage: number
    } | null = null
    // 自动下位穿上的限定件不阻止购买步：购买同一/另一把都合法，金数经 acquiredSlots 去重
    const autoLimitedSlots = new Set(autoPicks.filter(p => p.limited).map(p => p.slot))
    // 候选1：音擎获取（槽位当前非限定音擎、或限定件只是自动下位穿的 → 装备作者声明的限定音擎本体，1 金）
    for (const [slot, acq] of acquireBySlot) {
      if (isLimitedWEngine(wEngines[slot]) && !autoLimitedSlots.has(slot)) continue
      const prevId = wEngines[slot]
      const prevMod = wengineMods[slot]
      configStore.setWEngine(slot, acq.id)
      configStore.setWEngineModLevel(slot, 1)
      const dmg = calc.teamTotalDamage.value
      if (best == null || dmg > best.damage) {
        best = { slot, kind: 'acquire', value: 1, id: acq.id, label: acq.label, damage: dmg }
      }
      configStore.setWEngine(slot, prevId)
      configStore.setWEngineModLevel(slot, prevMod)
    }
    // 候选2：影画 / 精炼（精炼仅当槽位已带限定音擎）
    for (const [key, entry] of stepsByKey) {
      const [slotStr, kind] = key.split(':') as [string, 'cinema' | 'wengine']
      const slot = Number(slotStr)
      if (kind === 'wengine' && !isLimitedWEngine(wEngines[slot])) continue
      const current = kind === 'cinema' ? cinemas[slot] : wengineMods[slot]
      const next = entry.values.find(v => v > current)
      if (next == null) continue
      // 试算候选（同场景对比：只变这一级）
      if (kind === 'cinema') configStore.setCinemaLevel(slot, next)
      else configStore.setWEngineModLevel(slot, next)
      const dmg = calc.teamTotalDamage.value
      if (best == null || dmg > best.damage) {
        best = {
          slot, kind, value: next,
          label: entry.labelOf.get(next) ?? `${kind === 'cinema' ? '影画' : '精炼'}${next}`,
          damage: dmg,
        }
      }
      if (kind === 'cinema') configStore.setCinemaLevel(slot, current)
      else configStore.setWEngineModLevel(slot, current)
    }
    if (!best) break // 无更多候选（或已到 12 金）
    // 提交最佳候选
    if (best.kind === 'acquire') {
      acquiredSlots.add(best.slot)
      wEngines[best.slot] = best.id!
      wengineMods[best.slot] = 1 // 换装即回精炼1：旧基础音擎的常驻精炼不残留到新专武
      configStore.setWEngine(best.slot, best.id!)
      configStore.setWEngineModLevel(best.slot, 1)
    } else if (best.kind === 'cinema') {
      cinemas[best.slot] = best.value
      configStore.setCinemaLevel(best.slot, best.value)
    } else {
      wengineMods[best.slot] = best.value
      configStore.setWEngineModLevel(best.slot, best.value)
    }
    taken.push(best)
    // 总金如实：预算金 + 仍穿在身上的限定下位（买专武可能顶掉下位限定 → 总金不变但结构更优）
    const autoLimitedNowN = autoLimitedNow()
    allocations.push({
      totalGold: nextGold + autoLimitedNowN,
      budgetGold: nextGold,
      cinemas: [...cinemas] as [number, number, number],
      wengineMods: [...wengineMods] as [number, number, number],
      wEngines: [...wEngines] as [string, string, string],
      label: `${nextGold + autoLimitedNowN}金（最优）${autoLimitedNowN ? `（含下位限定 ${autoLimitedNowN} 金）` : ''}：${taken.map(t => t.label).join(' + ')}`,
      damage: best.damage,
    })
  }
  return allocations
}

// ========== 现场快照 / 恢复 ==========

interface StoreSnapshot {
  team: CharacterConfig[]
  enemy: EnemyConfig
  appliedBoss: ReturnType<typeof useConfigStore>['appliedBoss']
  stunAxes: unknown[]
  stunAxisPlans: unknown[]
  useStunAxis: boolean
  globalBuffs: unknown[]
}

function snapshotStore(configStore: ReturnType<typeof useConfigStore>): StoreSnapshot {
  return {
    team: JSON.parse(JSON.stringify(configStore.team)),
    enemy: JSON.parse(JSON.stringify(configStore.enemy)),
    appliedBoss: configStore.appliedBoss,
    stunAxes: JSON.parse(JSON.stringify(configStore.stunAxes)),
    stunAxisPlans: JSON.parse(JSON.stringify(configStore.stunAxisPlans)),
    useStunAxis: configStore.useStunAxis,
    globalBuffs: JSON.parse(JSON.stringify(configStore.globalBuffs)),
  }
}

function restoreStore(configStore: ReturnType<typeof useConfigStore>, snap: StoreSnapshot) {
  configStore.team.splice(0, configStore.team.length, ...snap.team)
  configStore.setEnemy(snap.enemy)
  configStore.appliedBoss = snap.appliedBoss
  configStore.stunAxes.splice(0, configStore.stunAxes.length, ...(snap.stunAxes as never[]))
  configStore.stunAxisPlans.splice(0, configStore.stunAxisPlans.length, ...(snap.stunAxisPlans as never[]))
  configStore.useStunAxis = snap.useStunAxis
  configStore.globalBuffs.splice(0, configStore.globalBuffs.length, ...(snap.globalBuffs as never[]))
}

// ========== 应用到 store ==========

/** 把 buff 牌写进全局 Buff 表（快照/恢复负责清理） */
function applyBuffToStore(configStore: ReturnType<typeof useConfigStore>, card: PhaseBuffCard | null, preset: TeamPreset) {
  const rows = (card?.effects ?? [])
    .map(e => resolveBuffEffect(e, preset))
    .filter((e): e is PhaseBuffEffect => e !== null)
    .map((e, i) => ({
      id: `phase-buff:${card!.title}:${i}`,
      name: card!.title,
      stat: e.stat,
      value: e.value,
      enabled: true,
      targetSkillType: (e.targetSkillType ?? 'all') as SkillDamageTarget,
    }))
  configStore.globalBuffs.splice(0, configStore.globalBuffs.length, ...rows)
}

/**
 * 自动推荐：对每张可用牌（非 testOnly）应用后算一次伤害，取最高者。
 * 用第一个金数档位做推荐（buff 选择对队伍而言跨金档基本稳定）。
 */
function pickBestBuff(
  calc: Calc,
  configStore: ReturnType<typeof useConfigStore>,
  preset: TeamPreset,
  options: TeamCompareOptions,
): PhaseBuffCard | null {
  const cards = (options.buffs ?? []).filter(b => !b.testOnly)
  if (cards.length === 0) return null
  let best: PhaseBuffCard | null = null
  let bestDmg = -1
  for (const card of cards) {
    applyBuffToStore(configStore, card, preset)
    const dmg = calc.teamTotalDamage.value
    if (dmg > bestDmg) {
      bestDmg = dmg
      best = card
    }
  }
  return best
}

/** 换人 + 音擎 + 驱动盘 + 连携/平A 权重 + 交互参数（队伍级，每 preset 一次） */
function applyTeamToStore(configStore: ReturnType<typeof useConfigStore>, preset: TeamPreset) {
  for (let slot = 0; slot < 3; slot++) {
    configStore.setAgent(slot, preset.team[slot])
    if (preset.wEngines?.[slot]) configStore.setWEngine(slot, preset.wEngines[slot])
    const dd = preset.driveDiscs?.[slot]
    if (dd) {
      if (dd.fourPieceSetId) configStore.setFourPieceSet(slot, dd.fourPieceSetId)
      if (dd.twoPieceSetId) configStore.setTwoPieceSet(slot, dd.twoPieceSetId)
      for (const [pos, stat] of Object.entries(dd.mainStats ?? {})) {
        configStore.setMainStat(slot, Number(pos) as 4 | 5 | 6, stat)
      }
    }
    if (preset.chainCountPerStun) configStore.setChainCountPerStun(slot, preset.chainCountPerStun[slot])
    if (preset.basicAttackTimeWeight) configStore.setBasicAttackTimeWeight(slot, preset.basicAttackTimeWeight[slot])
  }
  // 内置交互类型 → 对应角色字段（条目 slot 缺省 0；角色专属类型只进难度，不映射引擎参数）
  for (const it of preset.interactions) {
    const slot = it.slot ?? 0
    if (it.type === 'parry') configStore.setParryCount(slot, it.count)
    else if (it.type === 'dodge') configStore.setDodgeCounterCount(slot, it.count)
    else if (it.type === 'quickAssist') configStore.setQuickAssistCount(slot, it.count)
    else if (it.type === 'block') configStore.setBlockCount(slot, it.count)
    else if (it.type === 'tauntCancel') configStore.setTauntCancelCount(slot, it.count) // 般岳：嘲讽取消失衡外连段后摇
  }
}

function applyGoldToStore(
  configStore: ReturnType<typeof useConfigStore>,
  preset: TeamPreset,
  targetTotalGold: number,
  autoPicks: AutoEnginePick[] = [],
) {
  const applied = applyGoldSteps(
    preset.goldSteps,
    targetTotalGold,
    baseGoldOf(preset),
    preset.standardSteps ?? [],
    preset.wEngines ?? [],
  )
  const { cinemas, wengineMods, wEngines } = applied
  // 被预算步购买过音擎的槽位（其金已在预算内，避免下位限定双算）
  const acquiredSlots = new Set(
    preset.goldSteps.slice(0, applied.stepsApplied)
      .filter(s => s.kind === 'wengine' && s.wEngineId)
      .map(s => s.slot),
  )
  // 自动下位：最终非限定的槽位换成装填池择优结果（已买到限定专武的槽位不动）
  substituteAutoEngines(wEngines, wengineMods, autoPicks, acquiredSlots)
  for (let slot = 0; slot < 3; slot++) {
    configStore.setCinemaLevel(slot, cinemas[slot])
    configStore.setWEngineModLevel(slot, wengineMods[slot])
    if (wEngines[slot]) configStore.setWEngine(slot, wEngines[slot])
  }
}

/**
 * 难度变体的轴绑定：preset.stunAxisPresetId 指向 stunAxisPresets 里的预设时，
 * 对比计算用该轴（固定 axes → 写 stunAxes；条件 plans → 写 stunAxisPlans，二者互斥防遮蔽），
 * 保证「普通轴 / 5嗔火10大」等难度档各自算各自的轴，不受用户当前手动轴干扰。
 * 未绑定 / 预设 id 不存在 → 恢复快照轴状态（自动匹配 / 用户轴，与旧口径一致）。
 * 每队先恢复快照，同一次批量计算内各队轴状态互相隔离。
 */
export function applyAxisBinding(
  configStore: ReturnType<typeof useConfigStore>,
  snap: Pick<StoreSnapshot, 'stunAxes' | 'stunAxisPlans' | 'useStunAxis'>,
  preset: TeamPreset,
): boolean {
  configStore.stunAxes.splice(0, configStore.stunAxes.length, ...(JSON.parse(JSON.stringify(snap.stunAxes)) as never[]))
  configStore.stunAxisPlans.splice(0, configStore.stunAxisPlans.length, ...(JSON.parse(JSON.stringify(snap.stunAxisPlans)) as never[]))
  configStore.useStunAxis = snap.useStunAxis
  if (!preset.stunAxisPresetId) return false
  const axisPreset = stunAxisPresets.find(p => p.id === preset.stunAxisPresetId)
  if (!axisPreset) return false
  // 两条手动轴路径互斥清空，再写入绑定的那条（resolveAxes 优先级：plans > stunAxes > 自动）
  configStore.stunAxes.splice(0, configStore.stunAxes.length)
  configStore.stunAxisPlans.splice(0, configStore.stunAxisPlans.length)
  if (axisPreset.plans && axisPreset.plans.length > 0) {
    configStore.stunAxisPlans.splice(0, 0, ...(JSON.parse(JSON.stringify(axisPreset.plans)) as never[]))
  } else if (axisPreset.axes && axisPreset.axes.length > 0) {
    configStore.stunAxes.splice(0, 0, ...cloneStunAxes(axisPreset.axes))
  } else {
    return false
  }
  configStore.useStunAxis = true
  return true
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
  if (rr?.convergence?.axisFallback) notes.push('轴需求超出时间预算，已退化为一般轴')
  const scale = rr?.convergence?.interactionScale
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
export function computeTeamComparePoints(calc: Calc, options: TeamCompareOptions): TeamComparePoint[] {
  const configStore = useConfigStore()
  const snap = snapshotStore(configStore)
  const points: TeamComparePoint[] = []
  try {
    for (const preset of options.presets) {
      applyTeamToStore(configStore, preset)
      // 难度变体轴绑定（未绑定 = 恢复快照轴状态，走自动匹配/用户轴）
      applyAxisBinding(configStore, snap, preset)
      // 最优加金模式：先把队伍置于基础金分配（基础音擎 + 0命1精 + standardSteps），buff 推荐与贪婪搜索从同一起点
      if (options.optimalGold) {
        const b0 = baseGoldOf(preset)
        const baseAlloc = applyGoldSteps(preset.goldSteps, b0, b0, preset.standardSteps ?? [], preset.wEngines ?? [])
        for (let slot = 0; slot < 3; slot++) {
          configStore.setCinemaLevel(slot, baseAlloc.cinemas[slot])
          configStore.setWEngineModLevel(slot, baseAlloc.wengineMods[slot])
          if (baseAlloc.wEngines[slot]) configStore.setWEngine(slot, baseAlloc.wEngines[slot])
        }
      }
      const baseGold = baseGoldOf(preset)
      // boss 一次应用（与金数档无关）；必须在选 buff 前应用，推荐排序才基于所选期数的敌人配置
      configStore.applyBossPreset(
        { id: options.boss.id },
        options.phase,
        options.boss.monster,
        options.boss.defaults,
      )
      // 选 buff：手动指定 > 每队自动取三张牌伤害最高（用第一个金数档推荐）
      let chosen: PhaseBuffCard | null = null
      if (options.manualBuffTitle) {
        chosen = (options.buffs ?? []).find(b => b.title === options.manualBuffTitle) ?? null
      } else {
        chosen = pickBestBuff(calc, configStore, preset, options)
      }
      applyBuffToStore(configStore, chosen, preset)
      // 自动下位音擎（缺省开）：boss/buff 已应用，从真实场景出发在装填池内择优；每队一次
      const autoPicks = options.autoEngine === false
        ? []
        : computeAutoEnginePicks(calc, configStore, preset, options)
      // 最优加金：预计算 ≤12 金各档的最优分配（含伤害，避免点循环里重算）
      const optimalMap = new Map<number, OptimalGoldAllocation>()
      if (options.optimalGold) {
        for (const a of computeOptimalGoldAllocations(calc, configStore, preset, baseGold, autoPicks)) {
          optimalMap.set(a.budgetGold, a) // 预算域键：resolveGoldLevel 的钳制口径不含限定下位附加
        }
      }
      const seen = new Set<number>()
      for (const gold of options.goldLevels) {
        // 难度门槛：低于该难度要求的最低总限定金不生成点（如 5嗔火10大 需琉音配置足够高）
        if (gold < (preset.minGold ?? 0)) continue
        // 目标限定金越界时钳制到最近档位；同一队伍同一钳制结果只出一个点
        const { totalGold } = resolveGoldLevel(preset.goldSteps, gold, baseGold)
        if (seen.has(totalGold)) continue
        seen.add(totalGold)
        const opt = optimalMap.get(totalGold)
        if (opt) {
          for (let slot = 0; slot < 3; slot++) {
            configStore.setCinemaLevel(slot, opt.cinemas[slot])
            configStore.setWEngineModLevel(slot, opt.wengineMods[slot])
            if (opt.wEngines[slot]) configStore.setWEngine(slot, opt.wEngines[slot])
          }
        } else {
          applyGoldToStore(configStore, preset, gold, autoPicks)
        }
        const damage = opt ? opt.damage : calc.teamTotalDamage.value
        // 时间可行性校验：从引擎资源结果取精确动作总时间
        const invTime = configStore.enemy.invincibleTime ?? 0
        const battleTime = configStore.enemy.battleTime ?? 180
        const { timeExceeded, timeDetail } = actionTimeTotal(calc, invTime, battleTime)
        const { difficulty, detail } = computeDifficulty(preset.interactions, preset.team)
        const std = preset.standardSteps ?? []
        let cinemas: [number, number, number]
        let wengineMods: [number, number, number]
        let label: string
        let standardLabel: string
        // 自动下位中「仍穿在身上」的限定件数：有金就是金，按本体各计 1 金入总限定金
        let autoLimitedGold = 0
        if (opt) {
          cinemas = opt.cinemas
          wengineMods = opt.wengineMods
          label = opt.label
          autoLimitedGold = Math.max(0, opt.totalGold - totalGold)
          standardLabel = std.length === 0 ? '' : `常驻：${std.map(s => s.label).join(' + ')}`
        } else {
          const r = applyGoldSteps(preset.goldSteps, gold, baseGold, std)
          const acquiredSlots = new Set(
            preset.goldSteps.slice(0, r.stepsApplied)
              .filter(st => st.kind === 'wengine' && st.wEngineId)
              .map(st => st.slot),
          )
          autoLimitedGold = substituteAutoEngines(r.wEngines, r.wengineMods, autoPicks, acquiredSlots)
          cinemas = r.cinemas
          wengineMods = r.wengineMods
          label = r.label
          standardLabel = r.standardLabel
        }
        // 常驻配置行追加自动下位说明（两分支同格式：常驻：…｜自动下位：…｜含下位限定 N 金）
        const autoParts: string[] = []
        if (autoPicks.length > 0) autoParts.push(`自动下位：${autoPicks.map(p => p.label).join('、')}`)
        if (autoLimitedGold > 0) autoParts.push(`含下位限定 ${autoLimitedGold} 金`)
        const autoLabel = autoParts.join('｜')
        const withAuto = (base: string) => [base, autoLabel].filter(Boolean).join('｜')
        standardLabel = withAuto(standardLabel)
        points.push({
          presetId: preset.id,
          presetName: preset.name,
          // 显示用金数 = 总限定金（限定角色本体+限定音擎本体+影画/精炼步+仍穿的限定下位本体）
          goldCount: totalGold + autoLimitedGold,
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
        })
      }
    }
  } finally {
    restoreStore(configStore, snap)
  }
  return points
}
