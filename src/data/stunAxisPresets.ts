/**
 * 预设失衡轴（捏轴预设）
 *
 * 两种录入方式，最终合并到 `stunAxisPresets`：
 * 1. **JSON 文件**（推荐）：在失衡轴页把轴捏好 → 点「导出预设」下载 `<id>.json` →
 *    丢进 `src/data/stunAxisPresets/` 文件夹，构建/刷新后自动加载。
 * 2. **手写 TS**：在下方 `handwrittenPresets` 数组直接追加。
 *
 * 匹配规则：按槽位顺序的 agentId 完全一致才命中（轴内 action.slot 绑定槽位，换位不通用）。
 * 应用时 `cloneStunAxes` 深拷贝到 configStore.stunAxes 并开启 useStunAxis，不污染预设本体。
 *
 * JSON 文件形如（由「导出预设」按钮生成）：
 * {
 *   "id": "qingyi-standard",
 *   "name": "青衣标准轴",
 *   "team": ["1251", "1391", "1241"],
 *   "note": "醉花月云转×2 + 一煞#4 补电压，连携吃满",
 *   "axes": [
 *     { "name": "轴1", "count": 2, "basicFillerSlot": 0,
 *       "actions": [ { "slot": 0, "moveId": "1251008", "count": 1, "startTime": 0 } ] }
 *   ]
 * }
 *
 * 条件轴方案（按资源量自选轴，用 `plans` 取代 `axes`）：
 * {
 *   "id": "yidhari-liuyin-conditional",
 *   "name": "伊琉·按好评自选轴",
 *   "team": ["1051", "1481", "1451"],
 *   "note": "好评≥540 且失衡≥4 时打双转大轴，否则打普通轴",
 *   "plans": [
 *     { "name": "双转大方案",
 *       "when": { "stunMin": 4, "goodReviewMin": 540 },
 *       "axes": [ { "name": "双转大轴", "count": 2, "actions": [ ... ] } ] },
 *     { "name": "普通方案",
 *       "axes": [ { "name": "普通轴", "actions": [ ... ] } ] }
 *   ]
 * }
 * when 支持 stunMin/stunMax（失衡次数）、goodReviewMin/goodReviewMax（好评=摇人值）、
 * energyMin/energyMax（闪能，配合 energySlot 指定槽位，默认 0=主C），全部满足才命中；
 * 按顺序取第一个命中项，最后一条建议无条件兜底。
 * 方案除固定 axes 外，还支持「按资源溢出逐窗升级」的自动分配（split + algorithm 名）：
 * - algorithm: 'goodReviewOverflow' → 先全给 base 轴，好评（摇人值）富余再逐窗升级成 upgrade 轴
 *   （好评消耗自动按轴内 promoteVariant 块求和：60转大=60、90转大=90）。
 * - algorithm: 'energyOverflow' → 先全给 base 轴，闪能富余再逐窗升级成 upgrade 轴（cost 需手写）。
 * 读取时按 split.algorithm 名称分发，不按预设名匹配——新轴文件声明同一 algorithm 名即可复用。
 */
import type { StunAxis, StunAxisCondition, StunAxisPlan, StunAxisWindowSplit } from '@/types/resource'

export interface StunAxisPreset {
  /** 唯一 id（英文 kebab） */
  id: string
  /** 展示名 */
  name: string
  /** 队伍：按槽位 0/1/2 的 agentId，须三项齐全；'*' 为通配（如第三槽任意辅助） */
  team: [string, string, string]
  /** 说明/备注 */
  note?: string
  /** 轴列表（无条件固定轴；应用时整组替换用户当前轴） */
  axes?: StunAxis[]
  /** 条件轴方案（按资源量自选轴：命中第一个 when 全满足的方案；最后一条无条件兜底） */
  plans?: StunAxisPlan[]
  /**
   * 章鱼自动轴档位：伊德海莉（1051）影画等级档（0=0命，1=1命及以上）。
   * 仅用于「队伍含伊德海莉 → 自动开启失衡轴并选对应轴」的自动选择；手动应用预设不需要该字段。
   */
  chapter?: number
  /**
   * 保底目标（≥ N，0 = 不保底）：应用/自动命中该预设时自动勾选配装页「保底目标」。
   * - stun：保底 N 次失衡；fury：保底 N 次嗔火（般岳怒相）；ultimate：保底 N 次喧响（终结技）。
   * 如 5火10大 = { stun: 4, fury: 4, ultimate: 4 }（另需琉音好评≥6，见 note）。
   */
  guarantee?: { stun?: number; fury?: number; ultimate?: number }
}

/** 手写预设（可选；也可全用 JSON 文件） */
const handwrittenPresets: StunAxisPreset[] = []

/** 校验 JSON 预设形状，非法文件直接跳过（axes 或 plans 至少其一） */
function isValidPreset(p: unknown): p is StunAxisPreset {
  if (!p || typeof p !== 'object') return false
  const o = p as Partial<StunAxisPreset>
  return typeof o.id === 'string' && o.id.length > 0
    && typeof o.name === 'string'
    && Array.isArray(o.team) && o.team.length === 3 && o.team.every(t => typeof t === 'string' && t.length > 0)
    && (Array.isArray(o.axes) || Array.isArray(o.plans))
}

/** 条件是否命中（when 全部满足才命中） */
function conditionMatches(
  w: StunAxisCondition | undefined,
  state: { stunCount: number; goodReview: number; energyBySlot?: Record<number, number>; cinemaBySlot?: Record<number, number> },
): boolean {
  if (!w) return true
  if (w.stunMin !== undefined && state.stunCount < w.stunMin) return false
  if (w.stunMax !== undefined && state.stunCount > w.stunMax) return false
  if (w.goodReviewMin !== undefined && state.goodReview < w.goodReviewMin) return false
  if (w.goodReviewMax !== undefined && state.goodReview > w.goodReviewMax) return false
  if (w.energyMin !== undefined || w.energyMax !== undefined) {
    const energy = state.energyBySlot?.[w.energySlot ?? 0] ?? 0
    if (w.energyMin !== undefined && energy < w.energyMin) return false
    if (w.energyMax !== undefined && energy > w.energyMax) return false
  }
  if (w.cinemaMin !== undefined || w.cinemaMax !== undefined) {
    const cinema = state.cinemaBySlot?.[w.cinemaSlot ?? 0] ?? 0
    if (w.cinemaMin !== undefined && cinema < w.cinemaMin) return false
    if (w.cinemaMax !== undefined && cinema > w.cinemaMax) return false
  }
  return true
}

/** 单轴每窗好评（摇人值）消耗：60 转大=60 好评、90 转大=90 好评（按 promoteVariant 块求和） */
function goodReviewCostOf(axis: StunAxis): number {
  let cost = 0
  for (const act of axis.actions) {
    if (act.promoteVariant === '60') cost += 60
    else if (act.promoteVariant === '90') cost += 90
  }
  return cost
}

/** 按算法名解析资源与每窗消耗 */
function resolveSplitResource(
  split: StunAxisWindowSplit,
  state: { stunCount: number; goodReview: number; energyBySlot?: Record<number, number> },
): { resource: number; baseCost: number; upgradeCost: number } {
  if (split.algorithm === 'energyOverflow') {
    return {
      resource: state.energyBySlot?.[split.energySlot ?? 0] ?? 0,
      baseCost: split.baseCost ?? 0,
      upgradeCost: split.upgradeCost ?? 0,
    }
  }
  // goodReviewOverflow：好评消耗缺省自动按 promoteVariant 求和
  return {
    resource: Math.max(0, state.goodReview),
    baseCost: split.baseCost ?? goodReviewCostOf(split.baseAxis),
    upgradeCost: split.upgradeCost ?? goodReviewCostOf(split.upgradeAxis),
  }
}

/** 窗口自动分配（按 split.algorithm 分发）：先全给 base 轴，资源溢出再逐窗升级成 upgrade 轴 */
function resolveWindowSplit(
  split: StunAxisWindowSplit,
  state: { stunCount: number; goodReview: number; energyBySlot?: Record<number, number> },
): StunAxis[] {
  const n = Math.max(0, state.stunCount)
  const { resource, baseCost, upgradeCost } = resolveSplitResource(split, state)
  const delta = upgradeCost - baseCost
  // 先全给 base：n 窗 × baseCost；剩余资源按 delta 升级
  const extra = resource - baseCost * n
  const upgradeCount = delta > 0 ? Math.max(0, Math.min(n, Math.floor(extra / delta))) : 0
  const baseCount = n - upgradeCount
  const axes: StunAxis[] = []
  if (upgradeCount > 0) axes.push({ ...cloneStunAxes([split.upgradeAxis])[0], count: upgradeCount })
  if (baseCount > 0) axes.push({ ...cloneStunAxes([split.baseAxis])[0], count: baseCount })
  return axes
}

/** 解析条件轴方案：按顺序取第一个 when 全满足的方案，无命中时取最后一条（无条件兜底）。返回命中方案及其轴 */
export function resolveStunAxisPlan(
  plans: StunAxisPlan[],
  state: { stunCount: number; goodReview: number; energyBySlot?: Record<number, number>; cinemaBySlot?: Record<number, number> },
): { plan: StunAxisPlan; axes: StunAxis[] } | null {
  if (!plans || plans.length === 0) return null
  for (const plan of plans) {
    if (!conditionMatches(plan.when, state)) continue
    if (plan.split) {
      return { plan, axes: resolveWindowSplit(plan.split, state) }
    }
    if (plan.axes) {
      return { plan, axes: cloneStunAxes(plan.axes) }
    }
  }
  // 未命中任何条件方案 → 兜底取最后一条
  const last = plans[plans.length - 1]
  if (last.split) return { plan: last, axes: resolveWindowSplit(last.split, state) }
  return { plan: last, axes: cloneStunAxes(last.axes ?? []) }
}

/** 从 src/data/stunAxisPresets/*.json 自动加载预设 */
const jsonModules = import.meta.glob('./stunAxisPresets/*.json', { eager: true })
const jsonPresets: StunAxisPreset[] = Object.values(jsonModules)
  .map(m => ((m as { default?: unknown }).default ?? m) as unknown)
  .filter(isValidPreset)

/** 预设轴库（手写 + JSON 文件夹） */
export const stunAxisPresets: StunAxisPreset[] = [...handwrittenPresets, ...jsonPresets]

/** 队伍 → 匹配键（槽位顺序敏感） */
export function presetTeamKey(team: (string | undefined | null)[]): string | null {
  if (!team || team.length < 3) return null
  const ids = team.slice(0, 3)
  if (ids.some(id => !id)) return null
  return ids.join('|')
}

/** 按当前队伍（槽位顺序）匹配预设轴；预设 team 中 '*' 为通配（如伊琉体系第三槽任意辅助） */
export function matchStunAxisPresets(
  team: (string | undefined | null)[],
  presets: StunAxisPreset[] = stunAxisPresets,
): StunAxisPreset[] {
  const ids = team.slice(0, 3)
  if (ids.length < 3 || ids.some(id => !id)) return []
  return presets.filter(p =>
    p.team.every((pid, i) => pid === '*' || pid === ids[i]),
  )
}

/**
 * 通用自动失衡轴选择（用户确认口径：所有预设队伍都对应预设失衡轴，捏了轴就自动启用）：
 * - 触发：队伍满 3 人，且启用了自动轴总开关（上层开关）；按槽位通配匹配 `stunAxisPresets`，
 *   命中即自动开启失衡轴并选用该预设（无需手动点「应用」）。队伍没捏轴 = 无匹配 = 不自动。
 * - 章鱼体系：预设带 `chapter` 字段（0章/1章）时按队伍中伊德海莉（1051）影画等级过滤
 *   （0 命 → chapter 0；≥1 命 → chapter 1）；无 chapter 的预设恒可匹配。
 * - 有琉优先：同队命中多个预设时，含琉音（1481）的预设优先（章鱼 0章-琉 vs 0章其他）。
 * - 弱队不服务：如 章鱼(1051)+比利(1531) 双主C 抢资源的队伍，其组合匹配不到任何专用预设时自然不自动
 *   （预设按槽位通配匹配，不会张冠李戴）；含 1051 的队伍由章鱼体系通配预设接管。
 * - 返回 null = 不自动（队伍不完整 / 无匹配预设）。
 */
export function selectAutoStunAxisPreset(
  team: (string | undefined | null)[],
  cinemaBySlot: Record<number, number>,
  presets: StunAxisPreset[] = stunAxisPresets,
): StunAxisPreset | null {
  const ids = team.slice(0, 3)
  if (ids.length < 3 || ids.some(id => !id)) return null
  const matched = presets.filter(p => matchStunAxisPresets(ids, [p]).length > 0)
  if (matched.length === 0) return null
  // 章鱼体系：队伍含伊德海莉 → 按命座过滤 chapter；无 chapter 的预设恒可匹配
  let candidates = matched
  const yidhariSlot = ids.indexOf('1051')
  if (yidhariSlot >= 0) {
    const chapter = (cinemaBySlot[yidhariSlot] ?? 0) >= 1 ? 1 : 0
    const filtered = matched.filter(p => p.chapter === undefined || p.chapter === chapter)
    if (filtered.length > 0) candidates = filtered
  }
  // 有琉优先：同队多预设时含琉音的预设优先（如 0章-琉 vs 0章其他）
  const lukys = candidates.filter(p => p.team.includes('1481'))
  if (lukys.length > 0) candidates = lukys
  // 条件轴优先：同队多预设时选带 plans 的条件轴（一般用途轴）而非固定轴（如般琉通用 vs 5火10大）
  const plans = candidates.filter(p => p.plans && p.plans.length > 0)
  if (plans.length > 0) candidates = plans
  return candidates[0] ?? null
}

/** 深拷贝轴（应用/导出预设时隔离编辑器改动；用 JSON 序列化，兼容 Vue 响应式 Proxy） */
export function cloneStunAxes(axes: StunAxis[]): StunAxis[] {
  return JSON.parse(JSON.stringify(axes))
}

/** 导出前清洗：去掉 UI 便利字段 label，省略默认 startTime=0，保持预设最小化 */
export function normalizeAxesForExport(axes: StunAxis[]): StunAxis[] {
  return cloneStunAxes(axes).map(axis => {
    const clean: StunAxis = { name: axis.name, actions: axis.actions.map(a => {
      const ca: StunAxis['actions'][number] = { slot: a.slot, moveId: a.moveId, count: a.count }
      if (a.startTime && a.startTime !== 0) ca.startTime = a.startTime
      if (a.promoteVariant) ca.promoteVariant = a.promoteVariant
      return ca
    }) }
    if (axis.count !== undefined) clean.count = axis.count
    if (axis.basicFillerSlot !== undefined) clean.basicFillerSlot = axis.basicFillerSlot
    if (axis.entryAnomaly && axis.entryAnomaly > 0) clean.entryAnomaly = axis.entryAnomaly
    const bars = Object.entries(axis.entryBars ?? {}).filter(([, v]) => v > 0)
    if (bars.length > 0) clean.entryBars = Object.fromEntries(bars)
    if (axis.suppressedTriggers && axis.suppressedTriggers.length > 0) clean.suppressedTriggers = [...axis.suppressedTriggers]
    return clean
  })
}
