/**
 * zzz-run-archive 实战记录 → 计算器「一键部署」配置的纯函数导入桥。
 *
 * 背景：归档（https://zzz-run-archive.onrender.com）用 nanoka.cc 的 id 空间，与 catalog.json 完全同源，
 * 因此 agentId / weaponId 可直接落地（无需名称模糊匹配）。归档只含「命座 + 音擎 + 精炼 + 邦布」，
 * 不含驱动盘/技能/面板副词条——这些由计算器默认配装（专武推荐 + 推荐驱动盘 + 最优副词条）兜底，
 * 作为「理论理想配装」上界，与玩家实战分对比时需把配装差异与建模误差分开看待（见 task-ledger）。
 *
 * 阶段 1 只交付纯函数 + 测试，不接 Pinia store/UI（阶段 2）。Boss 匹配返回 presetId；期数相位选择
 * 仍属两级的用户选择（同现有「Boss 选择」页的 版本 + 期数），此处不自动拍板。
 */

/** 归档一条 approved 提交（submissions[].approved 元素的结构化归约）。 */
export interface ArchiveRunMember {
  /** 归档槽位（1-based） */
  slot: number
  agentId: string
  /** 影画/命座 0-6 */
  mindscape: number
  /** 音擎 id（可为空串 = 未填） */
  weaponId?: string
  /** 精炼 1-5 */
  phase?: number
}

export interface ArchiveRun {
  id: string
  mode: string
  seasonId: string
  targetId: string
  targetLabel?: string
  authorName?: string
  videoUrl?: string
  bangbooId?: string
  score: number
  timeSeconds: number
  bossKilled: boolean
  primaryAgentId?: string
  submittedAt?: string
  team: ArchiveRunMember[]
}

/** 归档房间/关卡（bootstrap database.seasons[].rooms[]）。 */
export interface ArchiveRoom {
  id: string
  bossName?: string
  bossNameZh?: string
  primaryEnemy?: string
  primaryEnemyZh?: string
  weaknesses?: string[]
  resistances?: string[]
  hpTotal?: string
}

/** boss-presets.json 里匹配所需的最小子集（不必引完整资源类型）。 */
export interface BossPhaseEntry {
  /** 期相位 id（如 "69043" / "690431"；仅作阶段2 在 boss.phases 里定位的 key，不参与匹配判断） */
  phaseId: string
  /** 期开始时间（京时无时区，如 "2026-08-14 04:00:00"） */
  begin?: string
}

export interface BossPresetEntry {
  id: string
  name?: string
  nameEn?: string
  aliases?: string[]
  phases?: BossPhaseEntry[]
}

/** 单个部署槽位（0-based，与 configStore CharacterConfig.slot 对齐）。 */
export interface DeployTeamSlot {
  slot: number
  /** '' = 空槽 */
  agentId: string
  cinemaLevel: number
  /** null = 走 setAgent 的自动推荐音擎 */
  wEngineId: string | null
  wEngineModLevel: number
}

export interface BossMatch {
  presetId: string
  name: string
  /** 期相位 id（按赛季开始日对齐）；null = 该 Boss 无覆盖该期的阶段数据（血量/buff 会偏） */
  phaseId: string | null
}

export interface DeployConfig {
  /** 计算器能否建模该模式（当前仅危局强袭 Deadly Assault*，多波防卫战/歼灭不支持） */
  supported: boolean
  mode: string
  team: [DeployTeamSlot, DeployTeamSlot, DeployTeamSlot]
  boss: BossMatch | null
  warnings: string[]
}

/** 支持的模式前缀：Deadly Assault 与 Deadly Assault: Adversity Mode（危局·困难异构）都可落 Boss 预设。 */
export const SUPPORTED_MODE_PREFIX = 'Deadly Assault'

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.max(min, Math.min(max, n))
}

/** 归一化：小写 + 去标点/空白，保留 CJK 与字母数字（别名匹配用）。 */
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

/** 取 preset 的候选名表（去空、去重）。 */
function presetNames(p: BossPresetEntry): string[] {
  const raw = [p.name, p.nameEn, ...(p.aliases ?? [])]
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of raw) {
    if (!n) continue
    const nn = normName(n)
    if (nn && !seen.has(nn)) {
      seen.add(nn)
      out.push(nn)
    }
  }
  return out
}

/** 京时 begin（"2026-08-14 04:00:00"）→ UTC 毫秒；解析失败返回 NaN。 */
function phaseBeginUtc(begin: string | undefined): number {
  if (!begin) return NaN
  const iso = begin.includes('T') ? begin : begin.replace(' ', 'T')
  return Date.parse(`${iso}+08:00`)
}

/**
 * 期相位匹配：在 Boss 的 phases 里按「赛季开始日」找对应期（纯日期对齐，phaseId 格式不作判断依据）。
 * 规则：phase.begin（京时，游戏时区）转 UTC 后，取 begin_utc ≤ seasonStartUtc 的最近一期。
 * 归档 season.start 是 UTC、boss-presets begin 是京时，两者差 8h；≤ 最近期对齐能同时纠正归档期号偏差（如归档 "690361" vs 相位 "69036"）。
 */
export function matchBossPhase(
  phases: BossPhaseEntry[] | undefined,
  seasonStartUtc: string | undefined,
): string | null {
  if (!phases?.length) return null
  const startMs = seasonStartUtc ? Date.parse(seasonStartUtc) : NaN
  if (Number.isNaN(startMs)) return null
  let best: { phaseId: string; beginMs: number } | null = null
  for (const p of phases) {
    const bMs = phaseBeginUtc(p.begin)
    if (Number.isNaN(bMs)) continue
    if (bMs <= startMs && (!best || bMs > best.beginMs)) best = { phaseId: p.phaseId, beginMs: bMs }
  }
  return best?.phaseId ?? null
}

/** 按名字匹配预设（精确优先、最长别名包含兜底），返回命中的 preset 或 null。 */
function matchPresetByName(room: ArchiveRoom | undefined, bossPresets: BossPresetEntry[]): BossPresetEntry | null {
  if (!room) return null
  const candidates = [room.bossNameZh, room.primaryEnemyZh, room.bossName, room.primaryEnemy]
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .map(normName)
    .filter(Boolean)

  // 1) 精确匹配
  for (const cand of candidates) {
    for (const p of bossPresets) {
      if (presetNames(p).includes(cand)) return p
    }
  }
  // 2) 包含匹配：取最长命中名（最具体）
  let best: { p: BossPresetEntry; len: number } | null = null
  for (const cand of candidates) {
    for (const p of bossPresets) {
      for (const n of presetNames(p)) {
        if (cand.includes(n) || n.includes(cand)) {
          if (!best || n.length > best.len) best = { p, len: n.length }
        }
      }
    }
  }
  return best?.p ?? null
}

/**
 * 归档房间 → boss-presets 预设匹配（含期相位）。
 * 精确归一匹配优先；未命中时按最长别名包含匹配兜底（更具体的「基塔布鲁·滞变畸兽」胜过「基塔布鲁」）。
 * @param seasonStartUtc 赛季开始时间（UTC ISO），用于期相位对齐；缺省则 phaseId 为 null。
 */
export function matchBossPreset(
  room: ArchiveRoom | undefined,
  bossPresets: BossPresetEntry[],
  seasonStartUtc?: string,
): BossMatch | null {
  const p = matchPresetByName(room, bossPresets)
  if (!p) return null
  return {
    presetId: p.id,
    name: [p.name, p.nameEn, p.id].find((s) => !!s) ?? p.id,
    phaseId: matchBossPhase(p.phases, seasonStartUtc),
  }
}

/** 空槽默认值。 */
function emptySlot(slot: number): DeployTeamSlot {
  return { slot, agentId: '', cinemaLevel: 0, wEngineId: null, wEngineModLevel: 1 }
}

/**
 * 归档提交 → 部署配置（纯函数，无副作用、无 Pinia 依赖）。
 * @param run     单条 approved 提交
 * @param room    该 run.targetId 对应的房间（Boss 名匹配源；缺省则 boss 为 null）
 * @param bossPresets boss-presets.json 的 bosses 数组
 */
export function submissionToDeploy(
  run: ArchiveRun,
  room: ArchiveRoom | undefined,
  bossPresets: BossPresetEntry[],
  seasonStartUtc?: string,
): DeployConfig {
  const warnings: string[] = []
  const mode = run.mode ?? ''
  const supported = mode.startsWith(SUPPORTED_MODE_PREFIX)
  if (!supported) warnings.push(`模式「${mode || '(未知)'}」暂不支持（仅危局强袭）`)

  const slots: DeployTeamSlot[] = [emptySlot(0), emptySlot(1), emptySlot(2)]
  const members = [...(run.team ?? [])].sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99))
  const seen: Record<number, boolean> = {}

  for (const m of members) {
    const idx = clampInt(m.slot, 1, 3, -1) - 1
    if (idx < 0 || seen[idx]) {
      warnings.push(`队员槽位异常或重复 slot=${m.slot}，已忽略`)
      continue
    }
    seen[idx] = true
    const weaponId = typeof m.weaponId === 'string' && m.weaponId.trim() !== '' ? m.weaponId.trim() : null
    if (!weaponId) warnings.push(`槽位 ${idx + 1}（${m.agentId || '?'}）未提供音擎，交由自动推荐`)
    slots[idx] = {
      slot: idx,
      agentId: typeof m.agentId === 'string' ? m.agentId : '',
      cinemaLevel: clampInt(m.mindscape, 0, 6, 0),
      wEngineId: weaponId,
      wEngineModLevel: clampInt(m.phase, 1, 5, 1),
    }
  }

  for (let i = 0; i < 3; i++) {
    if (!slots[i].agentId) warnings.push(`槽位 ${i + 1} 无角色`)
  }

  const boss = matchBossPreset(room, bossPresets, seasonStartUtc)
  if (supported && !boss) {
    const bossLabel = room?.bossNameZh || room?.bossName || room?.id || run.targetId || '(未知)'
    warnings.push(`无对应 Boss 预设（${bossLabel}），需手动选 Boss`)
  } else if (supported && boss && !boss.phaseId) {
    warnings.push(`Boss「${boss.name}」无覆盖该期的相位预设（血量/buff 随期数偏移），需手动选期数`)
  }

  return { supported, mode, team: [slots[0], slots[1], slots[2]], boss, warnings }
}