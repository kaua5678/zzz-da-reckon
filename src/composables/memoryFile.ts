/**
 * 用户记忆文件 · 格式与解析（单一事实源：schema、版本、迁移、净化）。
 *
 * ## 它是什么（用户口径 2026-10-09）
 * 「我希望每个用户有自己的记忆文件，比如他觉得他的某个角色玩的不好，就把这个角色某些数值调低，
 * 这个应该持久记忆。当然，有些不适合持久记忆，比如某些队伍才有的特殊效果，换个队伍就不适用了。
 * 所以这里需要用户修改前决定该修改是否持久。此外保存了记忆后可以恢复默认值或者某个记忆文件。」
 *
 * 落地为**两层**（用户裁决）：
 * - **全局层**（`global`）：跨队伍通用的改动。当前承载 = 队友 buff **覆盖率**（操作手感，换队仍适用）。
 * - **队伍层**（`teams[teamKey]`）：绑定到某支队伍的低成本局部调整。当前承载 = 队友 buff **开关**
 *   （勾选随队伍组成变；同角色换到别队往往不该沿用）。
 * 解析顺序 = **队伍层优先，其次全局层，都没有 = 临时改动**（回落派生默认值，用户明示可接受）。
 *
 * ## 队伍身份 = 成员 agentId 集合，顺序无关（用户裁决）
 * `[主C,击破,辅助]` 换位仍是同一支队伍；与仓库既有口径一致（`data/__tests__/teamPresets.test.ts`
 * 「成员集合（顺序无关）才是队伍身份」）。
 *
 * ## 为什么不用 `persistedRef`
 * `persistedRef` 刻意**不收**「schema 解析 + 错误要上报 UI」的场景（其头注释明写）。
 * 记忆文件需要 **版本号 + 迁移 + 可见报错** ⇒ 参照 `logicEditor/storage.ts` 那一类：
 * 解析失败返回**结构化错误**，由 UI 显示，绝不静默回落（用户会以为记忆丢了）。
 *
 * ## 净化 = 幂等的投影（导出→导入往返幂等的前提）
 * `parseMemory` 不「尽量保留」而是**投影到规范形**：非法项丢弃、数值钳位、键序无关。
 * 于是 `serializeMemory(parseMemory(export(x)).file)` 与 `export(x)` **逐字节相同**
 * （判据：`memoryFile.test.ts::往返幂等`）。JSON 不能表示 `Infinity`/`NaN`/`undefined`
 * （`JSON.stringify` 把它们写成 `null` 或直接丢键）⇒ 净化必须把它们**显式剔除**，
 * 否则同一份记忆两次导入会得到不同结果（`cloneConfigState` 头注释记着同族的坑）。
 *
 * @fact ui:用户记忆/文件格式 决: 记忆文件 = { schemaVersion, savedAt, global, teams }；两层（全局=跨队通用改动，队伍=按成员 id 集合顺序无关索引）；解析顺序队伍层优先其次全局层，两层都无 = 临时改动（回落派生默认）；解析失败必须可见报错不得静默回落；净化是幂等投影 ⇒ 导出→导入往返逐字节相同 | 据 用户@2026-10-09（记忆文件 + 两层 + 队伍身份） | 验 src/composables/__tests__/memoryFile.test.ts | 锚 src/composables/memoryFile.ts#parseMemory + src/composables/memoryFile.ts#teamKeyOf | 信 确认
 */

/** 当前 schema 版本。改结构 ⇒ +1 并在 `MIGRATIONS` 加一步（旧文件必须能读回）。 */
export const MEMORY_SCHEMA_VERSION = 1

/** 当前记忆的 localStorage 键（自动存） */
export const MEMORY_STORAGE_KEY = 'zzz-config-memory:v1'
/** 具名记忆槽的 localStorage 键（「加载某个记忆文件」的本地多份） */
export const MEMORY_SLOTS_KEY = 'zzz-config-memory-slots:v1'
/** 记忆模式开关的 localStorage 键 */
export const MEMORY_RECORDING_KEY = 'zzz-config-memory:recording:v1'

/** 一条队友 buff 的记忆：两个字段各自可缺省（只记用户真改过的那一半，不写「假默认值」） */
export interface BuffMemory {
  enabled?: boolean
  coverage?: number
}

/** 一支队伍的记忆（`label` 仅供展示；身份是它在 `teams` 里的键） */
export interface TeamMemory {
  label: string
  teammateBuffs: Record<string, BuffMemory>
}

/** 全局层（跨队伍通用的改动） */
export interface GlobalMemory {
  teammateBuffs: Record<string, BuffMemory>
}

/** 记忆文件本体 */
export interface MemoryFile {
  schemaVersion: number
  /** ISO 时间串（展示用；不参与身份） */
  savedAt: string
  global: GlobalMemory
  teams: Record<string, TeamMemory>
}

/** 解析结果：成功给 `file`，失败给 `error`（**可见报错**，不是静默回落） */
export type MemoryParseResult =
  | { ok: true; file: MemoryFile; migratedFrom: number | null }
  | { ok: false; error: string }

/**
 * 队伍身份：成员 agentId 去重排序后拼接（**顺序无关**，空队伍 = `''`）。
 * ⚠ 换位（如把辅助挪到槽 0）**不**产生新身份——否则用户只是调了槽序就「记忆全丢」。
 */
export function teamKeyOf(team: ReadonlyArray<{ agentId?: string }>): string {
  const ids = new Set<string>()
  for (const member of team) if (member.agentId) ids.add(member.agentId)
  return [...ids].sort().join('+')
}

/** 队伍展示名（成员中文名按身份键顺序拼接；名字查不到回落 id，不显示空） */
export function teamLabelOf(team: ReadonlyArray<{ agentId?: string }>, nameOf: (agentId: string) => string): string {
  const ids = new Set<string>()
  for (const member of team) if (member.agentId) ids.add(member.agentId)
  return [...ids].sort().map(nameOf).join(' / ')
}

/** 出厂记忆 = 「全为不修改」：两层都空 ⇒ 一切回落派生默认值 */
export function createEmptyMemory(savedAt = new Date().toISOString()): MemoryFile {
  return { schemaVersion: MEMORY_SCHEMA_VERSION, savedAt, global: { teammateBuffs: {} }, teams: {} }
}

// ---------------------------------------------------------------- 净化（幂等投影）

/** 覆盖率合法域（与 store 的钳位口径同源：0..100，非有限值一律丢弃） */
function sanitizeCoverage(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return Math.min(100, Math.max(0, v))
}

/** 一条 buff 记忆的净化：非对象 / 两字段都无效 ⇒ 整条丢弃（返回 null） */
function sanitizeBuffMemory(raw: unknown): BuffMemory | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: BuffMemory = {}
  // unknown 入参用 `in` + typeof 收窄（判据 27：不在用处另写类型字面量）
  if ('enabled' in raw && typeof raw.enabled === 'boolean') out.enabled = raw.enabled
  const cov = sanitizeCoverage('coverage' in raw ? raw.coverage : undefined)
  if (cov !== undefined) out.coverage = cov
  return Object.keys(out).length > 0 ? out : null
}

/** buffId → 记忆 的净化：空表返回 `{}`（**保留空对象**，否则「有没有这一层」在 JSON 里分不清） */
function sanitizeBuffTable(raw: unknown): Record<string, BuffMemory> {
  const out: Record<string, BuffMemory> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id) continue
    const entry = sanitizeBuffMemory(value)
    if (entry) out[id] = entry
  }
  return out
}

/** 全局层的净化：入参是 `global` 对象本身（取其 `teammateBuffs` 表），非对象 / 缺键一律空表 */
function sanitizeGlobalTable(raw: unknown): Record<string, BuffMemory> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return sanitizeBuffTable('teammateBuffs' in raw ? raw.teammateBuffs : undefined)
}

function sanitizeTeams(raw: unknown): Record<string, TeamMemory> {
  const out: Record<string, TeamMemory> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !value || typeof value !== 'object' || Array.isArray(value)) continue
    const buffs = sanitizeBuffTable('teammateBuffs' in value ? value.teammateBuffs : undefined)
    const label = 'label' in value && typeof value.label === 'string' ? value.label : ''
    // 空队伍记忆没有信息量（= 出厂状态）⇒ 不落盘，避免文件里堆空壳
    if (Object.keys(buffs).length === 0) continue
    out[key] = { label, teammateBuffs: buffs }
  }
  return out
}

/**
 * 规范化：任意 `MemoryFile` 形状 → 规范形。
 * 幂等（`canonical(canonical(x)) === canonical(x)`），往返幂等判据的地基。
 */
export function canonicalMemory(file: MemoryFile): MemoryFile {
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    savedAt: file.savedAt,
    global: { teammateBuffs: sanitizeBuffTable(file.global.teammateBuffs) },
    teams: sanitizeTeams(file.teams),
  }
}

/** 导出（写文件 / 落 localStorage 共用）：先规范化再紧凑序列化（`minify:static` 同款：紧凑、LF） */
export function serializeMemory(file: MemoryFile): string {
  return JSON.stringify(canonicalMemory(file))
}

// ---------------------------------------------------------------- 迁移

/**
 * 迁移表：`from` → 把 `from` 版的原始对象就地升级为 `from + 1` 版。
 * 加新版 = 往这里加一行 + 抬 `MEMORY_SCHEMA_VERSION`；**旧文件必须仍能读回**（判据覆盖）。
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 是首版，暂无迁移步。示例（将来）：
  // 1: raw => ({ ...raw, global: { teammateBuffs: {}, characterTweaks: raw.global } }),
}

/**
 * 解析记忆文件（含迁移与净化）。**任何失败都返回 `{ ok: false, error }`**，由 UI 显示。
 * 失败面：非 JSON / 非对象 / 缺 `schemaVersion` / 版本高于本版 / 迁移抛错。
 */
export function parseMemory(raw: unknown): MemoryParseResult {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return { ok: false, error: '不是合法 JSON（文件损坏或不是记忆文件）' }
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: '顶层不是对象（不是记忆文件）' }
  }
  const obj = value as Record<string, unknown>
  const version = obj.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: '缺少合法的 schemaVersion（不是记忆文件，或来自旧的无版本版本）' }
  }
  if (version > MEMORY_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `记忆文件版本 ${version} 高于本程序支持的 ${MEMORY_SCHEMA_VERSION}（请更新程序，或改用旧文件）`,
    }
  }
  let working = obj
  let cursor = version
  while (cursor < MEMORY_SCHEMA_VERSION) {
    const step = MIGRATIONS[cursor]
    if (!step) return { ok: false, error: `缺少 v${cursor} → v${cursor + 1} 的迁移步骤（记忆文件读不回来）` }
    try {
      working = step(working)
    } catch (e) {
      return { ok: false, error: `迁移 v${cursor} → v${cursor + 1} 失败：${e instanceof Error ? e.message : String(e)}` }
    }
    cursor += 1
  }
  const savedAt = typeof working.savedAt === 'string' ? working.savedAt : new Date().toISOString()
  const file = canonicalMemory({
    schemaVersion: MEMORY_SCHEMA_VERSION,
    savedAt,
    global: { teammateBuffs: sanitizeGlobalTable(working.global) },
    teams: sanitizeTeams(working.teams),
  })
  return { ok: true, file, migratedFrom: version === MEMORY_SCHEMA_VERSION ? null : version }
}

/** 记忆文件摘要（UI 展示「全局 N 条 / 队伍 M 支」，不复制统计口径到组件里） */
export function memorySummary(file: MemoryFile): { globalEntries: number; teams: number; teamEntries: number } {
  const globalEntries = Object.keys(file.global.teammateBuffs).length
  const teamList = Object.values(file.teams)
  return {
    globalEntries,
    teams: teamList.length,
    teamEntries: teamList.reduce((sum, t) => sum + Object.keys(t.teammateBuffs).length, 0),
  }
}
