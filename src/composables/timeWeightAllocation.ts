/**
 * 平A池权重·**分配策略注册表**（2026-09-10，用户口径驱动）。
 *
 * 背景（用户 2026-09-10）：「主C 的失衡期能量需求必须要平A时间」——**不分配足够的平A，总量也不够**。
 * 引擎侧实证（docs 坑35）：主C 平A池时间 → 能量总量 → 强特次数，实测把主C 的池子从 31.8s 提到 65.7s
 * 强特 16→18 次、单队伤害 +23.9%；而主计算路径用的是**静态默认权重**（强攻/异常/击破=1、支援/防护=0），
 * 127 预设里 **56 队的主C 被分少**，仅靠重新分配时间全库可拿 **+2.86%** 团队总伤。
 *
 * 为什么是**开关且默认关**（用户 2026-09-10 裁决）：「这个算的太慢了」——边际均衡一次 ≈ 3 倍求值
 * （实测均值 239.5ms/队、p90 494ms、最坏 1301ms，对照一次全队求值 78.6ms）。开与不开都是合法口径：
 * 关 = 静态默认/用户手填权重（当前基线与全部既有数值）；开 = 按策略重新分配。
 *
 * **扩展点（用户 2026-09-10：「这个自动计算以后还要加逻辑，比如能量不够就多a，甚至总时间可以把队友的
 * 时间都合轴」）**：新逻辑各自实现一个 `TimeWeightStrategy` 注册进 `TIME_WEIGHT_STRATEGIES` 即可，
 * UI 开关与 watcher 调用点都不用改。策略契约 = 读现况 → 写回各槽权重 → 返回诊断。
 */
import { watch } from 'vue'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { optimizeTeamTimeWeights } from '@/composables/teamTimeline'
import { isCarrySpecialty } from '../../scripts/lib/presetCategories.mjs'

/**
 * 队伍输出核心槽（升序）。口径单源 = `scripts/lib/presetCategories.mjs#isCarrySpecialty`
 * （强攻/命破/异常/锋御=输出定位；击破/支援/防护=辅助）。首元素即 `resolveCarryAgent` 的
 * 「第一核心」（槽0=主C、槽0 辅助位退队内第一输出位）。
 * **双主C 队（异常双 C 等 ≥2 输出位）全部算主C**（账本 A4，用户「有些队伍不是一个主c」）：
 * 能量杠杆逐 carry 喂能、角点解只压非输出槽（第二个 carry 也是输出，压到最小够用 = 卖伤害）。
 * 整队无输出位（理论不收录）→ 回落 [0]（旧「槽0=主C」约定，行为不变）。
 */
// @fact engine:分配策略/主C判定 口径: 策略层「主C」= 队内**全部输出定位槽**（升序；单源 isCarrySpecialty，强攻/命破/异常/锋御），首元素=分类口径第一核心；能量喂能与 ex 守卫**逐核心**执行、角点解只压非输出槽；双主C 队核心间份额由均衡器按伤害边际协调（坐标上升=1D，A4）；整队无输出位回落 [0] | 据 用户@2026-09-10「有些队伍不是一个主c」+ 预设库分类同口径 用户@2026-09-08 | 验 src/composables/__tests__/timeWeightAllocation.test.ts#⑥f | 锚 src/composables/timeWeightAllocation.ts#carrySlotsOf | 信 确认
function carrySlotsOf(configStore: ConfigStore, catalogStore: ReturnType<typeof useCatalogStore>): number[] {
  const slots = [0, 1, 2].filter(s => {
    const id = String(configStore.team[s]?.agentId ?? '')
    return !!id && isCarrySpecialty(String(catalogStore.getAgent(id)?.specialty ?? ''))
  })
  return slots.length > 0 ? slots : [0]
}

type Calc = ReturnType<typeof useResourceCalc>
type ConfigStore = ReturnType<typeof useConfigStore>

export interface TimeWeightAllocationContext {
  calc: Calc
  configStore: ConfigStore
}

export interface TimeWeightAllocationResult {
  strategyId: string
  /** 应用后的各槽权重 */
  weights: number[]
  /** 应用后的团队总伤 */
  damage: number
  /** 是否真的改动了权重（可调槽位 <2 或已均衡时为 false） */
  applied: boolean
  note?: string
}

export interface TimeWeightStrategy {
  id: string
  label: string
  description: string
  allocate: (ctx: TimeWeightAllocationContext) => TimeWeightAllocationResult
}

/**
 * 策略⓪：**多杠杆联合搜索**（用户口径 2026-09-10：「总体而言是为了总伤最大化」+「弹刀这类交互
 * 也是伤害杠杆」+「弹刀多了也不能超过总时间，否则他可能无限制的加了」）。
 *
 * 搜索空间：① 平A 时间权重（委托边际均衡）；② **弹刀次数**（per-slot 交互杠杆，±阶梯坐标上升）。
 * 目标函数：团队总伤。**硬可行性门**：`overflowSeconds ≤ 0`（= 装配期没有发生时间线截断，
 * 即前台净占用 ≤ 预算）——**没有这道门，弹刀会无限加**：弹刀的 daze/喧响/闪能奖励照算，
 * 而超出的时间会被装配截断（坑22），模型于是「白拿奖励」，优化器会一路加到上限。
 * 这也是用户原话「弹刀多了也不能超过总时间」的机器面。
 *
 * 代价：≈ 边际均衡（~3 次求值）+ 弹刀阶梯（3 槽 × 2 方向 × ≤3 轮）≈ 15~20 次求值（~1.5s），
 * 因此只挂在**深度开关**（`configStore.deepTimeWeightSearch`，默认关）后面跑；默认主路径是较快的
 * 边际均衡（B）。交互搜索的其它候选（闪避/快支、合轴）同题扩展。
 */
export const jointLeverStrategy: TimeWeightStrategy = {
  id: 'joint-levers',
  label: '多杠杆联合（平A 权重 + 弹刀）',
  description: '按团队总伤联合搜索平A 权重与弹刀次数；硬门 = 不发生时间线截断（不超总时间）',
  allocate(ctx) {
    const { calc, configStore } = ctx
    const weightsBefore = [0, 1, 2].map(s => Math.max(0, Number(configStore.team[s]?.basicAttackTimeWeight ?? 0)))
    const parryBefore = [0, 1, 2].map(s => Math.max(0, Number(configStore.team[s]?.parryCount ?? 0)))
    const interactionBefore = [0, 1, 2].map(s => ({
      parryCount: Number(configStore.team[s]?.parryCount ?? 0),
      blockCount: Number(configStore.team[s]?.blockCount ?? 0),
      dualCounterCount: Number(configStore.team[s]?.dualCounterCount ?? 0),
      dodgeCounterCount: Number(configStore.team[s]?.dodgeCounterCount ?? 0),
    }))
    const stunBefore = calc.stunPoolResult.value?.stunCount ?? 0
    // 主C 判定走单源（carrySlotsOf）；**双主C 队逐槽都是主C**（A4，用户「有些队伍不是一个主c」）。
    // exStart = **策略入口**各核心强特次数（③ 喂能地板与守卫比较基准——曾在 ③ 起点抓取，
    // starved 恒 false，A4 一并修正）。
    const catalogStore = useCatalogStore()
    const carries = carrySlotsOf(configStore, catalogStore)
    const exOf = (s: number) => calc.resourceResult.value?.characters?.[s]?.exSpecialCount ?? 0
    const exStart = carries.map(c => exOf(c))
    /**
     * 可行性门 = **相对门：不许把「装不下」变得更差**（用户口径 2026-09-10：「39队直接拒绝那就删除防护，
     * 这总是在开发的时候拦截」）——原来是「截断必须为 0 否则拒绝」，于是**基线本身就超时的 39 队全被拒**，
     * 开发时看不到任何结果。改成相对判据：候选的截断量 ≤ 基线截断量。
     * · 基线不超时的队 → 等价于原来的「截断必须为 0」（防「弹刀无限加」的保护仍在）；
     * · 基线已超时的队（含轴模式队）→ 允许搜索，只要**不新增**截断（越界候选照旧回滚）。
     * **必须读结果自带的** `convergence.timeTruncatedSeconds`，不能读 `rr.overflowSeconds`——
     * 后者是 cfg 上的副作用字段（`calcTeamResources` 每次调用都写），一次预设求值跑十几次调用
     * （docs 坑33「尾巴专项」），读数会翻面（实测：门槛读 0 而终态 0.906s）。
     */
    const notes: string[] = []
    const truncation = () => calc.resourceResult.value?.convergence?.timeTruncatedSeconds ?? 0
    const baselineTruncation = truncation()
    const baselineDamage = calc.teamTotalDamage.value
    // 搜索常量（阶段 -1 与 ② 共用；必须声明在 -1 之前，防 TDZ）
    const STEP = 2
    const MAX_ROUNDS = 3
    const minParryTotal = Math.max(0, Number(configStore.appliedBoss?.parryTotal ?? 0))
    const totalParries = () => [0, 1, 2].reduce((acc, i) => acc + Math.max(0, Number(configStore.team[i]?.parryCount ?? 0)), 0)
    let floorBlocked = false
    /** 可行性门槛（相对门参考值）：可行性优先阶段找到的最小截断；未超时基线 = 0 */
    let feasibleFloor = baselineTruncation
    const feasible = () => truncation() <= feasibleFloor + 1e-6
    if (baselineTruncation > 1e-6) {
      notes.push(`基线本身已超时（装配截断 ${baselineTruncation.toFixed(2)}s）→ 先试拉回可行，保底走相对门（不更差）`)
    }
    // 阶段 -1：**可行性优先**（账本 A1，2026-09-10）——基线已超时的队先尝试把配置拉回可行，
    // 再谈总伤最大化。杠杆 = **减**交互（弹刀/金身/双反/闪反，与引擎非轴降配同族；加交互只会
    // 加剧截断，故只试减向）；接受条件 = 「截断减少 **且** 总伤不低于基线」（判据「→0 且总伤不降」），
    // 截断归零立即退出；拉不回来的队保底走相对门（后续 ①/② 用 feasibleFloor = 原截断，不更差）。
    // 原理：超时队的招式行会被时间线截断（坑22），交互行的时间是真占用、回报被截断吃掉大半，
    // 减掉低边际交互既能缩小截断又往往不亏伤害。
    if (baselineTruncation > 1e-6) {
      const FEAS_LEVERS = [
        { key: 'parry', get: (s: number) => Number(configStore.team[s]?.parryCount ?? 0), set: (s: number, v: number) => configStore.setParryCount(s, v) },
        { key: 'block', get: (s: number) => Number(configStore.team[s]?.blockCount ?? 0), set: (s: number, v: number) => configStore.setBlockCount(s, v) },
        { key: 'dual', get: (s: number) => Number(configStore.team[s]?.dualCounterCount ?? 0), set: (s: number, v: number) => configStore.setDualCounterCount(s, v) },
        { key: 'dodge', get: (s: number) => Number(configStore.team[s]?.dodgeCounterCount ?? 0), set: (s: number, v: number) => configStore.setDodgeCounterCount(s, v) },
      ] as const
      let bestTrunc = baselineTruncation
      let bestDmg = baselineDamage
      for (let round = 0; round < 2 && bestTrunc > 1e-6; round++) {
        let improved = false
        for (let slot = 0; slot < 3; slot++) {
          for (const lever of FEAS_LEVERS) {
            const cur = Math.max(0, lever.get(slot))
            const next = Math.max(0, cur - STEP)
            if (next === cur) continue
            // 弹刀减向不越过 boss 预设强制次数（与常规搜索同源下限）
            if (lever.key === 'parry' && totalParries() - STEP < minParryTotal) { floorBlocked = true; continue }
            lever.set(slot, next)
            const t = truncation()
            const d = calc.teamTotalDamage.value
            if (t < bestTrunc - 1e-6 && d >= baselineDamage - 1e-6) {
              bestTrunc = t
              bestDmg = d
              improved = true
            } else {
              lever.set(slot, cur)
            }
          }
        }
        if (!improved) break
      }
      feasibleFloor = bestTrunc
      if (bestTrunc < baselineTruncation - 1e-6) {
        notes.push(`可行性优先：截断 ${baselineTruncation.toFixed(2)}→${bestTrunc.toFixed(2)}s（总伤 ${(bestDmg / 1e6).toFixed(2)}M ≥ 基线 ${(baselineDamage / 1e6).toFixed(2)}M）`)
        if (bestTrunc <= 1e-6) notes.push('已拉回可行：装配不再截断')
      } else {
        notes.push(`拉不回来：必要行本身超预算（截断 ${bestTrunc.toFixed(2)}s 是硬约束），保持相对门`)
      }
    }
    // ① 平A 权重（委托边际均衡；它自己不含可行性门，故候选若越界即回滚）
    const w = marginalEqualizeStrategy.allocate(ctx)
    if (!feasible()) {
      for (let s = 0; s < 3; s++) configStore.setBasicAttackTimeWeight(s, weightsBefore[s])
      notes.push('平A 权重均衡解越界（超时间），已回滚')
    } else if (w.note) {
      notes.push(w.note)
    }
    // ② 弹刀阶梯：±step 坐标上升，接受条件 = 伤害上升 **且** 仍可行 **且** 不低于 boss 预设的强制次数；
    // 最多 3 轮（成本上界）。允许**减少**交互（用户口径：「计算器里弹刀是自我选择的语境，可以根据收益抉择。
    // 允许减少交互，因为有时候主c的平a比队友弹刀好用」），但**下限 = boss 预设强制完成的次数**
    // （用户口径：「不能降低到boss预设的最低次数，因为boss预设的次数是强制完成的」）。
    // 与 `core/parrySplit.ts` 同源：`parryTotal` = 正常弹刀总次数（叶释渊 13 等），由 boss 预设声明；
    // `parryNoFollowUpTotal` 是另一类（无支援突击）且 split 已强制归击破位，不并进本下限。
    // （STEP/MAX_ROUNDS/minParryTotal/totalParries/floorBlocked 已在上方阶段 -1 前声明）
    let best = calc.teamTotalDamage.value
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let improved = false
      for (let slot = 0; slot < 3; slot++) {
        for (const dir of [STEP, -STEP] as const) {
          const cur = Math.max(0, Number(configStore.team[slot]?.parryCount ?? 0))
          const next = Math.max(0, Math.min(99, cur + dir))
          if (next === cur) continue
          if (dir < 0 && totalParries() + dir < minParryTotal) { floorBlocked = true; continue } // 强制次数下限
          configStore.setParryCount(slot, next)
          const dmg = calc.teamTotalDamage.value
          if (!feasible() || dmg <= best + 1e-6) {
            configStore.setParryCount(slot, cur) // 回滚：越界或没变好
          } else {
            best = dmg
            improved = true
          }
        }
      }
      if (!improved) break
    }
    if (floorBlocked) {
      notes.push(`弹刀下调被挡在 boss 预设强制次数（parryTotal=${minParryTotal}）`)
    }
    // ③ 能量驱动（账本 A2 + A4）：平A 权重是主C 能量的主要来源（basicAttackTime × 秒均回能 →
    // 强特次数 = floor(总能量/耗能)）。①② 后若某主C 被挤掉次数（能量紧张），把**非输出槽**的权重
    // 转给他多A；接受 = 该主C exSpecialCount 上升 **且** 总伤不低于地板 **且** 仍可行
    // （判据「主C exSpecialCount 不降 + 总伤不降」）。地板：被挤的队 = 策略入口总伤；
    // 未挤的队 = 当前最优（不许用伤害换次数）。**双主C 逐核心分别喂**，且绝不从另一个主C 抽权重
    // （那是 ① 均衡器的职责——按伤害边际在核心间分配，A4「双主C 间分配」由此覆盖，逐槽坐标上升=1D）。
    let energyMoved = false
    const energyLog: string[] = []
    // ③④ 起点快照（权重与逐核心次数）：守卫回滚目标 = ①② 末态（不是策略入口，见下）
    const weightsMid = [0, 1, 2].map(s => Math.max(0, Number(configStore.team[s]?.basicAttackTimeWeight ?? 0)))
    const exMid = carries.map(c => exOf(c))
    carries.forEach((carry, ci) => {
      const exBaseC = exStart[ci]
      const exNowC = exOf(carry)
      const starved = exNowC < exBaseC - 1e-9 // ①② 挤掉了这个核心的次数 → 允许喂能（地板=入口总伤）
      let exBest = exNowC
      let dmgBest = calc.teamTotalDamage.value
      for (let round = 0; round < 2; round++) {
        let improved = false
        for (let from = 0; from < 3; from++) {
          if (carries.includes(from)) continue // 能量只从非输出槽来，饿不到另一个主C
          const wFrom = Math.max(0, Number(configStore.team[from]?.basicAttackTimeWeight ?? 0))
          if (wFrom <= 0) continue // 已无可转移的权重
          const wMain = Math.max(0, Number(configStore.team[carry]?.basicAttackTimeWeight ?? 0))
          configStore.setBasicAttackTimeWeight(carry, wMain + 1)
          configStore.setBasicAttackTimeWeight(from, wFrom - 1)
          const ex = exOf(carry)
          const d = calc.teamTotalDamage.value
          // 接受：ex 实打实上升 + 可行 + 伤害地板（被挤：入口总伤 / 未挤：当前最优）。
          // 被挤时允许**部分恢复**步进（ex 只要上升、终局由兜底守卫把关）——旧版要求单步跳回
          // 入口值，+1 步进跨不过去 → 17 队全回滚丢 ①② 收益（实测 +9.27% 掉到 +7.08%，已修正）
          const exOk = starved ? ex > exBest - 1e-9 : (ex > exBest - 1e-9 && ex >= exBaseC - 1e-9)
          const dmgOk = starved ? d >= baselineDamage - 1e-6 : d >= dmgBest - 1e-6
          if (exOk && dmgOk && feasible()) {
            exBest = ex
            dmgBest = Math.max(dmgBest, d)
            improved = true
            energyMoved = true
          } else {
            configStore.setBasicAttackTimeWeight(carry, wMain)
            configStore.setBasicAttackTimeWeight(from, wFrom)
          }
        }
        if (!improved) break
      }
      if (exBest > exNowC) energyLog.push(`槽${carry + 1} ${exNowC}→${exBest} 次`)
    })
    const weightsAfter = [0, 1, 2].map(s => Math.max(0, Number(configStore.team[s]?.basicAttackTimeWeight ?? 0)))
    if (energyMoved) {
      notes.push(`能量驱动：主C 强特 ${energyLog.join('、')}（多A 喂能，权重 ${weightsBefore.join('/')}→${weightsAfter.join('/')}）`)
    }
    // ④ 角点解（账本 A3 + A4）：**非输出核心槽**的平A 池只保留「打满失衡目标」的最小够用量——
    // 逐槽 1D 阈值下降（每次 −1 权重），接受 = 失衡次数不降（次数是硬约束）+ 伤害不低过当前最优
    // （不许用伤害换角点）+ 仍可行；降到底/次数掉/伤害掉即停在最小够用点。省下的池自动归各主C。
    // 双主C 队（A4）：**两个输出位都受保护不被压**——第二个 carry 也是主C，压到最小够用 = 卖伤害；
    // 核心之间的分配由 ① 的逐槽坐标上升（1D）按伤害边际决定。
    // 坑35 实测已证「击破位 0 会让个别队失衡 4→3」⇒ 不能硬编码 0，必须是阈值搜索；
    // `auto-1401-1511-1411` 给击破位权重反而 +8.4% 的反例由「伤害 ≥ 当前最优」接受门兜住。
    const stunOf = () => calc.stunPoolResult.value?.stunCount ?? 0
    const stunBase = stunOf()
    const cornerBefore = weightsAfter
    let cornerMoved = false
    let cornerDmg = calc.teamTotalDamage.value // ④ 前的搜索最优：角点解**不许用伤害换角点**
    for (const s of [0, 1, 2].filter(x => !carries.includes(x))) {
      for (let round = 0; round < 4; round++) {
        const w = Math.max(0, Number(configStore.team[s]?.basicAttackTimeWeight ?? 0))
        if (w <= 0) break
        configStore.setBasicAttackTimeWeight(s, Math.max(0, w - 1))
        const d = calc.teamTotalDamage.value
        const ok = stunOf() >= stunBase - 1e-9
          && d >= cornerDmg - 1e-6
          && feasible()
        if (!ok) {
          configStore.setBasicAttackTimeWeight(s, w) // 回滚到最小够用
          break
        }
        cornerDmg = Math.max(cornerDmg, d)
        cornerMoved = true
      }
    }
    if (cornerMoved) {
      const cornerAfter = [0, 1, 2].map(s => Math.max(0, Number(configStore.team[s]?.basicAttackTimeWeight ?? 0)))
      notes.push(`角点解：非主C 权重 ${cornerBefore.join('/')}→${cornerAfter.join('/')}（失衡 ${stunOf()} 次不降，主C 享剩余时间）`)
    }
    // 守卫 v2（判据：③④ 不许把任何核心弄坏）：③/④ 的每一步都以「该核心 ex 上升」为接受条件，
    // 若末态仍有核心低于 ①② 末态（理论不该发生，防御性兜住），**只回滚权重到 ①② 末态**、
    // 保住 ①② 与阶段 -1 的收益。⚠ 不做「对照策略入口全量回滚」的严格版——实测（2026-09-10）
    // 严格版咬 17 队：均衡器 ① 本会挪次数（同 ⑤ 的「次数是分配的结果，如实上报不拦截」先例），
    // 全量回滚连 A1 拉回可行的成果一起抵消（结束时仍截断 9→12 队、总伤 +9.27%→+7.08%）。
    // 判据「主C ex 不降」因此按**逐杠杆**解释：③④ 恒不降；① 的核心间挪动允许 + note 如实上报。
    let rolledBack = false
    const starvedNow = carries.map((c, i) => ({ c, now: exOf(c), mid: exMid[i] }))
      .filter(x => x.now < x.mid - 1e-9)
    if (starvedNow.length > 0) {
      rolledBack = true
      for (let s = 0; s < 3; s++) configStore.setBasicAttackTimeWeight(s, weightsMid[s])
      notes.push(`③④ 步弄坏主C 强特（${starvedNow.map(x => `槽${x.c + 1}：${x.mid}→${x.now}`).join('、')}），权重已还原 ①② 末态`)
    }
    const parryAfter = [0, 1, 2].map(s => Math.max(0, Number(configStore.team[s]?.parryCount ?? 0)))
    const parryMoved = parryAfter.some((v, i) => v !== parryBefore[i])
    if (parryMoved) {
      notes.push(`弹刀 ${parryBefore.join('/')}→${parryAfter.join('/')}（受「不发生截断」硬门约束）`)
    }
    const stunAfter = calc.stunPoolResult.value?.stunCount ?? 0
    if (stunAfter !== stunBefore) {
      notes.push(`失衡 ${stunBefore}→${stunAfter} 次（次数是分配的结果，未拦截）`)
    }
    // applied 覆盖全部杠杆：权重、弹刀、可行性优先阶段动的其它交互（金身/双反/闪反）
    const interactionMoved = ['parryCount', 'blockCount', 'dualCounterCount', 'dodgeCounterCount']
      .some(k => [0, 1, 2].some(s => Number((configStore.team[s] as Record<string, unknown>)[k] ?? 0)
        !== Number((interactionBefore[s] as Record<string, unknown>)[k] ?? 0)))
    // rolledBack（v2 守卫）只回滚权重：弹刀/其它交互的改动仍在 → moved 不算权重类
    const moved = parryMoved || interactionMoved || (!rolledBack && (w.applied || energyMoved || cornerMoved))
    return {
      strategyId: jointLeverStrategy.id,
      weights: [0, 1, 2].map(s => Math.max(0, Number(configStore.team[s]?.basicAttackTimeWeight ?? 0))),
      damage: calc.teamTotalDamage.value,
      applied: moved,
      note: notes.length > 0 ? notes.join('；') : undefined,
    }
  },
}

/**
 * 策略①：边际均衡（联合策略的①号子步，也可单独用）。
 * 用 `teamTimeline#optimizeTeamTimeWeights`（set-read-restore 经 `teamTotalDamage` 做有限差分坐标上升，
 * 纯算法见 `timeWeightBalancer#equalizeTimeWeights`）。支援/防护（权重 0）不参与转移，时间总权重守恒。
 *
 * **目标函数 = 团队总伤；失衡次数不是约束，而是分配的结果**（用户口径 2026-09-10，两轮修正后定稿）：
 * ①「失衡次数只是第一个决策…总体而言是为了**总伤最大化**」；
 * ②「给击破更多权重，结果导致总失衡次数下降，总伤害肯定也下降了。这是因为**扳机的战场性能比希希芙低很多**，
 *   所以这队的玩法是不论失衡有没有四舍五入，**都不该给扳机分配平A时间**。这又把第一条逻辑打回去了…
 *   我们最终目的是为了总伤提高，**失衡四舍五入不一定让总伤提高**，所以此处**打失衡的手段必须换成更高效的
 *   方式，比如弹刀**。」
 * → 曾经把次数做成硬约束（均衡解掉次数就回滚）**已按此撤销**：那会把「低性能击破位不该拿平A」这个正确
 *   结论反过来锁死。次数变化改为**如实上报**（`note`），供人裁决，不做拦截。
 * 关联：`docs/ENGINE_PIPELINE_GUIDE.md` 坑35（含「打失衡手段效率」的实测表）。
 */
export const marginalEqualizeStrategy: TimeWeightStrategy = {
  id: 'marginal-equalize',
  label: '边际均衡',
  description: '按团队总伤的边际产出在槽位间转移平A时间（保住主C 的能量需求；一次 ≈ 3 倍求值）',
  allocate({ calc, configStore }) {
    const before = [0, 1, 2].map(s => Math.max(0, Number(configStore.team[s]?.basicAttackTimeWeight ?? 0)))
    const stunBefore = calc.stunPoolResult.value?.stunCount ?? 0
    const r = optimizeTeamTimeWeights(calc, configStore, { maxIter: 2 })
    const stunAfter = calc.stunPoolResult.value?.stunCount ?? 0
    const moved = r.weights.some((w, i) => Math.abs(w - before[i]) > 1e-9)
    const notes: string[] = []
    if (!r.balanced) notes.push('可调槽位 <2（只有一个槽位权重 >0），跳过')
    else if (!moved) notes.push('已是均衡解，权重未变')
    if (r.balanced && stunAfter !== stunBefore) {
      // 如实上报（不拦截）：次数是分配的结果；要更多失衡应换更高效的手段（弹刀），不是给低性能击破位平A
      notes.push(`均衡后失衡 ${stunBefore}→${stunAfter} 次（次数是分配的结果，未拦截；需更多失衡请提高弹刀等交互）`)
    }
    return {
      strategyId: 'marginal-equalize',
      weights: r.weights,
      damage: r.damage,
      applied: r.balanced && moved,
      note: notes.length > 0 ? notes.join('；') : undefined,
    }
  },
}

/** 策略注册表（扩展点：`energy-driven` / `team-combo-align` 等新策略往这里加，调用点不动） */
export const TIME_WEIGHT_STRATEGIES: TimeWeightStrategy[] = [jointLeverStrategy, marginalEqualizeStrategy]

/**
 * 主路径**默认**策略 = 边际均衡（B）：用户 2026-09-10 裁决「默认快一些的B，做个开关，如果开了就是更慢的C」。
 * 它一次 ≈ 3 倍求值，是默认路径能接受的上限；实测全库 +2.86% 总伤、0 队变差（坐标上升单调）。
 */
export const DEFAULT_TIME_WEIGHT_STRATEGY_ID = marginalEqualizeStrategy.id

/** **深度开关**（`configStore.deepTimeWeightSearch`）打开时升级到的策略 = 多杠杆联合（C，更慢）。 */
export const DEEP_TIME_WEIGHT_STRATEGY_ID = jointLeverStrategy.id

/** 深度开关 → 策略 id（默认 B；开启 = C）。UI 开关与调用点只认这一个映射，策略改名不用碰调用点。 */
export function timeWeightStrategyIdForDeepSearch(deep: boolean): string {
  return deep ? DEEP_TIME_WEIGHT_STRATEGY_ID : DEFAULT_TIME_WEIGHT_STRATEGY_ID
}

export function getTimeWeightStrategy(id: string = DEFAULT_TIME_WEIGHT_STRATEGY_ID): TimeWeightStrategy {
  return TIME_WEIGHT_STRATEGIES.find(s => s.id === id)
    ?? TIME_WEIGHT_STRATEGIES.find(s => s.id === DEFAULT_TIME_WEIGHT_STRATEGY_ID)
    ?? marginalEqualizeStrategy
}

/** 应用一个分配策略（默认=边际均衡） */
export function applyTimeWeightAllocation(
  ctx: TimeWeightAllocationContext,
  strategyId?: string,
): TimeWeightAllocationResult {
  return getTimeWeightStrategy(strategyId).allocate(ctx)
}

/**
 * 触发签名：只含「应当重新分配」的输入（队伍成员/命座/音擎/驱动盘/交互次数…），
 * **刻意排除 `basicAttackTimeWeight` 本身**——否则策略写回权重会自触发成死循环。
 *
 * ⚠ **字符串里 delete 了权重，但依赖仍被追踪**：`{...c}` 展开会读到全部字段（含权重）→ 在 watch 源里调用它
 * 会让「写权重」也算依赖变化。所以调用点的源必须是**原始值**且不能被自身写回改写判据——见
 * `useTimeWeightAutoAllocation` 的防自触发两条（2026-09-10 实测 `Maximum recursive updates exceeded`）。
 */
export function timeWeightAllocationSignature(configStore: ConfigStore): string {
  return JSON.stringify(configStore.team.map(c => {
    const o = { ...c } as Record<string, unknown>
    delete o.basicAttackTimeWeight
    return o
  }))
}

/**
 * 开关接线：**默认主路径**就在队伍签名变化后跑一次**边际均衡（B）**；`configStore.deepTimeWeightSearch`
 * 打开时同一触发点升级为**多杠杆联合（C，更慢）**（用户 2026-09-10 裁决：默认快一些的 B、开关给更慢的 C）。
 *
 * 为什么放在 composable 而不是引擎里：策略要**读伤害**（`teamTotalDamage`）才能做有限差分，
 * 而它自己又写权重 → 放进响应式计算会递归。这里是「计算外侧」的一次显式求解，与金数分配路径
 * （`teamTimeline` 的 `allocateGoldByGreedy`）同款做法。
 *
 * **两个防自触发的关键点（2026-09-10 实测踩坑，改这里前先读）**：
 *  ① **watch 源必须是原始值**（下面的签名**字符串**）。曾写成 `[deep, signature] as const` 返回**数组**——
 *     数组每次求值都是新引用 ⇒ Vue 的 `hasChanged` 恒真 ⇒ 回调每次都触发；策略跑起来写权重/弹刀又改了
 *     源依赖（`timeWeightAllocationSignature` 的 `{...c}` 展开**会**追踪含权重在内的全部字段，虽然字符串
 *     里把权重 delete 了，值不变但**依赖被追踪**）⇒ **回调→写→回调** 自激成死循环，实测报
 *     `Maximum recursive updates exceeded`（原先开关默认关、回调开头早退，把这个坑盖住了；改「默认跑 B」
 *     才暴露）。字符串比较下「自己写回的值不进签名」= 不会自触发。
 *  ② `settledSignature`：记下**每次跑完**的签名。策略自身写回（弹刀/其它交互是签名的一部分）会排一个
 *     post-flush 任务；任务醒来时若签名与跑完时一致 → 说明无新输入 → **跳过**（否则每次队伍变更要多付一次
 *     联合搜索 ~1.5s）。真正的新输入（换人/改配装/改交互）签名必然不同 → 照常跑。
 *
 * 成本与安全：**只在触发点跑**（不是每次求值都跑）；重入保护避免抖动（上一次未算完就跳过本轮，不排队）。
 * 默认 B ≈ 3 倍求值（~0.2s/队），深度开关 C ≈ 15~20 次求值（~1.5s/队）。
 * 手改的权重/弹刀会在下次签名变化时被覆盖（一直是这个约定，UI tooltip 已如实写）。
 */
export function useTimeWeightAutoAllocation(): { applyNow: () => TimeWeightAllocationResult } {
  const configStore = useConfigStore()
  const calc = useResourceCalc()
  let running = false
  /** 上次跑完时的触发签名（策略自己写回的不算新输入，见上文②） */
  let settledSignature = ''
  /** 源必须是**原始值**（见上文①）：返回数组会因引用不等而每次求值都判定「变了」 */
  const signature = () => `${configStore.deepTimeWeightSearch}|${timeWeightAllocationSignature(configStore)}`
  const apply = () => applyTimeWeightAllocation(
    { calc, configStore },
    timeWeightStrategyIdForDeepSearch(configStore.deepTimeWeightSearch),
  )
  const run = () => {
    if (running) return
    if (signature() === settledSignature) return
    running = true
    try {
      apply()
      settledSignature = signature()
    } finally {
      running = false
    }
  }
  watch(signature, () => run(), { flush: 'post' })
  return { applyNow: () => apply() }
}
