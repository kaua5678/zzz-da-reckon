/**
 * Chart 4 菲林经济模拟（选定 Boss + 主C，逐期菲林投放 → 加金 → 强度曲线）。
 * CC-86（2026-09-27，census §5.92）自 `composables/teamTimeline.ts` 逐字拆出；teamTimeline.ts 原样转出公开名，导入方不用改。
 */
import { useConfigStore } from '@/stores/config'
import { applyBossLayerBuffs } from '@/composables/runArchiveDeploy'
import { useCatalogStore } from '@/stores/catalog'
import { VERSION_NODES, nodeIndexOf, releaseNodeOf } from '@/data/versionTimeline'
import type { BossPreset, PhaseBossBrief, PhaseView } from '@/types/bossPreset'
import { CINEMA_GOLD_FILM, WEAPON_GOLD_FILM, PERIODS_PER_VERSION, allocateTopUpFilm } from '@/data/filmEconomy'
import type { TimelineAxisNode } from './teamTimeline'
import { snapshotStore, restoreStore } from '@/composables/configSnapshot'
import { baseGoldOfTeam, buildBudgetAwareGoldSteps, budgetAwareStateFor, applyTeamToStore, yieldNow } from './teamTimelineStore'
import type { useResourceCalc } from '@/composables/useResourceCalc'

type Calc = ReturnType<typeof useResourceCalc>

// ========== Chart 4：菲林经济模拟（选定 Boss + 主C，逐期菲林投放 → 加金 → 当期 Boss 强度） ==========
//
// 用户口径（2026-08-23 修订）：
// - 横轴 = 危局期数（含日期）；纵轴 = 队伍强度（伤害/该期 Boss 血量 %）。
// - **选的是主C不是队伍**：加金可让队友换人（如 琉音换青衣、卢西娅换潘引壶——主C 固定，
//   队友 = 候选池内「当前总限定金下伤害最高」的双人组，随金数增长自动换队）。
// - 每个版本有菲林投放（默认 ≈ 1 金 = 15000 菲林，可编辑）；按「消耗占比」决定每期花多少
//   抽卡、存多少（如给 1 金用半金 = 0.5）；「目标卡池」期把银行菲林全部投入抽卡加金。
// - 抽卡成本按期望（萌百·游戏内调频详情）：命座金 = 93.75 抽 = 15000 菲林；
//   音擎金 = 62.5 抽 = 10000 菲林（角色池 1.6% 综率 × 50/50 保底；音擎池 2% 综率 × 75/25 保底）。
// - **充值 = 用户只输入每版本预算（元），按性价比固定分配**（汇率不可改）：
//   月卡（30 元 → 3300 菲林）> 大月卡（68 元 → ≈2600 菲林）> 直充（10 菲林/元），
//   见 data/filmEconomy.ts allocateTopUpFilm。
// - 买金顺序 = 当前最优队的主C 优先步（buildBudgetAwareGoldSteps：主C 影画 1-6 → 主C 精炼
//   2-5 → 队友…）；初始金数可设定（低于基础金自动钳制到 0 命 1 精带专武）。
// - **起点 = 主C 首次 UP 之后的 Boss 初登场**（axisNodes 按主C 实装日期裁剪）。
// - 每期只算「当前期数」的 Boss 血量与关卡固有 buff（layer_buff，期视图有数据才应用）+ 队伍。


/** 模拟一个点的结果（一个危局期数） */
export interface FilmSimPoint {
  periodId: string
  seq: number
  label: string
  date: string
  team: [string, string, string]
  /** 该期总限定金（初始金 + 已购金步） */
  totalGold: number
  /** 该期配装明细（budgetAware label） */
  goldLabel: string
  /** 期初累计剩余菲林 */
  filmBank: number
  /** 本期投入抽卡的菲林 */
  filmSpent: number
  /** 累计已投入抽卡的菲林 */
  filmInvestedTotal: number
  damage: number
  hpRatio: number
}

export interface FilmSimulationOptions {
  boss: BossPreset
  /** 危局期数轴（id = phaseId；label/date 由页面从 bossSchedule 构造） */
  axisNodes: TimelineAxisNode[]
  /** 期视图（当期关卡固有 buff 数据；缺省空 = 老期无 buff） */
  periodViews: PhaseView[]
  /** 主C（固定；队友从候选池搜最优） */
  mainAgentId: string
  /** 队友候选池（用户策展；主C 自动排除；每期按当前总限定金搜最优双人组） */
  candidatePool: string[]
  /** 初始总限定金（低于基础金自动钳制） */
  initialGold: number
  /** 每版本免费菲林（默认 15000 ≈ 1 金） */
  filmPerVersion: number
  /** 消耗占比 0-1：每期菲林花多少抽卡（其余存银行） */
  spendRatio: number
  /** 每版本充值预算（元，0 = 不充）——按性价比固定分配（月卡→大月卡→直充，汇率不可改） */
  budgetYuanPerVersion: number
  /** 目标卡池期（期 id）：该期把银行菲林全部投入抽卡 */
  targetPeriodId?: string
  /** 自动配装（推荐驱动盘 + 词条优化器）；缺省 false = 轻量速算 */
  autoBuild?: boolean
  onProgress?: (p: { pct: number; text: string }) => void
}

export interface FilmSimulationResult {
  points: FilmSimPoint[]
  stats: { nonConverged: number; durationMs: number }
}

/** 期视图里选定 Boss 的关卡固有 buff → 写入全局 Buff 表（先清旧 layer-buff:，复用 runArchiveDeploy.applyBossLayerBuffs 唯一实现） */
function applyPeriodLayerBuffs(
  configStore: ReturnType<typeof useConfigStore>,
  periodViews: PhaseView[],
  periodId: string,
  boss: BossPreset,
) {
  // 无论 view/brief 是否存在都先清旧（applyBossLayerBuffs 内部清旧 + brief 为空只清不写）
  const view = periodViews.find(v => v.phaseId === periodId)
  const brief = view ? ([view.criticalAssault, ...(view.defense ?? [])].filter(Boolean) as PhaseBossBrief[])
    .find(b => b.presetId === boss.id) ?? null : null
  applyBossLayerBuffs(configStore, brief)
}

/** 下一个待购金步的成本（主C 优先顺序）：影画 = 命座金，音擎（本体/精炼）= 音擎金 */
function nextGoldStepCost(
  team: [string, string, string],
  totalGold: number,
  catalog: ReturnType<typeof useCatalogStore>,
): number | null {
  const base = baseGoldOfTeam(team, catalog)
  const { steps } = buildBudgetAwareGoldSteps(team, catalog)
  const idx = totalGold - base
  if (idx < 0 || idx >= steps.length) return null
  return steps[idx].kind === 'cinema' ? CINEMA_GOLD_FILM : WEAPON_GOLD_FILM
}

/**
 * 菲林经济模拟：主C 固定，每期发菲林（+预算按性价比折算）→ 按占比花/存 →
 * 抽卡资金按当前最优队的主C 优先步买金 → 用「当前期数」Boss 数值 + 关卡固有 buff，
 * 在候选池内搜「当前总限定金下伤害最高」的双队友组合求队伍强度（队友随金数增长可换人）。
 */
export async function computeFilmSimulation(calc: Calc, opts: FilmSimulationOptions): Promise<FilmSimulationResult> {
  const configStore = useConfigStore()
  const catalog = useCatalogStore()
  const snap = snapshotStore(configStore)
  const t0 = Date.now()
  const report = (pct: number, text: string) => opts.onProgress?.({ pct, text })
  try {
    // 起点 = 主C 首次 UP 之后的 Boss 登场期（用户口径；主C 实装前的期不算）
    const mainRelease = releaseNodeOf(opts.mainAgentId)
    const mainDate = mainRelease ? VERSION_NODES[nodeIndexOf(mainRelease)]?.date : undefined
    const axis = opts.axisNodes.filter(n => !mainDate || (n.date ?? '') >= mainDate)
    if (axis.length === 0) {
      report(1, '主C 首次 UP 之后无该 Boss 登场期')
      return { points: [], stats: { nonConverged: 0, durationMs: Date.now() - t0 } }
    }

    // 候选双队友（主C 排除；至多 1 击破；预算感知配装）
    const isStun = (id: string) => (catalog.getAgent(id)?.specialty ?? '') === 'stun'
    const stunBudget = isStun(opts.mainAgentId) ? 0 : 1
    const candidates = opts.candidatePool.filter(id => id !== opts.mainAgentId && catalog.getAgent(id))
    const pairs: [string, string][] = []
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i]
        const b = candidates[j]
        if ((isStun(a) ? 1 : 0) + (isStun(b) ? 1 : 0) > stunBudget) continue
        pairs.push([a, b])
      }
    }
    if (pairs.length === 0) {
      report(1, '候选池不足（至少 2 名非主C队友）')
      return { points: [], stats: { nonConverged: 0, durationMs: Date.now() - t0 } }
    }

    /** 在当期 Boss/buff（已应用）下搜「当前总限定金」的最优双队友组合（预算感知 + 收敛过滤） */
    const searchBest = (totalGold: number): { team: [string, string, string]; damage: number; budgetAware: ReturnType<typeof budgetAwareStateFor> } | null => {
      let best: { team: [string, string, string]; damage: number; budgetAware: ReturnType<typeof budgetAwareStateFor> } | null = null
      for (const [a, b] of pairs) {
        const team: [string, string, string] = [opts.mainAgentId, a, b]
        if (baseGoldOfTeam(team, catalog) > totalGold) continue // 买不起
        const budgetAware = budgetAwareStateFor(team, totalGold, catalog)
        applyTeamToStore(configStore, team, budgetAware.state, opts.autoBuild === true)
        const conv = calc.resourceResult.value?.convergence?.outerExit as 'stable' | 'cycle' | 'maxIter' | undefined
        if (conv === 'maxIter') continue
        const dmg = calc.teamTotalDamage.value
        if (!best || dmg > best.damage + 1e-9) best = { team, damage: dmg, budgetAware }
      }
      return best
    }

    const minPairBase = Math.min(...pairs.map(([a, b]) => baseGoldOfTeam([opts.mainAgentId, a, b], catalog)))
    let totalGold = Math.max(opts.initialGold, minPairBase) // 初始金低于最便宜队基础金 → 钳到最便宜队
    let bank = 0
    let filmWallet = 0 // 抽卡资金（累计投入，买金步前先攒）
    let filmInvestedTotal = 0
    const topUpFilm = allocateTopUpFilm(opts.budgetYuanPerVersion)
    const filmPerPeriod = (opts.filmPerVersion + topUpFilm) / PERIODS_PER_VERSION
    const points: FilmSimPoint[] = []
    let nonConverged = 0
    const total = axis.length
    for (let i = 0; i < total; i++) {
      const node = axis[i]
      // 当前期数 Boss + 关卡固有 buff 一次应用（本期所有候选队共用）
      const phase = opts.boss.phases.find(p => p.phaseId === node.id)
        ?? opts.boss.phases.find(p => p.begin.slice(0, 10) === (node.date ?? '').slice(0, 10))
      if (!phase) continue
      configStore.applyBossPreset({ id: opts.boss.id }, phase, opts.boss.monster, opts.boss.defaults)
      applyPeriodLayerBuffs(configStore, opts.periodViews, node.id, opts.boss)
      // ---- 经济：收入 → 存/花 ----
      const ratio = Math.max(0, Math.min(1, opts.spendRatio))
      bank += filmPerPeriod * (1 - ratio)
      let spend = filmPerPeriod * ratio
      if (node.id === opts.targetPeriodId && bank > 0) {
        spend += bank
        bank = 0
      }
      filmWallet += spend
      filmInvestedTotal += spend
      // ---- 买金：按当前最优队的下一步成本；换队时累计金数按新队主C 优先重新解释 ----
      let best: ReturnType<typeof searchBest> = null
      let guard = 0
      while (guard++ < 40) {
        best = searchBest(totalGold)
        if (!best) break
        const cost = nextGoldStepCost(best.team, totalGold, catalog)
        if (cost == null || filmWallet < cost) break
        filmWallet -= cost
        totalGold++
        best = null
      }
      // ---- 最终最优队 + 本期强度（CC-340：正常从 while 买完退出时 best 已是当前 totalGold 的最优解，免重复全池求值） ----
      if (!best && guard > 40) best = searchBest(totalGold)
      if (!best) {
        nonConverged++
        continue
      }
      points.push({
        periodId: node.id,
        seq: i + 1,
        label: node.label,
        date: node.date,
        team: best.team,
        totalGold,
        goldLabel: best.budgetAware.label,
        filmBank: Math.round(bank),
        filmSpent: Math.round(spend),
        filmInvestedTotal: Math.round(filmInvestedTotal),
        damage: best.damage,
        hpRatio: phase.hp > 0 ? Math.round((best.damage / phase.hp) * 10000) / 100 : 0,
      })
      report((i + 1) / total, `期 ${node.label}：${totalGold} 金（${filmInvestedTotal.toFixed(0)} 菲林投入）…`)
      if (i % 2 === 0) await yieldNow()
    }
    report(1, `完成：${points.length} 期`)
    return { points, stats: { nonConverged, durationMs: Date.now() - t0 } }
  } finally {
    restoreStore(configStore, snap)
  }
}
