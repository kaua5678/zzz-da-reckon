/**
 * 「配装最优」：把当前队伍的主词条（4/5/6）与副词条一次性对齐到**近似**最优（实战对比页的显式按钮）。
 *
 * 为什么需要它：实战对比的部署链（runArchiveDeploy#applyDeployConfig → applyTeamPreset →
 * applyBuildRecommendationForSlot）只写「推荐配装」——4/5/6 是攻略数据里的**静态**推荐，副词条是
 * core 模板默认档（贪心填 + 百暴封顶 + TOP2 ≤ 35）。两者都不是按这支队 / 这个 Boss 算出来的最优。
 * 本模块补的正是这一段：用真实 teamTotalDamage 裁决。
 *
 * 两段（顺序固定：主词条会改暴击/增伤面板，副词条要在新面板上重算）：
 * 1. 主词条 4/5/6：逐槽位、逐盘位做**单项替换扫描**（候选 = statRules 的完整词条池，排除当前值、
 *    5 号位排除与角色属性不匹配的元素增伤），取伤害最高者应用。单遍扫描（不做 3×3 联合搜索）。
 * 2. 副词条：直接复用编排层 computeSubstatAllocationForSlot（默认档起点 → 真实伤害挪步精修，
 *    只在 TOP2 ≤ 35 的合法空间里挪）。
 *
 * 口径（ENGINE_PIPELINE_GUIDE §4 坑 53）：**B 档（估算/近似级）**——显式按钮、缺省不跑、结果标「近似」。
 * - 逐槽爬山 ≠ 全局最优：槽间存在耦合（队友面板转模 / 百暴缺口都读全队面板），本模块不做联合优化。
 * - 1/2/3 号位是固定主词条（词条池只有一个条目），不参与选择；引擎无条件建模，本模块也不写。
 * - 代价（本机实测 2026-10-27）：2 人队约 65 次求值 / ~2s；3 人队约 103 次求值 / ~20s
 *   （每次求值 20–210ms，随队伍复杂度变化）⇒ 必须由用户显式触发，且要能取消。
 *
 * 形态：只在独立场景上跑（调用方 withAnalysisScenario），返回最终配置，由调用方一次性写回 UI store
 * （writeLoadoutToStore）——不在 UI store 上试算（CC-343 口径）。
 */
import type { AnalysisContext } from '@/composables/analysisScenario'
import type { ConfigModel } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import { elementStatKey } from '@/utils/elementStatKeys'
import { batchReporter, isBatchAborted, type BatchTaskOptions } from '@/composables/batchTask'
import { computeLoadoutPlanForSlot, slotPanelCritReader } from '@/composables/substatOptimizer'

type CatalogStore = ReturnType<typeof useCatalogStore>

const POSITIONS = [4, 5, 6] as const
const yieldToMacrotask = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/** 主词条单次替换（pct 相对「进这个盘位时」的全队伤害） */
export interface LoadoutMainChange {
  pos: 4 | 5 | 6
  from: string
  to: string
  pct: number
}

export interface LoadoutSlotResult {
  slot: number
  agentId: string
  /** 该槽最终主词条（4/5/6；某个盘位没有值时缺省） */
  mainStats: Partial<Record<4 | 5 | 6, string>>
  /** 该槽最终 2 件套（配平可能翻成双爆 2 件套；空 = 未选） */
  twoPieceSetId: string
  mainChanges: LoadoutMainChange[]
  /** 该槽最终副词条分配 */
  subStats: Record<string, number>
  /** 该槽两段优化合计带来的全队伤害变化（%，相对进该槽时） */
  pct: number
}

export interface LoadoutOptimizeResult {
  /** 优化前 / 优化后的全队伤害（同一场景） */
  before: number
  after: number
  slots: LoadoutSlotResult[]
  /** 主词条扫描的求值次数 */
  mainEvals: number
  /** 副词条精修的求值次数 */
  subEvals: number
  /** 总求值次数（成本披露用） */
  evals: number
  /** false = 被取消：结果只含已算部分，调用方应丢弃（不写回） */
  complete: boolean
}

/** 目前只带取消/进度（坑 53 B 档：调用方必须能停）；求值上限沿用 computeSubstatAllocationForSlot 的 80 */
export type LoadoutOptimizeOptions = BatchTaskOptions

/** 5 号位只考虑角色自身属性的增伤（别的元素增伤对伤害恒为 0，扫它纯浪费求值） */
function mainStatAllowed(pos: 4 | 5 | 6, stat: string, agentElementKey: string | undefined): boolean {
  if (pos !== 5) return true
  if (!stat.endsWith('Dmg')) return true
  return stat === agentElementKey
}

// @fact ui:配装最优/口径 口径: 实战对比「配装最优」= 显式按钮（缺省不跑，坑 53 B 档）；4/5/6 主词条单换扫描（池 = statRules.driveDisc.mainStatPools，5 号位只留角色属性增伤）+ 副词条真实伤害精修，逐槽爬山 = 近似最优（不保证全局最优）；1/2/3 号位是固定主词条不参与 | 据 用户@2026-10-27「加个显式的最优化，文案也得对」 | 验 src/composables/__tests__/loadoutOptimizer.test.ts | 锚 src/composables/loadoutOptimizer.ts#optimizeLoadout | 信 确认
// ⟳复核: 若主词条候选池口径（statRules.driveDisc.mainStatPools）或副词条精修上限 / TOP2≤35 约束改动，重核本口径、成本声明与判据 | 到期 2027-04-30
/**
 * 在独立场景里求「配装最优」。
 *
 * ⚠ 会直接改写 scenario.config（场景是深拷贝，不影响 UI store）；被取消时返回 complete: false，
 * 已改的一半留在场景里——调用方**不要**写回。
 */
export async function optimizeLoadout(
  scenario: AnalysisContext,
  catalogStore: CatalogStore,
  opts: LoadoutOptimizeOptions = {},
): Promise<LoadoutOptimizeResult> {
  const { config, calc } = scenario
  const report = batchReporter(opts)
  const pools = catalogStore.statRules?.driveDisc.mainStatPools ?? {}
  const before = calc.teamTotalDamage.value
  let evals = 0
  const readDamage = (): number => {
    evals++
    return calc.teamTotalDamage.value
  }

  // 空槽不参与（槽位号 ≠ 下标；这里只产出真实下标）
  const activeSlots = config.team.map((c, slot) => (c.agentId ? slot : -1)).filter(slot => slot >= 0)
  const starts = new Map<number, number>()
  const ends = new Map<number, number>()
  const slots: LoadoutSlotResult[] = []
  let complete = true

  // ---- 第一段：主词条单换扫描 ----
  for (const slot of activeSlots) {
    if (isBatchAborted(opts.control)) { complete = false; break }
    const char = config.team[slot]
    const agentId = char.agentId
    if (!agentId) continue
    const agent = catalogStore.getAgent(agentId)
    const agentElementKey = elementStatKey('dmg', agent?.damageElement)
    starts.set(slot, calc.teamTotalDamage.value)
    const changes: LoadoutMainChange[] = []

    for (const pos of POSITIONS) {
      const pool = pools[String(pos)] ?? []
      const current = char.driveDisc.mainStats[pos] ?? ''
      const baseDamage = readDamage()
      let bestStat = current
      let bestDamage = baseDamage
      for (const stat of pool) {
        if (stat === current) continue
        if (!mainStatAllowed(pos, stat, agentElementKey)) continue
        char.driveDisc.mainStats[pos] = stat
        await yieldToMacrotask()
        const damage = readDamage()
        char.driveDisc.mainStats[pos] = current
        if (isBatchAborted(opts.control)) { complete = false; break }
        if (damage > bestDamage * (1 + 1e-9)) { bestDamage = damage; bestStat = stat }
      }
      if (!complete) break
      if (bestStat !== current) {
        char.driveDisc.mainStats[pos] = bestStat
        changes.push({
          pos,
          from: current,
          to: bestStat,
          pct: baseDamage > 0 ? ((bestDamage - baseDamage) / baseDamage) * 100 : 0,
        })
      }
      report(0.05, `主词条 · ${slot + 1} 号位 #${pos}`)
    }
    if (!complete) break

    slots.push({
      slot,
      agentId,
      mainStats: { ...char.driveDisc.mainStats },
      twoPieceSetId: char.driveDisc.twoPieceSetId,
      mainChanges: changes,
      subStats: {},
      pct: 0,
    })
  }
  const mainEvals = evals

  // ---- 第二段：配平（4 号位主词条 / 2 件套 / 副词条联合；复用编排层优化器） ----
  //
  // 为什么这一段不只是「副词条精修」：引擎的暴击溢出折算要真兑现，必须允许翻动双爆来源本身
  // （4 号位 24% 暴击 ≡ 10 条词条 / 2 件套 8% 暴击 ≡ 3.33 条 ⇒ 配平宽度），否则精修只能退回溢出态
  // 或越单项上限。口径与实测见 composables/substatOptimizer.ts 文件头「双爆配平」段。
  if (complete) {
    for (const r of slots) {
      if (isBatchAborted(opts.control)) { complete = false; break }
      const char = config.team[r.slot]
      if (!char.agentId) continue
      const plan = computeLoadoutPlanForSlot(r.slot, config, catalogStore, {
        readDamage,
        readPanelCrit: slotPanelCritReader(calc, r.slot),
      }, calc.effectiveWEngineCoverages.value)
      if (plan) {
        if (plan.mainStat4) char.driveDisc.mainStats[4] = plan.mainStat4
        char.driveDisc.twoPieceSetId = plan.twoPieceSetId
        char.driveDisc.subStatAllocation = plan.subStatAllocation
        r.subStats = plan.subStatAllocation
        // 快照要跟着配平更新：writeLoadoutToStore 按 r.mainStats / r.twoPieceSetId 写回，
        // 停在主词条扫描后会让写回把 4 号位的配平翻转**改回去**。
        r.mainStats = { ...char.driveDisc.mainStats }
        r.twoPieceSetId = char.driveDisc.twoPieceSetId
      }
      ends.set(r.slot, calc.teamTotalDamage.value)
      report(0.6, `配平 · ${r.slot + 1} 号位`)
    }
  }

  for (const r of slots) {
    const start = starts.get(r.slot) ?? 0
    const end = ends.get(r.slot) ?? start
    r.pct = start > 0 ? ((end / start) - 1) * 100 : 0
  }

  return {
    before,
    after: calc.teamTotalDamage.value,
    slots,
    mainEvals,
    subEvals: evals - mainEvals,
    evals,
    complete,
  }
}

/** 把优化结果一次性写回 UI store（显式动作：主词条逐项 setMainStat，副词条整表 setSubStatAllocation ⇒ 该槽转「手动」） */
export function writeLoadoutToStore(configStore: ConfigModel, result: LoadoutOptimizeResult): void {
  for (const r of result.slots) {
    const char = configStore.team[r.slot]
    if (!char?.agentId) continue
    for (const pos of POSITIONS) {
      const next = r.mainStats[pos]
      if (next && char.driveDisc.mainStats[pos] !== next) configStore.setMainStat(r.slot, pos, next)
    }
    if (r.twoPieceSetId && char.driveDisc.twoPieceSetId !== r.twoPieceSetId) configStore.setTwoPieceSet(r.slot, r.twoPieceSetId)
    if (Object.keys(r.subStats).length > 0) configStore.setSubStatAllocation(r.slot, r.subStats)
  }
}
