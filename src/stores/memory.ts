/**
 * 用户记忆 Store（全局 + 队伍两层；记忆模式开关；localStorage 自动存 + 具名槽）。
 *
 * ## 语义（用户裁决 2026-10-09，逐条都是裁决不是推断）
 * ① **记忆模式开关**：打开 ⇒ 改动**立刻**计入记忆（实时落 localStorage）；关闭 ⇒ 改动**不计入**
 *    （「关闭时改动配置 → 记忆文件逐字节不变」是判据，见 `configMemory.test.ts`）。
 * ② **自动分层**（用户裁决：按改动性质）：
 *    - **队友 buff 覆盖率 → 全局层**（操作手感，换个队伍仍适用）；
 *    - **队友 buff 开关 → 队伍层**（勾选随队伍组成变，同角色换到别队往往不该沿用）。
 *    两侧都可**手动改判**（面板上把某条移到另一层）——自动分层是默认，不是牢笼。
 * ③ **解析顺序 = 队伍层优先，其次全局层，都没有 = 临时改动**（回落派生默认值）。
 * ④ **恢复出厂 = 加载一份「全为不修改」的记忆文件**，且**自动备份当前记忆**到一个具名槽
 *    （用户原话：「清空记忆，但最好自动保存下当前记忆的备份」）。它与「加载某个记忆文件」
 *    是两个**不同**操作，UI 上分开（不合并成一个按钮）。
 * ⑤ 队伍身份 = 成员 agentId 集合、顺序无关（`memoryFile#teamKeyOf`）。
 *
 * ## 为什么不是 config store 的一部分
 * 记忆是**用户数据**不是**计算输入**：进 `config.$state` 会让每次记录都让 calcOutput 记忆化键失效
 * ⇒ 改一个覆盖率就全量重算。它也不该进独立分析场景（场景必须与 UI 现场隔离，见 `analysisScenario`）
 * ⇒ config model 只经**注入的端口**读它，场景不注入即完全无记忆（行为与今天逐位相同）。
 *
 * @fact ui:用户记忆/写入时机 决: 记忆模式开关打开 ⇒ 改动立刻计入并实时落 localStorage；关闭 ⇒ 改动不计入（记忆文件逐字节不变） | 据 用户@2026-10-09（选项 a：立刻） | 验 src/stores/__tests__/configMemory.test.ts | 锚 src/stores/memory.ts#recordEnabled | 信 确认
 * @fact ui:用户记忆/自动分层 决: 队友 buff 覆盖率默认记入全局层（跨队通用），开关默认记入队伍层（按成员 id 集合顺序无关索引）；两层都可手动改判 | 据 用户@2026-10-09·复核@2026-10-09（「换个队伍就不适用」的划分经追问确认） | 验 src/stores/__tests__/configMemory.test.ts | 锚 src/stores/memory.ts#recordCoverage | 信 确认
 * @fact ui:用户记忆/恢复出厂 决: 恢复出厂 = 清空记忆并回落派生默认（等价于加载一份全为「不修改」的记忆文件），且先把当前记忆自动备份进一个具名槽；它与「加载某个记忆文件」是两个独立操作 | 据 用户@2026-10-09 | 验 src/stores/__tests__/configMemory.test.ts | 锚 src/stores/memory.ts#factoryReset | 信 确认
 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { persistedRef } from '@/composables/persistedRef'
import {
  MEMORY_RECORDING_KEY,
  MEMORY_SLOTS_KEY,
  MEMORY_STORAGE_KEY,
  canonicalMemory,
  createEmptyMemory,
  memorySummary,
  parseMemory,
  serializeMemory,
  type BuffMemory,
  type MemoryFile,
  type TeamMemory,
} from '@/composables/memoryFile'

/** 具名记忆槽（「加载某个记忆文件」的本地多份） */
export interface MemorySlot {
  name: string
  savedAt: string
  file: MemoryFile
}

/** config model 读写的记忆端口（注入式：独立分析场景不注入 ⇒ 无记忆，行为不变） */
export interface ConfigMemoryPort {
  /** 队伍层 → 全局层 → `undefined`（= 没有记忆，调用方回落派生默认值） */
  resolveEnabled: (teamKey: string, buffId: string) => boolean | undefined
  resolveCoverage: (teamKey: string, buffId: string) => number | undefined
  /** 记一条开关（写队伍层）；记忆模式关闭时**不写**（判据：文件逐字节不变） */
  recordEnabled: (teamKey: string, teamLabel: string, buffId: string, enabled: boolean) => void
  /** 记一条覆盖率（写全局层）；记忆模式关闭时不写 */
  recordCoverage: (buffId: string, coverage: number) => void
}

/** 具名槽存档的净化（损坏/异形一律丢弃整槽，不静默塞半份进去） */
function parseSlots(raw: unknown): MemorySlot[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: MemorySlot[] = []
  for (const item of raw) {
    // unknown 入参用 `in` 收窄（判据 27：不许在用处另写一份类型字面量）
    if (!item || typeof item !== 'object' || !('name' in item) || !('file' in item)) continue
    const { name, file } = item
    if (typeof name !== 'string' || !name) continue
    const parsed = parseMemory(file)
    if (!parsed.ok) continue
    const savedAt = 'savedAt' in item && typeof item.savedAt === 'string' ? item.savedAt : parsed.file.savedAt
    out.push({ name, savedAt, file: parsed.file })
  }
  return out
}

/** 从 localStorage 读当前记忆；损坏 ⇒ 出厂记忆 + 把错误暴露给 UI（**不静默**） */
function loadStoredMemory(): { file: MemoryFile; error: string } {
  try {
    const raw = localStorage.getItem(MEMORY_STORAGE_KEY)
    if (!raw) return { file: createEmptyMemory(), error: '' }
    const parsed = parseMemory(raw)
    if (!parsed.ok) return { file: createEmptyMemory(), error: `本地记忆读取失败：${parsed.error}` }
    return { file: parsed.file, error: '' }
  } catch {
    // localStorage 不可用（隐私模式）不是「文件损坏」，不报错——只是本次会话不持久化
    return { file: createEmptyMemory(), error: '' }
  }
}

export const useMemoryStore = defineStore('memory', () => {
  // ⚠ 必须**在 setup 内**读盘（不能做成模块级常量）：模块级对象会被 store 原地改写
  // （`entryOf` 直接往 `file.value.teams` 上挂键）⇒ 同一模块的第二个 store 实例会继承前一个的记忆，
  // 「记忆模式关闭时改动不计入」这类判据会被上一个用例/上一次会话的残留污染（实测抓到）。
  const loaded = loadStoredMemory()

  /** 记忆模式开关（持久化：刷新后保持用户的模式选择） */
  const recording = persistedRef<boolean>(
    MEMORY_RECORDING_KEY,
    raw => (typeof raw === 'boolean' ? raw : undefined),
    () => false,
  )

  /** 当前记忆（「当前记忆文件」= localStorage 自动存的那一份） */
  const file = ref<MemoryFile>(loaded.file)
  /** 载入/导入/恢复出厂时的**可见报错**（空串 = 无错） */
  const error = ref<string>(loaded.error)
  /** 最近一次成功操作的提示（导入/备份/恢复出厂；空串 = 无） */
  const notice = ref<string>('')

  /** 具名槽（多份记忆） */
  const slots = persistedRef<MemorySlot[]>(
    MEMORY_SLOTS_KEY,
    raw => parseSlots(raw),
    () => [],
  )

  /** 自动存：任何记忆变化立刻落 localStorage（「立刻」= 每次改动，不是「改完点保存」） */
  watch(file, value => {
    try { localStorage.setItem(MEMORY_STORAGE_KEY, serializeMemory(value)) } catch { /* 写不进就只做会话内 */ }
  }, { deep: true })

  const summary = computed(() => memorySummary(file.value))
  const teamKeys = computed(() => Object.keys(file.value.teams).sort())

  function clearMessages() {
    error.value = ''
    notice.value = ''
  }

  // ---------- 读（解析顺序：队伍层 → 全局层） ----------

  function resolveEnabled(teamKey: string, buffId: string): boolean | undefined {
    const team = file.value.teams[teamKey]?.teammateBuffs[buffId]
    if (team?.enabled !== undefined) return team.enabled
    const global = file.value.global.teammateBuffs[buffId]
    return global?.enabled
  }

  function resolveCoverage(teamKey: string, buffId: string): number | undefined {
    const team = file.value.teams[teamKey]?.teammateBuffs[buffId]
    if (team?.coverage !== undefined) return team.coverage
    const global = file.value.global.teammateBuffs[buffId]
    return global?.coverage
  }

  // ---------- 写（记忆模式关闭时一律不写） ----------

  /** 取（必要时建）某条 buff 的记忆槽；`layer` 决定写哪一层 */
  function entryOf(layer: 'global' | 'team', teamKey: string, teamLabel: string, buffId: string): BuffMemory | null {
    if (layer === 'global') {
      const table = file.value.global.teammateBuffs
      return (table[buffId] ??= {})
    }
    if (!teamKey) return null   // 空队伍没有队伍身份（记全局层，调用方决定）
    const teams = file.value.teams
    const team: TeamMemory = (teams[teamKey] ??= { label: teamLabel, teammateBuffs: {} })
    if (teamLabel && team.label !== teamLabel) team.label = teamLabel
    return (team.teammateBuffs[buffId] ??= {})
  }

  /** 清掉一条空记忆（两字段都被删 ⇒ 整条消失，文件里不留空壳） */
  function pruneEmpty(layer: 'global' | 'team', teamKey: string, buffId: string) {
    const table = layer === 'global' ? file.value.global.teammateBuffs : file.value.teams[teamKey]?.teammateBuffs
    if (!table) return
    const entry = table[buffId]
    if (entry && Object.keys(entry).length === 0) delete table[buffId]
    if (layer === 'team' && file.value.teams[teamKey] && Object.keys(file.value.teams[teamKey].teammateBuffs).length === 0) {
      delete file.value.teams[teamKey]
    }
  }

  function recordEnabled(teamKey: string, teamLabel: string, buffId: string, enabled: boolean) {
    if (!recording.value) return
    // ① 队伍层（自动分层：开关随队伍组成变）；空队伍无处可记 ⇒ 回落全局层，避免改动被静默丢弃
    const layer = teamKey ? 'team' : 'global'
    const entry = entryOf(layer, teamKey, teamLabel, buffId)
    if (!entry) return
    entry.enabled = enabled
  }

  function recordCoverage(buffId: string, coverage: number) {
    if (!recording.value) return
    // ② 全局层（自动分层：覆盖率是操作手感，换队仍适用）
    const entry = entryOf('global', '', '', buffId)
    if (!entry) return
    entry.coverage = Math.min(100, Math.max(0, coverage))
  }

  /** 供 config model 注入的端口（见文件头注释：场景不注入 ⇒ 无记忆） */
  function port(): ConfigMemoryPort {
    return { resolveEnabled, resolveCoverage, recordEnabled, recordCoverage }
  }

  // ---------- 整份记忆的加载 / 导出 / 导入 / 具名槽 / 恢复出厂 ----------

  /** 落一份记忆为当前记忆（**不碰配置**；调用方随后 `config.applyMemoryReset()` 让它生效） */
  function loadFile(next: MemoryFile, note = '') {
    file.value = canonicalMemory(next)
    clearMessages()
    notice.value = note
  }

  /** 导出串（写文件用；与 localStorage 落盘同源，规则 11） */
  function exportText(): string {
    return serializeMemory(file.value)
  }

  /** 从 JSON 文本导入（**失败可见报错**，绝不静默回落） */
  function importText(text: string): boolean {
    const parsed = parseMemory(text)
    if (!parsed.ok) {
      clearMessages()
      error.value = `导入失败：${parsed.error}`
      return false
    }
    loadFile(parsed.file, parsed.migratedFrom === null ? '已导入记忆文件' : `已导入记忆文件（自 v${parsed.migratedFrom} 迁移）`)
    return true
  }

  /** 存为具名槽（同名覆盖） */
  function saveSlot(name: string): boolean {
    const trimmed = name.trim()
    if (!trimmed) {
      clearMessages()
      error.value = '请填写记忆名称'
      return false
    }
    const entry: MemorySlot = { name: trimmed, savedAt: new Date().toISOString(), file: canonicalMemory(file.value) }
    const idx = slots.value.findIndex(s => s.name === trimmed)
    if (idx >= 0) slots.value.splice(idx, 1, entry)
    else slots.value.push(entry)
    clearMessages()
    notice.value = `已存为「${trimmed}」`
    return true
  }

  function loadSlot(name: string): boolean {
    const slot = slots.value.find(s => s.name === name)
    if (!slot) {
      clearMessages()
      error.value = `没有名为「${name}」的记忆`
      return false
    }
    loadFile(slot.file, `已加载「${name}」`)
    return true
  }

  function deleteSlot(name: string) {
    const idx = slots.value.findIndex(s => s.name === name)
    if (idx >= 0) slots.value.splice(idx, 1)
  }

  /** 自动备份槽名（同分钟内重复恢复出厂会覆盖同一槽——那是同一份备份，不是丢失） */
  function backupName(now = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `自动备份 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  }

  /**
   * 恢复出厂 = 清空记忆 + 先把当前记忆自动备份进一个具名槽（用户裁决）。
   * 返回备份槽名（UI 展示「已备份为 …」），当前记忆无内容时返回 `''`（不产生空备份）。
   */
  function factoryReset(): string {
    const current = canonicalMemory(file.value)
    const hasContent = memorySummary(current).globalEntries > 0 || memorySummary(current).teams > 0
    let backup = ''
    if (hasContent) {
      backup = backupName()
      const entry: MemorySlot = { name: backup, savedAt: new Date().toISOString(), file: current }
      const idx = slots.value.findIndex(s => s.name === backup)
      if (idx >= 0) slots.value.splice(idx, 1, entry)
      else slots.value.push(entry)
    }
    file.value = createEmptyMemory()
    clearMessages()
    notice.value = backup ? `已恢复出厂值（原记忆备份为「${backup}」）` : '已恢复出厂值（原记忆本就是空的）'
    return backup
  }

  /** 手动改判：把一条 buff 记忆在两层之间搬（自动分层的兜底口，用户可覆盖默认归属） */
  function moveBuff(teamKey: string, buffId: string, to: 'global' | 'team', teamLabel = ''): boolean {
    const from: 'global' | 'team' = teamKey ? 'team' : 'global'
    if (from === to) return false
    const table = from === 'global' ? file.value.global.teammateBuffs : file.value.teams[teamKey]?.teammateBuffs
    if (!table) return false
    const entry = table[buffId]
    if (!entry) return false
    const target = entryOf(to, teamKey, teamLabel, buffId)
    if (!target) {
      clearMessages()
      error.value = '没有队伍身份，无法改判到队伍记忆'
      return false
    }
    Object.assign(target, entry)
    // ⚠ 必须**显式删除源条目**：只「清空」是不够的（条目本身非空 ⇒ pruneEmpty 不会动它，
    // 结果同一条记忆同时活在两层里，解析顺序会静默掩盖用户刚做的改判）。
    delete table[buffId]
    pruneEmpty(from, teamKey, buffId)
    clearMessages()
    notice.value = to === 'global' ? '已改判为全局记忆' : '已改判为队伍记忆'
    return true
  }

  return {
    recording, file, slots, error, notice, summary, teamKeys,
    resolveEnabled, resolveCoverage, recordEnabled, recordCoverage, port,
    loadFile, exportText, importText,
    saveSlot, loadSlot, deleteSlot, factoryReset, moveBuff,
    clearMessages,
  }
})
