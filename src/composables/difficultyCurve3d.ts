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
  const defaultSlot = varyingSlots.length > 0
    ? [...varyingSlots].sort((a, b) => distinct[b] - distinct[a] || a - b)[0]!
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
    const idx = resolved as number[]
    const lo = Math.min(...idx)
    const hi = Math.max(...idx)
    for (let i = 0; i < lanes.length; i++) lanes[i]!.frac = hi === lo ? 0.5 : (idx[i]! - lo) / (hi - lo)
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

export interface BossHpOverlayPoint {
  /** 道位置（与 VersionLane.frac 同一坐标） */
  frac: number
  /** 该版本（该模式）的平均血量（绝对值，与 CurveDatum.dmg 同单位） */
  value: number
  version: string
  /** 该版本进入平均的期数（样本极少时页面注明「数据稀疏」） */
  samples: number
}

/**
 * 把「选中 Boss 的血量」对齐到版本道上：按 version 聚合（模式过滤 + 多期平均），用车道 versionIndex 经
 * `versionByIndex`（= VERSION_NODES[idx].version）对上。该 Boss 某版本没上岗 ⇒ 跳过（折线跨空档直连，
 * 样本情况在点上自带，页面在 tooltip/脚注如实注明）。同名角色多支队 ⇒ 同 frac 同值，过两次无妨。
 * 用户口径：在版本×伤害（绝对伤害）空间里画**具体 Boss** 的 HP 膨胀曲线，而不是永远只有一个共享的击杀线平面。
 */
export function buildBossHpOverlay(
  lanes: readonly VersionLane[],
  phases: readonly BossPhaseLike[],
  modeType: string,
  versionByIndex: (nodeIndex: number) => string | null,
): BossHpOverlayPoint[] {
  const buckets = new Map<string, number[]>()
  for (const p of phases) {
    if (p.modeType !== modeType) continue
    const hp = Number(p.hp)
    if (!Number.isFinite(hp) || hp <= 0 || !p.version) continue
    const arr = buckets.get(p.version) ?? []
    arr.push(hp)
    buckets.set(p.version, arr)
  }
  const out: BossHpOverlayPoint[] = []
  for (const lane of lanes) {
    if (lane.versionIndex === null) continue
    const version = versionByIndex(lane.versionIndex)
    if (!version) continue
    const xs = buckets.get(version)
    if (!xs || xs.length === 0) continue
    out.push({
      frac: lane.frac,
      value: xs.reduce((a, b) => a + b, 0) / xs.length,
      version,
      samples: xs.length,
    })
  }
  return out.sort((a, b) => a.frac - b.frac)
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
