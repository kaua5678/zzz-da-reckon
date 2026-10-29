/**
 * 「按队伍分别写配置码」的存储与合并（用户 2026-10-26）。
 *
 * 用户原话：「难度曲线中，你给自定义队伍加了配置码。我想这里写成操作区，比如我从上面勾选的
 * 队伍也能写配置码。而且填 00 或者其他不带专武的配置时，我在哪里勾选下位武器呢？」
 *
 * ⇒ 两条硬需求：
 * ① 配置码写在**操作区**（选中队伍旁边），能作用于**从上面勾选的任何队伍**（含预设库的队），
 *    而不是「想写码就得先自己建一支自定义队」；
 * ② 填了**不带专武的码**（右位 0，如 `00` / `20`）之后，必须能选**穿哪件下位武器**，
 *    并且能看见「没选时引擎会穿哪件」（下位表的第一件）。
 *
 * 三条语义：
 * 1. **按队伍 id 存**（`presetId`），不是全局三格：一张图上常常同时是「诺姆30 队」和「诺姆11 队」，
 *    全局三格会把两队写成同一套（这正是散点页旧控件的局限）。
 * 2. **覆盖 > 预设自带**：页面写的码压过 `TeamPreset.slotCodes`（页面是"这次想看什么"）。
 * 3. **空 = 不覆盖**（逐位不变）：没有 key 或三格全空 ⇒ `applySlotOverrides` 原样返回同一个 preset 引用。
 *
 * 与 `presetSlotOverrides` 的分工：那边是**纯函数**（怎么把码变成配装）；这里只管**页面态 + 存档**。
 */
import { computed, type Ref } from 'vue'
import { persistedRef } from '@/composables/persistedRef'
import type { SlotLockSpec, SlotOverrides } from '@/composables/presetSlotOverrides'
import { parseSetupCode, type SetupCode } from '@/utils/setupCode'

/** localStorage 键（改键名 = 用户已存的每队码丢失） */
export const TEAM_SLOT_CODES_KEY = 'zzz-compare-team-slot-codes:v2'
/** 三格配置码文本（空串 = 该槽不覆盖） */
export type SlotCodeText = [string, string, string]
/** 三格下位音擎 id（仅「右位 0」的槽有意义；null = 不指定，走 `data/downgradeWEngines` 表） */
export type SlotDowngradeText = [string | null, string | null, string | null]

/** 一支队的页面覆盖：三格码 + 三格下位件 */
export interface TeamSlotCodeEntry {
  cells: SlotCodeText
  /** 缺省 = 三格全 null（走表） */
  downgrades?: SlotDowngradeText
}

/** presetId → 该队的覆盖 */
export type TeamSlotCodeMap = Record<string, TeamSlotCodeEntry>

const EMPTY_CELLS: SlotCodeText = ['', '', '']

/** 存档解析：坏条目整体丢弃（半份配置比没有更危险）；全空的条目不入档 */
export function parseTeamSlotCodes(stored: unknown): TeamSlotCodeMap | undefined {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return undefined
  const out: TeamSlotCodeMap = {}
  for (const [id, raw] of Object.entries(stored as Record<string, unknown>)) {
    if (!id || !raw || typeof raw !== 'object') continue
    const rec = raw as Record<string, unknown>
    const cellsRaw = rec.cells
    if (!Array.isArray(cellsRaw) || cellsRaw.length !== 3) continue
    const cells = cellsRaw.map(x => (typeof x === 'string' ? x : '')) as SlotCodeText
    const downgradesRaw = rec.downgrades
    const downgrades: SlotDowngradeText = Array.isArray(downgradesRaw) && downgradesRaw.length === 3
      ? downgradesRaw.map(x => (typeof x === 'string' && x !== '' ? x : null)) as SlotDowngradeText
      : [null, null, null]
    const hasCell = cells.some(c => c.trim() !== '')
    const hasPick = downgrades.some(d => d !== null)
    if (!hasCell && !hasPick) continue // 全空 = 没写，不占存档
    out[id] = { cells, ...(hasPick ? { downgrades } : {}) }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 三格文本 → `SlotOverrides`（非法格当「不覆盖」，UI 另行标红）。
 * `downgrades` 只在右位 0（无专武）时挂到对应槽上——右位 ≥1 时选了下位件也不生效
 * （有专武就不可能同时穿下位，留着只会让存档与结果不一致）。
 */
export function overridesOf(entry: TeamSlotCodeEntry | undefined): SlotOverrides {
  if (!entry) return [null, null, null]
  const out = entry.cells.map((t, i): SlotLockSpec | null => {
    if (t.trim() === '') return null
    const code: SetupCode | null = parseSetupCode(t)
    if (!code) return null
    const picked = entry.downgrades?.[i] ?? null
    return code.wengine === 0 && picked ? { ...code, downgradeWEngineId: picked } : code
  })
  return out as unknown as SlotOverrides
}

/** 该格是否非法（非空但解析不出来） */
export function invalidCells(entry: TeamSlotCodeEntry | undefined): [boolean, boolean, boolean] {
  const cells = entry?.cells ?? EMPTY_CELLS
  return cells.map((s, i) => {
    if (s.trim() === '') return false
    return overridesOf(entry)[i] === null
  }) as [boolean, boolean, boolean]
}

/**
 * 三格文本里**右位 0（无专武）** 的槽位下标——这些槽需要用户选「穿哪件下位」。
 *
 * 为什么单列一个纯函数：页面上"填了 00 之后下位选择器才出现"这条交互，判据要能直接测
 * （vitest 对 .vue 全盲，只能靠实机点）。
 */
export function slotsNeedingDowngrade(entry: TeamSlotCodeEntry | undefined): number[] {
  if (!entry) return []
  const codes = overridesOf(entry)
  const out: number[] = []
  for (let s = 0; s < 3; s++) {
    const c = codes[s]
    if (c && c.wengine === 0) out.push(s)
  }
  return out
}

/** 页面用的「每队配置码」状态（持久化；全空时自动从存档里消失） */
export function useTeamSlotCodes() {
  const map: Ref<TeamSlotCodeMap> = persistedRef<TeamSlotCodeMap>(TEAM_SLOT_CODES_KEY, parseTeamSlotCodes, () => ({}))

  /** 读某队的条目（缺省 = 三格空、无下位件） */
  function entryOf(presetId: string): TeamSlotCodeEntry {
    return map.value[presetId] ?? { cells: [...EMPTY_CELLS] as SlotCodeText }
  }
  /** 该队是否写了任何东西（决定要不要显示「已覆盖」标记） */
  function activeOf(presetId: string): boolean {
    const e = map.value[presetId]
    return !!e && (e.cells.some(c => c.trim() !== '') || (e.downgrades ?? []).some(d => d !== null))
  }
  /** 该队的 SlotOverrides（空 = 不覆盖） */
  function overridesFor(presetId: string): SlotOverrides {
    return overridesOf(map.value[presetId])
  }
  function setCell(presetId: string, slot: number, v: string): void {
    const cur = entryOf(presetId)
    const cells = [...cur.cells] as SlotCodeText
    cells[slot] = v
    commit(presetId, { cells, ...(cur.downgrades ? { downgrades: cur.downgrades } : {}) })
  }
  /** 指定某槽的下位音擎（`null` = 改回「自动（下位表）」） */
  function setDowngrade(presetId: string, slot: number, wEngineId: string | null): void {
    const cur = entryOf(presetId)
    const downgrades: SlotDowngradeText = [...(cur.downgrades ?? [null, null, null])] as SlotDowngradeText
    downgrades[slot] = wEngineId
    const anyPick = downgrades.some(d => d !== null)
    commit(presetId, { cells: cur.cells, ...(anyPick ? { downgrades } : {}) })
  }
  /**
   * **批量写格**（用户 2026-10-29：「配置码也支持批量修改，比如全填 01」）。
   *
   * 场景：创建组一次建了十几支队，逐行点三格写同一个码是纯体力活；或者想给「已勾选的这几支队」
   * 统一按 01 基线看一遍。语义与逐格 `setCell` **完全相同**（走同一个 `commit`，所以
   * 「全空 ⇒ 删键」与存档形态不会分叉），只是把「哪些队 × 哪些槽」一次做完。
   *
   * `text = ''` = 把这几个槽清掉（回「不覆盖」）；**不动**该槽已选的下位件（那是另一件事，
   * 想连下位一起清就用 `clear`）。
   *
   * ⚠ **id 清单归调用方保证有效**（页面传的是 `resolveSelectedPresets` 之后的队伍 id）：这里对
   * 传入的每个 id 都写——「这支队还没有码」与「这个 id 不存在」在存档里长得一模一样，
   * 函数没法区分，硬判「不存在就跳过」会把正常的「给没写过码的队写码」也一起跳过。
   *
   * 返回**实际发生改动的队数**（值本来就一样的队不计；0 = 一个都没改，不是「成功」）。
   */
  function setCellsMany(presetIds: readonly string[], slots: readonly number[], text: string): number {
    const picked = slots.filter(s => s >= 0 && s <= 2)
    if (presetIds.length === 0 || picked.length === 0) return 0
    let changed = 0
    for (const id of presetIds) {
      if (!id) continue
      const cur = entryOf(id)
      const cells = [...cur.cells] as SlotCodeText
      let touched = false
      for (const s of picked) {
        if (cells[s] === text) continue
        cells[s] = text
        touched = true
      }
      if (!touched) continue
      commit(id, { cells, ...(cur.downgrades ? { downgrades: cur.downgrades } : {}) })
      changed++
    }
    return changed
  }

  /** 清掉某队（回「不覆盖」） */
  function clear(presetId: string): void {
    if (!(presetId in map.value)) return
    const next: TeamSlotCodeMap = { ...map.value }
    delete next[presetId]
    map.value = next
  }
  /** 写了码的队伍 id 列表（页头摘要用） */
  const activeIds = computed(() => Object.keys(map.value))

  /** 统一写回：全空 ⇒ 删除该键（存档里不留空壳） */
  function commit(presetId: string, entry: TeamSlotCodeEntry): void {
    const hasCell = entry.cells.some(c => c.trim() !== '')
    const hasPick = (entry.downgrades ?? []).some(d => d !== null)
    const next: TeamSlotCodeMap = { ...map.value }
    if (!hasCell && !hasPick) delete next[presetId]
    else next[presetId] = entry
    map.value = next
  }

  return { map, entryOf, activeOf, overridesFor, setCell, setCellsMany, setDowngrade, clear, activeIds }
}

// 原 autoDowngradeLabel（2026-10-26 的占位桩：void 掉全部入参、恒返回 null、零引用）已删——实际展示走
// downgradeNaming#downgradeNameOf（TeamSlotCodeEditor 的「自动（炎炙沸釜）」文案），解析走 data/downgradeWEngines。
