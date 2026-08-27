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
export interface BossPresetEntry {
  id: string
  name?: string
  nameEn?: string
  aliases?: string[]
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

/**
 * 归档房间 → boss-presets 预设匹配。
 * 精确归一匹配优先；未命中时按最长别名包含匹配兜底（更具体的「基塔布鲁·滞变畸兽」胜过「基塔布鲁」）。
 */
export function matchBossPreset(
  room: ArchiveRoom | undefined,
  bossPresets: BossPresetEntry[],
): BossMatch | null {
  if (!room) return null
  const candidates = [room.bossNameZh, room.primaryEnemyZh, room.bossName, room.primaryEnemy]
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .map(normName)
    .filter(Boolean)

  // 1) 精确匹配
  for (const cand of candidates) {
    for (const p of bossPresets) {
      if (presetNames(p).includes(cand)) {
        return { presetId: p.id, name: [p.name, p.nameEn, p.id].find((s) => !!s) ?? p.id }
      }
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
  if (best) {
    return { presetId: best.p.id, name: [best.p.name, best.p.nameEn, best.p.id].find((s) => !!s) ?? best.p.id }
  }
  return null
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

  const boss = matchBossPreset(room, bossPresets)
  if (supported && !boss) {
    const bossLabel = room?.bossNameZh || room?.bossName || room?.id || run.targetId || '(未知)'
    warnings.push(`无对应 Boss 预设（${bossLabel}），需手动选 Boss`)
  }

  return { supported, mode, team: [slots[0], slots[1], slots[2]], boss, warnings }
}