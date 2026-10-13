/**
 * 难度曲线 3D（版本轴）的纯逻辑：把「一组预设队伍」变成 3D 图的第三轴——**版本**。
 *
 * 用户口径（2026-09-19）：「难度曲线应该加个三维图，预设队伍中**在变化的那个角色**做默认版本号；如果有多个角色变化，
 * 可以让用户分别显示指定每个队伍的对应版本角色。比如命破队相同主 C 的不同击破手、相同击破手的不同版本主 C。」
 *
 * 规则（纯函数，判据测试在 `__tests__/difficultyCurve3d.test.ts`）：
 *  ① 逐槽位数「不同 agent 的个数」：>1 的槽位 = **在变化的槽位**；
 *  ② 缺省版本槽 = 变化最多（不同 agent 最多）的槽位，并列取靠前的；一个都不变（单队 / 全同）时取槽 0；
 *  ③ 多个槽位在变时 `ambiguous = true`，页面给每队一个「版本角色」选择器，`overrides[presetId] = slot` 逐队覆盖；
 *  ④ 每队一条道（lane）：版本键 = 该队版本槽上的 agentId，道序按 agentId 数值升序（游戏 id 大致 = 发布序）再按队名；
 *     版本标签 = agent 名；同名（同一版本角色出现在多支队）时追加其余两名成员消歧，保证标签唯一。
 *  ⑤ 道**位置**（用户口径 2026-09-19「不是一前一后贴着的，按首次 up 时间留空档」）：经可选的
 *     `releaseIndexOf`（= versionTimeline 的 nodeIndexOf(AGENT_RELEASE_NODE[agentId])）把道位放在
 *     **版本节点序号的真实间距**上（中间空出的节点 = 留白的版本）。全字段解析失败（未收录角色）或
 *     不同节点不足 2 个时回退等距（gapped = false）。
 */

export interface VersionAxisInput {
  presetId: string
  name: string
  team: readonly string[]
}

export interface VersionLane {
  presetId: string
  name: string
  /** 作为版本的槽位（0..2） */
  slot: number
  /** 版本键 = 该槽 agentId */
  agentId: string
  /** 道标签（唯一） */
  label: string
  /** 道序（0 = 最前） */
  y: number
  /** 首次 UP 的版本节点序号（版本时间线表；未收录 → null） */
  versionIndex: number | null
  /** 道位置（0..1）：留空档模式 = 按节点序号的真实间距；回退模式 = 等距 y/(n−1) */
  frac: number
}

export interface VersionAxis {
  lanes: VersionLane[]
  /** 在变化的槽位（不同 agent 数 > 1） */
  varyingSlots: number[]
  /** 缺省版本槽 */
  defaultSlot: number
  /** 多个槽位在变 ⇒ 需要用户按队指定 */
  ambiguous: boolean
  /** 道位是否按版本节点序号留了空档（false = 等距回退） */
  gapped: boolean
}

const SLOTS = [0, 1, 2] as const

function agentIdNumber(id: string): number {
  const n = Number(id)
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY
}

export function deriveVersionAxis(
  teams: readonly VersionAxisInput[],
  overrides: Readonly<Record<string, number>> = {},
  nameOf: (agentId: string) => string = id => id,
  /** 版本节点序号解析（缺省 = 永远回退等距；页面侧喂 versionTimeline 的 nodeIndexOf 复合） */
  releaseIndexOf: (agentId: string) => number | null = () => null,
): VersionAxis {
  const distinct = SLOTS.map(s => new Set(teams.map(t => t.team[s] ?? '')).size)
  const varyingSlots = SLOTS.filter(s => distinct[s] > 1)
  /**
   * 缺省版本槽：变化最多者优先；**并列时优先「版本号解析得出来」的那个槽**。
   *
   * 为什么并列不能只按槽位号取前（2026-10-13 实测）：默认选中的席德两队里槽 1（妮可/希希芙）与
   * 槽 2（希希芙/千夏）各变 2 个 agent，旧口径取槽 1 ⇒ 妮可是四星、`releaseIndexOf` 恒 null ⇒ 全轴
   * 回退等距、血量剖面直接画不出来（页面显示「当前版本道区间里没有血量记录」），而槽 2 两人都有
   * 版本节点（2.7 / 2.6）。**两个槽一样「多变」时，能上版本轴的那个才是有信息量的那个。**
   */
  const resolvedCountOf = (slot: number): number =>
    new Set(teams.map(t => t.team[slot] ?? '').filter(id => id !== '' && releaseIndexOf(id) !== null)).size
  const defaultSlot = varyingSlots.length > 0
    ? [...varyingSlots].sort((a, b) => distinct[b] - distinct[a] || resolvedCountOf(b) - resolvedCountOf(a) || a - b)[0]!
    : 0
  const slotOf = (presetId: string): number => {
    const o = overrides[presetId]
    return o === 0 || o === 1 || o === 2 ? o : defaultSlot
  }
  const raw = teams.map(t => {
    const slot = slotOf(t.presetId)
    const agentId = t.team[slot] ?? ''
    return { presetId: t.presetId, name: t.name, slot, agentId, others: t.team.filter((_, i) => i !== slot) }
  })
  raw.sort((a, b) => agentIdNumber(a.agentId) - agentIdNumber(b.agentId) || a.agentId.localeCompare(b.agentId) || a.name.localeCompare(b.name))
  const labelCount = new Map<string, number>()
  for (const r of raw) labelCount.set(r.agentId, (labelCount.get(r.agentId) ?? 0) + 1)
  const lanes: VersionLane[] = raw.map((r, y) => {
    const base = r.agentId ? nameOf(r.agentId) : '—'
    const dup = (labelCount.get(r.agentId) ?? 0) > 1
    const label = dup ? `${base}（${r.others.filter(Boolean).map(nameOf).join('+') || r.name}）` : base
    return { presetId: r.presetId, name: r.name, slot: r.slot, agentId: r.agentId, label, y, versionIndex: null, frac: 0 }
  })
  // ⑤ 道位：版本节点序号真实间距（留空档）。全解析 + ≥2 个不同节点才启用，否则等距回退。
  for (const lane of lanes) lane.versionIndex = lane.agentId ? releaseIndexOf(lane.agentId) : null
  const resolved = lanes.map(l => l.versionIndex)
  const allResolved = resolved.every(i => i !== null)
  const distinctIdx = new Set(resolved)
  const gapped = lanes.length > 0 && allResolved && distinctIdx.size >= 2
  if (gapped) {
    const lo = Math.min(...resolved)
    const hi = Math.max(...resolved)
    for (let i = 0; i < lanes.length; i++) lanes[i]!.frac = hi === lo ? 0.5 : (resolved[i]! - lo) / (hi - lo)
  } else {
    const n = lanes.length
    for (let i = 0; i < lanes.length; i++) lanes[i]!.frac = n <= 1 ? 0.5 : i / (n - 1)
  }
  return { lanes, varyingSlots, defaultSlot, ambiguous: varyingSlots.length > 1, gapped }
}

// ============ Boss 血量膨胀层（用户口径 2026-09-19②）============

export interface BossPhaseLike {
  version?: string
  hp?: number
  modeType?: string
}

export interface BossHpPoint {
  /** 道位置（与 VersionLane.frac 同一坐标） */
  frac: number
  /** 该版本（该模式）的平均血量（绝对值，与 CurveDatum.dmg 同单位） */
  value: number
  version: string
  /** 该版本进入平均的期数（样本极少时页面注明「数据稀疏」） */
  samples: number
}

/**
 * 版本轴上的血量剖面：横轴 = **道位版本节点的区间**（与 `VersionLane.frac` 同一坐标），
 * 纵轴 = 选中 Boss 在该区间内**每个版本**的平均血量。
 *
 * ⚠ 与旧版 `buildBossHpOverlay`（已删）的差别就是本次修复的要点（用户 2026-10-13 报
 * 「侧视图没能在对应角色的版本编号中表现出选定 boss 在血量膨胀板块的曲线……只在选定版本进行了
 * 单一血量取值」）：旧版**只取道位自己所在的那几个版本** ⇒ 每条道一个孤立点，3D 图里根本连不成
 * 曲线（侧视更是每条道一根竖线）；新版覆盖区间内**全部有记录的版本** ⇒ 侧视（版本 × 伤害）看到的
 * 是一条真正的膨胀曲线，且位置与各道位共用同一 frac 坐标。
 *
 * 口径：
 * - 模式过滤 + 同版本多期取平均（与 `inflationCurve#buildInflationSeries` 同口径，但**不归一化**——
 *   3D 图要的是绝对伤害同尺的绝对血量）；
 * - 区间 = 道位 `versionIndex` 的 [min, max]（全解析失败或不足 2 个不同节点 ⇒ 空数组：没有横轴可言）；
 * - 区间内该 Boss 没上岗的版本 ⇒ 跳过（折线跨空档直连，页面在脚注注明）；
 * - `versionByIndex(i)` 由页面喂 `VERSION_NODES[i].version`（未收录 → null，跳过该节点）。
 */
export function buildBossHpCurve(
  lanes: readonly VersionLane[],
  phases: readonly BossPhaseLike[],
  modeType: string,
  versionByIndex: (nodeIndex: number) => string | null,
): BossHpPoint[] {
  const idxs = lanes.map(l => l.versionIndex).filter((i): i is number => i !== null)
  if (idxs.length < 2) return []
  const lo = Math.min(...idxs)
  const hi = Math.max(...idxs)
  if (hi <= lo) return []
  const buckets = new Map<string, number[]>()
  for (const p of phases) {
    if (p.modeType !== modeType) continue
    const hp = Number(p.hp)
    if (!Number.isFinite(hp) || hp <= 0 || !p.version) continue
    const arr = buckets.get(p.version) ?? []
    arr.push(hp)
    buckets.set(p.version, arr)
  }
  const out: BossHpPoint[] = []
  for (let i = lo; i <= hi; i++) {
    const version = versionByIndex(i)
    if (!version) continue
    const xs = buckets.get(version)
    if (!xs || xs.length === 0) continue
    out.push({
      frac: (i - lo) / (hi - lo),
      value: xs.reduce((a, b) => a + b, 0) / xs.length,
      version,
      samples: xs.length,
    })
  }
  return out
}

/** 期数轴节点（页面喂 `bossSchedule#buildPeriodAxis` 的产物；只取本模块用得到的字段） */
export interface PeriodNodeLike {
  /** 期数 id（phaseId，如 '690421'） */
  id: string
  /** 期数标签（如 '3.1 · 2026-08-14'） */
  label: string
  version: string
  /** 开打日期 YYYY-MM-DD */
  begin: string
}

// ============ 刻度网格（缺省密度，相机可覆盖）============

/** 值域 → 含端点的 n 等分刻度（n ≤ 0 → 空） */
function axisTicks(max: number, n: number): number[] {
  if (n <= 0) return []
  return Array.from({ length: n + 1 }, (_, i) => (i / n) * max)
}

/** 版本道数超过这个数就不再逐道标一行（标签会糊成一片；2D 侧视下由 `versionGridOf` 提密） */
export const LANE_TICK_MAX = 14

/**
 * 版本道刻度（数值 = 道序 `i`，**不是**版本节点序号）。
 *
 * 为什么按道序而不是节点序号：`VersionLane.frac` 本来就是节点序号**归一化后的位置**
 * （`deriveVersionAxis` ⑤），拿节点序号当刻度会与道位对不上（留空档模式下两者并不等距）。
 * 代价是空档回退（`gapped = false`）时读数退化成「第几条道」——与道标签同一套口径。
 */
export function versionGridOf(laneCount: number, opts: { all?: boolean } = {}): number[] {
  const n = Math.max(0, Math.floor(laneCount))
  if (n === 0) return []
  if (opts.all || n <= LANE_TICK_MAX) return Array.from({ length: n }, (_, i) => i)
  const step = Math.ceil(n / LANE_TICK_MAX)
  const out: number[] = []
  for (let i = 0; i < n; i += step) out.push(i)
  if (out[out.length - 1] !== n - 1) out.push(n - 1)
  return out
}

/**
 * z 轴（伤害）刻度值（0..zMax，含端点）。
 *
 * - 缺省 = 「血量% 轴 5 档（zMax ≤ 100）/ 否则 50 一档、最多 6 档」——50 一档是**有意**的：
 *   `ratioMax` 是 50 的整数倍（`difficultyCurve#buildCurveChart`），于是击杀线 100% 正好落在网格上；
 * - `dense`（侧视）= 4 档：用户 2026-10-13「侧视图……作为一个 2D 平面在上面，这不好看」——
 *   侧视（yaw = 90°）下版本轴与 z 轴共面、**视线正对 x** ⇒ 每道退化成一根柱，需把柱线拆细
 *   并叠横向网格才读得出「曲线」。
 */
export function zGridOf(zMax: number, opts: { dense?: boolean } = {}): number[] {
  const max = Math.max(1, zMax)
  const n = opts.dense ? 4 : (max <= 100 ? 5 : Math.min(6, Math.max(2, Math.ceil(max / 50))))
  return axisTicks(max, n)
}

// ============ 3D 投影（正交 + 偏航/俯仰，画布 2D 自绘；与 TeamDamage3DChart 同款做法、不引 WebGL） ============

export interface Camera3D {
  /** 绕竖轴的偏航角（度） */
  yaw: number
  /** 俯仰角（度，0 = 平视、90 = 俯视） */
  pitch: number
  zoom: number
}

export interface Projected {
  sx: number
  sy: number
  /** 深度（越大越远，画家算法排序用） */
  depth: number
}

/**
 * 世界坐标 → 屏幕坐标。世界盒：x（难度）∈[0,1]、y（版本道）∈[0,1]、z（伤害）∈[0,1]，盒心在原点；
 * 屏幕 y 向下。返回的是「单位盒」坐标（±0.5 量级），调用方再乘像素尺寸、加画布中心。
 */
export function project3d(x: number, y: number, z: number, cam: Camera3D, box = { x: 1, y: 0.6, z: 0.6 }): Projected {
  const yaw = (cam.yaw * Math.PI) / 180
  const pitch = (cam.pitch * Math.PI) / 180
  const cx = (x - 0.5) * box.x
  const cy = (y - 0.5) * box.y
  const cz = z * box.z - box.z / 2
  // 绕竖轴（z）偏航
  const hx = cx * Math.cos(yaw) - cy * Math.sin(yaw)
  const d = cx * Math.sin(yaw) + cy * Math.cos(yaw)
  // 俯仰：远处（d 大）往上抬，高处（cz 大）往上抬
  const sy = -(cz * Math.cos(pitch)) - d * Math.sin(pitch)
  const depth = d * Math.cos(pitch) - cz * Math.sin(pitch)
  return { sx: hx * cam.zoom, sy: sy * cam.zoom, depth }
}

// ============ 环境模式的道表（纯逻辑；页面只负责查表喂数据）============

export interface EnvLaneSpec {
  presetId: string
  /** 该道的期 id（也用作 key；一个预设内唯一） */
  periodId: string
}

/**
 * **环境模式的道表**：每条道 =（预设 × 该队版本内的**有选中 Boss 的每一期**）。
 *
 * 用户 2026-10-13 口径（二次回答，逐字）：
 * 「一版本如果有多个期数，你就不用纠结于版本号了，可以直接细分，x 轴从版本变成危局期数……
 *   这样就把每一期的都显示出来了」+「并不是每期一个点，而是**有 boss 的期数才会有点**」
 * +「压力会变成 1-3 倍」（同版本 3 期里该 Boss 通常只上 1~2 期）。
 *
 * ⚠ 只取「首次 UP 落的那一期」是**不够**的（实机踩到）：般岳 4 队全落在 3.2·690471 同一期，
 * 图上完全看不出「期与期的差别」，等于白切版本。故道要覆盖该队版本内的**全部**上岗期。
 *
 * 归期优先级：① 有版本号 ⇒ 该版本内全部期（正常路径；同版本血量相同、**buff 不同**，正是差别来源）
 * ② 只有日期（版本号查不到）⇒ 该日期落的那一期 ③ 都没有 ⇒ 该队不出道（页面如实少一行，不塞假数据）。
 *
 * @param lanes 输入侧的版本道（`deriveVersionAxis` 的产物；提供「该队版本槽是哪个角色」）
 * @param periods 有选中 Boss 的期（按时间升序）
 * @param opts.versionOf 角色 → 实装版本号；`dateOf` 角色 → 首次 UP 日期
 */
export function buildEnvLanes(
  lanes: readonly VersionLane[],
  periods: readonly PeriodNodeLike[],
  opts: { versionOf: (agentId: string) => string | null; dateOf: (agentId: string) => string | null },
): EnvLaneSpec[] {
  const out: EnvLaneSpec[] = []
  if (periods.length === 0) return out
  for (const lane of lanes) {
    if (!lane.agentId) continue
    const release = releaseIndexIn(periods, opts.versionOf(lane.agentId), opts.dateOf(lane.agentId))
    // 该队定位不到实装时点 ⇒ 不出道（页面如实说明，不塞假数据）
    if (release === null) continue
    /**
     * ⚠ **首次 UP 是下界，不是「只在这一版」**（2026-10-13 实机修，用户报「不出图」）。
     *
     * 我最初把「该队版本内的期」当成了道集，于是**队实装版本早于该 Boss 首次上岗时交集为空**：
     * 默认选中的席德队（实装 2.2）配默认 Boss 熔狱行赭（只出现在 3.2/3.3）⇒ 0 条道 ⇒
     * `curveRows` 为空 ⇒ 整张图卡 `v-if` 掉，**页面一片空白且没有任何提示**。
     *
     * 用户原话的正确读法：「对应角色首次 up 日期也好算。这样就把**每一期**的都显示出来了」
     * —— 角色不会过期，从实装那天起、该 Boss 上岗的**每一期**都能打。故道集 =
     * `release` 之后的全部上岗期（上界 = 用户选的期数范围，见页面的头尾选择器）。
     */
    for (let i = release; i < periods.length; i++) out.push({ presetId: lane.presetId, periodId: periods[i]!.id })
  }
  return out
}

/**
 * 该角色在期数轴上的**实装位置**（下标）：首个「不早于其实装」的期。
 * - 有实装日期 ⇒ 首个 `begin >= date` 的期（日期比版本号更准，半月粒度）；
 * - 只有版本号（日期查不到）⇒ 首个 `版本 >= 该版本` 的期（版本号单调递增，可数值比较）；
 * - 都没有 ⇒ null（该队不出道）。
 * 实装早于轴起点 ⇒ 返回 0（从轴首期起全程可用，与 `indexForDate` 的 -1 语义分开表达）。
 */
function releaseIndexIn(
  periods: readonly PeriodNodeLike[],
  version: string | null,
  date: string | null,
): number | null {
  if (date) {
    const d = date.slice(0, 10)
    for (let i = 0; i < periods.length; i++) if (periods[i]!.begin >= d) return i
    return null // 实装晚于轴内全部期（未来角色）⇒ 没有可打的期
  }
  if (version) {
    const v = Number.parseFloat(version)
    if (Number.isFinite(v)) {
      for (let i = 0; i < periods.length; i++) {
        const pv = Number.parseFloat(periods[i]!.version)
        if (Number.isFinite(pv) && pv >= v) return i
      }
      return null
    }
  }
  return null
}
